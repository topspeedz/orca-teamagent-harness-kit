// Self-test for model-table.mjs — fixtures live in a temp folder. `node skills/setup/scripts/model-table.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addRows, applyChoices, buildPage, codexModels, EFFORTS, MODELS, validate } from './model-table.mjs';

const SCRIPT = fileURLToPath(new URL('./model-table.mjs', import.meta.url));
const TEMPLATE_HTML = fileURLToPath(new URL('../assets/model-survey.html', import.meta.url));
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
  // a row equal to the `*` 기본 row is the owner's own default, even outside the list
  const pinned = T.replace('| `*` | 기본 | claude | opus | medium | |', '| `*` | 기본 | claude | claude-opus-4-7 | medium | |');
  assert.ok(addRows(pinned, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'claude-opus-4-7', effort: 'medium', note: '' }]).includes('| `developer` | 구현 | claude | claude-opus-4-7 | medium | |'));
  assert.throws(() => addRows(pinned, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'claude-sonnet-4-5', effort: 'medium', note: '' }]), /claude-sonnet-4-5/);
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

test('buildPage puts the data in the one placeholder', () => {
  const html = buildPage('<script>const DATA = /*__DATA__*/null;</script>', { rows: [], models: MODELS, efforts: EFFORTS, codex: false });
  assert.ok(html.includes('const DATA = {"rows":[]'));
});

test('a </script> in the data does not break the page', () => {
  assert.ok(!buildPage('<script>const DATA = /*__DATA__*/null;</script>', { rows: [{ note: '</script>' }], models: [], efforts: [], codex: false }).includes('"</script>"'));
  const html = buildPage('<script>const DATA = /*__DATA__*/null;</script>', { rows: [{ note: '<!--<script>' }], models: [], efforts: [], codex: false });
  assert.ok(!html.includes('<!--') && !html.includes('<script>"') && html.includes('\\u003c!--\\u003cscript>'));
});

test('a template without the placeholder is an error', () => {
  assert.throws(() => buildPage('<html></html>', {}), /__DATA__/);
  assert.throws(() => buildPage('/*__DATA__*/null /*__DATA__*/null', {}), /__DATA__/);
});

test('CLI page: new rows start at the recommendation, existing rows at the table value', () => {
  const table = join(root, 'page.md');
  const rec = join(root, 'recommend.json');
  const out = join(root, 'page.html');
  writeFileSync(table, addRows(T, [{ agent: 'developer', unit: '구현', runtime: 'claude', model: 'opus', effort: 'medium', note: '' }]), 'utf8');
  writeFileSync(rec, JSON.stringify([
    { agent: 'developer', unit: '구현', isNew: true, model: 'sonnet', effort: 'high', reason: 'r' },
    { agent: 'planner', unit: '설계, 계획', isNew: false, model: 'fable', effort: 'max', reason: 'r' },
  ]), 'utf8');
  const r = cli('page', '--table', table, '--recommend', rec, '--out', out, '--codex');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(readFileSync(out, 'utf8').match(/const DATA = (.*);/)[1]);
  const dev = data.rows.find((x) => x.agent === 'developer');
  const planner = data.rows.find((x) => x.agent === 'planner');
  assert.equal(dev.model, 'sonnet');
  assert.equal(dev.isNew, true);
  assert.equal(planner.model, 'opus');
  assert.equal(planner.recommend.model, 'fable');
  assert.equal(data.rows.find((x) => x.agent === 'qa-inspector').recommend, null);
  assert.deepEqual([data.models, data.efforts, data.codex], [MODELS, EFFORTS, true]);
  // a recommendation for a row the table does not have is an error
  writeFileSync(rec, JSON.stringify([{ agent: 'ghost', unit: '구현', isNew: true, model: 'opus', effort: 'high', reason: 'r' }]), 'utf8');
  const g = cli('page', '--table', table, '--recommend', rec, '--out', out);
  assert.equal(g.status, 1);
  assert.match(g.stderr, /ghost/);
});

test('the shipped template has the placeholder exactly once', () => {
  assert.equal(readFileSync(TEMPLATE_HTML, 'utf8').split('/*__DATA__*/null').length, 2);
});

console.log(`model-table.check: ${n} cases passed`);

test('codex models come from the Codex picker cache, hidden ones left out, none when there is no cache', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'cm-')), 'c.json');
  writeFileSync(f, JSON.stringify({ models: [{ slug: 'a', visibility: 'list' }, { slug: 'b', visibility: 'hide' }] }), 'utf8');
  assert.deepEqual(codexModels(f), ['a']);
  assert.deepEqual(codexModels(f + 'x'), []);
});
