// Run explicitly for a newly authored role, after its team and model rows exist.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseTable, TABLE_PATH } from './model-selection.mjs';

const roleDir = '.claude/agents';
const rosterPath = 'docs/harness/team-org.md';
const identifiers = /^[a-z0-9][a-z0-9_-]*$/i;
const unquote = (s) => s.trim().replace(/^`|`$/g, '');
const cells = (line) => line.trim().slice(1, -1).split('|').map(unquote);
const names = (field) => field.split(',').map(unquote);
const codeSpans = (line) => [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]);
const read = (file) => readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const fileExists = (file) => statSync(file, { throwIfNoEntry: false })?.isFile();
const roleExists = (name) => identifiers.test(name) && ['.md', '.md.agent-toggle-off'].some(ext => fileExists(roleDir + '/' + name + ext));

function section(body, heading) {
  const lines = body.split('\n');
  const index = lines.indexOf(heading);
  if (index < 0) return '';
  const boundary = heading.startsWith('###') ? /^#{1,3} / : /^#{1,2} /;
  const contents = lines.slice(index + 1);
  const end = contents.findIndex(line => boundary.test(line));
  return contents.slice(0, end < 0 ? contents.length : end).join('\n').trim();
}

function validate(name) {
  if (!identifiers.test(name)) throw new Error('잘못된 역할 이름: ' + name);
  const path = roleDir + '/' + name + '.md';
  const source = read(path);
  const errors = [];
  const fail = (location, reason) => errors.push(location + ': ' + reason);
  const header = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(source);
  if (!header || header[1] !== name) {
    throw new Error(path + ': 머리말은 파일명과 같은 name, 한 줄 description 두 필드여야 합니다');
  }
  let description = header[2].trim();
  if (description.startsWith('"')) {
    try { description = JSON.parse(description); }
    catch { fail(path, 'description의 큰따옴표 형식 오류'); }
  }
  if (!description.trim()) fail(path, '빈 description');
  const body = source.slice(header[0].length);
  for (const heading of ['## 핵심 역할', '## 작업 원칙', '## 전문 판단', '## 입력과 출력', '### 읽는 입력', '### 작업 산출물', '## 완료 기준', '## 다시 호출될 때', '## 오류 처리']) {
    if (!section(body, heading)) fail(path, heading + ' 내용 누락');
  }
  const io = section(body, '## 입력과 출력');
  for (const h of ['### 읽는 입력', '### 작업 산출물']) {
    if (!io.split('\n').includes(h)) fail(path, '입력과 출력 안에 ' + h + ' 필요');
  }
  source.split('\n').forEach((line, i) => {
    // Report filenames can contain runtime values supplied by the Task spec.
    const text = line.replace(/<(?:phase|N(?:\+1)?|산출물)>/g, '');
    if (/<[^<>\n]+>|\bTODO\b|\bTBD\b|\[\s*\]|아래 .*(?:채우|지운)|양식.*복사해 채운다/.test(text)) fail(path + ':' + (i + 1), '작성 안내·미작성 자리표시자');
  });

  const checkPath = (value, where, fileOnly = false) => {
    const rel = relative('.', resolve(value));
    if (!value || isAbsolute(value) || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
        || !(fileOnly ? fileExists(value) : existsSync(value))) fail(path, where + ' 경로를 찾을 수 없음: ' + value);
  };
  for (const [, target] of body.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const ref = target.replace(/^<|>$/g, '').split('#')[0];
    if (ref && !/^[a-z]+:/i.test(ref)) checkPath(join(dirname(path), ref), '문서 링크');
  }
  for (const ref of codeSpans(section(body, '### 읽는 입력'))) {
    if (/[/\\]|\.[a-z0-9]+$/i.test(ref)) checkPath(ref, '읽는 입력');
  }
  const skill = (id) => {
    if (!identifiers.test(id) || !fileExists('.claude/skills/' + id + '/SKILL.md')) fail(path, '스킬을 찾을 수 없음: ' + id);
  };
  const rules = section(body, '## 작업 원칙');
  const skillLine = rules.split('\n').find(l => /^- 로드할 스킬:/.test(l));
  if (!skillLine) fail(path, '로드할 스킬 목록 누락 (없으면 없음)');
  else {
    const list = skillLine.slice(skillLine.indexOf(':') + 1).trim();
    if (!codeSpans(list).length && list !== '없음') fail(path, '역할 스킬 이름을 백틱으로 표시');
    for (const id of codeSpans(list)) skill(id);
  }
  function roleTable(title, header, visit) {
    // a project may add columns after the required ones; only the required ones are read
    const need = header.split('|').length;
    const lines = section(body, '## ' + title).split('\n');
    const start = lines.findIndex(l => l.startsWith('|') && cells(l).slice(0, need).join('|') === header);
    if (start < 0 || !/^\|\s*:?-{3,}/.test(lines[start + 1] ?? '')) {
      fail(path, title + ' 표 필요: ' + header);
      return;
    }
    for (const line of lines.slice(start + 2)) {
      if (!line.startsWith('|')) break;
      const row = cells(line);
      if (!line.trimEnd().endsWith('|') || row.length < need || row.slice(0, need).some(c => !c)) fail(path, title + ' 행 오류: ' + line);
      else visit(...row.slice(0, need));
    }
  }
  roleTable('문서 책임', '문서|범위|책임', (doc, scope, duty) => {
    checkPath(doc, '문서 책임 ' + scope, true);
    if (!['작성', '검토', '확인'].includes(duty)) fail(path, '문서 책임 값 오류: ' + duty);
  });
  roleTable('직접 협업', '상대|협의 주제|목적', (peer) => {
    if (peer === name || !roleExists(peer)) fail(path, '협의 상대 역할 오류: ' + peer);
  });

  const roster = read(rosterPath).split('\n');
  const start = roster.findIndex(l => l.startsWith('|') && cells(l).slice(0, 5).join('|') === '팀|팀장이 되는 에이전트|팀원|팀 스킬|편집 범위');
  const teams = [];
  if (start >= 0) {
    for (const line of roster.slice(start + 2)) {
      if (!line.startsWith('|')) break;
      const row = cells(line);
      if (names(row[2] ?? '').includes(name)) teams.push(row);
    }
  }
  if (teams.length !== 1) fail(rosterPath, name + '의 명시적 팀원 행이 하나여야 합니다 (현재 ' + teams.length + ')');
  for (const row of teams) {
    if (![5, 6].includes(row.length) || (row.length === 6 && !['운영팀', '실행팀', '직속'].includes(row[5]))) fail(rosterPath, '구분 또는 열 수 오류: ' + row[0]);
    const members = names(row[2]);
    if (new Set(members).size !== members.length) fail(rosterPath, '중복 팀원: ' + row[2]);
    for (const member of members) if (!roleExists(member)) fail(rosterPath, '팀원 역할 파일 없음: ' + member);
    if (row[5] === '실행팀' && (!roleExists(row[1]) || !members.includes(row[1]))) fail(rosterPath, '실행팀의 명시적 팀장 누락: ' + row[0]);
    if (row[5] === '실행팀' && !row[3]) fail(rosterPath, '실행팀 스킬 누락: ' + row[0]);
    if (row[3] && !['없음', '-'].includes(row[3])) skill(row[3]);
  }
  const model = parseTable(read(TABLE_PATH));
  for (const err of model.errors) fail(TABLE_PATH, err);
  const rows = model.rows.filter(r => r.agent === name);
  if (!rows.length) fail(TABLE_PATH, name + '의 작업 단위 행 없음');
  for (const line of rules.split('\n').filter(l => /^- 작업 단위:/.test(l))) {
    for (const unit of codeSpans(line)) if (!rows.some(r => r.units.includes(unit))) fail(TABLE_PATH, name + '의 작업 단위 없음: ' + unit);
  }
  return errors;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--agent') throw new Error('사용법: node .claude/scripts/agent-definition.mjs --agent <name>');
  const errors = validate(args[1]);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('agent-definition: OK ' + args[1]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
