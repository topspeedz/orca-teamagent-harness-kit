import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const scenarios = ['low', 'likely', 'high'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function render(d) {
  assert(Array.isArray(d.tasks) && d.tasks.length, 'tasks required');
  assert(Number.isInteger(d.maxWorkers) && d.maxWorkers > 0, 'maxWorkers required');
  const byId = new Map(d.tasks.map(t => [t.id,t]));
  assert.equal(byId.size,d.tasks.length,'duplicate ID');
  const checked = new Set(), visiting = new Set();
  function visit(t) {
    assert(!visiting.has(t.id),'dependency cycle');
    if(checked.has(t.id)) return;
    visiting.add(t.id);
    for(const id of t.deps){assert(byId.has(id),'unknown dependency '+id);visit(byId.get(id));}
    visiting.delete(t.id);checked.add(t.id);
  }
  for(const t of d.tasks){
    assert(/^[\w-]+$/.test(t.id),'unsafe ID');
    assert(['plan','dev','verify','coord','harness'].includes(t.tone),'invalid tone');
    assert(['wait','run','done','blocked'].includes(t.status),'invalid status');
    assert(['work','approval'].includes(t.kind),'invalid kind');
    visit(t);
    if(t.kind==='work') assert(t.estimate.low>=0 && t.estimate.low<=t.estimate.likely && t.estimate.likely<=t.estimate.high,'estimate order');
  }
  const summary={};
  for(const sc of scenarios){
    const events=[];let sum=0;
    for(const t of d.tasks){
      const {start,end}=t.schedule[sc], duration=t.kind==='approval'?0:t.estimate[sc];
      assert(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&Math.abs(end-start-duration)<1e-7,'invalid duration '+t.id);
      for(const id of t.deps) assert(start>=byId.get(id).schedule[sc].end,'dependency overlap '+t.id);
      sum+=duration;
      if(duration>0){events.push({time:start,delta:1,t},{time:end,delta:-1,t});}
    }
    let active=0,peak=0;const resources=new Set();
    for(const e of events.sort((a,b)=>a.time-b.time||a.delta-b.delta)){
      active+=e.delta;peak=Math.max(peak,active);
      if(e.t.resource){if(e.delta>0){assert(!resources.has(e.t.resource),'resource overlap');resources.add(e.t.resource);}else resources.delete(e.t.resource);}
    }
    assert(peak<=d.maxWorkers,'worker capacity exceeded');
    summary[sc]={end:Math.max(...d.tasks.map(t=>t.schedule[sc].end)),sum,peak};
  }
  const status={done:'✓ 완료',run:'▶ 진행',wait:'대기',blocked:'보류'};
  const row=(t,i,width,body)=>`<g class="row" data-id="${t.id}" tabindex="0" aria-label="${esc(t.title)}"><rect class="hit" y="${46+i*26}" width="${width}" height="26"/>${body}</g>`;
  function chart(sc){
    const tasks=[...d.tasks].sort((a,b)=>a.schedule[sc].start-b.schedule[sc].start), w=Math.ceil(summary[sc].end*1.3)+260,h=76+tasks.length*26;
    let grid='';for(let t=0;t<=summary[sc].end;t+=30){const x=8+t*1.3;grid+=`<line class="grid ${t%60?'':'major'}" x1="${x}" x2="${x}" y1="36" y2="${h-20}"/>${t%60?'':`<text class="tick" x="${x}" y="30">T+${t/60}h</text>`}`;}
    if(d.now!==undefined){assert(Number.isFinite(d.now)&&d.now>=0,'invalid now');const x=8+d.now*1.3;grid+=`<line class="now" x1="${x}" x2="${x}" y1="36" y2="${h-20}"/>`;}
    const labels=tasks.map((t,i)=>row(t,i,300,`<title>${esc(t.title)}</title><text class="rl" x="12" y="${63+i*26}">${esc((t.id+' · '+t.title).slice(0,27))}</text><text class="st" x="292" text-anchor="end" y="${63+i*26}">${status[t.status]}</text>`)).join('');
    const bars=tasks.map((t,i)=>{const x=8+t.schedule[sc].start*1.3,y=46+i*26,width=(t.schedule[sc].end-t.schedule[sc].start)*1.3;return row(t,i,w,t.kind==='approval'?`<rect class="appr" x="${x}" y="${y+4}" width="150" height="18"/><text class="bl" x="${x+6}" y="${y+17}">승인 대기 미정</text>`:`<line class="wh" x1="${x+t.estimate.low*1.3}" x2="${x+t.estimate.high*1.3}" y1="${y+13}" y2="${y+13}"/><rect class="bar t-${t.tone} ${t.status==='done'?'done':''}" x="${x}" y="${y+5}" width="${Math.max(2,width)}" height="16" rx="3"/><text class="bl" x="${x+width+6}" y="${y+17}">${t.id} ${t.estimate[sc]}분</text>`);}).join('');
    return `<section class="sc" data-sc="${sc}" ${sc==='likely'?'':'hidden'}><div class="frame"><svg class="lab" width="300" height="${h}">${labels}</svg><div class="scroll" tabindex="0" aria-label="시간축 가로 스크롤"><svg class="wf" role="img" aria-label="${sc} 예상시간 워터폴" width="${w}" height="${h}">${grid}${bars}</svg></div></div></section>`;
  }
  const css=fs.readFileSync(new URL('../assets/style.css',import.meta.url),'utf8');
  const table=d.tasks.map(t=>`<tr><td>${t.id}</td><td>${esc(t.bl)}</td><td>${esc(t.title)}</td><td>${esc(t.role)}</td><td>${t.deps.join(', ')}</td><td>${status[t.status]}</td><td>${t.kind==='approval'?'미정':scenarios.map(s=>t.estimate[s]).join(' / ')}</td><td>${esc(t.basis)}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><style>${css}\n.scroll{min-width:0}.row:focus{outline:none}.row:focus .hit{stroke:var(--now);stroke-width:1}button:focus-visible{outline:2px solid var(--now)}</style><main><h1>${esc(d.title)}</h1><p class="sub">${esc(d.estimatedAt)} · 예상시간이며 완료시각 보장이 아닙니다.</p><p>${esc(d.clock)}</p><p class="cur">${esc(d.current)}</p>${(d.assumptions||[]).map(s=>`<p class="sub">${esc(s)}</p>`).join('')}<h2>요약</h2><div class="tw"><table><tr><th>시나리오</th><th>작업 경과 (승인 대기 제외)</th><th>작업 시간 합</th><th>최대 동시</th></tr>${scenarios.map(sc=>`<tr><th>${sc}</th><td>${summary[sc].end}분</td><td>${summary[sc].sum}분</td><td>${summary[sc].peak}/${d.maxWorkers}</td></tr>`).join('')}</table></div><h2>워터폴</h2><div class="tabs">${scenarios.map(sc=>`<button data-sc="${sc}" aria-pressed="${sc==='likely'}">${sc}</button>`).join('')}</div><p class="sub">막대: 예상 소요 · 회색 선: low~high · 빨간 점선: 승인 대기 미정 · 행 선택: 선행 파랑 / 후행 주황</p>${scenarios.map(chart).join('')}<h2>작업 상세</h2><div class="tw"><table><tr>${['ID','BL','작업','담당','선행','상태','low / likely / high (분)','근거'].map(x=>`<th>${x}</th>`).join('')}</tr>${table}</table></div></main><script>
const deps=${JSON.stringify(Object.fromEntries(d.tasks.map(t=>[t.id,t.deps])))};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('.sc').forEach(x=>x.hidden=x.dataset.sc!==b.dataset.sc)});
function mark(id,on){document.querySelectorAll('.row').forEach(r=>{r.classList.toggle('hl',on&&r.dataset.id===id);r.classList.toggle('dep',on&&deps[id].includes(r.dataset.id));r.classList.toggle('kid',on&&deps[r.dataset.id].includes(id));});}
document.querySelectorAll('.row').forEach(r=>{['mouseenter','focus'].forEach(e=>r.addEventListener(e,()=>mark(r.dataset.id,true)));['mouseleave','blur'].forEach(e=>r.addEventListener(e,()=>mark(r.dataset.id,false)));});
</script></html>`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,output]=process.argv.slice(2);assert(input&&output,'Usage: node render.mjs input.json output.html');
  const html=render(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')));fs.writeFileSync(output,html);console.log(output);
}
