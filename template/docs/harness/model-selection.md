# 모델 선택 표

> 읽는 시점: Task를 계획할 때. 실행 승인 시점의 작업별 배정을 기록하고 등록·기동·재개에 사용한다. 이 표의 변경은 다음 계획에 적용한다. 현재 Run의 배정을 바꾸려면 해당 배정과 DAG를 다시 승인받는다.
> 소유: 사용자. 에이전트는 사용자 승인 없이 이 표를 고치지 않는다.
> 작업 단위 칸에는 쉼표로 여러 이름을 적을 수 있다. 형식 검사: `node .claude/scripts/model-selection.mjs check`
> 값을 정할 때의 참고: 사용자가 어떤 모델을 쓸지 묻거나 추천을 원할 때, 추천 표를 만들어 줄 때는 [revfactory/harness의 모델 선택 가이드](https://github.com/revfactory/harness/blob/main/skills/harness/references/model-selection-guide.md)의 기준(복잡도, 예상 기간, 필요한 자율성, 응답 속도)을 참고한다. 표에는 사용자가 정한 값만 넣는다.

> 배정 방식(사용자 결정 2026-11-22): model 칸이 `복잡도`인 줄은 BL을 맡는 실행 Task다. 그 Task가 맡은 BL의 복잡도(여럿이면 가장 큰 값)로 아래 기본표에서 값을 정하고, 런타임이 codex면 Codex 치환표로 바꾼다. model 칸에 값이 있는 줄은 복잡도를 무시한다. 그중 메모가 `고정`인 줄은 사용자가 고정한 값이고, 나머지는 BL을 맡지 않는 줄이다.
> 그 밖의 에이전트별 조정은 이 표에 넣지 않는다. 계획 승인 때 DAG 그림의 드롭다운에서 사용자가 Task마다 고르고, 기본값과 다르면 그 Task의 `사용자 예외`다.
> 복잡도 출처: 승인용 `dag.json` 워커 노드의 `complexity`(팀 내부 배정 `members`는 자기 값이 없으면 노드 값). 값은 `node .claude/scripts/model-selection.mjs lookup --agent <a> --unit <u> --bl BL-####[,BL-####]`가 `docs/backlog.md` 비고의 `복잡도 <값>`에서 읽어 준다. 직접 기동은 `orca-launch.mjs worker … --complexity <n>`.

## 복잡도 기본표

| 복잡도 | model | effort |
| --- | --- | --- |
| 1 | sonnet | medium |
| 2 | sonnet | high |
| 3 | opus | medium |
| 5 | opus | high |
| 8 | opus | xhigh |
| 13 | fable | high |

## Codex 치환표

Claude의 모든 model/effort 조합을 Codex 값으로 바꾼다. 형식 검사가 빠진 조합을 찾는다. 바꾸기: `node .claude/scripts/model-selection.mjs codex --pair <model/effort>`.

| Claude | Codex | 메모 |
| --- | --- | --- |
| opus/low | gpt-6.2-astra/low | |
| opus/medium | gpt-6.2-astra/medium | |
| opus/high | gpt-6.2-astra/high | |
| opus/xhigh | gpt-6.2-astra/xhigh | |
| opus/max | gpt-6.2-astra/max | |
| sonnet/low | gpt-6.2-sol/low | |
| sonnet/medium | gpt-6.2-sol/medium | |
| sonnet/high | gpt-6.2-sol/high | |
| sonnet/xhigh | gpt-6.2-sol/xhigh | |
| sonnet/max | gpt-6.2-sol/max | |
| haiku | gpt-6.2-sol/low | |
| fable/low | gpt-6.2-astra/medium | effort 한 단계 위 |
| fable/medium | gpt-6.2-astra/high | effort 한 단계 위 |
| fable/high | gpt-6.2-astra/xhigh | effort 한 단계 위 |
| fable/xhigh | gpt-6.2-astra/max | effort 한 단계 위 |
| fable/max | gpt-6.2-astra/ultra | effort 한 단계 위 |

승인 화면 Task 선택: 켬

## 배정 표

| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |
| --- | --- | --- | --- | --- | --- |
| `coordinator` | 실행 감독 | claude | opus | high | 고정(사용자 결정 2026-11-22). 100만 토큰 창 전제 |
| `product-manager` | 요구사항 정리 | claude | opus | max | PRD·SRS 작성 |
| `product-manager` | 수락 기준, 항목화, 묶음 선정 | claude | opus | high | 수락 기준 작성·백로그 항목화·묶음 선정 |
| `product-manager` | 계획 대조 | claude | opus | medium | 승인 범위·수락 기준과 계획 대조 |
| `product-manager` | 장부 정리, 완료 처리 | claude | opus | medium | 백로그 완료·보관 |
| `planner` | 요구사항 검토 | claude | opus | high | PM의 요구사항을 원문과 대조하고 계획 가능성 검토 |
| `planner` | 설계 | claude | fable | max | 기술 설계 |
| `planner` | 계획 | claude | fable | max | 실행 계획·DAG 작성 |
| `qa-inspector` | 흐름 검증 | claude | 복잡도 | | 끝 QA. 결함을 처음 찾는 단계 |
| `qa-inspector` | 재검 | claude | 복잡도 | | 재현 테스트가 없는 결함의 재현 확인만 한다 |
| `code-reviewer` | 중간 변경 리뷰 | claude | 복잡도 | | phase 중간, 뒤 Task가 쌓이기 전 묶음 리뷰 |
| `code-reviewer` | 일반 변경 리뷰 | claude | 복잡도 | | 끝 리뷰 |
| `code-reviewer` | 보안·돈이 걸린 변경 리뷰 | claude | fable | xhigh | 고정(사용자 결정 2026-11-22) |
| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |
| `doc-steward` | 문서 초기화, 문서 동기화, 문서 감사 | claude | fable | high | 동기화는 phase의 6단계마다. 초기화와 감사는 사용자가 요청할 때만 |
| `*` | 리드 | claude | opus | high | 팀장으로 띄울 때 |
| `*` | 기본 | claude | 복잡도 | | 표에 없는 조합(사용자 결정 2026-11-22: 복잡도를 따름) |
