# 모델 선택 표

> 계획과 승인에 사용할 프로젝트 런타임·고정 배정·Codex 치환을 정한다. 승인 뒤에는 해당 버전의 배정과 사용자가 위임한 재평가 범위를 따른다.
> 소유: 사용자. 에이전트는 사용자 승인 없이 이 표를 고치지 않는다.
> 작업 단위 칸에는 쉼표로 여러 이름을 적을 수 있다. 형식 검사: `node .claude/scripts/model-selection.mjs check`
> 값을 정할 때의 참고: 사용자가 어떤 모델을 쓸지 묻거나 추천을 원할 때, 추천 표를 만들어 줄 때는 [revfactory/harness의 모델 선택 가이드](https://github.com/revfactory/harness/blob/main/skills/harness/references/model-selection-guide.md)의 기준(복잡도, 예상 기간, 필요한 자율성, 응답 속도)을 참고한다. 표에는 사용자가 정한 값만 넣는다.

## 계획과 기동 직전의 배정

PM은 BL의 수락 기준을 쓸 때 C·U·R·V의 값과 근거를 남긴다. Planner는 각 실행 Task와 팀원이 실제로 내릴 판단, 변경 범위, 완료 검사를 보고 점수를 좁힌다. BL을 직접 지정한 경우도 같다. PM·Planner 자신을 승인 전에 띄우는 단계는 기존 역할 표를 사용한다.

| 축 | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| C 구조 복잡도 | 기계적 대조 | 단일 기능 | 여러 모듈의 계약 | 시스템 전반·복잡한 알고리즘 |
| U 불확실성 | 절차 확정 | 국소 확인 | 가설·설계 비교 | 원인·핵심 기술 판단이 열려 있음 |
| R 실패 영향 | 읽기 전용 대조 | 국소 영향 | 공통 계약·데이터 | 보안 경계·데이터 손실·서비스 중단 |
| V 검증 난도 | 즉시 대조 | 단위 테스트 | 통합·여러 상태 재현 | 믿을 자동 검증이 거의 없음 |
| F 동일 작업의 확정 실패 | 최초 시도 | 1회 | 2회 이상 | — |

1. 역할·단위의 런타임은 아래 배정 표에서 조회한다. 메모가 `고정`으로 시작하면 그 모델·effort를 쓴다. 나머지 실행 배정은 `model-routing.mjs plan`으로 계산한다.
2. 모델은 조건을 순서대로 본다. `C=0, R≤1, V=0, U≤1, F=0`이면 Haiku, `C=3, R=3`이면 Fable, `C=3 또는 R=3 또는 (C≥2 이고 R≥2)`이면 Opus, 나머지는 Sonnet이다.
3. effort 점수는 `E = 2U + V + F + (C=3이면 2)`다. 0~1 low, 2~4 medium, 5~7 high, 8~10 xhigh다. 11~13은 `U=3, V≥2, (C=3 또는 F=2)`일 때 max이고 그 밖에는 xhigh다. Haiku 워커는 effort를 생략한다. Codex이면 아래 치환표를 적용한다.
4. 해석이 둘 이상 가능한 축에는 대안 점수와 근거를 붙인다. 가능한 해석이 실제 모델·effort를 바꿀 때만 Haiku 분류기를 한 번 호출한다. Haiku는 짧은 축별 근거를 보고 허용된 점수 중에서 고른다. 최종 조합은 같은 식으로 계산한다. 분류가 실패하면 최초 점수와 실패 사유를 남긴다.
5. DAG에서 Task·팀원별로 추천값과 기동 직전 재평가 위임 여부를 검토한다. 사용자가 직접 지정한 값은 추천과 같아도 고정한다. 승인된 런타임 안에서 자동 배정만 재평가한다. 고정 해제나 런타임·범위 변경에는 새 DAG 승인 절차를 쓴다. 위임 기록이 없는 기존 승인 파일은 당시 배정으로 재개한다.

## 복잡도 기본표

BL 규모와 RICE에는 기존 1·2·3·5·8·13을 쓴다. 구형 계획 및 표 기반 직접 기동의 `model-selection.mjs lookup --bl`과 `--complexity`는 아래 표를 사용한다.

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
| `product-manager` | 기획 | claude | fable | xhigh | 고정(setup에서 사용자가 정한다). 요구에서 계획까지 한 세션 |
| `product-manager` | 완료 처리 | claude | 복잡도 | | 백로그 완료·보관 |
| `research` | 조사 | claude | 복잡도 | | |
| `frontend` | 구현, 결함 수정, 시험 갱신 | claude | 복잡도 | | |
| `backend` | 구현, 결함 수정, 시험 갱신 | claude | 복잡도 | | |
| `verifier` | 중간 변경 리뷰 | claude | 복잡도 | | 코드를 읽는 검토만 |
| `verifier` | 끝 검증 | claude | 복잡도 | | 읽기와 실행. 영역마다 Task 하나 |
| `verifier` | 재검 | claude | 복잡도 | | 재현 테스트가 없는 결함의 재현 확인만 |
| `verifier` | 보안·돈이 걸린 변경 리뷰 | claude | fable | xhigh | 고정(사용자 결정 2026-11-22) |
| `harness-engineer` | 회고, 구조 변경 | claude | 복잡도 | | |
| `doc-steward` | 문서 초기화, 문서 동기화, 문서 감사 | claude | 복잡도 | | 동기화는 장부의 `## 라이브 문서 확인`에 행이 있을 때만 |
| `*` | 기본 | claude | 복잡도 | | 표에 없는 조합 |
