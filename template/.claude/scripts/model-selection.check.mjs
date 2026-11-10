// Self-test for model-selection.mjs — no Orca needed. `node .claude/scripts/model-selection.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, checkTable, lookup } from './model-selection.mjs';

const script = fileURLToPath(new URL('./model-selection.mjs', import.meta.url));
// Setup edits the real table per project, so value cases use this fixture; the real table is only parsed.
const real = readFileSync(new URL('../../docs/harness/model-selection.md', import.meta.url), 'utf8');
const table = [
  '# 모델 선택 표',
  '',
  '> 읽는 시점: Task를 배정할 때.',
  '> 소유: 사용자.',
  '> 형식 검사: `node .claude/scripts/model-selection.mjs check`',
  '',
  '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `coordinator` | 실행 감독 | claude | opus | high | |',
  '| `planner` | 설계, 계획 | claude | opus | max | 최고 추론 고정 |',
  '| `product-manager` | 수락 기준, 항목화 | claude | opus | medium | |',
  '| `product-manager` | 장부 정리, 완료 처리 | claude | sonnet | medium | |',
  '| `qa-inspector` | 흐름 검증 | claude | opus | medium | |',
  '| `qa-inspector` | 재검 | claude | sonnet | medium | 재현 확인만 한다 |',
  '| `code-reviewer` | 일반 변경 리뷰 | claude | opus | medium | |',
  '| `code-reviewer` | 보안·돈이 걸린 변경 리뷰 | claude | opus | high | |',
  '| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |',
  '| `*` | 리드 | claude | opus | high | 팀장으로 띄울 때 |',
  '| `*` | 기본 | claude | opus | medium | 표에 없는 조합 |',
  '',
].join('\n');
const AGENTS = ['planner', 'product-manager', 'qa-inspector', 'code-reviewer', 'harness-engineer'];
const opts = { agentNames: AGENTS, noEffortModels: ['haiku'] };
const crlf = '﻿' + table.replace(/\r?\n/g, '\r\n');
const errs = (text) => { const p = parseTable(text); return [...p.errors, ...checkTable(p.rows, opts)]; };
const addRow = (row) => table.replace('| `*` | 기본 |', `${row}\n| \`*\` | 기본 |`);
let passed = 0;
const t = (fn) => { fn(); passed++; };

const { rows, errors } = parseTable(crlf);

// 1. CRLF + BOM table parses into 11 rows, backticks stripped; the real table parses without errors
t(() => {
  assert.deepEqual(parseTable(real).errors, []);
  assert.equal(rows.length, 11);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].agent, 'coordinator');
  assert.deepEqual(checkTable(rows, opts), []);
});

// 2-6. lookup order: exact, comma-split exact, unit-default, default
for (const [agent, unit, model, effort, matched] of [
  ['qa-inspector', '재검', 'sonnet', 'medium', 'exact'],
  ['planner', '계획', 'opus', 'max', 'exact'],
  ['developer', '리드', 'opus', 'high', 'unit-default'],
  ['developer', '없는 단위', 'opus', 'medium', 'default'],
  ['code-reviewer', '보안·돈이 걸린 변경 리뷰', 'opus', 'high', 'exact'],
]) t(() => assert.deepEqual((({ model, effort, matched }) => ({ model, effort, matched }))(lookup(rows, agent, unit)), { model, effort, matched }));

// 7. duplicate (agent, unit) names both lines in one error
t(() => {
  const e = errs(addRow('| `planner` | 계획 | claude | opus | high | |'));
  const dup = e.filter((m) => m.includes('중복'));
  assert.equal(dup.length, 1);
  assert.match(dup[0], /L10/);
  assert.match(dup[0], /L19/);
});

// 8. 5-cell row
t(() => assert.ok(errs(addRow('| `planner` | 검토 | claude | opus | high |')).includes('L19: 칸 수 6이 아님')));

// 9. unknown agent
t(() => assert.ok(errs(addRow('| `ghost` | 검토 | claude | opus | high | |')).some((m) => /^L19: .*ghost/.test(m))));

// 10. effort on a no-effort model
t(() => assert.ok(errs(addRow('| `planner` | 검토 | claude | haiku | low | |')).some((m) => /^L19: .*haiku/.test(m))));

// 11. missing (*, 기본)
t(() => assert.ok(errs(table.replace(/^\| `\*` \| 기본 .*$/m, '')).some((m) => m.includes('기본'))));

// 12. CLI: check on a broken table → 1; lookup --json → 0 with model opus
t(() => {
  const dir = mkdtempSync(join(tmpdir(), 'model-selection-'));
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  for (const a of AGENTS) writeFileSync(join(dir, '.claude', 'agents', `${a}.md`), '');
  const good = join(dir, 'good.md');
  const bad = join(dir, 'bad.md');
  writeFileSync(good, table);
  writeFileSync(bad, addRow('| `ghost` | 검토 | claude | opus | high | |'));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  let r = run('check', '--table', good);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /model-selection: OK 11 rows/);
  r = run('check', '--table', bad);
  assert.equal(r.status, 1);
  r = run('lookup', '--agent', 'planner', '--unit', '설계', '--json', '--table', good);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).model, 'opus');
});

console.log(`model-selection.check: ${passed} passed`);
