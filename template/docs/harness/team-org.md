# 팀 명단

> 읽는 시점: 요청을 팀에 보낼 때(코디네이터, 창구), 계획에서 Task를 팀에 배정할 때(planner).
> 팀을 추가하면 이 표에 한 줄을 넣는다. 코디네이터는 팀 스킬 대신 이 표만 읽는다.
> 팀이 어떻게 일하는지는 각 팀 스킬에 있다. 새 팀 스킬은 `docs/harness/templates/team-skill.md`로 만든다.

| 팀 | 팀장이 되는 에이전트 | 팀원 | 팀 스킬 | 편집 범위 |
| --- | --- | --- | --- | --- |
| `product` | `product-manager` | `product-manager` | `team-product` | `docs/backlog.md`, `docs/backlog-archive.md`, `_workspace/product/` |
| `qa` | `qa-inspector` | `qa-inspector`, `code-reviewer` | `team-qa` | 테스트 파일(`qa-inspector`만), `_workspace/qa/` |
| `harness` | `harness-engineer` | `harness-engineer` | `team-harness` | `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/harness/`(모델 표 제외), `_workspace/harness/` |

- `planner`는 어느 팀에도 속하지 않는다. 창구가 띄운다.
- 팀 이름은 작업 폴더 `_workspace/<팀>/`의 이름과 같다.
