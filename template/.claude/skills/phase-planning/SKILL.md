---
name: phase-planning
description: "phase의 일을 Task로 나누고 계획서의 DAG 절을 쓰는 지식. planner가 설계서와 계획서를 쓸 때, 팀장이 팀 안에서 Task를 나눌 때 로드한다. '작업 나눠줘', 'DAG 짜줘', '병렬로 돌릴 수 있게 계획', '임계 경로', '분할선'. 계획부터 실행까지의 단계 진행(plan-orchestrate), 워커 기동과 감독(coordinator, team-lead)에는 쓰지 않는다."
---

# phase-planning

작업을 Task로 나누는 지식의 정본이다. planner와 팀장이 같은 두 문서를 읽는다. 다른 스킬은 이 규칙을 옮겨 적지 않고 이 스킬을 가리킨다.

## 언제 무엇을 읽나

| 시점 | 읽을 문서 | 거기서 정하는 것 |
| --- | --- | --- |
| 설계에서 팀과 흐름의 모양을 고를 때 | [references/workflow-patterns.md](references/workflow-patterns.md) | 어느 패턴으로 일을 잇고 나눌지, 어느 팀을 띄울지 |
| 계획에서 Task를 나누고 의존을 적을 때 | [references/parallel-rules.md](references/parallel-rules.md) | 의존, 산출물, 예상 시간, 분할선, 합치기와 나누기 |
| 계획 승인을 받기 전 | [references/parallel-rules.md](references/parallel-rules.md) | 임계 경로와 병렬도 수치가 규칙에 맞는지 |
| 팀장이 팀 안의 Task를 나눌 때 | 두 문서 모두 | 팀원 Task의 의존과 폭. 한 팀 동시 4명 이하 |
| Task에 배정을 붙일 때 | `docs/harness/model-selection.md` | 에이전트와 작업 단위 |

## 배정

- Task마다 에이전트와 모델 표의 작업 단위만 붙인다. model과 effort를 직접 고르지 않는다.
- 표의 값은 조회해서 적는다: `node .claude/scripts/model-selection.mjs lookup --agent <에이전트> --unit <작업 단위>`.
- 표에 맞는 작업 단위가 없으면 임의로 정하지 않고 계획서 끝의 `## 사용자 결정 필요`에 추천 하나와 함께 올린다.
- spec에는 한 줄로 옮긴다: `배정: <에이전트> / <작업 단위> (<런타임> <model>/<effort>)`.

## 계획서의 `## DAG` 절 형식

Task마다 아래 항목을 모두 적는다. 빈 칸을 두지 않는다. 없으면 "없음"이라고 쓴다.

```markdown
## DAG

### T03: <Task 이름>
- 의존: T01 — T01의 <파일 경로>를 읽는다. T02 — T02의 <리포트 경로>에 적힌 <값>을 쓴다.
- 산출물: <파일 경로 하나>
- 완료 검사: `<명령>` → <기대 출력>
- 편집 범위: <파일 목록>
- 예상 시간(분): low 10 / likely 20 / high 40
- 분할선: <막혔을 때 나눌 경계. 파일 묶음, 라우트, 영역> (없으면 "없음")
- 배정: <에이전트> / <작업 단위> (<런타임> <model>/<effort>)

(Task마다 반복)

### 임계 경로와 병렬도
- 임계 경로: T01 → T03 → T07 → T09 (likely 합 <분>)
- 작업 시간 합 ÷ 임계 경로 길이: <likely 합> ÷ <임계 경로 likely 합> = <값>
- 슬롯 수: <브리프의 슬롯 수>
- 최대 동시 Task 수: <값>
```

- 의존은 산출물 의존만 적는다. 사유를 한 줄로 적을 수 없으면 의존이 아니다.
- 예상 시간 세 값(low, likely, high)은 분 단위다. 병렬도 수치는 likely로 센다.
- 웨이브 표기(W1, W2)를 덧붙여도 읽기용일 뿐이다. 기동은 준비된 Task 단위다([parallel-rules.md](references/parallel-rules.md)).
- 끝에 임계 경로와 병렬도 수치가 없으면 계획 승인 질문에 폭을 숫자로 넣을 수 없다. 계획은 끝난 것이 아니다.

## 그림 입력 파일

`## DAG` 절과 같은 내용으로 두 입력 파일을 쓴다. 계획서와 그림이 어긋나면 계획서가 맞고, 입력 파일을 다시 쓴다.

| 파일 | 스킬 | 담는 것 |
| --- | --- | --- |
| `_workspace/_run/<phase>/dag.json` | `dag-swimlane` | Task마다 노드 하나, 의존마다 연결 하나, 팀마다 레인 하나 |
| `_workspace/_run/<phase>/waterfall.json` | `waterfall-timeline` | Task마다 low, likely, high와 그 근거, 선행 Task |

- 스윔레인 입력의 노드마다 런타임(`agent`: `claude` 또는 `codex`), `model`, `effort`를 적는다. 값은 배정 줄과 같아야 한다. 사용자는 승인 화면에서 배정을 보고 고친다.
- 사람 승인 게이트처럼 워커가 없는 노드에는 셋을 적지 않는다.
- 필드 형식은 각 스킬의 입력 절이 정본이다. 여기에 옮겨 적지 않는다.
- 계획 승인 전에는 모든 노드의 상태를 대기로 둔다. 실행 중의 상태는 장부에서 가져온다.
