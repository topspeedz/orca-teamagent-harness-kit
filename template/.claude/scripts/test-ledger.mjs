#!/usr/bin/env node
// Copy a test run into the documents, so nobody types results by hand:
//   the 최근 결과 column of docs/09-testing/test-cases*.md, then 구현됨 ↔ 검증됨 in docs/10-traceability/rtm*.md.
// Usage: node .claude/scripts/test-ledger.mjs --results <runner JSON> --phase <phase> [--command "<전체 테스트 명령>"] [--root <dir>] [--dry]
// --results: the JSON report of the full test run. vitest: `--reporter=json --outputFile=<file>`; jest: `--json --outputFile=<file>`.
// stdout: {"cases":{"passed":2,"failed":1,"missing":["TC-CART-004"]},"rtm":{"verified":[…],"reverted":[…]},"files":[…]}
// A case whose test is not in the run (renamed, skipped, a partial run) keeps the result it had and is listed in `missing`.
// A case with no backticked test in 자동화 위치 is run by hand and is left alone.
// Only 구현됨 and 검증됨 are switched. 계획됨 and 확인 필요 are judgments and stay as written.
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const slash = (p) => p.replaceAll('\\', '/');
const cellsOf = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const isRow = (line) => line.trim().startsWith('|');
const setCell = (line, i, value) => { const parts = line.split('|'); parts[i + 1] = ` ${value} `; return parts.join('|'); };

// Walk every table whose header holds all of `need`; `fn(cells, set)` may rewrite a cell of the row it is given.
function eachRow(text, need, fn) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let col = null;
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i])) { col = null; continue; }
    const cells = cellsOf(lines[i]);
    if (!col) { if (need.every((h) => cells.includes(h))) { col = Object.fromEntries(need.map((h) => [h, cells.indexOf(h)])); i++; } continue; }
    fn((h) => cells[col[h]] ?? '', (h, value) => { lines[i] = setCell(lines[i], col[h], value); });
  }
  return lines.join(eol);
}

export function apply({ results, phase, command, cases, rtm }) {
  const byFile = results.testResults.map((r) => ({ file: slash(r.name), tests: r.assertionResults ?? [] }));
  const statuses = (file, names) => {
    const tests = byFile.filter((r) => r.file === file || r.file.endsWith(`/${file}`)).flatMap((r) => r.tests);
    if (!names.length) return tests.map((t) => t.status);
    return names.flatMap((name) => {
      const hit = tests.filter((t) => t.title === name || t.fullName === name || t.fullName?.endsWith(` ${name}`));
      return hit.length ? hit.map((t) => t.status) : [null];
    });
  };
  const out = { cases: { passed: 0, failed: 0, missing: [] }, rtm: { verified: [], reverted: [] } };
  const state = {};
  const nextCases = cases.map((text) => {
    let t = eachRow(text, ['ID', '자동화 위치', '최근 결과'], (cell, set) => {
      const [file, ...names] = [...cell('자동화 위치').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (file) {
        const got = statuses(slash(file), names);
        if (got.includes('failed')) { set('최근 결과', `실패 (${phase})`); out.cases.failed++; state[cell('ID')] = '실패'; return; }
        if (got.length && got.every((s) => s === 'passed')) { set('최근 결과', `통과 (${phase})`); out.cases.passed++; state[cell('ID')] = '통과'; return; }
        out.cases.missing.push(cell('ID'));
      }
      state[cell('ID')] = /^(통과|실패|미실행)/.exec(cell('최근 결과'))?.[1];
    });
    if (command) t = eachRow(t, ['명령', '통과', '실패', 'phase'], (cell, set) => {
      if (cell('명령') !== `\`${command}\``) return;
      set('통과', results.numPassedTests); set('실패', results.numFailedTests); set('phase', phase);
    });
    return t;
  });
  const nextRtm = rtm.map((text) => eachRow(text, ['요구사항 ID', '테스트 ID', '상태'], (cell, set) => {
    const ids = cell('테스트 ID').match(/TC-[A-Z0-9]+-\d+/g) ?? [];
    const now = cell('상태').replaceAll('`', '');
    if (!ids.length || !['구현됨', '검증됨'].includes(now)) return;
    const want = ids.every((id) => state[id] === '통과') ? '검증됨' : '구현됨';
    if (want === now) return;
    set('상태', cell('상태').replace(now, want));
    out.rtm[want === '검증됨' ? 'verified' : 'reverted'].push(cell('요구사항 ID'));
  }));
  return { out, cases: nextCases, rtm: nextRtm };
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { values: o } = parseArgs({ options: { results: { type: 'string' }, phase: { type: 'string' }, command: { type: 'string' }, root: { type: 'string' }, dry: { type: 'boolean' } } });
    if (!o.results || !o.phase) throw new Error('usage: test-ledger.mjs --results <runner JSON> --phase <phase> [--command "<전체 테스트 명령>"] [--root <dir>] [--dry]');
    const root = o.root ?? '.';
    const list = (dir, re) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
    const paths = { cases: list('docs/09-testing', /^test-cases.*\.md$/), rtm: list('docs/10-traceability', /^rtm.*\.md$/) };
    const read = (p) => readFileSync(join(root, p), 'utf8');
    const before = { cases: paths.cases.map(read), rtm: paths.rtm.map(read) };
    const r = apply({ results: JSON.parse(readFileSync(o.results, 'utf8')), phase: o.phase, command: o.command, ...before });
    const files = [];
    for (const kind of ['cases', 'rtm']) paths[kind].forEach((p, i) => {
      if (r[kind][i] === before[kind][i]) return;
      files.push(p);
      if (!o.dry) writeFileSync(join(root, p), r[kind][i], 'utf8');
    });
    console.log(JSON.stringify({ ...r.out, files }));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
