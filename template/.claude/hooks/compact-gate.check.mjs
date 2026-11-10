import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COORDINATOR_COMPACT_CEILING as CEIL, COORDINATOR_ENV } from './compact-gate.mjs';

const HOOK = fileURLToPath(new URL('./compact-gate.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'compact-gate-'));
const assistant = (tokens, content = [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]) => ({ type: 'assistant',
  message: { role: 'assistant', content, usage: { input_tokens: 10, cache_read_input_tokens: tokens - 110, cache_creation_input_tokens: 100, output_tokens: 5 } } });
const toolResult = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
const userText = { type: 'user', message: { role: 'user', content: 'next request' } };
const noise = { type: 'attachment', attachment: { type: 'hook_additional_context' } };
let n = 0;
const transcript = (entries) => {
  const file = join(dir, `t${n++}.jsonl`);
  writeFileSync(file, '{"broken\n' + entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
};
const run = (input, coordinator = true, hook = HOOK) => {
  const env = { ...process.env };
  delete env[COORDINATOR_ENV];
  if (coordinator) env[COORDINATOR_ENV] = '1';
  const r = spawnSync(process.execPath, [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};
const auto = (entries) => ({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: transcript(entries) });

try {
  // 코디네이터 + 도구 연쇄 중 + 상한 미만 → block (attachment 같은 비메시지 항목은 건너뛴다)
  assert.equal(run(auto([userText, assistant(CEIL - 1), toolResult, noise])).decision, 'block');
  // 도구 연쇄 중 끼어든 isMeta user 항목(스킬 본문 주입)은 마지막 메시지로 치지 않는다 → block
  assert.equal(run(auto([userText, assistant(CEIL - 1), toolResult, { ...userText, isMeta: true }])).decision, 'block');
  // tool_result가 아직 안 써진 상태(마지막 = assistant tool_use)도 도구 연쇄 중 → block
  assert.equal(run(auto([userText, assistant(CEIL - 1)])).decision, 'block');
  // 상한 이상 → 통과 (모델 한도 전에 압축)
  assert.equal(run(auto([userText, assistant(CEIL), toolResult])), null);
  // 사용자 차례(마지막 메시지가 사용자 글·assistant 끝 응답) → 통과
  assert.equal(run(auto([assistant(400000), toolResult, assistant(400000, [{ type: 'text', text: 'done' }]), userText])), null);
  assert.equal(run(auto([assistant(400000), toolResult, assistant(400000, [{ type: 'text', text: 'done' }])])), null);
  // 코디네이터가 아님 → 통과
  assert.equal(run(auto([userText, assistant(400000), toolResult]), false), null);
  // 수동 /compact → 통과
  assert.equal(run({ ...auto([userText, assistant(400000), toolResult]), trigger: 'manual' }), null);
  // 깨진 입력·없는 transcript·usage 없는 transcript → 통과
  assert.equal(run('{broken'), null);
  assert.equal(run({ trigger: 'auto', transcript_path: join(dir, 'missing.jsonl') }), null);
  assert.equal(run(auto([userText, toolResult])), null);
  let cases = 11;
  // FX-E: run through a junction or symlink to the hooks folder — the hook must still block, not exit 0 silently
  const link = join(dir, 'linked hooks');
  let linked = true;
  try { symlinkSync(dirname(HOOK), link, 'junction'); } catch (e) { linked = false; console.log(`건너뜀: 링크를 만들 수 없어 링크 경유 실행 사례를 돌리지 않음 (${e.code ?? e.message})`); }
  if (linked) {
    assert.equal(run(auto([userText, assistant(CEIL - 1), toolResult]), true, join(link, 'compact-gate.mjs'))?.decision, 'block');
    cases++;
  }
  console.log(`compact-gate.check: ${cases} cases passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
