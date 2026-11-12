// Worker/coordinator launch: checks the spec's assignment against the model table, then starts via Orca.
//   node .claude/scripts/orca-launch.mjs worker --agent <a> --unit <u> --spec-file <p> --bracket <BL-0012|phase> --does <하는 일> [--run <id>] [--task <id>] [--lead] [--override-reason <원문>]
//   node .claude/scripts/orca-launch.mjs coordinator --phase <phase> --spec-file <p> --does <요청> [--backlog BL-0001,BL-0002]
//   node .claude/scripts/orca-launch.mjs snapshot --run <id>
//   node .claude/scripts/orca-launch.mjs codex-rules   (prints the six worker lines for a Codex Task spec)
// Tasks registered in Orca (the coordinator's execution Run; <map> is _workspace/_run/<phase>/orca-tasks.json):
//   node .claude/scripts/orca-launch.mjs exec-run --phase <phase> --map <map>
//   node .claude/scripts/orca-launch.mjs register --map <map> --id <T01> --spec-file <p> [--deps T01,T02] [--lead] [--override-reason <원문>] [--edits <경로,…>] [--resource <gpu,blender,…>]
//   node .claude/scripts/orca-launch.mjs worker --map <map> --id <T01> --bracket <b> --does <d> [--retry]
//   node .claude/scripts/orca-launch.mjs ready --map <map>
//   node .claude/scripts/orca-launch.mjs launchable --map <map> [--slots 8]   (register takes --edits <paths,> --resource <gpu,blender>)
//   node .claude/scripts/orca-launch.mjs pull --map <map> --id <T01> --deps <실제 입력 Task,…> --reason <이유>
//   node .claude/scripts/orca-launch.mjs unhandled --map <map>   (messages to this map's workers that they have not taken)
//   node .claude/scripts/orca-launch.mjs reply --map <map> --id <message id> --body <답> [--verify-ms 25000]   (answer, then report handled)
//   node .claude/scripts/orca-launch.mjs fail --map <map> --id <T01> --cause <원인>
//   node .claude/scripts/orca-launch.mjs gate --map <map> --id <T01> --question <질문>
//   node .claude/scripts/orca-launch.mjs resolve --map <map> --id <T01> --resolution <답>
//   node .claude/scripts/orca-launch.mjs actual --map <map>
// stdout: one JSON receipt. Never stops or relaunches a worker whose turn start was not observed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
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
    'map', 'id', 'deps', 'cause', 'question', 'resolution', 'edits', 'resource', 'slots', 'reason', 'body', 'verify-ms'].map((k) => [k, { type: 'string' }]),
  ['lead', { type: 'boolean' }],
  ['retry', { type: 'boolean' }],
]);
const fail = (error, extra = {}) => ({ code: 1, out: { error, ...extra } });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// phase name or backlog ID as a whole token of the objective (`phase-a` must not match `phase-ab`)
const csv = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
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

  // Codex gets the hook's six lines inside the spec (P8). Returns the path of the copy to hand to Orca.
  const withRules = (specFile, spec) => {
    const p = join(mkdtempSync(join(tmpdir(), 'orca-spec-')), basename(specFile));
    writeFileSync(p, `${spec.trimEnd()}\n\n${rules().trimEnd()}\n`);
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
      run: o.run ?? r.runId ?? r.run?.id ?? null, task: r.taskId ?? null, dispatch: r.dispatchId ?? null, terminal, title,
      requested: { runtime: use.runtime, model: use.model, effort: use.effort }, applied,
      matched: applied.model === use.model && applied.effort === use.effort, turnStarted,
    };
    if (!r.dispatchId) out.error = res.error?.message ?? 'worker-start 영수증에 dispatch가 없음';
    // P10: --display-name is not the tab title; rename once, right after start. A rename failure never fails the start.
    if (turnStarted && terminal) call(['terminal', 'rename', '--terminal', terminal, '--title', title]);
    return { code: turnStarted ? 0 : 1, out, res };
  };

  // ---- Tasks registered in Orca. The map file pairs each plan id with its Orca Task. ----
  const loadMap = () => { if (!o.map) throw new Error('--map <파일>이 필요함'); return JSON.parse(deps.read(o.map)); };
  const saveMap = (m) => deps.write(o.map, `${JSON.stringify(m, null, 2)}\n`);
  const entry = (m) => { const e = m.tasks[o.id]; if (!e) throw new Error(`${o.id}가 ${o.map}에 등록되지 않음`); return e; };
  // Orca's row for every registered Task, keyed by plan id.
  const statuses = (m) => {
    const list = call(['orchestration', 'task-list', '--run', m.run, '--full']);
    if (list.ok === false) throw new Error(`task-list 실패: ${list.error?.message}`);
    const byOrca = new Map((list.result?.tasks ?? []).map((t) => [t.id, t]));
    return Object.fromEntries(Object.entries(m.tasks).map(([id, e]) => [id, byOrca.get(e.orca) ?? {}]));
  };
  // measured: a started worker whose turn start was not observed stays `blocked` in Orca while it works.
  // A Task blocked by a gate was never started, so it is not running.
  const runningIds = (m, st) => Object.keys(m.tasks).filter((id) =>
    st[id].status === 'dispatched' || (st[id].status === 'blocked' && m.tasks[id].started && !m.tasks[id].gate));
  const setStatus = (m, orca, status, ...more) => call(['orchestration', 'task-update', '--id', orca, '--status', status, '--run', m.run, ...more]);

  if (cmd === 'exec-run') {
    if (!o.phase || !o.map) return fail('사용법: exec-run --phase <phase> --map <map>');
    let text = null;
    try { text = deps.read(o.map); } catch { /* first call: no map yet */ }
    if (text !== null) {
      try { const m = JSON.parse(text); if (m.run) return { code: 0, out: { run: m.run, existing: true } }; } catch { return fail(`${o.map}을 해석하지 못함 — 새 Run을 만들지 않음`); }
    }
    // Only a terminal bound to a Run may create, list, update or gate its Tasks, so the coordinator binds its own.
    const created = call(['orchestration', 'run-create', '--objective', `${o.phase} 실행`, '--full']);
    const run = created.result?.run?.id ?? created.result?.runId;
    if (!run) return fail(`run-create 실패: ${created.error?.message ?? 'Run ID 없음'}`);
    saveMap({ run, tasks: {} });
    // The front desk overwrites waterfall.json with re-forecasts during the phase; the retro needs the approved plan.
    const plan = join(dirname(o.map), 'waterfall.plan.json');
    let frozen = null;
    try { deps.read(plan); } catch {
      try { deps.write(plan, deps.read(join(dirname(o.map), 'waterfall.json'))); frozen = plan; } catch { /* no waterfall yet: nothing to freeze */ }
    }
    return { code: 0, out: { run, ...(frozen ? { plan: frozen } : {}) } };
  }

  if (cmd === 'register') {
    if (!o.map || !o.id || !o['spec-file']) return fail('사용법: register --map <map> --id <T01> --spec-file <p> [--deps T01,T02] [--lead] [--override-reason <원문>] [--edits <경로,…>] [--resource <gpu,blender,…>]');
    let m, spec, row;
    try { m = loadMap(); } catch (e) { return fail(`${o.map}을 읽지 못함 — exec-run을 먼저 돌린다 (${e.message})`); }
    if (m.tasks[o.id]) return { code: 0, out: { id: o.id, orca: m.tasks[o.id].orca, existing: true } };
    try { spec = deps.read(o['spec-file']); } catch (e) { return fail(e.message); }
    const a = parseAssignLine(spec);
    if (!a) return fail('spec에 `배정:` 줄이 없음 — 등록하지 않음');
    const unit = o.lead ? '리드' : a.unit;
    try { row = table(a.agent, unit); } catch (e) { return fail(e.message); }
    const overrideReason = o['override-reason'] ?? null;
    const errors = verifyAssignment({ spec, agent: a.agent, unit, row, overrideReason, lead: !!o.lead });
    if (errors.length) return fail('배정 불일치 — 등록하지 않음', { errors });
    const depIds = (o.deps ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const missing = depIds.filter((d) => !m.tasks[d]);
    if (missing.length) return fail(`의존 ${missing.join(', ')}가 등록되지 않음 — 의존 순서대로 등록한다`);
    const use = overrideReason ? { ...row, runtime: a.runtime, model: a.model, effort: a.effort } : row;
    let specFile = o['spec-file'];
    if (use.runtime === 'codex') { try { specFile = withRules(specFile, spec); } catch (e) { return fail(e.message); } }
    const title = /^Task:\s*(.+?)\s*$/m.exec(spec)?.[1] ?? o.id;
    const created = call(['orchestration', 'task-create', '--spec-file', specFile, '--task-title', title, '--run', m.run,
      ...(depIds.length ? ['--deps', JSON.stringify(depIds.map((d) => m.tasks[d].orca))] : []), '--full']);
    const t = created.result?.task ?? {};
    const orca = t.id ?? created.result?.taskId;
    if (!orca) return fail(`task-create 실패: ${created.error?.message ?? 'Task ID 없음'}`);
    m.tasks[o.id] = { orca, deps: depIds, title, agent: a.agent, unit, runtime: use.runtime, model: use.model, effort: use.effort ?? null, lead: !!o.lead, gate: null, dispatch: null, started: null, registered: deps.now(),
      edits: csv(o.edits), resource: csv(o.resource) };
    saveMap(m);
    return { code: 0, out: { id: o.id, orca, status: t.status ?? created.result?.status ?? null } };
  }

  if (cmd === 'worker' && o.map) {
    if (!o.id || !o.bracket || !o.does) return fail('사용법: worker --map <map> --id <T01> --bracket <b> --does <d> [--retry]');
    let m, e;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    const title = tabTitle({ bracket: o.bracket, agent: e.agent, model: e.model, effort: e.effort, does: o.does });
    const args = workerStartArgs({ row: e, run: m.run, task: e.orca, displayName: title, worktree });
    if (o.retry) {
      // measured: --retry-of takes only a failed attempt; an attempt the worker reported as a success is reopened instead
      const last = call(['orchestration', 'dispatch-show', '--task', e.orca]).result?.dispatch;
      if (last?.status === 'failed') args.push('--retry-of', last.id);
      else setStatus(m, e.orca, 'ready');
    }
    const { code, out, res } = start(e, title, args);
    if (res.error) {
      // Orca starts only a ready Task (dependencies done, no pending gate). The status is never forced from here.
      const planId = Object.fromEntries(Object.entries(m.tasks).map(([id, t]) => [t.orca, id]));
      return fail(`기동 거부: ${res.error.message}`, { id: o.id, code: res.error.code, unmet: (res.error.data?.unmetDependencies ?? []).map((x) => planId[x] ?? x) });
    }
    if (out.dispatch) { e.dispatch = out.dispatch; e.started = deps.now(); saveMap(m); }
    return { code, out: { id: o.id, ...out } };
  }

  if (cmd === 'ready') {
    let m, st;
    try { m = loadMap(); st = statuses(m); } catch (e) { return fail(e.message); }
    const status = Object.fromEntries(Object.entries(st).map(([id, t]) => [id, t.status ?? null]));
    return { code: 0, out: { run: m.run, ready: Object.keys(status).filter((id) => status[id] === 'ready'), running: runningIds(m, st), status } };
  }

  // Orca cannot change a registered Task's dependencies, so the real inputs go into the map (what fail and resolve read)
  // and the Task is made ready here, only when every real input is completed.
  if (cmd === 'pull') {
    if (!o.id || o.deps === undefined || !o.reason) return fail('사용법: pull --map <map> --id <T01> --deps <실제 입력 Task,…> --reason <이유>');
    let m, e, st;
    try { m = loadMap(); e = entry(m); st = statuses(m); } catch (err) { return fail(err.message); }
    const depIds = csv(o.deps);
    const missing = depIds.filter((d) => !m.tasks[d]);
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

  // A reply or send the worker has not taken. Right after sending this is normal (a working worker takes it when its
  // turn ends); still listed at the next wake, the worker may not have woken — look at its screen.
  // Answer a worker's question, then check in the same call that the answer was taken.
  // measured 2026-11-12: a reply landing seconds after the worker ended its turn was typed into its input but not submitted
  // (77 min idle). Waiting here costs no extra model call; `handled: false` means look at the worker's screen.
  if (cmd === 'reply') {
    if (!o.map || !o.id || !o.body) return fail('사용법: reply --map <map> --id <message id> --body <답> [--verify-ms 25000]');
    const ms = Number(o['verify-ms'] ?? 25000);
    if (!Number.isInteger(ms) || ms < 0) return fail('--verify-ms는 0 이상의 정수');
    let m;
    try { m = loadMap(); } catch (e) { return fail(e.message); }
    const sent = call(['orchestration', 'reply', '--id', o.id, '--body', o.body]);
    const reply = sent.result?.messageId;
    if (sent.ok === false || !reply) return fail(`reply 실패: ${sent.error?.message ?? 'messageId 없음'}`);
    await (deps.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))))(ms);
    const box = call(['orchestration', 'inbox', '--limit', '200']);
    const row = (box.result?.messages ?? []).find((x) => x.id === reply);
    const byDispatch = Object.fromEntries(Object.entries(m.tasks).filter(([, e]) => e.dispatch).map(([id, e]) => [`dispatch:${e.dispatch}`, id]));
    return { code: 0, out: { reply, task: row ? byDispatch[row.to] ?? null : null, handled: row ? row.handled : null } };
  }

  if (cmd === 'unhandled') {
    let m;
    try { m = loadMap(); } catch (e) { return fail(e.message); }
    // shortcut: the newest 200 messages across recipients; an older unhandled message is not seen
    const box = call(['orchestration', 'inbox', '--limit', '200']);
    if (box.ok === false) return fail(`inbox 실패: ${box.error?.message}`);
    const byDispatch = Object.fromEntries(Object.entries(m.tasks).filter(([, e]) => e.dispatch).map(([id, e]) => [`dispatch:${e.dispatch}`, id]));
    const unhandled = (box.result?.messages ?? []).filter((x) => x.handled === false && byDispatch[x.to])
      .map((x) => ({ id: byDispatch[x.to], message: x.id, subject: x.subject ?? null }));
    return { code: 0, out: { run: m.run, unhandled } };
  }

  // What can start now: ready Tasks, in registration order, that fit the free slots and share no edited path
  // (a directory edit covers files under it) and no resource with a running or already-picked Task.
  if (cmd === 'launchable') {
    let m, st;
    try { m = loadMap(); st = statuses(m); } catch (e) { return fail(e.message); }
    const slots = Number(o.slots ?? 8);
    if (!Number.isInteger(slots) || slots < 1) return fail('--slots는 1 이상의 정수');
    const running = runningIds(m, st);
    const busy = [...running];
    const launch = [], held = [];
    const overlap = (a, b) => a.startsWith(b) || b.startsWith(a);
    for (const id of Object.keys(m.tasks).filter((x) => st[x].status === 'ready')) {
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
    return { code: 0, out: { run: m.run, running: running.length, free: slots - running.length, launch, held } };
  }

  if (cmd === 'fail') {
    if (!o.id || !o.cause) return fail('사용법: fail --map <map> --id <T01> --cause <원인>');
    let m, e, st;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    const done = setStatus(m, e.orca, 'failed', '--result', o.cause);
    if (done.ok === false) return fail(`task-update 실패: ${done.error?.message}`);
    try { st = statuses(m); } catch (err) { return fail(err.message); }
    // measured: Orca makes dependents ready on the worker's own report and does not take that back when the Task fails later
    const dependents = Object.keys(m.tasks).filter((id) => m.tasks[id].deps.includes(o.id));
    const demoted = dependents.filter((id) => st[id].status === 'ready');
    for (const id of demoted) setStatus(m, m.tasks[id].orca, 'pending');
    return { code: 0, out: { id: o.id, demoted, alreadyStarted: dependents.filter((id) => ['dispatched', 'completed'].includes(st[id].status)) } };
  }

  if (cmd === 'gate') {
    if (!o.id || !o.question) return fail('사용법: gate --map <map> --id <T01> --question <질문>');
    let m, e;
    try { m = loadMap(); e = entry(m); } catch (err) { return fail(err.message); }
    const g = call(['orchestration', 'gate-create', '--task', e.orca, '--question', o.question, '--full']);
    const gate = g.result?.gate?.id ?? g.result?.gateId;
    if (!gate) return fail(`gate-create 실패: ${g.error?.message ?? 'gate ID 없음'}`);
    e.gate = gate;
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
    e.gate = null;
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
      .map(([id, e]) => ({ id, ...(e.registered ? { registered: e.registered } : {}), start: e.started, end: new Date(st[id].completed_at).toISOString(), status: st[id].status }));
    return { code: 0, out: rows };
  }

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
      else { try { specFile = withRules(specFile, spec); } catch (e) { return fail(e.message); } }
    }
    const title = tabTitle({ bracket: o.bracket, agent: o.agent, model: use.model, effort: use.effort, does: o.does });
    const { code, out } = start(use, title, workerStartArgs({ row: use, specFile, run: o.run, task: o.task, displayName: title, worktree }));
    return { code, out };
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

  return fail('사용법: orca-launch.mjs worker|coordinator|snapshot|codex-rules|exec-run|register|ready|launchable|pull|unhandled|reply|fail|gate|resolve|actual ...');
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
  write: (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); },
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
