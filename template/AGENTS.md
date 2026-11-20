# 공통 지침

Claude와 Codex가 함께 읽는 공통 규칙이다. 값, 표, 이력, 긴 예시는 여기에 두지 않고 가리키기만 한다.

## 명령

실제로 돌려 본 명령만 적는다.

- `node .claude/scripts/report-check.mjs <리포트 경로>` — 리포트의 `## 검증` 절 판정. 표준 출력 JSON의 `ok`를 본다.

## 기술 스택

<한 단락. 쓰지 않는 것도 적는다 — 에이전트가 도입하지 않게>

## 핵심 원칙

- 검증 명령으로 확인하지 않은 것은 완료라고 보고하지 않는다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.
- 워커는 사용자에게 직접 묻지 않고 `orca orchestration ask`로 올린다.
- 워커는 커밋하지 않는다.
- 승인이 필요한 명령을 훅이 거부하면 우회하지 않고 `orca orchestration ask`로 올린다.

## 하네스

**역할 계층.** 사용자 세션이 창구다. 창구는 설문과 승인, 요청 분류, 기획 팀과 코디네이터 기동, 최종 보고를 맡는다. 팀장 없는 운영팀의 `product-manager`가 PRD·SRS와 백로그를 쓰고 `planner`가 기술 설계·계획을 작성한다. 창구가 둘을 각각 기동하고 상대 산출물을 검토시킨다. 코디네이터는 창구가 띄운 별도 터미널에서 계획대로 워커를 띄우고, 보고를 정산하고, 장부를 갱신한다. 팀장은 팀 spec 하나를 팀원 Task로 나누고 감독한다. 계층은 코디네이터 아래 두 단까지이고, 팀원은 워커를 띄우지 않는다. Orca 워커로 시작됐다면 spec의 첫 줄과 "먼저 읽을 것"대로 역할 파일을 읽고 그 역할로만 행동한다.

**규모별 경로.**

| 요청 | 경로 |
| --- | --- |
| 단순 질문, BL 지정이 없는 한 파일의 작은 수정 | 창구가 직접 한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다. |
| 지정 BL 또는 한 phase 위임 | 창구가 `plan-orchestrate`의 해당 접수 경로를 따른다. 지정 ID는 Planner, 묶음 선정 위임은 PM부터 시작한다. |
| 승인된 실행 팀 배정 | 팀장 ON이고 단순 Task 1개면 직접 배정 가능하다. 2개 이상 또는 전문 분해 1개는 팀장 경유, 팀장 OFF는 팀 배정 대기다. |
| 요구사항이 흐릿한 큰 작업 | 설문부터 시작하는 전체 흐름(`plan-orchestrate`)을 탄다. |

**작업별 라우팅.**

| 작업 | 먼저 볼 것 |
| --- | --- |
| 큰 작업 요청 | `plan-orchestrate` 스킬 |
| 실행 감독 | `coordinator` 스킬 |
| 팀장으로 뜬 워커 | `team-lead` 스킬과 자기 팀 스킬 |
| 요구사항 정리, 항목화, 우선순위 | `prd-write`, `srs-write`, `backlog-management`. 상대 검토는 `product-review` |
| 백로그 | `backlog-management` 스킬 |
| 모델 배정 | `docs/harness/model-selection.md` |
| 팀 구성 | `docs/harness/team-org.md` |
| 제품 문서(요구사항, 설계, 계약, 테스트, 운영) | `docs/DOCUMENTATION_INDEX.md` |
| 팀과 에이전트 추가 | 플러그인 스킬 `orca-teamagent-harness-kit:agent-author`, 작성 양식 `docs/harness/templates/` |

## Compact Instructions

자동 압축이나 `/compact` 요약에 반드시 남긴다:
- Run ID와 진행 중인 Dispatch ID
- 추적 중인 대기 작업
- 현재 단계
- 이번 세션의 사용자 결정 — 원문 그대로

## Codex 전용

- `.agents/skills/<이름>/SKILL.md`는 포인터다. 그 포인터가 가리키는 원본 `.claude/skills/<이름>/SKILL.md`를 읽는다.
