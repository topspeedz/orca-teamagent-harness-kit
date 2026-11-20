import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./phase-routing.mjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'phase-routing-'));
process.on('exit', () => rmSync(cwd, { recursive: true, force: true }));
mkdirSync(join(cwd, 'docs/harness'), { recursive: true });
mkdirSync(join(cwd, '.claude/agents'), { recursive: true });
writeFileSync(join(cwd, 'docs/harness/team-org.md'), [
  '| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 | 구분 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `qa` | `qa-inspector` | `qa-inspector`, `code-reviewer` | `team-qa` | tests/ | 실행팀 |',
].join('\n'));
const team = (...args) => JSON.parse(execFileSync(process.execPath,
  [script, 'team', '--team', 'qa', ...args], { cwd, encoding: 'utf8' }));
assert.equal(team('--count', '1').route, 'wait');
writeFileSync(join(cwd, '.claude/agents/qa-inspector.md.agent-toggle-off'), '# QA');
assert.equal(team('--count', '2').route, 'wait');
assert.equal(team('--count', '1').route, 'wait');
renameSync(join(cwd, '.claude/agents/qa-inspector.md.agent-toggle-off'), join(cwd, '.claude/agents/qa-inspector.md'));
assert.equal(team('--count', '1').route, 'direct');
assert.equal(team('--count', '2').route, 'lead');
assert.equal(team('--count', '1', '--complex').route, 'lead');
assert.notEqual(spawnSync(process.execPath, [script, 'team', '--team', 'qa', '--count', '0'], { cwd }).status, 0);
const intake = (...args) => spawnSync(process.execPath, [script, 'intake', ...args], { cwd, encoding: 'utf8' });
const first = (args, role, reviewer, approvals) => {
  const result = intake(...args);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.deepEqual([route.first, route.reviewer, route.approvals], [role, reviewer, approvals]);
};
first([], 'product-manager', 'planner', ['묶음', '설계', '계획·실행']);
first(['--delegated'], 'product-manager', 'product-manager', ['계획·실행']);
writeFileSync(join(cwd, 'docs/backlog.md'), [
  '| ID | 항목 | 역할 | 상태 | 비고 |',
  '| --- | --- | --- | --- | --- |',
  '| BL-0001 | 기본 설정 | planner | todo | 선행 없음 |',
  '| BL-0002 | 설정 변경 | planner | todo | 선행 BL-0001, BL-0012 · 수락 기준: BL-0002를 표시 |',
].join('\n'));
writeFileSync(join(cwd, 'docs/backlog-archive.md'), '| BL-0012 | 초기화 | planner | done | 완료 |');
first(['--ids', 'BL-0001,BL-0002'], 'planner', 'product-manager', ['설계', '계획·실행']);
for (const [ids, reason] of [['BL-0002', 'BL-0001'], ['BL-0012', '완료'], ['', 'BL-####']]) {
  const result = intake('--ids', ids);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(reason), result.stderr);
}
writeFileSync(join(cwd, 'docs/backlog-archive.md'), '');
const missing = intake('--ids', 'BL-0012');
assert.equal(missing.status, 1);
assert.match(missing.stderr, /없는 ID/);
console.log('phase-routing: three intake paths, dependencies and archived IDs, team OFF/ON and lead selection passed');
