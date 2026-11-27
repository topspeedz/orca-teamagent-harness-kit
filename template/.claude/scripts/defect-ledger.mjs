#!/usr/bin/env node
// Keep the `## 결함 원장` section of a phase ledger from verification reports, so the coordinator does not type severities or round counts by hand.
// Usage: node .claude/scripts/defect-ledger.mjs add --ledger <ledger.md> --map <orca-tasks.json> --report <리포트.md> --source <Task ID>
// stdout: {"added":["H-1"],"round":1,"open":{"High":1,"Medium":0,"Low":0},"existing":[{"id":"M-1","source":"T05"}]}. Errors: exit 1 and {"error":"<사유>"}.
// existing: report IDs already in the ledger, with their original source. Replays preserve the recorded round and state.
// The evidence cell also carries the qualified impact so fix dispatch can check older ledgers without a schema migration.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEAD = '| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |';
const SEP = '| --- | --- | --- | --- | --- | --- |';
const SEVERITIES = ['High', 'Medium', 'Low'];
const missingDetail = /^(?:[-—]|없음|미확인|해당 없음|영향 미확인|<.*>)$/;
function hasImpact(value) {
  const detail = /^(?:핵심 흐름 차단|중대한 피해|출시 차단 기준)\s*[:：]\s*(\S.*)$/u.exec(value)?.[1];
  return !!detail && !missingDetail.test(detail);
}

// `**High**`, ` high ` -> High; anything else -> undefined (callers throw: a dropped row would hide a blocker)
const normSeverity = (cell = '') => SEVERITIES.find((v) => v.toLowerCase() === cell.replace(/^[\s*`]+|[\s*`]+$/g, '').toLowerCase());
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
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
  if (h < 0) {
    if (body.some(isRow)) throw new Error('결함 표의 머리글을 확인하세요: ID | 심각도 | 증거 | 위치');
    return [];
  }
  const impactColumn = cells(body[h]).indexOf('영향 근거');
  const out = [];
  for (const l of body.slice(h + 2)) {
    if (!isRow(l)) break;
    const row = cells(l);
    const [id, sev, ev = '', where = ''] = row;
    if (!id) continue;
    if (out.some((d) => d.id === id)) throw new Error(`리포트에 같은 결함 ID가 두 번 나옴: ${id}`);
    const severity = normSeverity(sev);
    if (!severity) throw new Error(`심각도를 읽을 수 없음: ${id} "${sev ?? ''}"`);
    const proof = /^(관찰|인용)[\s:`：*]+([^\s:`：*].*)$/u.exec(ev.replace(/^[\s*`]+/, ''));
    const evidence = proof?.[1] ?? '없음';
    const impact = row[impactColumn] ?? '';
    if (severity === 'High' && (!proof || missingDetail.test(proof[2].trim()) || !hasImpact(impact))) {
      throw new Error(`${id}: High에는 관찰·인용의 근거와 구체적인 영향 근거가 필요합니다. 영향 미확인은 원래 실패와 함께 남은 것에 기록하세요.`);
    }
    out.push({ id, severity, evidence, where, impact });
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
      const [id, source, severity, proof, round, state] = cells(l);
      if (id === 'ID' || /^[-: ]+$/.test(id)) continue; // header and separator rows
      const sev = normSeverity(severity);
      if (!sev) throw new Error(`원장의 심각도를 읽을 수 없음: ${id} "${severity ?? ''}"`);
      const [evidence, ...impact] = (proof ?? '').split(' — ');
      defects.push({ id, source, severity: sev, evidence, impact: impact.join(' — '), round: Number(round), state });
    }
  }
  const dec = section(lines, '결정');
  const decisions = dec ? lines.slice(dec.start, dec.end).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()) : [];
  return { defects, decisions };
}

export function addDefects(ledgerText, { source, round, defects }) {
  const eol = ledgerText.includes('\r\n') ? '\r\n' : '\n';
  const lines = ledgerText.split(/\r?\n/);
  const led = section(lines, '결함 원장');
  const known = new Map(readLedger(ledgerText).defects.map((d) => [d.id, d]));
  const rows = [];
  for (const d of defects) {
    const proof = d.impact ? `${d.evidence} — ${d.impact}` : d.evidence;
    const old = known.get(d.id);
    if (old) {
      // Qualify a legacy open High from its own amended report, preserving round and disposition.
      if (old.source === source && old.state === '열림' && old.severity === 'High' && !old.impact && d.severity === 'High' && hasImpact(d.impact)) {
        const index = lines.findIndex((l, i) => i >= led.start && i < led.end && isRow(l) && cells(l)[0] === d.id);
        const row = cells(lines[index]);
        row[3] = proof;
        lines[index] = `| ${row.join(' | ')} |`;
      }
      continue;
    }
    known.set(d.id, d);
    rows.push(`| ${d.id} | ${source} | ${d.severity} | ${proof} | ${round} | 열림 |`);
  }
  if (!rows.length) return lines.join(eol);
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

// One `- <Task ID> | <tree>` line at the end of `## 스냅샷`, in the order the Tasks were settled.
export function addSnapshot(ledgerText, id, tree) {
  const eol = ledgerText.includes('\r\n') ? '\r\n' : '\n';
  const lines = ledgerText.split(/\r?\n/);
  const row = `- ${id} | ${tree}`;
  const sec = section(lines, '스냅샷');
  if (!sec) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return [...lines, '', '## 스냅샷', '', row, ''].join(eol);
  }
  let last = sec.start;
  for (let i = sec.start; i < sec.end; i++) if (lines[i].trim()) last = i + 1;
  lines.splice(last, 0, row);
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
      return c[0] === id && c[1] === '수정 포함 승인' && c[2];
    });
    if (approved) continue;
    if (d.severity === 'High' && d.state === '열림') {
      if (['관찰', '인용'].includes(d.evidence) && hasImpact(d.impact)) continue;
      refused.push({ id, reason: '원 리포트의 증거·영향 근거 보완 필요' });
      continue;
    }
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
    const before = new Map(readLedger(text).defects.map((d) => [d.id, d.source]));
    const next = addDefects(text, { source, round, defects });
    if (next !== text) writeFileSync(ledgerP, next, 'utf8');
    const open = { High: 0, Medium: 0, Low: 0 };
    for (const d of readLedger(next).defects) if (d.state === '열림') open[d.severity]++;
    const existing = defects.filter((d) => before.has(d.id)).map((d) => ({ id: d.id, source: before.get(d.id) }));
    console.log(JSON.stringify({ added: defects.map((d) => d.id).filter((id) => !before.has(id)), round, open, existing }));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
