// Self-test for report-check.mjs — no Orca needed. `node .claude/scripts/report-check.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./report-check.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'report-check-'));
const run = (name, body, at = dir) => {
  const p = join(at, name);
  if (body !== undefined) writeFileSync(p, body, 'utf8');
  const r = spawnSync(process.execPath, [script, p], { encoding: 'utf8' });
  return { code: r.status, out: JSON.parse(r.stdout) };
};
let passed = 0;
const ok = () => passed++;

const head = '# 리포트\n## 검증\n';
const fence = '```\n보고: 검증 줄은 ✅/❌, 미실행도 ❌\n```\n';

// pass: counted ✅ only; a (참고) ❌ goes to notes; fenced template text is ignored
let r = run('pass.md', `${head}- ✅ \`npm run check\`\n| vitest | ✅ 12/12 |\n- (참고) ❌ Lighthouse 미실행\n${fence}`);
assert.equal(r.code, 0);
assert.deepEqual(r.out, { ok: true, checked: 2, failed: [], notes: ['- (참고) ❌ Lighthouse 미실행'] });
ok();

// one counted ❌ → exit 1 with that line
r = run('fail.md', `${head}- ✅ check\r\n- ❌ npm test 미실행\r\n`);
assert.equal(r.code, 1);
assert.deepEqual(r.out.failed, ['- ❌ npm test 미실행']);
assert.equal(r.out.checked, 2);
ok();

// no ✅ at all → exit 1
r = run('none.md', `${head}검증 줄 없음\n`);
assert.equal(r.code, 1);
assert.equal(r.out.checked, 0);
ok();

// only (참고) ❌ lines → nothing counted → exit 1 (✅ 0), the ❌ are notes
r = run('notes-only.md', `${head}1. (참고) ❌ 390 스크린샷\n> (참고) ❌ axe\n`);
assert.equal(r.code, 1);
assert.equal(r.out.checked, 0);
assert.equal(r.out.notes.length, 2);
ok();

// missing file → exit 1, error text
r = run('missing.md');
assert.equal(r.code, 1);
assert.equal(r.out.ok, false);
assert.match(r.out.error, /ENOENT/);
ok();

// QA/review shape: ❌ in acceptance/defect sections outside 검증 are findings → exit 0
r = run('review.md', '# 코드 리뷰\n## 완료 기준 대조\n| 기준 | 근거 | ❌ |\n## 결함\n### R-1 [High] 누락\n- ❌ 캐시 태그 없음\n### 교차 검증 범위\n- ❌ 형제 호출부 1곳 누락\n## 5. 검증\n- ✅ npm run check\n### 실측\n- ✅ vitest 3/3\n## 판단 필요\n- ❌ 스펙 충돌\n');
assert.equal(r.code, 0);
assert.deepEqual(r.out, { ok: true, checked: 2, failed: [], notes: [] });
ok();

// a ❌ inside the 검증 section (sub-heading included) still fails; ✅ outside it is not counted
r = run('verify-fail.md', '# 리포트\n## 결함\n- ✅ 범위 밖\n## 검증\n- ✅ check\n### 재검\n- ❌ npm test 미실행\n');
assert.equal(r.code, 1);
assert.deepEqual(r.out.failed, ['- ❌ npm test 미실행']);
assert.equal(r.out.checked, 2);
ok();

// mark-first (참고) — "❌ (참고)" and "❌(참고, 미실행)" are notes, not failures
r = run('mark-first.md', `${head}- ✅ check\n- ❌ (참고) 전체 npm test — 코디네이터 몫\n- ❌(참고, 미실행) reduced-motion\n`);
assert.equal(r.code, 0);
assert.deepEqual(r.out, { ok: true, checked: 1, failed: [], notes: ['- ❌ (참고) 전체 npm test — 코디네이터 몫', '- ❌(참고, 미실행) reduced-motion'] });
ok();

// no 검증 heading → not judged as a whole any more
r = run('no-verify.md', '# 리포트\n- ✅ check\n');
assert.equal(r.code, 1);
assert.equal(r.out.error, '검증 절 없음');
ok();

// 검증 heading with nothing under it
r = run('empty-verify.md', head);
assert.equal(r.code, 1);
assert.equal(r.out.checked, 0);
ok();

// only a (참고) ❌ line under 검증
r = run('note-only.md', `${head}- (참고) ❌ 미실행\n`);
assert.equal(r.code, 1);
assert.equal(r.out.notes.length, 1);
ok();

// a higher version in the same folder wins
const versions = join(dir, 'versions');
mkdirSync(versions);
writeFileSync(join(versions, '05_qa-inspector_qa-report_v2.md'), `${head}- ✅ check\n`, 'utf8');
r = run('05_qa-inspector_qa-report_v1.md', `${head}- ✅ check\n`, versions);
assert.equal(r.code, 1);
assert.match(r.out.error, /_v2\.md/);
ok();
r = run('05_qa-inspector_qa-report_v2.md', undefined, versions);
assert.equal(r.code, 0);
ok();

// re-check cap: the next version carries "재검 회차: N"
r = run('cap3.md', `${head}재검 회차: 3\n- ✅ check\n`);
assert.equal(r.code, 1);
assert.match(r.out.failed[0], /재검 상한 2회 초과/);
ok();
r = run('cap2.md', `${head}재검 회차: 2\n- ✅ check\n`);
assert.equal(r.code, 0);
ok();

// CRLF gives the same result as LF
const body = '# 리포트\n## 결함\n- ❌ 발견\n## 검증\n- ✅ check\n- (참고) ❌ 미실행\n```\n- ❌ 양식\n```\n';
const lf = run('lf.md', body);
const crlf = run('crlf.md', body.replace(/\n/g, '\r\n'));
assert.deepEqual(crlf, lf);
assert.equal(lf.code, 0);
ok();

// a folder name with spaces and Hangul
const spaced = join(dir, '리포트 모음 1');
mkdirSync(spaced);
r = run('01_planner_plan_v1.md', `${head}- ✅ check\n`, spaced);
assert.equal(r.code, 0);
ok();

// R1 A-3: run through a junction or symlink to the scripts folder — main must still run (exit 1 and JSON for a failing report)
const link = join(dir, 'linked scripts');
let linked = true;
try { symlinkSync(dirname(script), link, 'junction'); } catch (e) { linked = false; console.log(`건너뜀: 링크를 만들 수 없어 링크 경유 실행 사례를 돌리지 않음 (${e.code ?? e.message})`); }
if (linked) {
  const viaLink = spawnSync(process.execPath, [join(link, 'report-check.mjs'), join(dir, 'fail.md')], { encoding: 'utf8' });
  assert.equal(viaLink.status, 1, `stdout: ${viaLink.stdout}`);
  assert.deepEqual(JSON.parse(viaLink.stdout).failed, ['- ❌ npm test 미실행']);
  ok();
}

console.log(`report-check.check: ${passed} passed`);
