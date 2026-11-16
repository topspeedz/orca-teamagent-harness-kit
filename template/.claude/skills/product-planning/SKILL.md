---
name: product-planning
description: "기획 팀의 방법. 요청을 PRD와 SRS의 요구사항 줄로 쓰기, 요구사항을 백로그 항목으로 나누고 복잡도를 매기기, 우선순위(세 등급과 RICE)와 이번 phase의 묶음 제안, 기획 검토와 계획 대조. prd-writer, product-manager(항목화), pm-reviewer가 phase의 2단계와 4단계에서 로드한다. '요구사항 정리', 'PRD 써줘', '항목으로 나눠줘', '우선순위 매겨줘', 'RICE', '복잡도', '기획 검토', '계획 대조'. 백로그 파일의 형식과 완료 처리(backlog-management), Task 분해와 DAG(phase-planning), 실행 뒤 live 문서 동기화(docs-management)에는 쓰지 않는다."
---

# product-planning

요구사항이 많거나 흐릿한 요청을 수락할 수 있는 항목의 묶음으로 바꾸는 방법이다. 기획 팀은 phase의 2단계(기획)와 4단계(계획 대조)에서 창구가 직접 띄운다. 팀이 어떤 순서로 일하는지는 `team-product`에 있다.

## 어느 일이면 어느 파일을 읽는다

어느 일인지는 spec의 `배정` 줄에 적힌 에이전트와 작업 단위로 안다. 이 파일을 읽은 뒤 아래 표의 파일만 읽는다.

| 에이전트 / 작업 단위 | 하는 일 | 읽는 파일 |
| --- | --- | --- |
| `prd-writer` / `요구사항 정리` | 요청을 PRD와 SRS의 줄로 쓴다 | [references/requirements.md](references/requirements.md), [references/prioritization.md](references/prioritization.md)의 "세 등급", `docs-management`의 PRD·SRS 양식과 "ID와 상태 값" 절 |
| `product-manager` / `항목화` | 항목으로 나누고 수락 기준, 복잡도, 우선순위를 붙이고 묶음을 제안한다 | [references/decomposition.md](references/decomposition.md), [references/prioritization.md](references/prioritization.md), `backlog-management` |
| `pm-reviewer` / `기획 검토`, `계획 대조` | 빠진 것과 어긋난 것을 찾아 보고한다 | [references/review.md](references/review.md), 기획 검토면 [references/decomposition.md](references/decomposition.md)의 "나누는 기준 다섯"과 "복잡도" 절 |

## 공통 규칙

1. **지어내지 않는다.** 숫자(사용자 수, 지표의 현재값과 목표값), 우선순위, 가정은 브리프의 요청 원문과 `## 사용자 결정`에 있는 것만 쓴다. 없으면 `정해지지 않음`으로 두고 리포트의 `## 사용자 결정 필요`에 추천 하나와 근거를 올린다. 일반론으로 채우지 않는다.
2. **정본 하나.** 요구사항 문장은 SRS, 목표와 스토리는 PRD, 진행 중인 작업의 수락 기준은 백로그 항목, Task는 계획서가 갖는다. 다른 곳은 ID로 가리킨다.
3. **ID.** `US`, `FR`, `NFR`의 번호는 `docs-management`의 규칙(그 접두어의 최댓값 + 1, 세 자리)을 따른다. 백로그 번호는 `backlog-management`를 따른다.
4. **정하지 않는다.** 이미 있는 요구사항이나 결정 기록과 부딪치면 어느 쪽으로도 정하지 않고 `## 사용자 결정 필요`에 올린다.
5. **사용자에게 직접 묻지 않는다.** 막히면 `ask`로 창구에 올린다. 문서를 끝까지 쓸 수 있으면 묻지 않고 `## 사용자 결정 필요`에 모은다. 창구가 그 목록을 사용자에게 묻고, 답을 브리프에 더한 뒤 같은 일을 새로 띄운다.

## 리포트

경로는 spec의 `보고` 줄이 정한다(`_workspace/product/<phase>/NN_<에이전트>_<산출물>_v<N>.md`). 양식 `docs/harness/templates/report.md`의 절에 각 일별 파일이 정한 절을 더한다. 모든 리포트에 두는 절:

```markdown
## 사용자 결정 필요

| 번호 | 정할 것 | 추천 | 근거 |
| --- | --- | --- | --- |
```

- 정할 것이 없으면 표 아래에 "없음"이라고 쓴다.
- 절 순서: `## 한 일` → 일별 파일이 정한 절 → `## 사용자 결정 필요` → `## 직접 소통` → `## 검증` → `## 남은 것`.
- 이미 넘긴 리포트는 고쳐 쓰지 않고 다음 버전 `_v<N+1>`을 만든다. PRD, SRS, 백로그는 그 자리에서 고친다.
