import fs from 'node:fs';
import assert from 'node:assert/strict';
import './progress-check.mjs';
import {render} from './render.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../examples/example.json',import.meta.url),'utf8'));
assert(render(source).includes('140분'));
for(const [mutate,pattern] of [
  [d=>d.tasks[0].deps=['QA'],/cycle/],
  [d=>d.tasks[1].deps=['MISSING'],/unknown dependency/],
  [d=>d.maxWorkers=1,/capacity/],
  [d=>{d.tasks[1].resource='same';d.tasks[2].resource='same';},/resource overlap/],
  [d=>d.tasks[1].schedule.low.end=1,/duration/],
  [d=>{d.tasks[1].schedule.low={start:0,end:20};},/dependency overlap/],
]){const d=structuredClone(source);mutate(d);assert.throws(()=>render(d),pattern);}
const escaped=structuredClone(source);escaped.tasks[0].title='<script>alert(1)</script>';
assert(!render(escaped).includes('<script>alert(1)</script>'));
console.log('PASS: sample, cycles, missing dependencies, capacity, resources, durations, precedence, escaping');
// progress.mjs: real clock axis, now line, header end, validation.
const {renderProgress}=await import('./progress.mjs');
const prog=JSON.parse(fs.readFileSync(new URL('../examples/progress.json',import.meta.url),'utf8'));
const ph=renderProgress(prog);
assert(ph.includes('class="now"') && ph.includes('지금 11:40') && ph.includes('~13:00') && ph.includes('>09:00<') && ph.includes('10:22–12:00 · 1시간 38분'));
assert(renderProgress({...prog,now:undefined},Date.parse('2026-10-31T11:50+09:00')).includes('지금 11:50'));
const late=structuredClone(prog);late.tasks[5].end='2026-11-01T00:30+09:00';assert(renderProgress(late).includes('~11/1 00:30'));
for(const [mutate,pattern] of [
  [d=>d.tasks[0].lane='x',/lane/],
  [d=>d.tasks[0].start='2026-10-31T09:20',/offset/],
  [d=>d.tasks[0].end='2026-10-31T09:00+09:00',/end before start/],
  [d=>d.tasks[0].end='2026-10-31T12:00+09:00',/done task ends after now/],
  [d=>d.tasks[4].status='run',/running task starts after now/],
]){const d=structuredClone(prog);mutate(d);assert.throws(()=>renderProgress(d),pattern);}
const pe=structuredClone(prog);pe.tasks[0].title='<script>alert(1)</script>';assert(!renderProgress(pe).includes('<script>alert(1)</script>'));
const fin=structuredClone(prog);fin.tasks.forEach(t=>{t.status='done';if(Date.parse(t.end)>Date.parse(fin.now))t.end=fin.now;if(Date.parse(t.start)>Date.parse(t.end))t.start=t.end;});const fh=renderProgress(fin);
assert(!fh.includes('class="now"') && !fh.includes('class="nowlbl"') && fh.includes('종료 <b>11:40</b>') && fh.includes('lbl-l') && !fh.includes('>12:00<') && fh.includes('flex:1 1 auto') && !fh.includes('class="track" style="width:')); // finished track fills the page width
assert(ph.includes('class="uw"') && fh.includes('class="uw"')); // ✋ wait = vertical dashed band on every row
const px=structuredClone(prog);px.tasks.forEach(t=>t.title="K9 · "+t.title);assert(renderProgress(px).includes("class=\"uw\"")); // stage-prefixed ✋ titles count as waits
assert(ph.includes('uwait') && fh.includes('사용자 대기 15분') && fh.includes('= 작업 ')); // ✋ 설계 승인 10:05–10:20 = dashed, excluded from work time
console.log('PASS: progress clock axis, now line, finished run (no now line, axis ends at last end), day change, validation, escaping');
// from-orca.mjs: measured rows, ledger match, rework row, leader hold, approval states, scheduling → valid progress input.
const {fromOrca,ledgerMap}=await import('./from-orca.mjs');
const plan={...structuredClone(source),title:'예제'};plan.tasks.find(t=>t.id==='UI').bl='BL-0001';
const T=(id,spec,c,d)=>({id,spec,created_at:c,completed_at:d});
const orcaTasks=[
  T('task_a0','[역할: planner] 설계 등급: A','2026-10-31 00:00:00','2026-10-31T00:30:00Z'), // before the plan → own row
  T('task_a1','[역할: planner] 계약 확인 등급: A','2026-10-31 00:40:00','2026-10-31T01:00:00Z'), // no BL → ledger match
  T('task_a2','[역할: storefront-dev] UI · BL-0001 — 화면 등급: A','2026-10-31 01:05:00','2026-10-31T01:40:00Z'),
  T('task_a3','[역할: storefront-dev] UI-FIX · BL-0001 — 수정 등급: B','2026-10-31 01:45:00','2026-10-31T01:50:00Z'),
  T('task_a4','[역할: storefront-dev · 리드] 묶음 (BL-0001~0001) 등급: S','2026-10-31 01:02:00',null),
  {...T('task_a5','[역할: visual-analyst] 상주 등급: A','2026-10-31 01:10:00',null),status:'ready'}, // failed dispatch → no row
];
const fo=fromOrca({plan,orcaTasks,now:Date.parse('2026-10-31T02:00:00Z'),ledger:ledgerMap('| PLAN | — | planner | task_a1 / ctx_x |')});
const row=(re)=>fo.tasks.find(t=>re.test(t.title));
assert.equal(row(/^설계/).status,'done');
assert.equal(row(/^PLAN /).start,'2026-10-31T09:40+09:00');
assert.match(row(/^UI ↻ UI-FIX/).title,/수정/);
assert.equal(row(/리더$/).status,'run');
assert(row(/^DATA /).status==='wait' && Date.parse(row(/^DATA /).start)>=Date.parse('2026-10-31T02:00:00Z'));
assert(Date.parse(row(/^QA /).start)>=Date.parse(row(/리더$/).end),'QA waits for the running bundle report');
assert(row(/APPROVE|✋/).title.includes('미정'));
assert(!row(/상주/),'failed (ready, uncompleted) Task is not drawn as running');
renderProgress(fo); // must satisfy progress validation
const {merge}=await import('./merge.mjs');
const mg=merge([{stage:'K1',data:prog},{stage:'K2',data:prog}],{title:'all'});
assert(mg.tasks.length===prog.tasks.length*2 && mg.tasks[0].title.startsWith('K1 · ') && renderProgress(mg).includes('class="uw"'));
assert.throws(()=>merge([],{title:'x'}),/required/);
console.log('PASS: merge stage prefix, waits kept');
// No plan: measured rows only + patch.tasks (✋ gates, remaining estimates).
{const np=fromOrca({orcaTasks:[{id:'task_x',status:'completed',created_at:'2026-11-08 00:00:00',completed_at:'2026-11-08T00:10:00Z',spec:'[역할: docs-curator] 수집 A'}],now:Date.parse('2026-11-08T00:20:00Z'),title:'np',patch:{tasks:[{title:'✋ 승인',lane:'coord',status:'done',start:'2026-11-07T23:50+00:00',end:'2026-11-07T23:55+00:00'}]}});
assert(np.tasks.length===2 && np.tasks[0].title==='✋ 승인' && np.tasks[1].status==='done'); renderProgress(np);}
// Tasks registered all at once: start = latest dep completion (not created_at); member rows named from display_name.
{const t0='2026-11-08 00:00:00';const rs=fromOrca({orcaTasks:[
 {id:'task_a',status:'completed',created_at:t0,completed_at:'2026-11-08T00:10:00Z',deps:'[]',spec:'[역할: qa-inspector] A'},
 {id:'task_b',status:'completed',created_at:t0,completed_at:'2026-11-08T00:30:00Z',deps:'["task_a"]',spec:'[역할: qa-inspector] B'},
 {id:'task_c',parent_id:'task_b',status:'completed',created_at:'2026-11-08 00:12:00',completed_at:'2026-11-08T00:20:00Z',spec:'[역할: unity-gameplay-engineer]\nTask: B-1',display_name:'[unity-gameplay-engineer - B-1] 칩 고침 (BL-0001,BL-...'}],
 now:Date.parse('2026-11-08T00:40:00Z'),title:'rs'});
const row=(re)=>rs.tasks.find((t)=>re.test(t.title));
assert.equal(row(/^B \(/).start,'2026-11-08T09:10+09:00'); assert.equal(row(/^A \(/).start,'2026-11-08T09:00+09:00');
assert.equal(row(/B-1/).title,'B-1 칩 고침 (unity-gameplay-engineer)'); assert.equal(row(/B-1/).start,'2026-11-08T09:12+09:00'); renderProgress(rs);}
console.log('PASS: from-orca measured/ledger/rework/leader/approval/scheduling');
