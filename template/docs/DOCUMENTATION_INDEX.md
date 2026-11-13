# 문서 색인

- 읽는 시점: 제품의 요구사항, 설계, 계약, 테스트, 운영 문서를 찾을 때. 여기서 문서를 고르고 그 문서만 읽는다.
- 역할과 소유 범위: 제품 문서의 위치, 정본, 상태를 안내한다. 내용은 각 문서가 갖는다.
- 소유 에이전트: `doc-steward`
- 마지막으로 갱신한 phase: 없음

## 규칙

- 이 파일은 `doc-steward`만 고친다. 다른 에이전트는 읽기만 하고, 고칠 것이 있으면 자기 리포트에 적어 넘긴다.
- 문서는 쓸 내용이 생길 때 만든다. 아직 없는 문서는 `없음`이다.
- 다른 경로에 이미 있는 문서는 옮기지 않고 정본 문서 칸에 그 경로를 적는다.
- 양식과 절차는 `docs-management` 스킬에 있다.

## 문서

| 위치 | 담는 것 | 정본 문서 | 관련 ID | 마지막으로 갱신한 phase | 상태 |
| --- | --- | --- | --- | --- | --- |
| `docs/CODEBASE_MAP.md` | 코드 지도 · 모듈별 책임과 탐색 길잡이 | 없음 | | | 없음 |
| `docs/01-product/` | PRD · 제품 요구사항 | 없음 | | | 없음 |
| `docs/02-requirements/` | SRS · 기능/비기능 요구사항 | 없음 | | | 없음 |
| `docs/03-ui-ux/` | UI 명세 · IA · 디자인 시스템 | 없음 | | | 없음 |
| `docs/04-architecture/` | SAD · 시스템 아키텍처 | 없음 | | | 없음 |
| `docs/05-api/` | API 계약 · OpenAPI | 없음 | | | 없음 |
| `docs/06-database/` | DB 스키마 · ERD | 없음 | | | 없음 |
| `docs/07-decisions/` | ADR · 설계 결정 기록 | 없음 | | | 없음 |
| `docs/08-implementation/` | 구현 계획 · WBS | 없음 | | | 없음 |
| `docs/09-testing/` | 테스트 케이스 · 검증 결과 | 없음 | | | 없음 |
| `docs/10-traceability/` | RTM · 요구사항 추적 | 없음 | | | 없음 |
| `docs/11-operations/` | 배포 · 운영 가이드 | 없음 | | | 없음 |
| `docs/12-changelog/` | 변경 이력 · 릴리스 노트 | 없음 | | | 없음 |

## 이 폴더 밖의 문서

`doc-steward`가 고치지 않는 문서다. 찾을 때만 쓴다.

| 문서 | 소유 | 담는 것 |
| --- | --- | --- |
| `docs/backlog.md`, `docs/backlog-archive.md` | `product-manager` | 진행 중인 작업 항목과 수락 기준, 끝난 항목의 보관 |
| `docs/superpowers/specs/`, `docs/superpowers/plans/` | `planner` | phase별 설계서와 계획서 (그때의 기록) |
| `docs/history/<phase>/` | 코디네이터 | phase별 최종 보고, 장부, 회고 (그때의 기록) |
| `docs/harness/` | `harness-engineer` | 하네스 문서: 모델 표, 명단, 양식, 변경 이력 |

## 상태 값

| 값 | 뜻 |
| --- | --- |
| `없음` | 아직 쓰지 않았다 |
| `해당 없음` | 이 프로젝트에 없는 영역이다 |
| `최신` | 마지막 점검에서 끊긴 참조와 열린 불일치가 없었다 |
| `확인 필요` | 문서와 코드 사이에 열린 불일치가 있다 |
