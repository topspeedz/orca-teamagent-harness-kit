// harness-retro measurements for one phase (read-only). Prints a markdown table for the retro report.
// Usage (project root): node .claude/skills/harness-retro/scripts/retro-measure.mjs
//   --waterfall <waterfall.json> --actual <actual.json> --ledger <ledger.md> --workspace <_workspace>
//   [--sessions <dir with .jsonl>] [--days 7]
// Any input left out or unreadable prints 측정 불가 for its rows — never a silent 0.
// Coordinator-wake counting is ported from harness-design measure-token-usage.mjs (notice detection only).
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
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

// Actual values: [{id,start,end,status?}] ISO times from `orca-launch.mjs actual`; deps come from waterfall.json.
// A Task that is not in the plan (a team Task, a phase step) is left out of the parallel figures and counted in `skipped`.
export function actual(list, wf) {
  const deps = depsOf(wf);
  const ms = list.filter((r) => r.id in deps).map((r) => {
    const s = Date.parse(r.start), e = Date.parse(r.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) throw new Error(`actual: ${r.id} has an invalid start/end`);
    return { id: r.id, s, e, reg: Date.parse(r.registered) || 0 };
  });
  const t0 = Math.min(...ms.map((r) => r.s));
  // ready→start: minutes a Task sat startable, from its last dependency's end (or its own registration, when it was
  // registered later than that) to its own start. A Task with no dependency, or with one that was not measured, is
  // left out rather than guessed.
  const byId = new Map(ms.map((r) => [r.id, r]));
  const delays = ms.filter((r) => deps[r.id].length && deps[r.id].every((d) => byId.has(d)))
    .map((r) => ({ id: r.id, min: Math.max(0, r.s - Math.max(r.reg, ...deps[r.id].map((d) => byId.get(d).e))) / 60000 }));
  const worst = delays.reduce((a, d) => (!a || d.min > a.min ? d : a), null);
  return {
    ...parallel(ms.map((r) => ({ id: r.id, start: (r.s - t0) / 60000, end: (r.e - t0) / 60000 })), deps),
    failed: list.filter((r) => r.status === 'failed').length, skipped: list.length - ms.length,
    readyDelay: { tasks: delays.length, sum: round2(delays.reduce((a, d) => a + d.min, 0)), max: worst ? round2(worst.min) : 0, at: worst?.id ?? null },
  };
}

// ledger.md: budget line `수정 루프 <N>회` (the `최대 <N>회` cap is not a count) and the one table.
export function ledger(text) {
  const loop = text.match(/수정 루프 (\d+)회/);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => /^\|\s*Task\s*\|/.test(l));
  const rows = [];
  if (head >= 0) for (const l of lines.slice(head + 2)) { if (!l.trim().startsWith('|')) break; rows.push(cells(l)); }
  // columns are found by header: the status column left the ledger when Orca became the source of Task state
  const header = head >= 0 ? cells(lines[head]) : [];
  const col = (name) => header.findIndex((h) => h.startsWith(name));
  const RETRY = col('재시도'), ASKED = col('질문');
  const causes = [];
  let retries = 0;
  for (const r of rows) {
    const m = (r[RETRY] || '').match(/^(\d+)\s*(?:\((.*)\))?/);
    const count = m ? Number(m[1]) : 0;
    retries += count;
    if (count) causes.push({ task: r[0], count, cause: m[2] || '(원인 없음)' });
  }
  return {
    fixLoops: loop ? Number(loop[1]) : null,
    tasks: rows.length, retries,
    questions: rows.filter((r) => r[ASKED] && r[ASKED] !== '없음' && r[ASKED] !== '0').length,
    causes,
  };
}

const NOTICE = /^\s*You have \d+ orchestration message/;
// The wait contract runs `check --wait` as a background command; its completion notice is the wake.
const BG_DONE = /^\s*<task-notification>[\s\S]*?<tool-use-id>([^<\s]+)<\/tool-use-id>/;
const WAIT_CMD = /orchestration\s+check\s[^\n]*--wait/;
// Only the coordinator creates the execution Run and registers Tasks; the front desk and team leads do not.
const COORD_CMD = /orca-launch\.mjs["']?\s+(exec-run|register)\b/;

// One session .jsonl: turns woken by Orca's typed notice or by a finished background `check --wait`, and those that
// ended with no tool call.
// toolless only approximates "the batch held only heartbeats" — the session log does not record batch contents.
export function wakes(text) {
  let n = 0, toolless = 0, coordinator = false, pending = null;
  const waits = new Set();
  const close = () => { if (pending && !pending.tools) toolless++; pending = null; };
  for (const ln of text.split('\n')) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.isSidechain) continue;
    const c = o.message?.content;
    if (o.type === 'user') {
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('') : '';
      if (!txt) continue; // tool results do not end a wake turn
      close();
      if (NOTICE.test(txt) || waits.has(BG_DONE.exec(txt)?.[1])) { n++; pending = { tools: false }; }
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type !== 'tool_use') continue;
        if (pending) pending.tools = true;
        if (b.name !== 'Bash' && b.name !== 'PowerShell') continue;
        const command = String(b.input?.command || '');
        if (WAIT_CMD.test(command)) waits.add(b.id);
        if (COORD_CMD.test(command)) coordinator = true;
      }
    }
  }
  close();
  return { wakes: n, toolless, coordinator };
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
    `| 실패 Task | ${act.v ? act.v.failed : NA} |`, `| 질문이 있던 Task | ${l ? l.questions : NA} |`);
  const rd = act.v?.readyDelay;
  out.push(`| 준비→기동 지연 합(분) | ${rd ? rd.sum : NA} |`, `| 준비→기동 지연 최대(분) | ${rd ? (rd.at ? `${rd.max} (${rd.at})` : 0) : NA} |`);
  // Coordinator sessions = those that ran exec-run or register; one row each, never summed (a second phase's
  // coordinator in the same window is a different session). Workers and leads get the same notices.
  const files = sessionFiles(arg('--sessions'), Number(arg('--days')) || 7);
  const coord = files.map((f) => ({ name: basename(f).slice(0, 8), ...wakes(readFileSync(f, 'utf8')) })).filter((w) => w.coordinator);
  if (!coord.length) out.push(`| 코디네이터가 깬 턴 수 | ${NA} |`, `| 도구 호출 없이 끝난 깸 수 (heartbeat만 든 깸의 근사) | ${NA} |`);
  for (const w of coord) out.push(`| 코디네이터가 깬 턴 수 (세션 ${w.name}) | ${w.wakes} |`,
    `| 도구 호출 없이 끝난 깸 수 (heartbeat만 든 깸의 근사, 세션 ${w.name}) | ${w.toolless} |`);
  let ws = NA;
  try { const s = folderSize(arg('--workspace')); ws = `${s.bytes} bytes · ${s.files} files`; } catch {}
  out.push(`| 작업 폴더 | ${ws} |`);
  if (l?.causes.length) { out.push('', '| Task | 재시도 | 원인 |', '| --- | --- | --- |'); for (const c of l.causes) out.push(`| ${c.task} | ${c.count} | ${c.cause} |`); }
  const why = [['waterfall', wf], ['actual', act], ['ledger', led]].filter(([, r]) => r.err).map(([k, r]) => `${k}: ${r.err}`);
  if (!coord.length) why.push(`sessions: 코디네이터 세션 없음(.jsonl ${files.length}개 중 exec-run·register를 쓴 세션 0개)`);
  if (ws === NA) why.push('workspace: 입력 없음 또는 읽기 실패');
  if (act.v?.skipped) out.push('', `actual: 계획(waterfall)에 없는 Task ${act.v.skipped}개는 병렬 지표에서 뺐다`);
  if (why.length) out.push('', `측정 불가 사유: ${why.join(' · ')}`);
  console.log(out.join('\n'));
}
