# 예시: frontend와 backend의 스킬 채우기

`setup`이 틀만 까는 `frontend`와 `backend`의 스킬 가운데 `frontend-dev`와 `backend-dev`를 채운 본보기다. 의존성 없는 Node 프로젝트를 가정한다. 화면 코드는 `web/`, 서버는 `node:http`로 쓴 `server/`, 테스트는 `node --test`다. 세팅 스킬은 이 예제를 깔지 않는다. 보통은 `agent-author`의 "스킬 본문 채우기"가 프로젝트의 실제 코드와 지난 작업을 보고 쓴다. 직접 넣을 때는 아래 순서를 따른다.

## 프로젝트에 넣는 순서

1. 파일 두 개를 프로젝트의 같은 경로에 덮어쓴다. 설치 때 깔린 틀 파일이 그 자리에 있다.
   - `.claude/skills/frontend-dev/SKILL.md`
   - `.claude/skills/backend-dev/SKILL.md`

   경로와 명령은 프로젝트에 맞게 고치고, 대표 사례는 그 프로젝트의 실제 작업으로 바꾼다. 머리말의 `description`은 틀과 같다.
2. `rows.md`대로 명단 `docs/harness/agents.md`에서 두 행의 편집 범위를 고친다.
3. 프로젝트 루트에서 검사한다.

   ```sh
   node .claude/scripts/agent-definition.mjs --agent frontend
   node .claude/scripts/agent-definition.mjs --agent backend
   node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" inspect --target .
   ```

   `inspect` 출력의 `unfilledSkills`에서 두 스킬이 빠졌는지 본다. 나머지 여섯은 채울 때까지 남는다.

스킬 이름과 역할 파일은 바뀌지 않으므로 Codex의 포인터와 `sync-agent`는 다시 할 것이 없다.
