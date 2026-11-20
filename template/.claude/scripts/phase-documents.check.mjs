import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = mkdtempSync(join(tmpdir(), 'phase-documents-'));
const cwd = join(fixture, 'project');
const script = fileURLToPath(new URL('./phase-documents.mjs', import.meta.url));
const heading = '## 라이브 문서 확인\n\n';
const table = heading + '| BL | 문서 | 절·ID | 지정 작성자 | 결과 | 근거 | 이월 사유 | 사용자 답변 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
const qa = '`qa.md`';
const sync = '`sync.md`';
const a = ['BL-0001', 'openapi.yaml', 'getOrder', 'api-owner'];
const b = ['BL-0002', 'runbook.md', '복구', 'ops-owner'];
const row = (fields) => '| ' + fields.join(' | ') + ' |';
const confirmed = (d) => row([...d, '현행 확인', sync, '', '']);
const reply = '네, 이번에는 다음 phase로 넘겨 주세요.';
const decision = (d) => '\n## 결정\n\n- ' + [d[0], d[1], d[2], '이월 승인', reply].join(' | ');
const defer = (d, answer) => row([...d, '이월', qa, '응답 검증 환경 대기', answer]);
function run(ledger) {
  writeFileSync(join(cwd, 'ledger.md'), ledger);
  const result = spawnSync(process.execPath, [script, 'ledger.md'], { cwd, encoding: 'utf8' });
  return { code: result.status, ...JSON.parse(result.stdout) };
}

try {
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'qa.md'), 'BL-0001 · getOrder 응답의 total 누락을 재현. api-owner에 전달');
  writeFileSync(join(cwd, 'sync.md'), ['## 반영 확인', '| 문서·절/ID | 지정 작성자 | 반영·현행 확인 근거 또는 대기 사유 |',
    '| --- | --- | --- |', '| openapi.yaml · getOrder | api-owner | 반영 · BL-0001 qa.md 재현과 계약 테스트 결과 대조 |',
    '| runbook.md · 복구 | ops-owner | 현행 확인 · BL-0001, BL-0002 복구 절차와 복구 테스트 대조 |'].join('\n'));
  writeFileSync(join(cwd, 'runbook.md'), '# 운영 가이드\n## 복구');
  writeFileSync(join(cwd, 'openapi.yaml'), 'operationId: getOrder');
  writeFileSync(join(cwd, 'CODEBASE_MAP.md'), '# 코드 지도\n\n> 설치 초안 · [작성 양식](form.md)');

  const historyOnly = run(heading + '필수 라이브 문서: 없음\n');
  assert.deepEqual(historyOnly, { code: 0, pending: [], verified: [], deferred: [] });
  assert.equal(run('# 구 장부\n').code, 1);
  const wait = run(table + row([...a, '반영 대기', qa, '', '']) + '\n' + confirmed(b));
  assert.equal(wait.code, 1);
  assert.deepEqual(wait.verified, ['BL-0002']);
  assert.deepEqual(run(table + row([...a, '반영', sync, '', '']) + '\n' + confirmed(b)).verified, ['BL-0001', 'BL-0002']);
  assert.equal(run(table + row([...a, '반영', qa, '', ''])).code, 1);
  assert.equal(run(table + row([...a.slice(0, 3), 'qa-inspector', '반영', sync, '', ''])).code, 1);
  assert.equal(run(table + confirmed([b[0], b[1], '다른 절', b[3]])).code, 1);
  assert.equal(run(table + row([b[0], ...a.slice(1), '반영', sync, '', ''])).code, 1);

  const ownerless = [...a.slice(0, 3), '미배정'];
  const carry = run(table + defer(ownerless, reply) + '\n' + confirmed(b) + decision(a));
  assert.deepEqual(carry, { code: 0, pending: [], verified: ['BL-0002'], deferred: ['BL-0001'] });
  for (const answer of ['', '답변 대기', '재시도 소진', '이월 거절', reply]) {
    assert.equal(run(table + defer(a, answer)).code, 1, answer);
  }
  for (const answer of ['답변 대기', '재시도 소진', '이월 거절', '아니요']) {
    assert.equal(run(table + defer(a, answer) + decision(a).replace(reply, answer)).code, 1, answer);
  }
  const sameBl = [a[0], ...b.slice(1)];
  assert.equal(run(table + defer(sameBl, reply) + decision(a)).code, 1);
  const mixed = run(table + defer(a, reply) + '\n' + confirmed(sameBl) + decision(a));
  assert.deepEqual(mixed.verified, []);
  assert.deepEqual(mixed.deferred, [a[0]]);
  const unfinished = run(table + defer(a, reply) + '\n' + row([...sameBl, '반영 대기', qa, '', '']) + decision(a));
  assert.equal(unfinished.code, 1);
  assert.deepEqual(unfinished.deferred, []);
  assert.equal(run(table + confirmed(ownerless)).code, 1);
  assert.equal(run(table + confirmed([...a.slice(0, 3), '`미배정`'])).code, 1);
  assert.deepEqual(run(table + confirmed(['없음', ...b.slice(1)])), { code: 0, pending: [], verified: [], deferred: [] });

  writeFileSync(join(fixture, 'outside.md'), 'getOrder');
  symlinkSync(fixture, join(cwd, 'outside'), 'junction');
  for (const doc of ['CODEBASE_MAP.md', 'missing.md', '../outside.md', join(fixture, 'outside.md'), 'outside/outside.md']) {
    appendFileSync(join(cwd, 'sync.md'), '\n' + row([doc + ' · getOrder', a[3], '반영 · BL-0001 계약 검사 대조']));
    assert.equal(run(table + row([a[0], doc, ...a.slice(2), '반영', sync, '', ''])).code, 1, doc);
  }
  writeFileSync(join(cwd, 'CODEBASE_MAP.md'), '# 코드 지도\n## getOrder\n주문 조회 모듈이 API 응답을 구성한다.');
  assert.equal(run(table + row([a[0], 'CODEBASE_MAP.md', ...a.slice(2), '반영', sync, '', ''])).code, 0);
  const outside = [a[0], 'outside/future.md', ...a.slice(2)];
  assert.equal(run(table + defer(outside, reply) + decision(outside)).code, 1);
  for (const malformed of [table.replace(' --- | --- |', ' --- |') + confirmed(b),
    table + confirmed(b) + '\nBL-0001 | CODEBASE_MAP.md | 미배정',
    table + confirmed(b) + '\n' + heading + '필수 라이브 문서: 없음',
    table + confirmed(b).replace(sync, '`missing-report.md`')]) {
    assert.equal(run(malformed).code, 1, malformed);
  }
  console.log('phase-documents: QA handoff, owner confirmation, explicit deferral, mixed BLs, history-only, drafts, paths and malformed evidence passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
