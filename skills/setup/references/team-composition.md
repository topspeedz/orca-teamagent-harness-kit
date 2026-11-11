# 팀 구성

> **읽는 시점:** setup 스킬 7단계(1~6절)와 8단계(7절).

프로젝트의 지난 작업에서 팀과 팀원을 추천하고, 사용자가 고른 것만 만든다. 기존 에이전트 5개와 팀 3개(`product`, `qa`, `harness`)의 정의는 고치지 않는다.

명령은 프로젝트 루트에서 돌린다. `model-table.mjs`가 실패하면 `model-table: ...`을 stderr에 찍고 코드 1로 끝나며 표는 그대로다. 그 메시지를 사용자에게 보여 주고, 값을 바꿔 스스로 다시 돌리지 않는다.

## 1. 모으기

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/session-digest.mjs" --target . --days 30
```

출력은 JSON 하나다: `{ roots, dirs, sessions, promptsTotal, prompts, commands, skills, skipped, pipelines }`.

- `prompts`: 사용자 요청. 최신순, 중복 없이, 하나에 300자까지. `promptsTotal`은 `--limit`(기본 120)으로 자르기 전 개수다.
- `commands`, `skills`: 많이 쓴 셸 명령과 스킬 상위 30개와 횟수.
- `pipelines`: 기존 파이프라인 파일(CI workflow, `Makefile`, `package.json`, `scripts/`, `_workspace/_run/`의 Run 폴더, 명단). 직접 읽는다.

`prompts`의 `ok` 한 줄은 setup이 목록을 조사하며 띄운 세션이라 요청으로 세지 않는다. 지금 setup을 돌리는 세션에서 오간 말도 요청으로 세지 않는다. 한 일을 알려 주는 요청이 없으면 "세션 기록 없음"이라고 알린다. 그런 요청이 없고 `pipelines`에 명단 `docs/harness/team-org.md`밖에 없으면 추천 없이 3절의 "직접 적어서 구성"만 보여 준다.

비밀 값 가림은 토큰 접두어와 긴 16진수만 잡는다. 그래서 요청 원문은 어디에도 옮기지 않는다.

## 2. 추천 만들기

- 반복해서 나온 일의 종류(구현, 화면, 데이터, 배포, 문서 등)를 묶어 팀 후보를 만든다.
- 이미 `docs/harness/team-org.md`에 있는 팀은 "있음"으로만 보여 준다. product·qa·harness가 이미 맡는 일은 새 팀으로 추천하지 않는다.
- 근거를 댈 수 없는 팀은 추천하지 않는다.
- 새 역할을 추천하는 기준은 [principles.md §5](principles.md)의 세 증거(반복, 분리, 절차)다. 세팅하는 프로젝트에는 아직 Run이 없으므로 반복의 증거는 Run 리포트가 아니라 1절에서 모은 세션 기록과 파이프라인 파일로 댄다.

추천 표의 칸:

| 팀 | 팀장이 되는 에이전트 | 팀원 | 편집 범위 | 역할 스킬 | 근거 |
| --- | --- | --- | --- | --- | --- |

- 역할 스킬: 기존 이름 또는 "새로 만듦"(4절).
- 근거: 요약과 위치(세션 날짜·파일 이름, 파이프라인 파일 경로)만 적는다. 요청 원문을 옮기지 않는다.

팀원마다 모델 표의 작업 단위 이름과 model·effort 추천도 정한다(기준은 7절). 추천은 표에 쓰지 않고 7절의 추천 파일에만 적는다.

## 3. 설문

질문 도구로 한 번 묻는다: 추천대로 구성 / 골라서·고쳐서 구성 / 직접 적어서 구성 / 지금은 만들지 않음.

- "골라서·고쳐서": 팀 목록을 multiSelect로 묻고, 고칠 내용(이름, 팀원, 편집 범위)은 채팅으로 받는다.
- "직접 적어서": 팀, 팀원, 편집 범위를 채팅으로 받아 2절의 표로 정리한다.
- "지금은 만들지 않음": 8단계로 간다.

편집 범위는 만들기 전에 사용자 확인을 받는다.

## 4. 역할 스킬 정하기

팀원마다 기존 역할 스킬(`.claude/skills/`의 `backlog-management`, `change-review`, `qa-verification`, `phase-planning`, `harness-retro`)의 `description`을 읽는다. 그 팀원이 맡을 일의 절차가 거기 있으면 그 스킬을 쓴다.

없으면 `.claude/skills/<역할>/SKILL.md`를 새로 만든다. 그 일의 절차와 산출물, 완료 기준만 적고, 1절에서 확인한 프로젝트의 실제 명령(테스트, 빌드)을 넣는다.

Codex를 골랐으면(`_workspace/setup/answers.json`의 `codex`) `.agents/skills/<역할>/SKILL.md`도 만든다. 기존 `.agents/skills/`의 파일과 같은 형식이다: `name`, `description` frontmatter와 "본문은 `.claude/skills/<역할>/SKILL.md`를 읽는다." 한 줄.

## 5. 만들기

팀마다 이 순서로 만든다. 표의 줄을 먼저 넣으므로 `add`가 실패하면 아무것도 만들어지지 않는다. 시작하기 전에 2~3의 파일을 확인한다. 같은 이름의 파일이 이미 있으면 덮어쓰지 않고 사용자에게 알리며, 그 팀은 만들지 않는다. 양식의 안내 문장과 `<...>`는 남기지 않는다.

1. 모델 표에 그 에이전트의 줄. runtime·model·effort는 표의 `*` 기본 줄(agent `*`, unit `기본`) 값을 그대로 쓴다(`rows` 명령으로 읽는다. `*` 리드 줄이 아니다). 추천값은 넣지 않는다. 사용자가 8단계 설문에서 저장할 때만 표에 쓰인다. 줄을 `_workspace/setup/model-rows.json`에 쓰고 넣는다.

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" rows --table docs/harness/model-selection.md
   ```

   ```json
   [{ "agent": "developer", "unit": "구현", "runtime": "<* 줄의 runtime>", "model": "<* 줄의 model>", "effort": "<* 줄의 effort>", "note": "" }]
   ```

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" add --table docs/harness/model-selection.md --rows _workspace/setup/model-rows.json
   ```

   `add`는 빈 `agent`나 `unit`, 칸 안의 `|`나 줄바꿈, `claude`·`codex` 밖의 runtime을 거절한다. runtime이 `claude`이면 목록 밖의 model(`opus`·`sonnet`·`haiku`·`fable`)과 effort(`low`·`medium`·`high`·`xhigh`·`max`), effort를 단 `haiku`도 거절한다. `codex`이면 빈 model만 거절하고 effort는 검사하지 않는다. runtime·model·effort가 모두 `*` 기본 줄과 같은 줄은 목록을 보지 않고 받는다. 그 값은 소유자가 정한 기본값이다(고정한 모델 ID 등). 이미 있는 (에이전트, 작업 단위) 줄도 거절한다. 거절되면 메시지를 보여 주고 이 팀의 나머지 단계로 가지 않는다.
2. 에이전트 `.claude/agents/<에이전트>.md`(양식 `docs/harness/templates/agent.md`).
3. 팀 스킬 `.claude/skills/team-<팀>/SKILL.md`(양식 `docs/harness/templates/team-skill.md`).
4. 명단 `docs/harness/team-org.md`에 팀 한 줄.
5. 검사.

   ```sh
   node .claude/scripts/model-selection.mjs check
   ```

## 6. 되묻기

만든 것을 표로 보여 주고 "더 필요한 팀이나 팀원이 있는지" 묻는다. 있으면 2절의 추천 표를 다시 만들고(방금 만든 팀은 "있음") 3절로 간다.

기존 팀에 팀원만 더할 때는 에이전트 파일, 팀 스킬의 에이전트 구성 표, 명단의 팀원 칸, 모델 표 줄을 고친다. 기존 팀 3개의 팀 스킬과 명단 줄은 이 경우에도 고치지 않는다.

## 7. 모델 표 설문

1. 추천 파일 `_workspace/setup/model-recommend.json`을 쓴다. 표의 모든 줄에 하나씩:

   ```json
   [{ "agent": "developer", "unit": "구현", "isNew": true, "model": "opus", "effort": "medium", "reason": "여러 파일을 고치는 구현" }]
   ```

   기준은 모델 표 머리말이 가리키는 모델 선택 가이드(복잡도, 예상 기간, 필요한 자율성, 응답 속도)다. `isNew`는 이번 실행에서 넣은 줄만 참이다. 새 줄의 추천은 2절에서 정한 값이다. 0.1.0으로 깐 표는 `coordinator` 줄 model에 옛 표기(opus 뒤에 대괄호로 컨텍스트 창 크기를 붙인 것)가 남아 있을 수 있다. 그 줄은 그냥 `opus`를 추천한다. 지금 opus는 기본으로 100만 토큰 창으로 돈다. 줄 목록은 이 명령으로 본다.

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" rows --table docs/harness/model-selection.md
   ```

2. 페이지를 만든다. 파일 이름에 날짜와 시각을 넣어 설문마다 새 이름으로 만든다(Codex를 골랐으면 `--codex`를 붙인다).

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" page --table docs/harness/model-selection.md --recommend _workspace/setup/model-recommend.json --out <스크래치패드>/model-survey-<YYYYMMDD-HHmm>.html
   ```

3. `artifact-capabilities` 스킬을 로드한다. 만든 파일을 끝까지 읽은 뒤 Artifact로 게시한다: `capabilities: {"db": {}}`, 첫 게시에는 `icon`. 새 파일 이름이므로 저장소가 빈 새 Artifact가 된다. 옛 Artifact에 다시 게시하지 않는다(옛 저장 문서가 남는다). 링크를 주고 "고친 뒤 저장을 누르고 알려 달라"고 한다. 페이지는 비공개다.
4. 사용자가 저장했다고 하면 ArtifactData로 읽는다: action `get`, 그 Artifact의 `url`, `collection` `model-selection`, `doc_id` `choices`. 문서는 `{ savedAt, choices: [{ agent, unit, runtime, model, effort }] }`이고 모든 줄이 들어 있다. `choices` 배열만 `_workspace/setup/model-choices.json`에 쓰고 반영한다.

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" apply --table docs/harness/model-selection.md --choices _workspace/setup/model-choices.json
   node .claude/scripts/model-selection.mjs check
   ```

   바뀐 줄을 표로 보여 준다.
5. 문서가 없으면 사용자가 저장하지 않은 것이다. 표를 건드리지 않고 그렇게 알린다. 새 줄은 `*` 기본 줄 값 그대로다.
6. 저장이 실패하면 페이지가 같은 `choices` 배열을 복사 칸에 보여 준다. 사용자가 채팅에 붙여 넣은 배열을 `_workspace/setup/model-choices.json`으로 써서 4의 `apply`를 돌린다.
7. Artifact를 쓸 수 없으면 같은 줄을 채팅에 표로 보여 준다(새 줄은 추천값, 기존 줄은 지금 값과 추천). 고칠 줄만 받아 같은 `apply`로 반영한다. `choices`에는 바꿀 칸만 적는다. 새 줄은 사용자가 받아들인 추천값도 바꿀 칸이다. 없는 `model`, `effort`, `runtime` 키는 지금 값을 둔다.
