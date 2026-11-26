#!/usr/bin/env node
// DAG swimlane spec (JSON) -> fixed-px SVG artifact page in the format of assets/reference.html. Node built-ins only.
// Usage: node render.mjs <spec.json> <out.html>   |   node render.mjs --self-test
// Exit 1 on invalid spec or when any edge passes through a node rectangle.
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const EFFORT = { low: 'L', medium: 'M', high: 'H', xhigh: 'XH', max: 'MAX', ultra: 'UL' };
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
  return `<g class="ag ${n.agent}"><title>${esc(`${a.name} · ${n.model ?? '?'} · effort ${n.effort ?? '?'}`)}</title><rect class="bg" x="${x}" y="${y}" width="${ef ? 50 : 22}" height="16" rx="3"/><text x="${x + 11}" y="${y + 12}" text-anchor="middle">${a.glyph}</text>${ef || n.routing ? `<text class="ef" x="${x + 34}" y="${y + 12}" text-anchor="middle">${ef}</text>` : ''}</g>`;
}

// Approval pick under a worker card (only when the spec has `choices`): complexity line, one Claude model/effort <select>,
// a codex checkbox with its substitution, and the recommendation's reason. A `fixed` node shows its value instead.
const pairOf = (model, effort) => (effort ? `${model}/${effort}` : model);
const axes = { C: '구조 복잡도', U: '불확실성', R: '실패 영향', V: '검증 난도', F: '누적 실패' };
const haikuLabels = { clear: '모호한 축 없음', 'same-route': '후보 배정이 같아 생략', classified: '경계 점수 판정', fallback: '호출 실패 · 기본 점수 사용' };
const scoreLine = r => Object.keys(axes).map(k => k + r.scores[k]).join(' ') + ' · E' + r.E;
function routingRows(r) {
  const { C, U, V, F } = r.scores;
  const rows = Object.entries(axes).map(([k, name]) => {
    const initial = r.input.scores[k], final = r.scores[k];
    const alternatives = (r.input.ambiguities ?? []).filter(a => a.axis === k).map(a => `대안 ${a.value} · ${a.evidence}`);
    return [`${k} ${name}`, [`${initial}점 · ${r.input.evidence[k]}`, ...alternatives, ...(alternatives.length ? [`최종 ${final}점`] : [])].join('\n')];
  });
  const rule = { haiku: 'C=0, R≤1, V=0, U≤1, F=0', fable: 'C=3, R=3', opus: 'C=3 또는 R=3 또는 C≥2이면서 R≥2', sonnet: 'Haiku·Fable·Opus 조건 밖' };
  rows.push(['Haiku 분류', [haikuLabels[r.haiku.status], r.haiku.reason].filter(Boolean).join(' · ')],
    ['모델 판정', r.claude.split('/')[0] + ' · ' + rule[r.claude.split('/')[0]]],
    ['effort 점수', `2×U(${U}) + V(${V}) + F(${F}) + ${C === 3 ? '2 (C=3)' : '0 (C<3)'} = ${r.E}`],
    ['라우터 추천', r.claude + ' → ' + AGENT[r.runtime].name + ' · ' + pairOf(r.model, r.effort)]);
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}
function pickForm(n, choices, id) {
  const open = `<div xmlns="http://www.w3.org/1999/xhtml" class="pick${n.fixed ? ' fixed' : ''}"`;
  if (n.fixed) return `${open}><div class="fx">${esc(pairOf(n.model, n.effort))} (고정)</div></div>`;
  const r = n.routing, defaultPair = r ? (r.mode === 'manual' ? n.base : '') : n.base;
  const mark = p => [p === n.base && '기준값', p === n.recommended && '추천'].filter(Boolean).join('·');
  const groups = Object.entries(choices.claude).map(([m, efforts]) => `<optgroup label="${r ? '직접 지정 · ' : ''}${esc(m)}">${(efforts.length ? efforts : [null]).map(e => {
    const p = pairOf(m, e), k = r ? (p === n.recommended ? '추천값 고정' : '') : mark(p);
    return `<option value="${esc(p)}"${p === defaultPair ? ' selected' : ''}>${esc(p)}${k ? ` (${k})` : ''}</option>`;
  }).join('')}</optgroup>`).join('');
  const codex = n.agent === 'codex';
  const attrs = `data-node="${esc(id)}" data-base="${esc(n.base)}" data-codex="${codex}"`;
  if (r) {
    return `${open} ${attrs} data-recommended="${esc(n.recommended)}"><div class="cplx">${esc(scoreLine(r))}</div>`
      + `<div>Haiku · ${esc(haikuLabels[r.haiku.status])}</div><div>추천 <b>${esc(n.recommended)}</b></div>`
      + `<select aria-label="${esc(n.title)} 배정" disabled=""><option value=""${defaultPair === '' ? ' selected' : ''}>추천 사용 · 기동 직전 재평가</option>${groups}</select>`
      + `<label><input type="checkbox"${codex ? ' checked=""' : ''} disabled=""/> ${Object.keys(choices.codex).length ? 'Codex로 실행' : 'Codex 치환표 없음'}</label><div class="cx"></div></div>`;
  }
  const cx = n.complexity != null ? `복잡도 ${n.complexity}${n.dims ? ` (${n.dims})` : ''}` : 'BL 없음 · 모델 표 값';
  const why = `추천 ${n.recommended}: ${n.why}`;
  return `${open} ${attrs}><div class="cplx">${esc(cx)}</div>`
    + `<select aria-label="${esc(`${n.title} 배정`)}" disabled="">${groups}</select>`
    + `<label><input type="checkbox"${codex ? ' checked=""' : ''} disabled=""/> codex <span class="cx">${codex ? esc(`→ ${choices.codex[n.base] ?? '?'}`) : ''}</span></label>`
    + `<div class="why" title="${esc(why)}">${esc(why)}</div></div>`;
}
const PICK_H = 160; // complexity (≤2 lines) + select + codex row (≤2 lines) + two lines of reason
// Page script: stored picks from db `choices/<nodeId>` are drawn, each change writes {model, effort, codex, at} once,
// changed cards turn yellow and the list of Tasks that differ from the base value updates. Without db the choices stay local.
const PICK_JS = `(async () => {
  const CX = __CX__, drawing = __DRAWING__, note = document.getElementById('pick-note'), list = document.getElementById('pick-diff');
  const picks = [...document.querySelectorAll('.pick[data-node]')], hasCodex = Object.keys(CX).length > 0;
  const download = document.getElementById('pick-download'), edits = new Map();
  const remember = (id, data) => {
    if (!download) return;
    edits.set(id, { id, data });
    download.disabled = false;
  };
  download?.addEventListener('click', () => {
    const href = URL.createObjectURL(new Blob([JSON.stringify([...edits.values()], null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = 'routing-choices.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  });
  const shown = (v, codex) => (codex ? CX[v] ?? '?' : v);
  const pair = (p, s) => s.value || p.dataset.recommended;
  const sync = () => {
    const diff = [];
    for (const p of picks) {
      const s = p.querySelector('select'), c = p.querySelector('input'), was = p.dataset.codex === 'true';
      const adaptive = !!p.dataset.recommended, manual = adaptive && s.value !== '';
      const chosen = shown(pair(p, s), c.checked);
      p.querySelector('.cx').textContent = adaptive ? (c.checked ? 'Codex · ' : 'Claude · ') + chosen : c.checked ? '→ ' + chosen : '';
      const changed = (adaptive ? manual : s.value !== p.dataset.base) || c.checked !== was;
      p.classList.toggle('changed', changed);
      const card = document.getElementById('n-' + p.dataset.node);
      card?.classList.toggle('changed', changed);
      if (adaptive && card) {
        const tag = card.querySelector('.ag'), effort = chosen.split('/')[1];
        tag.setAttribute('class', 'ag ' + (c.checked ? 'codex' : 'claude'));
        tag.querySelector('title').textContent = p.querySelector('.cx').textContent;
        tag.querySelector('text').textContent = c.checked ? '◎' : '✳';
        tag.querySelector('.ef').textContent = ${JSON.stringify(EFFORT)}[effort] || '';
        tag.querySelector('rect').setAttribute('width', effort ? 50 : 22);
      }
      const label = p.dataset.node;
      if (changed) diff.push(adaptive ? label + ' · ' + (manual ? '직접 지정' : '기동 재평가') + ' · ' + p.querySelector('.cx').textContent
        : label + ': ' + shown(p.dataset.base, was) + ' → ' + chosen);
    }
    list.replaceChildren(...(diff.length ? diff : ['없음']).map(t => Object.assign(document.createElement('li'), { textContent: t })));
  };
  const readOnly = msg => { note.textContent = msg; note.hidden = false; };
  sync();
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 10000));
  let db = await Promise.race([window.claude?.use ? window.claude.use('db').catch(() => null) : null, timeout]);
  if (!db) readOnly(download ? '자동 저장을 사용할 수 없습니다. 변경한 배정은 선택 파일로 저장하세요.' : '선택은 이 화면에만 표시되고 저장되지 않습니다.');
  try {
    const snap = db && await Promise.race([db.collection('choices').get(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000))]);
    for (const d of snap?.docs ?? []) {
      const p = picks.find(x => x.dataset.node === d.id), v = d.data();
      if (!p || !v?.model) continue;
      if (p.dataset.recommended && (v.drawing !== drawing || !['auto', 'manual'].includes(v.mode))) continue;
      if (p.dataset.recommended && v.codex && !hasCodex) continue;
      const s = p.querySelector('select'), want = v.effort ? v.model + '/' + v.effort : v.model;
      if (p.dataset.recommended && v.mode === 'auto') s.value = '';
      else if ([...s.options].some(o => o.value === want)) s.value = want;
      else continue;
      p.querySelector('input').checked = v.codex === true;
      if (p.dataset.recommended) remember(d.id, v);
    }
  } catch {
    if (!download) return readOnly('읽기 전용: 저장된 선택을 읽지 못했습니다. 새로 고침해 주세요.');
    db = null;
    readOnly('저장된 선택을 읽지 못했습니다. 이 화면에서 변경한 배정은 선택 파일로 저장하세요.');
  }
  sync();
  for (const p of picks) {
    const s = p.querySelector('select'), c = p.querySelector('input');
    let queue = Promise.resolve();
    const save = () => {
      sync();
      const [model, effort = null] = pair(p, s).split('/'), body = { model, effort, codex: c.checked, at: Date.now() };
      if (p.dataset.recommended) Object.assign(body, { mode: s.value ? 'manual' : 'auto', drawing });
      if (p.dataset.recommended) remember(p.dataset.node, body);
      if (!db) return;
      queue = queue.then(() => db.doc('choices/' + p.dataset.node).set(body)).catch(() => readOnly(download ? '자동 저장에 실패했습니다. 변경한 배정은 선택 파일로 저장하세요.' : '저장 실패: 이 화면에 쓰기 권한이 없거나 연결이 끊겼습니다.'));
    };
    s.addEventListener('change', save);
    c.addEventListener('change', save);
    s.disabled = false;
    c.disabled = !!p.dataset.recommended && !hasCodex;
  }
})();`;

function executionTime(node, record, now) {
  if (!record) return node.status === 'wait' ? '시작 전' : '기록 없음';
  const start = Date.parse(record.start);
  const running = !record.end && node.status === 'run' && (!record.status || ['run', 'running'].includes(record.status));
  const end = running ? now : Date.parse(record.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '기록 없음';
  const seconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const duration = [hours && hours + '시간', minutes && minutes + '분', (seconds % 60) + '초'].filter(Boolean).join(' ');
  return running ? duration + ' (진행 중 · 그림 생성 시점)' : duration;
}

export function render(input, actual = []) {
  const timings = new Map(actual.map(row => [row.id, row]));
  const now = Date.now();
  const executionTimes = input.nodes?.map(n => executionTime(n, timings.get(n.id), now));
  const spec = structuredClone(input);
  const { columns, lanes, nodes, edges = [], groups = [], notes = [] } = spec;
  const choices = spec.choices;
  if (choices && (typeof choices.claude !== 'object' || typeof choices.codex !== 'object')) fail('choices: { claude: {model: [efforts]}, codex: {"model/effort": "codex pair"} } required');
  const claudePairs = choices ? Object.entries(choices.claude).flatMap(([m, es]) => (es.length ? es.map(e => pairOf(m, e)) : [m])) : [];
  // Pick height joins the row pitch and lane bottom only when picks are drawn, so specs without `choices` render as before.
  const adaptive = spec.routingVersion === 2;
  const drawing = adaptive && createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const ph = choices ? (adaptive ? 180 : PICK_H) : 0;
  if (!spec.title || !columns?.length || !lanes?.length || !nodes?.length) fail('title, columns, lanes, nodes are required');
  lanes.forEach((l, i) => {
    l.tone ??= TONES[i % TONES.length];
    if (!TONES.includes(l.tone)) fail(`lane ${l.id}: tone must be one of ${TONES.join('|')}`);
  });
  if (!lanes.some(l => l.tone === 'harness')) fail('a harness lane (tone "harness") is required');
  if (notes.length < 3 || notes.length > 4) fail(`notes: 3-4 cards required, got ${notes.length}`);
  // Verification → fix rounds: label their edges, badge the fix/recheck cards, and list below who ran each round.
  const rounds = spec.rounds ?? [];
  const listOf = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const nodeIds = new Set(nodes.map(n => n.id));
  const roundOf = new Map();
  for (const r of rounds) {
    if (!Number.isInteger(r.n) || r.n < 1) fail('rounds: n must be a positive integer');
    if (!listOf(r.verify).length || !listOf(r.fix).length) fail(`rounds ${r.n}: verify and fix are required`);
    for (const id of [...listOf(r.verify), ...listOf(r.fix), ...listOf(r.recheck)]) if (!nodeIds.has(id)) fail(`rounds ${r.n}: unknown node ${id}`);
    for (const id of listOf(r.fix)) roundOf.set(id, `${r.n}회차`);
    for (const id of listOf(r.recheck)) roundOf.set(id, `${r.n}회차 재검`);
    for (const e of edges) {
      if (e.label) continue;
      if (listOf(r.verify).includes(e.from) && listOf(r.fix).includes(e.to)) e.label = `수정 ${r.n}회차`;
      else if (listOf(r.fix).includes(e.from) && listOf(r.recheck).includes(e.to)) e.label = `재검 ${r.n}회차`;
    }
  }

  const laneById = new Map(lanes.map(l => [l.id, l]));
  const ents = new Map();
  const autoRow = new Map();
  function preparePick(n, id) {
    if (n.fixed) return;
    const r = n.routing;
    if (adaptive && !r) fail(`node ${id}: routingVersion 2 requires routing on every nonfixed worker`);
    if (r) {
      if (!adaptive) fail(`node ${id}: routing requires routingVersion 2`);
      if (!r.scores || !r.input?.evidence || !r.input.scores || !AGENT[r.runtime] || !Object.hasOwn(haikuLabels, r.haiku?.status)) fail(`node ${id}: incomplete routing assessment`);
      if (r.mode !== undefined && !['auto', 'manual'].includes(r.mode)) fail(`node ${id}: routing.mode must be auto or manual`);
      if (choices && n.agent === 'codex' && !choices.codex?.[r.claude]) fail(`node ${id}: Codex approval requires a project substitution`);
      n.recommended ??= r.claude;
      if (n.recommended !== r.claude) fail(`node ${id}: recommended must match routing.claude`);
      n.base ??= r.claude;
    }
    if (!choices) return;
    n.base ??= pairOf(n.model, n.effort);
    if (!n.recommended || (!r && !n.why)) fail(`node ${id}: recommended and why are required on every pickable node (mark fixed ones "fixed": true)`);
    for (const k of ['base', 'recommended']) {
      if (!claudePairs.includes(n[k])) fail(`node ${id}: ${k} "${n[k]}" is not a Claude model/effort in choices.claude (codex nodes give it in Claude values)`);
    }
  }
  for (const n of nodes) {
    if (ents.has(n.id)) fail(`duplicate id ${n.id}`);
    if (!laneById.has(n.lane)) fail(`node ${n.id}: unknown lane ${n.lane}`);
    if (!Number.isInteger(n.col) || n.col < 0 || n.col >= columns.length) fail(`node ${n.id}: col out of range`);
    if (!STATUS[n.status]) fail(`node ${n.id}: status must be done|run|wait`);
    if (!n.title || !n.sub) fail(`node ${n.id}: title and sub are both required (2-line card)`);
    if (n.members) fail(`node ${n.id}: members는 없어졌습니다 — 작업마다 에이전트 하나에 직접 배정합니다`);
    const k = `${n.lane}/${n.col}`;
    const i = autoRow.get(k) ?? 0;
    autoRow.set(k, i + 1);
    n.row ??= i;
    n.pick = !!(choices && AGENT[n.agent]);
    if (AGENT[n.agent] && (choices || adaptive || n.routing)) preparePick(n, n.id);
    ents.set(n.id, n);
  }

  let y = 0;
  for (const l of lanes) {
    const roles = l.roles?.length ?? 0;
    const labelH = (roles ? 52 + 20 * (roles - 1) : 30) + 18;
    const own = nodes.filter(n => n.lane === l.id);
    const nodesH = own.length ? G.nodeTop + Math.max(...own.map(n => n.row)) * (G.pitch + ph) + G.nodeH + G.nodeBottom + ph : 0;
    Object.assign(l, { y, h: Math.max(labelH, nodesH) });
    y += l.h + G.laneGap;
  }
  const W = G.left + columns.length * G.colW + G.rightPad;
  const H = G.top + y - G.laneGap + G.bottomPad;

  for (const n of nodes) {
    Object.assign(n, { x: G.left + n.col * G.colW + G.nodeOff, y: laneById.get(n.lane).y + G.nodeTop + n.row * (G.pitch + ph),
      w: G.nodeW, h: G.nodeH });
    n.hb = n.h + (n.pick ? ph : 0); // card plus pick: what edges and group boxes must clear
  }
  for (const a of nodes) for (const b of nodes) {
    if (a !== b && a.lane === b.lane && a.col === b.col && a.row < b.row && b.y - a.y < a.hb + 8) {
      fail(`nodes ${a.id} and ${b.id} overlap (same lane/column, rows too close)`);
    }
  }

  for (const g of groups) {
    if (ents.has(g.id)) fail(`duplicate id ${g.id}`);
    const ms = g.nodes.map(id => ents.get(id) ?? fail(`group ${g.id}: unknown node ${id}`));
    const x0 = Math.min(...ms.map(m => m.x)) - G.grpPad, y0 = Math.min(...ms.map(m => m.y)) - G.grpPad;
    Object.assign(g, { groupNodes: ms, x: x0, y: y0, w: Math.max(...ms.map(m => m.x + m.w)) + G.grpPad - x0,
      h: Math.max(...ms.map(m => m.y + m.hb)) + G.grpPad - y0, colIn: Math.min(...ms.map(m => m.col)),
      colOut: Math.max(...ms.map(m => m.col)), tone: laneById.get(ms[0].lane).tone, right: [], leftPorts: [] });
    ents.set(g.id, g);
  }

  const ent = id => ents.get(id) ?? fail(`edge: unknown id ${id}`);
  for (const e of edges) {
    const f = ent(e.from), t = ent(e.to);
    if (f.groupNodes) f.right.push(e);
    if (t.groupNodes) (e.loop ? t.right : t.leftPorts).push(e);
  }
  // Groups spread their ports evenly along a side; nodes have one out point (right-center) and one in point (left-center).
  const portY = (g, side, e) => g.y + g.h * (g[side].indexOf(e) + 1) / (g[side].length + 1);
  const outPt = (o, e) => [o.x + o.w, o.groupNodes ? portY(o, 'right', e) : o.y + o.h / 2];
  const inPt = (o, e) => e.loop
    ? [o.x + o.w + 4, o.groupNodes ? portY(o, 'right', e) : o.y + o.h / 2]
    : [o.x - 2, o.groupNodes ? portY(o, 'leftPorts', e) : o.y + o.h / 2];
  const colIn = o => o.groupNodes ? o.colIn : o.col;
  const colOut = o => o.groupNodes ? o.colOut : o.col;

  function candidates(e, f, t) {
    const [ex, ey] = inPt(t, e);
    if (e.loop) {
      const bx = f.x + f.w / 2, by = ey > f.y ? f.y + (f.groupNodes ? f.h : f.hb) : f.y;
      return [{ poly: [[bx, by], [bx, ey], [ex, ey]] }];
    }
    const [sx, sy] = outPt(f, e);
    const dc = colIn(t) - colOut(f);
    if (dc < 1) fail(`edge ${e.from}->${e.to}: target must be in a later column (set "loop": true for a back edge)`);
    if (dc === 1) { const mx = (sx + ex) / 2; return [{ curve: [[sx, sy], [mx, sy], [mx, ey], [ex, ey]] }]; }
    if (e.merge) {
      const tx = t.x + t.w / 2, ty = t.y > sy ? t.y - 2 : t.y + (t.groupNodes ? t.h : t.hb) + 2;
      return [{ poly: [[sx, sy], [tx, sy], [tx, ty]] }];
    }
    // Distant edge: along the source row to the gap before the target, or along the target row from the gap after the source.
    const z = cx => ({ poly: [[sx, sy], [cx, sy], [cx, ey], [ex, ey]].filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]) });
    return [z(G.left + colIn(t) * G.colW), z(G.left + (colOut(f) + 1) * G.colW)];
  }

  const errors = [];
  const routes = edges.map(e => {
    const f = ent(e.from), t = ent(e.to);
    const skip = new Set([f, t].flatMap(o => o.groupNodes ? o.groupNodes.map(m => m.id) : [o.id]));
    const tried = candidates(e, f, t).map(r => ({ r, hit: nodes.filter(n => !skip.has(n.id) && samples(r)
      .some(([x, yy]) => x > n.x && x < n.x + n.w && yy > n.y && yy < n.y + n.hb)) }));
    const ok = tried.find(c => !c.hit.length);
    if (!ok) errors.push(`edge ${e.from}->${e.to} crosses node(s) ${[...new Set(tried.flatMap(c => c.hit.map(n => n.id)))].join(', ')}`);
    return { e, r: ok?.r ?? tried[0].r };
  });
  if (errors.length) fail(`${errors.join('\n')}\nmove rows/columns so the source or target row is empty between them`);

  const css = readFileSync(join(HERE, '..', 'assets', 'reference.html'), 'utf8').match(/<style>[\s\S]*?<\/style>/)[0].replace(/\r\n/g, '\n');
  const colX = i => G.left + i * G.colW;
  const out = [];
  out.push('<meta charset="utf-8">', `<title>${esc(spec.title)}</title>`, '<meta name="claude:viewport-fit-sides" content="cover">', css,
    '<style>.n .tag rect{stroke:none}.n .tag text{font:600 11px var(--sans);fill:var(--node)}.n .ag rect{stroke:none}.n .ag .bg{fill:var(--node);stroke:var(--line);stroke-width:1}.n .ag text{font:700 12px var(--sans)}.n .ag.claude text{fill:#d97757}.n .ag.codex text{fill:var(--fg)}.n .ag .ef{font:600 10px var(--sans);fill:var(--muted)}</style>');
  out.push(`<style>
.n{cursor:pointer}.n:focus-visible>rect{stroke:var(--fg);stroke-width:3}
.node-copy strong,.node-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node-copy strong{margin-right:48px;font:700 15px/22px var(--sans);color:var(--fg)}
.node-copy span{font:14px/20px var(--sans);color:var(--muted)}.write .node-copy span{color:var(--write)}
#node-preview,#node-dialog{box-sizing:border-box;background:var(--node);color:var(--fg);border:1px solid var(--line);border-radius:8px;box-shadow:0 5px 18px #0003;font:14px/1.45 var(--sans);overflow-wrap:anywhere}
#node-preview{position:fixed;z-index:2;width:max-content;min-width:min(190px,96vw);max-width:min(430px,96vw);max-height:96vh;overflow:auto;padding:8px 12px;text-align:left;cursor:pointer}
#node-preview strong,#node-preview span{display:block;white-space:pre-wrap}#node-preview span{color:var(--muted)}
#node-dialog{width:min(520px,94vw);max-height:85vh;padding:20px}#node-dialog::backdrop{background:#0005}
#node-dialog header{display:flex;align-items:start;justify-content:space-between;gap:16px}#node-dialog h2{margin:0;font-size:1.2rem}
#node-dialog button{color:inherit;background:var(--node);border:1px solid var(--line);border-radius:4px;padding:4px 10px;cursor:pointer;flex:none}
#node-dialog dl{display:grid;grid-template-columns:minmax(5em,auto) minmax(0,1fr);gap:8px 14px}#node-dialog dt{color:var(--muted)}#node-dialog dd{margin:0;white-space:pre-wrap}
</style>`);
  if (choices) out.push('<style>:root{--pick:#fff6d6;--pick-line:#d9a514}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--pick:#3a3218;--pick-line:#e2b43a}}:root[data-theme="dark"]{--pick:#3a3218;--pick-line:#e2b43a}'
    + '.pick{display:flex;flex-direction:column;gap:3px;padding:3px 4px;border-radius:6px;font:13px var(--sans);color:var(--muted)}.pick.changed{background:var(--pick)}.n.changed>rect{fill:var(--pick);stroke:var(--pick-line)}'
    + '.pick .cplx,.pick .cx,.pick .fx{font:12px var(--mono)}.pick .fx{font-size:13px;color:var(--fg);padding:4px 6px;border:1px dashed var(--line);border-radius:4px}'
    + '.pick select{width:100%;height:26px;font:13px var(--mono);color:var(--fg);background:var(--node);border:1px solid var(--line);border-radius:4px}.pick select:focus-visible,.pick input:focus-visible{outline:2px solid var(--pick-line);outline-offset:1px}'
    + '.pick label{display:flex;flex-wrap:wrap;align-items:center;gap:4px;color:var(--fg)}.pick .why{font-size:12px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.pick[data-recommended] .cx{overflow-wrap:anywhere;color:var(--fg)}.notes .pick b{display:inline}'
    + '.pick-diff{margin:0 0 12px;font-size:14px}.pick-diff ul{margin:4px 0 0;padding-left:18px;font:13px var(--mono)}</style>');
  out.push(`<h1>${esc(spec.heading ?? spec.title)}</h1>`);
  if (spec.sub) out.push(`<p class="sub">${spec.sub}</p>`);
  const sw = (border, bg, dash = '') => `<i class="sw" style="border-color:${border};background:${bg}${dash}"></i>`;
  out.push('<div class="legend">'
    + TONES.filter(t => lanes.some(l => l.tone === t)).map(t => `<span>${sw(`var(--${t}-s)`, `var(--${t})`)}${esc(TONE_MEANING[t])} (${esc(lanes.filter(l => l.tone === t).map(l => l.name).join(' · '))})</span>`).join('')
    + (nodes.some(n => AGENT[n.agent]) ? '<span><b style="color:#d97757">✳</b> Claude · <b>◎</b> Codex · 작은 글씨 = effort(L·M·H·XH·MAX·UL), 모델은 마우스 오버</span>' : '')
    + (choices ? (adaptive ? '<span>추천 사용은 기동 직전 재평가를 허용합니다. 조합을 직접 고르면 추천과 같은 값도 고정됩니다. 카드를 열어 점수 근거를 확인하세요.</span>' : '<span>카드 아래 선택 = Claude model/effort(기준값 = 복잡도 규칙, 추천 = product-manager 추천) · codex 체크 = Codex로 실행(→ 치환표 값)</span>') : '')
    + `<span>${sw('var(--done)', 'var(--node)')}완료 = 녹색 테두리</span><span>${sw('var(--muted)', 'var(--node)')}진행 = 레인 색 굵은 테두리</span><span>${sw('var(--muted)', 'var(--node)', ';border-style:dashed;opacity:.6')}대기 = 점선·흐림</span>`
    + '</div>');
  if (choices) out.push(`<p class="sub" id="pick-note" hidden></p><div class="pick-diff" aria-live="polite"><b>${adaptive ? '직접 지정 또는 런타임을 변경한 배정' : '기준값과 다른 Task (사용자 예외가 됨)'}</b><ul id="pick-diff"><li>없음</li></ul></div>`);
  if (choices && adaptive) out.push('<button type="button" id="pick-download" disabled>선택 파일 저장</button>');
  const aria = spec.aria ?? `열 순서: ${columns.join(' → ')}. 같은 열은 병렬.`;
  out.push(`<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px" role="group" aria-label="${esc(aria)}">`);
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
  for (const [index, n] of nodes.entries()) {
    const tone = laneById.get(n.lane).tone;
    out.push(`<g${n.pick ? ` id="n-${esc(n.id)}"` : ''} data-index="${index}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(n.title)} 상세 정보" class="n ${tone}${n.write ? ' write' : ''} ${n.status}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6"/>`
      + `<foreignObject x="${n.x+12}" y="${n.y+6}" width="${n.w-24}" height="42"><div xmlns="http://www.w3.org/1999/xhtml" class="node-copy"><strong>${esc(n.title)}</strong><span>${esc(n.sub)}</span></div></foreignObject>`
      + `<text class="st" x="${n.x + n.w - 10}" y="${n.y + 23}" text-anchor="end">${STATUS[n.status]}</text>`
      // Backlog number: diagonal tag centred on the top-left corner.
      + (n.bl ? `<g class="tag" transform="translate(${n.x} ${n.y}) rotate(-35)"><rect x="-30" y="-8" width="60" height="16" rx="3" style="fill:var(--${tone}-s)"/><text x="0" y="4" text-anchor="middle">${esc(n.bl)}</text></g>` : '')
      + (AGENT[n.agent] ? agentTag(n) : '')
      + (roundOf.has(n.id) ? `<g class="tag" transform="translate(${n.x + 8} ${n.y + n.h})"><rect x="0" y="-8" width="64" height="16" rx="3" style="fill:var(--verify-s)"/><text x="32" y="4" text-anchor="middle">${esc(roundOf.get(n.id))}</text></g>` : '')
      + '</g>'
      // outside the card group, so a waiting card's dimming does not dim the pick
      + (n.pick ? `<foreignObject x="${n.x}" y="${n.y + n.h + 12}" width="${n.w}" height="${ph - 12}">${pickForm(n, choices, n.id)}</foreignObject>` : ''));
  }
  out.push('</g></svg></div>');
  // Rounds go into each card's hover preview (node-data `hover`), not below the figure.
  const pairText = x => [x.agent, [x.model, x.effort].filter(Boolean).join('/')].filter(Boolean).join(' ') || '배정 없음';
  const byNode = new Map(nodes.map(n => [n.id, n]));
  const fixCompare = rounds.length > 1 ? (() => {
    const pairs = rounds.map(r => `${r.n}회차 ${listOf(r.fix).map(id => pairText(byNode.get(id))).join(', ')}`);
    const same = new Set(rounds.flatMap(r => listOf(r.fix).map(id => pairText(byNode.get(id))))).size === 1;
    return `수정 배정 비교: ${pairs.join(' · ')} — ${same ? '모든 회차가 같다' : '회차마다 다르다'}`;
  })() : null;
  const hover = nodes.map(n => {
    const lines = [];
    for (const r of rounds) {
      const as = [['검증', r.verify], ['수정', r.fix], ['재검', r.recheck]].filter(([, v]) => listOf(v).includes(n.id)).map(([k]) => k);
      if (!as.length) continue;
      lines.push(`${r.n}회차 ${as.join('·')}${r.title ? ' · ' + r.title : ''} — ${pairText(n)}`);
      if (r.note && as.includes('수정')) lines.push(r.note);
      if (fixCompare && as.includes('수정')) lines.push(fixCompare);
    }
    return lines;
  });
  out.push('<div class="notes">');
  out.push(...notes.map(n => `<div><b>${n.title}</b>${n.body}</div>`), '</div>');
  for (const [i, n] of nodes.entries()) if (n.routing && !n.fixed) out.push(`<template id="routing-${i}">${routingRows(n.routing)}</template>`);
  out.push('<button id="node-preview" type="button" tabindex="-1" hidden><strong></strong><span></span></button>',
    '<dialog id="node-dialog" aria-labelledby="node-heading"><header><h2 id="node-heading"></h2><button type="button" autofocus>닫기</button></header><dl></dl></dialog>',
    `<script type="application/json" id="node-data">${JSON.stringify({ nodes: input.nodes, executionTimes, edges: input.edges, groups: input.groups, lanes: input.lanes, columns, ...(hover.some(l => l.length) ? { hover } : {}) }).replaceAll('<', '\\u003c')}</script>`,
    `<script>${readFileSync(join(HERE, 'node-details.js'), 'utf8').replace(/\r\n/g, '\n')}</script>`);
  // '<' escaped so no value can close the script
  if (choices) out.push(`<script>${PICK_JS.replace('__DRAWING__', () => JSON.stringify(drawing)).replace('__CX__', () => JSON.stringify(choices.codex).replaceAll('<', '\\u003c'))}</script>`);
  return { html: out.join('\n') + '\n', counts: { lanes: lanes.length, columns: columns.length, nodes: nodes.length, edges: edges.length, groups: groups.length } };
}

function selfTest() {
  const started = { start: '2026-11-22T09:41:03Z' };
  const end = '2026-11-22T09:43:18Z';
  if (executionTime({ status: 'done' }, { ...started, end }) !== '2분 15초' ||
      executionTime({ status: 'run' }, started, Date.parse(end)) !== '2분 15초 (진행 중 · 그림 생성 시점)' ||
      executionTime({ status: 'done' }, started) !== '기록 없음' || executionTime({ status: 'wait' }) !== '시작 전') fail('execution time mismatch');
  const load = f => JSON.parse(readFileSync(join(HERE, '..', 'examples', f), 'utf8'));
  const { counts } = render(load('reference.json'));
  const want = { lanes: 5, columns: 9, nodes: 16, edges: 20, groups: 1 }; // counted in assets/reference.html
  if (JSON.stringify(counts) !== JSON.stringify(want)) fail(`self-test: counts ${JSON.stringify(counts)} != ${JSON.stringify(want)}`);
  let msg = '';
  try { render(load('crossing.json')); } catch (err) { msg = err.message; }
  if (!/crosses node\(s\) b/.test(msg)) fail(`self-test: crossing.json should fail on node b, got "${msg}"`);
  const review = load('reference.json');
  const gate = review.nodes.find(n => n.id === 'pm');
  Object.assign(gate, { kind: 'approval', title: '실행 승인', agent: null, model: null, effort: null });
  const page = render(review).html;
  if (!page.includes('실행 승인')) fail('self-test: approval gate missing');
  const withMembers = structuredClone(review);
  withMembers.nodes.find(n => n.id === 't1').members = [{ role: 'verifier', unit: '점검', agent: 'claude', model: 'opus', effort: 'high' }];
  let mmsg = ''; try { render(withMembers); } catch (err) { mmsg = err.message; }
  if (!/members는 없어졌습니다/.test(mmsg)) fail(`self-test: a node with members should fail, got "${mmsg}"`);
  if (render(load('reference.json')).html !== readFileSync(join(HERE, '..', 'assets', 'reference.html'), 'utf8').replace(/\r\n/g, '\n')) fail('reference output changed');
  // With `choices`: one pick per worker node, marks on the base/recommended options, codex box from the runtime.
  const pick = load('choices.json'), html = render(pick).html;
  const has = (re, what) => { if (!re.test(html)) fail(`self-test: choices.json — ${what}`); };
  if ((html.match(/<select /g) ?? []).length !== pick.nodes.filter(n => n.agent && !n.fixed).length) fail('self-test: choices.json — one select per worker node that is not fixed');
  has(/<div class="fx">opus\/high \(고정\)<\/div>/, 'fixed node → value with (고정), no select');
  has(/<div class="cplx">복잡도 5 \(기술 5 · 도메인 3 · 불확실성 3\)<\/div>/, 'complexity line with three dimensions');
  has(/<div class="cplx">BL 없음 · 모델 표 값<\/div>/, 'node without complexity → table value line');
  has(/<div class="why"[^>]*>추천 opus\/medium: 흐름이 길어/, 'reason line');
  has(/id="pick-diff"/, 'list of Tasks that differ from the base value');
  has(/<option value="opus\/high" selected>opus\/high \(기준값·추천\)<\/option>/, 'base = recommended → (기준값·추천), selected');
  has(/<option value="sonnet\/high" selected>sonnet\/high \(기준값\)<\/option>/, 'base → (기준값), selected');
  has(/<option value="opus\/medium">opus\/medium \(추천\)<\/option>/, 'recommended → (추천)');
  has(/<option value="haiku">haiku<\/option>/, 'model without effort → one option');
  has(/data-node="t2" data-base="fable\/high" data-codex="true">.*checked="".*→ gpt-6\.2-astra\/xhigh/, 'codex node → box checked and substitution shown');
  has(/data-node="t1"[^>]*>(?:(?!data-node).)*<input type="checkbox" disabled=""\/>/, 'claude node → box unchecked');
  has(/<script>.*claude\.use\('db'\).*codex: c\.checked, at: Date\.now\(\)/s, 'db script writes {model, effort, codex, at}');
  let bad = '';
  try { render({ ...pick, nodes: pick.nodes.map(n => (n.id === 't2' ? { ...n, base: undefined } : n)) }); } catch (err) { bad = err.message; }
  if (!/t2: base "gpt-6\.2-astra\/xhigh"/.test(bad)) fail(`self-test: codex node without a Claude base should fail, got "${bad}"`);
  bad = '';
  try { render({ ...pick, nodes: pick.nodes.map(n => (n.id === 'qa' ? { ...n, recommended: undefined } : n)) }); } catch (err) { bad = err.message; }
  if (!/qa: recommended and why are required/.test(bad)) fail(`self-test: a pickable node without a recommendation should fail, got "${bad}"`);
  const v2 = structuredClone(pick);
  v2.routingVersion = 2;
  const scores = { C: 2, U: 2, R: 2, V: 2, F: 0 };
  const evidence = { C: '공통 계약', U: '두 가설', R: '공유 데이터', V: '통합 확인', F: '최초 시도' };
  for (const n of v2.nodes.filter(n => n.agent && !n.fixed)) {
    const [model, effort] = (n.agent === 'codex' ? v2.choices.codex['opus/high'] : 'opus/high').split('/');
    Object.assign(n, { model, effort, base: 'opus/high', recommended: 'opus/high', routing: {
      input: { scores: { ...scores, U: 1 }, evidence, ambiguities: [{ axis: 'U', value: 2, evidence: '<대안 비교>' }] },
      scores, E: 6, claude: 'opus/high', runtime: n.agent, model, effort, haiku: { status: 'classified', scores: { U: 2 }, reason: '대안 둘을 검증한다.' },
    } });
  }
  v2.nodes.find(n => n.id === 't1').routing.mode = 'manual';
  const adaptivePage = render(v2).html;
  for (const expected of ['C2 U2 R2 V2 F0 · E6', 'Haiku · 경계 점수 판정', '&lt;대안 비교&gt;', '대안 둘을 검증한다.', '2×U(2) + V(2) + F(0) + 0 (C&lt;3) = 6',
    'value="opus/high" selected>opus/high (추천값 고정)', 'value="" selected>추천 사용']) {
    if (!adaptivePage.includes(expected)) fail('self-test: v2 approval missing ' + expected);
  }
  const claudeOnly = structuredClone(v2);
  claudeOnly.choices.codex = {};
  const codexNode = claudeOnly.nodes.find(n => n.agent === 'codex');
  Object.assign(codexNode, { agent: 'claude', model: 'opus', effort: 'high' });
  Object.assign(codexNode.routing, { runtime: 'claude', model: 'opus', effort: 'high' });
  if (!render(claudeOnly).html.includes('Codex 치환표 없음')) fail('self-test: Claude approvals without a Codex table');
  // rounds: edge labels, card badges and the per-round assignment section.
  const rs = load('reference.json');
  rs.rounds = [{ n: 1, verify: 'pm', fix: 't1', recheck: 't3' }, { n: 2, verify: ['t2'], fix: 't5' }];
  const rh = render(rs).html;
  for (const v of ['>수정 1회차<', '>재검 1회차<', '>수정 2회차<', '>1회차<', '>1회차 재검<', '"1회차 검증 — claude opus/medium"',
    '수정 배정 비교: ', '회차마다 다르다']) if (!rh.includes(v)) fail(`self-test: rounds missing ${v}`);
  let rmsg = ''; try { render({ ...rs, rounds: [{ n: 1, verify: 'nope', fix: 't1' }] }); } catch (err) { rmsg = err.message; }
  if (!/unknown node nope/.test(rmsg)) fail('self-test: rounds should reject unknown node');
  console.log('self-test ok: reference counts match, crossing edge rejected, output without choices unchanged, choices picks and marks drawn, rounds labelled and listed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [a, b] = process.argv.slice(2);
  try {
    if (a === '--self-test') selfTest();
    else {
      if (!a || !b) fail('usage: node render.mjs <spec.json> <out.html> | --self-test');
      const timesPath = join(dirname(a), 'actual.json');
      const actual = existsSync(timesPath) ? JSON.parse(readFileSync(timesPath, 'utf8').replace(/^\uFEFF/, '')) : [];
      const { html, counts } = render(JSON.parse(readFileSync(a, 'utf8')), actual);
      writeFileSync(b, html);
      console.log(`wrote ${b}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    }
  } catch (err) {
    console.error(`dag-swimlane: ${err.message}`);
    process.exit(1);
  }
}
