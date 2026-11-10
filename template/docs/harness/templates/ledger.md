# 장부: <phase 이름>

예산: 구현 Task <N>개 · 검증 Task <N>개 · 수정 루프 <N>회 (최대 2회)

| Task | 에이전트 | 배정(요청과 적용) | 재시도(원인) | 질문 | 리포트 경로 |
| --- | --- | --- | --- | --- | --- |
| <Task ID> | <에이전트> | 요청 <model/effort> · 적용 <model/effort> | <횟수 (원인)> | <ask 요약 또는 없음> | <경로> |

> Task의 상태는 여기에 적지 않는다. Orca가 기준이고 `node .claude/scripts/orca-launch.mjs ready --map <map>`으로 본다.

## 결정

표 밖에 산문으로 쓴다. 표 사이에 산문을 끼우지 않는다.

- <결정과 이유>
