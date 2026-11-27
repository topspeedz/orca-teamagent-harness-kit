# 공통 지침

Claude와 Codex가 함께 읽는 공통 규칙이다. 값, 표, 이력, 긴 예시는 여기에 두지 않고 가리키기만 한다.

## 명령

실제로 돌려 본 명령만 적는다.

전체 테스트 명령의 줄은 명령을 백틱으로 감싸 그 줄의 첫 백틱 안에 두고, 줄 끝에 (전체 테스트)를 붙인다. 기동 스크립트가 이 표시로 Task의 완료 기준에 든 전체 테스트를 찾아 등록을 거부한다.

- `node .claude/scripts/report-check.mjs <리포트 경로>` — 리포트의 `## 검증` 절 판정. 표준 출력 JSON의 `ok`를 본다.

## 기술 스택

<한 단락. 쓰지 않는 것도 적는다 — 에이전트가 도입하지 않게>

## 핵심 원칙

- 검증 명령으로 확인하지 않은 것은 완료라고 보고하지 않는다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.
- 워커는 사용자에게 직접 묻지 않고 `orca orchestration ask`로 올린다.
- 워커는 커밋하지 않는다.
- 승인이 필요한 명령을 훅이 거부하면 우회하지 않고 `orca orchestration ask`로 올린다.

## 하네스

**역할 계층.** 사용자 세션이 창구다. 창구는 설문과 승인, 요청 분류, PM 기획 세션과 코디네이터 기동, 최종 보고를 맡는다. 팀은 두지 않는다.

```
창구
├ product-manager     PM. 요구·백로그·설계·계획 (스킬)
└ 코디네이터
    ├ research        조사. 세션 안 서브에이전트로 나눠 조사
    ├ frontend        UX · UI · 개발 · 테스트 코드 (스킬)
    ├ backend         데이터베이스 · 백엔드 · 성능 · 보안 (스킬)
    ├ verifier        코드 리뷰 · QA(유닛 테스트, 브라우저 확인) (스킬)
    ├ doc-steward
    └ harness-engineer
```

`product-manager` 한 세션이 요구사항 정리부터 설계, 계획, 계획 대조까지 잇는다. 코디네이터는 창구가 띄운 별도 터미널에서 계획의 Task를 명단(`docs/harness/agents.md`)의 에이전트에게 직접 배정하고, 보고를 정산하고, 장부를 갱신한다. 코디네이터 아래의 에이전트는 모두 같은 층이고 워커를 띄우지 않는다. Orca 워커로 시작됐다면 spec의 첫 줄과 "먼저 읽을 것"대로 역할 파일을 읽고 그 역할로만 행동한다.

**규모별 경로.** 창구는 새 수행 요청마다 규모를 판단한다. 아래의 간단한 수행 요청 외에는 모두 작업 착수 전에 `plan-orchestrate`로 접수한다. 진행 중 요청의 범위가 달라지면 새 범위로 판단한다.

| 요청 | 경로 |
| --- | --- |
| 단순 설명 질문 | 창구가 답한다. |
| 간단한 수행 요청(예: BL 지정이 없는 한 파일의 작은 수정) | 매 요청마다 작업 전에 ask로 “plan-orchestrate 없이 제가 수행할까요?”라고 묻는다. 명시적으로 동의하면 해당 요청만 직접 수행하고 검증한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다. 직접 수행을 거절하면 plan-orchestrate로 접수하고, 답변 전에는 기다린다. |
| 지정 BL 또는 한 phase 위임 | 창구가 `plan-orchestrate`의 해당 접수 경로를 따른다. 지정 ID는 PM의 설계, 묶음 선정 위임은 PM의 묶음 선정부터 시작한다. |
| 승인된 계획의 Task | 코디네이터가 그 Task의 에이전트에게 직접 배정한다. 에이전트가 OFF면 배정 대기다. |
| 요구사항이 흐릿한 큰 작업 | 설문부터 시작하는 전체 흐름(`plan-orchestrate`)을 탄다. |

**작업별 라우팅.**

| 작업 | 먼저 볼 것 |
| --- | --- |
| 큰 작업 요청 | `plan-orchestrate` 스킬 |
| 실행 감독 | `coordinator` 스킬 |
| 요구사항 정리, 항목화, 우선순위 | `requirements-write`, `backlog-management`. 검토와 계획 대조는 `product-review` |
| 백로그 | `backlog-management` 스킬 |
| 모델 배정 | `docs/harness/model-selection.md` |
| 에이전트 명단 | `docs/harness/agents.md` |
| 제품 문서(요구사항, 설계, 계약, 테스트, 운영) | `docs/DOCUMENTATION_INDEX.md` |
| 에이전트와 스킬 추가 | 플러그인 스킬 `orca-teamagent-harness-kit:agent-author`, 작성 양식 `docs/harness/templates/` |

## Compact Instructions

자동 압축이나 `/compact` 요약에 반드시 남긴다:
- Run ID와 진행 중인 Dispatch ID
- 추적 중인 대기 작업
- 현재 단계
- 이번 세션의 사용자 결정 — 원문 그대로

## Codex 전용

- `.agents/skills/<이름>/SKILL.md`는 포인터다. 그 포인터가 가리키는 원본 `.claude/skills/<이름>/SKILL.md`를 읽는다.
