# 모델 선택 표

> 읽는 시점: Task를 배정할 때(planner, 팀장). 워커 기동은 `.claude/scripts/orca-launch.mjs`가 이 표를 조회한다.
> 소유: 사용자. 에이전트는 사용자 승인 없이 이 표를 고치지 않는다.
> 작업 단위 칸에는 쉼표로 여러 이름을 적을 수 있다. 형식 검사: `node .claude/scripts/model-selection.mjs check`

| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |
| --- | --- | --- | --- | --- | --- |
| `coordinator` | 실행 감독 | claude | opus[1m] | high | 100만 토큰 창 전제 |
| `planner` | 설계, 계획 | claude | opus | max | 최고 추론 고정 |
| `product-manager` | 수락 기준, 항목화 | claude | opus | medium | |
| `product-manager` | 장부 정리, 완료 처리 | claude | sonnet | medium | |
| `qa-inspector` | 흐름 검증 | claude | opus | medium | |
| `qa-inspector` | 재검 | claude | sonnet | medium | 재현 확인만 한다 |
| `code-reviewer` | 일반 변경 리뷰 | claude | opus | medium | |
| `code-reviewer` | 보안·돈이 걸린 변경 리뷰 | claude | opus | high | |
| `harness-engineer` | 회고, 구조 변경 | claude | opus | high | |
| `*` | 리드 | claude | opus | high | 팀장으로 띄울 때 |
| `*` | 기본 | claude | opus | medium | 표에 없는 조합 |
