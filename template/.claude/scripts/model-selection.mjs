// Model selection table: parse, check, lookup. `node .claude/scripts/model-selection.mjs check|lookup|list`
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE_PATH = 'docs/harness/model-selection.md';
export const NO_EFFORT_MODELS = ['haiku'];
const HEADER = ['에이전트', '작업 단위', '런타임', 'model', 'effort', '메모'];

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseTable(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows = [];
  const errors = [];
  const start = lines.findIndex((l) => l.trim().startsWith('|') && cellsOf(l).join('|') === HEADER.join('|'));
  if (start < 0) return { rows, errors: [`L0: 머리 줄 \`${HEADER.join(' | ')}\`인 표가 없음`] };
  // start + 1 is the `| --- |` separator
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = cellsOf(lines[i]);
    // cell count is checked here because Row cannot carry a malformed line
    if (c.length !== 6) { errors.push(`L${i + 1}: 칸 수 6이 아님`); continue; }
    rows.push({
      line: i + 1,
      agent: c[0].replace(/`/g, ''),
      units: c[1].split(',').map((u) => u.trim()).filter(Boolean),
      runtime: c[2],
      model: c[3],
      effort: c[4] === '' || c[4] === '-' ? null : c[4],
      note: c[5],
    });
  }
  return { rows, errors };
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

export function lookup(rows, agent, unit) {
  for (const [a, u, matched] of [[agent, unit, 'exact'], ['*', unit, 'unit-default'], ['*', '기본', 'default']]) {
    const r = rows.find((x) => x.agent === a && x.units.includes(u));
    if (r) return { ...r, matched };
  }
  return null;
}

const fmt = (r) => `${r.runtime} ${r.model}${r.effort ? `/${r.effort}` : ''}`;

function main(argv) {
  const [cmd, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
  const tablePath = arg('--table') ?? TABLE_PATH;
  if (!existsSync(tablePath)) { console.error(`model-selection: 표 없음 ${tablePath}`); return 1; }
  const { rows, errors } = parseTable(readFileSync(tablePath, 'utf8'));

  if (cmd === 'check') {
    const dir = join('.claude', 'agents');
    const agentNames = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md')) : [];
    const all = [...errors, ...checkTable(rows, { agentNames, noEffortModels: NO_EFFORT_MODELS })];
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
    console.log(rest.includes('--json') ? JSON.stringify(r) : `${fmt(r)} (${r.matched})`);
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
  console.error('사용법: model-selection.mjs check|lookup|list [--table <경로>]');
  return 1;
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
