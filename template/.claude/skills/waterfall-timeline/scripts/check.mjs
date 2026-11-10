import fs from 'node:fs';
import assert from 'node:assert/strict';
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
