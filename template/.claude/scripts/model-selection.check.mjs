// Self-test for model-selection.mjs — no Orca needed. `node .claude/scripts/model-selection.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, checkTable, checkRules, lookup, toCodex, choices } from './model-selection.mjs';

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
  '| `product-manager` | 설계, 계획 | claude | opus | max | 최고 추론 고정 |',
  '| `product-manager` | 수락 기준, 항목화 | claude | opus | medium | |',
  '| `product-manager` | 장부 정리, 완료 처리 | claude | sonnet | medium | |',
  '| `verifier` | 흐름 검증 | claude | opus | medium | |',
  '| `verifier` | 재검 | claude | sonnet | medium | 재현 확인만 한다 |',
  '| `verifier` | 일반 변경 리뷰 | claude | opus | medium | |',
  '| `verifier` | 보안·돈이 걸린 변경 리뷰 | claude | opus | high | |',
  '| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |',
  '| `*` | 기본 | claude | opus | medium | 표에 없는 조합 |',
  '',
].join('\n');
const AGENTS = ['product-manager', 'verifier', 'harness-engineer'];
const opts = { agentNames: AGENTS, noEffortModels: ['haiku'] };
const crlf = '﻿' + table.replace(/\r?\n/g, '\r\n');
const errs = (text) => { const p = parseTable(text); return [...p.errors, ...checkTable(p.rows, opts)]; };
const addRow = (row) => table.replace('| `*` | 기본 |', `${row}\n| \`*\` | 기본 |`);
let passed = 0;
const t = (fn) => { fn(); passed++; };

const { rows, errors } = parseTable(crlf);

// 1. CRLF + BOM table parses into 10 rows, backticks stripped; the real table parses without errors
t(() => {
  assert.deepEqual(parseTable(real).errors, []);
  assert.equal(rows.length, 10);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].agent, 'coordinator');
  assert.deepEqual(checkTable(rows, opts), []);
});

// 2-6. lookup order: exact, comma-split exact, unit-default, default
for (const [agent, unit, model, effort, matched] of [
  ['verifier', '재검', 'sonnet', 'medium', 'exact'],
  ['product-manager', '계획', 'opus', 'max', 'exact'],
  ['developer', '기본', 'opus', 'medium', 'unit-default'],
  ['developer', '없는 단위', 'opus', 'medium', 'default'],
  ['verifier', '보안·돈이 걸린 변경 리뷰', 'opus', 'high', 'exact'],
]) t(() => assert.deepEqual((({ model, effort, matched }) => ({ model, effort, matched }))(lookup(rows, agent, unit)), { model, effort, matched }));

// 7. duplicate (agent, unit) names both lines in one error
t(() => {
  const e = errs(addRow('| `product-manager` | 계획 | claude | opus | high | |'));
  const dup = e.filter((m) => m.includes('중복'));
  assert.equal(dup.length, 1);
  assert.match(dup[0], /L10/);
  assert.match(dup[0], /L18/);
});

// 8. 5-cell row
t(() => assert.ok(errs(addRow('| `product-manager` | 검토 | claude | opus | high |')).includes('L18: 칸 수 6이 아님')));

// 9. unknown agent
t(() => assert.ok(errs(addRow('| `ghost` | 검토 | claude | opus | high | |')).some((m) => /^L18: .*ghost/.test(m))));

// 10. effort on a no-effort model
t(() => assert.ok(errs(addRow('| `product-manager` | 검토 | claude | haiku | low | |')).some((m) => /^L18: .*haiku/.test(m))));

// 11. missing (*, 기본)
t(() => assert.ok(errs(table.replace(/^\| `\*` \| 기본 .*$/m, '')).some((m) => m.includes('기본'))));

// 12. CLI: check on a broken table → 1; lookup --json → 0 with model opus
t(() => {
  const dir = mkdtempSync(join(tmpdir(), 'model-selection-'));
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  for (const a of AGENTS) writeFileSync(join(dir, '.claude', 'agents', a === 'product-manager' ? 'product-manager.md.agent-toggle-off' : `${a}.md`), '');
  const good = join(dir, 'good.md');
  const bad = join(dir, 'bad.md');
  writeFileSync(good, table);
  writeFileSync(bad, addRow('| `ghost` | 검토 | claude | opus | high | |'));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  let r = run('check', '--table', good);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /model-selection: OK 10 rows/);
  r = run('check', '--table', bad);
  assert.equal(r.status, 1);
  r = run('lookup', '--agent', 'product-manager', '--unit', '설계', '--json', '--table', good);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).model, 'opus');
});

const fixture = table.replace('| `*` | 기본 | claude | opus | medium |', '| `*` | 기본 | claude | 산정 | |')
  .replace('보안·돈이 걸린 변경 리뷰 | claude | opus | high', '보안·돈이 걸린 변경 리뷰 | claude | fable | xhigh')
  + '\n| Claude | Codex | 메모 |\n| --- | --- | --- |\n| haiku | gpt-6.2-sol/low | |\n'
  + ['sonnet', 'opus', 'fable'].flatMap(m => ['low','medium','high','xhigh','max'].map((e,i) =>
    `| ${m}/${e} | gpt-6.2-${m === 'sonnet' ? 'sol' : 'astra'}/${m === 'fable' ? ['medium','high','xhigh','max','ultra'][i] : e} | |`)).join('\n');

// 13-17. formula rows (model `산정`): lookup returns the row as written, the Codex table must be complete, the old marker and table are refused
{
  const rules = parseTable(fixture);
  t(() => {
    const r = lookup(rules.rows, 'unity-gameplay-engineer', '게임플레이 구현');
    assert.deepEqual([r.model, r.effort, r.matched], ['산정', null, 'default']);
    assert.equal(lookup(rules.rows, 'verifier', '보안·돈이 걸린 변경 리뷰').model, 'fable');
  });
  t(() => assert.deepEqual(checkRules(rules.rows, rules), []));
  t(() => {
    const broken = parseTable(fixture.replace(/^\| fable\/max \|.*$/m, '').replace('| `*` | 기본 | claude | 산정 | |', '| `*` | 기본 | claude | 산정 | high |'));
    const e = checkRules(broken.rows, broken);
    assert.ok(e.some((m) => /빠진 Claude 조합 fable\/max/.test(m)), e.join('\n'));
    assert.ok(e.some((m) => /산정 줄은 effort를 비움/.test(m)), e.join('\n'));
  });
  t(() => {
    // a table still on the 0.6.0 marker: each old row and the old complexity table are named once
    const old = parseTable(fixture.replace('| `*` | 기본 | claude | 산정 | |', '| `*` | 기본 | claude | 복잡도 | |')
      + '\n\n| 복잡도 | model | effort |\n| --- | --- | --- |\n| 13 | fable | high |\n');
    const e = checkRules(old.rows, old);
    assert.equal(e.filter((m) => /`복잡도`는 0\.6\.1에서 `산정`/.test(m)).length, 1, e.join('\n'));
    assert.equal(e.filter((m) => /복잡도 기본표는 0\.6\.1에서 없어졌다/.test(m)).length, 1, e.join('\n'));
  });
  t(() => {
    // no formula row and no Codex table: nothing to check
    const plain = parseTable(table);
    assert.deepEqual(checkRules(plain.rows, plain), []);
  });
}

// 18. CLI lookup: a formula row prints the routing hint, a fixed row does not; --json carries fixed
t(() => {
  const dir = mkdtempSync(join(tmpdir(), 'model-selection-'));
  const file = join(dir, 'm.md');
  writeFileSync(file, fixture.replace('| `coordinator` | 실행 감독 | claude | opus | high | |', '| `coordinator` | 실행 감독 | claude | opus | high | 고정 |'));
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--table', file], { cwd: dir, encoding: 'utf8' });
  let r = run('lookup', '--agent', 'developer', '--unit', '없는 단위');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude 산정 \(default\) — 고정 행이 아니라 Task 점수로 정한다/);
  r = run('lookup', '--agent', 'coordinator', '--unit', '실행 감독');
  assert.equal(r.stdout.trim(), 'claude opus/high (exact)');
  r = run('lookup', '--agent', 'coordinator', '--unit', '실행 감독', '--json');
  assert.equal(JSON.parse(r.stdout).fixed, true);
});

// 19. Codex table conversion and the dropdown choices
t(() => {
  const { codex } = parseTable(fixture);
  assert.deepEqual(toCodex('fable', 'max', codex), { model: 'gpt-6.2-astra', effort: 'ultra' });
  assert.deepEqual(toCodex('haiku', null, codex), { model: 'gpt-6.2-sol', effort: 'low' });
  const c = choices(codex);
  assert.deepEqual(c.claude.haiku, []);
  assert.equal(Object.keys(c.codex).length, 16);
  assert.equal(c.codex['sonnet/high'], 'gpt-6.2-sol/high');
});

console.log(`model-selection.check: ${passed} passed`);
