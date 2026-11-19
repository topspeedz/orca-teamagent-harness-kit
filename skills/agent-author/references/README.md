# Claude Code Agent Master Kit v1.2

요청할 때마다 일관된 품질로 Claude Code Agent를 제작하기 위한 **마스터 가이드 + 실행 가능한 제작 Skill + 대상 Agent 템플릿**입니다.

## 이 키트에 포함된 것

| 파일 | 용도 |
| --- | --- |
| `AGENT_AUTHORING_MASTER.md` | 사람이 읽거나 다른 AI에 붙여넣어 사용할 제작 원칙·메타 프롬프트 |
| [SKILL.md](../SKILL.md) | Claude Code에서 `/agent-author`로 실행 가능한 제작 워크플로우 |
| [agent-definition-template.md](./agent-definition-template.md) | 생성할 Agent의 YAML + 본문 내용 골격 |
| [domain-patterns.md](./domain-patterns.md) | Unity, 모바일 UI, Blender, 게임 기획, 문서, QA 전문 판단의 예시 |
| [expertise-research-protocol.md](./expertise-research-protocol.md) | 전문성 심화 조사·공식 근거 검증·판단 규칙 추출·불확실성 처리 |
| [agent-corpus-research.md](./agent-corpus-research.md) | **v1.2 신규:** 6개 GitHub Agent/Prompt 컬렉션 후보 발굴·비교·선별·재작성 절차 |
| [quality-checklist.md](./quality-checklist.md) | 완성된 Agent의 설계 품질 검사표 |

## 설치 방법

**프로젝트에만 적용:** 저장소의 `skills/agent-author/` 폴더 전체를 프로젝트의 `.claude/skills/agent-author/`로 복사합니다.

**모든 프로젝트에서 적용:** 위 폴더 전체를 Windows의 `%USERPROFILE%\.claude\skills\agent-author\` 또는 macOS/Linux의 `~/.claude/skills/agent-author/`에 복사합니다.

`AGENT_AUTHORING_MASTER.md`는 설치 필수가 아닙니다. 상세 제작 설계 지침을 사람이 읽거나 다른 AI(예: ChatGPT)에 제공하는 별도의 마스터 문서입니다.

## 사용 예시

플러그인 설치 시 명령은 `/orca-teamagent-harness-kit:agent-author`입니다. 아래 예시는 스킬 폴더를 직접 복사한 경우입니다. 하네스 팀 등록까지 사용하려면 플러그인을 설치합니다.

```text
/agent-author 모바일 UI 디자이너 Agent를 만들어줘. 디자인 시스템과 화면 상태 명세를 작성하고, PM과 QA에 결과를 전달해야 해.
```

```text
/agent-author 기존 .claude/agents/unity-vfx.md를 분석해서 중복 책임을 제거하고 전문적인 판단 규칙과 QA 검증 기준을 강화해줘.
```

템플릿을 ChatGPT 등에서 사용하려면 `AGENT_AUTHORING_MASTER.md`를 함께 첨부하고 다음처럼 요청합니다.

```text
첨부한 AGENT_AUTHORING_MASTER.md 기준으로 Blender 모델링 전문 Agent 정의 파일을 만들어줘.
```

## v1.2 변경사항 — 6개 Agent 사례 컬렉션 조사 통합

- **6개 출처에 역할** 부여: harness-100, agency-agents, awesome-codex-subagents, wshobson/agents, awesome-claude-code-subagents, awesome-prompts.
- **관련 후보 중심 검색**: 모든 관련 카테고리·세부 직무를 고려하되 원문 무차별 전수 로딩을 금지하고 후보를 개별적으로 비교합니다.
- **특수 수집 규칙**: harness-100 KO/EN 중복·단독 역할, wshobson 색인 ↔ 플러그인 정의, TOML 의미 변환, awesome-prompts 접힌 섹션·묶음 하위 프롬프트까지 조사합니다.
- **공식 근거 확인**: 타 Agent의 지침은 가설로 보고, 실제 프로젝트/버전/공식 문서에 맞지 않는 강제 규칙을 제거합니다.
- **출처·라이선스 추적**: 실제 읽은 원문과 채택/제외 판단을 간결하게 기록하고 장문 프롬프트 복제를 지양합니다.

**기존 팀 구성·모델 선택 절차는 수정하지 않았습니다.** 심화 설계에서만 추가 조사를 수행합니다.

## v1.1 변경사항 — 전문성 생성 단계 강화

- **기본/심화 분기**: 요청과 위험도에 맞춰 조사 강도를 조절합니다. 모든 Agent 제작에 대규모 검색을 요구하지 않습니다.
- **실제 버전 중심 조사**: 프로젝트 설정·정본과 공식 기술 문서를 대조하고, 버전 충돌·정보 부재를 표시합니다.
- **의사결정 규칙 추출**: 기술 지식을 `조건 → 기준 → 행동 → 증거 → 대안/중단` 형태로 변환합니다.
- **근거 및 불확실성 관리**: 실제 열람한 출처만 확인된 자료로 취급하고, 미검증/충돌 정보를 분리합니다.
- **전문성 검사 추가**: 규칙의 적용 조건·실패 분기·반례를 검사하되 Agent 본문은 간결하게 유지합니다.

**범위:** v1.0의 기존 하네스 팀 구성·모델 선택 로직과 파일 경로는 이번 업데이트에서 변경하지 않았습니다.

## 구분해야 할 점

1. **제작 Skill ≠ 전문 Agent**. `agent-author`는 Agent 정의를 만드는 도구입니다. 실제 제작된 Unity/Blender/UI 전문 Agent 파일은 `.claude/agents/<agent-name>.md`에 따로 저장합니다.
2. **본문 섹션은 공식 필수 규격이 아닙니다.** 필수는 Claude Code가 지원하는 Agent 파일 형식과 메타데이터이며, 세부 내용 템플릿은 이 키트가 정의한 권장 표준입니다.
3. **스킬 자동 주입 주의**. 전문 Agent의 YAML `skills`에 나열한 Skill은 초기 실행 시 전체 내용이 로드됩니다. 꼭 필요한 경우에만 사용합니다.
4. **검증 상태를 명확하게 표시**. 템플릿 파일의 구조 검증과 실제 런타임 행동/품질 검증은 다른 것입니다.

## 공식 문서

- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Anthropic Prompting Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables)

공식 문서 참조 확인일: 2026-11-20.
