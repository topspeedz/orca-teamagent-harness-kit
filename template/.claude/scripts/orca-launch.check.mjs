// Self-test for orca-launch.mjs — no Orca needed. `node .claude/scripts/orca-launch.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { tabTitle, parseAssignLine, parseOverrideLine, verifyAssignment, workerStartArgs, coordinatorCommand, main } from './orca-launch.mjs';
import { TABLE_PATH } from './model-selection.mjs';
import { SETTINGS_PATH, KEEP_PATH } from './coordinator-settings.mjs';

let passed = 0;
const t = (fn) => { fn(); passed++; };

const row = { line: 15, agent: 'qa-inspector', units: ['흐름 검증'], runtime: 'claude', model: 'opus', effort: 'medium', note: '', matched: 'exact' };
const spec = (assign, ...more) => ['[역할: qa-inspector]', 'Task: 흐름 검증', assign, ...more].join('\n');
const ok = spec('배정: qa-inspector / 흐름 검증 (claude opus/medium)');
const verify = (p) => verifyAssignment({ spec: ok, agent: 'qa-inspector', unit: '흐름 검증', row, overrideReason: null, lead: false, ...p });

// 1. tab title
t(() => assert.equal(
  tabTitle({ bracket: 'BL-0012', agent: 'qa-inspector', model: 'opus', effort: 'medium', does: '결제 흐름 검증' }),
  '[BL-0012] qa-inspector : opus/medium - 결제 흐름 검증'));

// 2. tab title without effort
t(() => assert.equal(
  tabTitle({ bracket: 'BL-0012', agent: 'qa-inspector', model: 'haiku', effort: null, does: '결제 흐름 검증' }),
  '[BL-0012] qa-inspector : haiku - 결제 흐름 검증'));

// 3. assign line: five values, unit with spaces, no-effort form, missing line
t(() => {
  assert.deepEqual(parseAssignLine('배정: qa-inspector / 재검 (claude sonnet/medium)'),
    { agent: 'qa-inspector', unit: '재검', runtime: 'claude', model: 'sonnet', effort: 'medium' });
  assert.deepEqual(parseAssignLine('x\n배정: code-reviewer / 보안·돈이 걸린 변경 리뷰 (claude opus/high)\ny'),
    { agent: 'code-reviewer', unit: '보안·돈이 걸린 변경 리뷰', runtime: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(parseAssignLine('배정: planner / 설계 (claude haiku)'),
    { agent: 'planner', unit: '설계', runtime: 'claude', model: 'haiku', effort: null });
  assert.equal(parseAssignLine('no assignment here'), null);
});

// 4. assignment equal to the table → pass
t(() => assert.deepEqual(verify({}), []));

// 5. effort differs from the table → one reason carrying both values
t(() => {
  const r = verify({ spec: spec('배정: qa-inspector / 흐름 검증 (claude opus/high)') });
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /opus\/high/);
  assert.match(r[0], /opus\/medium/);
});

// 6. override: only one side → fail; both → spec values win
t(() => {
  const s = spec('배정: qa-inspector / 흐름 검증 (claude opus/high)', '사용자 예외: 이번만 high로 띄워줘');
  assert.equal(parseOverrideLine(s), '이번만 high로 띄워줘');
  assert.equal(parseOverrideLine(ok), null);
  assert.ok(verify({ spec: s }).length > 0);
  assert.ok(verify({ overrideReason: '이번만 high로 띄워줘' }).length > 0);
  assert.deepEqual(verify({ spec: s, overrideReason: '이번만 high로 띄워줘' }), []);
});

// 7. lead needs the lead role line
t(() => {
  const lead = { unit: '리드', lead: true, row: { ...row, agent: '*', units: ['리드'] } };
  assert.ok(verify({ ...lead, spec: spec('배정: qa-inspector / 리드 (claude opus/medium)') }).length > 0);
  const good = '[역할: qa-inspector · 리드]\n배정: qa-inspector / 리드 (claude opus/medium)';
  assert.deepEqual(verify({ ...lead, spec: good }), []);
});

// 8. no assignment line → fail
t(() => assert.ok(verify({ spec: '[역할: qa-inspector]\nTask: 흐름 검증' }).length > 0));

// 9. worker-start args: spec path is one element, model/effort from the table, no effort when null
t(() => {
  const specFile = 'D:/내 프로젝트/_workspace/qa/spec/a b.md';
  const a = workerStartArgs({ row, specFile, displayName: 'x', worktree: 'current' });
  assert.ok(a.includes(specFile));
  assert.equal(a[a.indexOf('--model') + 1], 'opus');
  assert.equal(a[a.indexOf('--effort') + 1], 'medium');
  assert.equal(a[a.indexOf('--agent') + 1], 'claude');
  const b = workerStartArgs({ row: { ...row, model: 'haiku', effort: null }, specFile, run: 'run_1', displayName: 'x', worktree: 'current' });
  assert.ok(!b.includes('--effort'));
  assert.equal(b[b.indexOf('--run') + 1], 'run_1');
});

// ---- Orca-calling part (fake orca; no real Orca) ----
const ta = async (fn) => { await fn(); passed++; };
const TABLE = [
  '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `coordinator` | 실행 감독 | claude | opus | high | |',
  '| `qa-inspector` | 흐름 검증 | claude | opus | medium | |',
  '| `code-reviewer` | 리뷰 | codex | gpt-6.1-sol | high | |',
  '| `*` | 리드 | claude | sonnet | high | |',
  '| `*` | 기본 | claude | sonnet | medium | |',
].join('\n');
const keep = { permissionMode: 'default', plugins: { 'p@p': 'keep' }, skills: { coordinator: 'keep' } };
const files = (over = {}) => ({
  [TABLE_PATH]: TABLE, [SETTINGS_PATH]: '{}', [KEEP_PATH]: JSON.stringify(keep),
  'qa.md': ok, 'lead.md': '[역할: qa-inspector · 리드]\n배정: qa-inspector / 리드 (claude sonnet/high)', 'coord.md': '[역할: coordinator]',
  'codex.md': '[역할: code-reviewer]\nTask: 리뷰\n배정: code-reviewer / 리뷰 (codex gpt-6.1-sol/high)', ...over,
});
const inventory = (skills) => () => JSON.stringify({ type: 'system', subtype: 'init', plugins: [{ source: 'p@p' }], skills });
const val = (a, f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const RULES = '[워커 작업 방식 — 가짜]\n①\n②\n③\n④\n⑤\n⑥';
function fake({ runs = [], fileOver = {}, skills = ['coordinator'], hookLines = () => RULES, turnStart = 'observed', blockedReason = null } = {}) {
  const calls = [];
  const replies = {
    'orchestration run-list': () => ({ ok: true, result: { runs } }),
    'orchestration run-create': () => ({ ok: true, result: { run: { id: 'run_new' } } }),
    'terminal create': () => ({ ok: true, result: { terminal: { handle: 'term_c' } } }),
    'terminal wait': () => ({ ok: true, result: { wait: blockedReason ? { satisfied: false, blockedReason } : { satisfied: true } } }),
    'orchestration worker-start': (a) => ({ ok: true, result: { taskId: 'task_1', dispatchId: 'ctx_1', runId: val(a, '--run') ?? 'run_1', state: 'ready', turnStart,
      launch: { effective: { model: val(a, '--model') ?? null, effort: val(a, '--effort') ?? null } }, effects: [{ kind: 'terminal', role: 'agent', id: 'term_w' }] } }),
    'terminal rename': () => ({ ok: true, result: {} }),
    'orchestration check': () => ({ ok: true, result: { messages: [] } }),
    'orchestration worker-list': () => ({ ok: true, result: { workers: [] } }),
  };
  const fs = files(fileOver);
  const deps = {
    orca: (args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(replies[args.slice(0, 2).join(' ')](args)), stderr: '' }; },
    read: (p) => { if (fs[p] === undefined) throw new Error(`ENOENT ${p}`); return fs[p]; },
    run: inventory(skills),
    hookLines,
  };
  return { calls, deps, names: () => calls.map((a) => (a[0] === 'orchestration' ? a[1] : a.slice(0, 2).join(' '))) };
}
const workerArgv = ['worker', '--agent', 'qa-inspector', '--unit', '흐름 검증', '--spec-file', 'qa.md', '--bracket', 'BL-0012', '--does', '결제 흐름 검증'];
const coordArgv = ['coordinator', '--phase', 'phase-a', '--spec-file', 'coord.md', '--does', '결제 개선', '--backlog', 'BL-0001,BL-0002'];
async function captureStderr(fn) {
  const orig = console.error;
  let err = '';
  console.error = (...a) => { err += a.join(' ') + '\n'; };
  try { return { result: await fn(), err }; } finally { console.error = orig; }
}

// 10. worker: assignment differs from the table → code 1, orca never called
await ta(async () => {
  const f = fake({ fileOver: { 'qa.md': spec('배정: qa-inspector / 흐름 검증 (claude opus/high)') } });
  const { code } = await main(workerArgv, f.deps);
  assert.equal(code, 1);
  assert.equal(f.calls.length, 0);
});

// 11. worker ok → worker-start carries table model/effort; receipt title = tabTitle
await ta(async () => {
  const f = fake();
  const { code, out } = await main(workerArgv, f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  assert.equal(val(ws, '--model'), 'opus');
  assert.equal(val(ws, '--effort'), 'medium');
  assert.equal(out.title, tabTitle({ bracket: 'BL-0012', agent: 'qa-inspector', model: 'opus', effort: 'medium', does: '결제 흐름 검증' }));
  assert.deepEqual(out.requested, { runtime: 'claude', model: 'opus', effort: 'medium' });
  assert.deepEqual(out.applied, { model: 'opus', effort: 'medium' });
  assert.equal(out.matched, true);
  assert.equal(out.turnStarted, true);
  assert.deepEqual([out.task, out.dispatch, out.terminal], ['task_1', 'ctx_1', 'term_w']);
  const rn = f.calls.find((a) => a[0] === 'terminal' && a[1] === 'rename');
  assert.equal(val(rn, '--terminal'), 'term_w');
  assert.equal(val(rn, '--title'), out.title);
});

// 12. worker --lead → looks up (*, 리드)
await ta(async () => {
  const f = fake();
  const argv = ['worker', '--agent', 'qa-inspector', '--spec-file', 'lead.md', '--bracket', 'phase-a', '--does', '검증 팀 리드', '--lead'];
  const { code, out } = await main(argv, f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  assert.deepEqual([val(ws, '--model'), val(ws, '--effort')], ['sonnet', 'high']);
});

// 13. coordinator: run-list already has the phase → code 1, no run-create
await ta(async () => {
  const f = fake({ runs: [{ id: 'run_old', objective: 'phase-a [BL-0012]' }] });
  const { code } = await main(coordArgv, f.deps);
  assert.equal(code, 1);
  assert.ok(!f.names().includes('run-create'));
  const g = fake({ runs: [{ id: 'run_old', objective: 'other [BL-0002]' }] });
  assert.equal((await main(coordArgv, g.deps)).code, 1);
});

// 14. coordinator ok → run-list, run-create, terminal create, worker-start in order
await ta(async () => {
  const f = fake({ runs: [{ id: 'run_x', objective: 'phase-ab [BL-0012]' }] });
  const { code, out } = await main(coordArgv, f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const order = f.names().filter((n) => ['run-list', 'run-create', 'terminal create', 'worker-start'].includes(n));
  assert.deepEqual(order, ['run-list', 'run-create', 'terminal create', 'worker-start']);
  assert.equal(val(f.calls.find((a) => a[1] === 'run-create'), '--objective'), 'phase-a [BL-0001, BL-0002]');
  const cmd = val(f.calls.find((a) => a[0] === 'terminal' && a[1] === 'create'), '--command');
  assert.equal(cmd, coordinatorCommand({ model: 'opus', effort: 'high', settingsPath: SETTINGS_PATH, permissionMode: 'default' }));
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  assert.deepEqual([val(ws, '--run'), val(ws, '--terminal')], ['run_new', 'term_c']);
  assert.deepEqual(out.applied, { model: 'opus', effort: 'high' });
  assert.equal(out.run, 'run_new');
});

// 15. settings file missing → code 1, hint names `coordinator-settings.mjs generate`
await ta(async () => {
  const f = fake({ fileOver: { [SETTINGS_PATH]: undefined } });
  const { code, out } = await main(coordArgv, f.deps);
  assert.equal(code, 1);
  assert.match(JSON.stringify(out), /coordinator-settings\.mjs generate/);
  assert.equal(f.calls.length, 0);
});

// 16. one unclassified skill → stderr warning, launch still completes
await ta(async () => {
  const f = fake({ skills: ['coordinator', 'new-skill'] });
  const { result, err } = await captureStderr(() => main(coordArgv, f.deps));
  assert.match(err, /분류되지 않은 항목 1개/);
  assert.equal(result.code, 0);
  assert.ok(f.names().includes('worker-start'));
});

// 17. snapshot → check has --peek and no --ack; worker-list has --run and --full
await ta(async () => {
  const f = fake();
  const { code } = await main(['snapshot', '--run', 'run_1'], f.deps);
  assert.equal(code, 0);
  const ck = f.calls.find((a) => a[1] === 'check');
  assert.ok(ck.includes('--peek') && !ck.includes('--ack'));
  const wl = f.calls.find((a) => a[1] === 'worker-list');
  assert.equal(val(wl, '--run'), 'run_1');
  assert.ok(wl.includes('--full'));
  assert.equal(f.calls.length, 2);
});

// 18. coordinatorCommand quotes a settings path with spaces
await ta(async () => {
  const c = coordinatorCommand({ model: 'opus', effort: null, settingsPath: 'D:/내 프로젝트/.claude/s.json', permissionMode: 'default' });
  assert.ok(c.includes('"D:/내 프로젝트/.claude/s.json"'), c);
  assert.ok(!c.includes('--effort'), c);
});

const codexArgv = ['worker', '--agent', 'code-reviewer', '--unit', '리뷰', '--spec-file', 'codex.md', '--bracket', 'BL-0012', '--does', '리뷰'];

// 19. codex row + --spec-file → a temp spec: original spec, blank line, then the six lines
await ta(async () => {
  const f = fake();
  const { code, out } = await main(codexArgv, f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  const p = val(ws, '--spec-file');
  assert.notEqual(p, 'codex.md');
  const body = readFileSync(p, 'utf8');
  assert.ok(body.startsWith(files()['codex.md'] + '\n\n'), body);
  assert.ok(body.trimEnd().endsWith(RULES), body);
});

// 20. claude row + --spec-file → the original path as is
await ta(async () => {
  const f = fake({ hookLines: () => { throw new Error('claude must not run the hook'); } });
  const { code } = await main(workerArgv, f.deps);
  assert.equal(code, 0);
  assert.equal(val(f.calls.find((a) => a[1] === 'worker-start'), '--spec-file'), 'qa.md');
});

// 20b. a worker whose turn did not start is checked for a blocking screen (e.g. Codex asking to trust hooks);
//      the script never answers it: the receipt says so and the coordinator asks the front desk
await ta(async () => {
  const f = fake({ turnStart: 'unobserved', blockedReason: 'hook-trust' });
  const { code, out } = await main(codexArgv, f.deps);
  assert.equal(code, 1);
  assert.equal(out.turnStarted, false);
  assert.equal(out.blocked, 'hook-trust');
  assert.match(out.next, /누르지 않/);
  assert.equal(val(f.calls.find((x) => x[0] === 'terminal' && x[1] === 'wait'), '--terminal'), 'term_w');
  assert.ok(!f.calls.some((x) => x[0] === 'terminal' && x[1] === 'send'), 'never answers the screen');
  const g = fake();
  await main(codexArgv, g.deps);
  assert.ok(!g.calls.some((x) => x[0] === 'terminal' && x[1] === 'wait'), 'a started turn is not checked');
});

// 21. codex-rules → the six lines, code 0
await ta(async () => {
  const f = fake();
  const { code, out } = await main(['codex-rules'], f.deps);
  assert.equal(code, 0);
  assert.equal(out, RULES);
  assert.equal(f.calls.length, 0);
});

// 22. codex row + --task → stderr names codex-rules, launch still completes
await ta(async () => {
  const f = fake();
  const { result, err } = await captureStderr(() => main([...codexArgv, '--task', 'task_9'], f.deps));
  assert.match(err, /codex-rules/);
  assert.equal(result.code, 0, JSON.stringify(result.out));
  assert.equal(val(f.calls.find((a) => a[1] === 'worker-start'), '--task'), 'task_9');
});

// 23. hook gives nothing → code 1, orca never called
await ta(async () => {
  const f = fake({ hookLines: () => '' });
  const { code } = await main(codexArgv, f.deps);
  assert.equal(code, 1);
  assert.equal(f.calls.length, 0);
});

// ---- R1 A-4: values that go into the launch line are checked before any Orca call ----
// 24. permissionMode outside the three modes → code 1, orca never called
await ta(async () => {
  const f = fake({ fileOver: { [KEEP_PATH]: JSON.stringify({ ...keep, permissionMode: 'x; rm' }) } });
  const { code, out } = await main(coordArgv, f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /permissionMode/);
  assert.equal(f.calls.length, 0);
});

// 25. model with shell syntax → code 1, orca never called
await ta(async () => {
  const f = fake({ fileOver: { [TABLE_PATH]: TABLE.replace('claude | opus | high', 'claude | opus$(id) | high') } });
  const { code, out } = await main(coordArgv, f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /model/);
  assert.equal(f.calls.length, 0);
});

// 26. `opus[x]` sits inside quotes in the launch line, so the shell does not read it as a glob
await ta(async () => {
  const f = fake({ fileOver: { [TABLE_PATH]: TABLE.replace('claude | opus | high', 'claude | opus[x] | high') } });
  await main(coordArgv, f.deps);
  const cmd = val(f.calls.find((a) => a[0] === 'terminal' && a[1] === 'create'), '--command');
  assert.ok(cmd.includes('--model "opus[x]" '), cmd);
});

// 27. coordinatorCommand refuses a bad effort and a path with `"`, `$` or a backtick
await ta(async () => {
  const base = { model: 'opus', effort: 'high', settingsPath: SETTINGS_PATH, permissionMode: 'default' };
  assert.throws(() => coordinatorCommand({ ...base, effort: 'high; id' }), /effort/);
  for (const settingsPath of ['a"b.json', 'a$(id).json', 'a`id`.json']) assert.throws(() => coordinatorCommand({ ...base, settingsPath }), /경로/, settingsPath);
  for (const permissionMode of ['acceptEdits', 'bypassPermissions']) assert.ok(coordinatorCommand({ ...base, permissionMode }).includes(`--permission-mode ${permissionMode} `));
});

// ---- Tasks registered in Orca (fake orca that keeps Task state the way Orca 1.4.255 was measured to) ----
const T0 = new Date(Date.UTC(2000, 0, 1)).toISOString();
const T10 = new Date(Date.UTC(2000, 0, 1, 0, 10)).toISOString();
function fakeDag({ fileOver = {}, dispatchStatus = 'completed' } = {}) {
  const calls = [];
  const tasks = new Map(); // Orca id → { status, deps }
  const gates = new Map();
  let n = 0;
  const inbox = [];
  const box = {}; // the fake returned to the test; tests set box.replyHandled / box.replyRefused on it
  const fs = files({
    'a.md': '[역할: qa-inspector]\nTask: T01 로그인 흐름\n배정: qa-inspector / 흐름 검증 (claude opus/medium)',
    'b.md': '[역할: qa-inspector]\nTask: T02 결제 흐름\n배정: qa-inspector / 흐름 검증 (claude opus/medium)',
    ...fileOver,
  });
  const refuse = (code, message, data = {}) => ({ ok: false, error: { code, message, data } });
  const replies = {
    'orchestration run-create': () => ({ ok: true, result: { run: { id: 'run_exec' } } }),
    'orchestration task-create': (a) => {
      const id = `task_${++n}`;
      const deps = JSON.parse(val(a, '--deps') ?? '[]');
      tasks.set(id, { status: deps.length ? 'pending' : 'ready', deps });
      return { ok: true, result: { task: { id, status: tasks.get(id).status } } };
    },
    'orchestration task-list': () => ({ ok: true, result: { tasks: [...tasks].map(([id, t]) => (
      { id, status: t.status, deps: JSON.stringify(t.deps), completed_at: ['completed', 'failed'].includes(t.status) ? T10 : null })) } }),
    'orchestration task-update': (a) => { tasks.get(val(a, '--id')).status = val(a, '--status'); return { ok: true, result: { taskId: val(a, '--id'), status: val(a, '--status') } }; },
    'orchestration gate-create': (a) => { tasks.get(val(a, '--task')).status = 'blocked'; gates.set('gate_1', val(a, '--task')); return { ok: true, result: { gate: { id: 'gate_1', status: 'pending' } } }; },
    // measured: resolving sets the Task ready even when a dependency is unfinished
    'orchestration gate-resolve': (a) => { tasks.get(gates.get(val(a, '--id'))).status = 'ready'; return { ok: true, result: { gate: { id: val(a, '--id'), status: 'resolved' } } }; },
    'orchestration dispatch-show': () => ({ ok: true, result: { dispatch: { id: 'ctx_old', status: dispatchStatus } } }),
    // measured: only a ready Task starts; --retry-of restarts a failed one
    'orchestration worker-start': (a) => {
      const t = tasks.get(val(a, '--task'));
      const retry = a.includes('--retry-of') && t.status === 'failed';
      if (t.status !== 'ready' && !retry) return refuse('task_not_startable', `Task ${val(a, '--task')} is ${t.status}; only a ready Task can start.`, { unmetDependencies: t.deps.filter((d) => tasks.get(d).status !== 'completed') });
      t.status = 'dispatched';
      return { ok: true, result: { taskId: val(a, '--task'), dispatchId: 'ctx_new', runId: val(a, '--run'), turnStart: 'observed',
        launch: { effective: { model: val(a, '--model') ?? null, effort: val(a, '--effort') ?? null } }, effects: [{ kind: 'terminal', id: 'term_w' }] } };
    },
    'terminal rename': () => ({ ok: true, result: {} }),
    'orchestration inbox': () => ({ ok: true, result: { messages: inbox } }),
    'orchestration reply': () => {
      if (box.replyRefused) return refuse('message_not_found', 'no such message');
      const id = `msg_r${inbox.length + 1}`; // Orca gives every reply its own message id
      inbox.push({ id, type: 'status', subject: 'Re: Question', to: 'dispatch:ctx_new', handled: box.replyHandled });
      return { ok: true, result: { messageId: id } };
    },
  };
  const deps = {
    orca: (args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(replies[args.slice(0, 2).join(' ')](args)), stderr: '' }; },
    read: (p) => { if (fs[p] === undefined) throw new Error(`ENOENT ${p}`); return fs[p]; },
    write: (p, text) => { fs[p] = text; },
    now: () => T0,
    run: inventory(['coordinator']),
    hookLines: () => RULES,
  };
  const count = (name) => calls.filter((a) => a[1] === name).length;
  return Object.assign(box, { calls, deps, tasks, fs, inbox, count, map: () => JSON.parse(fs['m.json']), call: (name) => calls.findLast((a) => a[1] === name) });
}
const M = ['--map', 'm.json'];
const reg = (id, spec, ...more) => ['register', ...M, '--id', id, '--spec-file', spec, ...more];
const go = (id, ...more) => ['worker', ...M, '--id', id, '--bracket', 'BL-0012', '--does', '흐름 검증', ...more];
async function registered(opts) {
  const f = fakeDag(opts);
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  await main(reg('T01', 'a.md'), f.deps);
  await main(reg('T02', 'b.md', '--deps', 'T01'), f.deps);
  return f;
}

// 28. exec-run creates the execution Run once and keeps it in the map
await ta(async () => {
  const f = fakeDag();
  const a = await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  assert.equal(a.code, 0, JSON.stringify(a.out));
  assert.equal(a.out.run, 'run_exec');
  assert.equal(f.map().run, 'run_exec');
  assert.match(val(f.call('run-create'), '--objective'), /^phase-a /);
  const b = await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  assert.equal(b.out.run, 'run_exec');
  assert.equal(f.count('run-create'), 1);
});

// 29. register needs exec-run first; then one task-create in that Run, titled from the spec's Task line; the same id twice makes one Task
await ta(async () => {
  const f = fakeDag();
  assert.equal((await main(reg('T01', 'a.md'), f.deps)).code, 1);
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  const { code, out } = await main(reg('T01', 'a.md'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const c = f.call('task-create');
  assert.equal(val(c, '--run'), 'run_exec');
  assert.equal(val(c, '--task-title'), 'T01 로그인 흐름');
  assert.equal(val(c, '--spec-file'), 'a.md');
  assert.equal(f.map().tasks.T01.orca, out.orca);
  assert.equal(f.map().tasks.T01.model, 'opus');
  await main(reg('T01', 'a.md'), f.deps);
  assert.equal(f.count('task-create'), 1);
});

// 30. register: an assignment that differs from the table → code 1, nothing created
await ta(async () => {
  const f = fakeDag({ fileOver: { 'a.md': '[역할: qa-inspector]\nTask: T01 x\n배정: qa-inspector / 흐름 검증 (claude opus/high)' } });
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  const { code, out } = await main(reg('T01', 'a.md'), f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /배정/);
  assert.equal(f.count('task-create'), 0);
});

// 31. register with deps: plan ids become Orca ids; a dependency that is not registered yet → code 1
await ta(async () => {
  const f = fakeDag();
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  assert.equal((await main(reg('T02', 'b.md', '--deps', 'T01'), f.deps)).code, 1);
  await main(reg('T01', 'a.md'), f.deps);
  const { code, out } = await main(reg('T02', 'b.md', '--deps', 'T01'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(JSON.parse(val(f.call('task-create'), '--deps')), [f.map().tasks.T01.orca]);
  assert.deepEqual(f.map().tasks.T02.deps, ['T01']);
  assert.equal(out.status, 'pending');
});

// 32. register a codex row: the six lines are appended to the spec Orca stores
await ta(async () => {
  const f = fakeDag();
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  const { code } = await main(reg('T09', 'codex.md'), f.deps);
  assert.equal(code, 0);
  const p = val(f.call('task-create'), '--spec-file');
  assert.notEqual(p, 'codex.md');
  assert.ok(readFileSync(p, 'utf8').endsWith(`${RULES}\n`));
});

// 33. worker by plan id: starts the registered Task in the execution Run with the registered model, records dispatch and start time
await ta(async () => {
  const f = await registered();
  const { code, out } = await main(go('T01'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const c = f.call('worker-start');
  assert.equal(val(c, '--task'), f.map().tasks.T01.orca);
  assert.equal(val(c, '--run'), 'run_exec');
  assert.equal(val(c, '--model'), 'opus');
  assert.ok(!c.includes('--spec-file'));
  assert.equal(out.title, '[BL-0012] qa-inspector : opus/medium - 흐름 검증');
  assert.equal(f.map().tasks.T01.dispatch, 'ctx_new');
  assert.equal(f.map().tasks.T01.started, T0);
});

// 34. worker by plan id on a Task Orca will not start → code 1 with Orca's reason and the unmet plan ids; the status is never forced
await ta(async () => {
  const f = await registered();
  const { code, out } = await main(go('T02'), f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /pending/);
  assert.deepEqual(out.unmet, ['T01']);
  assert.equal(f.count('task-update'), 0);
  assert.equal(f.map().tasks.T02.dispatch, null);
});

// 35. ready: only this map's Tasks, in registration order, with every status
await ta(async () => {
  const f = await registered();
  f.tasks.set('task_other', { status: 'ready', deps: [] });
  const { code, out } = await main(['ready', ...M], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out.ready, ['T01']);
  assert.deepEqual(out.status, { T01: 'ready', T02: 'pending' });
});

// 36. fail: the Task goes back to failed with the cause, and dependents Orca already made ready go back to pending
await ta(async () => {
  const f = await registered();
  const { T01, T02 } = f.map().tasks;
  f.tasks.get(T01.orca).status = 'completed';
  f.tasks.get(T02.orca).status = 'ready';
  const { code, out } = await main(['fail', ...M, '--id', 'T01', '--cause', 'report-check 실패'], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.equal(f.tasks.get(T01.orca).status, 'failed');
  assert.equal(f.tasks.get(T02.orca).status, 'pending');
  assert.deepEqual(out.demoted, ['T02']);
  assert.equal(val(f.calls.find((a) => a[1] === 'task-update' && val(a, '--id') === T01.orca), '--result'), 'report-check 실패');
});

// 37. gate then resolve: with a dependency unfinished the Task goes back to pending; with it finished the Task stays ready
await ta(async () => {
  const f = await registered();
  const { T01, T02 } = f.map().tasks;
  const g = await main(['gate', ...M, '--id', 'T02', '--question', '진행할까?'], f.deps);
  assert.equal(g.code, 0, JSON.stringify(g.out));
  assert.equal(f.tasks.get(T02.orca).status, 'blocked');
  assert.equal(f.map().tasks.T02.gate, 'gate_1');
  const early = await main(['resolve', ...M, '--id', 'T02', '--resolution', '진행'], f.deps);
  assert.equal(early.code, 0, JSON.stringify(early.out));
  assert.equal(f.tasks.get(T02.orca).status, 'pending');
  assert.deepEqual(early.out.waitingOn, ['T01']);
  assert.equal(f.map().tasks.T02.gate, null);
  await main(['gate', ...M, '--id', 'T02', '--question', '진행할까?'], f.deps);
  f.tasks.get(T01.orca).status = 'completed';
  const late = await main(['resolve', ...M, '--id', 'T02', '--resolution', '진행'], f.deps);
  assert.equal(f.tasks.get(T02.orca).status, 'ready');
  assert.deepEqual(late.out.waitingOn, []);
  // resolve without a gate → code 1
  assert.equal((await main(['resolve', ...M, '--id', 'T01', '--resolution', 'x'], f.deps)).code, 1);
});

// 38. retry: a failed attempt restarts with --retry-of; an attempt the worker called a success is reopened first
await ta(async () => {
  const a = await registered({ dispatchStatus: 'failed' });
  await main(go('T01'), a.deps);
  a.tasks.get(a.map().tasks.T01.orca).status = 'failed';
  const r1 = await main(go('T01', '--retry'), a.deps);
  assert.equal(r1.code, 0, JSON.stringify(r1.out));
  assert.equal(val(a.call('worker-start'), '--retry-of'), 'ctx_old');
  assert.equal(a.count('task-update'), 0);
  const b = await registered({ dispatchStatus: 'completed' });
  await main(go('T01'), b.deps);
  b.tasks.get(b.map().tasks.T01.orca).status = 'failed';
  const r2 = await main(go('T01', '--retry'), b.deps);
  assert.equal(r2.code, 0, JSON.stringify(r2.out));
  assert.ok(!b.call('worker-start').includes('--retry-of'));
  assert.equal(val(b.call('task-update'), '--status'), 'ready');
});

// 39. actual: start from the map, end and status from Orca, settled Tasks only
await ta(async () => {
  const f = await registered();
  await main(go('T01'), f.deps);
  f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const { code, out } = await main(['actual', ...M], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out, [{ id: 'T01', registered: T0, start: T0, end: T10, status: 'completed' }]);
  // a Task registered before the registration time was kept has no `registered`
  const m = f.map(); delete m.tasks.T01.registered; f.fs['m.json'] = JSON.stringify(m);
  assert.deepEqual((await main(['actual', ...M], f.deps)).out, [{ id: 'T01', start: T0, end: T10, status: 'completed' }]);
});

// 41. register keeps --edits and --resource in the map (what launchable compares)
await ta(async () => {
  const f = fakeDag();
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  const { code, out } = await main(reg('T01', 'a.md', '--edits', 'web/ui/,tests/a.spec.mjs', '--resource', 'gpu'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(f.map().tasks.T01.edits, ['web/ui/', 'tests/a.spec.mjs']);
  assert.deepEqual(f.map().tasks.T01.resource, ['gpu']);
});

// 42. launchable: ready Tasks that fit the free slots and touch nothing a running Task edits or holds
await ta(async () => {
  const f = fakeDag({ fileOver: {
    'c.md': '[역할: qa-inspector]\nTask: T03 C\n배정: qa-inspector / 흐름 검증 (claude opus/medium)',
    'd.md': '[역할: qa-inspector]\nTask: T04 D\n배정: qa-inspector / 흐름 검증 (claude opus/medium)',
    'e.md': '[역할: qa-inspector]\nTask: T05 E\n배정: qa-inspector / 흐름 검증 (claude opus/medium)',
  } });
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  await main(reg('T01', 'a.md', '--edits', 'web/character.js'), f.deps);            // running
  await main(reg('T02', 'b.md', '--edits', 'web/character.js,web/ui/'), f.deps);    // ready, overlaps T01's file
  await main(reg('T03', 'c.md', '--resource', 'blender'), f.deps);                  // ready, free
  await main(reg('T04', 'd.md', '--resource', 'blender'), f.deps);                  // ready, same resource as T03 picked first
  await main(reg('T05', 'e.md', '--deps', 'T03'), f.deps);                          // pending
  f.tasks.get(f.map().tasks.T01.orca).status = 'dispatched';
  const { code, out } = await main(['launchable', ...M, '--slots', '8'], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out.launch, ['T03']);
  assert.equal(out.running, 1);
  assert.equal(out.free, 7);
  assert.deepEqual(Object.fromEntries(out.held.map((h) => [h.id, h.reason])), {
    T02: 'edits overlap T01 (web/character.js)', T04: 'resource blender taken by T03' });
});

// 43. launchable never fills more than the free slots; a directory edit overlaps a file under it
await ta(async () => {
  const f = await registered();
  f.tasks.get(f.map().tasks.T01.orca).status = 'dispatched';
  f.tasks.get(f.map().tasks.T02.orca).status = 'ready';
  const full = await main(['launchable', ...M, '--slots', '1'], f.deps);
  assert.deepEqual(full.out.launch, []);
  assert.deepEqual(full.out.held, [{ id: 'T02', reason: 'no free slot' }]);
  const m = f.map(); m.tasks.T01.edits = ['web/ui/']; m.tasks.T02.edits = ['web/ui/team-select.js']; f.fs['m.json'] = JSON.stringify(m);
  const overlap = await main(['launchable', ...M, '--slots', '8'], f.deps);
  assert.deepEqual(overlap.out.held, [{ id: 'T02', reason: 'edits overlap T01 (web/ui/team-select.js)' }]);
});

// 44. a started Task that Orca shows `blocked` (turn start not observed) is running: it takes a slot and holds its paths;
//     a Task blocked by a gate was never started and is not running
await ta(async () => {
  const f = await registered();
  await main(go('T01'), f.deps);
  const m = f.map(); m.tasks.T01.edits = ['web/a.js']; m.tasks.T02.edits = ['web/a.js']; f.fs['m.json'] = JSON.stringify(m);
  f.tasks.get(m.tasks.T01.orca).status = 'blocked';
  f.tasks.get(m.tasks.T02.orca).status = 'ready';
  const { out } = await main(['launchable', ...M], f.deps);
  assert.equal(out.running, 1, JSON.stringify(out));
  assert.deepEqual(out.held, [{ id: 'T02', reason: 'edits overlap T01 (web/a.js)' }]);
  assert.deepEqual((await main(['ready', ...M], f.deps)).out.running, ['T01']);
  const g = await registered();
  await main(['gate', ...M, '--id', 'T01', '--question', '진행할까?'], g.deps);
  assert.equal((await main(['launchable', ...M], g.deps)).out.running, 0);
  assert.deepEqual((await main(['ready', ...M], g.deps)).out.running, []);
});

// 45. pull: a pending Task's dependencies become its real inputs; it goes ready only when those are all completed, and the map keeps why
await ta(async () => {
  const f = fakeDag({ fileOver: { 'c.md': '[역할: qa-inspector]\nTask: T03 C\n배정: qa-inspector / 흐름 검증 (claude opus/medium)' } });
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  await main(reg('T01', 'a.md'), f.deps);
  await main(reg('T02', 'b.md'), f.deps);
  await main(reg('T03', 'c.md', '--deps', 'T01,T02'), f.deps);
  const pull = (...more) => main(['pull', ...M, '--id', 'T03', ...more], f.deps);
  const { T01, T03 } = f.map().tasks;
  const early = await pull('--deps', 'T01', '--reason', 'T02의 산출물을 읽지 않음');
  assert.equal(early.code, 1);
  assert.deepEqual(early.out.waitingOn, ['T01']);
  assert.deepEqual(f.map().tasks.T03.deps, ['T01', 'T02']);
  assert.equal(f.count('task-update'), 0);
  assert.equal((await pull('--deps', 'T01')).code, 1);                    // no reason
  assert.equal((await pull('--deps', 'T09', '--reason', 'x')).code, 1);   // not registered
  f.tasks.get(T01.orca).status = 'completed';
  const ok = await pull('--deps', 'T01', '--reason', 'T02의 산출물을 읽지 않음');
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.equal(f.tasks.get(T03.orca).status, 'ready');
  assert.deepEqual(f.map().tasks.T03.deps, ['T01']);
  assert.deepEqual(f.map().tasks.T03.pulled, { from: ['T01', 'T02'], reason: 'T02의 산출물을 읽지 않음', at: T0 });
  assert.equal((await pull('--deps', 'T01', '--reason', 'x')).code, 1);   // no longer pending
});

// 46. unhandled: messages sent to this map's workers that they have not taken (a reply that did not wake its worker)
await ta(async () => {
  const f = await registered();
  await main(go('T01'), f.deps);
  f.inbox.push(
    { id: 'msg_a', type: 'status', subject: 'Re: Question', to: 'dispatch:ctx_new', handled: false },
    { id: 'msg_b', type: 'status', subject: 'Re: Question', to: 'dispatch:ctx_new', handled: true },
    { id: 'msg_c', type: 'status', subject: 'Re: Question', to: 'dispatch:ctx_other', handled: false },
    { id: 'msg_d', type: 'worker_done', subject: 'done', to: 'run:run_exec', handled: false });
  const { code, out } = await main(['unhandled', ...M], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out.unhandled, [{ id: 'T01', message: 'msg_a', subject: 'Re: Question' }]);
});

// 48. reply: answers, waits inside the script (no extra model call), then says whether the worker took the answer
await ta(async () => {
  const f = await registered();
  await main(go('T01'), f.deps);
  const waited = [];
  f.deps.sleep = async (ms) => { waited.push(ms); };
  f.replyHandled = false; // measured 2026-11-12: a reply landing seconds after the worker's turn ended was typed but not submitted
  const late = await main(['reply', ...M, '--id', 'msg_q', '--body', '승인'], f.deps);
  assert.equal(late.code, 0, JSON.stringify(late.out));
  assert.deepEqual(waited, [25000]);
  assert.equal(val(f.call('reply'), '--id'), 'msg_q');
  assert.equal(val(f.call('reply'), '--body'), '승인');
  assert.deepEqual(late.out, { reply: 'msg_r1', task: 'T01', handled: false });
  f.replyHandled = true;
  const ok = await main(['reply', ...M, '--id', 'msg_q', '--body', '승인', '--verify-ms', '0'], f.deps);
  assert.deepEqual(waited, [25000, 0]);
  assert.deepEqual(ok.out, { reply: 'msg_r2', task: 'T01', handled: true });
});

// 49. reply: a refused reply is a failure and nothing is waited for
await ta(async () => {
  const f = await registered();
  const waited = [];
  f.deps.sleep = async (ms) => { waited.push(ms); };
  f.replyRefused = true;
  const { code, out } = await main(['reply', ...M, '--id', 'msg_q', '--body', '승인'], f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /reply 실패/);
  assert.deepEqual(waited, []);
});

// 47. register keeps the registration time (a Task added after the plan is not ready before it exists)
await ta(async () => {
  const f = await registered();
  assert.equal(f.map().tasks.T02.registered, T0);
});

// 48. exec-run freezes the approved plan once: waterfall.json next to the map → waterfall.plan.json, never overwritten
await ta(async () => {
  const f = fakeDag({ fileOver: { 'waterfall.json': '{"v":1}' } });
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  assert.equal(f.fs['waterfall.plan.json'], '{"v":1}');
  f.fs['waterfall.json'] = '{"v":2}';
  await main(['exec-run', '--phase', 'phase-a', ...M], f.deps);
  assert.equal(f.fs['waterfall.plan.json'], '{"v":1}');
  const g = fakeDag({ fileOver: { 'waterfall.json': '{"v":2}', 'waterfall.plan.json': '{"v":1}' } });
  await main(['exec-run', '--phase', 'phase-a', ...M], g.deps);
  assert.equal(g.fs['waterfall.plan.json'], '{"v":1}');
  const none = fakeDag();
  assert.equal((await main(['exec-run', '--phase', 'phase-a', ...M], none.deps)).code, 0);
  assert.equal(none.fs['waterfall.plan.json'], undefined);
});

// 40. run as a command: outside the project root it refuses before anything else; at the root it runs
t(() => {
  const script = fileURLToPath(new URL('./orca-launch.mjs', import.meta.url));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const away = spawnSync(process.execPath, [script, 'codex-rules'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(away.status, 1, away.stdout);
  assert.match(JSON.parse(away.stdout).error, /저장소 루트/);
  const home = spawnSync(process.execPath, [script, 'codex-rules'], { cwd: root, encoding: 'utf8' });
  assert.equal(home.status, 0, home.stdout + home.stderr);
  assert.match(home.stdout, /⑥/);
});

console.log(`orca-launch.check: ${passed} passed`);
