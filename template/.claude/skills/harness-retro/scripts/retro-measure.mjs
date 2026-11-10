// harness-retro measurements for one phase (read-only). Prints a markdown table for the retro report.
// Usage (project root): node .claude/skills/harness-retro/scripts/retro-measure.mjs
//   --waterfall <waterfall.json> --actual <actual.json> --ledger <ledger.md> --workspace <_workspace>
//   [--sessions <dir with .jsonl>] [--days 7]
// Any input left out or unreadable prints 측정 불가 for its rows — never a silent 0.
// Coordinator-wake counting is ported from harness-design measure-token-usage.mjs (notice detection only).
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const round2 = (x) => Math.round(x * 100) / 100;

// rows: [{id,start,end}] in minutes; deps: {id: [ids]}. Critical path = longest dependency chain of durations.
export function parallel(rows, deps) {
  const dur = new Map(rows.map((r) => [r.id, r.end - r.start]));
  const memo = new Map();
  const chain = (id) => {
    if (memo.has(id)) return memo.get(id);
    const before = (deps[id] || []).filter((d) => dur.has(d)).map(chain);
    const v = dur.get(id) + Math.max(0, ...before);
    memo.set(id, v);
    return v;
  };
  const sum = rows.reduce((a, r) => a + r.end - r.start, 0);
  const critical = Math.max(0, ...rows.map((r) => chain(r.id)));
  // Ends sort before starts at the same instant, so touching intervals are not concurrent.
  const ev = rows.flatMap((r) => [[r.start, 1], [r.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, maxConcurrent = 0;
  for (const [, d] of ev) maxConcurrent = Math.max(maxConcurrent, (cur += d));
  const elapsed = rows.length ? Math.max(...rows.map((r) => r.end)) - Math.min(...rows.map((r) => r.start)) : 0;
  return { tasks: rows.length, sum, critical, ratio: critical ? round2(sum / critical) : 0, maxConcurrent, elapsed };
}

const depsOf = (wf) => Object.fromEntries(wf.tasks.map((t) => [t.id, t.deps || []]));

// Planned values: the likely schedule of waterfall.json. Approval rows have no duration and are skipped.
export function planned(wf) {
  const rows = wf.tasks.filter((t) => t.kind !== 'approval').map((t) => ({ id: t.id, ...t.schedule.likely }));
  return { ...parallel(rows, depsOf(wf)), slots: wf.maxWorkers };
}

// Actual values: [{id,start,end}] ISO times written by the coordinator; deps come from waterfall.json.
export function actual(list, wf) {
  const deps = depsOf(wf);
  const ms = list.map((r) => {
    const s = Date.parse(r.start), e = Date.parse(r.end);
    if (!(r.id in deps)) throw new Error(`actual: ${r.id} is not a task in waterfall.json`);
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) throw new Error(`actual: ${r.id} has an invalid start/end`);
    return { id: r.id, s, e };
  });
  const t0 = Math.min(...ms.map((r) => r.s));
  return parallel(ms.map((r) => ({ id: r.id, start: (r.s - t0) / 60000, end: (r.e - t0) / 60000 })), deps);
}

// ledger.md: budget line `수정 루프 <N>회` (the `최대 <N>회` cap is not a count) and the one table.
export function ledger(text) {
  const loop = text.match(/수정 루프 (\d+)회/);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => /^\|\s*Task\s*\|/.test(l));
  const rows = [];
  if (head >= 0) for (const l of lines.slice(head + 2)) { if (!l.trim().startsWith('|')) break; rows.push(cells(l)); }
  const causes = [];
  let retries = 0;
  for (const r of rows) {
    const m = (r[4] || '').match(/^(\d+)\s*(?:\((.*)\))?/);
    const count = m ? Number(m[1]) : 0;
    retries += count;
    if (count) causes.push({ task: r[0], count, cause: m[2] || '(원인 없음)' });
  }
  return {
    fixLoops: loop ? Number(loop[1]) : null,
    tasks: rows.length, retries,
    failed: rows.filter((r) => r[3] === '실패').length,
    questions: rows.filter((r) => r[5] && r[5] !== '없음' && r[5] !== '0').length,
    causes,
  };
}

const NOTICE = /^\s*You have \d+ orchestration message/;
const ORCA_CMD = /(^|[\s;&|("'\\/])orca(-dev|-ide)?(\.exe)?["']?\s/i;

// One session .jsonl: turns woken by Orca's typed notice, and those that ended with no tool call.
// toolless only approximates "the batch held only heartbeats" — the session log does not record batch contents.
export function wakes(text) {
  let n = 0, toolless = 0, orca = 0, pending = null;
  const close = () => { if (pending && !pending.tools) toolless++; pending = null; };
  for (const ln of text.split('\n')) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.isSidechain) continue;
    const c = o.message?.content;
    if (o.type === 'user') {
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('') : '';
      if (!txt) continue; // tool results do not end a wake turn
      close();
      if (NOTICE.test(txt)) { n++; pending = { tools: false }; }
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type !== 'tool_use') continue;
        if (pending) pending.tools = true;
        if ((b.name === 'Bash' || b.name === 'PowerShell') && ORCA_CMD.test(String(b.input?.command || ''))) orca++;
      }
    }
  }
  close();
  return { wakes: n, toolless, orca };
}

export function folderSize(dir) {
  let bytes = 0, files = 0;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    bytes += statSync(join(e.parentPath ?? e.path, e.name)).size; files++;
  }
  return { bytes, files };
}

function sessionFiles(dir, days) {
  const since = Date.now() - days * 86400e3;
  // Claude Code names the project folder after cwd with non-alphanumerics replaced by '-'; prefix match keeps nested worktrees.
  const roots = dir ? [dir] : (() => {
    const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
    const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return existsSync(base) ? readdirSync(base).filter((d) => d.toLowerCase().startsWith(slug)).map((d) => join(base, d)) : [];
  })();
  return roots.filter((r) => existsSync(r)).flatMap((r) => readdirSync(r, { recursive: true })
    .filter((f) => f.endsWith('.jsonl')).map((f) => join(r, f)))
    .filter((f) => statSync(f).mtimeMs >= since);
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const NA = '측정 불가';
  const tryRead = (f, parse) => { if (!f) return { err: '입력 없음' }; try { return { v: parse(readFileSync(f, 'utf8')) }; } catch (e) { return { err: e.message }; } };
  const wf = tryRead(arg('--waterfall'), JSON.parse);
  const plan = wf.v ? planned(wf.v) : null;
  let act = tryRead(arg('--actual'), JSON.parse);
  if (act.v) { try { act = { v: actual(act.v, wf.v ?? { tasks: [] }) }; } catch (e) { act = { err: e.message }; } }
  const led = tryRead(arg('--ledger'), ledger);
  const out = ['| 지표 | 계획 | 실제 |', '| --- | --- | --- |'];
  const pv = (o, k) => (o ? o[k] : NA);
  for (const [label, k] of [['Task 수', 'tasks'], ['작업 시간 합(분)', 'sum'], ['임계 경로(분)', 'critical'],
    ['작업 시간 합 ÷ 임계 경로', 'ratio'], ['최대 동시 Task 수', 'maxConcurrent'], ['경과(분)', 'elapsed']])
    out.push(`| ${label} | ${pv(plan, k)} | ${pv(act.v, k)} |`);
  out.push(`| 슬롯 수 | ${pv(plan, 'slots')} | - |`, '', '| 지표 | 값 |', '| --- | --- |');
  const l = led.v;
  out.push(`| 수정 루프 | ${l?.fixLoops ?? NA} |`, `| 재시도 합 | ${l ? l.retries : NA} |`,
    `| 실패 Task | ${l ? l.failed : NA} |`, `| 질문이 있던 Task | ${l ? l.questions : NA} |`);
  // Coordinator sessions = 20+ orca commands (measure-token-usage rule); workers and leads get the same notices.
  const files = sessionFiles(arg('--sessions'), Number(arg('--days')) || 7);
  const coord = files.map((f) => wakes(readFileSync(f, 'utf8'))).filter((w) => w.orca >= 20);
  const wk = coord.reduce((a, w) => ({ wakes: a.wakes + w.wakes, toolless: a.toolless + w.toolless }), { wakes: 0, toolless: 0 });
  out.push(`| 코디네이터가 깬 턴 수 | ${coord.length ? wk.wakes : NA} |`,
    `| 도구 호출 없이 끝난 깸 수 (heartbeat만 든 깸의 근사) | ${coord.length ? wk.toolless : NA} |`);
  let ws = NA;
  try { const s = folderSize(arg('--workspace')); ws = `${s.bytes} bytes · ${s.files} files`; } catch {}
  out.push(`| 작업 폴더 | ${ws} |`);
  if (l?.causes.length) { out.push('', '| Task | 재시도 | 원인 |', '| --- | --- | --- |'); for (const c of l.causes) out.push(`| ${c.task} | ${c.count} | ${c.cause} |`); }
  const why = [['waterfall', wf], ['actual', act], ['ledger', led]].filter(([, r]) => r.err).map(([k, r]) => `${k}: ${r.err}`);
  if (!coord.length) why.push(`sessions: 코디네이터 세션 없음(.jsonl ${files.length}개 중 orca 명령 20회 이상 0개)`);
  if (ws === NA) why.push('workspace: 입력 없음 또는 읽기 실패');
  if (why.length) out.push('', `측정 불가 사유: ${why.join(' · ')}`);
  console.log(out.join('\n'));
}
