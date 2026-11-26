import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as launch } from './orca-launch.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'phase-resume-'));
const phase = '주문';
const run = join('_workspace/_run', phase), product = join('_workspace/product', phase);
const script = fileURLToPath(new URL('./phase-resume.mjs', import.meta.url));
const inspect = () => JSON.parse(execFileSync(process.execPath, [script, phase], { cwd, encoding: 'utf8' }));
const write = (path, body) => {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), body);
};
const verify = '\n## 검증\n- ✅ BL-0001의 수락 기준을 대조했다.\n';
const report = (folder, name, body) => write(join(folder, name + '.md'), body + verify);
const brief = join(run, 'brief.md');
const plan = join('docs/superpowers/plans', phase + '.md');
const hash = text => createHash('sha256').update(text).digest('hex');
try {
  const request = '# 브리프\n## 백로그 항목\n- BL-0001\n## 사용자 결정\n';
  write(brief, request);
  report(product, '01_prd-writer_requirements_v1', '요구사항 US-01과 FR-01 반영');
  report(product, '02_product-manager_backlog_v1', 'BL-0001 → FR-01');
  report(product, '03_pm-reviewer_review_v1', '검토 대상 PRD·SRS v1 / BL-0001\n열린 High PR-1: 오류 기준 누락');
  let state = inspect();
  assert.equal(state.reports.requirements[0].verification.ok, true);
  assert.match(state.reports.review[0].text, /열린 High PR-1/);
  assert.equal(state.brief, request);
  assert.equal(state.map, null);

  report(product, '01_product-manager_requirements_v2', 'FR-01 오류 기준 추가');
  report(product, '03_planner_review_v2', '검토 대상 PRD·SRS v2 / BL-0001 / PR-1 해결 / 열린 High 없음');
  const source = '# 계획 v1\nBL-0001 → T01';
  write(plan, source);
  const dag = { nodes: [{ id: 'T01', role: 'builder', unit: '구현', agent: 'claude', model: 'custom', bl: 'BL-0001' }], edges: [] };
  write(join(run, 'dag.json'), JSON.stringify(dag));
  const approved = '계획과 DAG v1 승인. BL-0001을 실행하세요.';
  write(brief, request + '| 11월 18일 | ' + approved + ' |\n');
  const review = '검토자 pm-reviewer / BL-0001 / 열린 쟁점 없음 / 계획 ' + hash(source) + ' / DAG ' + hash(JSON.stringify(dag));
  report(product, '06_pm-reviewer_plan-check_v1', review);
  state = inspect();
  assert.deepEqual(state.reports.requirements.map(r => r.revision), [1, 2]);
  assert.match(state.reports.review[1].text, /PR-1 해결/);
  assert.ok(state.reports.planCheck[0].text.includes(state.plan.sha256));
  assert.ok(state.reports.planCheck[0].text.includes(state.dag.sha256));
  assert.ok(state.brief.includes(approved));
  write(plan, '# 계획 v2\nBL-0001 → T01, T02');
  dag.nodes.push({ ...dag.nodes[0], id: 'T02' });
  dag.edges.push({ from: 'T01', to: 'T02' });
  write(join(run, 'dag.json'), JSON.stringify(dag));
  report(run, '04_planner_plan_v2', '계획 v2와 DAG 수정');
  state = inspect();
  assert.equal(state.reports.planCheck[0].text.includes(state.plan.sha256), false);
  assert.equal(state.reports.planCheck[0].text.includes(state.dag.sha256), false);
  assert.equal(state.reports.plan[0].revision, 2);
  report(product, '06_product-manager_plan-check_v2', '검토 대상 계획 v2 / BL-0001 / 열린 High PC-2');
  state = inspect();
  assert.match(state.reports.planCheck[1].text, /열린 High PC-2/);
  assert.ok(state.brief.includes(approved)); // The v1 response still refers to v1.

  const mapFile = join(run, 'orca-tasks.json');
  const map = { phase, run: 'run-old', tasks: { T01: { orca: 'task-old', agent: 'builder', unit: '구현',
    runtime: 'claude', model: 'custom', effort: 'high', deps: [], dispatch: 'dispatch-old' } } };
  write(brief, request + '창구 Run: run-desk / coordinator-dispatch\n실행 Run: run-old\n');
  write(mapFile, JSON.stringify(map));
  const settled = '## 결정\n- T01 / dispatch-old / message-old 정산 완료\n';
  write(join(run, 'ledger.md'), settled);
  for (let i = 0; i < 2; i++) {
    state = inspect();
    assert.deepEqual(state.map, map);
    assert.equal(state.ledger, settled);
    assert.match(state.brief, /coordinator-dispatch/);
    const result = await launch(['exec-run', '--phase', phase, '--map', mapFile],
      { read: path => readFileSync(join(cwd, path), 'utf8') });
    assert.equal(result.code, 0, JSON.stringify(result.out));
    assert.deepEqual([result.out.existing, result.out.run], [true, map.run]);
  }
  assert.equal(readFileSync(join(cwd, mapFile), 'utf8'), JSON.stringify(map));
  assert.equal(readFileSync(join(cwd, product, '06_pm-reviewer_plan-check_v1.md'), 'utf8'), review + verify);
  report(run, '03_planner_design_v1', '설계 v1');
  report(run, '04_product-manager_plan_v3', '계획 v3 (PM 한 세션)');
  state = inspect();
  assert.deepEqual(state.reports.design.map(r => r.revision), [1]);
  assert.deepEqual(state.reports.plan.map(r => r.revision), [2, 3]);
  report(run, '03_product-manager_design_v2', '설계 v2 (PM 한 세션)');
  assert.deepEqual(inspect().reports.design.map(r => r.revision), [1, 2]);
  report(product, '03_product-manager_review_v3', '검토 대상 PRD·SRS v3 / BL-0001 / 열린 High 없음 (PM 한 세션)');
  assert.match(inspect().reports.review.at(-1).text, /PM 한 세션/);
  console.log('phase-resume: old and new reports, changed plan, open issues, original approval and existing Run/Dispatch passed');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
