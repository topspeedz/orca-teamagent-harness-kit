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

const report = '# 리포트\n\n## 결함\n\n| ID | 심각도 | 증거 | 위치 | 요지 | 영향 근거 |\n| --- | --- | --- | --- | --- | --- |\n'
  + '| H-1 | High | 관찰 `tests/login.test.mjs` | `src/login.mjs:12` | 잠금이 풀리지 않음 | 핵심 흐름 차단: 사용자가 로그인할 수 없음 |\n'
  + '| A-H-2 | Medium | 없음 | `src/a.mjs:3` | 근거 없이 올린 것 |\n'
  + '| M-1 | Medium | 인용 수락 기준 2 | `src/b.mjs:9` | 문구 다름 |\n\n## 검증\n';
// 1. 등급과 증거를 읽는다.
assert.deepEqual(parseDefects(report).map(d => [d.id, d.severity, d.evidence]),
  [['H-1', 'High', '관찰'], ['A-H-2', 'Medium', '없음'], ['M-1', 'Medium', '인용']]);
ok();
// 2. CRLF, 표 없음, 본문 "없음"
assert.equal(parseDefects(report.replace(/\n/g, '\r\n')).length, 3);
assert.deepEqual(parseDefects('# 리포트\n\n## 결함\n\n없음\n'), []);
assert.deepEqual(parseDefects('# 리포트\n'), []);
// A failed test is evidence of a failed assertion. Its product impact is independently required.
assert.throws(() => parseDefects(report.replace('관찰 `tests', '추정 `tests')), /H-1.*영향 근거/);
assert.throws(() => parseDefects(report.replace('핵심 흐름 차단: 사용자가 로그인할 수 없음', '영향 미확인')), /H-1.*영향 근거/);
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
const closed = once.replace('| H-1 | T07 | High | 관찰 — 핵심 흐름 차단: 사용자가 로그인할 수 없음 | 1 | 열림 |', '| H-1 | T07 | High | 관찰 — 핵심 흐름 차단: 사용자가 로그인할 수 없음 | 1 | 확정 |');
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
const legacy = once.replace('관찰 — 핵심 흐름 차단: 사용자가 로그인할 수 없음', '관찰');
assert.equal(fixAllowed(readLedger(legacy), ['H-1']).ok, false);
assert.equal(addDefects(legacy, { source: 'someone-else', round: 3, defects: [parseDefects(report)[0]] }), legacy);
assert.equal(addDefects(legacy, { source: 'T07', round: 3, defects: parseDefects(report) }), once);
const L = readLedger(once.replace('- 첫 줄', '- M-1 | 수정 포함 승인 | 이번에 같이 고쳐 주세요'));
assert.equal(fixAllowed(L, ['H-1', 'M-1']).ok, true);
assert.deepEqual(fixAllowed(readLedger(once), ['M-1', 'X-9']).refused.map(r => r.id), ['M-1', 'X-9']);
assert.equal(fixAllowed(readLedger(closed), ['H-1']).ok, false);   // 이미 닫힌 High
ok();

const tbl = (rows) => ['## 결함', '', '| ID | 심각도 | 증거 | 위치 | 요지 | 영향 근거 |', '| --- | --- | --- | --- | --- | --- |', rows, ''].join('\n');

// A failing required assertion remains in the report regardless of whether product impact is established.
const failure = '관찰: 같은 입력에서 회귀 시험 실패';
const unknown = `## 남은 것\n- 영향 미확인 · ${failure} · 다음 확인: 원래 수순 실행`;
const pending = readLedger(addDefects(led, { source: 'QA', round: 1, defects: parseDefects(unknown) }));
assert.equal(fixAllowed(pending, ['QA-1']).ok, false);
for (const impact of ['', '영향 미확인', '핵심 흐름 차단: ', '출시 차단 기준: <출처>']) {
  assert.throws(() => parseDefects(tbl(`| QA-1 | High | ${failure} | 화면 | 장면 차이 | ${impact} |`)), /QA-1.*영향 근거/);
}
const qualified = tbl(`| QA-1 | High | ${failure} | 화면 | 단축키 A\\|B | 핵심 흐름 차단: 저장 후 작업을 다시 열 수 없음 |`);
const reviewed = readLedger(addDefects(led, { source: 'QA', round: 1, defects: parseDefects(qualified) }));
assert.equal(fixAllowed(reviewed, ['QA-1']).ok, true);
assert.throws(() => parseDefects(qualified.replace(failure, '관찰:')), /QA-1.*영향 근거/);
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
assert.deepEqual(JSON.parse(r.stdout), { added: ['H-1', 'A-H-2', 'M-1'], round: 2, open: { High: 1, Medium: 2, Low: 0 }, existing: [] });
assert.equal(readLedger(readFileSync(ledgerP, 'utf8')).defects.length, 3);
r = cli('add', '--ledger', ledgerP, '--map', mapP, '--report', reportP, '--source', 'T07');
assert.deepEqual(JSON.parse(r.stdout).added, []);
// 같은 리포트를 두 번 넣으면 그 ID가 existing에 나오고 아무것도 붙지 않는다
assert.deepEqual(JSON.parse(r.stdout).existing, [{ id: 'H-1', source: 'T07' }, { id: 'A-H-2', source: 'T07' }, { id: 'M-1', source: 'T07' }]);
// 다른 검증이 같은 ID를 다른 결함에 쓰면 장부는 그대로이고, 그 ID가 먼저 적힌 출처와 함께 existing에 나온다
const beforeOther = readFileSync(ledgerP, 'utf8');
const otherP = f('other.md', tbl('| H-1 | High | 관찰 다른 테스트 | src/c.mjs:1 | 다른 결함 | 중대한 피해: 다른 사용자의 데이터 유실 |'));
r = cli('add', '--ledger', ledgerP, '--map', mapP, '--report', otherP, '--source', 'T11');
assert.equal(r.status, 0);
assert.equal(readFileSync(ledgerP, 'utf8'), beforeOther);
assert.deepEqual(JSON.parse(r.stdout), { added: [], round: 2, open: { High: 1, Medium: 2, Low: 0 }, existing: [{ id: 'H-1', source: 'T07' }] });
r = cli('add', '--ledger', join(dir, 'none.md'), '--map', mapP, '--report', reportP, '--source', 'T07');
assert.equal(r.status, 1);
assert.ok(JSON.parse(r.stdout).error);
r = cli('add');
assert.equal(r.status, 1);
assert.ok(JSON.parse(r.stdout).error);
ok();

// 8. unrecognised severity is refused, not dropped; messy spellings are normalised
assert.deepEqual(parseDefects(tbl('| H-3 | high | 관찰`t.mjs` | a | b | 출시 차단 기준: AC-1 필수 로그인이 실패 |\n| H-4 | **High** | 관찰 x | a | b | 핵심 흐름 차단: 로그인이 거부됨 |')).map(d => [d.severity, d.evidence]),
  [['High', '관찰'], ['High', '관찰']]);
assert.throws(() => parseDefects(tbl('| H-3 | Critical | 관찰 x | a | b | 핵심 흐름 차단: 로그인이 거부됨 |')), /H-3.*Critical/);
// an ID used twice in one report is refused instead of keeping only the first row
assert.throws(() => parseDefects(tbl('| H-3 | High | 관찰 x | a | b | 핵심 흐름 차단: 로그인이 거부됨 |\n| H-3 | Medium | 관찰 y | c | d |')), /H-3/);
assert.throws(() => readLedger(once.replace('| H-1 | T07 | High |', '| H-1 | T07 | Critical |')), /H-1/);
const badP = f('bad.md', tbl('| H-3 | Critical | 관찰 x | a | b | 핵심 흐름 차단: 로그인이 거부됨 |'));
r = cli('add', '--ledger', ledgerP, '--map', mapP, '--report', badP, '--source', 'T08');
assert.equal(r.status, 1);
assert.match(JSON.parse(r.stdout).error, /H-3/);
assert.equal(readFileSync(ledgerP, 'utf8'), addDefects(led, { source: 'T07', round: 2, defects: parseDefects(report) }));
ok();

// 9. `## 스냅샷` 절이 채워져 있어도 원장 읽기와 add 결과는 같다
const snap = '\n## 스냅샷\n\n- T07 | 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n- T09 | 9daeafb9864cf43055ae93beb0afd6c7d144bfa4\n';
assert.deepEqual(readLedger(once + snap), readLedger(once));
assert.equal(addDefects(led + snap, { source: 'T07', round: 1, defects: parseDefects(report) }), once + snap);
ok();

console.log(`defect-ledger.check: ${passed} passed`);
