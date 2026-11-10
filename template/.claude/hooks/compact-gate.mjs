// PreCompact(auto): 코디네이터 워커만 — 도구 연쇄 중(transcript 마지막 메시지가 tool_result/tool_use)이고
// 컨텍스트 < 상한이면 자동 압축을 미룬다. 사전 압축을 막으면 Claude Code는 압축 없이 계속한다. 상한 아래에서만
// 막으므로 모델 한도 초과 복구용 압축(막으면 요청 실패)과 겹치지 않는다. 표식이 없거나 판단 실패면 통과(비차단).
// 창(하한)·상한·표식의 단일 출처 — 코디네이터 기동 스크립트가 여기서 import한다. 값은 프로젝트 실측으로 바꾼다.
import { closeSync, openSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COORDINATOR_ENV = 'HARNESS_COORDINATOR'; // 기동 `--settings` env에 "1"로 싣는 표식 이름
export const COORDINATOR_COMPACT_WINDOW = 350000; // 하한: 코디네이터 터미널의 CLAUDE_CODE_AUTO_COMPACT_WINDOW
export const COORDINATOR_COMPACT_CEILING = 500000; // 상한: 도구 연쇄 중이어도 이 이상이면 압축

// isMeta user 항목(스킬 본문 주입 등)은 도구 연쇄 중에도 끼어들 수 있어 마지막 메시지 판정에서 뺀다.
const messageEntry = (e) => (e?.type === 'user' || e?.type === 'assistant') && !e.isMeta && e.message;
const has = (e, type) => Array.isArray(e.message.content) && e.message.content.some((b) => b?.type === type);
// tool_result가 아직 transcript에 안 써졌으면 마지막 항목은 tool_use다 — 둘 다 도구 연쇄 중.
const toolChain = (e) => (e.type === 'user' && has(e, 'tool_result')) || (e.type === 'assistant' && has(e, 'tool_use'));
const usageTotal = (u) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

// 끝에서부터 마지막 메시지 항목과 마지막 assistant usage를 찾는다. 첫 줄 조각·깨진 줄은 건너뛴다.
export function scan(lines) {
  let last;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (!messageEntry(e)) continue;
    last ??= e;
    if (e.type === 'assistant' && e.message.usage) return { inToolChain: toolChain(last), context: usageTotal(e.message.usage) };
  }
  return null;
}

// transcript는 수십 MB가 될 수 있어 끝 조각부터 두 배씩 넓혀 읽는다.
export function readTail(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    for (let n = 1 << 20; ; n *= 2) {
      const len = Math.min(n, size);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const found = scan(buf.toString('utf8').split('\n'));
      if (found || len === size) return found;
    }
  } finally { closeSync(fd); }
}

export function decide(input, env, read = readTail) {
  if (env[COORDINATOR_ENV] !== '1' || input?.trigger !== 'auto' || !input.transcript_path) return null;
  const state = read(input.transcript_path);
  if (!state?.inToolChain || !(state.context < COORDINATOR_COMPACT_CEILING)) return null;
  return {
    decision: 'block',
    reason: `compact-gate: coordinator mid tool chain at ${state.context} < ${COORDINATOR_COMPACT_CEILING} tokens; compaction deferred to the next turn boundary`,
  };
}

// realpath on both sides: run through a junction or symlink, the gate must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const out = decide(JSON.parse(raw.replace(/^﻿/, '') || '{}'), process.env);
    if (out) console.log(JSON.stringify(out));
  } catch {} // 비차단 — 판단 실패는 통과
}
