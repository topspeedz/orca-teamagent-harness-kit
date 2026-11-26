import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'agent-definition-'));
const script = fileURLToPath(new URL('./agent-definition.mjs', import.meta.url));
function put(path, body) {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
const role = '.claude/agents/api-owner.md';
const body = [
  '---', 'name: api-owner', 'description: "응답 계약 변경을 검증한다."', '---',
  '# api-owner', '## 핵심 역할', '소비자 전환 후 계약을 갱신한다.',
  '## 작업 원칙', '- 로드할 스킬: `contract-check`', '- 작업 단위: `계약 변경`',
  '## 전문 판단', '기존 필드가 사용 중이면 소비자 전환과 계약 검사를 먼저 확인한다.',
  '## 입력과 출력', '### 읽는 입력', '- `src/client.mjs`', '### 작업 산출물', '- Task 리포트',
  '## 문서 책임', '| 문서 | 범위 | 책임 |', '| --- | --- | --- |', '| `contract.md` | 응답 | 작성 |',
  '## 직접 협업', '| 상대 | 협의 주제 | 목적 |', '| --- | --- | --- |', '| `client-owner` | 필드 | 소비자 이전 |',
  '## 완료 기준', '소비자 계약 검사 통과 기록', '## 다시 호출될 때', '이전 검사부터 읽는다.',
  '## 오류 처리', '소비자가 미확인이면 기존 필드를 보존하고 배정자에게 넘긴다.',
].join('\n');
const roster = '| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 |\n| --- | --- | --- | --- | --- |\n| api | client-owner | `api-owner`, `client-owner` | team-api | API |\n';
const model = '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |\n| --- | --- | --- | --- | --- | --- |\n| api-owner | 계약 변경 | claude | opus | high | |\n';
put('.claude/agents/client-owner.md.agent-toggle-off', '기존 정의. 신규 양식 검사는 새 역할만 받는다.');
put('.claude/skills/contract-check/SKILL.md', '# Contract checks');
put('.claude/skills/team-api/SKILL.md', '# API team');
put('contract.md', '# 응답');
put('src/client.mjs', 'export const readId = obj => obj.id;');
put('docs/harness/model-selection.md', model);
put('docs/harness/team-org.md', roster);

function check(source, reason) {
  put(role, source);
  const r = spawnSync(process.execPath, [script, '--agent', 'api-owner'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, reason ? 1 : 0, r.stdout + r.stderr);
  if (reason) assert.ok(r.stderr.includes(reason), r.stderr);
}
check(body);
check(body.slice(0, body.indexOf('# api-owner')) + 'Do good work.', '핵심 역할');
check(body.replace('description:', 'model: inherit\ndescription:'), '머리말');
check(body.replace('Task 리포트', '<프로젝트의 실제 입력 파일>'), '자리표시자');
check(body.replace('Task 리포트', '아래 내용을 채우고 안내 문장은 지운다.'), '작성 안내');
check(body.replace('`client-owner`', '`missing-owner`'), '협의 상대');
check(body.replace('`contract-check`', '`missing-skill`'), '스킬');
check(body.replace('`contract.md`', '`missing.md`'), '문서 책임');
check(body.replace('`src/client.mjs`', '`src/gone.mjs`'), '읽는 입력');
check(body.replace('Task 리포트', '[근거](missing.md)'), '문서 링크');
check(body.replace('응답 | 작성', '응답 | 소유'), '책임 값');
// a project may add columns after the three required ones, such as the form each document follows
check(body.replace('| 문서 | 범위 | 책임 |', '| 문서 | 범위 | 책임 | 양식 |')
  .replace('| `contract.md` | 응답 | 작성 |', '| `contract.md` | 응답 | 작성 | `contract.md` |'));
check(body.replace('`계약 변경`', '`미등록 작업`'), '작업 단위');
put('docs/harness/team-org.md', roster.replace('`api-owner`, ', ''));
check(body, '명시적 팀원 행');
put('docs/harness/team-org.md', roster);
put('docs/harness/model-selection.md', model.replace('api-owner', '*'));
check(body, '작업 단위 행 없음');
console.log('agent-definition: valid role, legacy roster/OFF peer and invalid definitions checked');
