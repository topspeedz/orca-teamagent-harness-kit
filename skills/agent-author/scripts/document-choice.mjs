// Show one expertise-matched candidate or record the user's choice from the project root.
import { closeSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';

const index = 'docs/DOCUMENTATION_INDEX.md';
const cells = line => line.trim().slice(1, -1).split('|').map(c => c.trim().replace(/^`|`$/g, ''));

function tableRows(text, heading, columns) {
  const lines = text.split(/\r?\n/);
  const section = lines.indexOf('## ' + heading);
  if (section < 0) return [];
  let start = section + 1;
  while (start < lines.length && !/^(?:## |[|])/.test(lines[start])) start++;
  if (!lines[start]?.startsWith('|') || cells(lines[start]).join('|') !== columns) return [];
  const rows = [];
  for (let i = start + 2; lines[i]?.startsWith('|'); i++) rows.push({ index: i, cells: cells(lines[i]) });
  return rows;
}

function main([doc, scope, action, role, ...extra]) {
  if (!doc || !scope || !['--accept', '--exclude', undefined].includes(action) || Boolean(role) !== (action === '--accept') || extra.length) {
    throw new Error('사용법: document-choice.mjs 문서 범위 [--accept 역할 | --exclude]');
  }
  const before = readFileSync(index, 'utf8');
  const pending = tableRows(before, '작성자 배정 대기', '문서|범위|배정 상태')
    .filter(r => r.cells[0] === doc && r.cells[1] === scope);
  if (pending.length > 1) throw new Error(index + ': 중복 배정 대기 행 ' + doc + ' / ' + scope);
  const owners = [];
  const covering = [];
  for (const file of readdirSync('.claude/agents').filter(f => /\.md(?:\.agent-toggle-off)?$/.test(f))) {
    const source = readFileSync('.claude/agents/' + file, 'utf8');
    const rows = tableRows(source, '문서 책임', '문서|범위|책임');
    const parts = rows.filter(r => r.cells[0] === doc && r.cells[2] === '작성').map(r => r.cells[1]);
    const name = file.split('.md')[0];
    if (parts.includes(scope) || parts.includes('전체')) covering.push(name);
    if (covering.includes(name) || (scope === '전체' && parts.length)) owners.push(name);
  }
  const state = pending[0]?.cells[2];
  if (!action) {
    console.log(owners.length ? '작성자 ' + owners.join(', ') : state ?? '대기 항목 없음');
    return;
  }
  if (action === '--accept' && (owners.length !== 1 || covering[0] !== role)) {
    throw new Error(doc + ': 승인된 범위의 작성자를 역할 정의에서 확인하세요: ' + (owners.join(', ') || '미배정'));
  }
  if (action === '--exclude' && owners.length) throw new Error(doc + ': 기존 작성자 ' + owners.join(', '));
  if ((!state && action === '--accept') || (state === '해당 없음' && action === '--exclude')) return;
  if (state !== '미배정') throw new Error(index + ': 선택할 미배정 행이 없음: ' + doc + ' / ' + scope);
  // Keep each untouched line, including its original line terminator.
  const lines = before.match(/[^\n]*(?:\n|$)/g);
  const i = pending[0].index;
  if (action === '--accept') lines.splice(i, 1);
  else lines[i] = lines[i].replace(/미배정(?=\s*\|\s*$)/, '해당 없음');
  // Stage in the same directory; simultaneous choices must not overwrite each other's snapshot.
  const target = realpathSync(index);
  const staging = target + '.agent-author.tmp';
  const fd = openSync(staging, 'wx', statSync(target).mode);
  let replaced = false;
  try {
    try { writeFileSync(fd, lines.join('')); }
    finally { closeSync(fd); }
    if (readFileSync(target, 'utf8') !== before) throw new Error(index + ': 색인이 변경되어 다시 확인해야 합니다');
    renameSync(staging, target);
    replaced = true;
  } finally {
    if (!replaced) rmSync(staging);
  }
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
