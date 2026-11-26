# 인계: 지식 단위 에이전트 구현 (키트 0.6.0)

2026-11-26에 설계와 계획을 끝낸 세션이 남긴 메모다. 이 세션은 계획을 실행한다. 설계를 다시 하지 않는다.

## 할 일

`docs/superpowers/plans/2026-11-26-knowledge-unit-agents.md`의 Task 1~10을 순서대로 실행한다.

- 실행 방식: `superpowers:subagent-driven-development`. Task마다 새 에이전트가 구현하고 다른 에이전트가 검토한 뒤 다음으로 넘어간다. 끝에 브랜치 전체를 한 번 더 검토한다.
- 먼저 읽을 것: 계획 전체, 그리고 설계서 `docs/superpowers/specs/2026-11-26-knowledge-unit-agents-design.md`. 계획은 설계서를 근거로 삼으므로 둘을 함께 본다.
- 순서: Task 1이 맨 앞이다. Task 2와 3은 같은 파일(`orca-launch.mjs`)을 고치므로 차례로 한다. Task 10이 맨 뒤다.

## 지금 상태

- 작업 폴더: `D:/Projects/orca-teamagent-harness-kit-wt060`. 키트 저장소(`D:/Projects/orca-teamagent-harness-kit`)의 git 워크트리다.
- 브랜치: `redesign/knowledge-unit-agents`. `origin/main`(48b23d4, 0.5.1)에서 갈라졌다.
- 키트 코드는 아직 한 줄도 고치지 않았다.
- 커밋되지 않은 파일 셋: 설계서, 계획, 이 메모. 첫 커밋으로 `docs: design and plan for knowledge-unit agents`를 만든 뒤 Task 1을 시작한다.

## 지킬 것

- Task마다 이 브랜치에 커밋한다. **푸시, PR, 플러그인 갱신은 하지 않는다.** Task 10까지 끝나면 결과를 사용자에게 보고하고 확인을 받는다.
- 사용자에게는 한국어로 답한다. 코드, 식별자, 커밋 메시지는 영어다.
- 이미 정해진 것을 다시 묻지 않는다. 설계서 9절(사용자가 정한 것)과 10절(작성자가 정한 것), 계획 끝의 "이 계획이 정한 것"이 결정 목록이다. 거기에 없는 선택이 생기면 추천 하나와 함께 묻는다.
- 스크립트와 훅은 Node 내장 모듈만 쓴다. 고친 스크립트마다 같은 폴더의 `*.check.mjs`가 그 동작을 시험한다.
- 옛 명단(`team-org.md`)을 같이 읽는 호환 코드를 두지 않는다. 사용자는 이 키트를 혼자 쓰고, 모든 프로젝트를 새 구조로 옮긴다.
- 다른 저장소는 건드리지 않는다. `D:/DRLOMILOMI/DRLOMILOMI-Shopify`는 키트를 낸 뒤 따로 옮긴다.

## 실행하면서 조심할 것

1. **`orca-launch.check.mjs`의 두 구간은 낱말 검색으로만 봤다.** `:420-540`과 `:660-940`이다. Task 2에서 팀장 경로를 지운 뒤 그 구간에 `lead`, `parent`, `members`, `direct`, `리드`를 쓰는 도우미나 픽스처가 남았는지 직접 읽는다. 계획에 적은 줄 번호는 조사 시점의 값이라 고치는 동안 밀린다. 줄 번호가 아니라 함수 이름과 문구로 찾는다.
2. **병렬 규칙은 지우지 않는다.** `coordinator`의 `## 워커 기동`(등록, `launchable --slots`, 당기기, 폭)과 `parallel-rules.md`, 계획서의 병렬도 수치, 회고의 병렬 지표다. 팀을 말하는 곳만 "같은 에이전트의 동시 워커는 4명 이하"로 고친다(Task 6).
3. **검증 수렴 규칙은 한 글자도 줄이지 않는다.** 결함 ID 없는 수정 Task의 거부, `skip`, `수정 diff:`, 라운드 상한, 최종 테스트다(설계서 3.9). 그것을 시험하는 경우는 역할 이름만 바꾼다.
4. **승인 기록의 해시가 달라진다.** Task 2에서 승인 행의 `members`를 없애면 0.5.1에서 승인받은 phase는 이어 가지 못한다. 호환 코드를 두지 않고 Task 10의 올리기 안내에 적는다.
5. **구조도의 화면 검사는 Python Playwright와 Chromium이 필요하다**(Task 9). 없으면 돌리지 못했다고 적고 넘어가지 말고, 환경을 갖춘 뒤 돌린다.
6. **역할 파일의 문서 책임 표에는 설치 직후 실제로 있는 문서만 적는다.** 없는 경로를 적으면 역할 검사기가 떨어진다(Task 1).
7. **구조도에서 옛 양식의 역할 본문을 읽는 줄은 지우지 않는다**(`team.mjs`의 옛 "정본 소유", "협업" 줄을 읽는 부분). 창고의 다른 키트가 쓴다.

## 끝났을 때 보고할 것

- Task별 커밋 해시와 그 Task의 검증 명령 결과.
- 계획과 다르게 한 곳과 그 이유.
- Task 10의 네 가지 결과: 전체 셀프테스트, 빈 프로젝트 설치, 0.5.1에서 올리기, 금지어 검색.
- 돌리지 못한 검사.
- 그 뒤의 일(사용자 확인을 받고 한다): PR과 머지, 플러그인 갱신(Claude와 Codex), 프로젝트마다 setup 재실행과 `agent-author`의 "옮기기".

## 배경 한 줄

역할을 직함대로 잘게 나눈 에이전트와 팀장 계층을 걷어내고, 지식이 공유돼야 하는 단위마다 에이전트 하나(`product-manager`, `research`, `frontend`, `backend`, `verifier`, `doc-steward`, `harness-engineer`)를 둔다. 전문성은 스킬로 준다. 근거는 Anthropic의 2026-10-22 글 "When to fold subagents into your main agent loop"이고 설계서 2절에 출처가 있다.
