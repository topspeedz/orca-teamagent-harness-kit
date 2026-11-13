---
name: docs-management
description: "제품 live 문서(docs/의 번호 폴더 12개, 색인 DOCUMENTATION_INDEX.md, 코드 지도 CODEBASE_MAP.md)의 규칙과 초기화·동기화·감사 절차, 문서 양식. doc-steward가 문서 Task를 받으면 로드한다. '문서 초기화', '문서 동기화', '문서 반영', '문서 감사', '정합성 점검'. 백로그 형식(backlog-management), 설계서와 계획서(plan-orchestrate, phase-planning), 하네스 문서(harness-retro), 코드 리뷰와 QA(change-review, qa-verification)에는 쓰지 않는다."
---

# docs-management

제품의 지금 상태를 담는 live 문서의 정본 규칙이다. 팀이 남기는 리포트, 설계서, 계획서, phase 사본은 그때의 기록이고, 지금 상태는 `doc-steward`가 `docs/`에 쓴다.

성공 기준은 하나다. 다른 에이전트가 이 문서만 읽고 정확하게 구현하고 검증할 수 있다. 문서를 많이 쓰는 것은 기준이 아니다.

## 어느 일이면 어느 파일을 읽는다

어느 일인지는 spec의 `배정` 줄에 적힌 작업 단위로 안다. 이 파일을 읽은 뒤 아래 표의 파일만 읽는다. 나머지 절차 파일과 쓰지 않는 양식은 읽지 않는다.

| 작업 단위 | 하는 일 | 읽는 파일 |
| --- | --- | --- |
| `문서 초기화` | 코드가 이미 있는 프로젝트의 문서를 처음 세운다. 사용자가 요청할 때만 한다 | [references/init.md](references/init.md), [references/audit.md](references/audit.md), 쓸 문서의 양식 |
| `문서 동기화` | 지난 동기화 뒤에 바뀐 것만 문서에 반영한다. phase의 6단계마다 한다 | [references/sync.md](references/sync.md), [references/audit.md](references/audit.md), 고칠 문서의 양식 |
| `문서 감사` | 문서 전체를 점검표로 본다. 사용자가 요청할 때만 한다 | [references/audit.md](references/audit.md) |

## 일곱 규칙

1. **정본 하나.** 같은 사실은 한 문서에만 쓰고 다른 문서는 ID나 경로로 가리킨다(아래 정본 표).
2. **양방향 추적.** 요구사항 ID, 화면 기능 ID, 계약 ID, 코드, 테스트 ID를 추적표로 잇는다. 요구사항에서 테스트로, 테스트에서 요구사항으로 둘 다 따라갈 수 있어야 한다.
3. **영향 분석 먼저.** 바뀐 파일에서 영향 받는 문서를 먼저 찾고, 그 문서만 연다.
4. **근거.** 코드에서 확인한 사실과, 정해지지 않았거나 확인하지 못한 것을 상태 값으로 구분한다. 확인하지 못한 것을 구현된 사실처럼 적지 않는다.
5. **바뀐 곳만.** 문서 전체를 다시 쓰지 않고 해당 절만 고친다.
6. **점검.** 일을 끝내기 전에 문서 사이의 모순, 누락, 끊긴 참조를 점검표로 본다.
7. **사람 승인.** 요구사항, 우선순위, 아키텍처 결정을 정하지 않는다. 승인된 것만 옮기고, 결정이 필요한 것은 올린다.

## 문서 배치와 양식

양식은 `references/forms/`에 파일 하나씩 있다. 쓰거나 고칠 문서의 양식만 읽는다.

| 위치 | 담는 것 | 정본 파일 | 양식 | 바탕 표준 | ID |
| --- | --- | --- | --- | --- | --- |
| `docs/DOCUMENTATION_INDEX.md` | 색인: 문서의 위치, 정본, 관련 ID, 마지막으로 갱신한 phase, 상태 | — | 깔려 있는 파일의 표를 채운다 | — | — |
| `docs/CODEBASE_MAP.md` | 코드 지도: 모듈별 책임, 주요 파일, 의존, 탐색 길잡이 | — | [references/forms/codebase-map.md](references/forms/codebase-map.md) | — | — |
| `docs/01-product/` | PRD · 제품 요구사항 | `prd.md` | [references/forms/prd.md](references/forms/prd.md) | Atlassian 제품 요구사항 양식 | `US-###` |
| `docs/02-requirements/` | SRS · 기능/비기능 요구사항 | `srs.md` | [references/forms/srs.md](references/forms/srs.md) | ISO/IEC/IEEE 29148 | `FR-###`, `NFR-###` |
| `docs/03-ui-ux/` | UI 명세 · IA · 디자인 시스템 | `ui-spec.md` | [references/forms/ui-spec.md](references/forms/ui-spec.md) | 국내 화면 정의서 관행, 화면의 다섯 상태, WCAG 2.2 | `SCR-###`, `UI-FUNC-###` |
| `docs/04-architecture/` | SAD · 시스템 아키텍처 | `architecture.md` | [references/forms/architecture.md](references/forms/architecture.md) | arc42 | — |
| `docs/05-api/` | API 계약 · OpenAPI | `<인터페이스 이름>.md`와 기계가 검증하는 파일 | [references/forms/contract.md](references/forms/contract.md) | Open Data Contract Standard | `API-###` |
| `docs/06-database/` | DB 스키마 · ERD | `<데이터 묶음 이름>.md`와 스키마 파일 | [references/forms/contract.md](references/forms/contract.md) | Open Data Contract Standard | `DATA-###` |
| `docs/07-decisions/` | ADR · 설계 결정 기록 | `NNNN-<제목>.md` | [references/forms/adr.md](references/forms/adr.md) | MADR, Nygard | `ADR-NNNN` |
| `docs/08-implementation/` | 구현 계획 · WBS | `wbs.md` | [references/forms/wbs.md](references/forms/wbs.md) | — | phase 이름 |
| `docs/09-testing/` | 테스트 케이스 · 검증 결과 | `test-cases.md` | [references/forms/test-cases.md](references/forms/test-cases.md) | ISO/IEC/IEEE 29119-3 | `TC-<영역>-###` |
| `docs/10-traceability/` | RTM · 요구사항 추적 | `rtm.md` | [references/forms/rtm.md](references/forms/rtm.md) | 추적표(RTM) 관행 | — |
| `docs/11-operations/` | 배포 · 운영 가이드 | `<런북 이름>.md` | [references/forms/runbook.md](references/forms/runbook.md) | 런북의 일반 절 구성 | — |
| `docs/12-changelog/` | 변경 이력 · 릴리스 노트 | `CHANGELOG.md` | [references/forms/changelog.md](references/forms/changelog.md) | Keep a Changelog | — |

- 폴더와 문서는 쓸 내용이 생길 때 만든다. 빈 문서를 미리 만들지 않는다. 색인의 그 줄은 `없음`으로 둔다.
- 이 프로젝트에 없는 영역(예: 화면이 없는 도구의 `docs/03-ui-ux/`)은 색인에 `해당 없음`으로 적고 만들지 않는다.
- 다른 경로에 이미 문서가 있으면 옮기거나 지우지 않는다. 색인의 정본 문서 칸에 그 경로를 적는다. 번호 폴더로 옮길지는 사용자 결정이므로 리포트의 `## 인박스 후보`에 한 줄로 올린다.
- 모든 문서의 머리는 양식 `docs/harness/templates/live-doc.md`의 네 줄이다: 읽는 시점, 역할과 소유 범위, 소유 에이전트(`doc-steward`), 마지막으로 갱신한 phase.
- 30KB를 넘는 문서는 주제별로 나눈다. 원래 파일에는 나눈 파일을 가리키는 표를 남긴다. 예: 화면이 많으면 `docs/03-ui-ux/screens/<화면 ID>.md`.
- `docs/` 안에서 이 역할의 것이 아닌 곳은 고치지 않고 가리키기만 한다: `docs/backlog.md`와 `docs/backlog-archive.md`(기획), `docs/harness/`(하네스), `docs/superpowers/`(`planner`의 설계서와 계획서), `docs/history/`(코디네이터의 phase 사본).

## ID와 상태 값

- ID의 번호는 세 자리다(`FR-001`). ADR만 네 자리다(`ADR-0001`). 테스트 케이스의 영역은 대문자 영어 낱말이다(`TC-CART-014`).
- 새 번호는 문서와 변경 이력에 나온 그 접두어의 최댓값 + 1이다. 이미 쓴 번호를 다른 뜻으로 다시 쓰지 않는다. 없어진 항목은 줄을 지우고 변경 이력의 `Removed`에 ID를 남긴다.
- ID는 정의하는 문서 한 곳에서만 정의한다. 다른 문서는 ID로 가리킨다.

요구사항의 상태는 추적표에만 적고, 값은 아래 넷 중 하나다. 다른 문서(SRS, UI 명세, 계약 문서)에서는 예외만 그 줄 끝에 표시한다: 아직 코드에 없는 줄은 `(계획됨)`, 어긋난 줄은 `(확인 필요: 사유)`.

| 값 | 뜻 | 옆에 적는 근거 |
| --- | --- | --- |
| `계획됨` | 승인된 설계서나 백로그 수락 기준에 있으나 코드에서 확인하지 못했다 | 설계서 경로와 절 |
| `구현됨` | 코드에서 확인했다 | 파일 경로와 심볼(`src/cart.mjs#addItem`) |
| `검증됨` | 확인하는 테스트가 있고 최근 결과가 통과다 | 테스트 파일과 테스트 이름 |
| `확인 필요` | 문서와 코드가 다르거나 근거를 찾지 못했다 | 사유 한 줄 |

- 근거는 저장소에 있는 것만 가리킨다: 코드 경로, 테스트 이름, 설계서 경로, phase 이름. `_workspace/` 경로는 적지 않는다. 그 폴더는 git에 올라가지 않는다.
- 색인의 문서 상태는 `없음`, `해당 없음`, `최신`(마지막 점검에서 끊긴 참조와 열린 불일치가 없었다), `확인 필요`(열린 불일치가 있다) 중 하나다.

## 정본 표

| 사실 | 정본 | 다른 문서는 |
| --- | --- | --- |
| 목표, 성공 지표, 사용자 스토리, 하지 않는 것 | PRD | 가리킨다 |
| 요구사항 문장과 수용 기준 | SRS | `FR`/`NFR` ID로 가리킨다 |
| 화면의 구성요소, 상태, 동작 | UI 명세 | `SCR`/`UI-FUNC` ID로 가리킨다 |
| 요청과 응답 형식, 스키마, 오류 코드 | 계약 문서. 기계가 검증하는 파일(OpenAPI YAML, SQL 스키마)이 있으면 그 파일 | 가리킨다 |
| 결정의 이유와 대안 | ADR | 아키텍처 문서 9절은 번호만 나열한다 |
| 구조, 배치, 횡단 개념, 위험과 기술 부채 | 아키텍처 문서 | 가리킨다 |
| 테스트 절차와 기대 결과 | 자동화된 것은 테스트 코드, 손으로 하는 것은 테스트 케이스 장부 | 가리킨다 |
| 요구사항과 화면·계약·코드·테스트의 연결, 요구사항의 상태 | 추적표 | 연결 표를 따로 만들지 않는다 |
| 실행 순서와 명령 | 런북. 검증 명령은 `AGENTS.md`의 `명령` 절 | 가리킨다 |
| 값(디자인 토큰, 설정값, 환경 변수 목록) | 코드나 설정 파일 | 경로를 가리킨다. 값을 복사하지 않는다 |
| 진행 중인 작업의 수락 기준 | 백로그 항목(`product-manager`) | 그 작업이 끝나면 SRS가 현재 요구사항의 정본이 된다 |
| 그 phase의 설계와 계획 | `docs/superpowers/`의 설계서와 계획서 | 본문을 고치지 않고 가리킨다 |

## 추가만 하는 기록

`docs/07-decisions/`(ADR), `docs/08-implementation/wbs.md`(phase 색인), `docs/12-changelog/`(변경 이력)는 줄을 더하기만 하는 기록이다. 날짜와 phase 이름을 둔다. 나머지 문서는 현재 상태만 담는다. 날짜가 붙은 경과, 대체된 옛 내용, 백로그 번호 나열을 넣지 않는다.

## 결정과 불일치

- 문서에 쓰는 결정의 출처는 넷뿐이다: 승인된 설계서, 계획서, 백로그 항목, 브리프의 사용자 결정. 출처를 문서에 적을 때는 설계서 경로와 phase 이름으로 적는다.
- ADR은 이미 내려진 결정만 기록한다. 출처가 없는 결정처럼 보이는 변경(예: 설계서에 없이 바뀐 라이브러리)은 ADR로 쓰지 않고 불일치로 올린다.
- 승인된 기준이 분명하면 그 기준에 문서를 맞춘다. 예: 이번 phase의 승인된 설계서와 검증된 코드가 같고 옛 문서만 다르다.
- 코드가 승인된 설계나 요구사항과 다르거나, 출처 없이 바뀐 것은 어느 쪽도 맞다고 정하지 않는다. 문서의 그 줄을 `확인 필요`로 두고 리포트의 `## 불일치` 표에 적는다. 코드와 설계서는 고치지 않는다.

## 리포트

경로는 spec의 `보고` 줄이 정한다(`_workspace/_run/<phase>/NN_doc-steward_<산출물>_v<N>.md`). 양식 `docs/harness/templates/report.md`의 절에 아래 절을 더한다.

```markdown
# <Task ID> <이름> 리포트

## 한 일

## 영향 분석

| 바뀐 경로 | 닿는 ID | 고칠 문서 | 사유 |
| --- | --- | --- | --- |

## 고친 문서

| 문서 | 고친 절 | 새 ID |
| --- | --- | --- |

## 불일치

| ID | 문서 위치 | 문서 내용 | 코드의 실제 | 승인된 기준으로 보이는 쪽과 근거 |
| --- | --- | --- | --- | --- |
| DOC-1 | | | | |

## 인박스 후보

- <불일치 한 줄 요약> (DOC-1)

## 직접 소통

없음

## 검증

- ✅ `<점검 명령>` → <결과>
- ❌ (참고) 불일치 1건: DOC-1

## 남은 것
```

- 불일치의 ID는 리포트 안에서 `DOC-1`부터 센다. 표가 비면 "없음"이라고 쓴다.
- `## 인박스 후보`에는 불일치마다 한 줄을 적는다. `product-manager`가 완료 처리에서 인박스로 옮긴다.
- `## 검증`에는 점검표(`references/audit.md`)의 줄을 ✅나 ❌로 적는다. 여기의 ❌는 이 Task가 끝내지 못한 것이다.
- 찾은 불일치는 이 Task의 실패가 아니다. 불일치가 있으면 `- ❌ (참고) 불일치 <N>건: <ID들>` 한 줄로 적는다. `(참고)` 줄은 실패로 세어지지 않고 코디네이터의 최종 보고로 넘어간다. `## 불일치` 표 안에는 ✅와 ❌를 쓰지 않는다.
- 영향 받는 문서가 없으면 `## 한 일`에 "변경 없음"이라고 쓴다.

## 오류 처리

| 상황 | 대응 |
| --- | --- |
| 설계서나 검증 리포트가 없다 | 코드와 git 변경만으로 쓴다. 확인하지 못한 줄은 `확인 필요`로 둔다 |
| 결정이 있어야 쓸 수 있는 절이다 | 비워 두고 `ask`로 올린다. 추측으로 채우지 않는다 |
| 색인이 커밋된 적이 없어 지난 동기화의 경계를 알 수 없다 | 마지막 커밋 뒤의 변경을 범위로 삼는다. 커밋이 하나도 없으면 작업 트리 전체다(`references/sync.md` 1단계) |
| 양식에 맞지 않는 기존 문서가 있다 | 그대로 두고 색인에 올린다. 양식으로 옮겨 쓸지는 `## 인박스 후보`에 올린다 |
| 고칠 문서가 30KB를 넘는다 | 주제별로 나눈 뒤 고치고, 나눈 것을 `## 고친 문서`에 적는다 |

## 하지 않는 것

- 코드, 테스트, 백로그, 설계서와 계획서, `docs/history/`, `docs/harness/`, `AGENTS.md` 편집.
- 요구사항, 우선순위, 아키텍처 결정을 새로 정하기.
- 코드와 명세의 차이를 한쪽에 맞춰 조용히 없애기.
- 기존 문서 옮기기와 지우기.
- 릴리스 정하기. 변경 이력은 `[Unreleased]`에만 더한다.
- 리포트 전문 읽기. 구현 리포트는 `## 한 일`만, 검증 리포트는 결함 표와 `## 검증`만 읽는다.
