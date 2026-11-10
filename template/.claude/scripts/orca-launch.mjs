// Worker/coordinator launch: checks the spec's assignment against the model table, then starts via Orca.
//   node .claude/scripts/orca-launch.mjs worker --agent <a> --unit <u> --spec-file <p> --bracket <BL-0012|phase> --does <하는 일> [--run <id>] [--task <id>] [--lead] [--override-reason <원문>]
//   node .claude/scripts/orca-launch.mjs coordinator --phase <phase> --spec-file <p> --does <요청> [--backlog BL-0001,BL-0002]
//   node .claude/scripts/orca-launch.mjs snapshot --run <id>
//   node .claude/scripts/orca-launch.mjs codex-rules   (prints the six worker lines for a Codex Task spec)
// stdout: one JSON receipt. Never stops or relaunches a worker whose turn start was not observed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TABLE_PATH, parseTable, lookup } from './model-selection.mjs';
import { SETTINGS_PATH, KEEP_PATH, unclassified, readInventory } from './coordinator-settings.mjs';

// P8: Codex runs project hooks only after a human trusts them, so Codex workers get the hook's six lines in the spec instead.
export const HOOK_PATH = '.claude/hooks/worker-intake-context.mjs';
const fmt = (model, effort) => (effort ? `${model}/${effort}` : model);
const fmtRow = (runtime, model, effort) => `${runtime} ${fmt(model, effort)}`;

export function tabTitle({ bracket, agent, model, effort, does }) {
  return `[${bracket}] ${agent} : ${fmt(model, effort)} - ${does}`;
}

export function parseAssignLine(spec) {
  const m = /^배정:\s*(\S+)\s*\/\s*(.+?)\s*\((\S+)\s+([^\s/()]+)(?:\/([^\s/()]+))?\)\s*$/m.exec(spec);
  return m ? { agent: m[1], unit: m[2], runtime: m[3], model: m[4], effort: m[5] ?? null } : null;
}

export function parseOverrideLine(spec) {
  const m = /^사용자 예외:\s*(.+?)\s*$/m.exec(spec);
  return m ? m[1] : null;
}

export function verifyAssignment({ spec, agent, unit, row, overrideReason, lead }) {
  const errors = [];
  if (lead) {
    const first = spec.replace(/^﻿/, '').split(/\r?\n/)[0].trim();
    const want = `[역할: ${agent} · 리드]`;
    if (first !== want) errors.push(`리드: spec 첫 줄이 \`${want}\`가 아님(\`${first}\`)`);
  }
  const a = parseAssignLine(spec);
  if (!a) return [...errors, 'spec에 `배정:` 줄이 없음'];
  if (a.agent !== agent) errors.push(`배정 에이전트 \`${a.agent}\` ≠ 인자 \`${agent}\``);
  if (a.unit !== unit) errors.push(`배정 작업 단위 \`${a.unit}\` ≠ 인자 \`${unit}\``);
  const override = parseOverrideLine(spec);
  if (!!override !== !!overrideReason) {
    errors.push(override ? 'spec에 `사용자 예외:` 줄이 있는데 --override-reason이 없음' : '--override-reason이 있는데 spec에 `사용자 예외:` 줄이 없음');
  } else if (!override && (a.runtime !== row.runtime || a.model !== row.model || a.effort !== row.effort)) {
    errors.push(`배정 \`${fmtRow(a.runtime, a.model, a.effort)}\` ≠ 표 L${row.line} \`${fmtRow(row.runtime, row.model, row.effort)}\``);
  }
  return errors;
}

export function workerStartArgs({ row, specFile, run, task, displayName, worktree }) {
  return [
    'worker-start',
    // worker-start takes one of --task / --spec-file; an existing Task carries its own spec
    ...(task ? ['--task', task] : ['--spec-file', specFile]),
    ...(run ? ['--run', run] : []),
    '--agent', row.runtime,
    '--model', row.model,
    ...(row.effort ? ['--effort', row.effort] : []),
    '--worktree', worktree,
    '--display-name', displayName,
  ];
}

// Quote only what a shell (bash or PowerShell) would split or glob, e.g. a path with spaces or `opus[1m]`.
const q = (s) => (/^[\w.:/\\-]+$/.test(s) ? s : `"${s}"`);

const MODES = ['default', 'acceptEdits', 'bypassPermissions'];
const WORD = /^[\w.\-\[\]]+$/;

// P1: the settings file goes in as a path via --settings.
// A shell reads this line, so every value is checked first; a value a shell could run as code throws instead.
export function coordinatorCommand({ model, effort, settingsPath, permissionMode }) {
  if (!MODES.includes(permissionMode)) throw new Error(`permissionMode \`${permissionMode}\`가 ${MODES.join(', ')} 중 하나가 아님 — 띄우지 않음`);
  if (!WORD.test(model)) throw new Error(`model \`${model}\`에 허용되지 않는 문자가 있음 — 띄우지 않음`);
  if (effort && !WORD.test(effort)) throw new Error(`effort \`${effort}\`에 허용되지 않는 문자가 있음 — 띄우지 않음`);
  if (/["$`]/.test(settingsPath)) throw new Error(`설정 경로 \`${settingsPath}\`에 ", $, 백틱이 있음 — 띄우지 않음`);
  return `claude --model ${q(model)}${effort ? ` --effort ${q(effort)}` : ''} --permission-mode ${q(permissionMode)} --settings ${q(settingsPath)}`;
}

const OPTIONS = Object.fromEntries([
  ...['agent', 'unit', 'spec-file', 'bracket', 'does', 'run', 'task', 'override-reason', 'phase', 'backlog'].map((k) => [k, { type: 'string' }]),
  ['lead', { type: 'boolean' }],
]);
const fail = (error, extra = {}) => ({ code: 1, out: { error, ...extra } });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// phase name or backlog ID as a whole token of the objective (`phase-a` must not match `phase-ab`)
const hasToken = (text, token) => new RegExp(`(^|[\\s\\[,])${escapeRe(token)}($|[\\s\\],])`).test(text);

export async function main(argv, deps) {
  const [cmd, ...rest] = argv;
  let o;
  try { o = parseArgs({ args: rest, options: OPTIONS }).values; } catch (e) { return fail(e.message); }
  const call = (args) => {
    const r = deps.orca([...args, '--json']);
    try { return JSON.parse(r.stdout); } catch { return { ok: false, error: { message: (r.stderr || r.stdout || '').slice(0, 500) } }; }
  };
  const worktree = `path:${process.cwd()}`;

  const rules = () => {
    let text = '';
    try { text = (deps.hookLines ?? hookLines)(); } catch { /* reported as empty below */ }
    if (!text?.trim()) throw new Error(`${HOOK_PATH}에서 작업 방식 줄을 얻지 못함 — 띄우지 않음`);
    return text;
  };

  if (cmd === 'codex-rules') {
    try { return { code: 0, out: rules() }; } catch (e) { return fail(e.message); }
  }

  if (cmd === 'snapshot') {
    if (!o.run) return fail('사용법: snapshot --run <id>');
    // --peek reads the inbox without consuming it
    const inbox = call(['orchestration', 'check', '--peek']);
    const workers = call(['orchestration', 'worker-list', '--run', o.run, '--full']);
    return { code: inbox.ok === false || workers.ok === false ? 1 : 0, out: { run: o.run, inbox, workers } };
  }

  const table = (agent, unit) => {
    const row = lookup(parseTable(deps.read(TABLE_PATH)).rows, agent, unit);
    if (!row) throw new Error(`모델 표에 (${agent}, ${unit}) 줄이 없음`);
    return row;
  };

  if (cmd === 'worker') {
    if (!o.agent || !(o.unit || o.lead) || !o['spec-file'] || !o.bracket || !o.does) {
      return fail('사용법: worker --agent <a> --unit <u> --spec-file <p> --bracket <b> --does <d> [--run <id>] [--task <id>] [--lead] [--override-reason <원문>]');
    }
    const unit = o.lead ? '리드' : o.unit;
    let row, spec;
    try { row = table(o.agent, unit); spec = deps.read(o['spec-file']); } catch (e) { return fail(e.message); }
    const overrideReason = o['override-reason'] ?? null;
    const errors = verifyAssignment({ spec, agent: o.agent, unit, row, overrideReason, lead: !!o.lead });
    if (errors.length) return fail('배정 불일치 — 띄우지 않음', { errors });
    const a = parseAssignLine(spec);
    const use = overrideReason ? { ...row, runtime: a.runtime, model: a.model, effort: a.effort } : row;
    let specFile = o['spec-file'];
    if (use.runtime === 'codex') {
      if (o.task) console.error('경고: Codex 워커 — Task spec에 작업 방식 여섯 줄이 들어 있어야 한다(codex-rules)');
      else {
        let text;
        try { text = rules(); } catch (e) { return fail(e.message); }
        specFile = join(mkdtempSync(join(tmpdir(), 'orca-spec-')), basename(specFile));
        writeFileSync(specFile, `${spec.trimEnd()}\n\n${text.trimEnd()}\n`);
      }
    }
    const title = tabTitle({ bracket: o.bracket, agent: o.agent, model: use.model, effort: use.effort, does: o.does });
    const res = call(['orchestration', ...workerStartArgs({ row: use, specFile, run: o.run, task: o.task, displayName: title, worktree }), '--full']);
    const r = res.result ?? {};
    const eff = r.launch?.effective ?? {};
    const applied = { model: eff.model ?? null, effort: eff.effort ?? null };
    const terminal = (r.effects ?? []).find((e) => e.kind === 'terminal')?.id ?? null;
    const turnStarted = r.turnStart === 'observed';
    const out = {
      run: o.run ?? r.runId ?? r.run?.id ?? null, task: r.taskId ?? null, dispatch: r.dispatchId ?? null, terminal, title,
      requested: { runtime: use.runtime, model: use.model, effort: use.effort }, applied,
      matched: applied.model === use.model && applied.effort === use.effort, turnStarted,
    };
    if (!r.dispatchId) out.error = res.error?.message ?? 'worker-start 영수증에 dispatch가 없음';
    // P10: --display-name is not the tab title; rename once, right after start. A rename failure never fails the start.
    if (turnStarted && terminal) call(['terminal', 'rename', '--terminal', terminal, '--title', title]);
    return { code: turnStarted ? 0 : 1, out };
  }

  if (cmd === 'coordinator') {
    if (!o.phase || !o['spec-file'] || !o.does) return fail('사용법: coordinator --phase <phase> --spec-file <p> --does <요청> [--backlog BL-0001,BL-0002]');
    let keep, row, command;
    try {
      for (const p of [SETTINGS_PATH, KEEP_PATH]) {
        try { deps.read(p); } catch { throw new Error(`${p} 없음 — node .claude/scripts/coordinator-settings.mjs generate 를 먼저 돌린다`); }
      }
      keep = JSON.parse(deps.read(KEEP_PATH).replace(/^﻿/, ''));
      row = table('coordinator', '실행 감독');
      // built before the first Orca call: a refused value must leave no Run behind
      command = coordinatorCommand({ model: row.model, effort: row.effort, settingsPath: SETTINGS_PATH, permissionMode: keep.permissionMode ?? 'default' });
    } catch (e) { return fail(e.message); }
    const backlog = (o.backlog ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // shortcut: --full returns one page of the newest Runs; older pages are not checked
    const list = call(['orchestration', 'run-list', '--full']);
    if (list.ok === false) return fail(`run-list 실패: ${list.error?.message}`);
    const dup = (list.result?.runs ?? []).filter((x) => [o.phase, ...backlog].some((t) => hasToken(x.objective ?? '', t)));
    if (dup.length) return fail('같은 phase나 백로그 ID의 Run이 이미 있음 — 띄우지 않음', { runs: dup });
    const un = unclassified(keep, readInventory(deps.run));
    const n = un.plugins.length + un.skills.length;
    if (n) console.error(`경고: 분류되지 않은 항목 ${n}개`);

    const created = call(['orchestration', 'run-create', '--objective', `${o.phase}${backlog.length ? ` [${backlog.join(', ')}]` : ''}`, '--full']);
    const run = created.result?.run?.id;
    if (!run) return fail(`run-create 실패: ${created.error?.message ?? 'Run ID 없음'}`);
    // the coordinator spans backlog items, so its bracket is the phase name (설계서 4.5절)
    const title = tabTitle({ bracket: o.phase, agent: 'coordinator', model: row.model, effort: row.effort, does: o.does });
    // P1: --title on create becomes the tab title, and it is set before the first turn (P10)
    const term = call(['terminal', 'create', '--worktree', worktree, '--title', title, '--command', command]);
    const terminal = term.result?.terminal?.handle ?? null;
    const base = { run, task: null, dispatch: null, terminal, title, requested: { runtime: row.runtime, model: row.model, effort: row.effort }, applied: null, matched: false, turnStarted: false };
    if (!terminal) return fail(`terminal create 실패: ${term.error?.message ?? 'handle 없음'}`, base);
    const idle = call(['terminal', 'wait', '--terminal', terminal, '--for', 'tui-idle', '--timeout-ms', '120000']);
    const wait = idle.result?.wait ?? {};
    // e.g. blockedReason "agent-trust-workspace": the folder-trust screen is up and only the user can answer it
    if (wait.satisfied !== true || wait.blockedReason) {
      return fail(`터미널이 입력 대기 상태가 아님(${wait.blockedReason ?? idle.error?.message ?? 'unsatisfied'}) — Task를 배정하지 않음, 화면을 확인한다`, base);
    }
    const res = call(['orchestration', 'worker-start', '--run', run, '--terminal', terminal, '--worktree', worktree, '--spec-file', o['spec-file'], '--task-title', title, '--full']);
    const r = res.result ?? {};
    const turnStarted = r.turnStart === 'observed';
    // P1: a pre-made terminal's receipt has no launch values, so the launch line's model/effort are the applied ones
    const out = { ...base, task: r.taskId ?? null, dispatch: r.dispatchId ?? null, applied: { model: row.model, effort: row.effort }, matched: true, turnStarted };
    if (!r.dispatchId) out.error = res.error?.message ?? 'worker-start 영수증에 dispatch가 없음';
    return { code: turnStarted ? 0 : 1, out };
  }

  return fail('사용법: orca-launch.mjs worker|coordinator|snapshot|codex-rules ...');
}

const opts = { encoding: 'utf8', maxBuffer: 64 << 20 };
// Run the hook as the Orca preamble would trigger it; its additionalContext is the single source of the six lines.
function hookLines() {
  const r = spawnSync(process.execPath, [HOOK_PATH], { ...opts, input: JSON.stringify({ prompt: 'You are a dispatched worker' }) });
  return JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext ?? '';
}
const deps = {
  orca: (args) => spawnSync('orca', args, opts),
  read: (p) => readFileSync(p, 'utf8').replace(/^﻿/, ''),
  run: (cmd, args) => spawnSync(cmd, args, opts).stdout ?? '',
};

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { code, out } = await main(process.argv.slice(2), deps);
  console.log(typeof out === 'string' ? out : JSON.stringify(out));
  process.exitCode = code;
}
