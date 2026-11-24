// Orca Run task times (measured) + forecast plan JSON (likely estimates) → progress.mjs input.
// Usage: node from-orca.mjs [--plan <waterfall.json>] --out <progress.json> (--run <run_id>[,<child_run_id>...] | --tasks <task-list.json>)
//        [--map <orca-tasks.json>] [--ledger <00_ledger.md>] [--now <ISO>] [--slots <n>] [--title <text>] [--dag <url>] [--patch <patch.json>]
// No --plan (a Run watched by another 창구, plan not at hand): measured rows only; add ✋ gates and remaining estimates as patch.tasks.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const M = 60000;
const LANE = { plan: 'plan', data: 'plan', design: 'design', dev: 'dev', media: 'dev', verify: 'verify', coord: 'coord', harness: 'harness' };
const ROLE_LANE = [[/planner|product-manager|shopify-analyst|data-modeler|migration-manager|integration-reviewer/, 'plan'], [/blender-modeler|design-reviewer.*스펙/, 'design'],
  [/code-reviewer|qa-inspector|visual-analyst|design-reviewer/, 'verify'], [/harness-engineer|docs-curator/, 'harness'], [/storefront-dev|cinematographer|brand-creative|creative-director|campaign/, 'dev']];
// Orca: created_at "2026-10-31 00:53:27" (UTC, no zone), completed_at ISO with Z.
const utc = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z') : null);
const iso = (ms, off) => new Date(ms + off * M).toISOString().slice(0, 16) + (off === 540 ? '+09:00' : 'Z');
const head = (spec) => String(spec ?? '').split(/등급:|\n/)[0];
const strip = (s) => String(s).replace(/^\[역할:[^\]]*\]\s*/, '').trim();
const role = (spec) => /^\[역할:\s*([^\]·]+)/.exec(String(spec ?? ''))?.[1].trim() ?? '';
const isLead = (spec) => /^\[역할:[^\]]*·\s*리드\]/.test(String(spec ?? ''));
// "BL-0921~0925" → 0921..0925; single "BL-0917" too.
const bls = (text) => [...String(text).matchAll(/BL-(\d{4})(?:~(\d{4}))?/g)].flatMap(([, a, b]) => {
  const out = []; for (let n = +a; n <= +(b ?? a); n++) out.push('BL-' + String(n).padStart(4, '0')); return out;
});

// Ledger rows "| PM0 | BL-0913 | … | task_2b16d7a49c62 / ctx_… |" → { task_2b16d7a49c62: 'PM0' }.
export const ledgerMap = (md) => Object.fromEntries([...String(md).matchAll(/^\|\s*([\w-]+)\s*\|.*?\b(task_[0-9a-f]+)/gm)].map(([, id, task]) => [task, id]));

export function fromOrca({ plan = { tasks: [] }, orcaTasks, now = Date.now(), slots: slotCount, title, dag, patch = {}, ledger = {}, map, off = 540 }) {
  const mapped = new Map(), retired = new Set(), launched = new Map();
  if (map) {
    assert(map.run && map.tasks && (!plan.run || plan.run === map.run), '계획과 대응표의 Run 확인 필요');
    for (const [id, entry] of [...Object.entries(map.tasks), ...Object.entries(map.direct ?? {})]) {
      const actual = entry.orca ?? entry.task;
      if (actual) {
        assert(!mapped.has(actual), '중복 Orca Task ID: ' + actual);
        mapped.set(actual, id);
        // orca-launch.mjs records the real worker launch (a retried Task: its first successful one).
        const st = entry.okStarted ?? entry.started;
        if (st) launched.set(actual, utc(st));
      }
      for (const old of entry.previous ?? []) retired.add(old.orca);
    }
  }
  const pt = plan.tasks.map((t) => ({
    id: t.id, bl: t.bl, deps: [...t.deps], lane: LANE[t.lane ?? t.tone] ?? 'coord',
    kind: t.kind === 'work' ? 'work' : t.kind === 'coord' ? 'coord' : 'approval',
    dur: t.kind === 'work' || t.kind === 'coord' ? t.estimate.likely : 0,
    title: `${t.id} ${t.title}${t.bl ? ' · ' + t.bl : ''}`,
  }));
  for (const [id, extra] of Object.entries(patch.extraDeps ?? {})) pt.find((t) => t.id === id)?.deps.push(...extra);
  const byId = Object.fromEntries(pt.map((t) => [t.id, t]));
  const rows = [], end = {}, start = {};
  // Match each non-leader Orca task to one plan task by its BL or plan ID in the spec head.
  const leaders = [];
  // Plan Tasks are often registered all at once when the Run starts, so created_at is not when work began.
  // Start = recorded launch; else when it became ready (latest dep completion, not before created_at),
  // pulled back to its first child's creation if a member was launched earlier. Member Tasks keep created_at.
  const byOid = new Map(orcaTasks.map((o) => [o.id, o]));
  const firstChild = new Map();
  for (const o of orcaTasks) if (o.parent_id) firstChild.set(o.parent_id, Math.min(firstChild.get(o.parent_id) ?? Infinity, utc(o.created_at)));
  const startOfTask = (o) => {
    if (launched.has(o.id)) return launched.get(o.id);
    let s = utc(o.created_at);
    if (o.parent_id) return s;
    let deps = []; try { deps = Array.isArray(o.deps) ? o.deps : JSON.parse(o.deps || '[]'); } catch { deps = []; }
    for (const d of deps) { const e = utc(byOid.get(d)?.completed_at); if (e && e > s) s = e; }
    return Math.min(s, firstChild.get(o.id) ?? Infinity);
  };
  // Member spec heads are often just "[역할: X]"; name the row from display_name "[X - U02-M1] 할 일 (BL-…)".
  const memberName = (dn) => { const id = /- ([^\]]+)\]/.exec(dn ?? '')?.[1]; const rest = String(dn ?? '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\(BL-.*$/, '').trim(); return [id, rest].filter(Boolean).join(' '); };
  for (const o of orcaTasks) {
    if (retired.has(o.id)) continue;
    // A failed dispatch puts its Task back to `ready` with no completed_at — not running work (VA1·VA2 2026-10-31 drew as run).
    if (!o.completed_at && o.status && o.status !== 'dispatched') continue;
    const s = startOfTask(o), e = utc(o.completed_at), h = head(o.spec);
    const exact = mapped.get(o.id);
    if (isLead(o.spec)) { leaders.push({ o, s, e, planTask: byId[exact], members: new Set(bls(h)) }); continue; }
    const hit = exact ? (byId[exact] ? [byId[exact]] : []) : ledger[o.id] && byId[ledger[o.id]] ? [byId[ledger[o.id]]]
      : pt.filter((t) => (t.bl && bls(h).includes(t.bl)) || new RegExp(`(^|[\\]\\s])${t.id}([\\s·/]|$)`).test(h));
    if (hit.length === 1) {
      const t = hit[0], e2 = e ?? Math.max(now, s + t.dur * M);
      // A second Task for the same plan ID (FIX, re-run) gets its own row and extends the plan Task's end.
      const again = t.id in end;
      rows.push(again ? { ...t, id: o.id, deps: [], title: `${t.id} ↻ ${strip(o.display_name || h)}`, status: e ? 'done' : 'run', s, e: e2 }
        : { ...t, status: e ? 'done' : 'run', s, e: e2 });
      start[t.id] = Math.min(start[t.id] ?? s, s); end[t.id] = Math.max(end[t.id] ?? 0, e2);
    } else {
      const r = role(o.spec);
      if (!r) continue; // not a role Task (e.g. a stray "You have new orchestration messages" entry)
      rows.push({ id: o.id, title: (strip(h) || memberName(o.display_name)) + (r ? ` (${r})` : ''), lane: ROLE_LANE.find(([re]) => re.test(r))?.[1] ?? 'coord', status: e ? 'done' : 'run', s, e: e ?? now, deps: [] });
    }
  }
  // Leaders: coord rows; still running → end = max(now + 10 min, members' ends). Tasks fed by a running bundle also wait for its report.
  for (const l of leaders) {
    const memberIds = pt.filter((t) => t.id !== l.planTask?.id && t.bl && l.members.has(t.bl)).map((t) => t.id);
    const key = l.planTask?.id ?? 'lead:' + l.o.id;
    const name = strip(l.o.display_name || head(l.o.spec));
    l.row = { id: key, title: `${l.planTask?.title ?? name} — 리더`, lane: 'coord', status: l.e ? 'done' : 'run', s: l.s, deps: l.planTask?.deps ?? [], memberIds };
    rows.push(l.row);
    if (l.planTask) { start[key] = l.s; end[key] = l.e ?? now; }
    if (!l.e) for (const t of pt) if (t.id !== key && !memberIds.includes(t.id) && !t.deps.includes(key) && t.deps.some((d) => memberIds.includes(d))) t.deps.push(key);
  }
  // Schedule the rest from now: earliest-startable first, ties → longest remaining path. Only 'work' uses slots.
  const todo = pt.filter((t) => !(t.id in end));
  const tail = {};
  const tailOf = (id) => (tail[id] ??= (byId[id]?.dur ?? 0) + Math.max(0, ...todo.filter((t) => t.deps.includes(id)).map((t) => tailOf(t.id))));
  const slots = Array(slotCount ?? plan.maxWorkers ?? plan.assumptions?.maxWorkers ?? 3).fill(now);
  const leaderEnd = () => { for (const l of leaders) if (!l.e) end[l.row.id] = Math.max(now + 10 * M, ...l.row.memberIds.map((id) => end[id] ?? now)); };
  leaderEnd();
  const pending = [...todo];
  while (pending.length) {
    leaderEnd();
    const ready = pending.filter((t) => t.deps.every((d) => d in end || !(d in byId) && !d.startsWith('lead:')));
    assert(ready.length, 'unschedulable (cycle or missing dep): ' + pending.map((t) => t.id).join(','));
    const free = Math.min(...slots);
    const depEnd = (t) => Math.max(0, ...t.deps.map((d) => end[d] ?? 0));
    const startOf = (t) => Math.max(now, depEnd(t), t.kind === 'work' ? free : 0);
    const t = ready.reduce((a, b) => (startOf(b) < startOf(a) || (startOf(b) === startOf(a) && tailOf(b.id) > tailOf(a.id)) ? b : a));
    pending.splice(pending.indexOf(t), 1);
    let s = startOf(t), e = s + t.dur * M, status = 'wait';
    if (t.kind === 'approval') {
      const preds = t.deps.filter((d) => d in byId);
      const allDone = preds.every((d) => rows.find((r) => r.id === d)?.status === 'done');
      // A successor counts as started when its own Task or its team leader's bundle has started.
      const leadStart = (id) => leaders.find((l) => l.row.memberIds.includes(id))?.s;
      const succStarts = pt.filter((x) => x.deps.includes(t.id)).map((x) => start[x.id] ?? leadStart(x.id)).filter((v) => v != null);
      if (allDone && preds.length) {
        s = Math.max(...preds.map((d) => end[d]));
        if (succStarts.length) { e = Math.min(...succStarts); status = 'done'; } else { e = Math.max(s, now); status = 'run'; }
      } else if (!preds.length && succStarts.length) { s = e = Math.min(...succStarts); status = 'done'; } // e.g. plan approval gate before the first task
    }
    if (t.kind === 'work') { slots.sort((a, b) => a - b); slots[0] = e; }
    end[t.id] = e;
    rows.push({ ...t, title: t.kind === 'approval' ? `✋ ${t.title}${status === 'done' ? '' : ' (대기 시간 미정)'}` : t.title, status, s, e });
  }
  for (const l of leaders) l.row.e = l.e ?? end[l.row.id];
  // Critical path: from the latest end back through the latest-ending dep.
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (let cur = rows.reduce((a, b) => (!a || b.e > a.e ? b : a), null); cur; ) {
    cur.crit = true;
    const ds = (cur.deps ?? []).map((d) => rowById[d]).filter(Boolean);
    cur = ds.length ? ds.reduce((a, b) => (b.e > a.e ? b : a)) : null;
  }
  rows.sort((a, b) => a.s - b.s || a.e - b.e);
  // patch.tasks: progress-format rows added as given (ledger ✋ gates, remaining estimates when there is no plan).
  const extra = (patch.tasks ?? []).map((t) => ({ ...t, s: Date.parse(t.start) }));
  const out = [...rows.map((r) => ({ title: r.title, lane: r.lane, status: r.status, start: iso(r.s, off), end: iso(r.e, off), ...(r.crit ? { crit: true } : {}), s: r.s })), ...extra]
    .sort((a, b) => a.s - b.s).map(({ s: _s, ...t }) => t);
  return {
    title: title ?? `${plan.title ?? 'Run'} — 워터폴 (실측 + 예상)`,
    ...((map?.run ?? plan.run) ? { run: map?.run ?? plan.run } : {}), ...(dag ? { dag } : {}),
    now: iso(now, off),
    tasks: out,
    notes: patch.notes ?? [
      { title: '예상 근거', body: `완료·진행 막대의 시작은 Orca Task 생성 시각, 끝은 worker_done 시각. 대기 막대는 계획 추정의 likely 값을 의존성 순서대로 지금 이후에 붙인 것 — 팀원 슬롯 ${slots.length}개 가정, 남은 경로가 긴 Task 먼저.` },
      { title: '빠진 것', body: '사용자 승인·결정 대기는 0분으로 그렸다(기다린 만큼 뒤 막대가 밀린다). 리더·코디네이터 기동·감독, 추정 밖 FIX 반복, 압축·재기동은 넣지 않았다. 예상 종료는 보장 시각이 아니다.' },
    ],
  };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
  assert(a.out && (a.run || a.tasks || a.map), 'Usage: node from-orca.mjs [--plan <json>] --out <json> (--map <orca-tasks.json> | --run <id>[,<child>...] | --tasks <json>) [--ledger 00_ledger.md] [--now ISO] [--slots n] [--title t] [--dag url] [--patch json]');
  const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
  const map = a.map && read(a.map);
  const runs = (a.run ?? map?.run ?? '').split(',');
  if (map) assert(map.run && runs[0] === map.run, '대응표와 실행 Run 불일치');
  // --run a,b: parent Run plus leader child Runs (task-list of the parent does not include child-Run Tasks).
  const lists = a.tasks ? [read(a.tasks)] : runs.map((run) => JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', run, '--full', '--json'], { encoding: 'utf8' })));
  const orcaTasks = lists.flatMap((raw) => { const r = raw.result ?? raw; return Array.isArray(r) ? r : r.tasks; });
  const plan = a.plan ? read(a.plan) : { tasks: [] };
  if (map && a.tasks) {
    const captured = lists[0].result ?? lists[0];
    for (const id of [captured.runId, captured.run_id, captured.run?.id, ...orcaTasks.map(t => t.run_id ?? t.runId)].filter(Boolean)) {
      assert(runs.includes(id), '대응표와 저장된 Run 불일치: ' + id);
    }
  }
  if (a.run && !plan.run) plan.run = a.run.split(',')[0];
  const out = fromOrca({ plan, orcaTasks, map, now: a.now ? Date.parse(a.now) : Date.now(), slots: a.slots && +a.slots, title: a.title, dag: a.dag,
    patch: a.patch ? read(a.patch) : {}, ledger: a.ledger ? ledgerMap(fs.readFileSync(a.ledger, 'utf8')) : {} });
  fs.writeFileSync(a.out, JSON.stringify(out, null, 1));
  console.log(a.out);
}
