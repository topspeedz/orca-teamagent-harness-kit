import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./phase-routing.mjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'phase-routing-'));
process.on('exit', () => rmSync(cwd, { recursive: true, force: true }));
mkdirSync(join(cwd, 'docs/harness'), { recursive: true });
mkdirSync(join(cwd, '.claude/agents'), { recursive: true });
writeFileSync(join(cwd, 'docs/harness/agents.md'), [
  '| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |',
  '| --- | --- | --- | --- |',
  '| `verifier` | 검증 | `change-review`, `qa-verification` | 테스트 파일 |',
].join('\r\n'));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const agent = (name) => {
  const result = run('agent', '--agent', name);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const intake = (args) => {
  const result = run('intake', ...args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
// agent: on is direct, off or no role file is wait, a name outside the roster is an error
assert.deepEqual(agent('verifier'), { agent: 'verifier', route: 'wait' });
writeFileSync(join(cwd, '.claude/agents/verifier.md.agent-toggle-off'), '# verifier');
assert.deepEqual(agent('verifier'), { agent: 'verifier', route: 'wait' });
renameSync(join(cwd, '.claude/agents/verifier.md.agent-toggle-off'), join(cwd, '.claude/agents/verifier.md'));
assert.deepEqual(agent('verifier'), { agent: 'verifier', route: 'direct' });
const ghost = run('agent', '--agent', 'ghost');
assert.equal(ghost.status, 1);
assert.ok(ghost.stderr.includes('명단에서 에이전트를 찾을 수 없음: ghost'), ghost.stderr);
const team = run('team', '--team', 'qa');
assert.equal(team.status, 1);
assert.ok(team.stderr.includes('사용법: phase-routing.mjs intake 또는 agent'), team.stderr);
assert.notEqual(run('agent').status, 0);
// intake: every path starts with product-manager and there is no reviewer
assert.deepEqual(intake([]), { route: 'new', first: 'product-manager', approvals: ['묶음', '설계', '계획·실행'] });
assert.deepEqual(intake(['--delegated']), { route: 'delegated', first: 'product-manager', approvals: ['계획·실행'] });
writeFileSync(join(cwd, 'docs/backlog.md'), [
  '| ID | 항목 | 역할 | 상태 | 비고 |',
  '| --- | --- | --- | --- | --- |',
  '| BL-0001 | 기본 설정 | backend | todo | 선행 없음 |',
  '| BL-0002 | 설정 변경 | backend | todo | 선행 BL-0001, BL-0012 · 수락 기준: BL-0002를 표시 |',
].join('\n'));
writeFileSync(join(cwd, 'docs/backlog-archive.md'), '| BL-0012 | 초기화 | backend | done | 완료 |');
assert.deepEqual(intake(['--ids', 'BL-0001,BL-0002']), { route: 'specified', ids: ['BL-0001', 'BL-0002'], first: 'product-manager', approvals: ['설계', '계획·실행'] });
for (const [ids, reason] of [['BL-0002', 'BL-0001'], ['BL-0012', '완료'], ['', 'BL-####']]) {
  const result = run('intake', '--ids', ids);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(reason), result.stderr);
}
writeFileSync(join(cwd, 'docs/backlog-archive.md'), '');
const missing = run('intake', '--ids', 'BL-0012');
assert.equal(missing.status, 1);
assert.match(missing.stderr, /없는 ID/);
console.log('phase-routing: three intake paths, dependencies and archived IDs, agent OFF/ON passed');
