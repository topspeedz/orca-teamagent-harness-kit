# 표에 넣을 줄

## 명단 `docs/harness/agents.md`

`frontend`와 `backend` 행의 편집 범위 칸(`프로젝트가 정한다`)을 이 프로젝트의 경로로 바꾼다. 두 행의 편집 범위는 겹치지 않는다. 스킬 칸은 고치지 않는다.

```markdown
| `frontend` | 프론트엔드 | `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `docs-management` | `web/`, `test/web/`, `_workspace/frontend/` |
| `backend` | 백엔드 | `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `docs-management` | `server/`, `test/server/`, `package.json`, `_workspace/backend/` |
```

## 모델 표 `docs/harness/model-selection.md`

고칠 줄이 없다. `frontend`와 `backend`의 `구현, 결함 수정, 시험 갱신` 행은 설치 때 산정 행(model `복잡도`)으로 이미 있다. 워커는 계획이 Task마다 적은 점수로 model과 effort를 받는다.
