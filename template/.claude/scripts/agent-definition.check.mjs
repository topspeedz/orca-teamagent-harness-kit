import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'agent-definition-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const script = fileURLToPath(new URL('./agent-definition.mjs', import.meta.url));
function put(path, body) {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
const role = '.claude/agents/api-owner.md';
const valid = [
  '---', 'name: api-owner', 'description: "응답 계약 변경을 검증한다."', '---',
  '# api-owner', '## 핵심 역할', '소비자 전환 후 계약을 갱신한다.',
  '## 따로 두는 이유', '- 기준: 병렬', '- 근거: 소비자 쪽과 따로 돈다.', '- 다시 볼 때: 소비자가 하나로 줄면',
  '## 작업 원칙', '- 로드할 스킬: `contract-check`, `docs-management`', '- 런타임과 자원: 없음', '- 서브에이전트: 없음',
  '## 작업 단위와 스킬', '| 작업 단위 | 쓰는 스킬 | 돌려주는 것 |', '| --- | --- | --- |', '| 계약 변경 | `contract-check` | 계약 검사 결과 |',
  '## 경계', '소비 코드는 고치지 않고 `client-owner`에게 넘긴다.',
  '## 전문 판단', '기존 필드가 사용 중이면 소비자 전환과 계약 검사를 먼저 확인한다.',
  '## 입력과 출력', '### 읽는 입력', '- `src/client.mjs`', '### 작업 산출물', '- Task 리포트',
  '## 문서 책임', '| 문서 | 범위 | 책임 |', '| --- | --- | --- |', '| `contract.md` | 응답 | 작성 |',
  '## 직접 협업', '| 상대 | 협의 주제 | 목적 | 한도 |', '| --- | --- | --- | --- |', '| `client-owner` | 필드 | 소비자 이전 | 3회, 넘으면 배정자에게 |',
  '## 완료 기준', '소비자 계약 검사 통과 기록', '## 다시 호출될 때', '이전 검사부터 읽는다.',
  '## 오류 처리', '소비자가 미확인이면 기존 필드를 보존하고 배정자에게 넘긴다.',
].join('\n');
const header = '| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |\n| --- | --- | --- | --- |\n';
const roster = header + '| `api-owner` | API | `contract-check`, `docs-management` | `src/api/` |\n| `client-owner` | 소비자 | `contract-check` | `src/client/` |\n';
const noRow = header + '| `client-owner` | 소비자 | `contract-check` | `src/client/` |\n';
const wrongSkills = header + '| `api-owner` | API | `contract-check` | `src/api/` |\n';
const model = '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |\n| --- | --- | --- | --- | --- | --- |\n| api-owner | 계약 변경 | claude | opus | high | |\n';
put('.claude/agents/client-owner.md.agent-toggle-off', '기존 정의. 신규 양식 검사는 새 역할만 받는다.');
put('.claude/skills/contract-check/SKILL.md', '# Contract checks');
put('.claude/skills/docs-management/SKILL.md', '# Docs');
put('contract.md', '# 응답');
put('src/client.mjs', 'export const readId = obj => obj.id;');
put('docs/harness/model-selection.md', model);

// Small edits of the fixture
const without = (body, heading) => body.replace(new RegExp('^' + heading + '\\n[^#]*', 'm'), '');
const unitRow = (body, unit) => body.replace('| 계약 변경 | `contract-check`', '| ' + unit + ' | `contract-check`');
const unitSkill = (body, id) => body.replace('| 계약 변경 | `contract-check`', '| 계약 변경 | `' + id + '`');
const peerLimit = (body, limit) => body.replace('| 3회, 넘으면 배정자에게 |', '| ' + limit + ' |');
const dropLimitColumn = (body) => body.replace('| 상대 | 협의 주제 | 목적 | 한도 |', '| 상대 | 협의 주제 | 목적 |')
  .replace('| --- | --- | --- | --- |\n| `client-owner`', '| --- | --- | --- |\n| `client-owner`').replace(' 3회, 넘으면 배정자에게 |', '');

function check(source, reason, files = {}) {
  rmSync(join(root, 'docs/harness/agents.md'), { force: true });
  rmSync(join(root, 'docs/harness/team-org.md'), { force: true });
  const { roster: list = roster, legacy = false } = files;
  if (list !== null) put('docs/harness/agents.md', list);
  if (legacy) put('docs/harness/team-org.md', '| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 |\n');
  put(role, source);
  const r = spawnSync(process.execPath, [script, '--agent', 'api-owner'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, reason ? 1 : 0, r.stdout + r.stderr);
  if (reason) assert.ok(r.stderr.includes(reason), reason + '\n' + r.stderr);
}
check(valid, null);
check(valid.replaceAll('\n', '\r\n'), null);
check(valid.slice(0, valid.indexOf('# api-owner')) + 'Do good work.', '핵심 역할');
check(valid.replace('description:', 'model: inherit\ndescription:'), '머리말');
check(valid.replace('Task 리포트', '<프로젝트의 실제 입력 파일>'), '자리표시자');
check(valid.replace('Task 리포트', '아래 내용을 채우고 안내 문장은 지운다.'), '작성 안내');
check(valid.replace('| `client-owner` | 필드', '| `missing-owner` | 필드'), '협의 상대');
check(valid.replace('`contract-check`, `docs-management`', '`missing-skill`, `docs-management`'), '스킬을 찾을 수 없음: missing-skill');
check(valid.replace('`contract.md`', '`missing.md`'), '문서 책임');
check(valid.replace('`src/client.mjs`', '`src/gone.mjs`'), '읽는 입력');
check(valid.replace('Task 리포트', '[근거](missing.md)'), '문서 링크');
check(valid.replace('응답 | 작성', '응답 | 소유'), '책임 값');
// a project may add columns after the three required ones, such as the form each document follows
check(valid.replace('| 문서 | 범위 | 책임 |', '| 문서 | 범위 | 책임 | 양식 |')
  .replace('| `contract.md` | 응답 | 작성 |', '| `contract.md` | 응답 | 작성 | `contract.md` |'), null);
// roster
check(valid, '명단 행이 하나여야 합니다', { roster: noRow });
check(valid, '명단과 역할 파일의 스킬이 다름', { roster: wrongSkills });
check(valid, 'setup을 다시 돌려 새 구조로 옮기세요', { roster: null, legacy: true });
check(valid, '명단 표 필요', { roster: null });
// sections of the role template
check(valid.replace('- 기준: 병렬', '- 기준: 팀이 달라서'), '따로 두는 이유의 기준은 컨텍스트 분리, 병렬, 도구·지시 충돌 중 하나: 팀이 달라서');
check(without(valid, '## 따로 두는 이유'), '## 따로 두는 이유 내용 누락');
check(without(valid, '## 경계'), '## 경계 내용 누락');
check(valid.replace(/^- 런타임과 자원:.*$/m, ''), '런타임과 자원 줄 누락 (없으면 없음)');
check(valid.replace(/^- 서브에이전트:.*$/m, ''), '서브에이전트 줄 누락 (없으면 없음)');
check(unitRow(valid, '없는 단위'), 'api-owner의 작업 단위 없음: 없는 단위');
check(unitSkill(valid, 'not-loaded'), '작업 단위 표의 스킬이 로드할 스킬에 없음: not-loaded');
check(without(valid, '## 작업 단위와 스킬'), '작업 단위와 스킬 표 필요');
check(peerLimit(valid, ''), '직접 협업의 한도가 비어 있음: client-owner');
check(dropLimitColumn(valid), null);
put('docs/harness/model-selection.md', model.replace('api-owner', '*'));
check(valid, '작업 단위 행 없음');
console.log('agent-definition: valid role, flat roster, legacy roster, template sections and invalid definitions checked');
