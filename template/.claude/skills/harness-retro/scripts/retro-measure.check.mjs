// Self-test for retro-measure.mjs — no Orca or session logs needed. `node .claude/skills/harness-retro/scripts/retro-measure.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parallel, planned, actual, ledger, wakes, folderSize } from './retro-measure.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };

// A(10) → B(20), A → C(5), B,C → D(10). Critical path A-B-D = 40, sum 45.
const deps = { A: [], B: ['A'], C: ['A'], D: ['B', 'C'] };
const wf = {
  maxWorkers: 2,
  tasks: [
    { id: 'A', deps: [], kind: 'work', schedule: { likely: { start: 0, end: 10 } } },
    { id: 'B', deps: ['A'], kind: 'work', schedule: { likely: { start: 10, end: 30 } } },
    { id: 'C', deps: ['A'], kind: 'work', schedule: { likely: { start: 10, end: 15 } } },
    { id: 'W', deps: ['D'], kind: 'approval', schedule: { likely: { start: 40, end: 40 } } },
    { id: 'D', deps: ['B', 'C'], kind: 'work', schedule: { likely: { start: 30, end: 40 } } },
  ],
};

t('parallel: sum, critical path, ratio, max concurrent', () => {
  const r = parallel([
    { id: 'A', start: 0, end: 10 }, { id: 'B', start: 10, end: 30 },
    { id: 'C', start: 10, end: 15 }, { id: 'D', start: 30, end: 40 },
  ], deps);
  assert.deepEqual(r, { tasks: 4, sum: 45, critical: 40, ratio: 1.13, maxConcurrent: 2, elapsed: 40 });
});

t('parallel: touching intervals do not overlap', () => {
  assert.equal(parallel([{ id: 'A', start: 0, end: 10 }, { id: 'B', start: 10, end: 20 }], {}).maxConcurrent, 1);
});

t('planned: likely schedule, approval rows skipped', () => {
  const r = planned(wf);
  assert.equal(r.tasks, 4); assert.equal(r.sum, 45); assert.equal(r.critical, 40); assert.equal(r.maxConcurrent, 2);
  assert.equal(r.slots, 2);
});

const at = (m) => new Date(Date.UTC(2000, 0, 1, 0, m)).toISOString();
t('actual: ISO times to minutes, deps from waterfall', () => {

  const r = actual([
    { id: 'A', start: at(0), end: at(12) }, { id: 'B', start: at(12), end: at(42) },
    { id: 'C', start: at(13), end: at(20) }, { id: 'D', start: at(42), end: at(50) },
  ], wf);
  assert.equal(r.sum, 57); assert.equal(r.critical, 50); assert.equal(r.maxConcurrent, 2); assert.equal(r.elapsed, 50);
});

t('actual: unknown id or end before start throws', () => {
  assert.throws(() => actual([{ id: 'Z', start: at(0), end: at(1) }], wf), /Z/);
  assert.throws(() => actual([{ id: 'A', start: at(5), end: at(1) }], wf), /A/);
});

const LEDGER = `# 장부: x

예산: 구현 Task 3개 · 검증 Task 1개 · 수정 루프 1회 · 최대 2회

| Task | 에이전트 | 배정(요청과 적용) | 상태 | 재시도(원인) | 질문 | 리포트 경로 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | planner | 요청 a · 적용 a | 완료 | 0 | 없음 | r1 |
| T2 | qa-inspector | 요청 a · 적용 a | 완료 | 1 (리포트 검사 실패) | 1 | r2 |
| T3 | code-reviewer | 요청 a · 적용 a | 실패 | 2 (기동 실패) | 없음 | r3 |

## 결정

- 표 밖 산문 | 파이프가 있어도 표가 아니다
`;

t('ledger: loops, retries with causes, questions, failed', () => {
  assert.deepEqual(ledger(LEDGER), {
    fixLoops: 1, tasks: 3, retries: 3, failed: 1, questions: 1,
    causes: [{ task: 'T2', count: 1, cause: '리포트 검사 실패' }, { task: 'T3', count: 2, cause: '기동 실패' }],
  });
});

t('ledger: only the cap present → fixLoops null', () => {
  assert.equal(ledger('예산: 구현 Task 1개 · 검증 Task 1개 · 수정 루프 최대 2회\n').fixLoops, null);
});

const line = (o) => JSON.stringify(o);
const notice = (text) => line({ type: 'user', message: { content: text } });
const say = (id, content) => line({ type: 'assistant', message: { id, content, usage: { input_tokens: 1 } } });
const JSONL = [
  notice('You have 2 orchestration messages. Run `orca orchestration check`.'),
  say('m1', [{ type: 'text', text: '대기 중' }]),
  notice('You have 1 orchestration message.'),
  say('m2', [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'orca orchestration check' } }]),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] } }),
  say('m3', [{ type: 'text', text: '정산함' }]),
  notice('You have 1 orchestration message.'),
  say('m4', [{ type: 'text', text: 'a' }]),
  say('m4', [{ type: 'text', text: 'b' }]),
  line({ type: 'user', message: { content: [{ type: 'text', text: '사용자 지시' }] } }),
  say('m5', [{ type: 'tool_use', id: 'u2', name: 'Bash', input: { command: 'ls' } }]),
  '{broken',
].join('\n');

t('wakes: notice turns and tool-less wakes', () => {
  assert.deepEqual(wakes(JSONL), { wakes: 3, toolless: 2, orca: 1 });
});

t('wakes: content as text-block array is read', () => {
  const s = [line({ type: 'user', message: { content: [{ type: 'text', text: 'You have 3 orchestration messages' }] } }), say('x', [{ type: 'text', text: 'k' }])].join('\n');
  assert.deepEqual(wakes(s), { wakes: 1, toolless: 1, orca: 0 });
});

const root = mkdtempSync(join(tmpdir(), 'retro-measure-'));
mkdirSync(join(root, 'ws/a/b'), { recursive: true });
writeFileSync(join(root, 'ws/x.md'), '12345');
writeFileSync(join(root, 'ws/a/b/y.md'), '123');

t('folderSize: bytes and files, recursive', () => {
  assert.deepEqual(folderSize(join(root, 'ws')), { bytes: 8, files: 2 });
});

t('CLI: prints all sections, approximation note, missing inputs as 측정 불가', () => {
  writeFileSync(join(root, 'wf.json'), JSON.stringify(wf));
  writeFileSync(join(root, 'ledger.md'), LEDGER);
  const script = fileURLToPath(new URL('./retro-measure.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--waterfall', join(root, 'wf.json'), '--ledger', join(root, 'ledger.md'),
    '--workspace', join(root, 'ws'), '--sessions', join(root, 'none')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| 작업 시간 합 ÷ 임계 경로 \| 1\.13 \| 측정 불가/);
  assert.match(r.stdout, /수정 루프 \| 1/);
  assert.match(r.stdout, /T3 \| 2 \| 기동 실패/);
  assert.match(r.stdout, /heartbeat만 든 깸의 근사/);
  assert.match(r.stdout, /작업 폴더 \| 8 bytes · 2 files/);
});

console.log(`retro-measure.check: ${n} passed`);
