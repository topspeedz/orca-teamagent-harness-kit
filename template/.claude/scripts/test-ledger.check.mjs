// Self-test for test-ledger.mjs — no test runner needed. `node .claude/scripts/test-ledger.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./test-ledger.mjs', import.meta.url));
let n = 0;

const CASES = `# 테스트 케이스 장부

## 최근 전체 테스트

| 명령 | 통과 | 실패 | phase |
| --- | --- | --- | --- |
| \`npm test\` | 10 | 1 | old-phase |

## 케이스

| ID | 목적 | 우선순위 | 추적 | 전제 조건 | 입력과 절차 | 기대 결과 | 자동화 위치 | 최근 결과 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CART-001 | 담기 | 높음 | FR-001 | 없음 | 요약 | 담긴다 | \`tests/cart.test.ts\` › \`adds a line\` | 미실행 |
| TC-CART-002 | 빼기 | 높음 | FR-001 | 없음 | 요약 | 빠진다 | \`tests/cart.test.ts\` › \`removes a line\` | 통과 (old-phase) |
| TC-CART-003 | 합계 | 보통 | FR-002 | 없음 | 요약 | 맞다 | \`tests/total.test.ts\` › \`sums the lines and …\` | 미실행 |
| TC-CART-004 | 이름이 바뀐 테스트 | 보통 | FR-003 | 없음 | 요약 | 맞다 | \`tests/cart.test.ts\` › \`renamed since\` | 통과 (old-phase) |
| TC-CART-005 | 손으로 | 보통 | FR-004 | 없음 | 절차 | 보인다 | 손으로 한다 — 아래 절차 | 통과 (old-phase) |
`;
const RTM = `# 요구사항 추적표 (RTM)

## 추적표

| 요구사항 ID | 요구사항 | 화면·기능 ID | 계약 ID | 코드 | 테스트 ID | 상태 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR-001 | 담고 뺀다 | SCR-001 | | \`lib/cart.ts\` | TC-CART-001, TC-CART-002 | 검증됨 | |
| FR-002 | 합계 | SCR-001 | | \`lib/total.ts\` | TC-CART-003 | 구현됨 | |
| FR-003 | 이름 | SCR-001 | | \`lib/cart.ts\` | TC-CART-004 | 구현됨 | |
| FR-004 | 손으로 | SCR-001 | | \`lib/x.ts\` | TC-CART-005 | 구현됨 | |
| FR-005 | 계획 | | | | TC-CART-003 | 계획됨 | |
| FR-006 | 근거 없음 | | | \`lib/y.ts\` | TC-CART-003 | 확인 필요 | 사유 |
| FR-007 | 테스트 없음 | | | \`lib/z.ts\` | | 구현됨 | |
`;
// vitest and jest write the same shape: a file per entry, a title and a status per test
const RESULTS = {
  numPassedTests: 2, numFailedTests: 1,
  testResults: [
    { name: 'D:\\repo\\tests\\cart.test.ts', assertionResults: [
      { title: 'adds a line', fullName: 'cart adds a line', status: 'failed' },
      { title: 'removes a line', fullName: 'cart removes a line', status: 'passed' },
    ] },
    { name: '/repo/tests/total.test.ts', assertionResults: [{ title: 'sums the lines and the shipping fee', fullName: 'total sums the lines and the shipping fee', status: 'passed' }] },
  ],
};

function world() {
  const root = mkdtempSync(join(tmpdir(), 'test-ledger-'));
  mkdirSync(join(root, 'docs/09-testing'), { recursive: true });
  mkdirSync(join(root, 'docs/10-traceability'), { recursive: true });
  writeFileSync(join(root, 'docs/09-testing/test-cases.md'), CASES);
  writeFileSync(join(root, 'docs/10-traceability/rtm.md'), RTM);
  writeFileSync(join(root, 'results.json'), JSON.stringify(RESULTS));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [script, '--root', root, '--results', join(root, 'results.json'), '--phase', 'p1', ...args], { encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout.trim().split('\n').pop()) };
  };
  const read = (p) => readFileSync(join(root, p), 'utf8');
  return { run, read };
}
const cell = (text, id, i) => text.split('\n').find((l) => l.startsWith(`| ${id} `)).split('|')[i].trim();

// results go into the 최근 결과 column; a test that is not in the run keeps what it had; a hand-run case is left alone
// a name the ledger cut short with an ellipsis (TC-CART-003) is found by the part before it
{
  const w = world();
  const { code, out } = w.run('--command', 'npm test');
  assert.equal(code, 0, JSON.stringify(out));
  const cases = w.read('docs/09-testing/test-cases.md');
  assert.equal(cell(cases, 'TC-CART-001', 9), '실패 (p1)');
  assert.equal(cell(cases, 'TC-CART-002', 9), '통과 (p1)');
  assert.equal(cell(cases, 'TC-CART-003', 9), '통과 (p1)');
  assert.equal(cell(cases, 'TC-CART-004', 9), '통과 (old-phase)');
  assert.equal(cell(cases, 'TC-CART-005', 9), '통과 (old-phase)');
  assert.deepEqual(out.cases, { passed: 2, failed: 1, missing: ['TC-CART-004'] });
  assert.match(cases, /\| `npm test` \| 2 \| 1 \| p1 \|/);
  n++;
}

// 구현됨 and 검증됨 follow the cases; 계획됨 and 확인 필요 are judgments and stay
{
  const w = world();
  const { out } = w.run();
  const rtm = w.read('docs/10-traceability/rtm.md');
  assert.equal(cell(rtm, 'FR-001', 7), '구현됨'); // one of its two cases failed
  assert.equal(cell(rtm, 'FR-002', 7), '검증됨');
  assert.equal(cell(rtm, 'FR-003', 7), '검증됨'); // its case still holds an earlier pass
  assert.equal(cell(rtm, 'FR-004', 7), '검증됨'); // hand-run case, passed
  assert.equal(cell(rtm, 'FR-005', 7), '계획됨');
  assert.equal(cell(rtm, 'FR-006', 7), '확인 필요');
  assert.equal(cell(rtm, 'FR-007', 7), '구현됨');
  assert.deepEqual(out.rtm, { verified: ['FR-002', 'FR-003', 'FR-004'], reverted: ['FR-001'] });
  assert.equal(w.read('docs/09-testing/test-cases.md').includes('| `npm test` | 10 | 1 | old-phase |'), true); // no --command, row untouched
  n++;
}

// --dry reports the same and writes nothing; a second real run changes nothing more
{
  const w = world();
  const dry = w.run('--dry');
  assert.deepEqual(dry.out.rtm.reverted, ['FR-001']);
  assert.equal(w.read('docs/09-testing/test-cases.md'), CASES);
  assert.equal(w.read('docs/10-traceability/rtm.md'), RTM);
  w.run();
  const again = w.run();
  assert.deepEqual(again.out.files, []);
  n++;
}

// usage error
{
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--results/);
  n++;
}

console.log(`test-ledger.check: ${n} passed`);
