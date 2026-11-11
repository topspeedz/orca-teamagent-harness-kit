#!/usr/bin/env node
// Model selection table for setup: list its rows, add rows for new agents, apply the user's survey choices.
// Usage: node model-table.mjs rows --table <path>
//        node model-table.mjs add --table <path> --rows <json file>        exit 1 and the table untouched on an error
//        node model-table.mjs apply --table <path> --choices <json file>  exit 1 and the table untouched on an error
//        node model-table.mjs page --table <path> --recommend <json file> --out <html path> [--codex]   the survey page
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { parseTable, NO_EFFORT_MODELS } = await import(new URL('../../../template/.claude/scripts/model-selection.mjs', import.meta.url));

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const RUNTIMES = ['claude', 'codex'];

const norm = (s) => s.trim().replace(/\s+/g, ' ');
const cell = (v) => (v ? ` ${v} ` : ' ');
const runtimeError = (runtime) => (RUNTIMES.includes(runtime) ? null : `런타임 \`${runtime}\`은 ${RUNTIMES.join(', ')} 중 하나가 아님`);
const modelError = (model, runtime) => {
  if (runtime === 'codex') return model ? null : 'model이 빔';
  return MODELS.includes(model) ? null : `model \`${model}\`은 ${MODELS.join(', ')} 중 하나가 아님`;
};
const effortError = (effort, runtime) =>
  runtime === 'codex' || !effort || EFFORTS.includes(effort) ? null : `effort \`${effort}\`은 ${EFFORTS.join(', ')} 중 하나가 아님`;
const haikuError = (model, effort, runtime) =>
  runtime === 'claude' && effort && NO_EFFORT_MODELS.includes(model) ? `${model}은 effort를 받지 않음(\`${effort}\`)` : null;

export function validate(choice, runtime) {
  const effort = choice.effort ?? '';
  return runtimeError(runtime) ?? modelError(choice.model, runtime) ?? effortError(effort, runtime) ?? haikuError(choice.model, effort, runtime);
}

// Lines split on '\n' only, so a CRLF table keeps its '\r' and a BOM stays on line 1; parseTable's line numbers index into them.
function open(text) {
  const { rows, errors } = parseTable(text);
  if (errors.length) throw new Error(errors.join('\n'));
  const lines = text.split('\n');
  return { lines, rows: rows.map((r) => ({ ...r, cells: lines[r.line - 1].split('|') })) };
}

export function addRows(tableText, rows) {
  const { lines, rows: have } = open(tableText);
  const star = have.find((r) => r.agent === '*');
  if (!star) throw new Error('표에 `*` 줄이 없음');
  const base = have.find((r) => r.agent === '*' && r.units.includes('기본'));
  const taken = new Set(have.flatMap((r) => r.units.map((u) => `${r.agent}\u0000${u}`)));
  const cr = tableText.includes('\r\n') ? '\r' : '';
  const add = [];
  for (const r of rows) {
    const name = `${r.agent} (${r.unit})`;
    if (!r.agent || !r.unit) throw new Error(`${name}: agent와 unit은 비울 수 없음`);
    // a '|' or a line break in any cell would break the table
    if ([r.agent, r.unit, r.runtime, r.model, r.effort, r.note].some((v) => /[|\r\n]/.test(v ?? ''))) throw new Error(`${name}: 칸 값에 \`|\`나 줄바꿈이 있음`);
    // a row equal to the `*` 기본 row carries the owner's own default (a pinned model ID, say), so the lists do not apply
    const isDefault = r.runtime === base.runtime && r.model === base.model && (r.effort ?? '') === (base.effort ?? '');
    const err = isDefault ? null : validate(r, r.runtime);
    if (err) throw new Error(`${name}: ${err}`);
    for (const u of r.unit.split(',').map((x) => x.trim()).filter(Boolean)) {
      const key = `${r.agent}\u0000${u}`;
      if (taken.has(key)) throw new Error(`${name}: (${r.agent}, ${u}) 줄이 이미 있음`);
      taken.add(key);
    }
    add.push(`|${[`\`${r.agent}\``, r.unit, r.runtime, r.model, r.effort ?? '', r.note ?? ''].map(cell).join('|')}|${cr}`);
  }
  lines.splice(star.line - 1, 0, ...add);
  return lines.join('\n');
}

export function applyChoices(tableText, choices) {
  const { lines, rows } = open(tableText);
  for (const c of choices) {
    const name = `${c.agent} (${c.unit})`;
    const row = rows.find((r) => r.agent === c.agent && norm(r.cells[2]) === norm(c.unit));
    if (!row) throw new Error(`${name}: 표에 줄이 없음`);
    const cells = lines[row.line - 1].split('|');
    const cur = { runtime: norm(cells[3]), model: norm(cells[4]), effort: norm(cells[5]) === '-' ? '' : norm(cells[5]) };
    // a key the choice leaves out keeps the current value
    const next = { runtime: c.runtime ?? cur.runtime, model: c.model ?? cur.model, effort: c.effort ?? cur.effort };
    const changed = (k) => next[k] !== cur[k];
    // only changed cells are checked: an old or pinned value the user keeps stays as it is
    const err = (c.runtime !== undefined ? runtimeError(c.runtime) : null)
      ?? (changed('model') || changed('runtime') ? modelError(next.model, next.runtime) : null)
      ?? (changed('effort') ? effortError(next.effort, next.runtime) : null)
      ?? (['runtime', 'model', 'effort'].some(changed) ? haikuError(next.model, next.effort, next.runtime) : null);
    if (err) throw new Error(`${name}: ${err}`);
    [['runtime', 3], ['model', 4], ['effort', 5]].forEach(([k, i]) => { if (changed(k)) cells[i] = cell(next[k]); });
    lines[row.line - 1] = cells.join('|');
  }
  return lines.join('\n');
}

const PLACEHOLDER = '/*__DATA__*/null';
const TEMPLATE = new URL('../assets/model-survey.html', import.meta.url);

export function buildPage(templateHtml, data) {
  if (templateHtml.split(PLACEHOLDER).length !== 2) throw new Error(`틀에 ${PLACEHOLDER} 자리표가 정확히 한 번 있어야 함`);
  // every '<' as \u003c, so no </script> or <!-- in the data can end or confuse the script; a function replacement, so '$' in the data is not read as a pattern
  return templateHtml.replace(PLACEHOLDER, () => JSON.stringify(data).replaceAll('<', '\\u003c'));
}

const listRows = (text) => open(text).rows.map((r) => ({ agent: r.agent, unit: norm(r.cells[2]), runtime: r.runtime, model: r.model, effort: r.effort ?? '', note: r.note }));

// new rows start at the recommendation; existing rows keep the table's value and show the recommendation beside it
function pageData(tableText, recommend, codex) {
  const rows = listRows(tableText);
  for (const r of recommend) {
    if (!rows.some((x) => x.agent === r.agent && x.unit === norm(r.unit))) throw new Error(`${r.agent} (${r.unit}): 표에 줄이 없음`);
  }
  return {
    rows: rows.map((x) => {
      const r = recommend.find((y) => y.agent === x.agent && norm(y.unit) === x.unit);
      const rec = r ? { model: r.model, effort: r.effort ?? '', reason: r.reason ?? '' } : null;
      return { ...x, ...(r?.isNew ? { model: rec.model, effort: rec.effort } : {}), isNew: Boolean(r?.isNew), recommend: rec };
    }),
    models: MODELS,
    efforts: EFFORTS,
    codex,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  const table = opt('--table');
  const readJson = (k) => JSON.parse(readFileSync(opt(k), 'utf8'));
  try {
    if (cmd === 'rows' && table) {
      console.log(JSON.stringify(listRows(readFileSync(table, 'utf8')), null, 2));
      return 0;
    }
    if (cmd === 'page' && table && opt('--out')) {
      const data = pageData(readFileSync(table, 'utf8'), readJson('--recommend'), rest.includes('--codex'));
      writeFileSync(opt('--out'), buildPage(readFileSync(TEMPLATE, 'utf8'), data), 'utf8');
      return 0;
    }
    if ((cmd === 'add' || cmd === 'apply') && table) {
      const text = readFileSync(table, 'utf8');
      // the whole new text is built first; the file is written only when nothing failed
      writeFileSync(table, cmd === 'add' ? addRows(text, readJson('--rows')) : applyChoices(text, readJson('--choices')), 'utf8');
      return 0;
    }
  } catch (e) {
    console.error(`model-table: ${e.message}`);
    return 1;
  }
  console.error('usage: model-table.mjs rows|add|apply|page --table <path> [--rows <json>] [--choices <json>] [--recommend <json> --out <html> [--codex]]');
  return 1;
}

// realpath on both sides: a junction or symlink in the plugin path must not stop the CLI from running
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
