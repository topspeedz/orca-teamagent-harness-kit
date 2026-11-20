// Run from the project root. The coordinator vouches for report contents and user decisions.
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

const root = realpathSync('.');
const withinRoot = (path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
function projectPath(path) {
  if (!path || isAbsolute(path) || win32.parse(path).root || path.split(/[/\\]/).includes('..')) return false;
  let existing = resolve(root, path);
  if (!withinRoot(existing)) return false;
  // Deferred documents may still be missing beneath an existing directory or junction.
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = dirname(existing);
  return withinRoot(realpathSync(existing));
}
const unquote = (value) => value.replace(/^`([^`]+)`$/, '$1');
const filled = (value) => value && !/^(?:[-—]+|없음|해당 없음|미정|대기|TBD|<[^>]+>)$/i.test(unquote(value));
const nonApproval = /^(?:미응답|답변\s*대기|재시도\s*소진|(?:이월\s*|승인\s*)?(?:거절|거부|보류|대기)|아니[요오]|no)[.!]?$/i;
const file = (path) => projectPath(path) && statSync(path, { throwIfNoEntry: false })?.isFile();
const cells = (line) => line.slice(1, -1).split(/(?<!\\)\|/).map(c => c.trim().replaceAll('\\|', '|'));
function confirms(report, bl, path, sectionId, author, status) {
  const section = readFileSync(report, 'utf8').split(/^## 반영 확인[ \t]*\r?$/m)[1]?.split(/^## /m)[0];
  return section?.split(/\r?\n/).some(line => {
    if (!line.startsWith('|') || !line.endsWith('|')) return false;
    const [location, owner = '', result = ''] = cells(line);
    return location.replaceAll('`', '') === path + ' · ' + unquote(sectionId) && unquote(owner) === unquote(author) &&
      result.startsWith(status + ' · ') && filled(result.slice(status.length + 3)) &&
      (bl === '없음' || result.match(/\bBL-\d{4}\b/g)?.includes(bl));
  });
}
const pending = [];
const verified = new Set();
const deferred = new Set();
try {
  const ledger = readFileSync(process.argv[2], 'utf8').replaceAll('\r\n', '\n');
  const blocks = ledger.split(/^## 라이브 문서 확인[ \t]*$/m);
  if (blocks.length !== 2) throw new Error('장부의 라이브 문서 확인 절은 하나여야 함');
  const section = blocks[1].split(/^## /m)[0].trim();
  if (section !== '필수 라이브 문서: 없음') {
    const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.every(l => l.startsWith('|') && l.endsWith('|'))) throw new Error('라이브 문서 확인 표 형식 오류');
    const rows = lines.map(cells);
    if (rows[0]?.join('|') !== 'BL|문서|절·ID|지정 작성자|결과|근거|이월 사유|사용자 답변' ||
        rows.length < 3 || rows[1].length !== 8 || !rows[1].every(c => /^:?-{3,}:?$/.test(c))) {
      throw new Error('문서 확인 표의 머리 또는 데이터가 없음');
    }
    const decisions = ledger.split(/^## 결정[ \t]*$/m)[1]?.split(/^## /m)[0].split('\n').map(l => l.trim()) ?? [];
    for (const row of rows.slice(2)) {
      const [bl, doc = '', sectionId, author = '', status, evidence = '', reason, answer] = row;
      const path = unquote(doc);
      const reports = [...evidence.matchAll(/`([^`]+)`/g)].map(m => m[1]);
      const result = { bl, path, reason: '' };
      if (row.length !== 8 || !/^(?:BL-\d{4}|없음)$/.test(bl) || !projectPath(path) ||
          !filled(path) || !filled(sectionId) || !filled(author) || !reports.length || !reports.every(file)) {
        result.reason = 'BL·프로젝트 경로·절·담당·근거 리포트 확인 필요';
      } else if (status === '이월' && bl !== '없음' && filled(reason) && filled(answer) && !nonApproval.test(answer) &&
          decisions.includes('- ' + [bl, path, sectionId, '이월 승인', answer].join(' | '))) {
        deferred.add(bl);
      } else if (['반영', '현행 확인'].includes(status) && unquote(author) !== '미배정' && !reason && !answer &&
          file(path) && !/^> 설치 초안 ·/m.test(readFileSync(path, 'utf8')) &&
          reports.some(report => confirms(report, bl, path, sectionId, author, status))) {
        if (bl !== '없음') verified.add(bl);
      } else {
        result.reason = status === '이월' ? '이월할 BL·사유·해당 절의 사용자 승인 원문 확인 필요' : '정본·지정 작성자·반영 확인 근거 대기';
      }
      if (result.reason) pending.push(result);
    }
  }
} catch (error) {
  pending.push({ reason: error.message });
}
for (const { bl } of pending) {
  verified.delete(bl);
  deferred.delete(bl);
}
for (const bl of deferred) verified.delete(bl);
console.log(JSON.stringify({ pending, verified: [...verified], deferred: [...deferred] }));
if (pending.length) process.exitCode = 1;
