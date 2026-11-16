# 팀 명단

> 읽는 시점: 요청을 팀에 보낼 때(코디네이터, 창구), 계획에서 Task를 팀에 배정할 때(planner).
> 팀을 추가하면 이 표에 한 줄을 넣는다. 코디네이터는 팀 스킬 대신 이 표만 읽는다.
> 팀이 어떻게 일하는지는 각 팀 스킬에 있다. 새 팀 스킬은 `docs/harness/templates/team-skill.md`로 만든다.

| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 |
| --- | --- | --- | --- | --- |
| `product` | 없음. 창구가 직접 띄운다 | `prd-writer`, `product-manager`, `planner`, `pm-reviewer` | `team-product` | `docs/01-product/prd.md`, `docs/02-requirements/srs.md`(요구사항 줄), `docs/backlog.md`, `docs/backlog-archive.md`, `docs/superpowers/`, `_workspace/product/` |
| `qa` | `qa-inspector` | `qa-inspector`, `code-reviewer` | `team-qa` | 테스트 파일(`qa-inspector`만), `_workspace/qa/` |
| `harness` | `harness-engineer` | `harness-engineer` | `team-harness` | `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/harness/`(모델 표 제외), `_workspace/harness/` |

- `planner`는 product 팀원이다. 창구가 띄운다. 코디네이터 밑의 팀장이 깊은 설계가 필요한 Task 분해를 맡길 때도 띄운다.
- `doc-steward`는 어느 팀에도 속하지 않는다. 코디네이터가 띄운다. 제품의 live 문서를 맡는다('문서 초기화', '문서 동기화', '문서 감사'). 편집 범위는 `docs/DOCUMENTATION_INDEX.md`, `docs/CODEBASE_MAP.md`, `docs/`의 번호 폴더(`01-product`~`12-changelog`)이고(PRD와 SRS의 요구사항 줄은 `prd-writer`가 실행 전에 쓴다), 리포트는 `_workspace/_run/<phase>/`에 쓴다.
- 팀 이름은 작업 폴더 `_workspace/<팀>/`의 이름과 같다.
