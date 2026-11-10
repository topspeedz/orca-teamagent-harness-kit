@AGENTS.md

## Claude 전용

- Claude 전용 파일은 `.claude/`에 둔다: 에이전트 `.claude/agents/`, 스킬 원본 `.claude/skills/`, 훅 `.claude/hooks/`, 스크립트 `.claude/scripts/`.
- 훅 등록과 권한은 `.claude/settings.json`에 있다.
- 코디네이터 터미널은 `node .claude/scripts/orca-launch.mjs coordinator`로 띄운다. 압축 시점 조절(`compact-gate`)과 플러그인·스킬 최소 구성은 그 터미널에만 적용된다.
