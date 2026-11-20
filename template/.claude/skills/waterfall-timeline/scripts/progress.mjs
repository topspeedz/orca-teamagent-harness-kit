// Running-Run waterfall: real clock axis + now line. Markup/CSS copied from the approved P57 artifact
// (https://claude.ai/artifact/QL7DoGvadACngjerSuwZ6L). Forecast before a Run starts uses render.mjs instead.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const LANES = { plan: '기획', coord: '조정', design: '디자인', dev: '개발', verify: '검증', harness: '하네스' };
const STATUS = ['done', 'run', 'wait'];
const PX = 2.2; // px per minute (66px per 30 min)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ISO with an explicit offset; labels are shown in that offset.
const parseAt = (s, name) => {
  const m = /([+-])(\d\d):?(\d\d)$|Z$/.exec(String(s ?? ''));
  const ms = Date.parse(s);
  assert(m && Number.isFinite(ms), `${name} must be ISO with offset, e.g. 2026-10-31T11:20+09:00`);
  return { ms, off: m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0 };
};
const dur = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`; };

const CSS = `:root{--bg:#f7f6f3;--surface:#fff;--fg:#24211d;--muted:#6e675e;--line:#e2ddd4;--plan:#5b6fb0;--coord:#7a6a55;--design:#b0743a;--dev:#8b5bb0;--verify:#b04f5b;--harness:#3f8a96;--done:#2f8f4e;--crit:#24211d;--now:#d0412f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171614;--surface:#201e1b;--fg:#ece7df;--muted:#a59d91;--line:#37322c;--crit:#ece7df;--now:#ff7a63;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171614;--surface:#201e1b;--fg:#ece7df;--muted:#a59d91;--line:#37322c;--crit:#ece7df;--now:#ff7a63;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding-block:32px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:20px}
h1{margin:0;font-size:1.7rem;text-wrap:balance} .sub{color:var(--muted);margin:.3rem 0 0}
.legend{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:13px}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:14px;height:10px;display:inline-block;border-radius:2px}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--line)}
.row{display:flex;min-height:30px;border-bottom:1px solid var(--line)}
.name{position:sticky;left:0;z-index:2;background:var(--surface);flex:0 0 300px;padding:5px 10px;border-right:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lane{display:inline-block;width:46px;font-size:12px;color:var(--muted)}
.track{position:relative;flex:none}
.track i{position:absolute;top:0;bottom:0;border-left:1px dashed var(--line)}
.track i.now{border-left:2px solid var(--now)}
.track i.uw{border-left:1.5px dashed var(--muted);border-right:1.5px dashed var(--muted);background:color-mix(in srgb,var(--muted) 7%,transparent)}
.axis .track b{position:absolute;top:6px;font-size:12px;color:var(--muted);font-weight:500;transform:translateX(-50%);font-variant-numeric:tabular-nums}
.axis .track b.nowlbl{color:var(--now);top:auto;bottom:-1px;font-weight:700}
.bar{position:absolute;top:5px;height:20px;border-radius:3px}
.bar span{position:absolute;left:calc(100% + 6px);top:1px;white-space:nowrap;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.bar.lbl-l span{left:auto;right:calc(100% + 6px)}
.plan{background:var(--plan)}.coord{background:var(--coord)}.design{background:var(--design)}.dev{background:var(--dev)}.verify{background:var(--verify)}.harness{background:var(--harness)}
.lane.plan,.lane.coord,.lane.design,.lane.dev,.lane.verify,.lane.harness{background:none}
.bar.wait{opacity:.45}.bar.done{background:var(--done)}.bar.run{box-shadow:0 0 0 2px var(--fg)}
.bar.crit{outline:2px solid var(--crit);outline-offset:1px}
.bar.uwait{background:transparent;border:2px dashed var(--muted);box-sizing:border-box;outline:none}.bar.uwait.done{border-color:var(--done)}
.notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.notes div{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.notes b{display:block;margin-bottom:4px}`;

export function renderProgress(d, renderedAt = Date.now()) {
  assert(d.title && Array.isArray(d.tasks) && d.tasks.length, 'title and tasks required');
  const ts = d.tasks.map((t) => {
    assert(LANES[t.lane], `invalid lane ${t.lane}`);
    assert(STATUS.includes(t.status), `invalid status ${t.status}`);
    const s = parseAt(t.start, 'start'), e = parseAt(t.end, 'end');
    assert(e.ms >= s.ms, `end before start: ${t.title}`);
    return { ...t, s: s.ms, e: e.ms, off: s.off };
  });
  const off = ts[0].off;
  const now = d.now === undefined ? renderedAt : parseAt(d.now, 'now').ms;
  for (const t of ts) {
    if (t.status === 'done') assert(t.e <= now, `done task ends after now: ${t.title}`);
    if (t.status === 'run') assert(t.s <= now, `running task starts after now: ${t.title}`);
  }
  const wall = (ms) => new Date(ms + off * 60000).toISOString();
  const hm = (ms) => wall(ms).slice(11, 16);
  const day0 = wall(Math.min(...ts.map((t) => t.s))).slice(0, 10);
  const tick = (ms) => { const iso = wall(ms); return (iso.slice(0, 10) === day0 ? '' : `${+iso.slice(5, 7)}/${+iso.slice(8, 10)} `) + iso.slice(11, 16); };
  // Every task done = finished Run: no now line, axis ends exactly at the last end (user 2026-11-07).
  const finished = ts.every((t) => t.status === 'done');
  const HALF = 30 * 60000;
  // Axis on half-hour boundaries in the display zone, padded one step past the last end / now (finished: no padding).
  const localFloor = (ms) => Math.floor((ms + off * 60000) / HALF) * HALF - off * 60000;
  const a0 = finished ? Math.min(...ts.map((t) => t.s)) : localFloor(Math.min(...ts.map((t) => t.s)));
  const a1 = finished ? Math.max(...ts.map((t) => t.e)) : localFloor(Math.max(now, ...ts.map((t) => t.e))) + 2 * HALF;
  const x = (ms) => ((ms - a0) / 60000) * PX;
  const width = x(a1);
  // Finished: the track stretches to the page width, so positions are % of the span (min width keeps phones readable).
  const pos = (ms) => (finished ? `${(((ms - a0) / (a1 - a0)) * 100).toFixed(3)}%` : `${x(ms)}px`);
  const trackStyle = finished ? `flex:1 1 auto;min-width:${Math.max(width, 600)}px` : `width:${width}px`;
  const ticks = []; for (let m = finished ? localFloor(a0) + HALF : a0; m < a1; m += HALF) ticks.push(m);
  const nowX = x(now);
  // ✋ title = user approval/decision wait: dashed bar, kept out of the measured work time, and a dashed vertical band across every row (user 2026-11-07/08).
  const isWait = (t) => /^(?:\S+ · )?✋/.test(t.title);
  const span = (s0, e0) => (finished ? `left:${pos(s0)};width:${(((e0 - s0) / (a1 - a0)) * 100).toFixed(3)}%` : `left:${x(s0)}px;width:${x(e0) - x(s0)}px`);
  const bands = ts.filter((t) => isWait(t) && t.e > t.s).map((t) => `<i class="uw" style="${span(t.s, t.e)}"></i>`).join('');
  const lines = bands + ticks.map((m) => `<i style="left:${pos(m)}"></i>`).join('') + (finished ? '' : `<i class="now" style="left:${nowX}px"></i>`);
  const start = Math.min(...ts.map((t) => t.s)), end = Math.max(...ts.map((t) => t.e));
  const zone = off === 540 ? 'KST' : `UTC${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  const unionMin = (list) => { let sum = 0, cur = -Infinity; for (const t of [...list].sort((p, q) => p.s - q.s)) { const s0 = Math.max(t.s, cur); if (t.e > s0) sum += t.e - s0; cur = Math.max(cur, t.e); } return sum / 60000; };
  const workMin = unionMin(ts.filter((t) => !isWait(t))), waitMin = unionMin(ts) - workMin, idleMin = (end - start) / 60000 - unionMin(ts);
  const split = ` = 작업 ${dur(workMin)}${waitMin ? ` + 사용자 대기 ${dur(waitMin)}` : ''}${idleMin >= 1 ? ` + 빈 시간 ${dur(idleMin)}` : ''}`;
  const rows = ts.map((t) => {
    const label = `${hm(t.s)}–${hm(t.e)} · ${dur((t.e - t.s) / 60000)}`;
    return `<div class="row"><div class="name" title="${esc(t.title)}"><span class="lane ${t.lane}">${LANES[t.lane]}</span>${esc(t.title)}</div><div class="track" style="${trackStyle}">${lines}<div class="bar ${t.lane} ${t.status}${t.crit ? ' crit' : ''}${isWait(t) ? ' uwait' : ''}${finished && (a1 - t.e) / (a1 - a0) < 0.25 ? ' lbl-l' : ''}" style="left:${pos(t.s)};width:${finished ? `max(2px,${(((t.e - t.s) / (a1 - a0)) * 100).toFixed(3)}%)` : `${Math.max(2, x(t.e) - x(t.s))}px`}" title="${label}"><span>${label}</span></div></div></div>`;
  }).join('\n');
  const dag = d.dag ? ` · 의존 관계: <a href="${esc(d.dag)}">DAG 스윔레인</a>` : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(d.pageTitle ?? d.title)}</title><style>${CSS}</style></head><body>
<div class="wrap">
<header><h1>${esc(d.title)}</h1><p class="sub">${d.run ? `Run ${esc(d.run)} · ` : ''}시각 ${zone} · 시작 ${hm(start)} → ${finished ? `종료 <b>${tick(end)}</b> · 소요 ${dur((end - start) / 60000)}${split}` : `예상 종료 <b>~${tick(end)}</b> · 기준 ${tick(now)}`}${dag}</p></header>
<div class="legend"><span><i style="background:var(--done)"></i>완료(실측)</span>${finished ? '' : '<span><i style="background:var(--dev);box-shadow:0 0 0 2px var(--fg)"></i>진행(시작 실측 · 끝 예상)</span><span><i style="background:var(--dev);opacity:.45"></i>대기(예상)</span>'}<span><i style="outline:2px solid var(--crit);background:transparent"></i>임계 경로</span>${ts.some(isWait) ? '<span><i style="border:2px dashed var(--muted);background:transparent;box-sizing:border-box"></i>사용자 승인·결정 대기(작업 시간 아님 — 세로 점선 띠)</span>' : ''}${finished ? '' : '<span><i style="background:var(--now);width:3px"></i>지금</span>'}</div>
<div class="scroll"><div class="row axis"><div class="name">${finished ? '시각' : `지금 ${tick(now)}`}</div><div class="track" style="${trackStyle}">${ticks.map((m) => `<b style="left:${pos(m)}">${tick(m)}</b>`).join('')}${finished ? '' : `<b class="nowlbl" style="left:${nowX}px">지금</b>`}</div></div>
${rows}</div>
<div class="notes">
${(d.notes ?? []).map((n) => `<div><b>${esc(n.title)}</b>${esc(n.body)}</div>`).join('\n')}
</div>
</div>
</body></html>`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [input, output] = process.argv.slice(2);
  assert(input && output, 'Usage: node progress.mjs input.json output.html');
  fs.writeFileSync(output, renderProgress(JSON.parse(fs.readFileSync(input, 'utf8').replace(/^﻿/, ''))));
  console.log(output);
}
