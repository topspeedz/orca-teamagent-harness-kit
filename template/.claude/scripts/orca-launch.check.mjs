// Self-test for orca-launch.mjs — no Orca needed. `node .claude/scripts/orca-launch.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabTitle, parseAssignLine, parseOverrideLine, verifyAssignment, workerStartArgs, coordinatorCommand, main } from './orca-launch.mjs';
import { choices, parseTable, TABLE_PATH } from './model-selection.mjs';
import { assessRouting } from './model-routing.mjs';
import { SETTINGS_PATH, KEEP_PATH } from './coordinator-settings.mjs';
import { readRoster } from './roster.mjs';

let passed = 0;
const t = (fn) => { fn(); passed++; };

const row = { line: 15, agent: 'verifier', units: ['흐름 검증'], runtime: 'claude', model: 'opus', effort: 'medium', note: '', matched: 'exact' };
const spec = (assign, ...more) => ['[역할: verifier]', 'Task: 흐름 검증', assign, ...more].join('\n');
const ok = spec('배정: verifier / 흐름 검증 (claude opus/medium)');
const verify = (p) => verifyAssignment({ spec: ok, agent: 'verifier', unit: '흐름 검증', row, overrideReason: null, ...p });

// 1. tab title
t(() => assert.equal(
  tabTitle({ bracket: 'BL-0012', agent: 'verifier', model: 'opus', effort: 'medium', does: '결제 흐름 검증' }),
  '[BL-0012 - verifier] 결제 흐름 검증 opus/medium'));

// 2. tab title without effort
t(() => assert.equal(
  tabTitle({ bracket: 'BL-0012', agent: 'verifier', model: 'haiku', effort: null, does: '결제 흐름 검증' }),
  '[BL-0012 - verifier] 결제 흐름 검증 haiku'));

// 3. assign line: five values, unit with spaces, no-effort form, missing line
t(() => {
  assert.deepEqual(parseAssignLine('배정: verifier / 재검 (claude sonnet/medium)'),
    { agent: 'verifier', unit: '재검', runtime: 'claude', model: 'sonnet', effort: 'medium' });
  assert.deepEqual(parseAssignLine('x\n배정: verifier / 보안·돈이 걸린 변경 리뷰 (claude opus/high)\ny'),
    { agent: 'verifier', unit: '보안·돈이 걸린 변경 리뷰', runtime: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(parseAssignLine('배정: product-manager / 설계 (claude haiku)'),
    { agent: 'product-manager', unit: '설계', runtime: 'claude', model: 'haiku', effort: null });
  assert.equal(parseAssignLine('no assignment here'), null);
});

// 4. assignment equal to the table → pass
t(() => assert.deepEqual(verify({}), []));

// 5. effort differs from the table → one reason carrying both values
t(() => {
  const r = verify({ spec: spec('배정: verifier / 흐름 검증 (claude opus/high)') });
  assert.equal(r.length, 1, r.join('\n'));
  assert.match(r[0], /opus\/high/);
  assert.match(r[0], /opus\/medium/);
});

// 6. override: only one side → fail; both → spec values win
t(() => {
  const s = spec('배정: verifier / 흐름 검증 (claude opus/high)', '사용자 예외: 이번만 high로 띄워줘');
  assert.equal(parseOverrideLine(s), '이번만 high로 띄워줘');
  assert.equal(parseOverrideLine(ok), null);
  assert.ok(verify({ spec: s }).length > 0);
  assert.ok(verify({ overrideReason: '이번만 high로 띄워줘' }).length > 0);
  assert.deepEqual(verify({ spec: s, overrideReason: '이번만 high로 띄워줘' }), []);
});

// 8. no assignment line → fail
t(() => assert.ok(verify({ spec: '[역할: verifier]\nTask: 흐름 검증' }).length > 0));

// 9. worker-start args: spec path is one element, model/effort from the table, no effort when null
t(() => {
  const specFile = 'D:/내 프로젝트/_workspace/qa/spec/a b.md';
  const a = workerStartArgs({ row, specFile, displayName: 'x', worktree: 'current' });
  assert.ok(a.includes(specFile));
  assert.ok(!a.includes('--display-name'));
  assert.equal(a[a.indexOf('--task-title') + 1], 'x');
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
  '| `coordinator` | 실행 감독 | claude | opus | high | 고정 |',
  '| `verifier` | 리뷰 | codex | gpt-6.1-sol | high | 고정 |',
  '| `verifier` | 흐름 검증 | claude | opus | medium | 고정 |',
  '| `frontend` | 구현 | claude | opus | medium | 고정 |',
  '| `*` | 기본 | claude | sonnet | medium | |',
].join('\n');
const ROSTER = ['| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |', '| --- | --- | --- | --- |',
  '| `verifier` | 검증 | `qa-verification` | 리포트만 |', '| `frontend` | 화면 | `frontend` | web/ |'].join('\n');
// readRoster reads the disk, so the in-memory roster files are written to a temp folder for it
const ROSTER_FILES = ['docs/harness/agents.md', 'docs/harness/team-org.md'];
const roster = (fs) => () => {
  const dir = mkdtempSync(join(tmpdir(), 'roster-'));
  try {
    for (const p of ROSTER_FILES.filter((x) => fs[x] !== undefined)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), fs[p]);
    }
    return readRoster(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const keep = { permissionMode: 'default', plugins: { 'p@p': 'keep' }, skills: { coordinator: 'keep' } };
const files = (over = {}) => ({
  [TABLE_PATH]: TABLE, [SETTINGS_PATH]: '{}', [KEEP_PATH]: JSON.stringify(keep), [ROSTER_FILES[0]]: ROSTER,
  'qa.md': ok, 'coord.md': '[역할: coordinator]',
  'codex.md': '[역할: verifier]\nTask: T09 리뷰\n배정: verifier / 리뷰 (codex gpt-6.1-sol/high)', ...over,
});
const inventory = (skills) => () => JSON.stringify({ type: 'system', subtype: 'init', plugins: [{ source: 'p@p' }], skills });
const val = (a, f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const RULES = '[워커 작업 방식 — 가짜]\n①\n②\n③\n④\n⑤\n⑥';
function fake({ runs = [], fileOver = {}, skills = ['coordinator'], hookLines = () => RULES } = {}) {
  const calls = [];
  const replies = {
    'orchestration run-list': () => ({ ok: true, result: { runs } }),
    'orchestration run-create': () => ({ ok: true, result: { run: { id: 'run_new' } } }),
    'terminal create': () => ({ ok: true, result: { terminal: { handle: 'term_c' } } }),
    'terminal wait': () => ({ ok: true, result: { wait: { satisfied: true } } }),
    'orchestration worker-start': (a) => ({ ok: true, result: { taskId: 'task_1', dispatchId: 'ctx_1', runId: val(a, '--run') ?? 'run_1', state: 'ready', turnStart: 'observed',
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
    roster: roster(fs),
  };
  return { calls, deps, names: () => calls.map((a) => (a[0] === 'orchestration' ? a[1] : a.slice(0, 2).join(' '))) };
}
const workerArgv = ['worker', '--agent', 'verifier', '--unit', '흐름 검증', '--spec-file', 'qa.md', '--bracket', 'BL-0012', '--does', '결제 흐름 검증'];
const coordArgv = ['coordinator', '--phase', 'phase-a', '--spec-file', 'coord.md', '--does', '결제 개선', '--backlog', 'BL-0001,BL-0002'];
async function captureStderr(fn) {
  const orig = console.error;
  let err = '';
  console.error = (...a) => { err += a.join(' ') + '\n'; };
  try { return { result: await fn(), err }; } finally { console.error = orig; }
}

// 10. worker: assignment differs from the table → code 1, orca never called
await ta(async () => {
  const f = fake({ fileOver: { 'qa.md': spec('배정: verifier / 흐름 검증 (claude opus/high)') } });
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
  assert.equal(out.title, tabTitle({ bracket: 'BL-0012', agent: 'verifier', model: 'opus', effort: 'medium', does: '결제 흐름 검증' }));
  assert.deepEqual(out.requested, { runtime: 'claude', model: 'opus', effort: 'medium' });
  assert.deepEqual(out.applied, { model: 'opus', effort: 'medium' });
  assert.equal(out.matched, true);
  assert.equal(out.turnStarted, true);
  assert.deepEqual([out.task, out.dispatch, out.terminal], ['task_1', 'ctx_1', 'term_w']);
  const rn = f.calls.find((a) => a[0] === 'terminal' && a[1] === 'rename');
  assert.equal(val(rn, '--terminal'), 'term_w');
  assert.equal(val(rn, '--title'), out.title);
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

const codexArgv = ['worker', '--agent', 'verifier', '--unit', '리뷰', '--spec-file', 'codex.md', '--bracket', 'BL-0012', '--does', '리뷰'];

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
  const fs = files({
    'a.md': '[역할: verifier]\nTask: T01 로그인 흐름\n배정: verifier / 흐름 검증 (claude opus/medium)',
    'b.md': '[역할: verifier]\nTask: T02 결제 흐름\n배정: verifier / 흐름 검증 (claude opus/medium)',
    ...fileOver,
  });
  const refuse = (code, message, data = {}) => ({ ok: false, error: { code, message, data } });
  const replies = {
    'orchestration run-create': () => ({ ok: true, result: { run: { id: 'run_exec' } } }),
    'orchestration task-create': (a) => {
      const id = `task_${++n}`;
      const deps = JSON.parse(val(a, '--deps') ?? '[]');
      const path = val(a, '--spec-file');
      tasks.set(id, { status: deps.length ? 'pending' : 'ready', deps, spec: fs[path] ?? readFileSync(path, 'utf8') });
      return { ok: true, result: { task: { id, status: tasks.get(id).status } } };
    },
    'orchestration task-list': () => ({ ok: true, result: { tasks: [...tasks].map(([id, t]) => (
      { id, spec: t.spec, status: t.status, deps: JSON.stringify(t.deps), completed_at: ['completed', 'failed'].includes(t.status) ? T10 : null })) } }),
    'orchestration task-update': (a) => { tasks.get(val(a, '--id')).status = val(a, '--status'); return { ok: true, result: { taskId: val(a, '--id'), status: val(a, '--status') } }; },
    'orchestration gate-create': (a) => { tasks.get(val(a, '--task')).status = 'blocked'; gates.set('gate_1', val(a, '--task')); return { ok: true, result: { gate: { id: 'gate_1', status: 'pending' } } }; },
    // measured: resolving sets the Task ready even when a dependency is unfinished
    'orchestration gate-resolve': (a) => { tasks.get(gates.get(val(a, '--id'))).status = 'ready'; return { ok: true, result: { gate: { id: val(a, '--id'), status: 'resolved' } } }; },
    'orchestration dispatch-show': () => ({ ok: true, result: { dispatch: { id: 'ctx_old', status: dispatchStatus } } }),
    // measured: only a ready Task starts; --retry-of restarts a failed one
    'orchestration worker-start': (a) => {
      const taskId = val(a, '--task') ?? `task_${++n}`;
      if (!val(a, '--task')) {
        const path = val(a, '--spec-file');
        tasks.set(taskId, { status: 'ready', deps: [], spec: fs[path] ?? readFileSync(path, 'utf8') });
      }
      const t = tasks.get(taskId);
      const retry = a.includes('--retry-of') && t.status === 'failed';
      if (t.status !== 'ready' && !retry) return refuse('task_not_startable', `Task ${val(a, '--task')} is ${t.status}; only a ready Task can start.`, { unmetDependencies: t.deps.filter((d) => tasks.get(d).status !== 'completed') });
      t.status = 'dispatched';
      return { ok: true, result: { taskId, dispatchId: 'ctx_new', runId: val(a, '--run') ?? 'run_child', turnStart: 'observed',
        launch: { effective: { model: val(a, '--model') ?? null, effort: val(a, '--effort') ?? null } }, effects: [{ kind: 'terminal', id: 'term_w' }] } };
    },
    'terminal rename': () => ({ ok: true, result: {} }),
    'orchestration inbox': () => ({ ok: true, result: { messages: inbox } }),
  };
  const deps = {
    orca: (args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(replies[args.slice(0, 2).join(' ')](args)), stderr: '' }; },
    read: (p) => { if (fs[p] === undefined) throw new Error(`ENOENT ${p}`); return fs[p]; },
    write: (p, text) => { fs[p] = text; },
    now: () => T0,
    run: inventory(['coordinator']),
    hookLines: () => RULES,
    roster: roster(fs),
  };
  const count = (name) => calls.filter((a) => a[1] === name).length;
  return { calls, deps, tasks, fs, inbox, count, map: () => JSON.parse(fs['orca-tasks.json']), call: (name) => calls.findLast((a) => a[1] === name) };
}
const M = ['--map', 'orca-tasks.json'];
const reg = (id, spec, ...more) => ['register', ...M, '--id', id, '--spec-file', spec, ...more];
const go = (id, ...more) => ['worker', ...M, '--id', id, '--bracket', 'BL-0012', '--does', '흐름 검증', ...more];
async function registered(opts) {
  const f = fakeDag(opts);
  await execRun(f, [['T01', 'T02']]);
  await main(reg('T01', 'a.md'), f.deps);
  await main(reg('T02', 'b.md', '--deps', 'T01'), f.deps);
  return f;
}

const approval = 'approved-plan.v1.json';
const reviewArgs = (v) => ['--version', v, '--plan', 'plan.md', '--dag', 'dag.json'];
async function approve(f, nodes, edges = [], version = 'v1', drawing = {}) {
  f.fs['plan.md'] ??= 'phase-a 실행 계획';
  f.fs['dag.json'] = JSON.stringify({ nodes, edges, ...drawing });
  const args = reviewArgs(version);
  const reviewed = await main(['review', ...args], f.deps);
  assert.equal(reviewed.code, 0, JSON.stringify(reviewed.out));
  const result = await main(['approve', ...args, '--review', reviewed.out.review, '--response', '이 버전으로 실행'], f.deps);
  assert.equal(result.code, 0, JSON.stringify(result.out));
  return result.out.approval;
}
const node = (id, more = {}) => ({ id, bl: 'BL-0012', role: row.agent, unit: '흐름 검증', agent: 'claude', model: 'opus', effort: 'medium', ...more });
const runArgs = ['exec-run', '--phase', 'phase-a', ...M];
async function execRun(f, edges = []) {
  const ids = ['T01', 'T02', 'T03', 'T04', 'T05'].map(id => node(id));
  ids.push(node('T09', { role: 'verifier', unit: '리뷰', agent: 'codex', model: 'gpt-6.1-sol', effort: 'high' }));
  await approve(f, ids, edges.map(([from, to]) => ({ from, to })));
  return main([...runArgs, '--approval', approval], f.deps);
}

// No Run until the exact reviewed plan and DAG have a recorded execution approval.
await ta(async () => {
  const f = fakeDag();
  assert.equal((await main(runArgs, f.deps)).code, 1);
  await approve(f, [node('T01')]);
  const args = reviewArgs('v1');
  const review = (await main(['review', ...args], f.deps)).out.review;
  assert.equal((await main(['approve', ...args, '--review', review, '--response', 'v2 실행 승인'], f.deps)).code, 1);
  f.fs['plan.md'] += ' changed';
  assert.equal((await main(['approve', ...args, '--review', review, '--response', '실행'], f.deps)).code, 1);
  f.fs['plan.md'] = 'phase-a 실행 계획';
  f.fs['dag.json'] = f.fs['dag.json'].replace('medium', 'high');
  assert.equal((await main(['approve', ...args, '--review', review, '--response', '실행'], f.deps)).code, 1);
  assert.equal(f.count('run-create'), 0);
});

// Both placements of a table edit: before the Run exists, or after only T01 has an Orca ID.
for (const beforeRun of [true, false]) await ta(async () => {
  const f = fakeDag();
  f.fs[TABLE_PATH] = TABLE.replace('opus | medium', 'opus | high');
  for (const path of ['a.md', 'b.md']) f.fs[path] = f.fs[path].replace('opus/medium', 'opus/high');
  const nodes = ['T01', 'T02'].map(id => node(id, { effort: 'high' }));
  await approve(f, nodes);
  const editTable = () => { f.fs[TABLE_PATH] = TABLE.replace('opus | medium', 'sonnet | medium'); };
  if (beforeRun) editTable();
  assert.equal((await main([...runArgs, '--approval', approval], f.deps)).code, 0);
  assert.equal((await main(reg('T01', 'a.md'), f.deps)).code, 0);
  editTable();
  assert.equal((await main(reg('T02', 'b.md'), f.deps)).code, 0);
  for (const id of ['T01', 'T02']) {
    assert.match(f.tasks.get(f.map().tasks[id].orca).spec, /opus\/high/);
    const receipt = await main(go(id), f.deps);
    assert.equal(receipt.code, 0, JSON.stringify(receipt.out));
    assert.equal(receipt.out.matched && receipt.out.turnStarted, true);
    assert.deepEqual(receipt.out.applied, { model: 'opus', effort: 'high' });
    assert.deepEqual(['--agent','--model','--effort'].map(k => val(f.call('worker-start'), k)), ['claude','opus','high']);
  }
  const fresh = fake({ fileOver: { [TABLE_PATH]: f.fs[TABLE_PATH], 'qa.md': ok.replace('opus/medium', 'sonnet/medium') } });
  assert.deepEqual((await main(workerArgv, fresh.deps)).out.applied, { model: 'sonnet', effort: 'medium' });
  const next = fakeDag({ fileOver: { [TABLE_PATH]: f.fs[TABLE_PATH], 'a.md': f.fs['a.md'].replace('opus/high','sonnet/medium') } });
  await approve(next, [node('T01', { model:'sonnet' })]);
  await main([...runArgs,'--approval',approval], next.deps);
  await main(reg('T01','a.md'), next.deps);
  assert.deepEqual((await main(go('T01'), next.deps)).out.applied, { model:'sonnet', effort:'medium' });
});

// Reapproval before first registration and with immutable, dependent Orca Tasks and an open gate.
for (const registered of [false, true]) await ta(async () => {
  const f = fakeDag();
  const nodes = ['T01','T02','T03'].map(id => node(id));
  const edges = [{ from: 'T01', to: 'T02' }];
  await approve(f, nodes, edges);
  assert.equal((await main([...runArgs, '--approval', approval], f.deps)).code, 0);
  f.fs['c.md'] = f.fs['a.md'].replace('T01', 'T03');
  await main(reg('T03','c.md'), f.deps);
  const settled = (await main(go('T03'), f.deps)).out;
  f.tasks.get(settled.task).status = 'completed';
  const untouched = f.map().tasks.T03;
  let old, successor;
  if (registered) {
    old = (await main(reg('T01','a.md'), f.deps)).out.orca;
    successor = (await main(reg('T02','b.md'), f.deps)).out.orca;
    await main(['gate', ...M, '--id','T01','--question','승인 조건?'], f.deps);
  }
  f.fs['a.md'] = f.fs['a.md'].replace('opus/medium','sonnet/medium');
  f.fs[TABLE_PATH] = TABLE.replace('opus | medium','sonnet | medium');
  nodes[0].model = 'sonnet';
  const v2 = await approve(f, nodes, edges, 'v2');
  const change = ['reapprove', ...M, '--id','T01','--approval',v2];
  assert.equal((await main(reg('T01','a.md','--approval',v2), f.deps)).code, 1);
  if (registered) {
    assert.equal((await main(change, f.deps)).code, 1);
    assert.equal((await main(go('T01'), f.deps)).code, 1);
    assert.equal(f.map().tasks.T01.orca, old);
    await main(['resolve', ...M, '--id','T01','--resolution','허용'], f.deps);
    assert.equal((await main(go('T01'), f.deps)).code, 1);
  }
  assert.equal(f.count('worker-start'), 1);
  const changed = await main(change, f.deps);
  assert.equal(changed.code, 0, JSON.stringify(changed.out));
  assert.equal((await main(change, f.deps)).out.existing, true);
  assert.equal((await main(reg('T01','a.md'), f.deps)).code, 0);
  const replacement = f.map().tasks.T01.orca;
  if (registered) {
    assert.notEqual(old, replacement);
    assert.equal(f.tasks.get(old).status, 'failed');
    assert.match(f.tasks.get(old).spec, /opus\/medium/);
    assert.equal(f.map().tasks.T01.previous[0].gates[0].id, 'gate_1');
    assert.equal(f.map().tasks.T02.orca, successor);
    assert.equal((await main(go('T02'), f.deps)).code, 1);
  }
  assert.equal((await main(go('T01','--approval',approval), f.deps)).code, 1);
  const receipt = await main(go('T01'), f.deps);
  assert.equal(receipt.code, 0);
  assert.deepEqual(receipt.out.applied, { model: 'sonnet', effort: 'medium' });
  assert.match(f.tasks.get(replacement).spec, /sonnet\/medium/);
  assert.equal((await main(go('T01'), f.deps)).code, 1);
  assert.deepEqual(f.map().tasks.T03, untouched);
  f.tasks.get(replacement).status = 'completed';
  if (registered) assert.equal((await main(go('T02'), f.deps)).code, 0);
});

// Replaying a replacement after loss of its creation receipt adopts its immutable Orca Task.
await ta(async () => {
  const f = fakeDag();
  await approve(f,[node('T01')]);
  await main([...runArgs,'--approval',approval], f.deps);
  await main(reg('T01','a.md'), f.deps);
  f.fs[TABLE_PATH] = TABLE.replace('opus | medium','sonnet | medium');
  f.fs['a.md'] = f.fs['a.md'].replace('opus/medium','sonnet/medium');
  const v2 = await approve(f,[node('T01',{ model:'sonnet' })],[],'v2');
  const change = ['reapprove',...M,'--id','T01','--approval',v2];
  const call = f.deps.orca;
  f.deps.orca = args => {
    const r = call(args);
    return args[1] === 'task-create' ? { stdout:'', stderr:'lost receipt' } : r;
  };
  assert.equal((await main(change,f.deps)).code, 1);
  assert.equal((await main(go('T01'),f.deps)).code, 1);
  f.deps.orca = call;
  assert.equal((await main(change,f.deps)).code, 0);
  assert.equal(f.count('task-create'), 2);
  assert.equal((await main(go('T01'),f.deps)).code, 0);
});

// Old Runs keep their registered values. An unregistered Task needs its own historical approval.
await ta(async () => {
  const f = await registered();
  const old = f.map();
  delete old.approval;
  delete old.review;
  delete old.tasks.T02;
  f.fs[M[1]] = JSON.stringify(old);
  assert.equal((await main(runArgs, f.deps)).out.existing, true);
  // launching reads the table to tell a fixed row from a formula row; the rest of an old Run does not
  assert.equal((await main(go('T01'), f.deps)).code, 0);
  f.fs[TABLE_PATH] = 'unavailable';
  f.tasks.get(old.tasks.T01.orca).status = 'completed';
  assert.equal((await main(go('T01'), f.deps)).code, 1);
  assert.equal((await main(go('T01','--retry'), f.deps)).code, 1);
  assert.equal(f.count('worker-start'), 1);
  assert.equal((await main(reg('T02','b.md'), f.deps)).code, 1);
  const args = [...reviewArgs('v2'), '--legacy-map', M[1]];
  const reviewed = await main(['review', ...args], f.deps);
  assert.equal(reviewed.code, 0);
  const restored = await main(['approve', ...args, '--review', reviewed.out.review, '--response', '당시 승인 원문'], f.deps);
  assert.equal(restored.code, 0);
  assert.equal((await main(['reapprove', ...M, '--id','T02','--approval',restored.out.approval], f.deps)).code, 0);
  assert.equal((await main(reg('T02','b.md'), f.deps)).code, 0);
});

await ta(async () => {
  const f = fakeDag();
  for (const bad of [{ id: 'T01', bl: 'BL-0001' }, node('T01',{ bl: ['BL-0001','bad'] }), node('T01',{ kind:'approval' })]) {
    f.fs['plan.md'] = 'plan';
    f.fs['dag.json'] = JSON.stringify({ nodes: [bad, node('T02')], edges: [] });
    assert.equal((await main(['review', ...reviewArgs('v1')], f.deps)).code, 1);
  }
  await approve(f, [node('T01',{ bl:['BL-0001','BL-0002'] }), { id:'USER', kind:'approval' }, node('T02')],
    [{ from:'T01',to:'USER' }, { from:'USER',to:'T02' }]);
  assert.deepEqual(JSON.parse(f.fs[approval]).tasks.T02.deps, ['T01']);
  const staged = JSON.parse(f.fs[approval]);
  staged.tasks.T01.model = 'changed';
  f.fs[approval] = JSON.stringify(staged);
  assert.equal((await main([...runArgs,'--approval',approval], f.deps)).code, 1);
  assert.equal(f.count('run-create'), 0);
});

// 28. exec-run creates the execution Run once and keeps it in the map
await ta(async () => {
  const f = fakeDag();
  await approve(f, [node('T01')]);
  const opts = v => ['--approval', `approved-plan.${v}.json`, ...reviewArgs(v)];
  const launch = async (args, code) => {
    const g = fake({ fileOver: f.fs });
    const result = await main([...coordArgv, ...args], g.deps);
    assert.equal(result.code, code, JSON.stringify(result.out));
    for (const step of ['run-create','terminal create','worker-start']) assert.equal(g.names().filter(n => n === step).length, code === 0 ? 1 : 0);
  };
  f.fs['plan.md'] += '수정 v2';
  await launch(opts('v1'), 1);
  await launch(opts('v2'), 1);
  f.fs['plan.md'] = 'phase-a 실행 계획';
  const nodes = [node('T01'),node('T02')];
  f.fs['dag.json'] = JSON.stringify({nodes,edges:[]});
  await launch(opts('v1'), 1);
  await launch(['--approval', approval], 1);
  await approve(f, nodes, [], 'v2');
  await launch(opts('v2'), 0);
});

await ta(async () => {
  const f = fakeDag();
  const a = await execRun(f);
  assert.equal(a.code, 0, JSON.stringify(a.out));
  assert.equal(a.out.run, 'run_exec');
  assert.equal(f.map().run, 'run_exec');
  assert.match(val(f.call('run-create'), '--objective'), /^phase-a /);
  const b = await execRun(f);
  assert.equal(b.out.run, 'run_exec');
  assert.equal(f.count('run-create'), 1);
});

// 29. register needs exec-run first; then one task-create in that Run, titled from the spec's Task line; the same id twice makes one Task
await ta(async () => {
  const f = fakeDag();
  assert.equal((await main(reg('T01', 'a.md'), f.deps)).code, 1);
  await execRun(f);
  const { code, out } = await main(reg('T01', 'a.md'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  const c = f.call('task-create');
  assert.equal(val(c, '--run'), 'run_exec');
  assert.equal(val(c, '--task-title'), 'T01 로그인 흐름');
  assert.ok(f.tasks.get(out.orca).spec.includes(f.fs['a.md']));
  assert.equal(f.map().tasks.T01.orca, out.orca);
  assert.equal(f.map().tasks.T01.model, 'opus');
  await main(reg('T01', 'a.md'), f.deps);
  assert.equal(f.count('task-create'), 1);
});

// 30. register: an assignment that differs from the table → code 1, nothing created
await ta(async () => {
  const f = fakeDag({ fileOver: { 'a.md': '[역할: verifier]\nTask: T01 x\n배정: verifier / 흐름 검증 (claude opus/high)' } });
  await execRun(f);
  const { code, out } = await main(reg('T01', 'a.md'), f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /배정/);
  assert.equal(f.count('task-create'), 0);
});

// 31. register with deps: plan ids become Orca ids; a dependency that is not registered yet → code 1
await ta(async () => {
  const f = fakeDag();
  await execRun(f, [['T01','T02']]);
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
  await execRun(f);
  const { code, out } = await main(reg('T09', 'codex.md'), f.deps);
  assert.equal(code, 0);
  const p = val(f.call('task-create'), '--spec-file');
  assert.notEqual(p, 'codex.md');
  assert.ok(f.tasks.get(out.orca).spec.endsWith(`${RULES}\n`));
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
  assert.ok(!c.includes('--display-name') && !c.includes('--task-title'));
  assert.equal(out.title, '[BL-0012 - verifier] 흐름 검증 opus/medium');
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
  assert.deepEqual(out, [{ id: 'T01', start: T0, end: T10, status: 'completed' }]);
});

// 41. register keeps --edits and --resource in the map (what launchable compares)
await ta(async () => {
  const f = fakeDag();
  await execRun(f);
  const { code, out } = await main(reg('T01', 'a.md', '--edits', 'web/ui/,tests/a.spec.mjs', '--resource', 'gpu'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(f.map().tasks.T01.edits, ['web/ui/', 'tests/a.spec.mjs']);
  assert.deepEqual(f.map().tasks.T01.resource, ['gpu']);
});

// 42. launchable: ready Tasks that fit the free slots and touch nothing a running Task edits or holds
await ta(async () => {
  const f = fakeDag({ fileOver: {
    'c.md': '[역할: verifier]\nTask: T03 C\n배정: verifier / 흐름 검증 (claude opus/medium)',
    'd.md': '[역할: verifier]\nTask: T04 D\n배정: verifier / 흐름 검증 (claude opus/medium)',
    'e.md': '[역할: verifier]\nTask: T05 E\n배정: verifier / 흐름 검증 (claude opus/medium)',
  } });
  await execRun(f, [['T03','T05']]);
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
  const m = f.map(); m.tasks.T01.edits = ['web/ui/']; m.tasks.T02.edits = ['web/ui/team-select.js']; f.fs['orca-tasks.json'] = JSON.stringify(m);
  const overlap = await main(['launchable', ...M, '--slots', '8'], f.deps);
  assert.deepEqual(overlap.out.held, [{ id: 'T02', reason: 'edits overlap T01 (web/ui/team-select.js)' }]);
});

// 45. pull: a pending Task's dependencies become its real inputs; it goes ready only when those are all completed, and the map keeps why
await ta(async () => {
  const f = fakeDag({ fileOver: { 'c.md': '[역할: verifier]\nTask: T03 C\n배정: verifier / 흐름 검증 (claude opus/medium)' } });
  await execRun(f, [['T01','T03'],['T02','T03']]);
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

// 48. exec-run freezes the approved plan once: waterfall.json next to the map → waterfall.plan.json, never overwritten
await ta(async () => {
  const f = fakeDag({ fileOver: { 'waterfall.json': '{"v":1}' } });
  await execRun(f);
  assert.equal(f.fs['waterfall.plan.json'], '{"v":1}');
  f.fs['waterfall.json'] = '{"v":2}';
  await execRun(f);
  assert.equal(f.fs['waterfall.plan.json'], '{"v":1}');
  const g = fakeDag({ fileOver: { 'waterfall.json': '{"v":2}', 'waterfall.plan.json': '{"v":1}' } });
  await execRun(g);
  assert.equal(g.fs['waterfall.plan.json'], '{"v":1}');
  const none = fakeDag();
  assert.equal((await execRun(none)).code, 0);
  assert.equal(none.fs['waterfall.plan.json'], undefined);
});

// 49. launchable lists waiting Tasks as pull candidates: the unfinished Tasks each waits on and its spec's 먼저 읽을 것 lines
await ta(async () => {
  const f = fakeDag({ fileOver: { 'c.md': '[역할: verifier]\nTask: T03 C\n배정: verifier / 흐름 검증 (claude opus/medium)\n\n먼저 읽을 것:\n- web/stage.js\n- 메모 T03.memo.md\n\n편집 범위: tests/c.spec.mjs' } });
  await execRun(f, [['T01','T03'],['T02','T03']]);
  await main(reg('T01', 'a.md'), f.deps);
  await main(reg('T02', 'b.md'), f.deps);
  await main(reg('T03', 'c.md', '--deps', 'T01,T02'), f.deps);
  f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const { code, out } = await main(['launchable', ...M, '--slots', '8'], f.deps);
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out.candidates, [{ id: 'T03', waitingOn: ['T02'], reads: ['web/stage.js', '메모 T03.memo.md'] }]);
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

const projectTable = [
  // v2 cases score the 흐름 검증 row, so it is a formula row here
  TABLE.replace('흐름 검증 | claude | opus | medium | 고정 |', '흐름 검증 | claude | opus | medium | |'), '| verifier | 보안·돈이 걸린 변경 리뷰 | claude | fable | xhigh | 고정 |', '',
  '| Claude | Codex | 메모 |', '| --- | --- | --- |', '| haiku | gpt-6.2-sol/low | |',
  ...['sonnet','opus','fable'].flatMap(model => ['low','medium','high','xhigh','max'].map(effort => {
    const target = model === 'sonnet' ? 'gpt-6.2-sol' : 'gpt-6.2-astra';
    const level = model === 'fable' && effort === 'max' ? 'ultra' : effort;
    return `| ${model}/${effort} | ${target}/${level} | |`;
  })),
].join('\n');
const projectChoices = choices(parseTable(projectTable).codex);
const v2Drawing = { routingVersion: 2, choices: projectChoices };
const evidence = { C: '여러 모듈 계약', U: '대안 검토', R: '공유 데이터', V: '통합 검사', F: '동일 작업 실패 없음' };
const v2Input = { scores: { C: 2, U: 1, R: 2, V: 1, F: 0 }, evidence };
function v2Row(agent = 'claude', mode = 'auto') {
  const r = assessRouting(v2Input, agent, projectChoices.codex);
  return { agent, model: r.model, effort: r.effort, base: r.claude, recommended: r.claude, routing: { ...r, mode } };
}
const assign = (id, row, role = 'verifier', unit = '흐름 검증') => `[역할: ${role}]\nTask: ${id} 검증\n배정: ${role} / ${unit} (${row.agent} ${row.model}${row.effort ? '/' + row.effort : ''})`;
const preflight = (f, id, input, failureDispatches) => {
  const spec = f.fs[f.map().tasks[id]?.spec] ?? Object.values(f.fs).find(body => /^Task:\s*(\S+)/m.exec(body)?.[1] === id);
  const specHash = createHash('sha256').update(spec.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd()).digest('hex');
  f.fs['check.json'] = JSON.stringify({ id, review: f.map().review, specHash, reason: '최종 역할 지침과 실제 작업 spec 대조', input, failureDispatches });
  return ['--assessment', 'check.json'];
};

// Score/evidence, the user's same-value lock and the approved Codex map survive review and registration.
await ta(async () => {
  const f = fakeDag({ fileOver: { [TABLE_PATH]: projectTable } });
  const auto = node('T01', v2Row('codex')), manual = node('T02', v2Row('claude','manual'));
  const fixed = node('T03', { fixed: true, role: 'verifier', unit: '보안·돈이 걸린 변경 리뷰', model: 'fable', effort: 'xhigh' });
  await approve(f, [auto, manual, fixed], [], 'v1', v2Drawing);
  const snapshot = JSON.parse(f.fs[approval]);
  assert.equal(snapshot.tasks.T02.routing.mode, 'manual');
  assert.ok(snapshot.tasks.T03.routing.fixed);
  f.fs['dag.json'] = JSON.stringify({ nodes: [auto, node('T02', v2Row()), fixed], edges: [], ...v2Drawing });
  assert.notEqual((await main(['review', ...reviewArgs('v1')], f.deps)).out.review, snapshot.review);
  f.fs['dag.json'] = JSON.stringify({ nodes: [auto, manual, { ...fixed, effort: 'max' }], edges: [], ...v2Drawing });
  assert.equal((await main(['review', ...reviewArgs('v2')], f.deps)).code, 1);
  f.fs['dag.json'] = JSON.stringify({ nodes: [auto, node('T02')], edges: [], ...v2Drawing });
  assert.equal((await main(['review', ...reviewArgs('v2')], f.deps)).code, 1);
  await main([...runArgs, '--approval', approval], f.deps);
  f.fs[TABLE_PATH] = projectTable.replace('gpt-6.2-astra/ultra','changed/high');
  for (const r of [auto, manual, fixed]) {
    f.fs[r.id + '.md'] = assign(r.id, r, r.role, r.unit);
    assert.equal((await main(reg(r.id, r.id + '.md'), f.deps)).code, 0);
  }
  let calls = 0;
  f.deps.classify = () => { calls++; return { scores: { R: 3 }, reason: '영속 데이터 유실 가능' }; };
  const changed = { scores: { C: 3, U: 3, R: 2, V: 3, F: 0 }, evidence: { ...evidence, V: '자동 검증 불가' },
    ambiguities: [{ axis: 'R', value: 3, evidence: '영속 데이터 유실 가능' }] };
  assert.equal((await main(go('T01'), f.deps)).code, 1);
  assert.equal((await main(go('T01', ...preflight(f,'T02')), f.deps)).code, 1);
  assert.equal((await main(go('T01', ...preflight(f,'T01',{ ...changed, scores: { ...changed.scores, F: 1 } })), f.deps)).code, 1);
  const result = await main(go('T01', ...preflight(f, 'T01', changed)), f.deps);
  assert.equal(result.code, 0, JSON.stringify(result.out));
  assert.deepEqual(result.out.requested, { runtime: 'codex', model: 'gpt-6.2-astra', effort: 'ultra' });
  assert.equal(val(f.call('worker-start'),'--effort'), 'ultra');
  assert.match(result.out.title, /astra\/ultra/);
  assert.equal(result.out.routing.assessment.haiku.status, 'classified');
  assert.equal(f.map().tasks.T01.effort, auto.effort);
  assert.equal(f.map().tasks.T01.attempts[0].review, snapshot.review);
  assert.equal(f.map().tasks.T01.attempts[0].matched, true);
  for (const [r, decision] of [[manual, 'manual'], [fixed, 'fixed']]) {
    const launch = await main(go(r.id, ...preflight(f, r.id, changed)), f.deps);
    assert.equal(launch.code, 0, JSON.stringify(launch.out));
    assert.equal(launch.out.routing.decision, decision);
    assert.equal(launch.out.requested.effort, r.effort);
  }
  assert.equal(calls, 1);
});

// The author can bind an evaluation locally. A different immutable spec or a newer approval invalidates it.
await ta(async () => {
  const f = fakeDag({ fileOver: { [TABLE_PATH]: projectTable } });
  const row = node('T01', v2Row());
  await approve(f, [row], [], 'v1', v2Drawing);
  await main([...runArgs, '--approval',approval], f.deps);
  f.fs['a.md'] = assign('T01',row);
  await main(reg('T01','a.md'), f.deps);
  const context = async version => (await main(['assessment-context','--id','T01','--spec-file','a.md','--approval',version], f.deps)).out;
  const original = { ...await context(approval), reason: '최종 지시 확인' };
  const args = go('T01','--assessment','check.json');
  f.fs['a.md'] += '\n새 입출력 조건';
  f.fs['check.json'] = JSON.stringify({ ...await context(approval), reason: '편집된 파일 검토' });
  assert.equal((await main(args, f.deps)).code, 1);
  const next = await approve(f, [row], [], 'v2', v2Drawing);
  assert.equal((await main(['reapprove',...M,'--id','T01','--approval',next], f.deps)).code, 0);
  f.fs['check.json'] = JSON.stringify(original);
  assert.equal((await main(args, f.deps)).code, 1);
  assert.equal(f.count('worker-start'), 0);
  f.fs['check.json'] = JSON.stringify({ ...await context(next), reason: '새 승인과 spec 대조' });
  const launched = await main(args, f.deps);
  assert.equal(launched.code, 0, JSON.stringify(launched.out));
  assert.notEqual(launched.out.routing.specHash, launched.out.routing.launchSpecHash);
});

// A runner or hook failure counts only if a turn started and the coordinator identifies a worker failure.
await ta(async () => {
  const f = fakeDag({ fileOver: { [TABLE_PATH]: projectTable }, dispatchStatus: 'failed' });
  const row = node('T01', v2Row());
  await approve(f, [row], [], 'v1', v2Drawing);
  await main([...runArgs,'--approval',approval], f.deps);
  f.fs['a.md'] = assign('T01',row);
  await main(reg('T01','a.md'), f.deps);
  const call = f.deps.orca;
  let i = 0;
  f.deps.orca = args => {
    const response = call(args);
    if (args[1] !== 'worker-start') return response;
    const receipt = JSON.parse(response.stdout);
    receipt.result.dispatchId = 'dispatch-' + (++i);
    if (i === 1) receipt.result.turnStart = 'unobserved';
    return { stdout: JSON.stringify(receipt) };
  };
  const first = await main(go('T01',...preflight(f,'T01')), f.deps);
  assert.equal(first.out.turnStarted, false);
  f.tasks.get(first.out.task).status = 'failed';
  const failure = { scores: { ...v2Input.scores, F: 1 }, evidence: { ...evidence, F: '실행 후 검토에서 수락 조건 누락 확인' } };
  assert.equal((await main(go('T01','--retry',...preflight(f,'T01',failure,[first.out.dispatch])), f.deps)).code, 1);
  const second = await main(go('T01','--retry',...preflight(f,'T01',v2Input)), f.deps);
  assert.equal(second.code, 0);
  f.tasks.get(first.out.task).status = 'failed';
  const third = await main(go('T01','--retry',...preflight(f,'T01',failure,[second.out.dispatch])), f.deps);
  assert.equal(third.code, 0, JSON.stringify(third.out));
  assert.equal(third.out.routing.assessment.scores.F, 1);
  f.tasks.get(first.out.task).status = 'failed';
  assert.equal((await main(go('T01','--retry',...preflight(f,'T01',v2Input)), f.deps)).code, 1);
  const fourth = await main(go('T01','--retry',...preflight(f,'T01',failure)), f.deps);
  assert.equal(fourth.code, 0);
  assert.deepEqual(fourth.out.routing.failureDispatches, [second.out.dispatch]);
});

// Ambiguous transport results never send a second worker-start. A provider mismatch persists for inspection.
await ta(async () => {
  for (const outcome of ['lost','mismatch']) {
    const f = fakeDag({ fileOver: { [TABLE_PATH]: projectTable } });
    const row = node('T01', v2Row());
    await approve(f, [row], [], 'v1', v2Drawing);
    await main([...runArgs, '--approval', approval], f.deps);
    f.fs['a.md'] = assign('T01', row);
    await main(reg('T01','a.md'), f.deps);
    const call = f.deps.orca;
    f.deps.orca = args => {
      const response = call(args);
      if (args[1] !== 'worker-start') return response;
      assert.equal(f.map().tasks.T01.attempts[0].status, 'starting');
      if (outcome === 'lost') return { stdout: '' };
      const receipt = JSON.parse(response.stdout);
      receipt.result.launch.effective.effort = 'low';
      return { stdout: JSON.stringify(receipt) };
    };
    const start = go('T01', ...preflight(f,'T01'));
    assert.equal((await main(start, f.deps)).code, 1);
    assert.equal(f.map().tasks.T01.attempts[0].matched, false);
    assert.equal((await main(start, f.deps)).code, 1);
    assert.equal(f.count('worker-start'), 1);
  }
});

// ---- A formula row (메모 not `고정`) launches only with the Task's scores ----
const FORMULA = TABLE.replace('| `frontend` | 구현 | claude | opus | medium | 고정 |', '| `frontend` | 구현 | claude | 산정 | | |')
  + '\n| `product-manager` | 기획 | claude | fable | xhigh | 고정 |';
const NEEDS_SCORES = /산정 행은 점수가 필요함: T01 \(frontend, 구현\)/;

// Approval review: a formula-row Task without routing is refused, with or without routingVersion 2 (complexity alone is not enough).
await ta(async () => {
  for (const drawing of [{}, v2Drawing]) {
    const f = fakeDag({ fileOver: { [TABLE_PATH]: FORMULA, 'plan.md': 'phase-a 실행 계획' } });
    f.fs['dag.json'] = JSON.stringify({ nodes: [node('T01', { role: 'frontend', unit: '구현', complexity: 3 })], edges: [], ...drawing });
    const r = await main(['review', ...reviewArgs('v1')], f.deps);
    assert.equal(r.code, 1);
    assert.match(r.out.error, NEEDS_SCORES);
  }
});

// worker --map: an approval with no routing for the Task, on a row that is not fixed, does not launch.
await ta(async () => {
  const f = fakeDag({ fileOver: { 'a.md': '[역할: frontend]\nTask: T01 화면\n배정: frontend / 구현 (claude opus/medium)' } });
  await approve(f, [node('T01', { role: 'frontend', unit: '구현' })]);
  await main([...runArgs, '--approval', approval], f.deps);
  assert.equal((await main(reg('T01', 'a.md'), f.deps)).code, 0);
  f.fs[TABLE_PATH] = FORMULA;
  const r = await main(go('T01'), f.deps);
  assert.equal(r.code, 1);
  assert.match(r.out.error, NEEDS_SCORES);
  assert.equal(f.count('worker-start'), 0);
});

// Ad-hoc worker on a formula row: no --assessment → refused (also with only --override-reason); with one → the formula's model/effort.
await ta(async () => {
  const argv = ['worker', '--agent', 'frontend', '--unit', '구현', '--spec-file', 'fe.md', '--bracket', 'BL-0012', '--does', '화면'];
  const fe = '[역할: frontend]\nTask: 화면\n배정: frontend / 구현 (claude sonnet/medium)';
  const scores = { input: { scores: { C: 1, U: 1, R: 1, V: 1, F: 0 }, evidence }, reason: '화면 하나의 국소 변경' };
  const f = fake({ fileOver: { [TABLE_PATH]: FORMULA, 'fe.md': fe, 'fe-x.md': fe + '\n사용자 예외: 이번만 띄워줘', 'as.json': JSON.stringify(scores) } });
  const refusal = /산정 행은 점수가 필요함 — --assessment <JSON>을 지정한다/;
  let r = await main(argv, f.deps);
  assert.equal(r.code, 1);
  assert.match(r.out.error, refusal);
  r = await main([...argv.map(a => (a === 'fe.md' ? 'fe-x.md' : a)), '--override-reason', '이번만 띄워줘'], f.deps);
  assert.equal(r.code, 1);
  assert.match(r.out.error, refusal);
  assert.equal(f.calls.length, 0);
  r = await main([...argv, '--assessment', 'as.json'], f.deps);
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.requested, { runtime: 'claude', model: 'sonnet', effort: 'medium' });
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  assert.deepEqual(['--model', '--effort'].map(k => val(ws, k)), ['sonnet', 'medium']);
});

// Ad-hoc worker on a fixed row (product-manager 기획) → the table's values, no --assessment needed.
await ta(async () => {
  const f = fake({ fileOver: { [TABLE_PATH]: FORMULA, 'pm.md': '[역할: product-manager]\nTask: 기획\n배정: product-manager / 기획 (claude fable/xhigh)' } });
  const r = await main(['worker', '--agent', 'product-manager', '--unit', '기획', '--spec-file', 'pm.md', '--bracket', 'phase-a', '--does', '기획'], f.deps);
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.requested, { runtime: 'claude', model: 'fable', effort: 'xhigh' });
});

// ---- Task kinds from the drawing's rounds ----
const T = (id, more) => node(id, { role: 'verifier', ...more });
const BUILD = { role: 'frontend', unit: '구현' };
const E = (from, to) => ({ from, to });
async function reviewError(nodes, edges, drawing = {}) {
  const f = fakeDag();
  f.fs['plan.md'] = 'phase-a 실행 계획';
  f.fs['dag.json'] = JSON.stringify({ nodes, edges, ...drawing });
  const { code, out } = await main(['review', ...reviewArgs('v1')], f.deps);
  assert.equal(code, 1, JSON.stringify(out));
  return out.error;
}
// 50. a DAG without rounds/conditional/afterFix gets none of the new fields on its Task rows
await ta(async () => {
  const f = fakeDag();
  const record = p => JSON.parse(f.fs[p]);
  const plain = await approve(f, [T('T01'), { id: 'A1', kind: 'approval' }, T('T02')],
    [E('T01', 'A1'), E('A1', 'T02'), { from: 'T02', to: 'T01', loop: true }]);
  for (const row of Object.values(record(plain).tasks))
    for (const k of ['kind', 'round', 'conditional', 'afterFix']) assert.equal(k in row, false);
  // the row exactly as the function built it before rounds existed: values and key order
  assert.equal(JSON.stringify(record(plain).tasks.T02), JSON.stringify({ agent: 'verifier', unit: '흐름 검증', runtime: 'claude',
    model: 'opus', effort: 'medium', overrideReason: null, bl: 'BL-0012', deps: ['T01'] }));
});
// 51. rounds mark kind and round; conditional: true is kept
await ta(async () => {
  const f = fakeDag();
  const record = p => JSON.parse(f.fs[p]);
  const marked = await approve(f, [T('T01'), T('Q1'), T('F1'), T('R1'), { ...T('D1'), conditional: true }],
    [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'R1'), E('R1', 'D1')], 'v1',
    { rounds: [{ n: 1, verify: ['Q1'], fix: 'F1', recheck: 'R1' }] });
  assert.deepEqual(['Q1', 'F1', 'R1'].map(id => [record(marked).tasks[id].kind, record(marked).tasks[id].round]),
    [['verify', 1], ['fix', 1], ['recheck', 1]]);
  assert.equal(record(marked).tasks.D1.conditional, true);
  assert.equal('kind' in record(marked).tasks.T01, false);
});
// 52. a verify Task waiting behind a fix Task is refused
await ta(async () => {
  assert.match(await reviewError([T('T01'), T('Q1'), T('F1'), T('Q2')], [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'Q2')],
    { rounds: [{ n: 1, verify: ['Q1', 'Q2'], fix: 'F1' }] }), /검증 Task Q2가 수정 Task F1 뒤에 걸려 있음/);
  // behind it through a plain Task as well
  assert.match(await reviewError([T('Q1'), T('F1'), T('T02'), T('Q2')], [E('Q1', 'F1'), E('F1', 'T02'), E('T02', 'Q2')],
    { rounds: [{ n: 1, verify: ['Q1', 'Q2'], fix: 'F1' }] }), /검증 Task Q2가 수정 Task F1 뒤에 걸려 있음/);
});
// 53. a verify Task that gives afterFix passes and keeps the reason; afterFix that is not a non-empty string is refused
await ta(async () => {
  const f = fakeDag();
  const record = p => JSON.parse(f.fs[p]);
  const reason = '고친 빌드가 있어야 볼 수 있는 실기기 회차';
  const nodes = [T('T01'), T('Q1'), T('F1'), T('Q2', { afterFix: reason })];
  const edges = [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'Q2')];
  const rounds = { rounds: [{ n: 1, verify: ['Q1', 'Q2'], fix: 'F1' }] };
  const done = await approve(f, nodes, edges, 'v1', rounds);
  assert.equal(record(done).tasks.Q2.afterFix, reason);
  assert.equal(record(done).tasks.Q2.kind, 'verify');
  for (const afterFix of ['', true, null, 3]) {
    assert.match(await reviewError([...nodes.slice(0, 3), T('Q2', { afterFix })], edges, rounds), /afterFix/, String(afterFix));
  }
});
// 54. three fix Tasks on one dependency path are refused; two pass
await ta(async () => {
  const chain = ['F1', 'R1', 'F2', 'R2', 'F3'];
  const rounds = [{ n: 1, fix: 'F1', recheck: 'R1' }, { n: 2, fix: 'F2', recheck: 'R2' }, { n: 3, fix: 'F3' }];
  const edges = chain.slice(1).map((id, i) => E(chain[i], id));
  assert.match(await reviewError(chain.map(id => T(id)), edges, { rounds }), /수정 Task 사슬이 2단을 넘음/);
  const f = fakeDag();
  await approve(f, chain.slice(0, 4).map(id => T(id)), edges.slice(0, 3), 'v1', { rounds: rounds.slice(0, 2) });
});
// 55. rounds naming an id that is not an executable Task is refused
await ta(async () => {
  const nodes = [T('T01'), { id: 'A1', kind: 'approval' }];
  for (const id of ['Q9', 'A1', 'constructor'])
    assert.match(await reviewError(nodes, [E('T01', 'A1')], { rounds: [{ n: 1, verify: id }] }), /rounds가 가리키는 노드 없음/, id);
});
// 56. a Task named more than once across rounds is refused, whatever the role or round
await ta(async () => {
  const nodes = [T('Q1'), T('F1'), T('Q2')];
  const edges = [E('Q1', 'F1'), E('F1', 'Q2')];
  for (const rounds of [
    [{ n: 1, verify: ['Q1', 'Q1'] }],
    [{ n: 1, verify: 'Q2', fix: 'F1' }, { n: 2, recheck: 'Q2' }], // would hide Q2's verify-after-fix
    [{ n: 1, fix: 'F1', recheck: 'F1' }],
  ]) assert.match(await reviewError(nodes, edges, { rounds }), /rounds에 같은 Task가 두 번 나옴/, JSON.stringify(rounds));
});

// ---- skip: close a planned Task that has nothing to do ----
const planSpec = (id, what, role = 'verifier', unit = '흐름 검증') => `[역할: ${role}]\nTask: ${id} ${what}\n배정: ${role} / ${unit} (claude opus/medium)`;
const built = (id, what) => planSpec(id, what, BUILD.role, BUILD.unit);
const skip = (id, reason = '문서 영향 없음') => ['skip', ...M, '--id', id, '--reason', reason];
// T01 → D1(conditional) → P1, plus the extra edges given
async function skipPlan(edges = [], drawing = {}, nodes = []) {
  const f = fakeDag({ fileOver: { 'a.md': built('T01', '로그인 흐름'), 'b.md': built('T02', '결제 흐름'), 'd.md': planSpec('D1', '문서 동기화'), 'p.md': planSpec('P1', '배포 점검') } });
  await approve(f, [T('T01', BUILD), T('D1', { conditional: true }), T('P1'), ...nodes], [E('T01', 'D1'), E('D1', 'P1'), ...edges], 'v1', drawing);
  await main([...runArgs, '--approval', approval], f.deps);
  return f;
}
// a refusal makes no state-changing Orca call and leaves the map as it was
async function refused(f, args, error) {
  const before = [f.count('task-create'), f.count('task-update'), f.fs['orca-tasks.json']];
  const { code, out } = await main(args, f.deps);
  assert.equal(code, 1, JSON.stringify(out));
  assert.match(out.error, error);
  assert.deepEqual([f.count('task-create'), f.count('task-update'), f.fs['orca-tasks.json']], before);
}
// 57. skip an unregistered conditional Task: refused when unmarked or its inputs are unregistered; then created, closed, never launched
await ta(async () => {
  const f = await skipPlan();
  // 1. a Task without a mark cannot be skipped. Nothing changes
  const no = await main(skip('T01', '필요 없음'), f.deps);
  assert.equal(no.code, 1); assert.match(no.out.error, /건너뛸 수 있는 Task가 아님/);
  assert.equal(f.count('task-update'), 0);
  // the reason is required and not blank
  await refused(f, ['skip', ...M, '--id', 'D1'], /사용법: skip --map <map> --id <T01> --reason <사유>/);
  await refused(f, skip('D1', '  '), /사용법: skip/);
  // 2. an input that is not registered yet is refused
  assert.match((await main(skip('D1'), f.deps)).out.error, /미등록 선행 Task: T01/);
  await refused(f, skip('D1'), /미등록 선행 Task: T01/);
  // 3. skipped without registering: Orca gets a Task that is shown as finished
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const ok = await main(skip('D1'), f.deps);
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.deepEqual(ok.out, { id: 'D1', skipped: true, promoted: [] });
  const { T01, D1 } = f.map().tasks;
  assert.equal(f.tasks.get(D1.orca).status, 'completed');
  assert.equal(D1.skipped.reason, '문서 영향 없음');
  assert.equal(D1.skipped.at, T0);
  assert.match(f.tasks.get(D1.orca).spec, /건너뜀: 문서 영향 없음/);
  assert.equal(f.tasks.get(D1.orca).spec, `Task: D1 건너뜀\n건너뜀: 문서 영향 없음\n\n실행 승인: ${f.map().review} D1\n`);
  assert.deepEqual(f.tasks.get(D1.orca).deps, [T01.orca]);
  assert.deepEqual(D1.registeredDeps, [T01.orca]);
  assert.equal(val(f.call('task-update'), '--result'), '건너뜀: 문서 영향 없음');
  assert.equal(D1.dispatch, null);
  // 5. a skipped Task cannot be launched and is not in actual
  assert.match((await main(go('D1'), f.deps)).out.error, /건너뛴 Task/);
  assert.equal(f.count('worker-start'), 0);
  assert.equal((await main(['actual', ...M], f.deps)).out.some(r => r.id === 'D1'), false);
  // 4. a successor registers against the skipped Task's Orca id, which is completed
  const p = await main(reg('P1', 'p.md'), f.deps);
  assert.equal(p.code, 0, JSON.stringify(p.out));
  assert.deepEqual(f.tasks.get(f.map().tasks.P1.orca).deps, [D1.orca]);
});
// 58. skip a registered, waiting Task: dependents that are pending with every input completed become ready, others stay
await ta(async () => {
  // P1 also waits on T02: while T02 is unfinished, skipping D1 promotes nothing
  const both = async () => {
    const f = await skipPlan([E('T02', 'P1')], {}, [T('T02', BUILD)]);
    for (const [id, file] of [['T01', 'a.md'], ['T02', 'b.md'], ['D1', 'd.md'], ['P1', 'p.md']]) await main(reg(id, file), f.deps);
    f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
    return f;
  };
  const f = await both();
  const wait = await main(skip('D1'), f.deps);
  assert.equal(wait.code, 0, JSON.stringify(wait.out));
  assert.deepEqual(wait.out.promoted, []);
  assert.equal(f.tasks.get(f.map().tasks.D1.orca).status, 'completed');
  assert.equal(f.tasks.get(f.map().tasks.P1.orca).status, 'pending');
  // with T02 completed too, P1 is promoted by skip itself
  const g = await both();
  g.tasks.get(g.map().tasks.T02.orca).status = 'completed';
  const ok = await main(skip('D1'), g.deps);
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.deepEqual(ok.out, { id: 'D1', skipped: true, promoted: ['P1'] });
  assert.equal(g.tasks.get(g.map().tasks.P1.orca).status, 'ready');
  assert.equal(g.map().tasks.D1.skipped.reason, '문서 영향 없음');
  assert.equal('skipping' in g.map().tasks.D1, false);
  assert.equal(g.count('task-create'), 4);
});
// 59. fix and recheck Tasks can be skipped without the conditional mark; a verify Task cannot
await ta(async () => {
  const f = await skipPlan([], { rounds: [{ n: 1, verify: 'Q1', fix: 'F1', recheck: 'R1' }] }, [T('Q1'), T('F1', BUILD), T('R1')]);
  await refused(f, skip('Q1', '결함 없음'), /건너뛸 수 있는 Task가 아님/);
  for (const id of ['F1', 'R1']) {
    const { code, out } = await main(skip(id, '결함 없음'), f.deps);
    assert.equal(code, 0, JSON.stringify(out));
    assert.equal(f.tasks.get(f.map().tasks[id].orca).status, 'completed');
  }
});
// 60. 6. a registered Task that has started, finished, has a gate or is in transition is refused
await ta(async () => {
  const setup = async () => {
    const f = await skipPlan();
    await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
    await main(reg('D1', 'd.md'), f.deps);
    return f;
  };
  const started = await setup();
  started.tasks.get(started.map().tasks.D1.orca).status = 'ready';
  assert.equal((await main(go('D1'), started.deps)).code, 0);
  await refused(started, skip('D1'), /이미 기동했거나 끝난 Task/);
  const done = await setup();
  done.tasks.get(done.map().tasks.D1.orca).status = 'completed';
  await refused(done, skip('D1'), /이미 기동했거나 끝난 Task/);
  const gated = await setup();
  await main(['gate', ...M, '--id', 'D1', '--question', '진행할까?'], gated.deps);
  await refused(gated, skip('D1'), /이미 기동했거나 끝난 Task/);
  const moving = await setup();
  const m = moving.map(); m.transition = { id: 'D1', approval, from: m.tasks.D1.orca };
  moving.fs['orca-tasks.json'] = JSON.stringify(m);
  await refused(moving, skip('D1'), /이미 기동했거나 끝난 Task/);
});
// 61. 7. skipping twice returns the first result and changes nothing in Orca
await ta(async () => {
  const f = await skipPlan();
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  await main(skip('D1'), f.deps);
  const before = [f.count('task-create'), f.count('task-update'), f.fs['orca-tasks.json']];
  const again = await main(skip('D1', '다른 사유'), f.deps);
  assert.equal(again.code, 0, JSON.stringify(again.out));
  assert.deepEqual(again.out, { id: 'D1', skipped: true, existing: true, promoted: [] });
  assert.deepEqual([f.count('task-create'), f.count('task-update'), f.fs['orca-tasks.json']], before);
});
// 61b. one conditional 시험 갱신 Task per building agent: the one that received failures launches, the other is skipped,
// and end verification waits on both under the existing rules
await ta(async () => {
  const f = fakeDag({ fileOver: {
    [TABLE_PATH]: `${TABLE}\n| \`frontend\` | 시험 갱신 | claude | opus | medium | 고정 |\n| \`backend\` | 구현, 시험 갱신 | claude | opus | medium | 고정 |`,
    [ROSTER_FILES[0]]: `${ROSTER}\n| \`backend\` | 서버 | \`backend\` | api/ |`,
    'fe.md': built('T01', '화면'), 'be.md': planSpec('T02', '서버', 'backend', '구현'),
    'u1.md': planSpec('U1', '시험 갱신', 'frontend', '시험 갱신'), 'u2.md': planSpec('U2', '시험 갱신', 'backend', '시험 갱신'),
    'q.md': planSpec('Q1', '끝 검증'),
  } });
  const update = { unit: '시험 갱신', conditional: true };
  await approve(f, [T('T01', BUILD), T('T02', { role: 'backend', unit: '구현' }), T('U1', { ...update, role: 'frontend' }), T('U2', { ...update, role: 'backend' }), T('Q1')],
    [E('T01', 'U1'), E('T02', 'U2'), E('U1', 'Q1'), E('U2', 'Q1')]);
  assert.equal((await main([...runArgs, '--approval', approval], f.deps)).code, 0);
  for (const [id, file] of [['T01', 'fe.md'], ['T02', 'be.md'], ['U1', 'u1.md'], ['U2', 'u2.md'], ['Q1', 'q.md']]) {
    const r = await main(reg(id, file), f.deps);
    assert.equal(r.code, 0, JSON.stringify(r.out));
  }
  const status = (id, s) => { f.tasks.get(f.map().tasks[id].orca).status = s; };
  status('T01', 'completed'); status('T02', 'completed'); status('U1', 'ready');
  const launched = await main(go('U1'), f.deps);
  assert.equal(launched.code, 0, JSON.stringify(launched.out));
  const skipped = await main(skip('U2', '실패 없음'), f.deps);
  assert.equal(skipped.code, 0, JSON.stringify(skipped.out));
  assert.deepEqual(skipped.out.promoted, []);
  status('U1', 'completed'); status('Q1', 'ready');
  assert.equal((await main(go('Q1'), f.deps)).code, 0);
  assert.equal(f.count('worker-start'), 2);
});
// 62. 8. a map with no approval record is refused before Orca is touched
await ta(async () => {
  const f = fakeDag();
  f.fs['orca-tasks.json'] = JSON.stringify({ run: 'run_exec', phase: 'phase-a', tasks: {} });
  await refused(f, skip('D1'), /건너뛸 수 있는 Task가 아님/);
  assert.equal(f.calls.length, 0);
});
// 63. register makes a Task created pending ready itself when every input is completed (the fake creates it pending)
await ta(async () => {
  const f = await skipPlan();
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  await main(skip('D1'), f.deps);
  const p = await main(reg('P1', 'p.md'), f.deps);
  assert.equal(p.code, 0, JSON.stringify(p.out));
  assert.equal(p.out.status, 'ready');
  assert.equal(f.tasks.get(p.out.orca).status, 'ready');
  // registering again is the existing path: nothing more happens
  const updates = f.count('task-update');
  assert.equal((await main(reg('P1', 'p.md'), f.deps)).out.existing, true);
  assert.equal(f.count('task-update'), updates);
});
// 64. register leaves a new Task pending while an input is unfinished
await ta(async () => {
  const f = await skipPlan([E('T02', 'P1')], {}, [T('T02', BUILD)]);
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  await main(reg('T02', 'b.md'), f.deps);
  await main(skip('D1'), f.deps);
  const updates = f.count('task-update');
  const p = await main(reg('P1', 'p.md'), f.deps);
  assert.equal(p.code, 0, JSON.stringify(p.out));
  assert.equal(p.out.status, 'pending');
  assert.equal(f.tasks.get(p.out.orca).status, 'pending');
  assert.equal(f.count('task-update'), updates);
});
// 65. skip reuses an Orca Task that already carries its approval marker (a lost task-create reply); two such Tasks are refused
await ta(async () => {
  const f = await skipPlan();
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const marker = `실행 승인: ${f.map().review} D1`;
  f.tasks.set('task_lost', { status: 'ready', deps: [f.map().tasks.T01.orca], spec: `Task: D1 건너뜀\n건너뜀: 문서 영향 없음\n\n${marker}\n` });
  const creates = f.count('task-create');
  const ok = await main(skip('D1'), f.deps);
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.equal(f.count('task-create'), creates);
  assert.equal(f.map().tasks.D1.orca, 'task_lost');
  assert.equal(f.tasks.get('task_lost').status, 'completed');
  const g = await skipPlan();
  await main(reg('T01', 'a.md'), g.deps); g.tasks.get(g.map().tasks.T01.orca).status = 'completed';
  for (const id of ['task_lost1', 'task_lost2']) g.tasks.set(id, { status: 'pending', deps: [], spec: `x\n\n실행 승인: ${g.map().review} D1\n` });
  await refused(g, skip('D1'), /같은 승인 Task가 여러 번 등록됨: D1/);
});
// 66. skipping again repairs a dependent left pending: it is made ready and listed, the skipped Task is not touched
await ta(async () => {
  const f = await skipPlan();
  for (const [id, file] of [['T01', 'a.md'], ['D1', 'd.md'], ['P1', 'p.md']]) await main(reg(id, file), f.deps);
  f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  await main(skip('D1'), f.deps);
  const { D1, P1 } = f.map().tasks;
  f.tasks.get(P1.orca).status = 'pending';
  const creates = f.count('task-create');
  const again = await main(skip('D1', '다른 사유'), f.deps);
  assert.equal(again.code, 0, JSON.stringify(again.out));
  assert.deepEqual(again.out, { id: 'D1', skipped: true, existing: true, promoted: ['P1'] });
  assert.equal(f.tasks.get(P1.orca).status, 'ready');
  assert.equal(f.count('task-create'), creates);
  assert.equal(f.calls.filter((a) => a[1] === 'task-update' && val(a, '--id') === D1.orca).length, 1);
  assert.equal(f.map().tasks.D1.skipped.reason, '문서 영향 없음');
});
// The close (task-update --status completed) gets an unparsable reply; `applied` says whether Orca still made the change.
function loseClose(f, applied) {
  const call = f.deps.orca;
  f.deps.orca = (args) => {
    if (args[1] !== 'task-update' || val(args, '--status') !== 'completed') return call(args);
    if (applied) call(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  return () => { f.deps.orca = call; };
}
// 67. a close applied in Orca whose reply was lost: the entry keeps `skipping`; a re-run records `skipped` and promotes, with no second create or close
await ta(async () => {
  const f = await skipPlan();
  for (const [id, file] of [['T01', 'a.md'], ['D1', 'd.md'], ['P1', 'p.md']]) await main(reg(id, file), f.deps);
  f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const { D1, P1 } = f.map().tasks;
  const restore = loseClose(f, true);
  const lost = await main(skip('D1'), f.deps);
  restore();
  assert.equal(lost.code, 1);
  assert.match(lost.out.error, /task-update 실패/);
  assert.equal(f.tasks.get(D1.orca).status, 'completed');
  assert.deepEqual(f.map().tasks.D1.skipping, { reason: '문서 영향 없음' });
  assert.equal('skipped' in f.map().tasks.D1, false);
  const seen = f.calls.length;
  const again = await main(skip('D1', '다른 사유'), f.deps);
  assert.equal(again.code, 0, JSON.stringify(again.out));
  assert.deepEqual(again.out, { id: 'D1', skipped: true, promoted: ['P1'] });
  assert.equal(f.map().tasks.D1.skipped.reason, '문서 영향 없음');
  assert.equal('skipping' in f.map().tasks.D1, false);
  assert.equal(f.tasks.get(P1.orca).status, 'ready');
  // the only update on the re-run is P1's promotion
  assert.deepEqual(f.calls.slice(seen).filter((a) => a[1] === 'task-update').map((a) => val(a, '--id')), [P1.orca]);
  // an unregistered Task: the re-run makes no second create
  const g = await skipPlan();
  await main(reg('T01', 'a.md'), g.deps); g.tasks.get(g.map().tasks.T01.orca).status = 'completed';
  const back = loseClose(g, true);
  assert.equal((await main(skip('D1'), g.deps)).code, 1);
  back();
  const creates = g.count('task-create');
  const done = await main(skip('D1'), g.deps);
  assert.equal(done.code, 0, JSON.stringify(done.out));
  assert.equal(g.count('task-create'), creates);
  assert.equal(g.map().tasks.D1.skipped.reason, '문서 영향 없음');
});
// 68. while the close has not landed, worker --map refuses the `skipping` Task and launchable neither launches nor lists it
await ta(async () => {
  const f = await skipPlan();
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  await main(reg('D1', 'd.md'), f.deps);
  const restore = loseClose(f, false);
  assert.equal((await main(skip('D1'), f.deps)).code, 1);
  restore();
  assert.equal(f.tasks.get(f.map().tasks.D1.orca).status, 'ready');
  assert.ok(f.map().tasks.D1.skipping);
  assert.match((await main(go('D1'), f.deps)).out.error, /건너뛴 Task/);
  assert.equal(f.count('worker-start'), 0);
  const l = await main(['launchable', ...M], f.deps);
  assert.equal(l.code, 0, JSON.stringify(l.out));
  assert.equal(l.out.launch.includes('D1'), false);
  assert.equal(l.out.candidates.some((c) => c.id === 'D1'), false);
  f.tasks.get(f.map().tasks.D1.orca).status = 'pending';
  assert.equal((await main(['launchable', ...M], f.deps)).out.candidates.some((c) => c.id === 'D1'), false);
  // a re-run closes it
  const again = await main(skip('D1'), f.deps);
  assert.equal(again.code, 0, JSON.stringify(again.out));
  assert.equal(f.tasks.get(f.map().tasks.D1.orca).status, 'completed');
});
// 69. a registered but unfinished input is refused with no Orca change, whether or not the Task is registered
await ta(async () => {
  const f = await skipPlan();
  await main(reg('T01', 'a.md'), f.deps);
  await refused(f, skip('D1'), /선행 Task가 끝나지 않음: T01/);
  await main(reg('D1', 'd.md'), f.deps);
  await refused(f, skip('D1'), /선행 Task가 끝나지 않음: T01/);
});
// 70. register promotes from Orca's listed status when the create receipt carries none
await ta(async () => {
  const f = await skipPlan();
  const call = f.deps.orca;
  f.deps.orca = (args) => {
    const r = call(args);
    if (args[1] !== 'task-create') return r;
    const out = JSON.parse(r.stdout);
    return { ...r, stdout: JSON.stringify({ ok: true, result: { taskId: out.result.task.id } }) };
  };
  await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
  const d = await main(reg('D1', 'd.md'), f.deps);
  assert.equal(d.code, 0, JSON.stringify(d.out));
  assert.equal(d.out.status, 'ready');
  assert.equal(f.tasks.get(d.out.orca).status, 'ready');
});

// ---- refusals before launch: fix Tasks, verification after a fix, full tests in the completion criteria ----
const LEDGER = (rows, decisions = []) => ['## 결함 원장', '', '| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |', '| --- | --- | --- | --- | --- | --- |',
  ...rows, '', '## 결정', '', ...decisions, ''].join('\n');
const H1 = '| H-1 | Q1 | High | 관찰 — 중대한 피해: 주문 데이터 유실 | 1 | 열림 |', M1 = '| M-1 | Q1 | Medium | 관찰 | 1 | 열림 |';
const FIX_NO_IDS = '수정 Task의 결함 ID 줄이 없음', POST_FIX = '수정 뒤의 검증은 결함 ID와 수정 diff가 필요함', NO_LEDGER = '장부를 읽을 수 없음';
// T01 → Q1(verify) → F1(fix) → R1(recheck)
// with q2 (true, or the Q2 node's extra fields), a second verify Task Q2 hangs off T01 beside Q1 (not behind F1); verify2 is added to its spec
async function roundPlan({ ledger = LEDGER([H1, M1]), q1 = {}, r1 = {}, rounds = true, fix = '', recheck = '', q2 = false, verify2 = '' } = {}) {
  const f = fakeDag({ fileOver: { 'a.md': built('T01', '로그인 흐름'), 'q.md': planSpec('Q1', '흐름 검증'),
    'q2.md': planSpec('Q2', '추가 검증') + verify2, 'f.md': built('F1', '결함 수정') + fix, 'r.md': planSpec('R1', '재검') + recheck } });
  if (ledger !== null) f.fs['ledger.md'] = ledger;
  await approve(f, [T('T01', BUILD), T('Q1', q1), T('F1', BUILD), T('R1', r1), ...(q2 ? [T('Q2', q2 === true ? {} : q2)] : [])],
    [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'R1'), ...(q2 ? [E('T01', 'Q2')] : [])], 'v1',
    rounds ? { rounds: [{ n: 1, verify: q2 ? ['Q1', 'Q2'] : ['Q1'], fix: 'F1', recheck: 'R1' }] } : {});
  await main([...runArgs, '--approval', approval], f.deps);
  const done = (id) => { f.tasks.get(f.map().tasks[id].orca).status = 'completed'; };
  const launch = async (args) => { const r = await main(args, f.deps); assert.equal(r.code, 0, JSON.stringify(r.out)); };
  await launch(reg('T01', 'a.md'));
  done('T01');
  await launch(reg('Q1', 'q.md'));
  if (q2) await launch(reg('Q2', 'q2.md'));
  return { f, done, launch };
}
// T01 and Q1 done, F1 registered and ready
async function atFix(opts) {
  const p = await roundPlan(opts);
  await p.launch(go('Q1'));
  p.done('Q1');
  await p.launch(reg('F1', 'f.md'));
  return p;
}
// F1 launched and done, R1 registered and ready
async function atRecheck(opts) {
  const p = await atFix({ fix: '\n결함 ID: H-1', ...opts });
  await p.launch(go('F1'));
  p.done('F1');
  await p.launch(reg('R1', 'r.md'));
  return p;
}
// refused with this exact message: no worker started, no Orca status change, the map as it was
async function refusedLaunch(f, args, error) {
  const before = [f.count('worker-start'), f.count('task-update'), f.fs['orca-tasks.json']];
  const { code, out } = await main(args, f.deps);
  assert.equal(code, 1, JSON.stringify(out));
  assert.equal(out.error, error);
  assert.deepEqual([f.count('worker-start'), f.count('task-update'), f.fs['orca-tasks.json']], before);
}
// 71. fix Task: 1. no `결함 ID:` line → refused
await ta(async () => {
  const { f } = await atFix();
  await refusedLaunch(f, go('F1'), FIX_NO_IDS);
  // an empty list counts as missing
  const g = (await atFix({ fix: '\n결함 ID: ,' })).f;
  await refusedLaunch(g, go('F1'), FIX_NO_IDS);
});
// 72. fix Task: 2. a Medium ID is refused and named with its reason
await ta(async () => {
  const { f } = await atFix({ fix: '\n결함 ID: H-1, M-1' });
  await refusedLaunch(f, go('F1'), '수정에 넣을 수 없는 결함: M-1(Medium는 수정 포함 승인이 필요함)');
});
// 73. fix Task: 3. only open High IDs → launched
await ta(async () => {
  const { f, launch } = await atFix({ fix: '\n결함 ID: H-1' });
  await launch(go('F1'));
  assert.equal(f.count('worker-start'), 2);
});
// 74. fix Task: 4. a Medium ID with a `수정 포함 승인` decision → launched
await ta(async () => {
  const { f, launch } = await atFix({ fix: '\n결함 ID: H-1, M-1', ledger: LEDGER([H1, M1], ['- M-1 | 수정 포함 승인 | 이것도 같이 고쳐 주세요']) });
  await launch(go('F1'));
  assert.equal(f.count('worker-start'), 2);
});
// 75. fix Task: 5. no ledger file → refused with a message, nothing thrown
await ta(async () => {
  const { f } = await atFix({ fix: '\n결함 ID: H-1', ledger: null });
  await refusedLaunch(f, go('F1'), NO_LEDGER);
});
// 76. 6. before any fix round, the verify Tasks Q1 and Q2 launch without `결함 ID:`
await ta(async () => {
  const { f, launch } = await roundPlan({ q2: true });
  await launch(go('Q1'));
  await launch(go('Q2'));
  assert.equal(f.count('worker-start'), 2);
});
// 77. 7. after F1 launched, R1 needs both `결함 ID:` and `수정 diff:`
await ta(async () => {
  for (const recheck of ['', '\n결함 ID: H-1', '\n수정 diff: _workspace/fix.diff', '\n결함 ID: H-1\n수정 diff:  ']) {
    const { f } = await atRecheck({ recheck });
    await refusedLaunch(f, go('R1'), POST_FIX);
  }
  const { f, launch } = await atRecheck({ recheck: '\n결함 ID: H-1\n수정 diff: _workspace/fix.diff' });
  await launch(go('R1'));
  assert.equal(f.count('worker-start'), 3);
});
// 78. 8. after F1 launched, the second verify Task Q2 without `결함 ID:` is refused; with both lines it launches
await ta(async () => {
  const { f } = await atRecheck({ q2: true, verify2: '\n수정 diff: _workspace/fix.diff' });
  await refusedLaunch(f, go('Q2'), POST_FIX);
  const { launch } = await atRecheck({ q2: true, verify2: '\n결함 ID: H-1\n수정 diff: _workspace/fix.diff' });
  await launch(go('Q2'));
});
// 79. 9. a `전 범위 검증 승인` decision for the Task, or afterFix on its row, lets 7 and 8 pass
await ta(async () => {
  const wide = (id) => LEDGER([H1, M1], [`- ${id} | 전 범위 검증 승인 | 전체를 다시 봐 주세요`]);
  await (async () => { const { launch } = await atRecheck({ ledger: wide('R1') }); await launch(go('R1')); })();
  await (async () => { const { launch } = await atRecheck({ r1: { afterFix: '고친 빌드 전체 재검' } }); await launch(go('R1')); })();
  // a decision for another Task does not count
  await (async () => { const { f } = await atRecheck({ ledger: wide('T01') }); await refusedLaunch(f, go('R1'), POST_FIX); })();
  // a decision line with no answer does not count
  await (async () => { const { f } = await atRecheck({ ledger: LEDGER([H1], ['- R1 | 전 범위 검증 승인 |']) }); await refusedLaunch(f, go('R1'), POST_FIX); })();
  for (const opts of [{ q2: true, ledger: wide('Q2') }, { q2: { afterFix: '고친 빌드 전체 재검' } }]) {
    const { launch } = await atRecheck(opts);
    await launch(go('Q2'));
  }
});
// 80. 10. an approval without kind refuses none of the above, even with no ledger
await ta(async () => {
  const { f, launch } = await atFix({ rounds: false, q2: true, ledger: null });
  assert.equal('kind' in JSON.parse(f.fs[approval]).tasks.F1, false);
  await launch(go('F1'));
  f.tasks.get(f.map().tasks.F1.orca).status = 'completed';
  await launch(reg('R1', 'r.md'));
  await launch(go('R1'));
  await launch(go('Q2'));
});
// full tests in the completion criteria: AGENTS.md marks them in `## 명령`
const AGENTS = ['# 공통 지침', '', '## 명령', '', '- `npm test` — 저장소 전체 (전체 테스트)', '- `npm run lint` — 린트', '',
  '## 기술 스택', '', '- `npm run e2e` (전체 테스트) 이 절의 표시는 보지 않는다'].join('\n');
const criteria = (...lines) => ['[역할: verifier]', 'Task: T01 로그인 흐름', '금지: npm test 를 돌리지 않는다', '배정: verifier / 흐름 검증 (claude opus/medium)', '', ...lines].join('\n');
// 81. 11. a marked command inside `완료 기준:` (up to 검증 환경값 / 막히면: / 보고:) → register refused
await ta(async () => {
  for (const spec of [criteria('완료 기준: npm test 통과'), criteria('완료 기준:', '- npm run lint 통과', '- npm test 통과', '보고: 리포트')]) {
    const f = fakeDag({ fileOver: { 'AGENTS.md': AGENTS, 'a.md': spec } });
    await execRun(f);
    const before = f.count('task-create');
    const { code, out } = await main(reg('T01', 'a.md'), f.deps);
    assert.equal(code, 1, JSON.stringify(out));
    assert.equal(out.error, '완료 기준에 전체 테스트 명령이 있음: npm test');
    assert.equal(f.count('task-create'), before);
  }
});
// 82. 12. the same command only on `금지:`, after the region, or marked outside `## 명령` → registered
await ta(async () => {
  const spec = criteria('완료 기준: npm run e2e 통과', '검증 환경값(설정값): 없음', '막히면: npm test 실패면 ask', '보고: npm test 결과는 (참고)');
  const f = fakeDag({ fileOver: { 'AGENTS.md': AGENTS, 'a.md': spec } });
  await execRun(f);
  const { code, out } = await main(reg('T01', 'a.md'), f.deps);
  assert.equal(code, 0, JSON.stringify(out));
});
// 83. 13. no AGENTS.md, or no mark in it → registered
await ta(async () => {
  for (const agents of [undefined, AGENTS.replace(' (전체 테스트)\n', '\n'), '# 공통 지침\n\n- `npm test` (전체 테스트)']) {
    const f = fakeDag({ fileOver: { 'a.md': criteria('완료 기준: npm test 통과') } });
    if (agents !== undefined) f.fs['AGENTS.md'] = agents;
    await execRun(f);
    const { code, out } = await main(reg('T01', 'a.md'), f.deps);
    assert.equal(code, 0, JSON.stringify(out));
  }
});
// 84. a marked command counts only as a whole command: a narrower or different command passes
await ta(async () => {
  const cases = [['npm test -- src/login.test.ts', 0], ['npm test src/a.test.js', 0], ['pnpm test', 0], ['npm test', 1], ['`npm test`', 1],
    ['npm test 통과', 1], ['npm test → 0 failed', 1], ['npm test && npm run lint', 1], ['npm test 2>&1', 1]];
  for (const [command, code] of cases) {
    const f = fakeDag({ fileOver: { 'AGENTS.md': AGENTS, 'a.md': criteria(`완료 기준: ${command}`) } });
    await execRun(f);
    const r = await main(reg('T01', 'a.md'), f.deps);
    assert.equal(r.code, code, command + ' ' + JSON.stringify(r.out));
    if (code) assert.equal(r.out.error, '완료 기준에 전체 테스트 명령이 있음: npm test');
  }
});
// 85. launching the fix Task starts the fix round: a following verify launch without the two lines is refused
await ta(async () => {
  const { f, done, launch } = await roundPlan({ q2: true, fix: '\n결함 ID: H-1' });
  await launch(go('Q1'));
  done('Q1');
  await launch(reg('F1', 'f.md'));
  await launch(go('F1'));
  await refusedLaunch(f, go('Q2'), POST_FIX);
});
// 87. worker --map --retry: a verify Task retried after the fix round started, with no decision line, is refused
await ta(async () => {
  const { f, done, launch } = await roundPlan({ q2: true, fix: '\n결함 ID: H-1' });
  await launch(go('Q1'));
  await launch(go('Q2'));
  f.tasks.get(f.map().tasks.Q2.orca).status = 'failed';
  done('Q1');
  await launch(reg('F1', 'f.md'));
  await launch(go('F1'));
  await refusedLaunch(f, go('Q2', '--retry'), POST_FIX);
});

// 88. two rounds: round 2 names round 1's recheck as its verify; it stays recheck of round 1. Other repeats stay refused
await ta(async () => {
  const f = fakeDag();
  const record = p => JSON.parse(f.fs[p]);
  const chain = ['Q1', 'F1', 'R1', 'F2', 'R2'];
  const nodes = chain.map(id => T(id)), edges = chain.slice(1).map((id, i) => E(chain[i], id));
  const two = verify => [{ n: 1, verify: 'Q1', fix: 'F1', recheck: 'R1' }, { n: 2, verify, fix: 'F2', recheck: 'R2' }];
  const done = await approve(f, nodes, edges, 'v1', { rounds: two('R1') });
  assert.deepEqual([record(done).tasks.R1.kind, record(done).tasks.R1.round], ['recheck', 1]);
  assert.deepEqual([record(done).tasks.R2.kind, record(done).tasks.R2.round], ['recheck', 2]);
  for (const id of ['F1', 'Q1'])
    assert.match(await reviewError(nodes, edges, { rounds: two(id) }), new RegExp(`rounds에 같은 Task가 두 번 나옴: ${id}`), id);
});
// 89. a third fix Task on one path passes only with afterFix, and is still launched under the fix-Task rules
await ta(async () => {
  const chain = ['T01', 'Q1', 'F1', 'R1', 'F2', 'R2', 'F3'];
  const edges = chain.slice(1).map((id, i) => E(chain[i], id));
  const rounds = [{ n: 1, verify: 'Q1', fix: 'F1', recheck: 'R1' }, { n: 2, verify: 'R1', fix: 'F2', recheck: 'R2' }, { n: 3, fix: 'F3' }];
  const reason = '사용자가 3회차 수정을 승인함';
  assert.match(await reviewError(chain.map(id => T(id)), edges, { rounds }), /수정 Task 사슬이 2단을 넘음: F3/);
  const builds = id => id === 'T01' || id.startsWith('F');
  const f = fakeDag({ fileOver: Object.fromEntries(chain.map(id => [`${id}.md`, builds(id) ? built(id, '작업') : planSpec(id, '작업')])) });
  f.fs['ledger.md'] = LEDGER([H1]);
  await approve(f, chain.map(id => T(id, { ...(builds(id) ? BUILD : {}), ...(id === 'F3' ? { afterFix: reason } : {}) })), edges, 'v1', { rounds });
  assert.equal(JSON.parse(f.fs[approval]).tasks.F3.afterFix, reason);
  await main([...runArgs, '--approval', approval], f.deps);
  for (const id of chain) {
    const r = await main(reg(id, `${id}.md`), f.deps);
    assert.equal(r.code, 0, JSON.stringify(r.out));
    if (id !== 'F3') f.tasks.get(f.map().tasks[id].orca).status = 'completed';
  }
  await refusedLaunch(f, go('F3'), FIX_NO_IDS);
});
// 90. conditional is refused on a rounds verify Task; kept on a fix Task and on a Task outside rounds
await ta(async () => {
  const chain = ['T01', 'Q1', 'F1'];
  const edges = chain.slice(1).map((id, i) => E(chain[i], id));
  const rounds = { rounds: [{ n: 1, verify: 'Q1', fix: 'F1' }] };
  assert.match(await reviewError([T('T01'), T('Q1', { conditional: true }), T('F1')], edges, rounds), /검증 Task Q1에는 conditional을 둘 수 없음/);
  const f = fakeDag();
  await approve(f, [T('T01', { conditional: true }), T('Q1'), T('F1', { conditional: true })], edges, 'v1', rounds);
  const tasks = JSON.parse(f.fs[approval]).tasks;
  assert.deepEqual([tasks.T01.conditional, tasks.F1.conditional], [true, true]);
});

// ---- the lead, member and direct launch paths are gone ----
// 91. --lead and --parent are unknown options
await ta(async () => {
  for (const extra of [['--lead'], ['--parent', 'T01']]) {
    const f = fake();
    const { code, out } = await main([...workerArgv, ...extra], f.deps);
    assert.equal(code, 1, JSON.stringify(out));
    assert.match(out.error, new RegExp(`Unknown option '${extra[0]}'`));
    assert.equal(f.calls.length, 0);
  }
});
// 92. a DAG node with members is refused at review, on a Task node and on an approval node
await ta(async () => {
  assert.match(await reviewError([T('T01', { members: [T('child')] }), T('T02')], []), /팀 내부 배정\(members\)은 없어졌습니다/);
  assert.match(await reviewError([T('T01'), { id: 'A1', kind: 'approval', members: [] }], [E('T01', 'A1')]), /팀 내부 배정\(members\)은 없어졌습니다/);
});
// 93. in an execution Run, worker without --map is refused: with --approval --id, with --id alone, or with a spec carrying an approval marker
await ta(async () => {
  const f = fakeDag();
  await execRun(f);
  f.fs['qa.md'] = f.fs['a.md'];
  for (const extra of [['--approval', approval, '--id', 'T01'], ['--id', 'T01']]) {
    const { code, out } = await main([...workerArgv, ...extra], f.deps);
    assert.equal(code, 1, JSON.stringify(out));
    assert.match(out.error, /register한 Task를 worker --map --id로 띄운다/);
  }
  f.fs['qa.md'] = ok + '\n\n실행 승인: ' + f.map().review + ' T01';
  assert.match((await main(workerArgv, f.deps)).out.error, /register한 Task를 worker --map --id로 띄운다/);
  assert.equal(f.count('worker-start'), 0);
});
// 94. a map that holds old direct launches stops worker and register
await ta(async () => {
  for (const [key, value] of [['direct', { T05: { task: 'task_9', dispatch: 'ctx_9' } }], ['previousDirect', [{ id: 'T05' }]]]) {
    const f = await registered();
    f.fs['orca-tasks.json'] = JSON.stringify({ ...f.map(), [key]: value });
    for (const args of [go('T01'), reg('T03', 'a.md')]) {
      const { code, out } = await main(args, f.deps);
      assert.equal(code, 1, JSON.stringify(out));
      assert.match(out.error, /옛 직접 기동 기록이 있는 Run입니다. 새 Run에서 계획을 다시 승인하세요/);
    }
    assert.equal(f.count('worker-start'), 0);
  }
});
// 95. approval rows carry no members key
await ta(async () => {
  const f = fakeDag();
  await approve(f, [node('T01'), node('T02')]);
  for (const r of Object.values(JSON.parse(f.fs[approval]).tasks)) assert.equal('members' in r, false);
});
// 96. an approval file written by 0.5.1 (rows with members: [], its own hash intact) stops the coordinator with the existing message
await ta(async () => {
  const f = fakeDag();
  await approve(f, [node('T01')]);
  const record = JSON.parse(f.fs[approval]);
  for (const r of Object.values(record.tasks)) r.members = [];
  record.review = createHash('sha256').update(JSON.stringify([record.version, record.planHash, record.dagHash, record.tasks, null])).digest('hex');
  f.fs[approval] = JSON.stringify(record);
  const g = fake({ fileOver: f.fs });
  const { code, out } = await main([...coordArgv, '--approval', approval, ...reviewArgs('v1')], g.deps);
  assert.equal(code, 1, JSON.stringify(out));
  assert.equal(out.error, '현재 계획·DAG와 실행 승인 버전이 다름');
  assert.equal(g.calls.length, 0);
});
// 97. a project with only the old roster (team-org.md) stops worker and register with the setup guidance
await ta(async () => {
  const old = { [ROSTER_FILES[0]]: undefined, [ROSTER_FILES[1]]: '| 팀 | 팀장이 되는 에이전트 |' };
  const f = fake({ fileOver: old });
  const a = await main(workerArgv, f.deps);
  assert.equal(a.code, 1, JSON.stringify(a.out));
  assert.match(a.out.error, /setup을 다시 돌려 새 구조로 옮기세요/);
  assert.equal(f.calls.length, 0);
  const g = await registered();
  Object.assign(g.fs, old);
  const creates = g.count('task-create');
  for (const args of [go('T01'), reg('T03', 'a.md')]) {
    const { code, out } = await main(args, g.deps);
    assert.equal(code, 1, JSON.stringify(out));
    assert.match(out.error, /setup을 다시 돌려 새 구조로 옮기세요/);
  }
  assert.equal(g.count('task-create'), creates);
  assert.equal(g.count('worker-start'), 0);
});

// wait: the model is woken only by mail it has to act on
{
  const at = (seconds) => new Date(Date.UTC(2000, 0, 2, 0, 0, seconds)).toISOString();
  const msg = (id, type, extra = {}) => ({ id, type, from_handle: 'dispatch:ctx_1', subject: id, body: 'b', created_at: at(10), payload: '{}', ...extra });
  const done = (id, dispatchId, at) => msg(id, 'worker_done', { created_at: at, payload: JSON.stringify({ dispatchId }) });
  const fakeWait = (batches, inbox = []) => {
    const fs = {}, calls = [];
    return { fs, calls, deps: {
      orca: (args) => {
        calls.push(args);
        const messages = args[1] === 'inbox' ? inbox : (batches.shift() ?? []);
        return { status: 0, stdout: JSON.stringify(messages === 'error' ? { ok: false, error: { message: 'waiter_exists' } } : { ok: true, result: { messages } }), stderr: '' };
      },
      read: (p) => { if (!(p in fs)) throw Object.assign(new Error('ENOENT ' + p), { code: 'ENOENT' }); return fs[p]; },
      write: (p, text) => { fs[p] = text; },
      now: () => at(0),
    } };
  };
  const W = ['wait', '--inbox', 'run:run_1', '--state', 's.json'];
  const ids = (r) => r.out.messages.map((m) => m.id);

  await ta(async () => {
    const r = await main(['wait'], fakeWait([]).deps);
    assert.equal(r.code, 1); assert.match(r.out.error, /--inbox/);
  });
  // a heartbeat-only batch is waited through; the wait carries the wake types, the long timeout and the Run
  await ta(async () => {
    const f = fakeWait([[msg('h1', 'heartbeat')], [msg('h2', 'heartbeat'), msg('m1', 'question')]]);
    const r = await main(W, f.deps);
    assert.equal(r.code, 0, JSON.stringify(r.out));
    assert.deepEqual(ids(r), ['m1']);
    assert.deepEqual(r.out.messages[0], { id: 'm1', type: 'question', from: 'dispatch:ctx_1', subject: 'm1', body: 'b', payload: {}, at: at(10) });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[0], ['orchestration', 'check', '--wait', '--types', 'worker_done,escalation,question,status', '--timeout-ms', '1800000', '--run', 'run_1', '--json']);
  });
  // mail already handed over is not handed over again, and a worker's resend of worker_done is dropped
  await ta(async () => {
    const f = fakeWait([[done('d1', 'ctx_9', at(10))], [done('d1', 'ctx_9', at(10)), done('d2', 'ctx_9', at(13)), msg('m2', 'status')]]);
    assert.deepEqual(ids(await main(W, f.deps)), ['d1']);
    assert.deepEqual(ids(await main(W, f.deps)), ['m2']);
  });
  // a timeout looks once at the inbox for mail another check took; older mail than the first wait is left alone
  await ta(async () => {
    const f = fakeWait([[]], [msg('old', 'worker_done', { created_at: at(-60) }), msg('lost', 'escalation')]);
    const r = await main(W, f.deps);
    assert.deepEqual(ids(r), ['lost']);
    assert.deepEqual(f.calls[1], ['orchestration', 'inbox', '--terminal', 'run:run_1', '--limit', '5', '--full', '--json']);
  });
  // three empty waits in a row come back as idle; a dispatch inbox takes no --run
  await ta(async () => {
    const f = fakeWait([[], [], []]);
    const r = await main(['wait', '--inbox', 'dispatch:ctx_7', '--state', 's.json'], f.deps);
    assert.deepEqual(r.out, { messages: [], idle: true });
    assert.equal(f.calls.filter((c) => c[1] === 'check').length, 3);
    assert.ok(!f.calls[0].includes('--run'));
  });
  // --last prints the last handed-over batch again without touching Orca; --once is one check without --wait
  await ta(async () => {
    const f = fakeWait([[msg('m1', 'question')], []]);
    await main(W, f.deps);
    const n = f.calls.length;
    assert.deepEqual(ids(await main([...W, '--last'], f.deps)), ['m1']);
    assert.equal(f.calls.length, n);
    const once = await main([...W, '--once'], f.deps);
    assert.deepEqual(once.out, { messages: [] });
    assert.deepEqual(f.calls[n], ['orchestration', 'check', '--run', 'run_1', '--json']);
  });
  await ta(async () => {
    const r = await main(W, fakeWait(['error']).deps);
    assert.equal(r.code, 1); assert.match(r.out.error, /waiter_exists/);
  });
}

// settle: one worker_done is judged, recorded or failed in one command
{
  const LEDGER = '# 장부\n\n## 결함 원장\n\n| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |\n| --- | --- | --- | --- | --- | --- |\n\n## 결정\n\n## 스냅샷\n\n- T00 | tree_0\n';
  const REPORT = '# 리포트\n## 결함\n| ID | 심각도 | 증거 | 위치 | 영향 근거 |\n| --- | --- | --- | --- | --- |\n| A-1 | High | 관찰: 실패 | a.ts | 핵심 흐름 차단: 정상 계정 로그인 불가 |\n## 검증\n- ✅ 완료 기준 1\n- ❌ (참고) 범위 밖\n';
  const settling = async (over = {}) => {
    const f = await registered();
    const m = f.map();
    m.tasks.T01.dispatch = 'ctx_new';
    f.fs['orca-tasks.json'] = JSON.stringify(m);
    f.tasks.get(m.tasks.T01.orca).status = 'completed';
    f.tasks.get(m.tasks.T02.orca).status = 'ready';
    Object.assign(f.fs, { 'ledger.md': LEDGER, 'r.md': REPORT, 'out.ts': 'x', ...over });
    f.deps.exists = (p) => f.fs[p] !== undefined;
    f.deps.snapshot = () => 'tree_1';
    return f;
  };
  const S = ['settle', ...M, '--id', 'T01', '--dispatch', 'ctx_new', '--report', 'r.md', '--ledger', 'ledger.md'];

  // passing report: defect rows and the snapshot line go into the ledger; nothing is failed
  await ta(async () => {
    const f = await settling();
    const { code, out } = await main([...S, '--expect', 'out.ts'], f.deps);
    assert.equal(code, 0, JSON.stringify(out));
    assert.deepEqual(out, { id: 'T01', ok: true, checked: 1, notes: ['- ❌ (참고) 범위 밖'], tree: 'tree_1', defects: { added: ['A-1'], existing: [] } });
    assert.match(f.fs['ledger.md'], /\| A-1 \| T01 \| High \| 관찰 — 핵심 흐름 차단: 정상 계정 로그인 불가 \| 1 \| 열림 \|/);
    assert.match(f.fs['ledger.md'], /- T00 \| tree_0\n- T01 \| tree_1\n/);
    assert.equal(f.count('task-update'), 0);
  });
  // An invalid High holds the report and its dependents; the original failure and ledger survive.
  await ta(async () => {
    const report = REPORT.replace('핵심 흐름 차단: 정상 계정 로그인 불가', '영향 미확인');
    const f = await settling({ 'r.md': report });
    const r = await main(S, f.deps);
    assert.equal(r.code, 1);
    assert.match(r.out.cause, /A-1.*영향 근거/);
    assert.deepEqual(r.out.demoted, ['T02']);
    assert.equal(f.fs['ledger.md'], LEDGER);
    assert.equal(f.fs['r.md'], report);
  });
  // A verifier can finish investigating without inventing a product defect. The failed assertion is retained.
  await ta(async () => {
    const report = '## 검증\n- ✅ 수락 기준의 입력을 검사함\n## 남은 것\n- 영향 미확인: 관련 시험 실패. 원본 results.json, 다음 확인은 저장 후 다시 열기.';
    const f = await settling({ 'r.md': report });
    const { code, out } = await main(S, f.deps);
    assert.equal(code, 0);
    assert.deepEqual(out.defects.added, []);
    assert.equal(f.fs['r.md'], report);
    assert.equal(f.count('task-update'), 0);
  });
  // a missing artifact fails the Task and rebinds the Task Orca already made ready; the ledger is left alone
  await ta(async () => {
    const f = await settling();
    const { code, out } = await main([...S, '--expect', 'out.ts,missing.ts'], f.deps);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.equal(out.cause, '❌ 산출물 없음: missing.ts');
    assert.deepEqual(out.demoted, ['T02']);
    assert.equal(f.tasks.get(f.map().tasks.T01.orca).status, 'failed');
    assert.equal(f.tasks.get(f.map().tasks.T02.orca).status, 'pending');
    assert.equal(f.fs['ledger.md'], LEDGER);
  });
  // the worker's own failed outcome and an unreadable report both fail the Task
  await ta(async () => {
    const a = await main([...S, '--outcome', 'failed'], (await settling()).deps);
    assert.equal(a.code, 1); assert.equal(a.out.cause, '❌ 워커가 실패로 보고함');
    const b = await main([...S.slice(0, -4), '--report', 'none.md', '--ledger', 'ledger.md'], (await settling()).deps);
    assert.equal(b.code, 1); assert.match(b.out.cause, /리포트를 읽을 수 없음: none\.md/);
  });
  // a report from another Dispatch settles nothing and fails nothing
  await ta(async () => {
    const f = await settling();
    const { code, out } = await main(S.map((a) => (a === 'ctx_new' ? 'ctx_stale' : a)), f.deps);
    assert.equal(code, 1);
    assert.match(out.error, /기대한 Dispatch가 아님/);
    assert.equal(out.expected, 'ctx_new');
    assert.equal(f.count('task-update'), 0);
    assert.equal(f.fs['ledger.md'], LEDGER);
  });
}

console.log(`orca-launch.check: ${passed} passed`);
