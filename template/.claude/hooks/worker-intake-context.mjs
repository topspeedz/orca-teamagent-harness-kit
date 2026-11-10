// UserPromptSubmit: 무인 워커 프롬프트에만 작업 방식 6줄을 붙인다 — 프로젝트 `.claude/hooks/`에 복사해 쓴다(templates.md §7).
// 왜 rules가 아니라 여기인가: 항상 로드되는 규칙은 세션 시작 주입물 수십 k 사이에 묻혀 워커가 따르지 않는다.
// 지시문 직후가 가장 잘 읽히는 자리다. 비용: 워커 세션 첫 프롬프트 1회 약 300토큰. 워커가 아닌 세션은 무출력.
// ④~⑥은 Orca 워커가 틀리기 쉬운 곳을 막는다:
//   ④ ask의 답은 일반 지시와 같은 status 유형으로 와서 워커가 답인 줄 모르고 계속 기다린다.
//     Orca 프리앰블이 heartbeat를 요구하지 않으므로 heartbeat를 보내라는 줄은 두지 않는다.
//   ⑤ 터미널 재사용 뒤 이전 dispatch ID로 worker_done 재전송(capability revoked).
//   ⑥ 대기를 걸지 않는 워커에게 실행 중 지시는 Orca 알림으로 온다(실측: 작업 중인 워커도 알림을 받고 그 `check`로 읽어 반영한다).
//     "worker_done 직전 `check --terminal <내 핸들>`" 줄은 두지 않는다 — 워커가 부모의 핸들을 넣어 부모(팀장)의 메일을 가져갔다.
//     + send 출력을 `| grep '"ok"' | head -1`로 버려 빈 출력 → worker_done 재전송.
// "60턴·200k를 넘기면 남은 범위를 적고 끝낸다"는 줄은 두지 않는다 — 그렇게 끝난 worker_done은 report-check에서 ❌로 failed가
// 되고, 남은 범위를 받는 흐름이 오케스트레이터에 없다. 크기는 spec 분해로 제어한다(templates.md §7).
// 워커 판별 문구는 오케스트레이터가 주입하는 프리앰블에 맞춘다 — 기본은 Orca("You are a dispatched worker"),
// 다른 런처면 환경변수 WORKER_PREAMBLE_REGEX로 바꾼다. ④~⑥의 Orca 명령 형태는 Orca 가이드와 어긋나면 여기를 고친다.
const MARK = new RegExp(process.env.WORKER_PREAMBLE_REGEX || 'You are a dispatched worker');
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let prompt = '';
try {
  prompt = JSON.parse(raw.replace(/^﻿/, '') || '{}').prompt || '';
} catch {
  process.exit(0); // 비차단 — 판단 실패는 통과
}
if (!MARK.test(prompt)) process.exit(0);
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: [
      '[워커 작업 방식 — 도구 1회가 컨텍스트 전체 재독이라 비용은 출력 크기가 아니라 턴 수다]',
      '① 서로 결과를 기다릴 필요 없는 조회(Read·Grep·Glob·상태 확인)는 한 메시지에 묶어 부른다. 같은 명령을 다시 돌리기 전에 앞 결과가 컨텍스트에 있는지 본다.',
      '② 파일 범위 읽기는 Read의 offset·limit, 검색은 Grep 도구를 쓴다.',
      '③ 스크린샷·20KB 넘는 통독·대량 로그는 서브에이전트(작은 모델)에 맡기고 결론만 받는다. 직접 봐야 하는 이미지는 결론을 적은 뒤 다시 참조하지 않는다.',
      '④ `ask`로 올린 질문의 답은 `status` 유형, 제목 `Re: Question`인 메시지로 온다(보낸 쪽은 Run으로 표시된다). 그 메시지가 답이다 — 다시 묻거나 더 기다리지 않는다.',
      '⑤ 이 터미널에 앞선 프리앰블이 있으면(재사용) 가장 최근 프리앰블의 Task/Dispatch ID로만 보낸다. 이전 ID는 정산됐다 — 그 ID로 worker_done을 다시 보내지 않는다.',
      '⑥ 작업 중에 "You have N orchestration message" 알림이 오면 알림이 적어 준 `check` 명령을 그대로 한 번 돌려 읽고, 지시가 있으면 반영·재검증한 뒤 이어 간다. 단, 대기 계약대로 백그라운드 대기를 걸어 두는 코디네이터와 팀장은 그 대기로 받으므로 알림의 `check`를 따로 돌리지 않는다. `check`에 `--terminal`이나 다른 핸들을 붙이지 않는다 — 남의 핸들로 돌리면 그쪽 메일을 가져가 버린다. worker_done send의 출력은 grep·head로 거르지 않는다 — 결과가 안 보여도 다시 보내지 말고 `orca orchestration inbox --limit 5 --json`으로 갔는지 확인한다.',
    ].join('\n'),
  },
}));
