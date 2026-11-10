import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./worker-intake-context.mjs', import.meta.url));
const run = (payload) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

// 워커 프리앰블이 있을 때만 주입, 깨진 입력은 무출력 통과
assert.equal(run({ prompt: '커밋 푸시' }), null);
const ctx = run({ prompt: 'You are working inside Orca. You are a dispatched worker.' }).hookSpecificOutput.additionalContext;
assert.match(ctx, /④ heartbeat는 .*독립 명령으로 보내지 않는다/);
assert.match(ctx, /⑤ .*가장 최근 프리앰블의 Task\/Dispatch ID로만/);
assert.match(ctx, /⑥ worker_done 직전 check를 건너뛰지 않는다/);
assert.match(ctx, /다시 보내지 말고 `orca orchestration inbox/);
assert.doesNotMatch(ctx, /60턴/, '턴 상한 줄은 두지 않는다(templates.md §7)');
{
  const r = spawnSync(process.execPath, [HOOK], { input: '{broken', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
}

console.log('worker-intake-context: 7 cases passed');
