# 모델 선택 표

> 읽는 시점: Task를 계획할 때. 실행 승인 시점의 작업별 배정을 기록하고 등록·기동·재개에 사용한다. 이 표의 변경은 다음 계획에 적용한다. 현재 Run의 배정을 바꾸려면 해당 배정과 DAG를 다시 승인받는다.
> 소유: 사용자. 에이전트는 사용자 승인 없이 이 표를 고치지 않는다.
> 작업 단위 칸에는 쉼표로 여러 이름을 적을 수 있다. 형식 검사: `node .claude/scripts/model-selection.mjs check`
> 값을 정할 때의 참고: 사용자가 어떤 모델을 쓸지 묻거나 추천을 원할 때, 추천 표를 만들어 줄 때는 [revfactory/harness의 모델 선택 가이드](https://github.com/revfactory/harness/blob/main/skills/harness/references/model-selection-guide.md)의 기준(복잡도, 예상 기간, 필요한 자율성, 응답 속도)을 참고한다. 표에는 사용자가 정한 값만 넣는다.

| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |
| --- | --- | --- | --- | --- | --- |
| `coordinator` | 실행 감독 | claude | opus | high | 100만 토큰 창 전제 |
| `product-manager` | 요구사항 정리 | claude | opus | max | PRD·SRS 작성 |
| `product-manager` | 수락 기준, 항목화, 묶음 선정 | claude | opus | high | 수락 기준 작성·백로그 항목화·묶음 선정 |
| `product-manager` | 계획 대조 | claude | opus | medium | 승인 범위·수락 기준과 계획 대조 |
| `product-manager` | 장부 정리, 완료 처리 | claude | opus | medium | 백로그 완료·보관 |
| `planner` | 요구사항 검토 | claude | opus | high | PM의 요구사항을 원문과 대조하고 계획 가능성 검토 |
| `planner` | 설계 | claude | fable | max | 기술 설계 |
| `planner` | 계획 | claude | fable | max | 실행 계획·DAG 작성 |
| `qa-inspector` | 흐름 검증 | claude | opus | high | 끝 QA. 결함을 처음 찾는 단계 |
| `qa-inspector` | 재검 | claude | sonnet | medium | 재현 테스트가 없는 결함의 재현 확인만 한다 |
| `code-reviewer` | 중간 변경 리뷰 | claude | sonnet | medium | phase 중간, 뒤 Task가 쌓이기 전 묶음 리뷰 |
| `code-reviewer` | 일반 변경 리뷰 | claude | opus | medium | 끝 리뷰 |
| `code-reviewer` | 보안·돈이 걸린 변경 리뷰 | claude | opus | high | |
| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |
| `doc-steward` | 문서 초기화, 문서 동기화, 문서 감사 | claude | fable | high | 동기화는 phase의 6단계마다. 초기화와 감사는 사용자가 요청할 때만 |
| `*` | 리드 | claude | opus | high | 팀장으로 띄울 때 |
| `*` | 기본 | claude | opus | medium | 표에 없는 조합 |
