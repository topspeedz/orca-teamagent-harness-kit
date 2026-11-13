# 기본 구조 모음

`<…>`만 채운다. 해당 없는 절은 지운다 — 빈 절을 남기지 않는다. Orca 틀을 깔았으면 §1은 이미 깔린 `AGENTS.md`의 같은 절을 채우는 데 쓴다.

## 1. CLAUDE.md (T0 라우터)

```markdown
# <프로젝트>

<한 줄 정의>.

## 명령
<실제로 존재하는 명령만. 검증 명령이 많으면 router 문서로 내리고 여기엔 포인터>

## 기술 스택
<한 단락. 쓰지 않는 것(예: 외부 상태 라이브러리 미사용)도 적는다 — 에이전트가 도입하지 않게>

## 핵심 원칙
- **<도메인 데이터>는 추측 말고 출처에서.** <router> 확인 후 작업.
- <이 프로젝트에서 반복해 시간을 잃은 실수 1~2개>

## 코드 스타일
<주석 언어·이름 규칙·import 순서 — 5줄 이내>

## 작업별 문서 라우팅
- <작업 조건> → `<첫 문서>`; <세부 조건>이면 `<다음 문서>`
- 공유 상수·헬퍼 → `<등재 문서>` (재정의·하드코딩 금지)
- 로드맵 → `<PRD>`; Todo → `<BACKLOG>`
- 날짜별 설계·실행 이력 → `<history 폴더>` (현재 규칙 아님)

## Compact Instructions
자동 압축·`/compact` 요약에 반드시 남긴다:
- 진행 중인 작업 ID(<BACKLOG 항목>)와 현재 단계
- 이번 세션의 사용자 결정 — 원문 그대로, 날짜와 함께
- 수정했지만 커밋 안 한 파일, 남은 검증(<검증 명령>), 현재 브랜치
- 다음 할 일 한 줄. 세부가 `<BACKLOG>`·`<작업 폴더>`에 있으면 경로만 남긴다
```

`## Compact Instructions`는 압축이 실제로 일어나는 세션에서만 둔다([foundation.md](foundation.md) 6단계 조건표). 자동 압축 한도도
조건부다 — 1M 모델에서 측정상 필요할 때 개인 `.claude/settings.local.json`의 `env`로 둔다(`autoCompactWindow` 키는 CLI가 설정을
다시 쓸 때 지워진다). 값은 따옴표 친 정수 — `300k`는 300으로 읽혀 최솟값 100000이 된다. 출발값은 측정한 평균 재독보다 조금 크게
잡는다(평균 재독이 265k였던 프로젝트는 300000에서 시작했다):

```json
{ "env": { "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "<정수>" } }
```

## 2. 문서 상단 계약

```markdown
# <제목>

> **읽는 시점:** <어떤 작업 전에 / 어떤 증상을 만났을 때>
> **역할:** <router|canonical|contract|runbook|spec> — <소유하는 것>. <소유하지 않는 것>은 `<다른 문서>`가 소유한다.
> **소유자:** <팀·스킬> · **상태:** current
```

## 3. 완료 흐름 규칙 (`.claude/rules/45-quality-gate.md`)

```markdown
# Automatic Quality Gate

완료 보고 전에 실제 diff를 기준으로 아래를 분류하고 해당하는 것을 모두 실행한다. diff 크기는 기준이 아니다.

1. **<reviewer A>** — <파일 종류·변경 성격>을 바꿨을 때. <제외 조건>.
2. **<reviewer B>** — try/catch·fallback·누락 필터·외부 fetch 경로를 바꿨을 때.
3. **<doc-updater>** — 사용자 가시 동작을 바꿨거나 등재된 공유 상수를 이동·개명했을 때.

## 완료 흐름
1. 해당 게이트를 모두 실행하고 발견을 수정한다.
2. 코드 변경은 `<build>`, 데이터 변경은 `<verify>`, 문서 변경은 `<verify-docs>`. 이 저장소에 없는 명령을 만들지 않는다.
3. 수정 뒤 관련 검증을 다시 실행한 후 완료를 보고한다.

최종 보고에는 변경 영역, 실행한 게이트와 판정, 실제 검증 결과, 남은 위험만 적는다.
```

reviewer 에이전트가 아직 없으면 1~3을 지우고 완료 흐름 2~3만 남긴다. 그것만으로도 게이트다.

## 4. 승인 게이트 (`permissions` + bypass 세션용 훅)

`.claude/settings.json` — 금지는 `deny`(bypass에서도 막힌다), 사람 승인은 `ask`(대화형 세션에서 실제로 묻는다):

```json
{ "permissions": {
    "deny": ["<어느 세션에서도 금지할 명령>"],
    "ask":  ["Bash(git push --force:*)", "<사람 승인이 필요한 명령>"] } }
```

권한 규칙은 도구별이다. PowerShell 도구도 쓰면 그 도구용 규칙(`PowerShell(<접두어>:*)`)을 같이 두고 V3로 실제로 막히는지 본다.

bypass 모드에서는 `ask`가 적용되지 않는다. 무인 워커처럼 bypass로 도는 세션은 훅이 막는다. Orca 틀을 깔았으면 `approval-gate` 훅이
이미 등록돼 있고, 승인 접두어는 setup 2단계의 답으로 들어간다. 깔지 않았는데 bypass 세션을 쓰면 다음 세 파일을 `.claude/hooks/`에
복사하고 config의 `prefixes`에 접두어를 넣은 뒤 등록한다.

- `${CLAUDE_PLUGIN_ROOT}/template/.claude/hooks/approval-gate.mjs`
- `${CLAUDE_PLUGIN_ROOT}/template/.claude/hooks/approval-gate.check.mjs`
- `${CLAUDE_PLUGIN_ROOT}/template/.claude/hooks/approval-gate.config.json`

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|PowerShell",
    "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-gate.mjs\"" } ] } ] } }
```

- 판정은 exit code가 아니라 stdout JSON에 싣고 항상 `exit 0`이다. 입력을 해석하지 못하면 거부한다(fail-closed).
- 플래그 파일로 통과시키지 않는다 — 에이전트가 직접 만들 수 있는 플래그는 승인이 아니라 과속방지턱이다.
- 셀프테스트는 등록과 matcher를 검증하지 않으므로 실제 세션 확인(V3)을 따로 한다.

## 5. 헤맴 회고 규칙 (`.claude/rules/55-exploration-retrospective.md`)

```markdown
같은 대상을 찾으려고 검색을 3회 이상 반복했거나, 잘못된 동명 파일을 열었거나, 문서 경로가 실제와 달랐거나,
사용자가 위치를 알려줘서야 찾았다면 완료 전에 회고한다. 원인을 문서 부재·드리프트·네이밍 함정·인덱스 누락으로
분류하고 기존 정본을 먼저 고친다. 일회성 사건은 규칙으로 굳히지 않는다. 완료 보고에 헤맨 원인과 갱신한 문서를 한 줄로 남긴다.
```
