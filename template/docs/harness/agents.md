# 에이전트 명단

창구와 코디네이터는 이 표에서 에이전트가 맡는 단위, 스킬, 편집 범위를 확인한다. 팀과 팀장은 없다. 코디네이터가 계획의 Task를 이 에이전트들에게 직접 배정하고, 같은 에이전트를 편집 범위가 겹치지 않는 일 단위마다 하나씩 띄울 수 있다.

| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |
| --- | --- | --- | --- |
| `product-manager` | 기획 | `requirements-write`, `backlog-management`, `product-review`, `phase-planning`, `plan-orchestrate`, `docs-management` | PRD·SRS(색인 정본), `docs/backlog.md`, `docs/backlog-archive.md`, `docs/superpowers/`, `_workspace/product/` |
| `research` | 조사 | `research`, `docs-management` | `_workspace/research/` |
| `frontend` | 프론트엔드 | `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `docs-management` | 프로젝트가 정한다 |
| `backend` | 백엔드 | `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `docs-management` | 프로젝트가 정한다 |
| `verifier` | 검증 | `change-review`, `qa-verification`, `docs-management` | 테스트 파일, `_workspace/qa/` |
| `doc-steward` | 문서 정합성 | `docs-management` | `docs/DOCUMENTATION_INDEX.md`, 문서 연결과 정합성 확인, `_workspace/_run/` |
| `harness-engineer` | 하네스 회고 | `harness-retro`, `docs-management` | `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/harness/`(모델 표 제외), `_workspace/harness/` |

- 스킬 칸은 역할 파일 `- 로드할 스킬:` 줄과 같은 집합이다. 검사: `node .claude/scripts/agent-definition.mjs --agent <이름>`
- 꺼진 에이전트(`.agent-toggle-off`)의 Task는 배정 대기다. `node .claude/scripts/phase-routing.mjs agent --agent <이름>`이 `direct` 또는 `wait`를 돌려준다.
- `doc-steward`와 `harness-engineer`는 조건이 맞을 때만 뜬다. 조건은 `coordinator` 스킬에 있고, 안 맞으면 `skip`으로 닫는다.
