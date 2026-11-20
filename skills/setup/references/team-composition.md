# 팀 구성

> **읽는 시점:** setup 스킬 7단계(1~6절)와 8단계(7절).

프로젝트의 지난 작업에서 팀과 팀원을 추천하고, 사용자가 고른 것만 만든다. 명단의 운영팀·실행팀·직속 역할과 사용자가 지정한 소속을 보존한다.

명령은 프로젝트 루트에서 돌린다. `model-table.mjs`가 실패하면 `model-table: ...`을 stderr에 찍고 코드 1로 끝나며 표는 그대로다. 그 메시지를 사용자에게 보여 주고, 값을 바꿔 스스로 다시 돌리지 않는다.

## 1. 모으기

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/session-digest.mjs" --target . --days 30
```

출력은 JSON 하나다: `{ roots, dirs, sessions, promptsTotal, prompts, commands, skills, skipped, pipelines }`.

- `prompts`: 사용자 요청. 최신순, 중복 없이, 하나에 300자까지. `promptsTotal`은 `--limit`(기본 120)으로 자르기 전 개수다.
- `commands`, `skills`: 많이 쓴 셸 명령과 스킬 상위 30개와 횟수.
- `pipelines`: 기존 파이프라인 파일(CI workflow, `Makefile`, `package.json`, `scripts/`, `_workspace/_run/`의 Run 폴더, 명단). 직접 읽는다.

`prompts`의 `ok` 한 줄은 setup이 목록을 조사하며 띄운 세션이라 요청으로 세지 않는다. 지금 setup을 돌리는 세션에서 오간 말도 요청으로 세지 않는다. 한 일을 알려 주는 요청이 없으면 "세션 기록 없음"이라고 알린다. 작업 이력이 없으면 이력 기반 팀 추천은 생략한다. 문서·절별 작성자 확인과 직접 구성은 진행한다.

비밀 값 가림은 토큰 접두어와 긴 16진수만 잡는다. 그래서 요청 원문은 어디에도 옮기지 않는다.

## 2. 추천 만들기

- 반복해서 나온 일의 종류(구현, 화면, 데이터, 배포 등)를 묶어 팀 후보를 만든다.
- 이미 `docs/harness/team-org.md`에 있는 팀은 "있음"으로만 보여 준다. 운영팀·QA·직속 역할이 이미 맡는 일은 새 팀으로 추천하지 않는다. 요구사항 정리, 백로그 항목화와 우선순위, 기획 검토, 설계와 계획은 product 팀이 맡는다. 문서 색인과 감사는 `doc-steward`가 맡고, 제품 동작과 결정의 문서화는 그 내용을 소유할 팀에 포함한다.
- 근거를 댈 수 없는 팀은 추천하지 않는다.
- 새 역할을 추천하는 기준은 [principles.md 5절](principles.md)의 세 증거(반복, 분리, 절차)다. 세팅하는 프로젝트에는 아직 Run이 없으므로 반복의 증거는 Run 리포트가 아니라 1절에서 모은 세션 기록과 파이프라인 파일로 댄다.

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

### 문서 담당 추천과 선택

설치와 설치 후 agent-author의 독립 역할·기존 팀원·팀 전체 생성에 같은 절차를 쓴다. 기존 색인이 다른 PRD·SRS를 지정하면 새로 작성하는 PM·Planner의 책임 표에도 실제 경로를 쓴다. 이미 편집된 역할이나 승인된 절의 담당이 다르면 유지하고 확인이 필요한 차이만 보여 준다.

1. `docs/DOCUMENTATION_INDEX.md`의 정본(기존 별도 경로 우선), 대응 작성 양식과 `## 작성자 배정 대기`를 읽는다. 배정 표의 열은 `| 문서 | 범위 | 배정 상태 |`이며 상태는 `미배정` 또는 `해당 없음`이다. 다른 절의 문서 최신성과 구별한다. 각 역할의 `## 문서 책임`과 꺼진 역할까지 확인한다. 기존 작성자, 해당 없음, 전문 범위 밖인 항목은 제외한다.
2. 팀 전체라도 역할마다 `정본 경로 | 담당 절 | 양식 | 추천 역할 | 그 내용을 결정·구현하는 근거`를 제시한다. PRD·SRS는 PM 작성·Planner 검토다. 팀 이름이나 일반적인 직함만으로 다른 분야를 배정하지 않는다. 역할이 비어 있으면 적합한 역할 생성 / 나중에 배정 / 해당 없음 중 고르게 한다. 기존 팀과 무관한 새 역할에는 추천이 없을 수 있다.
3. 같은 문서의 일부만 배정할 때는 사용자가 정한 실제 절로 `전체` 행을 먼저 나눠 해당 절과 나머지 미배정 범위를 보존한다. **수락**은 실제 역할의 `작성` 행에 경로·절을 넣고 그 범위만 대기 표에서 뺀다. **거절·미선택**은 미배정 그대로, **해당 없음**은 그 행의 배정 상태만 바꾼다. `검토`·`확인` 담당을 정해도 작성자 대기는 유지한다. 팀원마다 처리하고 기존 담당·다른 팀·다른 절·문서 이력과 초안은 보존한다.

전문성 대조와 선택 기록에는 플러그인의 `skills/agent-author/scripts/document-choice.mjs`를 프로젝트 루트에서 실행한다. `node "${CLAUDE_PLUGIN_ROOT}/skills/agent-author/scripts/document-choice.mjs" "정본 경로" "담당 절"`은 한 후보의 현재 상태를 읽는다. `미배정`일 때만 추천한다. 수락 후 정의에 작성 행을 넣고 같은 명령에 `--accept 역할`을 붙인다. 거절은 파일을 그대로 둔다. 영역이 불필요하다는 명시적 응답에는 `--exclude`를 붙인다. 대기 표 변경은 한 명이 순차로 처리하고 재개 때 현재 상태부터 읽는다.

4. 설치 뒤 새 역할을 작성할 때도 같은 대기 표를 다시 읽고, 미배정이며 전문성이 맞는 범위만 추천한다. 구형 색인에 배정 표가 없으면 이미 지정된 담당부터 대조하고 해당 표만 보완한다.

## 4. 역할 스킬 정하기

팀원마다 기존 역할 스킬(`.claude/skills/`의 `backlog-management`, `change-review`, `qa-verification`, `phase-planning`, `harness-retro`, `docs-management`, `prd-write`, `srs-write`, `product-review`)의 `description`을 읽는다. 그 팀원이 맡을 일의 절차가 거기 있으면 그 스킬을 쓴다.

없으면 `.claude/skills/<역할>/SKILL.md`를 새로 만든다. 그 일의 절차와 산출물, 완료 기준만 적고, 1절에서 확인한 프로젝트의 실제 명령(테스트, 빌드)을 넣는다.

Codex를 골랐으면(`_workspace/setup/answers.json`의 `codex`) `.agents/skills/<역할>/SKILL.md`도 만든다. 기존 `.agents/skills/`의 파일과 같은 형식이다: `name`, `description` frontmatter와 "본문은 `.claude/skills/<역할>/SKILL.md`를 읽는다." 한 줄.

## 5. 만들기

독립 역할 하나, 기존 팀원 추가, 새 팀 전체 모두 아래 순서를 쓴다. 시작 전에 명단·모델 행과 역할·스킬 파일(OFF 포함)의 충돌을 확인한다. 같은 구성은 재사용하고 충돌은 사용자에게 알린다. 중간에 멈췄다면 이미 반영한 행을 먼저 대조하고 남은 부분만 진행한다. 양식의 안내 문장과 `<...>`는 남기지 않는다.

1. 모델 표에 그 에이전트의 줄. runtime·model·effort는 표의 `*` 기본 줄(agent `*`, unit `기본`) 값을 그대로 쓴다(`rows` 명령으로 읽는다. `*` 리드 줄이 아니다). 추천값은 넣지 않는다. 사용자가 8단계 설문에서 저장할 때만 표에 쓰인다. 이미 있는 역할·작업 행은 보존하고 새 줄만 `_workspace/setup/model-rows.json`에 모아 한 번에 넣는다.

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
2. 각 신규 역할은 **대상 프로젝트**의 `docs/harness/templates/agent.md`와 플러그인의 [전문 판단 질문](../../agent-author/references/agent-definition-template.md)을 함께 읽어 작성한다. 전문 역할은 [지정 원문 조사](../../agent-author/references/agent-corpus-research.md)로 판단 분기와 실패 신호를 비교하고 실제 프로젝트 경로·검증 증거·출처를 남긴다. `.claude/agents/<에이전트>.md`에는 위에서 수락한 문서·절만 배정한다. 직접 협의 경로는 양쪽에서 찾을 수 있게 하고 새 배정과 범위 변경은 배정자에게 올린다.
3. 새 실행팀은 `docs/harness/templates/team-skill.md`로 팀 스킬을 쓰고 Codex 선택 시 같은 이름의 포인터를 만든다. 기존 팀에 팀원을 더할 때는 해당 팀 스킬의 구성·협의·흐름만 보완한다. 운영팀과 직속 역할에 가상의 팀장이나 팀 스킬을 만들지 않는다.
4. `docs/harness/team-org.md`에서 기존 팀은 해당 행의 팀원·승인된 편집 범위만, 새 팀은 한 행만 추가한다. 독립 역할은 팀장·팀 스킬 없이 명시적 팀원으로 `직속` 행에 넣는다. 기존 5열 명단에서 구분 열을 덧붙일 때 소속과 기존 값을 보존한다. 사용자 선택에 따른 대기 표 변경은 해당 문서·절에만 적용한다.
5. 팀 전원의 연결이 준비되면 새 역할별로 프로젝트 루트에서 `node .claude/scripts/agent-definition.mjs --agent <에이전트>`를 실행하고 `node .claude/scripts/model-selection.mjs check`로 명단과 모델을 확인한다. Codex를 선택했다면 추가·수정한 역할마다 `node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <에이전트>`를 실행한다. 충돌(코드 2)은 기존 TOML을 보존하고 알린다. 기존 구형 정의를 읽거나 재동기화만 할 때는 신규 검사를 요구하지 않는다.
6. [내용 검사](../../agent-author/references/quality-checklist.md)로 대표 성공·실패 입력에서 실제 판단·증거·협의 상대와 미확인 시 대응을 찾는다. 형식 검사와 별도로 결과를 보고한다.

## 6. 되묻기

만든 것을 표로 보여 주고 "더 필요한 팀이나 팀원이 있는지" 묻는다. 있으면 2절의 추천 표를 다시 만들고(방금 만든 팀은 "있음") 3절로 간다.

추가 수락한 역할이 있으면 같은 문서·절 대기 표로 다시 확인한다. 직전에 배정된 범위를 중복 추천하지 않는다.

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
