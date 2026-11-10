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
assert.match(ctx, /④ .*`status` 유형, 제목 `Re: Question`/);
assert.doesNotMatch(ctx, /heartbeat/, 'Orca 프리앰블이 heartbeat를 요구하지 않으므로 보내라는 줄을 두지 않는다');
assert.match(ctx, /⑤ .*가장 최근 프리앰블의 Task\/Dispatch ID로만/);
assert.match(ctx, /⑥ .*알림이 적어 준 `check` 명령을 그대로 한 번/);
assert.doesNotMatch(ctx, /check --terminal/, '핸들을 넣은 check를 시키지 않는다 — 워커가 부모의 핸들을 넣어 부모의 메일을 가져간다');
assert.match(ctx, /다시 보내지 말고 `orca orchestration inbox/);
assert.doesNotMatch(ctx, /60턴/, '턴 상한 줄은 두지 않는다(templates.md §7)');
{
  const r = spawnSync(process.execPath, [HOOK], { input: '{broken', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
}

console.log('worker-intake-context: 9 cases passed');
