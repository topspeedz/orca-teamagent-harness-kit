#!/usr/bin/env node
// DAG swimlane spec (JSON) -> fixed-px SVG artifact page in the format of assets/reference.html. Node built-ins only.
// Usage: node render.mjs <spec.json> <out.html>   |   node render.mjs --self-test
// Exit 1 on invalid spec or when any edge passes through a node rectangle.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Geometry of the reference file: 140px lane labels, 250px columns (190px card + 60px gap), 40px column header.
const G = { left: 140, colW: 250, nodeOff: 30, nodeW: 190, nodeH: 56, rightPad: 30, top: 40, bottomPad: 10,
  laneGap: 10, pitch: 80, nodeTop: 20, nodeBottom: 24, grpPad: 10 };
const TONES = ['plan', 'dev', 'verify', 'coord', 'harness'];
const STATUS = { done: '✓ 완료', run: '▶ 진행', wait: '대기' };
// Legend text: what each lane colour stands for (one role per tone).
const TONE_MEANING = {
  plan: '기획 — 무엇을 할지 정함(브리프·계획·백로그 분해)',
  dev: '제작 — 산출물을 만듦(코드·문구·연출·3D)',
  verify: '검증 — 만든 것을 확인(리뷰·QA·실측)',
  coord: '조정 — Run 관리·사용자 승인',
  harness: '하네스 — 회고·스킬·규칙 개선',
};

const AGENT = { claude: { glyph: '✳', name: 'Claude' }, codex: { glyph: '◎', name: 'Codex' } };
const EFFORT = { low: 'L', medium: 'M', high: 'H', xhigh: 'XH', max: 'MAX' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fail = msg => { throw new Error(msg); };
const num = v => +v.toFixed(1);
const pt = ([x, y]) => `${num(x)} ${num(y)}`;
const bez = ([p0, c1, c2, p3], t) => [0, 1].map(k => {
  const u = 1 - t;
  return u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k];
});

function samples(r) {
  if (r.curve) return Array.from({ length: 65 }, (_, i) => bez(r.curve, i / 64));
  const out = [];
  for (let i = 1; i < r.poly.length; i++) {
    const [a, b] = [r.poly[i - 1], r.poly[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let j = 0; j <= n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}

function labelAt(r) {
  if (r.curve) { const [x, y] = bez(r.curve, 0.5); return { x: x - 6, y, anchor: 'end' }; }
  const segs = r.poly.slice(1).map((b, i) => [r.poly[i], b]);
  const len = ([a, b]) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const vert = segs.filter(([a, b]) => a[0] === b[0]).sort((p, q) => len(q) - len(p))[0];
  if (vert) return { x: vert[0][0] + 8, y: (vert[0][1] + vert[1][1]) / 2, anchor: 'start' };
  const [a, b] = segs.sort((p, q) => len(q) - len(p))[0];
  return { x: (a[0] + b[0]) / 2, y: a[1] - 8, anchor: 'middle' };
}

// Bottom-right tag: platform glyph + small effort abbreviation (L/M/H/XH/MAX); model in the tooltip.
function agentTag(n) {
  const a = AGENT[n.agent], ef = EFFORT[n.effort] ?? '', x = n.x + n.w - 56, y = n.y + n.h - 8;
  return `<g class="ag ${n.agent}"><title>${esc(`${a.name} · ${n.model ?? '?'} · effort ${n.effort ?? '?'}`)}</title><rect class="bg" x="${x}" y="${y}" width="${ef ? 50 : 22}" height="16" rx="3"/><text x="${x + 11}" y="${y + 12}" text-anchor="middle">${a.glyph}</text>${ef ? `<text class="ef" x="${x + 34}" y="${y + 12}" text-anchor="middle">${ef}</text>` : ''}</g>`;
}

export function render(input) {
  const spec = structuredClone(input);
  const { columns, lanes, nodes, edges = [], groups = [], notes = [] } = spec;
  if (!spec.title || !columns?.length || !lanes?.length || !nodes?.length) fail('title, columns, lanes, nodes are required');
  lanes.forEach((l, i) => {
    l.tone ??= TONES[i % TONES.length];
    if (!TONES.includes(l.tone)) fail(`lane ${l.id}: tone must be one of ${TONES.join('|')}`);
  });
  if (!lanes.some(l => l.tone === 'harness')) fail('a harness lane (tone "harness") is required');
  if (notes.length < 3 || notes.length > 4) fail(`notes: 3-4 cards required, got ${notes.length}`);

  const laneById = new Map(lanes.map(l => [l.id, l]));
  const ents = new Map();
  const autoRow = new Map();
  for (const n of nodes) {
    if (ents.has(n.id)) fail(`duplicate id ${n.id}`);
    if (!laneById.has(n.lane)) fail(`node ${n.id}: unknown lane ${n.lane}`);
    if (!Number.isInteger(n.col) || n.col < 0 || n.col >= columns.length) fail(`node ${n.id}: col out of range`);
    if (!STATUS[n.status]) fail(`node ${n.id}: status must be done|run|wait`);
    if (!n.title || !n.sub) fail(`node ${n.id}: title and sub are both required (2-line card)`);
    const k = `${n.lane}/${n.col}`;
    const i = autoRow.get(k) ?? 0;
    autoRow.set(k, i + 1);
    n.row ??= i;
    ents.set(n.id, n);
  }

  let y = 0;
  for (const l of lanes) {
    const roles = l.roles?.length ?? 0;
    const labelH = (roles ? 52 + 20 * (roles - 1) : 30) + 18;
    const own = nodes.filter(n => n.lane === l.id);
    const nodesH = own.length ? G.nodeTop + Math.max(...own.map(n => n.row)) * G.pitch + G.nodeH + G.nodeBottom : 0;
    Object.assign(l, { y, h: Math.max(labelH, nodesH) });
    y += l.h + G.laneGap;
  }
  const W = G.left + columns.length * G.colW + G.rightPad;
  const H = G.top + y - G.laneGap + G.bottomPad;

  for (const n of nodes) {
    Object.assign(n, { x: G.left + n.col * G.colW + G.nodeOff, y: laneById.get(n.lane).y + G.nodeTop + n.row * G.pitch,
      w: G.nodeW, h: G.nodeH });
  }
  for (const a of nodes) for (const b of nodes) {
    if (a !== b && a.lane === b.lane && a.col === b.col && a.row < b.row && b.y - a.y < G.nodeH + 8) {
      fail(`nodes ${a.id} and ${b.id} overlap (same lane/column, rows too close)`);
    }
  }

  for (const g of groups) {
    if (ents.has(g.id)) fail(`duplicate id ${g.id}`);
    const ms = g.nodes.map(id => ents.get(id) ?? fail(`group ${g.id}: unknown node ${id}`));
    const x0 = Math.min(...ms.map(m => m.x)) - G.grpPad, y0 = Math.min(...ms.map(m => m.y)) - G.grpPad;
    Object.assign(g, { members: ms, x: x0, y: y0, w: Math.max(...ms.map(m => m.x + m.w)) + G.grpPad - x0,
      h: Math.max(...ms.map(m => m.y + m.h)) + G.grpPad - y0, colIn: Math.min(...ms.map(m => m.col)),
      colOut: Math.max(...ms.map(m => m.col)), tone: laneById.get(ms[0].lane).tone, right: [], leftPorts: [] });
    ents.set(g.id, g);
  }

  const ent = id => ents.get(id) ?? fail(`edge: unknown id ${id}`);
  for (const e of edges) {
    const f = ent(e.from), t = ent(e.to);
    if (f.members) f.right.push(e);
    if (t.members) (e.loop ? t.right : t.leftPorts).push(e);
  }
  // Groups spread their ports evenly along a side; nodes have one out point (right-center) and one in point (left-center).
  const portY = (g, side, e) => g.y + g.h * (g[side].indexOf(e) + 1) / (g[side].length + 1);
  const outPt = (o, e) => [o.x + o.w, o.members ? portY(o, 'right', e) : o.y + o.h / 2];
  const inPt = (o, e) => e.loop
    ? [o.x + o.w + 4, o.members ? portY(o, 'right', e) : o.y + o.h / 2]
    : [o.x - 2, o.members ? portY(o, 'leftPorts', e) : o.y + o.h / 2];
  const colIn = o => o.members ? o.colIn : o.col;
  const colOut = o => o.members ? o.colOut : o.col;

  function candidates(e, f, t) {
    const [ex, ey] = inPt(t, e);
    if (e.loop) {
      const bx = f.x + f.w / 2, by = ey > f.y ? f.y + f.h : f.y;
      return [{ poly: [[bx, by], [bx, ey], [ex, ey]] }];
    }
    const [sx, sy] = outPt(f, e);
    const dc = colIn(t) - colOut(f);
    if (dc < 1) fail(`edge ${e.from}->${e.to}: target must be in a later column (set "loop": true for a back edge)`);
    if (dc === 1) { const mx = (sx + ex) / 2; return [{ curve: [[sx, sy], [mx, sy], [mx, ey], [ex, ey]] }]; }
    if (e.merge) {
      const tx = t.x + t.w / 2, ty = t.y > sy ? t.y - 2 : t.y + t.h + 2;
      return [{ poly: [[sx, sy], [tx, sy], [tx, ty]] }];
    }
    // Distant edge: along the source row to the gap before the target, or along the target row from the gap after the source.
    const z = cx => ({ poly: [[sx, sy], [cx, sy], [cx, ey], [ex, ey]].filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]) });
    return [z(G.left + colIn(t) * G.colW), z(G.left + (colOut(f) + 1) * G.colW)];
  }

  const errors = [];
  const routes = edges.map(e => {
    const f = ent(e.from), t = ent(e.to);
    const skip = new Set([f, t].flatMap(o => o.members ? o.members.map(m => m.id) : [o.id]));
    const tried = candidates(e, f, t).map(r => ({ r, hit: nodes.filter(n => !skip.has(n.id) && samples(r)
      .some(([x, yy]) => x > n.x && x < n.x + n.w && yy > n.y && yy < n.y + n.h)) }));
    const ok = tried.find(c => !c.hit.length);
    if (!ok) errors.push(`edge ${e.from}->${e.to} crosses node(s) ${[...new Set(tried.flatMap(c => c.hit.map(n => n.id)))].join(', ')}`);
    return { e, r: ok?.r ?? tried[0].r };
  });
  if (errors.length) fail(`${errors.join('\n')}\nmove rows/columns so the source or target row is empty between them`);

  const css = readFileSync(join(HERE, '..', 'assets', 'reference.html'), 'utf8').match(/<style>[\s\S]*?<\/style>/)[0];
  const colX = i => G.left + i * G.colW;
  const out = [];
  out.push(`<title>${esc(spec.title)}</title>`, '<meta name="claude:viewport-fit-sides" content="cover">', css,
    '<style>.n .tag rect{stroke:none}.n .tag text{font:600 11px var(--sans);fill:var(--node)}.n .ag rect{stroke:none}.n .ag .bg{fill:var(--node);stroke:var(--line);stroke-width:1}.n .ag text{font:700 12px var(--sans)}.n .ag.claude text{fill:#d97757}.n .ag.codex text{fill:var(--fg)}.n .ag .ef{font:600 10px var(--sans);fill:var(--muted)}</style>');
  out.push(`<h1>${esc(spec.heading ?? spec.title)}</h1>`);
  if (spec.sub) out.push(`<p class="sub">${spec.sub}</p>`);
  const sw = (border, bg, dash = '') => `<i class="sw" style="border-color:${border};background:${bg}${dash}"></i>`;
  out.push('<div class="legend">'
    + TONES.filter(t => lanes.some(l => l.tone === t)).map(t => `<span>${sw(`var(--${t}-s)`, `var(--${t})`)}${esc(TONE_MEANING[t])} (${esc(lanes.filter(l => l.tone === t).map(l => l.name).join(' · '))})</span>`).join('')
    + (nodes.some(n => AGENT[n.agent]) ? '<span><b style="color:#d97757">✳</b> Claude · <b>◎</b> Codex · 작은 글씨 = effort(L·M·H·XH·MAX), 모델은 마우스 오버</span>' : '')
    + `<span>${sw('var(--done)', 'var(--node)')}완료 = 녹색 테두리</span><span>${sw('var(--muted)', 'var(--node)')}진행 = 레인 색 굵은 테두리</span><span>${sw('var(--muted)', 'var(--node)', ';border-style:dashed;opacity:.6')}대기 = 점선·흐림</span>`
    + '</div>');
  const aria = spec.aria ?? `열 순서: ${columns.join(' → ')}. 같은 열은 병렬.`;
  out.push(`<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px" role="img" aria-label="${esc(aria)}">`);
  out.push('<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0 0 L10 5 L0 10 z"/></marker></defs>');
  out.push(columns.map((c, i) => `<text class="colh" x="${colX(i) + G.colW / 2}" y="26" text-anchor="middle">${esc(c)}</text>`
    + (i ? `<line class="colline" x1="${colX(i)}" y1="${G.top}" x2="${colX(i)}" y2="${H - G.bottomPad}"/>` : '')).join(''));
  out.push(`<g transform="translate(0,${G.top})">`);
  out.push(lanes.map(l => `<rect class="band" x="0" y="${l.y}" width="${W}" height="${l.h}" fill="var(--${l.tone})"/>`).join(''));
  for (const l of lanes) {
    out.push(`<text class="lane-t" x="16" y="${l.y + 30}">${esc(l.name)}</text>`
      + (l.roles ?? []).map((r, i) => `<text class="lane-r" x="16" y="${l.y + 52 + 20 * i}">${esc(r)}</text>`).join(''));
  }
  for (const g of groups) {
    out.push(`<rect class="grp" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}" rx="6" style="stroke:var(--${g.tone}-s)"/>`);
  }
  for (const { e, r } of routes) {
    const d = r.curve ? `M${pt(r.curve[0])} C${r.curve.slice(1).map(pt).join(' ')}` : `M${r.poly.map(pt).join(' L')}`;
    let s = `<path class="e${e.loop ? ' loop' : ''}" marker-end="url(#ah)" d="${d}"/>`;
    if (e.label) {
      const a = labelAt(r);
      s += `<text class="el" x="${num(a.x)}" y="${num(a.y)}"${a.anchor === 'start' ? '' : ` text-anchor="${a.anchor}"`}>${esc(e.label)}</text>`;
    }
    out.push(s);
  }
  for (const n of nodes) {
    const tone = laneById.get(n.lane).tone;
    out.push(`<g class="n ${tone}${n.write ? ' write' : ''} ${n.status}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6"/>`      + `<text class="t" x="${n.x + 12}" y="${n.y + 23}">${esc(n.title)}</text><text class="s" x="${n.x + 12}" y="${n.y + 45}">${esc(n.sub)}</text>`
      + `<text class="st" x="${n.x + n.w - 10}" y="${n.y + 23}" text-anchor="end">${STATUS[n.status]}</text>`
      // Backlog number: diagonal tag centred on the top-left corner.
      + (n.bl ? `<g class="tag" transform="translate(${n.x} ${n.y}) rotate(-35)"><rect x="-30" y="-8" width="60" height="16" rx="3" style="fill:var(--${tone}-s)"/><text x="0" y="4" text-anchor="middle">${esc(n.bl)}</text></g>` : '')
      + (AGENT[n.agent] ? agentTag(n) : '')
      + '</g>');
  }
  out.push('</g></svg></div>', '<div class="notes">');
  out.push(...notes.map(n => `<div><b>${n.title}</b>${n.body}</div>`), '</div>');
  return { html: out.join('\n') + '\n', counts: { lanes: lanes.length, columns: columns.length, nodes: nodes.length, edges: edges.length, groups: groups.length } };
}

function selfTest() {
  const load = f => JSON.parse(readFileSync(join(HERE, '..', 'examples', f), 'utf8'));
  const { counts } = render(load('reference.json'));
  const want = { lanes: 5, columns: 9, nodes: 16, edges: 20, groups: 1 }; // counted in assets/reference.html
  if (JSON.stringify(counts) !== JSON.stringify(want)) fail(`self-test: counts ${JSON.stringify(counts)} != ${JSON.stringify(want)}`);
  let msg = '';
  try { render(load('crossing.json')); } catch (err) { msg = err.message; }
  if (!/crosses node\(s\) b/.test(msg)) fail(`self-test: crossing.json should fail on node b, got "${msg}"`);
  console.log('self-test ok: reference counts match, crossing edge rejected');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [a, b] = process.argv.slice(2);
  try {
    if (a === '--self-test') selfTest();
    else {
      if (!a || !b) fail('usage: node render.mjs <spec.json> <out.html> | --self-test');
      const { html, counts } = render(JSON.parse(readFileSync(a, 'utf8')));
      writeFileSync(b, html);
      console.log(`wrote ${b}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    }
  } catch (err) {
    console.error(`dag-swimlane: ${err.message}`);
    process.exit(1);
  }
}
