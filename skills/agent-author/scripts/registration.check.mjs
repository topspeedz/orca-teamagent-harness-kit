// Exercise the commands used by both authoring skills after a human approves the roles.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const setup = fileURLToPath(new URL('../../setup/scripts/setup.mjs', import.meta.url));
const choose = fileURLToPath(new URL('./document-choice.mjs', import.meta.url));
const table = 'docs/harness/model-selection.md';
const roster = 'docs/harness/team-org.md';
const index = 'docs/DOCUMENTATION_INDEX.md';
const contract = 'docs/05-api/draft.md';
const database = 'docs/06-database/draft.md';
const api = 'api-owner', client = 'client-owner';
const folder = mkdtempSync(join(tmpdir(), 'agent-registration-'));
function run(root, ...args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr);
  return r.stdout.trim();
}
function put(root, path, body) {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const sourceApi = 'https://github.com/VoltAgent/awesome-codex-subagents/blob/main/categories/01-core-development/api-designer.toml';
const sourceWorkflow = 'https://github.com/msitarzewski/agency-agents/blob/main/specialized/specialized-workflow-architect.md';

function definition(root, author, direct) {
  const isApi = author === api;
  const template = read(root, 'docs/harness/templates/agent.md').match(/^`{4}markdown\r?\n([\s\S]*?)^`{4}$/m)[1];
  const fields = {
    '에이전트': author, '호출 조건과 책임, 관찰 가능한 결과': isApi ? '응답 필드 변경 시 소비자가 사용하는 계약을 보존한다.' : '응답 전환 시 실제 소비 코드와 기대 결과를 확인한다.',
    '단일 핵심 성과와 인접 역할의 경계': isApi ? 'API 제공자가 작성할 응답 계약을 관리한다.' : '사용자가 보는 이름을 읽는 소비 경로를 검토한다.',
    '프로젝트 역할 스킬': 'contract-check', '모델 표의 작업 단위': isApi ? '계약 변경' : '소비 검증',
    '명단에서의 소속, 배정·편집·승인 경계, 확인한 도구': direct ? '직속 역할로 코디네이터에게 보고한다.' : '실행팀의 배정자에게 승인 범위 변경을 요청한다.',
    '대표 요청의 조건, 결정 근거가 있는 실제 구현·참고 원문, 행동, 통과 증거와 실패 시 대응':
      '응답의 name 삭제 전 계약과 src/client.mjs를 읽는다. 소비 중이면 대체 필드 제공 → 소비자 전환 → 계약 검사 통과 → 제거 순서를 협의한다. ' +
      '전환 판단은 [API Designer](' + sourceApi + '), 실패 시 인계는 [Workflow Architect](' + sourceWorkflow + ') 원문에서 골랐다.',
    '프로젝트의 실제 입력 파일': 'src/client.mjs', '읽는 이유와 필요한 내용': '소비 중인 응답 필드와 이름 표시를 확인한다.',
    '정본 또는 리포트의 경로와 보고 대상': 'Task 리포트에 소비자·계약 검사 결과와 미결 사유를 기록해 배정자에게 보낸다.',
    '정본 경로': contract, '담당 절 또는 전체': '응답', '작성/검토/확인 중 하나': isApi ? '작성' : '검토',
    '상대 역할': author === 'contract-reader' ? 'qa-inspector' : isApi ? client : api, '협의할 사실': '사용 중인 응답 필드', '협의가 필요한 이유': '이전 순서와 성공 근거를 합의한다.',
    'spec의 수신 경로, 협의 상대 부재·범위 변경 시 배정자에게 올리는 경로': 'spec에 지정한 상대가 꺼져 있으면 배정자에게 확인을 돌린다.',
    '성공·실패를 판별하는 산출물과 검사, 미검증 항목을 남기는 위치': 'node contract.check.mjs의 결과와 양쪽 전환 증거를 Task 리포트에 남긴다.',
    '이전 산출물·버전·미결 항목을 이어받는 방법': '다음 버전 리포트에서 같은 응답 필드의 전환 여부를 확인한다.',
    '실패 신호와 복구 또는 중단·인계 기준': '소비자를 확인할 수 없으면 필드를 보존하고 미확인 소비자와 증거를 배정자에게 넘긴다.',
  };
  return template.replace(/<([^>]+)>/g, (match, key) => { assert.ok(key in fields, match); return fields[key]; });
}

function project(scenario) {
  const root = join(folder, scenario);
  put(root, 'answers.json', JSON.stringify({ codex: true, approvalPrefixes: [], coordinatorPermissionMode: 'default', planner: { effort: 'high' } }));
  run(root, setup, 'install', '--target', '.', '--answers', 'answers.json');
  for (const name of ['requirements-write', 'product-review', 'backlog-management']) {
    const pointer = read(root, '.agents/skills/' + name + '/SKILL.md');
    const target = pointer.match(/본문은 `([^`]+)`/)[1];
    assert.match(read(root, target), new RegExp('^name: ' + name + '$', 'm'));
  }
  for (const name of ['product-manager', 'planner', 'qa-inspector', 'code-reviewer', 'doc-steward', 'harness-engineer']) {
    run(root, '.claude/scripts/agent-definition.mjs', '--agent', name);
  }
  const originalRoster = read(root, roster);
  const oldIndex = read(root, index);
  const apiRow = '| `' + contract + '` | 전체 | 미배정 |';
  const split = '| `' + contract + '` | 응답 | 미배정 |\n| `' + contract + '` | 오류 | 미배정 |';
  assert.ok(oldIndex.includes(apiRow));
  put(root, index, oldIndex.replace(apiRow, split));
  const choices = (...args) => run(root, choose, ...args);
  assert.equal(choices(contract, '응답'), '미배정');
  const beforeDecline = read(root, index);
  assert.equal(choices(contract, '오류'), '미배정'); // The user declines this scope.
  assert.equal(read(root, index), beforeDecline);
  choices(database, '전체', '--exclude');
  assert.equal(choices(database, '전체'), '해당 없음');
  assert.ok(existsSync(join(root, database)));
  const initialIndex = read(root, index);
  put(root, 'src/client.mjs', 'export const label = user => user.name.toUpperCase();\n');
  put(root, contract, '# API\n\n## 응답\n\nname: string\n\n## 오류\n\n404\n');
  put(root, 'contract.check.mjs', 'import assert from "node:assert/strict";\nimport { label } from "./src/client.mjs";\nassert.equal(label({name:"Ada"}),"ADA");\nassert.throws(() => label({}), TypeError);\n');
  run(root, 'contract.check.mjs');
  // Removing a consumed field breaks the actual reader. Transition it before removing the field.
  const oldClient = read(root, 'src/client.mjs');
  const result = () => spawnSync(process.execPath, ['--input-type=module', '-e', 'import { label } from "./src/client.mjs"; if (label({displayName:"Ada"}) !== "ADA") process.exitCode = 1'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result().status, 0);
  put(root, 'src/client.mjs', oldClient.replace('user.name', 'user.displayName'));
  assert.equal(result().status, 0);
  put(root, 'src/client.mjs', oldClient);
  // Author-approved output is rendered from the installed template, with each role's own scope.
  const separate = scenario === 'independent-then-member';
  for (const id of ['contract-check', 'team-clients']) {
    put(root, '.claude/skills/' + id + '/SKILL.md', '---\nname: ' + id + '\ndescription: "응답 계약 검사"\n---\n\nnode contract.check.mjs\n');
    put(root, '.agents/skills/' + id + '/SKILL.md', '---\nname: ' + id + '\ndescription: "계약 검사 포인터"\n---\n\n본문은 `.claude/skills/' + id + '/SKILL.md`를 읽는다.\n');
  }
  put(root, '.claude/skills/team-clients/SKILL.md', read(root, '.claude/skills/team-clients/SKILL.md') +
    '\n## 에이전트 구성\n\n| 에이전트 | 맡는 일 | 역할 스킬 | 모델 표의 작업 단위 |\n| --- | --- | --- | --- |\n' +
    '| `client-owner` | 소비자 전환 | `contract-check` | 소비 검증 |\n' +
    (separate ? '' : '| `api-owner` | 제공자 계약 변경 | `contract-check` | 계약 변경 |\n'));
  const modelTable = '.claude/scripts/model-table.mjs';
  const defaults = JSON.parse(run(root, modelTable, 'rows', '--table', table)).find(row => row.agent === '*' && row.unit === '기본');
  function add(names) {
    put(root, 'rows.json', JSON.stringify(names.map(agent => ({ agent, unit: agent === api ? '계약 변경' : '소비 검증', model: defaults.model, runtime: defaults.runtime, effort: defaults.effort }))));
    run(root, modelTable, 'add', '--table', table, '--rows', 'rows.json');
    for (const agent of names) put(root, '.claude/agents/' + agent + '.md', definition(root, agent, separate && agent === api));
  }
  const team = '| clients | client-owner | `client-owner`, `api-owner` | team-clients | 응답 | 실행팀 |';
  const append = row => put(root, roster, read(root, roster).replace(/(^\|[^\n]*\r?\n)(?!\|)/m, '$1' + row + '\n'));
  if (separate) {
    // Register a standalone role first; the known peer exists with a legacy definition.
    add([client]);
    put(root, '.claude/agents/client-owner.md', '---\nname: client-owner\ndescription: "기존 소비자"\n---\n\n## 협업\n\napi-owner와 소비자 전환을 협의한다.\n');
    append('| clients | client-owner | `client-owner` | team-clients | 응답 | 실행팀 |');
    append('| api-owner | | `api-owner` | | 계약 | 직속 |');
    add([api]);
    run(root, '.claude/scripts/agent-definition.mjs', '--agent', api);
    // Existing team gains a member. Its other columns and the standalone role stay intact.
    const qaRow = read(root, roster).split(/\r?\n/).find(l => l.startsWith('| `qa`'));
    const newQa = qaRow.replace('`code-reviewer`', '`code-reviewer`, `contract-reader`');
    put(root, roster, read(root, roster).replace(qaRow, newQa));
    const qaSkill = '.claude/skills/team-qa/SKILL.md';
    const qa = read(root, qaSkill);
    put(root, qaSkill, qa.replace(/(^\| [^\n]*code-reviewer[^\n]*\r?\n)/m, '$1| `contract-reader` | 응답 확인 | `contract-check` | 소비 검증 |\n'));
    assert.ok(read(root, qaSkill).includes('contract-reader'));
    const qaRole = '.claude/agents/qa-inspector.md';
    put(root, qaRole, read(root, qaRole).replace('| `code-reviewer` | 실행 관찰', '| `contract-reader` | 사용 중인 응답 필드 | 소비자 검증 결과를 확인한다. |\n| `code-reviewer` | 실행 관찰'));
    add(['contract-reader']);
    run(root, '.claude/scripts/agent-definition.mjs', '--agent', 'contract-reader');
    run(root, setup, 'sync-agent', '--target', '.', '--agent', 'contract-reader');
    assert.ok(read(root, '.codex/agents/contract-reader.toml').includes('contract-reader'));
    run(root, setup, 'sync-agent', '--target', '.', '--agent', 'qa-inspector');
  } else {
    add([api, client]);
    append(team);
  }
  choices(contract, '응답', '--accept', api);
  assert.equal(choices(contract, '응답'), '작성자 ' + api);
  const afterAcceptance = read(root, index);
  choices(contract, '응답', '--accept', api);
  const forbidden = spawnSync(process.execPath, [choose, contract, '응답', '--exclude'], { cwd: root, encoding: 'utf8' });
  assert.equal(forbidden.status, 1);
  assert.equal(read(root, index), afterAcceptance);
  assert.equal(choices(contract, '오류'), '미배정');
  assert.equal(choices(database, '전체'), '해당 없음');
  assert.equal(read(root, index), initialIndex.replace('| `' + contract + '` | 응답 | 미배정 |\n', ''));
  for (const agent of separate ? [api] : [api, client]) {
    run(root, '.claude/scripts/agent-definition.mjs', '--agent', agent);
    run(root, setup, 'sync-agent', '--target', '.', '--agent', agent);
    const source = read(root, '.claude/agents/' + agent + '.md').split(/\r?\n---\r?\n/)[1].replaceAll('\r\n', '\n');
    const toml = read(root, '.codex/agents/' + agent + '.toml');
    assert.equal(JSON.parse(toml.match(/^developer_instructions = (.*)$/m)[1]), source);
    const row = JSON.parse(run(root, '.claude/scripts/model-selection.mjs', 'lookup', '--agent', agent, '--unit', agent === api ? '계약 변경' : '소비 검증', '--complexity', '2', '--json'));
    assert.equal(row.matched, 'exact');
  }
  run(root, '.claude/scripts/model-selection.mjs', 'check');
  for (const line of originalRoster.split(/\r?\n/).filter(l => l.startsWith('|') && !(separate && l.startsWith('| `qa`')))) assert.ok(read(root, roster).includes(line));
  return read(root, '.claude/agents/api-owner.md').split('## 전문 판단')[1];
}

const installedTeam = project('setup-team');
assert.equal(project('independent-then-member'), installedTeam);
assert.equal(project('author-full-team'), installedTeam);
console.log('registration: setup team, standalone role, existing team member and post-install team verified');
