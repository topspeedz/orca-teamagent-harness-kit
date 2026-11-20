# 예시 개발 팀

에이전트 양식과 팀 스킬 양식을 채운 본보기다. 의존성 없는 Node 프로젝트에서 `node --test`로 일하는 `developer` 하나로 된 `dev` 팀이다. 세팅 스킬은 이 팀을 깔지 않는다. 필요하면 아래 네 단계로 직접 넣는다.

## 프로젝트에 넣는 네 단계

1. 파일 두 개를 프로젝트의 같은 경로로 복사한다.
   - `.claude/agents/developer.md`
   - `.claude/skills/team-dev/SKILL.md`
2. `rows.md`의 모델 표 줄 두 개를 `docs/harness/model-selection.md` 표에 넣는다.
3. `rows.md`의 명단 줄 하나를 `docs/harness/team-org.md` 표에 넣는다. 편집 범위는 프로젝트 폴더 구조에 맞게 고친다.
4. 프로젝트 루트에서 모델 표와 역할 정의를 검사한다.

   ```sh
   node .claude/scripts/model-selection.mjs check
   node .claude/scripts/agent-definition.mjs --agent developer
   ```

   Codex를 함께 쓰면 `.agents/skills/team-dev/SKILL.md`에 `.claude/skills/team-dev/SKILL.md`를 가리키는 포인터를 만들고 `node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" sync-agent --target . --agent developer`로 역할을 동기화한다.
