// Model selection table: parse, check, lookup. `node .claude/scripts/model-selection.mjs check|lookup|list|choices`
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE_PATH = 'docs/harness/model-selection.md';
export const NO_EFFORT_MODELS = ['haiku'];
// Same lists as MODELS/EFFORTS in model-table.mjs (that file imports this one, so it cannot be imported back).
const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// A row whose model cell is this word has no default model: the Task's scores pick model and effort (model-routing.mjs).
export const BY_FORMULA = '산정';
// A row the user fixed (메모 `고정`) launches with its own values; every other row needs the Task's scores.
export const isFixed = (row) => row.note.startsWith('고정');
const HEADER = ['에이전트', '작업 단위', '런타임', 'model', 'effort', '메모'];
// Before 0.6.1 formula rows said `복잡도` and a complexity table sat beside them; check names both so a project moves off them.
const OLD_FORMULA = '복잡도';
const OLD_COMPLEXITY_HEADER = ['복잡도', 'model', 'effort'];
const CODEX_HEADER = ['Claude', 'Codex', '메모'];

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const pair = (model, effort) => (effort ? `${model}/${effort}` : model);
const split = (text) => { const [model, effort] = text.split('/'); return { model, effort: effort || null }; };
const claudePairs = () => CLAUDE_MODELS.flatMap((m) => (NO_EFFORT_MODELS.includes(m) ? [m] : EFFORTS.map((e) => pair(m, e))));

// Lines of the table whose header is `header`, after its `| --- |` separator; null when absent.
function block(lines, header) {
  const start = lines.findIndex((l) => l.trim().startsWith('|') && cellsOf(l).join('|') === header.join('|'));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) out.push({ line: i + 1, c: cellsOf(lines[i]) });
  return out;
}

export function parseTable(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows = [];
  const errors = [];
  const legacyTable = lines.findIndex((l) => l.trim().startsWith('|') && cellsOf(l).join('|') === OLD_COMPLEXITY_HEADER.join('|')) + 1;
  const codex = (block(lines, CODEX_HEADER) ?? []).map(({ line, c }) => ({ line, from: c[0], to: c[1] }));
  const main = block(lines, HEADER);
  if (!main) return { rows, errors: [`L0: 머리 줄 \`${HEADER.join(' | ')}\`인 표가 없음`], codex, legacyTable };
  for (const { line, c } of main) {
    // cell count is checked here because Row cannot carry a malformed line
    if (c.length !== 6) { errors.push(`L${line}: 칸 수 6이 아님`); continue; }
    rows.push({
      line,
      agent: c[0].replace(/`/g, ''),
      units: c[1].split(',').map((u) => u.trim()).filter(Boolean),
      runtime: c[2],
      model: c[3],
      effort: c[4] === '' || c[4] === '-' ? null : c[4],
      note: c[5],
    });
  }
  return { rows, errors, codex, legacyTable };
}

export function checkTable(rows, { agentNames, noEffortModels }) {
  const errors = [];
  const seen = new Map();
  for (const r of rows) {
    if (r.runtime !== 'claude' && r.runtime !== 'codex') errors.push(`L${r.line}: 런타임 \`${r.runtime}\`은 claude나 codex가 아님`);
    if (!r.model) errors.push(`L${r.line}: model이 빔`);
    if (r.agent !== '*' && r.agent !== 'coordinator' && !agentNames.includes(r.agent)) errors.push(`L${r.line}: 에이전트 \`${r.agent}\`가 .claude/agents에 없음`);
    if (r.effort !== null && noEffortModels.includes(r.model)) errors.push(`L${r.line}: ${r.model}은 effort를 받지 않음(\`${r.effort}\`)`);
    for (const u of r.units) {
      const key = `${r.agent}\u0000${u}`;
      if (seen.has(key)) errors.push(`L${r.line}: (${r.agent}, ${u}) 중복 — L${seen.get(key)}, L${r.line}`);
      else seen.set(key, r.line);
    }
  }
  if (!rows.some((r) => r.agent === '*' && r.units.includes('기본'))) errors.push('L0: (`*`, 기본) 줄이 없음');
  return errors;
}

// Formula rows and the Codex table: a formula row on codex takes its pair from the Codex table, so it must cover every Claude pair.
export function checkRules(rows, { codex, legacyTable = 0 }) {
  const errors = [];
  for (const r of rows.filter((x) => x.model === OLD_FORMULA)) errors.push(`L${r.line}: model \`${OLD_FORMULA}\`는 0.6.1에서 \`${BY_FORMULA}\`으로 바뀌었다`);
  if (legacyTable) errors.push(`L${legacyTable}: 복잡도 기본표는 0.6.1에서 없어졌다 — 산정 행은 Task 점수로 정하므로 표를 지운다`);
  for (const r of rows.filter((x) => x.model === BY_FORMULA && x.effort !== null)) errors.push(`L${r.line}: ${BY_FORMULA} 줄은 effort를 비움`);
  if (!codex.length && !rows.some((r) => r.model === BY_FORMULA)) return errors;
  const from = new Map();
  for (const x of codex) {
    if (from.has(x.from)) errors.push(`L${x.line}: \`${x.from}\` 중복 — L${from.get(x.from)}`);
    from.set(x.from, x.line);
    if (!claudePairs().includes(x.from) || !/^[^/\s|]+\/[^/\s|]+$/.test(x.to ?? '')) errors.push(`L${x.line}: 치환 줄 \`${x.from}\` → \`${x.to}\` 확인 필요`);
  }
  const missing = claudePairs().filter((p) => !from.has(p));
  if (missing.length) errors.push(`L0: Codex 치환표에 빠진 Claude 조합 ${missing.join(', ')}`);
  return errors;
}

// Claude model/effort to the Codex one, from the Codex table only.
export function toCodex(model, effort, codex) {
  const row = codex.find((x) => x.from === pair(model, effort));
  if (!row) throw new Error(`Codex 치환표에 \`${pair(model, effort)}\` 줄이 없음`);
  return split(row.to);
}

// The dag-swimlane `choices` input: every Claude model with its efforts ([] = no effort), and the Codex table as a map.
export function choices(codex) {
  const claude = {};
  for (const m of CLAUDE_MODELS) claude[m] = NO_EFFORT_MODELS.includes(m) ? [] : [...EFFORTS];
  const mappings = codex.length ? claudePairs().map((p) => {
    const c = toCodex(...Object.values(split(p)), codex);
    return [p, pair(c.model, c.effort)];
  }) : [];
  return { claude, codex: Object.fromEntries(mappings) };
}

export function matchRow(rows, agent, unit) {
  for (const [a, u, matched] of [[agent, unit, 'exact'], ['*', unit, 'unit-default'], ['*', '기본', 'default']]) {
    const r = rows.find((x) => x.agent === a && x.units.includes(u));
    if (r) return { row: r, matched };
  }
  return null;
}

// The row as written. Only a fixed row's values are a launch pair; any other row launches with the Task's scores.
export function lookup(rows, agent, unit) {
  const match = matchRow(rows, agent, unit);
  return match ? { ...match.row, matched: match.matched } : null;
}

const fmt = (r) => `${r.runtime} ${r.model}${r.effort ? `/${r.effort}` : ''}`;

function main(argv) {
  const [cmd, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
  const tablePath = arg('--table') ?? TABLE_PATH;
  if (!existsSync(tablePath)) { console.error(`model-selection: 표 없음 ${tablePath}`); return 1; }
  const parsed = parseTable(readFileSync(tablePath, 'utf8'));
  const { rows, errors } = parsed;

  if (cmd === 'check') {
    const dir = join('.claude', 'agents');
    const agentNames = existsSync(dir) ? readdirSync(dir).filter((f) => /\.md(?:\.agent-toggle-off)?$/.test(f)).map((f) => f.replace(/\.md(?:\.agent-toggle-off)?$/, '')) : [];
    const all = [...errors, ...checkTable(rows, { agentNames, noEffortModels: NO_EFFORT_MODELS }), ...checkRules(rows, parsed)];
    if (all.length) { for (const e of all) console.log(e); return 1; }
    console.log(`model-selection: OK ${rows.length} rows`);
    return 0;
  }
  if (cmd === 'lookup') {
    const agent = arg('--agent');
    const unit = arg('--unit');
    if (!agent || !unit) { console.error('사용법: lookup --agent <a> --unit <u> [--json]'); return 1; }
    const r = lookup(rows, agent, unit);
    if (!r) { console.error(`model-selection: (${agent}, ${unit})에 맞는 줄이 없음`); return 1; }
    const fixed = isFixed(r);
    console.log(rest.includes('--json') ? JSON.stringify({ ...r, fixed })
      : `${fmt(r)} (${r.matched})${fixed ? '' : ' — 고정 행이 아니라 Task 점수로 정한다(model-routing.mjs plan)'}`);
    return 0;
  }
  if (cmd === 'list') {
    const agent = arg('--agent');
    for (const r of rows) {
      if (agent && r.agent !== agent && r.agent !== '*') continue;
      console.log(`L${r.line} ${r.agent} | ${r.units.join(', ')} | ${fmt(r)}${r.note ? ` | ${r.note}` : ''}`);
    }
    return 0;
  }
  if (cmd === 'choices' || cmd === 'codex') {
    try {
      if (cmd === 'choices') console.log(JSON.stringify(choices(parsed.codex)));
      else { const c = toCodex(...Object.values(split(arg('--pair') ?? '')), parsed.codex); console.log(`codex ${pair(c.model, c.effort)}`); }
    } catch (e) { console.error(`model-selection: ${e.message}`); return 1; }
    return 0;
  }
  console.error('사용법: model-selection.mjs check|lookup|list|choices|codex --pair <model/effort> [--table <경로>]');
  return 1;
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
