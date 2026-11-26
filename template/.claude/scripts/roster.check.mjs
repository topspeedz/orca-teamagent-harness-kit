import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRoster } from './roster.mjs';

const dir = mkdtempSync(join(tmpdir(), 'roster-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
function put(path, body) {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

const roster = '# 명단\n\n| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |\n| --- | --- | --- | --- |\n| `frontend` | 프론트엔드 | `frontend-ux`, `frontend-dev` | `app/` |\n| `verifier` | 검증 | `change-review` | 테스트 파일 |\n';
const expected = [
  { agent: 'frontend', unit: '프론트엔드', skills: ['frontend-ux', 'frontend-dev'], scope: '`app/`' },
  { agent: 'verifier', unit: '검증', skills: ['change-review'], scope: '테스트 파일' },
];
put('docs/harness/agents.md', roster);
assert.deepEqual(readRoster(dir), expected);
put('docs/harness/agents.md', roster.replaceAll('\n', '\r\n'));
assert.deepEqual(readRoster(dir), expected);

rmSync(join(dir, 'docs/harness/agents.md'));
put('docs/harness/team-org.md', '| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 |\n');
assert.throws(() => readRoster(dir), { message: 'docs/harness/agents.md가 없고 옛 명단(team-org.md)만 있습니다. setup을 다시 돌려 새 구조로 옮기세요.' });
rmSync(join(dir, 'docs/harness/team-org.md'));
assert.throws(() => readRoster(dir), { message: '명단 표 필요: docs/harness/agents.md의 에이전트|맡는 단위|스킬|편집 범위' });
put('docs/harness/agents.md', '# 명단\n\n| 에이전트 | 스킬 |\n| --- | --- |\n');
assert.throws(() => readRoster(dir), /명단 표 필요/);
console.log('roster: rows with backticks and CRLF, legacy roster and missing table checked');
