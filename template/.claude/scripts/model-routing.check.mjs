import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRouting, assessRouting, validateRouting } from './model-routing.mjs';

const scores = (C, U, R, V, F = 0) => ({ C, U, R, V, F });
const evidence = { C: 'One local function', U: 'Check a single condition', R: 'Local output', V: 'Unit assertion', F: 'First attempt' };
const baseline = scores(1, 1, 1, 1);
const input = { scores: baseline, evidence, ambiguities: [{ axis: 'U', value: 2, evidence: 'Two algorithms must be compared' }] };
const failIfCalled = () => assert.fail('classifier was called');
const map = { 'sonnet/medium': 'custom-sol/medium', 'opus/medium': 'custom-astra/medium' };
// Boundaries of every effort band, including E=11 with the max guard unsatisfied.
for (const [axes, E, claude] of [
  [[0, 1, 1, 0], 2, 'haiku'], [[0, 1, 1, 0, 1], 3, 'sonnet/medium'],
  [[1, 0, 1, 1], 1, 'sonnet/low'], [[1, 1, 0, 0], 2, 'sonnet/medium'],
  [[2, 1, 2, 2], 4, 'opus/medium'], [[1, 2, 1, 1], 5, 'sonnet/high'],
  [[1, 2, 1, 3], 7, 'sonnet/high'], [[3, 2, 1, 2], 8, 'opus/xhigh'],
  [[3, 2, 3, 2, 2], 10, 'fable/xhigh'], [[3, 2, 3, 3, 2], 11, 'fable/xhigh'],
  [[3, 3, 2, 3], 11, 'opus/max'], [[1, 3, 1, 3, 2], 11, 'sonnet/max'],
  [[3, 3, 3, 3, 2], 13, 'fable/max'], [[1, 0, 3, 0], 0, 'opus/low'],
]) {
  const route = scoreRouting(scores(...axes));
  assert.equal(route.E, E);
  assert.equal(route.claude, claude);
}

// The user can edit the Codex table. Only the fixture pins the kit's example values.
const examples = { 'opus/max': 'gpt-6.2-astra/max', 'fable/max': 'gpt-6.2-astra/ultra' };
for (const [risk, effort] of [[2, 'max'], [3, 'ultra']]) {
  const route = scoreRouting(scores(3, 3, risk, 3), 'codex', examples);
  assert.equal(route.model, 'gpt-6.2-astra');
  assert.equal(route.effort, effort);
}
assert.throws(() => scoreRouting(baseline, 'codex', {}));
assert.throws(() => scoreRouting(baseline, 'codex', { 'sonnet/medium': 'internal-model/xhihg' }), /effort/);
assert.throws(() => scoreRouting(baseline, 'unknown'));
for (const [key, value] of [['C', -1], ['V', '2'], ['F', 3], ['U', 1.5], ['R', undefined]]) {
  assert.throws(() => scoreRouting({ ...baseline, [key]: value }));
}
const clear = assessRouting({ scores: baseline, evidence }, 'claude', {}, failIfCalled);
assert.equal(clear.haiku.status, 'clear');
validateRouting(clear);
const same = assessRouting({ scores: baseline, evidence, ambiguities: [{ axis: 'R', value: 2, evidence: 'A shared API' }] }, 'claude', {}, failIfCalled);
assert.equal(same.haiku.status, 'same-route');
validateRouting(same);
const sameEffective = assessRouting(input, 'codex', { 'sonnet/medium': 'pinned/high', 'sonnet/high': 'pinned/high' }, failIfCalled);
assert.equal(sameEffective.haiku.status, 'same-route');
const collapsedTable = { 'sonnet/medium': 'pinned/high', 'sonnet/high': 'pinned/high' };
validateRouting({ ...sameEffective, ...scoreRouting(sameEffective.scores, 'claude') }, 'claude', collapsedTable);
assert.throws(() => validateRouting(sameEffective, 'codex', { ...collapsedTable, 'fable/max': 'custom-model/ultar' }), /effort/);

// Neither alternative alone changes the model. Together they satisfy the Opus rule.
const combination = { scores: baseline, evidence, ambiguities: [
  { axis: 'C', value: 2, evidence: 'Two coupled modules' }, { axis: 'R', value: 2, evidence: 'Shared contract' },
] };
const joint = assessRouting(combination, 'codex', map, () => ({ scores: { C: 2, R: 2 }, reason: 'Shared contract between two modules' }));
assert.equal(joint.haiku.status, 'classified');
assert.equal(joint.claude, 'opus/medium');
validateRouting(joint, 'codex', map);
const classified = assessRouting(input, 'claude', {}, () => ({ scores: { U: 2 }, reason: 'Alternatives must be compared' }));
assert.equal(classified.haiku.status, 'classified');
assert.equal(classified.E, 5);
assert.equal(classified.claude, 'sonnet/high');
validateRouting(classified);
validateRouting({ ...classified, ...scoreRouting(classified.scores, 'codex', collapsedTable) }, 'codex', collapsedTable);
for (const classify of [
  () => { throw new Error('timeout'); }, () => ({ scores: { U: 3 }, reason: 'outside range' }),
  () => ({ scores: { U: 2, F: 2 }, reason: 'invented failure' }), () => ({ scores: { U: 2 }, reason: '' }),
  () => ({ scores: { U: 2 }, reason: 'ignored authority', runtime: 'codex' }),
]) {
  const fallback = assessRouting(input, 'claude', {}, classify);
  assert.equal(fallback.haiku.status, 'fallback');
  assert.equal(fallback.claude, 'sonnet/medium');
  validateRouting(fallback);
}
for (const extra of [
  { E: 1 }, { model: 'fable' }, { runtime: 'codex' }, { scores: baseline }, { haiku: { status: 'clear' } },
  { haiku: { ...classified.haiku, scores: { U: 3 } } },
]) assert.throws(() => validateRouting({ ...classified, ...extra }));
assert.throws(() => assessRouting({ ...input, ambiguities: [{ axis: 'F', value: 1, evidence: 'guess' }] }));
assert.throws(() => assessRouting({ ...input, evidence: { ...evidence, F: '' } }));

const testDir = mkdtempSync(join(tmpdir(), 'orca-routing-'));
const fixture = join(testDir, 'model-selection.md'), axesFile = join(testDir, 'input.json');
const script = fileURLToPath(new URL('./model-routing.mjs', import.meta.url));
const cli = args => spawnSync(process.execPath, [script, ...args], { cwd: testDir, encoding: 'utf8' });
try {
  // Older projects can have a Claude-only table. Named but unfixed rows are adaptive worker defaults.
  writeFileSync(fixture, [
    '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |', '| --- | --- | --- | --- | --- | --- |',
    '| reviewer | inspect | claude | fable | xhigh | 고정(auth) |',
    '| * | 리드 | claude | opus | high | 팀장으로 띄울 때 |',
    '| * | 기본 | claude | 복잡도 | | |',
  ].join('\n'));
  writeFileSync(axesFile, '\uFEFF' + JSON.stringify({ scores: baseline, evidence }));
  const plan = (agent, unit, ...args) => cli(['plan', '--agent', agent, '--unit', unit, '--selection', fixture, ...args]);
  const fixed = plan('reviewer', 'inspect');
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.deepEqual(JSON.parse(fixed.stdout), { role: 'reviewer', unit: 'inspect', agent: 'claude', model: 'fable', effort: 'xhigh', fixed: true });
  const dynamic = plan('developer', '리드', '--input', axesFile);
  assert.equal(dynamic.status, 0, dynamic.stderr);
  const node = JSON.parse(dynamic.stdout);
  assert.equal(node.base, 'sonnet/medium');
  assert.equal(node.routing.mode, 'auto');
  validateRouting(node.routing);
  const pm = cli(['assess', '--input', axesFile]);
  assert.equal(pm.status, 0, pm.stderr);
  validateRouting(JSON.parse(pm.stdout));
  const nested = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {assessRouting} from ' + JSON.stringify(new URL('./model-routing.mjs', import.meta.url).href) +
    '; console.log(JSON.stringify(assessRouting(' + JSON.stringify(input) + ').haiku))',
  ], { encoding: 'utf8', env: { ...process.env, ORCA_ROUTING_CLASSIFIER: '1' } });
  assert.equal(JSON.parse(nested.stdout).status, 'fallback');
} finally {
  unlinkSync(axesFile);
  unlinkSync(fixture);
  rmdirSync(testDir);
}
console.log('model-routing: score bands, Codex snapshot, classification, fallback and replay passed');
