// Before execution approval, the front desk uses the current model table.
//   node .claude/scripts/orca-launch.mjs review --version v1 --plan <plan.md> --dag <dag.json>
//   node .claude/scripts/orca-launch.mjs approve --version v1 --plan <plan.md> --dag <dag.json> --review <reviewed hash> --response <user's reply>
//   node .claude/scripts/orca-launch.mjs reapprove --map <map> --approval <approved-plan.v2.json> --id <T01>
//   node .claude/scripts/orca-launch.mjs assessment-context --approval <file> --id <Task> --spec-file <authored spec>
//   node .claude/scripts/orca-launch.mjs worker --agent <a> --unit <u> --spec-file <p> --bracket <BL-0012|phase> --does <하는 일> [--run <id>] [--task <id>] [--override-reason <원문>]   (outside an execution Run)
//   node .claude/scripts/orca-launch.mjs coordinator --phase <phase> --spec-file <p> --does <요청> [--backlog BL-0001,BL-0002] --approval <file> --version v1 --plan <plan.md> --dag <dag.json>
//   node .claude/scripts/orca-launch.mjs snapshot --run <id>
//   node .claude/scripts/orca-launch.mjs codex-rules   (prints the six worker lines for a Codex Task spec)
//   node .claude/scripts/orca-launch.mjs wait --inbox run:<Run ID>|dispatch:<Dispatch ID> [--once] [--last]   (background; returns only mail to act on)
// Tasks registered in Orca (the coordinator's execution Run; <map> is _workspace/_run/<phase>/orca-tasks.json):
//   node .claude/scripts/orca-launch.mjs exec-run --phase <phase> --map <map> --approval <approved-plan.v1.json>
//   node .claude/scripts/orca-launch.mjs register --map <map> --id <T01> --spec-file <p> [--deps T01,T02] [--override-reason <원문>] [--edits <경로,…>] [--resource <gpu,blender,…>]
//   node .claude/scripts/orca-launch.mjs worker --map <map> --id <T01> --bracket <b> --does <d> [--assessment <json>] [--retry]
//   node .claude/scripts/orca-launch.mjs ready --map <map>
//   node .claude/scripts/orca-launch.mjs launchable --map <map> [--slots 8]   (register takes --edits <paths,> --resource <gpu,blender>)
//   node .claude/scripts/orca-launch.mjs pull --map <map> --id <T01> --deps <실제 입력 Task,…> --reason <이유>
//   node .claude/scripts/orca-launch.mjs fail --map <map> --id <T01> --cause <원인>
//   node .claude/scripts/orca-launch.mjs settle --map <map> --id <T01> --dispatch <id> --report <리포트> --ledger <ledger.md> [--expect <산출물,…>] [--outcome failed]
//   node .claude/scripts/orca-launch.mjs skip --map <map> --id <T01> --reason <사유>   (conditional, fix and recheck Tasks only)
//   node .claude/scripts/orca-launch.mjs gate --map <map> --id <T01> --question <질문>
//   node .claude/scripts/orca-launch.mjs resolve --map <map> --id <T01> --resolution <답>
//   node .claude/scripts/orca-launch.mjs actual --map <map>
// stdout: one JSON receipt. Never stops or relaunches a worker whose turn start was not observed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, realpathSync, renameSync, linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { TABLE_PATH, parseTable, matchRow, lookup, choices } from './model-selection.mjs';
import { assessRouting } from './model-routing.mjs';
import { SETTINGS_PATH, KEEP_PATH, unclassified, readInventory } from './coordinator-settings.mjs';
import { reviewPlan, approvePlan, loadApproval } from './orca-launch-approval.mjs';
import { readLedger, fixAllowed, currentRound, parseDefects, addDefects, addSnapshot } from './defect-ledger.mjs';
import { judge } from './report-check.mjs';
import { take as takeTree, defaultGit } from './tree-snapshot.mjs';
import { readRoster } from './roster.mjs';

// P8: Codex runs project hooks only after a human trusts them, so Codex workers get the hook's six lines in the spec instead.
export const HOOK_PATH = '.claude/hooks/worker-intake-context.mjs';
const fmt = (model, effort) => (effort ? `${model}/${effort}` : model);
const fmtRow = (runtime, model, effort) => `${runtime} ${fmt(model, effort)}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const specHash = text => hash(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd());
function authoredSpec(text, review, id) {
  const body = text?.replace(/\r\n/g, '\n') ?? '';
  const marker = '\n\n실행 승인: ' + review + ' ' + id;
  const end = body.lastIndexOf(marker);
  if (end < 0 || (body[end + marker.length] && body[end + marker.length] !== '\n')) throw new Error('Orca에 등록된 원본 spec의 승인 표식을 확인할 수 없음');
  return body.slice(0, end);
}

export function tabTitle({ bracket, agent, model, effort, does }) {
  return `[${bracket} - ${agent}] ${does} ${fmt(model, effort)}`;
}

export function parseAssignLine(spec) {
  const m = /^배정:\s*(\S+)\s*\/\s*(.+?)\s*\((\S+)\s+([^\s/()]+)(?:\/([^\s/()]+))?\)\s*$/m.exec(spec);
  return m ? { agent: m[1], unit: m[2], runtime: m[3], model: m[4], effort: m[5] ?? null } : null;
}

export function parseOverrideLine(spec) {
  const m = /^사용자 예외:\s*(.+?)\s*$/m.exec(spec);
  return m ? m[1] : null;
}

export function verifyAssignment({ spec, agent, unit, row, overrideReason }) {
  const errors = [];
  const a = parseAssignLine(spec);
  if (!a) return ['spec에 `배정:` 줄이 없음'];
  if (a.agent !== agent) errors.push(`배정 에이전트 \`${a.agent}\` ≠ 인자 \`${agent}\``);
  if (a.unit !== unit) errors.push(`배정 작업 단위 \`${a.unit}\` ≠ 인자 \`${unit}\``);
  const override = parseOverrideLine(spec);
  if (!!override !== !!overrideReason) {
    errors.push(override ? 'spec에 `사용자 예외:` 줄이 있는데 --override-reason이 없음' : '--override-reason이 있는데 spec에 `사용자 예외:` 줄이 없음');
  } else if (override !== (overrideReason ?? null)) {
    errors.push('사용자 예외 원문이 다름');
  } else if ((!override || 'overrideReason' in row) && (a.runtime !== row.runtime || a.model !== row.model || a.effort !== row.effort)) {
    errors.push(`배정 \`${fmtRow(a.runtime, a.model, a.effort)}\` ≠ 표 L${row.line} \`${fmtRow(row.runtime, row.model, row.effort)}\``);
  }
  return errors;
}

export function workerStartArgs({ row, specFile, run, task, displayName, worktree }) {
  return [
    'worker-start',
    // worker-start takes one of --task / --spec-file; an existing Task carries its own spec
    ...(task ? ['--task', task] : ['--spec-file', specFile, '--task-title', displayName]),
    ...(run ? ['--run', run] : []),
    '--agent', row.runtime,
    '--model', row.model,
    ...(row.effort ? ['--effort', row.effort] : []),
    '--worktree', worktree,
  ];
}

// Quote only what a shell (bash or PowerShell) would split or glob, e.g. a path with spaces or `opus[x]`.
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
  ...['agent', 'unit', 'spec-file', 'bracket', 'does', 'run', 'task', 'override-reason', 'phase', 'backlog',
    'map', 'id', 'deps', 'cause', 'question', 'resolution', 'edits', 'resource', 'slots', 'reason',
    'version', 'plan', 'dag', 'review', 'response', 'approval', 'legacy-map', 'complexity', 'assessment',
    'inbox', 'state', 'timeout-ms', 'dispatch', 'report', 'ledger', 'expect', 'outcome', 'round-cap'].map((k) => [k, { type: 'string' }]),
  ...['retry', 'once', 'last'].map((k) => [k, { type: 'boolean' }]),
]);
// What wakes a wait. heartbeat is left out; status stays, since it carries the user's instruction to a waiting coordinator.
const WAKE_TYPES = 'worker_done,escalation,question,status';
const fail = (error, extra = {}) => ({ code: 1, out: { error, ...extra } });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// phase name or backlog ID as a whole token of the objective (`phase-a` must not match `phase-ab`)
const csv = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const hasToken = (text, token) => new RegExp(`(^|[\\s\\[,])${escapeRe(token)}($|[\\s\\],])`).test(text);
// `cmd` as a whole command in `text`: `npm test` and `npm test 통과` count; `npm test -- a.test.ts` (narrower) and `pnpm test` do not.
// After a space, a token that looks like an argument extends the command; a shell redirection such as `2>&1` does not.
const QUOTES = `"'“”‘’`;
function wholeCommand(text, cmd) {
  for (let i = text.indexOf(cmd); i >= 0; i = text.indexOf(cmd, i + 1)) {
    if (i > 0 && !/\s/.test(text[i - 1]) && !('`(' + QUOTES).includes(text[i - 1])) continue;
    const rest = text.slice(i + cmd.length);
    if (rest === '' || /^[\r\n]/.test(rest) || ('`)' + QUOTES).includes(rest[0])) return true;
    if (!/^\s/.test(rest)) continue;
    const next = rest.trimStart().split(/\s/)[0];
    if (/^\d*[<>]/.test(next) || !/^[A-Za-z0-9\-./_@=~$]/.test(next)) return true;
  }
  return false;
}

export async function main(argv, deps) {
  const [cmd, ...rest] = argv;
  let o;
  try { o = parseArgs({ args: rest, options: OPTIONS }).values; } catch (e) { return fail(e.message); }
  // Serialize the owner's changes to a Run.
  let release;
  try {
    if (o.map && deps.lock) release = await deps.lock(o.map);
    return await execute(cmd, o, deps);
  } catch (e) { return fail(e.message); } finally { release?.(); }
}

async function execute(cmd, o, deps) {
  const io = {
    read: deps.read,
    optional: path => {
      try { return deps.read(path); } catch (e) {
        if (e.code === 'ENOENT' || /^ENOENT /.test(e.message)) return null;
        throw e;
      }
    },
    create: deps.create ?? deps.write,
  };
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

  if (cmd === 'assessment-context') {
    if (!o['spec-file'] || !o.id) return fail('assessment-context --approval <승인> --id <Task> --spec-file <원본 spec>');
    const approval = loadApproval(o.approval, io);
    const source = deps.read(o['spec-file']);
    if (/^Task:\s*(\S+)/m.exec(source)?.[1] !== o.id) return fail('Task ID와 spec 불일치');
    return { code: 0, out: { id: o.id, review: approval.review, specHash: specHash(source) } };
  }

  if (cmd === 'snapshot') {
    if (!o.run) return fail('사용법: snapshot --run <id>');
    // --peek reads the inbox without consuming it
    const inbox = call(['orchestration', 'check', '--peek']);
    const workers = call(['orchestration', 'worker-list', '--run', o.run, '--full']);
    return { code: inbox.ok === false || workers.ok === false ? 1 : 0, out: { run: o.run, inbox, workers } };
  }

  // The one wait a coordinator or front desk keeps, run as a tracked background command. It waits through
  // heartbeats, redeliveries and timeouts and returns only mail to act on, so the model is not woken to re-arm a wait.
  if (cmd === 'wait') {
    if (!/^(run|dispatch):\S+$/.test(o.inbox ?? '')) return fail('사용법: wait --inbox run:<Run ID>|dispatch:<Dispatch ID> [--once] [--last]');
    const path = o.state ?? join('_workspace', '_run', '.wait', `${o.inbox.replace(':', '_')}.json`);
    const st = JSON.parse(io.optional(path) ?? 'null') ?? { since: deps.now(), seen: [], done: {}, last: [] };
    if (o.last) return { code: 0, out: { messages: st.last } };
    const json = (s) => { try { return JSON.parse(s); } catch { return s ?? null; } };
    // Each message is handed over once. A worker_done for a Dispatch that reported seconds ago is the worker's resend.
    const take = (rows) => rows.filter((m) => {
      if (m.type === 'heartbeat' || st.seen.includes(m.id)) return false;
      st.seen.push(m.id);
      const dispatch = m.type === 'worker_done' && json(m.payload)?.dispatchId;
      if (!dispatch) return true;
      const prev = st.done[dispatch];
      st.done[dispatch] = m.created_at;
      return !(prev && Math.abs(Date.parse(m.created_at) - Date.parse(prev)) < 60000);
    }).map((m) => ({ id: m.id, type: m.type, from: m.from_handle, subject: m.subject, body: m.body, payload: json(m.payload), at: m.created_at }));
    const check = ['orchestration', 'check', ...(o.once ? [] : ['--wait', '--types', WAKE_TYPES, '--timeout-ms', o['timeout-ms'] ?? '1800000']),
      ...(o.inbox.startsWith('run:') ? ['--run', o.inbox.slice(4)] : [])];
    for (let empty = 0; ;) {
      const r = call(check);
      if (r.ok === false) return fail(`check 실패: ${r.error?.message}`);
      const got = r.result?.messages ?? [];
      let out = take(got);
      if (!got.length) {
        // Timed out. Mail a stray check took shows only in the inbox listing; mail older than the first wait is not ours.
        const box = call(['orchestration', 'inbox', '--terminal', o.inbox, '--limit', '5', '--full']);
        out = take((box.result?.messages ?? []).filter((m) => Date.parse(m.created_at) >= Date.parse(st.since)));
        empty++;
      }
      if (out.length) st.last = out;
      st.seen = st.seen.slice(-2000);
      deps.write(path, JSON.stringify(st));
      if (out.length || o.once) return { code: 0, out: { messages: out } };
      if (empty >= 3) return { code: 0, out: { messages: [], idle: true } };
    }
  }

  const table = (agent, unit, complexity) => {
    const rules = parseTable(deps.read(TABLE_PATH));
    const row = lookup(rules.rows, agent, unit, { complexity, rules });
    if (!row) throw new Error(`모델 표에 (${agent}, ${unit}) 줄이 없음`);
    return row;
  };

  if (cmd === 'review' || cmd === 'approve') {
    const record = reviewPlan(o, io);
    const routingRules = record.routingVersion === 2 && parseTable(deps.read(TABLE_PATH));
    const prevPath = join(dirname(o.dag), `approved-plan.v${Number(o.version.slice(1)) - 1}.json`);
    const previous = io.optional(prevPath) === null ? {} : loadApproval(prevPath, io).tasks;
    for (const [id, a] of Object.entries(record.tasks)) {
      const project = routingRules && matchRow(routingRules.rows, a.agent, a.unit)?.row;
      if (routingRules && !project) throw new Error(id + ' 모델 표에 역할·작업 단위가 없음');
      if (routingRules && !a.routing) throw new Error(id + ' Task에 v2 라우팅 평가 또는 표의 고정 표시 필요');
      const b = previous[id];
      const same = b && ['agent','unit','runtime','model','effort','overrideReason'].every(k => a[k] === b[k]) &&
        JSON.stringify(a.routing) === JSON.stringify(b.routing);
      if (record.legacyRun || (JSON.stringify(a.bl) === JSON.stringify(b?.bl) && a.complexity === b?.complexity && same)) continue;
      const row = project || table(a.agent, a.unit, a.complexity);
      if (a.routing) {
        const fixed = row.note.startsWith('고정');
        if (fixed !== a.routing.fixed) throw new Error(id + ' 프로젝트 표의 고정 여부와 다름');
        if (a.routing.codexMap) {
          const current = choices(routingRules.codex).codex;
          if (Object.keys(current).length !== Object.keys(a.routing.codexMap).length ||
            Object.keys(current).some(k => current[k] !== a.routing.codexMap[k])) throw new Error(id + ' DAG의 Codex 치환표가 프로젝트와 다름');
        }
        if (!fixed) continue;
      }
      if ((!a.overrideReason || row.note.startsWith('고정')) && ['runtime','model','effort'].some(k => a[k] !== row[k])) throw new Error(`${id} 배정과 모델 표 불일치`);
    }
    if (cmd === 'approve') return { code: 0, out: approvePlan(o, record, io) };
    return { code: 0, out: { version: record.version, review: record.review } };
  }

  // Codex gets the hook's six lines inside the spec (P8). Returns the path of the copy to hand to Orca.
  const specCopy = (specFile, content) => {
    const p = join(mkdtempSync(join(tmpdir(), 'orca-spec-')), basename(specFile));
    writeFileSync(p, content);
    return p;
  };
  // One worker-start and its receipt, for a spec file and for a registered Task alike.
  const start = (use, title, args) => {
    const res = call(['orchestration', ...args, '--full']);
    const r = res.result ?? {};
    const eff = r.launch?.effective ?? {};
    const applied = { model: eff.model ?? null, effort: eff.effort ?? null };
    const terminal = (r.effects ?? []).find((e) => e.kind === 'terminal')?.id ?? null;
    const turnStarted = r.turnStart === 'observed';
    const out = {
      run: r.runId ?? r.run?.id ?? o.run ?? null, task: r.taskId ?? null, dispatch: r.dispatchId ?? null, terminal, title,
      requested: { runtime: use.runtime, model: use.model, effort: use.effort }, applied,
      matched: applied.model === use.model && applied.effort === use.effort, turnStarted,
    };
    if (!r.dispatchId) out.error = res.error?.message ?? 'worker-start 영수증에 dispatch가 없음';
    // Existing worktrees reject creation flags. Rename the observed terminal once, if present.
    if (turnStarted && terminal) call(['terminal', 'rename', '--terminal', terminal, '--title', title]);
    return { code: turnStarted ? 0 : 1, out, res };
  };

  // ---- Tasks registered in Orca. The map file pairs each plan id with its Orca Task. ----
  const loadMap = () => {
    if (!o.map) throw new Error('--map <파일>이 필요함');
    const m = JSON.parse(deps.read(o.map));
    if (m.direct || m.previousDirect) throw new Error('옛 직접 기동 기록이 있는 Run입니다. 새 Run에서 계획을 다시 승인하세요');
    return m;
  };
  const saveMap = (m) => deps.write(o.map, `${JSON.stringify(m, null, 2)}\n`);
  const entry = (m) => { if (!Object.hasOwn(m.tasks, o.id)) throw new Error(`${o.id}가 ${o.map}에 등록되지 않음`); return m.tasks[o.id]; };
  const activeApproval = (m, id) => {
    const path = m.approval ?? m.approvals?.[id];
    if (o.approval && resolve(path ?? '.') !== resolve(o.approval)) throw new Error('현재 Run의 승인 버전과 다름');
    if (!path) return null;
    const record = loadApproval(path, io, o.map);
    if (record.legacyRun && record.legacyRun !== m.run) throw new Error('복원 기록의 Run 불일치');
    if (m.approval && m.review && m.review !== record.review) throw new Error('Run에 기록한 승인 해시와 다름');
    return record;
  };
  const checkedSpec = (spec, id, approved, overrideReason) => {
    if (!approved || /^Task:\s*(\S+)/m.exec(spec)?.[1] !== id) throw new Error(`승인 Task ID와 spec 불일치: ${id}`);
    if (approved.overrideReason !== overrideReason) throw new Error('승인된 사용자 예외 원문과 다름');
    const errors = verifyAssignment({ spec, agent: approved.agent, unit: approved.unit, row: approved, overrideReason });
    if (errors.length) throw new Error('승인 배정 불일치: ' + errors.join(', '));
    // The whole suite runs once at the end, so a Task's own criteria may not contain a command AGENTS.md marks `(전체 테스트)`.
    const lines = spec.split(/\r?\n/);
    const from = lines.findIndex(l => l.startsWith('완료 기준:'));
    if (from < 0) return;
    const to = lines.findIndex((l, i) => i > from && /^(검증 환경값|막히면:|보고:)/.test(l));
    const region = lines.slice(from, to < 0 ? undefined : to).join('\n');
    const hit = fullTests().find(c => wholeCommand(region, c));
    if (hit) throw new Error(`완료 기준에 전체 테스트 명령이 있음: ${hit}`);
  };
  // first backtick span of each `(전체 테스트)` line in AGENTS.md's `## 명령` section
  const fullTests = () => {
    const lines = (io.optional('AGENTS.md') ?? '').split(/\r?\n/);
    const at = lines.findIndex(l => l.trim() === '## 명령');
    if (at < 0) return [];
    const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
    return lines.slice(at + 1, end < 0 ? undefined : end).filter(l => l.includes('(전체 테스트)'))
      .map(l => /`([^`]+)`/.exec(l)?.[1]).filter(Boolean);
  };
  // A fix Task takes only defects the ledger allows; verification after a fix names its defects and diff.
  // row: the launched Task's approved row. Returns a refusal or null.
  const launchRefusal = (m, mapFile, approval, row, spec) => {
    const view = { tasks: Object.fromEntries(Object.entries(approval.tasks).map(([id, r]) =>
      [id, { kind: r.kind, round: r.round, dispatch: m.tasks[id]?.dispatch }])) };
    const post = row?.kind === 'recheck' || (row?.kind === 'verify' && currentRound(view) > 1);
    if (row?.kind !== 'fix' && !post) return null;
    const value = label => new RegExp(`^${label}:(.*)$`, 'm').exec(spec)?.[1].trim() ?? '';
    const defects = csv(value('결함 ID'));
    const ledger = () => {
      let text;
      try { text = deps.read(join(dirname(mapFile), 'ledger.md')); } catch { return null; }
      return readLedger(text);
    };
    if (row.kind === 'fix') {
      if (!defects.length) return '수정 Task의 결함 ID 줄이 없음';
      const l = ledger();
      if (!l) return '장부를 읽을 수 없음';
      const r = fixAllowed(l, defects);
      return r.ok ? null : '수정에 넣을 수 없는 결함: ' + r.refused.map(x => `${x.id}(${x.reason})`).join(', ');
    }
    if (row.afterFix || (defects.length && value('수정 diff'))) return null;
    const l = ledger();
    if (!l) return '장부를 읽을 수 없음';
    const wide = l.decisions.some(d => {
      const c = d.split('|').map(s => s.trim());
      return c[0] === o.id && c[1] === '전 범위 검증 승인' && c[2];
    });
    return wide ? null : '수정 뒤의 검증은 결함 ID와 수정 diff가 필요함';
  };
  const taskId = (m, id) => m.tasks[id]?.orca;
  // The approved spec and runtime stay fixed. Only an explicitly delegated model/effort can change.
  const prepareAttempt = (row, approval, state, spec, source) => {
    const policy = row.routing;
    if (!policy) return null;
    const attempts = state.attempts ??= [];
    const failureDispatches = new Set(attempts.at(-1)?.failureDispatches ?? []);
    const fingerprint = specHash(source);
    let decision = policy.fixed ? 'fixed' : policy.mode;
    let assessment = policy.assessment, reason = '승인 배정 사용';
    if (decision === 'auto') {
      if (!o.assessment) throw new Error('위임된 Task의 최종 지침을 검토하고 --assessment <JSON>을 지정한다');
      const check = JSON.parse(deps.read(o.assessment));
      if (check.id !== o.id || typeof check.reason !== 'string' || !check.reason.trim()) throw new Error('기동 평가의 Task id·검토 근거 확인 필요');
      if (check.review !== approval.review || check.specHash !== fingerprint) throw new Error('기동 평가와 현재 승인 또는 실제 spec의 해시 불일치');
      reason = check.reason;
      decision = 'reuse';
      const ids = check.failureDispatches ?? [];
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('판단·수행 실패 Dispatch ID 중복 또는 형식 오류');
      for (const id of ids) {
        if (!attempts.some(a => a.failed && a.turnStarted && a.dispatch === id)) throw new Error('동일 Task의 실제 기동 후 실패한 Dispatch 확인 필요');
        if (!failureDispatches.has(id) && !check.input) throw new Error('새 실패 판정에 F 점수와 근거 필요');
        failureDispatches.add(id);
      }
      if (check.input != null) {
        if (check.input.scores?.F !== Math.min(2, failureDispatches.size)) throw new Error('F와 확인된 판단·수행 실패 Dispatch 수가 다름');
        if (!isDeepStrictEqual({ ...check.input, ambiguities: check.input.ambiguities ?? [] }, assessment.input)) {
          assessment = assessRouting(check.input, row.runtime, policy.codexMap, deps.classify);
          decision = 'reassess';
        }
      }
    }
    const { runtime, model, effort } = decision === 'reassess' ? assessment : row;
    const attempt = { number: attempts.length + 1, review: approval.review, id: o.id,
      specHash: fingerprint, launchSpecHash: hash(spec), decision, reason, assessment,
      failureDispatches: [...failureDispatches], requested: { runtime, model, effort }, status: 'starting', at: deps.now() };
    attempts.push(attempt);
    return attempt;
  };
  const refused = (out, res) => !out.task && !out.dispatch && !out.terminal &&
    ['invalid_argument', 'invalid_arguments', 'validation_failed', 'task_not_startable', 'run_not_found'].includes(res.error?.code);
  const finishAttempt = (attempt, out, res) => {
    if (!attempt) return;
    if (out.dispatch && !out.matched) out.error = '기동 영수증의 적용 모델·effort가 요청과 다름';
    Object.assign(attempt, { status: out.dispatch ? 'dispatched' : refused(out, res) ? 'rejected' : 'unknown',
      dispatch: out.dispatch, applied: out.applied, matched: out.matched, turnStarted: out.turnStarted, error: out.error });
  };
  // Orca's row for every registered Task, keyed by plan id.
  const statuses = (m, reconcile = false) => {
    const list = call(['orchestration', 'task-list', '--run', m.run, '--full']);
    if (list.ok === false) throw new Error(`task-list 실패: ${list.error?.message}`);
    const byOrca = new Map((list.result?.tasks ?? []).map((t) => [t.id, t]));
    const rows = Object.fromEntries(Object.entries(m.tasks).map(([id, e]) => [id, byOrca.get(e.orca) ?? {}]));
    if (!reconcile) return rows;
    // A successor keeps its immutable Orca spec/ID. After replacement of an input,
    // its original Orca dependency cannot complete. Release it only on the current ID.
    for (const [id, e] of Object.entries(m.tasks)) {
      if (!e.deps.some(d => m.tasks[d]?.previous?.length && !e.registeredDeps?.includes(m.tasks[d].orca))) continue;
      if (e.gate || m.transition?.id === id || !['ready','pending'].includes(rows[id].status)) continue;
      const status = e.deps.every(d => rows[d]?.status === 'completed') ? 'ready' : 'pending';
      if (rows[id].status !== status) {
        if (!setStatus(m, e.orca, status).ok) throw new Error('후속 Task 의존 상태 갱신 실패: ' + id);
        rows[id].status = status;
      }
    }
    return rows;
  };
  const setStatus = (m, orca, status, ...more) => call(['orchestration', 'task-update', '--id', orca, '--status', status, '--run', m.run, ...more]);
  const retryArgs = (m, task) => {
    const last = call(['orchestration', 'dispatch-show', '--task', task]);
    if (!last.result?.dispatch?.id) throw new Error('재시도할 이전 Dispatch 확인 필요');
    if (last.result.dispatch.status === 'failed') return ['--retry-of', last.result.dispatch.id];
    if (!setStatus(m, task, 'ready').ok) throw new Error('재시도 상태 전환 실패');
    return [];
  };

  if (cmd === 'exec-run') {
    if (!o.phase || !o.map) return fail('사용법: exec-run --phase <phase> --map <map>');
    const text = io.optional(o.map);
    if (text !== null) {
      const m = JSON.parse(text);
      if (!m.run || (m.phase && m.phase !== o.phase)) return fail('기존 Run 또는 phase 확인 필요');
      if (m.approval || o.approval) activeApproval(m);
      return { code: 0, out: { run: m.run, approval: m.approval, existing: true } };
    }
    const approval = loadApproval(o.approval, io, o.map);
    if (approval.legacyRun) return fail('구 Run의 복원 기록으로 새 Run을 만들 수 없음');
    // Only a terminal bound to a Run may create, list, update or gate its Tasks, so the coordinator binds its own.
    const created = call(['orchestration', 'run-create', '--objective', `${o.phase} 실행`, '--full']);
    const run = created.result?.run?.id ?? created.result?.runId;
    if (!run) return fail(`run-create 실패: ${created.error?.message ?? 'Run ID 없음'}`);
    saveMap({ run, phase: o.phase, approval: o.approval, review: approval.review, tasks: {} });
    // The front desk overwrites waterfall.json with re-forecasts during the phase; the retro needs the approved plan.
    const plan = join(dirname(o.map), 'waterfall.plan.json');
    let frozen = null;
    try { deps.read(plan); } catch {
      try { deps.write(plan, deps.read(join(dirname(o.map), 'waterfall.json'))); frozen = plan; } catch { /* no waterfall yet: nothing to freeze */ }
    }
    return { code: 0, out: { run, ...(frozen ? { plan: frozen } : {}) } };
  }

  // Orca stores an immutable spec. Its approval marker also identifies a creation
  // whose receipt was lost before the owner could save the new Task ID.
  const markedTask = (m, id, marker) => {
    const list = call(['orchestration', 'task-list', '--run', m.run, '--full']);
    if (!Array.isArray(list.result?.tasks)) throw new Error('task-list 실패: 등록 여부를 확인할 수 없음');
    const matches = list.result.tasks.filter(t => (t.spec ?? '').split(/\r?\n/).includes(marker));
    if (matches.length > 1) throw new Error('같은 승인 Task가 여러 번 등록됨: ' + id);
    return matches[0];
  };
  const registerTask = (m, id, approval, path, reason, edits, resource) => {
    const row = approval.tasks[id];
    const spec = deps.read(path);
    checkedSpec(spec, id, row, reason);
    const missing = row.deps.filter(d => !taskId(m, d));
    if (missing.length) throw new Error('미등록 선행 Task: ' + missing.join(', '));
    const registeredDeps = row.deps.map(d => taskId(m, d));
    const title = /^Task:\s*(.+?)\s*$/m.exec(spec)?.[1] ?? id;
    const marker = '실행 승인: ' + approval.review + ' ' + id;
    let task = markedTask(m, id, marker);
    if (!task) {
      const content = spec.trimEnd() + '\n\n' + marker + '\n';
      const body = row.runtime === 'codex' ? content + '\n' + rules().trimEnd() + '\n' : content;
      const tempDir = mkdtempSync(join(tmpdir(), 'orca-spec-')), specFile = join(tempDir, basename(path));
      writeFileSync(specFile, body);
      let created;
      try {
        created = call(['orchestration', 'task-create', '--spec-file', specFile, '--task-title', title, '--run', m.run,
          ...(registeredDeps.length ? ['--deps', JSON.stringify(registeredDeps)] : []), '--full']);
      } finally { unlinkSync(specFile); rmdirSync(tempDir); }
      task = created.result?.task ?? { id: created.result?.taskId, status: created.result?.status };
      if (!task.id) throw new Error('task-create 실패: ' + (created.error?.message ?? 'Task ID 없음'));
    }
    const entry = { ...row, version: approval.version, review: approval.review, orca: task.id, registeredDeps, title,
      gate: null, dispatch: null, started: null, edits, resource, spec: path };
    return { entry, status: task.status };
  };
  // A project not moved to the flat roster stops here with setup's guidance.
  if (cmd === 'worker' || cmd === 'register') deps.roster();

  if (cmd === 'register') {
    if (!o.map || !o.id || !o['spec-file']) return fail('register --map <map> --id <Task> --spec-file <p>');
    const m = loadMap(), approval = activeApproval(m, o.id);
    if (m.transition?.id === o.id) return fail('전환 기록 확인 필요');
    const old = m.tasks[o.id];
    if (!approval) {
      if (old?.orca) return { code: 0, out: { id: o.id, orca: old.orca, existing: true } };
      return fail('미등록 구 Task의 당시 승인 근거가 필요함');
    }
    const row = approval.tasks[o.id], reason = o['override-reason'] ?? null;
    checkedSpec(deps.read(o['spec-file']), o.id, row, reason);
    if (o.deps !== undefined && JSON.stringify(csv(o.deps).sort()) !== JSON.stringify(row.deps)) return fail('승인 DAG 의존과 다름');
    if (old) return { code: 0, out: { id: o.id, orca: old.orca, existing: true } };
    const result = registerTask(m, o.id, approval, o['spec-file'], reason, csv(o.edits), csv(o.resource));
    m.tasks[o.id] = result.entry;
    saveMap(m);
    // A Task registered after its inputs finished is made ready here; Orca's own readiness at creation is not measured.
    // The status comes from Orca's listing, not the create receipt, which may not carry one.
    let status = result.status;
    if (row.deps.length) {
      const st = statuses(m);
      status = st[o.id]?.status ?? status;
      if (status === 'pending' && row.deps.every(d => st[d]?.status === 'completed') && setStatus(m, result.entry.orca, 'ready').ok !== false) status = 'ready';
    }
    return { code: 0, out: { id: o.id, orca: result.entry.orca, status, version: approval.version } };
  }

  if (cmd === 'reapprove') {
    if (!o.map || !o.approval || !o.id) return fail('reapprove --map <map> --approval <새 승인파일> --id <변경 Task>');
    const m = loadMap(), next = loadApproval(o.approval, io, o.map);
    if (next.legacyRun && next.legacyRun !== m.run) return fail('복원 기록이 가리키는 Run이 다름');
    const previousPath = m.approval ?? m.approvals?.[o.id];
    const previous = previousPath && loadApproval(previousPath, io, o.map);
    const row = next.tasks[o.id], old = m.tasks[o.id];
    if (!row) return fail('미기동 승인 Task만 전환한다');
    if (m.transition && (m.transition.id !== o.id || m.transition.approval !== o.approval)) return fail('먼저 진행 중인 재승인을 마친다');
    if (m.approval && m.review && previous.review !== m.review) return fail('Run에 기록한 이전 승인 해시와 다름');
    if (previous?.review === next.review) return { code: 0, out: { id: o.id, version: next.version, existing: true } };
    if (previous && Number(next.version.slice(1)) <= Number(previous.version.slice(1))) return fail('재승인에는 새 버전이 필요함');
    if (m.approval) {
      const all = new Set([...Object.keys(previous.tasks), ...Object.keys(next.tasks)]);
      for (const id of all) if (id !== o.id && JSON.stringify(previous.tasks[id]) !== JSON.stringify(next.tasks[id])) return fail('다른 Task 배정·의존 변경: ' + id);
    }
    if (old) {
      if (old.dispatch || old.started || old.attempts?.some(a => a.status !== 'rejected')) return fail('이미 기동했거나 기동 확인 중인 Task');
      const st = statuses(m)[o.id];
      if (!['ready','pending','blocked'].includes(st.status) && !(m.transition && st.status === 'failed')) return fail('미기동 Task 상태 확인 필요');
      checkedSpec(deps.read(old.spec), o.id, row, row.overrideReason);
      if (row.deps.some(id => !taskId(m, id))) return fail('새 선행 Task 등록이 먼저 필요함');
      if (!m.transition) {
        m.transition = { id: o.id, approval: o.approval, from: old.orca };
        saveMap(m);
      }
      if (old.gate || st.status === 'blocked') return fail('기존 게이트를 실제 응답으로 resolve한 뒤 같은 재승인 명령을 재개한다');
      if (st.status !== 'failed') {
        const retired = setStatus(m, old.orca, 'failed', '--result', 'superseded: ' + next.version + ' ' + o.id);
        if (retired.ok !== true) return fail('이전 Task를 비활성화하지 못함');
      }
      const replacement = registerTask(m, o.id, next, old.spec, row.overrideReason, old.edits ?? [], old.resource ?? []);
      m.tasks[o.id] = { ...replacement.entry, previous: [...(old.previous ?? []), {
        orca: old.orca, deps: old.deps, registeredDeps: old.registeredDeps, version: old.version, review: old.review,
        gates: old.gates ?? [], agent: old.agent, unit: old.unit, runtime: old.runtime, model: old.model, effort: old.effort,
        ...(old.attempts ? { attempts: old.attempts } : {}),
      }] };
      delete m.transition;
    }
    if (m.approval) { m.approval = o.approval; m.review = next.review; }
    else (m.approvals ??= {})[o.id] = o.approval;
    saveMap(m);
    return { code: 0, out: { id: o.id, version: next.version, previous: old?.orca, orca: m.tasks[o.id]?.orca } };
  }

  if (cmd === 'worker' && o.map) {
    if (!o.id || !o.bracket || !o.does) return fail('사용법: worker --map <map> --id <T01> --bracket <b> --does <d> [--retry]');
    let m, e;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    if (e.skipped || e.skipping) return fail(`${o.id}는 건너뛴 Task — 띄우지 않음`);
    const approval = activeApproval(m, o.id);
    if (m.transition?.id === o.id || e.gate) return fail('재승인 전환 또는 게이트 응답 대기');
    const lastAttempt = e.attempts?.at(-1);
    if (lastAttempt && ['starting','unknown'].includes(lastAttempt.status)) {
      const last = call(['orchestration', 'dispatch-show', '--task', e.orca]).result?.dispatch;
      if (last?.id && last.id !== e.dispatch) {
        Object.assign(lastAttempt, { status: 'dispatched', dispatch: last.id });
        e.dispatch = last.id;
        saveMap(m);
      }
      return fail('이전 기동 영수증 확인 필요', { id: o.id, dispatch: last?.id ?? null });
    }
    if (e.dispatch && !o.retry) return fail('기존 Dispatch 확인: ' + e.dispatch);
    let approved, st;
    if (approval) {
      approved = approval.tasks[o.id];
      if (!approved || ['agent','unit','runtime','model','effort'].some(k => approved[k] !== e[k]) ||
        JSON.stringify(approved.routing) !== JSON.stringify(e.routing)) return fail('등록값과 승인 배정 불일치');
      st = statuses(m, true);
      const unmet = e.deps.filter(d => st[d]?.status !== 'completed' || m.transition?.id === d);
      if (unmet.length) return fail('pending: 완료되지 않은 의존 Task', { unmet });
    }
    if (o.retry && (st ?? statuses(m))[o.id]?.status !== 'failed') return fail('실패로 정산된 Task만 재시도한다');
    if (approved?.routing && !o.retry && st[o.id]?.status !== 'ready') return fail('ready Task만 기동한다');
    const refusal = approved && launchRefusal(m, o.map, approval, approved,st[o.id]?.spec ?? '');
    if (refusal) return fail(refusal);
    const previous = e.attempts?.findLast(a => a.dispatch && a.dispatch === e.dispatch);
    if (o.retry && previous?.turnStarted) previous.failed = true;
    const attempt = approved?.routing && prepareAttempt(approved, approval, e, st[o.id].spec, authoredSpec(st[o.id].spec, e.review, o.id));
    const use = attempt?.requested ?? e;
    const title = tabTitle({ bracket: o.bracket, agent: e.agent, model: use.model, effort: use.effort, does: o.does });
    const args = workerStartArgs({ row: use, run: m.run, task: e.orca, displayName: title, worktree });
    if (attempt) saveMap(m);
    if (o.retry) {
      // measured: --retry-of takes only a failed attempt; an attempt the worker reported as a success is reopened instead
      try { args.push(...retryArgs(m, e.orca)); } catch (err) {
        if (attempt) { attempt.status = 'rejected'; saveMap(m); }
        return fail(err.message);
      }
    }
    const { code, out, res } = start(use, title, args);
    finishAttempt(attempt, out, res);
    if (out.dispatch) { e.dispatch = out.dispatch; e.started = deps.now(); }
    if (out.dispatch || attempt) saveMap(m);
    if (res.error) {
      // Orca starts only a ready Task (dependencies done, no pending gate). The status is never forced from here.
      const planId = Object.fromEntries(Object.entries(m.tasks).map(([id, t]) => [t.orca, id]));
      return fail(`기동 거부: ${res.error.message}`, { id: o.id, code: res.error.code, unmet: (res.error.data?.unmetDependencies ?? []).map((x) => planId[x] ?? x) });
    }
    return { code: attempt && !out.matched ? 1 : code, out: { id: o.id, version: approval?.version ?? e.version, ...out, ...(attempt ? { routing: attempt } : {}) } };
  }

  if (cmd === 'ready') {
    let m, st;
    try { m = loadMap(); st = statuses(m, true); } catch (e) { return fail(e.message); }
    const status = Object.fromEntries(Object.entries(st).map(([id, t]) => [id, t.status ?? null]));
    return { code: 0, out: { run: m.run, ready: Object.keys(m.tasks).filter((id) => status[id] === 'ready' && m.transition?.id !== id), status } };
  }

  // Orca cannot change a registered Task's dependencies, so the real inputs go into the map (what fail and resolve read)
  // and the Task is made ready here, only when every real input is completed.
  if (cmd === 'pull') {
    if (!o.id || o.deps === undefined || !o.reason) return fail('사용법: pull --map <map> --id <T01> --deps <실제 입력 Task,…> --reason <이유>');
    let m, e, st;
    try { m = loadMap(); e = entry(m); st = statuses(m); } catch (err) { return fail(err.message); }
    const depIds = csv(o.deps);
    const missing = depIds.filter((d) => !taskId(m, d));
    if (missing.length) return fail(`의존 ${missing.join(', ')}가 등록되지 않음`);
    if (e.gate) return fail(`${o.id}에 게이트가 걸려 있음 — resolve가 먼저다`);
    if (st[o.id].status !== 'pending') return fail(`${o.id}는 ${st[o.id].status} — 대기(pending) 중인 Task만 당긴다`);
    const waitingOn = depIds.filter((d) => st[d].status !== 'completed');
    if (waitingOn.length) return fail('실제 입력이 아직 끝나지 않음 — 바꾸지 않음', { id: o.id, waitingOn });
    const done = setStatus(m, e.orca, 'ready');
    if (done.ok === false) return fail(`task-update 실패: ${done.error?.message}`);
    e.pulled = { from: e.deps, reason: o.reason, at: deps.now() };
    e.deps = depIds;
    saveMap(m);
    return { code: 0, out: { id: o.id, status: 'ready', deps: depIds, was: e.pulled.from } };
  }

  // What can start now: ready Tasks, in registration order, that fit the free slots and share no edited path
  // (a directory edit covers files under it) and no resource with a running or already-picked Task.
  if (cmd === 'launchable') {
    let m, st;
    try { m = loadMap(); st = statuses(m, true); } catch (e) { return fail(e.message); }
    const slots = Number(o.slots ?? 8);
    if (!Number.isInteger(slots) || slots < 1) return fail('--slots는 1 이상의 정수');
    const running = Object.keys(m.tasks).filter((id) => st[id].status === 'dispatched');
    const busy = [...running];
    const launch = [], held = [];
    const overlap = (a, b) => a.startsWith(b) || b.startsWith(a);
    for (const id of Object.keys(m.tasks).filter((x) => st[x].status === 'ready' && m.transition?.id !== x && !m.tasks[x].skipping)) {
      const e = m.tasks[id];
      let reason = null;
      for (const other of busy) {
        const x = m.tasks[other];
        const path = (e.edits ?? []).find((p) => (x.edits ?? []).some((q) => overlap(p, q)));
        if (path) { reason = `edits overlap ${other} (${path})`; break; }
        const res = (e.resource ?? []).find((r) => (x.resource ?? []).includes(r));
        if (res) { reason = `resource ${res} taken by ${other}`; break; }
      }
      if (!reason && running.length + launch.length >= slots) reason = 'no free slot';
      if (reason) held.push({ id, reason }); else { launch.push(id); busy.push(id); }
    }
    // Waiting Tasks with what they still wait on and what their spec reads: the coordinator pulls one when it reads none of those.
    const reads = (file) => {
      let text; try { text = deps.read(file); } catch { return null; }
      const block = /^먼저 읽을 것:[ \t]*\r?\n((?:-.*(?:\r?\n|$))*)/m.exec(text)?.[1] ?? '';
      return block.split(/\r?\n/).filter((l) => l.startsWith('-')).map((l) => l.replace(/^-\s*/, '').trim());
    };
    const candidates = Object.keys(m.tasks).filter((id) => st[id].status === 'pending' && !m.tasks[id].gate && !m.tasks[id].skipping).map((id) => ({
      id, waitingOn: m.tasks[id].deps.filter((d) => st[d].status !== 'completed'), reads: m.tasks[id].spec ? reads(m.tasks[id].spec) : null }));
    return { code: 0, out: { run: m.run, running: running.length, free: slots - running.length, launch, held, candidates } };
  }

  const failTask = (m, e, cause) => {
    const done = setStatus(m, e.orca, 'failed', '--result', cause);
    if (done.ok === false) throw new Error(`task-update 실패: ${done.error?.message}`);
    const st = statuses(m);
    // measured: Orca makes dependents ready on the worker's own report and does not take that back when the Task fails later
    const dependents = Object.keys(m.tasks).filter((id) => m.tasks[id].deps.includes(o.id));
    const demoted = dependents.filter((id) => st[id].status === 'ready');
    for (const id of demoted) setStatus(m, m.tasks[id].orca, 'pending');
    return { demoted, alreadyStarted: dependents.filter((id) => ['dispatched', 'completed'].includes(st[id].status)) };
  };

  if (cmd === 'fail') {
    if (!o.id || !o.cause) return fail('사용법: fail --map <map> --id <T01> --cause <원인>');
    try { const m = loadMap(); return { code: 0, out: { id: o.id, ...failTask(m, entry(m), o.cause) } }; } catch (err) { return fail(err.message); }
  }

  // One worker_done settled in one command: the four checks, the fail-and-rebind on a miss, the defect rows, the tree snapshot.
  if (cmd === 'settle') {
    if (!o.id || !o.dispatch || !o.report || !o.ledger) return fail('사용법: settle --map <map> --id <T01> --dispatch <worker_done의 dispatchId> --report <리포트> --ledger <ledger.md> [--expect <산출물,…>] [--outcome failed] [--round-cap <N>]');
    let m, e;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    // a report from another Dispatch (an earlier attempt, a resend) settles nothing and fails nothing
    if (o.dispatch !== e.dispatch) return fail('기대한 Dispatch가 아님 — 정산하지 않음', { id: o.id, expected: e.dispatch });
    let verdict;
    try { verdict = judge(o.report, csv(o.expect), o['round-cap'] ? { roundCap: Number(o['round-cap']) } : {}, { read: deps.read, exists: deps.exists }); }
    catch { verdict = { ok: false, checked: 0, failed: [`❌ 리포트를 읽을 수 없음: ${o.report}`], notes: [] }; }
    if (o.outcome === 'failed') verdict = { ...verdict, ok: false, failed: ['❌ 워커가 실패로 보고함', ...verdict.failed] };
    if (!verdict.ok) {
      const cause = verdict.failed[0] ?? verdict.error ?? '검증 줄에 ✅가 없음';
      try { return { code: 1, out: { id: o.id, ok: false, cause, failed: verdict.failed, notes: verdict.notes, ...failTask(m, e, cause) } }; }
      catch (err) { return fail(err.message); }
    }
    const ledger = deps.read(o.ledger);
    const defects = parseDefects(deps.read(o.report));
    const before = new Map(readLedger(ledger).defects.map((d) => [d.id, d.source]));
    const tree = deps.snapshot();
    deps.write(o.ledger, addSnapshot(addDefects(ledger, { source: o.id, round: currentRound(m), defects }), o.id, tree));
    return { code: 0, out: { id: o.id, ok: true, checked: verdict.checked, notes: verdict.notes, tree,
      defects: { added: defects.map((d) => d.id).filter((id) => !before.has(id)), existing: defects.filter((d) => before.has(d.id)).map((d) => ({ id: d.id, source: before.get(d.id) })) } } };
  }

  // Closes a planned Task that has nothing to do, so the Tasks behind it can start. Every refusal comes before any Orca change.
  if (cmd === 'skip') {
    if (!o.id || !o.reason?.trim()) return fail('사용법: skip --map <map> --id <T01> --reason <사유>');
    let m, approval, st;
    try { m = loadMap(); approval = activeApproval(m, o.id); } catch (err) { return fail(err.message); }
    const row = approval?.tasks[o.id];
    if (!row || !(row.conditional === true || ['fix', 'recheck'].includes(row.kind))) return fail(`${o.id}는 건너뛸 수 있는 Task가 아님`);
    let e = m.tasks[o.id];
    // An already skipped Task is not touched again; only the promotion below reruns, to repair dependents left pending.
    const existing = !!e?.skipped;
    if (!existing) {
      const started = `${o.id}는 이미 기동했거나 끝난 Task`;
      if (m.transition?.id === o.id) return fail(started);
      const inputs = e?.deps ?? row.deps;
      const missing = inputs.filter(d => !taskId(m, d));
      if (missing.length) return fail('미등록 선행 Task: ' + missing.join(', '));
      try { st = statuses(m); } catch (err) { return fail(err.message); }
      // Closing ahead of its inputs would release the Tasks behind it early.
      const unfinished = inputs.filter(d => st[d]?.status !== 'completed');
      if (unfinished.length) return fail('선행 Task가 끝나지 않음: ' + unfinished.join(', '));
      // closed: an earlier run's close landed in Orca but was not recorded; only the recording is left
      let closed = false;
      if (e) {
        if (e.dispatch || e.started || e.gate || e.attempts?.some(a => a.status !== 'rejected')) return fail(started);
        closed = !!e.skipping && st[o.id].status === 'completed';
        if (!closed && !['pending', 'ready'].includes(st[o.id].status)) return fail(started);
      } else {
        const registeredDeps = row.deps.map(d => taskId(m, d));
        const title = `${o.id} 건너뜀`, marker = `실행 승인: ${approval.review} ${o.id}`;
        let orca;
        try { orca = markedTask(m, o.id, marker)?.id; } catch (err) { return fail(err.message); }
        if (!orca) {
          const tempDir = mkdtempSync(join(tmpdir(), 'orca-spec-')), specFile = join(tempDir, `${o.id}.md`);
          writeFileSync(specFile, `Task: ${title}\n건너뜀: ${o.reason}\n\n${marker}\n`);
          let created;
          try {
            created = call(['orchestration', 'task-create', '--spec-file', specFile, '--task-title', title, '--run', m.run,
              ...(registeredDeps.length ? ['--deps', JSON.stringify(registeredDeps)] : []), '--full']);
          } finally { unlinkSync(specFile); rmdirSync(tempDir); }
          orca = created.result?.task?.id ?? created.result?.taskId;
          if (!orca) return fail('task-create 실패: ' + (created.error?.message ?? 'Task ID 없음'));
        }
        e = m.tasks[o.id] = { ...row, version: approval.version, review: approval.review, orca, registeredDeps, title,
          gate: null, dispatch: null, started: null, edits: [], resource: [], spec: null };
      }
      // Saved before closing: a re-run finishes a close whose reply was lost, and nothing launches the Task meanwhile.
      e.skipping ??= { reason: o.reason };
      saveMap(m);
      if (!closed) {
        const done = setStatus(m, e.orca, 'completed', '--result', '건너뜀: ' + e.skipping.reason);
        if (done.ok === false) return fail(`task-update 실패: ${done.error?.message}`);
      }
      e.skipped = { reason: e.skipping.reason, at: deps.now() };
      delete e.skipping;
      saveMap(m);
    }
    try { st = statuses(m); } catch (err) { return fail(err.message); }
    // Orca's promotion on a manual status change is not relied on: dependents whose inputs are all completed are made ready here
    const promoted = Object.keys(m.tasks).filter((id) => m.tasks[id].deps.includes(o.id) && st[id].status === 'pending' &&
      !m.tasks[id].gate && m.transition?.id !== id && m.tasks[id].deps.every((d) => st[d]?.status === 'completed'))
      .filter((id) => setStatus(m, m.tasks[id].orca, 'ready').ok !== false);
    return { code: 0, out: { id: o.id, skipped: true, ...(existing ? { existing: true } : {}), promoted } };
  }

  if (cmd === 'gate') {
    if (!o.id || !o.question) return fail('사용법: gate --map <map> --id <T01> --question <질문>');
    let m, e;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    const g = call(['orchestration', 'gate-create', '--task', e.orca, '--question', o.question, '--full']);
    const gate = g.result?.gate?.id ?? g.result?.gateId;
    if (!gate) return fail(`gate-create 실패: ${g.error?.message ?? 'gate ID 없음'}`);
    e.gate = gate;
    e.gateQuestion = o.question;
    saveMap(m);
    return { code: 0, out: { id: o.id, gate } };
  }

  if (cmd === 'resolve') {
    if (!o.id || !o.resolution) return fail('사용법: resolve --map <map> --id <T01> --resolution <답>');
    let m, e, st;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    if (!e.gate) return fail(`${o.id}에 걸린 게이트가 없음`);
    const g = call(['orchestration', 'gate-resolve', '--id', e.gate, '--resolution', o.resolution]);
    if (g.ok === false) return fail(`gate-resolve 실패: ${g.error?.message}`);
    (e.gates ??= []).push({ id: e.gate, orca: e.orca, question: e.gateQuestion, resolution: o.resolution });
    e.gate = null;
    delete e.gateQuestion;
    saveMap(m);
    try { st = statuses(m); } catch (err) { return fail(err.message); }
    // measured: resolving makes the Task ready even when a dependency is unfinished, and a ready Task starts
    const waitingOn = e.deps.filter((d) => st[d].status !== 'completed');
    if (waitingOn.length) setStatus(m, e.orca, 'pending');
    return { code: 0, out: { id: o.id, status: waitingOn.length ? 'pending' : st[o.id].status ?? null, waitingOn } };
  }

  if (cmd === 'actual') {
    let m, st;
    try { m = loadMap(); st = statuses(m); } catch (e) { return fail(e.message); }
    // start is this script's launch time, end is Orca's; a Task that has not settled is left out
    const rows = Object.entries(m.tasks)
      .filter(([id, e]) => e.started && ['completed', 'failed'].includes(st[id].status) && st[id].completed_at)
      .map(([id, e]) => ({ id, start: e.started, end: new Date(st[id].completed_at).toISOString(), status: st[id].status }));
    return { code: 0, out: rows };
  }

  if (cmd === 'worker') {
    if (!o.agent || !o.unit || !o['spec-file'] || !o.bracket || !o.does) {
      return fail('사용법: worker --agent <a> --unit <u> --spec-file <p> --bracket <b> --does <d> [--run <id>] [--task <id>] [--override-reason <원문>]');
    }
    const spec = deps.read(o['spec-file']);
    const overrideReason = o['override-reason'] ?? null;
    if (o.approval || o.id || /^실행 승인:/m.test(spec) || findPhaseMap(o['spec-file'], io)) return fail('실행 Run에서는 register한 Task를 worker --map --id로 띄운다');
    const row = table(o.agent, o.unit, o.complexity);
    const errors = verifyAssignment({ spec, agent: o.agent, unit: o.unit, row, overrideReason });
    if (errors.length) return fail('배정 불일치 — 띄우지 않음', { errors });
    const a = parseAssignLine(spec);
    const use = overrideReason ? { ...row, runtime: a.runtime, model: a.model, effort: a.effort } : row;
    let specFile = o['spec-file'];
    let content = spec;
    if (use.runtime === 'codex') {
      if (o.task) console.error('경고: Codex 워커 — Task spec에 작업 방식 여섯 줄이 들어 있어야 한다(codex-rules)');
      else content = content.trimEnd() + '\n\n' + rules().trimEnd() + '\n';
    }
    if (content !== spec) specFile = specCopy(specFile, content);
    const title = tabTitle({ bracket: o.bracket, agent: o.agent, model: use.model, effort: use.effort, does: o.does });
    const args = workerStartArgs({ row: use, specFile, run: o.run, task: o.task, displayName: title, worktree });
    const { code, out } = start(use, title, args);
    return { code, out };
  }

  if (cmd === 'coordinator') {
    if (!o.phase || !o['spec-file'] || !o.does) return fail('사용법: coordinator --phase <phase> --spec-file <p> --does <요청> [--backlog BL-0001,BL-0002]');
    let approved;
    if (o.approval || o.plan || o.dag || o.version) {
      approved = loadApproval(o.approval, io, o.dag);
      if (approved.legacyRun || approved.review !== reviewPlan(o, io).review) return fail('현재 계획·DAG와 실행 승인 버전이 다름');
    } else {
      const phase = join('_workspace', '_run', o.phase);
      if (io.optional(join(phase, 'dag.json')) !== null || io.optional(join(phase, 'approved-plan.v1.json')) !== null) {
        const legacy = JSON.parse(io.optional(join(phase, 'orca-tasks.json')) ?? 'null');
        if (!legacy?.run || legacy.approval) return fail('실행 계획의 --approval --version --plan --dag가 필요함');
      }
    }
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
    const base = { run, task: null, dispatch: null, terminal, title, requested: { runtime: row.runtime, model: row.model, effort: row.effort }, applied: null, matched: false, turnStarted: false,
      ...(approved ? { version: approved.version, review: approved.review, approval: o.approval } : {}) };
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

  return fail('사용법: orca-launch.mjs review|approve|reapprove|assessment-context|worker|coordinator|snapshot|codex-rules|wait|exec-run|register|ready|launchable|pull|fail|settle|skip|gate|resolve|actual ...');
}

const opts = { encoding: 'utf8', maxBuffer: 64 << 20 };
function findPhaseMap(path, io) {
  const match = /^((?:.*[\\/])?_workspace)[\\/][^\\/]+[\\/]([^\\/]+)[\\/]/.exec(path);
  return match && io.optional(join(match[1], '_run', match[2], 'orca-tasks.json')) !== null;
}
function writeJson(path, text, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, text, { flag: 'wx' });
  try { if (exclusive) linkSync(temp, path); else renameSync(temp, path); }
  finally { try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
// Run the hook as the Orca preamble would trigger it; its additionalContext is the single source of the six lines.
function hookLines() {
  const r = spawnSync(process.execPath, [HOOK_PATH], { ...opts, input: JSON.stringify({ prompt: 'You are a dispatched worker' }) });
  return JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext ?? '';
}
const deps = {
  orca: (args) => spawnSync('orca', args, opts),
  read: (p) => readFileSync(p, 'utf8').replace(/^﻿/, ''),
  run: (cmd, args) => spawnSync(cmd, args, opts).stdout ?? '',
  write: writeJson,
  exists: existsSync,
  snapshot: () => takeTree(defaultGit),
  roster: () => readRoster(),
  create: (p, text) => writeJson(p, text, true),
  lock: async p => {
    mkdirSync(dirname(p), { recursive: true });
    const lock = p + '.lock';
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        writeFileSync(lock, String(process.pid), { flag: 'wx' });
        return () => unlinkSync(lock);
      } catch (e) {
        if (e.code !== 'EEXIST' || Date.now() >= deadline) throw e;
        await new Promise(done => setTimeout(done, 100));
      }
    }
  },
  now: () => new Date().toISOString(),
};

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // Every path here is relative to the project root, and the current folder is what Orca gets as the worker's worktree.
  // A shell that wandered into a subfolder would start workers there, so anywhere but the root is refused.
  const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const here = realpathSync(process.cwd());
  const same = process.platform === 'win32' ? here.toLowerCase() === root.toLowerCase() : here === root;
  const { code, out } = same ? await main(process.argv.slice(2), deps)
    : fail(`저장소 루트에서 돌린다 — 지금 폴더는 ${here}, 루트는 ${root}`);
  console.log(typeof out === 'string' ? out : JSON.stringify(out));
  process.exitCode = code;
}
