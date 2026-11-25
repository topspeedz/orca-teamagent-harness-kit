// Self-test for defect-ledger.mjs — no Orca needed. `node .claude/scripts/defect-ledger.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDefects, currentRound, fixAllowed, parseDefects, readLedger } from './defect-ledger.mjs';

let passed = 0;
const ok = () => passed++;

const report = '# 리포트\n\n## 결함\n\n| ID | 심각도 | 증거 | 위치 | 요지 |\n| --- | --- | --- | --- | --- |\n'
  + '| H-1 | High | 관찰 `tests/login.test.mjs` | `src/login.mjs:12` | 잠금이 풀리지 않음 |\n'
  + '| A-H-2 | High | 없음 | `src/a.mjs:3` | 근거 없이 올린 것 |\n'
  + '| M-1 | Medium | 인용 수락 기준 2 | `src/b.mjs:9` | 문구 다름 |\n\n## 검증\n';
// 1. 표를 읽는다. 증거가 없는 High는 Medium으로 내린다
assert.deepEqual(parseDefects(report).map(d => [d.id, d.severity, d.evidence, !!d.demoted]),
  [['H-1', 'High', '관찰', false], ['A-H-2', 'Medium', '없음', true], ['M-1', 'Medium', '인용', false]]);
ok();
// 2. CRLF, 표 없음, 본문 "없음"
assert.equal(parseDefects(report.replace(/\n/g, '\r\n')).length, 3);
assert.deepEqual(parseDefects('# 리포트\n\n## 결함\n\n없음\n'), []);
assert.deepEqual(parseDefects('# 리포트\n'), []);
// 알 수 없는 첫 낱말은 없음, 그 High는 내린다
assert.deepEqual(parseDefects(report.replace('관찰 `tests', '추정 `tests')).map(d => [d.severity, d.evidence]).slice(0, 1), [['Medium', '없음']]);
ok();
// 3. 원장에 넣는다. `## 결정` 앞에 절이 생기고, 두 번 넣어도 같다
const led = '# 장부: phase-a\n\n## 결정\n\n- 첫 줄\n';
const once = addDefects(led, { source: 'T07', round: 1, defects: parseDefects(report) });
assert.ok(once.indexOf('## 결함 원장') < once.indexOf('## 결정'));
assert.ok(once.includes('| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |'));
assert.equal(addDefects(once, { source: 'T07', round: 1, defects: parseDefects(report) }), once);
assert.deepEqual(readLedger(once).defects.map(d => [d.id, d.source, d.severity, d.round, d.state]),
  [['H-1', 'T07', 'High', 1, '열림'], ['A-H-2', 'T07', 'Medium', 1, '열림'], ['M-1', 'T07', 'Medium', 1, '열림']]);
assert.deepEqual(readLedger(once).decisions, ['첫 줄']);
// 새 ID만 기존 절 끝에 붙는다
const more = addDefects(once, { source: 'T09', round: 2, defects: [{ id: 'L-1', severity: 'Low', evidence: '관찰', where: 'x' }] });
assert.deepEqual(readLedger(more).defects.map(d => d.id), ['H-1', 'A-H-2', 'M-1', 'L-1']);
assert.ok(more.indexOf('| L-1 |') < more.indexOf('## 결정'));
// `## 결정`이 없는 장부는 끝에 절이 붙는다
assert.equal(readLedger(addDefects('# 장부\n', { source: 'T1', round: 1, defects: parseDefects(report) })).defects.length, 3);
ok();
// 4. 손으로 고친 상태 칸은 다시 넣어도 남는다
const closed = once.replace('| H-1 | T07 | High | 관찰 | 1 | 열림 |', '| H-1 | T07 | High | 관찰 | 1 | 확정 |');
assert.notEqual(closed, once);
assert.equal(addDefects(closed, { source: 'T07', round: 1, defects: parseDefects(report) }), closed);
ok();
// 5. 라운드: 띄운 수정 회차 + 1
assert.equal(currentRound({ tasks: { F1: { kind: 'fix', round: 1, dispatch: null } } }), 1);
assert.equal(currentRound({ tasks: { F1: { kind: 'fix', round: 1, dispatch: 'ctx_1' }, F1b: { kind: 'fix', round: 1, dispatch: 'ctx_2' } } }), 2);
assert.equal(currentRound({ tasks: { A: { kind: 'verify', round: 1, dispatch: 'c' }, F1: { kind: 'fix', round: 1, dispatch: 'c' }, F2: { kind: 'fix', round: 2, dispatch: 'c' } } }), 3);
assert.equal(currentRound({ tasks: {} }), 1);
ok();
// 6. 수정에 넣을 수 있는가
const L = readLedger(once.replace('- 첫 줄', '- M-1 | 수정 포함 승인 | 이번에 같이 고쳐 주세요'));
assert.equal(fixAllowed(L, ['H-1', 'M-1']).ok, true);
assert.deepEqual(fixAllowed(readLedger(once), ['M-1', 'X-9']).refused.map(r => r.id), ['M-1', 'X-9']);
assert.equal(fixAllowed(readLedger(closed), ['H-1']).ok, false);   // 이미 닫힌 High
ok();

// 7. CLI add
const script = fileURLToPath(new URL('./defect-ledger.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'defect-ledger-'));
const f = (n, body) => { const p = join(dir, n); writeFileSync(p, body, 'utf8'); return p; };
const ledgerP = f('ledger.md', led);
const mapP = f('map.json', JSON.stringify({ tasks: { F1: { kind: 'fix', round: 1, dispatch: 'ctx_1' } } }));
const reportP = f('report.md', report);
const cli = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
let r = cli('add', '--ledger', ledgerP, '--map', mapP, '--report', reportP, '--source', 'T07');
assert.equal(r.status, 0);
assert.deepEqual(JSON.parse(r.stdout), { added: ['H-1', 'A-H-2', 'M-1'], round: 2, open: { High: 1, Medium: 2, Low: 0 } });
assert.equal(readLedger(readFileSync(ledgerP, 'utf8')).defects.length, 3);
r = cli('add', '--ledger', ledgerP, '--map', mapP, '--report', reportP, '--source', 'T07');
assert.deepEqual(JSON.parse(r.stdout).added, []);
r = cli('add', '--ledger', join(dir, 'none.md'), '--map', mapP, '--report', reportP, '--source', 'T07');
assert.equal(r.status, 1);
assert.ok(JSON.parse(r.stdout).error);
r = cli('add');
assert.equal(r.status, 1);
assert.ok(JSON.parse(r.stdout).error);
ok();

console.log(`defect-ledger.check: ${passed} passed`);
