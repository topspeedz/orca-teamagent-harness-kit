# 모델 선택 표

> 읽는 시점: Task를 배정할 때(planner, 팀장). 워커 기동은 `.claude/scripts/orca-launch.mjs`가 이 표를 조회한다.
> 소유: 사용자. 에이전트는 사용자 승인 없이 이 표를 고치지 않는다.
> 작업 단위 칸에는 쉼표로 여러 이름을 적을 수 있다. 형식 검사: `node .claude/scripts/model-selection.mjs check`
> 값을 정할 때의 참고: 사용자가 어떤 모델을 쓸지 묻거나 추천을 원할 때, 추천 표를 만들어 줄 때는 [revfactory/harness의 모델 선택 가이드](https://github.com/revfactory/harness/blob/main/skills/harness/references/model-selection-guide.md)의 기준(복잡도, 예상 기간, 필요한 자율성, 응답 속도)을 참고한다. 표에는 사용자가 정한 값만 넣는다.

| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |
| --- | --- | --- | --- | --- | --- |
| `coordinator` | 실행 감독 | claude | opus | high | 100만 토큰 창 전제 |
| `planner` | 설계, 계획 | claude | opus | max | effort는 세팅에서 고른 값. 작업량이 매우 방대하면 띄우기 전에 `fable`로 띄울지 사용자에게 묻는다 |
| `product-manager` | 수락 기준, 항목화 | claude | opus | medium | |
| `product-manager` | 장부 정리, 완료 처리 | claude | sonnet | medium | |
| `qa-inspector` | 흐름 검증 | claude | opus | high | 끝 QA. 결함을 처음 찾는 단계 |
| `qa-inspector` | 재검 | claude | sonnet | medium | 재현 테스트가 없는 결함의 재현 확인만 한다 |
| `code-reviewer` | 중간 변경 리뷰 | claude | sonnet | medium | phase 중간, 뒤 Task가 쌓이기 전 묶음 리뷰 |
| `code-reviewer` | 일반 변경 리뷰 | claude | opus | medium | 끝 리뷰 |
| `code-reviewer` | 보안·돈이 걸린 변경 리뷰 | claude | opus | high | |
| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |
| `*` | 리드 | claude | opus | high | 팀장으로 띄울 때 |
| `*` | 기본 | claude | opus | medium | 표에 없는 조합 |
