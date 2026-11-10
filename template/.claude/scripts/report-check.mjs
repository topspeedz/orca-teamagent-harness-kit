#!/usr/bin/env node
// Settle a worker report's verification lines — the coordinator judges the report instead of re-running the worker's checks.
// Usage: node .claude/scripts/report-check.mjs <report-path>
// stdout: one JSON line {ok, checked, failed:[…], notes:[…], error?}. exit 0 = ok, 1 = not ok (treat the worker_done as failed).
// A ✅/❌ line counts unless it starts with `(참고)` (outside the acceptance criteria) — those ❌ go to notes ("남은 것").
// `❌ (참고)`·`❌(참고, …)` count as `(참고)` too: workers write the mark first.
// ok = at least one counted ✅ and no counted ❌. Fenced code blocks are skipped (quoted templates like "✅/❌").
// Scope: only lines under a heading that starts with "검증" (after numbering), up to the next heading of the same or higher level — QA/review
// reports mark found defects with ❌ in defect/acceptance tables, a finding rather than a worker failure.
// A report with no such heading fails ("검증 절 없음").
// Re-checks are the next version file (NN_<agent>_<output>_v<N>.md), so an older version fails when a higher one sits next to it,
// and a `재검 회차: N` line with N ≥ 3 fails the cap of two re-checks.
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function check(text) {
  const out = { ok: false, checked: 0, failed: [], notes: [] };
  const lines = [];
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (!fenced) lines.push(raw);
  }
  const heading = (l) => /^(#{1,6})\s+(.*)$/.exec(l);
  // "## 검증", "## 5. 검증 (완료 기준)", "## §D 검증", team-lead "## 팀 전체 검증" — not "### 교차 검증 범위"
  const isVerify = (t) => /^(?:§?[A-Z\d]{1,3}[.)]?\s+)?(?:팀 전체 |재검 (?:\S+ ){0,3})?검증/.test(t);
  if (!lines.some((l) => { const h = heading(l); return h && isVerify(h[2]); })) return { ...out, error: '검증 절 없음' };
  let level = 0; // >0 while inside a verification section opened by a heading of that level
  for (const raw of lines) {
    const h = heading(raw);
    if (h) {
      if (level && h[1].length <= level) level = 0;
      if (!level && isVerify(h[2])) level = h[1].length;
      continue;
    }
    if (!level || !/[✅❌]/.test(raw)) continue;
    const line = raw.trim();
    // list bullet, numbering, quote or table pipe before the `(참고)` marker
    if (/^(?:[-*+>|]\s*|\d+[.)]\s*)*(?:[✅❌]\s*)?\(참고[),]/.test(line)) { if (line.includes('❌')) out.notes.push(line); continue; }
    out.checked++;
    if (line.includes('❌')) out.failed.push(line);
  }
  const round = lines.map((l) => /재검 회차:\s*(\d+)/.exec(l)?.[1]).find(Boolean);
  if (Number(round) >= 3) out.failed.unshift('❌ 재검 상한 2회 초과');
  out.ok = out.failed.length === 0 && out.checked > out.failed.length;
  return out;
}

// The highest sibling version above this file's, or undefined.
export function newerVersion(path) {
  const m = /^(.*)_v(\d+)\.md$/.exec(basename(path));
  if (!m) return undefined;
  let best;
  for (const name of readdirSync(dirname(path))) {
    const v = name.startsWith(`${m[1]}_v`) && /^(\d+)\.md$/.exec(name.slice(m[1].length + 2))?.[1];
    if (v && Number(v) > Number(m[2]) && (!best || Number(v) > best.v)) best = { v: Number(v), name };
  }
  return best?.name;
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const path = process.argv[2];
  let out;
  try {
    out = check(readFileSync(path, 'utf8'));
    const newer = newerVersion(path);
    if (newer) out = { ...out, ok: false, error: `더 높은 버전이 있음: ${newer}` };
  } catch (e) { out = { ok: false, checked: 0, failed: [], notes: [], error: path ? e.message : 'usage: report-check.mjs <report-path>' }; }
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}
