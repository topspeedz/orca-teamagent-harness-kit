#!/usr/bin/env node
// Keep the `## 결함 원장` section of a phase ledger from verification reports, so the coordinator does not type severities or round counts by hand.
// Usage: node .claude/scripts/defect-ledger.mjs add --ledger <ledger.md> --map <orca-tasks.json> --report <리포트.md> --source <Task ID>
// stdout: {"added":["H-1"],"round":1,"open":{"High":1,"Medium":0,"Low":0}}. Errors: exit 1 and {"error":"<사유>"}.
// A High row whose evidence (first word of the cell: 관찰·인용·없음; anything else is 없음) is 없음 is recorded as Medium with demoted: true.
// An ID already in the ledger is never touched, so a hand-edited 상태 cell survives a second add.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEAD = '| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |';
const SEP = '| --- | --- | --- | --- | --- | --- |';
const SEVERITIES = ['High', 'Medium', 'Low'];

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isRow = (l) => l.trim().startsWith('|');
// lines of the section opened by `## <title>`, up to the next `## ` heading; start = index of the first body line
function section(lines, title) {
  const at = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (at < 0) return null;
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { at, start: at + 1, end };
}

export function parseDefects(reportText) {
  const lines = reportText.split(/\r?\n/);
  const sec = section(lines, '결함');
  if (!sec) return [];
  const body = lines.slice(sec.start, sec.end);
  const h = body.findIndex((l) => {
    if (!isRow(l)) return false;
    const c = cells(l);
    return c[0] === 'ID' && c[1] === '심각도' && c[2] === '증거' && c[3] === '위치';
  });
  if (h < 0) return [];
  const out = [];
  for (const l of body.slice(h + 2)) {
    if (!isRow(l)) break;
    const [id, sev, ev = '', where = ''] = cells(l);
    if (!id || !SEVERITIES.includes(sev)) continue;
    const word = ev.split(/\s+/)[0].replace(/`/g, '');
    const evidence = word === '관찰' || word === '인용' ? word : '없음';
    const d = { id, severity: sev, evidence, where };
    if (sev === 'High' && evidence === '없음') { d.severity = 'Medium'; d.demoted = true; }
    out.push(d);
  }
  return out;
}

export function readLedger(ledgerText) {
  const lines = ledgerText.split(/\r?\n/);
  const defects = [];
  const led = section(lines, '결함 원장');
  if (led) {
    for (const l of lines.slice(led.start, led.end)) {
      if (!isRow(l)) continue;
      const [id, source, severity, evidence, round, state] = cells(l);
      if (!SEVERITIES.includes(severity)) continue; // header and separator rows
      defects.push({ id, source, severity, evidence, round: Number(round), state });
    }
  }
  const dec = section(lines, '결정');
  const decisions = dec ? lines.slice(dec.start, dec.end).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()) : [];
  return { defects, decisions };
}

export function addDefects(ledgerText, { source, round, defects }) {
  const eol = ledgerText.includes('\r\n') ? '\r\n' : '\n';
  const lines = ledgerText.split(/\r?\n/);
  const known = new Set(readLedger(ledgerText).defects.map((d) => d.id));
  const rows = [];
  for (const d of defects) {
    if (known.has(d.id)) continue;
    known.add(d.id);
    rows.push(`| ${d.id} | ${source} | ${d.severity} | ${d.evidence} | ${round} | 열림 |`);
  }
  if (!rows.length) return ledgerText;
  const led = section(lines, '결함 원장');
  if (led) {
    let last = led.start;
    for (let i = led.start; i < led.end; i++) if (isRow(lines[i])) last = i + 1;
    lines.splice(last, 0, ...rows);
  } else {
    const dec = lines.findIndex((l) => l.trim() === '## 결정');
    const block = ['## 결함 원장', '', HEAD, SEP, ...rows, ''];
    if (dec >= 0) lines.splice(dec, 0, ...block);
    else {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push('', ...block);
    }
  }
  return lines.join(eol);
}

// fix rounds already launched (a fix Task with a dispatch) + 1
export function currentRound(map) {
  const rounds = new Set();
  for (const t of Object.values(map?.tasks ?? {})) if (t.kind === 'fix' && t.dispatch) rounds.add(t.round);
  return rounds.size + 1;
}

// a High still open goes in; anything else only with a `수정 포함 승인` decision line for its ID
export function fixAllowed(ledger, ids) {
  const refused = [];
  for (const id of ids) {
    const d = ledger.defects.find((x) => x.id === id);
    if (!d) { refused.push({ id, reason: '원장에 없음' }); continue; }
    const approved = ledger.decisions.some((l) => {
      const c = l.split('|').map((s) => s.trim());
      return c[0] === id && c[1] === '수정 포함 승인';
    });
    if (approved || (d.severity === 'High' && d.state === '열림')) continue;
    refused.push({ id, reason: d.severity !== 'High' ? `${d.severity}는 수정 포함 승인이 필요함` : `상태가 ${d.state}` });
  }
  return { ok: refused.length === 0, refused };
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const [ledgerP, mapP, reportP, source] = ['--ledger', '--map', '--report', '--source'].map(arg);
    if (args[0] !== 'add' || !ledgerP || !mapP || !reportP || !source) {
      throw new Error('usage: defect-ledger.mjs add --ledger <ledger.md> --map <orca-tasks.json> --report <리포트.md> --source <Task ID>');
    }
    const text = readFileSync(ledgerP, 'utf8');
    const round = currentRound(JSON.parse(readFileSync(mapP, 'utf8')));
    const defects = parseDefects(readFileSync(reportP, 'utf8'));
    const before = new Set(readLedger(text).defects.map((d) => d.id));
    const next = addDefects(text, { source, round, defects });
    if (next !== text) writeFileSync(ledgerP, next, 'utf8');
    const open = { High: 0, Medium: 0, Low: 0 };
    for (const d of readLedger(next).defects) if (d.state === '열림') open[d.severity]++;
    console.log(JSON.stringify({ added: defects.map((d) => d.id).filter((id) => !before.has(id)), round, open }));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
