// Self-test for orca-launch.mjs — no Orca needed. `node .claude/scripts/orca-launch.check.mjs`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  '| `coordinator` | 실행 감독 | claude | opus[1m] | high | |',
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
  assert.equal(cmd, coordinatorCommand({ model: 'opus[1m]', effort: 'high', settingsPath: SETTINGS_PATH, permissionMode: 'default' }));
  const ws = f.calls.find((a) => a[1] === 'worker-start');
  assert.deepEqual([val(ws, '--run'), val(ws, '--terminal')], ['run_new', 'term_c']);
  assert.deepEqual(out.applied, { model: 'opus[1m]', effort: 'high' });
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
  const f = fake({ fileOver: { [TABLE_PATH]: TABLE.replace('opus[1m]', 'opus$(id)') } });
  const { code, out } = await main(coordArgv, f.deps);
  assert.equal(code, 1);
  assert.match(out.error, /model/);
  assert.equal(f.calls.length, 0);
});

// 26. `opus[1m]` sits inside quotes in the launch line, so the shell does not read it as a glob
await ta(async () => {
  const f = fake();
  await main(coordArgv, f.deps);
  const cmd = val(f.calls.find((a) => a[0] === 'terminal' && a[1] === 'create'), '--command');
  assert.ok(cmd.includes('--model "opus[1m]" '), cmd);
});

// 27. coordinatorCommand refuses a bad effort and a path with `"`, `$` or a backtick
await ta(async () => {
  const base = { model: 'opus', effort: 'high', settingsPath: SETTINGS_PATH, permissionMode: 'default' };
  assert.throws(() => coordinatorCommand({ ...base, effort: 'high; id' }), /effort/);
  for (const settingsPath of ['a"b.json', 'a$(id).json', 'a`id`.json']) assert.throws(() => coordinatorCommand({ ...base, settingsPath }), /경로/, settingsPath);
  for (const permissionMode of ['acceptEdits', 'bypassPermissions']) assert.ok(coordinatorCommand({ ...base, permissionMode }).includes(`--permission-mode ${permissionMode} `));
});

console.log(`orca-launch.check: ${passed} passed`);
