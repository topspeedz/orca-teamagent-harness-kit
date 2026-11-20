# 팀 명단

창구·코디네이터·Planner는 이 표에서 소속, 팀장, 배정 경로를 확인한다. 팀원은 팀장이 맡는 역할도 포함해 명시한다. 실행 팀의 절차는 팀 스킬에 있다.

| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 | 구분 |
| --- | --- | --- | --- | --- | --- |
| `product` | | `product-manager`, `planner` | | PRD·SRS(색인 정본), `docs/backlog.md`, `docs/backlog-archive.md`, `docs/superpowers/`, `_workspace/product/` | 운영팀 |
| `qa` | `qa-inspector` | `qa-inspector`, `code-reviewer` | `team-qa` | 테스트 파일(qa-inspector만), `_workspace/qa/` | 실행팀 |
| `doc-steward` | | `doc-steward` | | `docs/DOCUMENTATION_INDEX.md`, 문서 연결과 정합성 확인, `_workspace/_run/` | 직속 |
| `harness-engineer` | | `harness-engineer` | | `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/harness/`(모델 표 제외), `_workspace/harness/` | 직속 |

- 운영팀의 PM·Planner는 동료다. 승인 전에는 창구가 직접 기동한다. 승인 뒤 팀장은 자기 Task의 내부 분해를 Planner에게 직접 맡길 수 있다.
- 실행팀에서 팀장이 켜져 있고 단순 Task가 하나면 코디네이터가 팀원에게 직접 배정할 수 있다. 복수 Task나 전문 분해가 필요한 Task는 팀장을 거친다. 팀장이 꺼져 있으면 소속을 유지하고 그 팀의 배정을 기다린다.
- 직속 두 역할은 무소속이며 매 phase 필수다. 코디네이터가 QA 뒤 문서 정합성을 확인시키고 이어서 하네스 회고를 맡긴다.
- 기존 5열 명단도 사용할 수 있다. 구분을 추가할 때 기존 소속·팀장·스킬·편집 범위를 보존한다.
