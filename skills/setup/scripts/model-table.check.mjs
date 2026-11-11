// Self-test for model-table.mjs — fixtures live in a temp folder. `node skills/setup/scripts/model-table.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addRows, applyChoices, validate } from './model-table.mjs';

const SCRIPT = fileURLToPath(new URL('./model-table.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'model-table-check-'));
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const T = [
  '# 모델 선택 표', '',
  '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |', '| --- | --- | --- | --- | --- | --- |',
  '| `planner` | 설계, 계획 | claude | opus | max | 사용자 메모   |',
  '| `qa-inspector` | 재검 | claude | sonnet | medium | |',
  '| `*` | 리드 | claude | opus | high | |', '| `*` | 기본 | claude | opus | medium | |', '',
].join('\n');
const QA = '| `qa-inspector` | 재검 | claude | sonnet | medium | |';

test('only the chosen row changes, only its two cells', () => {
  const out = applyChoices(T, [{ agent: 'qa-inspector', unit: '재검', model: 'opus', effort: 'high' }]);
  assert.equal(out, T.replace(QA, '| `qa-inspector` | 재검 | claude | opus | high | |'));
  // a CRLF table with a BOM keeps both
  const crlf = `﻿${T.replaceAll('\n', '\r\n')}`;
  const out2 = applyChoices(crlf, [{ agent: 'qa-inspector', unit: '재검', model: 'opus', effort: 'high' }]);
  assert.equal(out2, crlf.replace(QA, '| `qa-inspector` | 재검 | claude | opus | high | |'));
  // a choice without an effort key keeps the current effort
  assert.ok(applyChoices(T, [{ agent: 'qa-inspector', unit: '재검', model: 'opus' }]).includes('| `qa-inspector` | 재검 | claude | opus | medium | |'));
  // padded cells: only the model cell changes, the rest of the row stays byte for byte
  const spaced = T.replace(QA, '| `qa-inspector` |  재검  |  claude  | sonnet |  medium  |  메모  |');
  assert.equal(applyChoices(spaced, [{ agent: 'qa-inspector', unit: '재검', model: 'opus' }]), spaced.replace('| sonnet |', '| opus |'));
});

test('a row missing from the table is an error', () => {
  assert.throws(() => applyChoices(T, [{ agent: 'ghost', unit: '재검', model: 'opus', effort: 'high' }]), /ghost/);
});

test('values outside the lists are errors, unchanged cells are left alone', () => {
  assert.throws(() => applyChoices(T, [{ agent: 'planner', unit: '설계, 계획', model: 'gpt-4', effort: 'max' }]), /gpt-4/);
  assert.throws(() => applyChoices(T, [{ agent: 'planner', unit: '설계, 계획', model: 'opus', effort: 'ultra' }]), /ultra/);
  const pinned = T.replace('| sonnet | medium |', '| claude-sonnet-5-5 | medium |');
  assert.ok(applyChoices(pinned, [{ agent: 'qa-inspector', unit: '재검', model: 'claude-sonnet-5-5', effort: 'high' }]).includes('| claude-sonnet-5-5 | high |'));
});

test('haiku takes no effort', () => {
  assert.equal(validate({ model: 'haiku', effort: 'low' }, 'claude') !== null, true);
  assert.ok(applyChoices(T, [{ agent: 'qa-inspector', unit: '재검', model: 'haiku', effort: '' }]).includes('| `qa-inspector` | 재검 | claude | haiku | | |'));
});

test('codex rows take any model; runtime changes are checked against the new runtime', () => {
  assert.equal(validate({ model: 'gpt-5.2-codex', effort: 'high' }, 'codex'), null);
  assert.ok(applyChoices(T, [{ agent: 'qa-inspector', unit: '재검', runtime: 'codex', model: 'gpt-5.2-codex', effort: 'high' }]).includes('| `qa-inspector` | 재검 | codex | gpt-5.2-codex | high | |'));
  assert.throws(() => applyChoices(T, [{ agent: 'qa-inspector', unit: '재검', runtime: 'gemini', model: 'x', effort: '' }]), /gemini/);
  assert.equal(applyChoices(T, [{ agent: 'planner', unit: '설계, 계획', runtime: 'claude', model: 'opus', effort: 'max' }]), T);
});

test('new rows go before the first `*` row, duplicates are errors', () => {
  const added = addRows(T, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: '' }]);
  assert.ok(added.indexOf('`developer`') < added.indexOf('`*`') && added.indexOf('`developer`') > added.indexOf('`qa-inspector`'));
  assert.throws(() => addRows(added, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: '' }]), /developer/);
  assert.throws(() => addRows(T, [{ agent: '', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: '' }]));
  assert.throws(() => addRows(T, [{ agent: 'developer', unit: '', runtime: 'claude', model: 'opus', effort: 'medium', note: '' }]));
  assert.throws(() => addRows(T, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: 'a | b' }]));
  assert.throws(() => addRows(T, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: 'a\nb' }]));
  assert.throws(() => addRows(T, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'gpt-4', effort: 'medium', note: '' }]), /gpt-4/);
});

test('CLI apply and add: a failure leaves the table as it was and exits 1', () => {
  const table = join(root, 'apply.md');
  const choices = join(root, 'choices.json');
  writeFileSync(table, T, 'utf8');
  writeFileSync(choices, JSON.stringify([
    { agent: 'qa-inspector', unit: '재검', model: 'opus', effort: 'high' },
    { agent: 'ghost', unit: '재검', model: 'opus', effort: 'high' },
  ]), 'utf8');
  const r = cli('apply', '--table', table, '--choices', choices);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ghost/);
  assert.equal(readFileSync(table, 'utf8'), T);
  writeFileSync(choices, JSON.stringify([{ agent: 'qa-inspector', unit: '재검', model: 'opus', effort: 'high' }]), 'utf8');
  assert.equal(cli('apply', '--table', table, '--choices', choices).status, 0);
  assert.ok(readFileSync(table, 'utf8').includes('| `qa-inspector` | 재검 | claude | opus | high | |'));
  const rows = join(root, 'rows.json');
  writeFileSync(table, T, 'utf8');
  writeFileSync(rows, JSON.stringify([{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'gpt-4', effort: 'medium', note: '' }]), 'utf8');
  const a = cli('add', '--table', table, '--rows', rows);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /gpt-4/);
  assert.equal(readFileSync(table, 'utf8'), T);
});

test('CLI rows prints the six cells as they are', () => {
  const table = join(root, 'rows.md');
  writeFileSync(table, T, 'utf8');
  const r = cli('rows', '--table', table);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { agent: 'planner', unit: '설계, 계획', runtime: 'claude', model: 'opus', effort: 'max', note: '사용자 메모' },
    { agent: 'qa-inspector', unit: '재검', runtime: 'claude', model: 'sonnet', effort: 'medium', note: '' },
    { agent: '*', unit: '리드', runtime: 'claude', model: 'opus', effort: 'high', note: '' },
    { agent: '*', unit: '기본', runtime: 'claude', model: 'opus', effort: 'medium', note: '' },
  ]);
});

console.log(`model-table.check: ${n} cases passed`);
