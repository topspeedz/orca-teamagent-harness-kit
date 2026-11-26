# 에이전트 단위 구성

> **읽는 시점:** setup 스킬 7단계(1~6절)와 8단계(7절). agent-author의 스킬 더하기·에이전트 만들기(5절), 프로젝트 옮기기(8절)도 이 파일을 쓴다.

틀은 지식 단위 에이전트 일곱 개(`product-manager`, `research`, `frontend`, `backend`, `verifier`, `doc-steward`, `harness-engineer`)를 깐다. 팀은 없다. 프로젝트의 지난 작업에서 기존 에이전트에 더할 스킬, 기본 에이전트의 이름·스킬·편집 범위 바꾸기, 새 에이전트를 추천하고, 사용자가 고른 것만 만든다. 명단 `docs/harness/agents.md`에 사용자가 이미 적은 행은 보존한다.

명령은 프로젝트 루트에서 돌린다. `model-table.mjs`가 실패하면 `model-table: ...`을 stderr에 찍고 코드 1로 끝나며 표는 그대로다. 그 메시지를 사용자에게 보여 주고, 값을 바꿔 스스로 다시 돌리지 않는다.

## 1. 모으기

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/session-digest.mjs" --target . --days 30
```

출력은 JSON 하나다: `{ roots, dirs, sessions, promptsTotal, prompts, commands, skills, skipped, pipelines }`.

- `prompts`: 사용자 요청. 최신순, 중복 없이, 하나에 300자까지. `promptsTotal`은 `--limit`(기본 120)으로 자르기 전 개수다.
- `commands`, `skills`: 많이 쓴 셸 명령과 스킬 상위 30개와 횟수.
- `pipelines`: 기존 파이프라인 파일(CI workflow, `Makefile`, `package.json`, `scripts/`, `_workspace/_run/`의 Run 폴더, 명단). 직접 읽는다.

`prompts`의 `ok` 한 줄은 setup이 목록을 조사하며 띄운 세션이라 요청으로 세지 않는다. 지금 setup을 돌리는 세션에서 오간 말도 요청으로 세지 않는다. 한 일을 알려 주는 요청이 없으면 "세션 기록 없음"이라고 알린다. 작업 이력이 없으면 이력 기반 추천은 생략한다. 문서·절별 작성자 확인과 직접 구성은 진행한다.

비밀 값 가림은 토큰 접두어와 긴 16진수만 잡는다. 그래서 요청 원문은 어디에도 옮기지 않는다.

## 2. 추천 만들기

기본은 기존 에이전트에 스킬을 더하는 것이다. 에이전트를 새로 만드는 것은 아래 가운데 하나가 사실일 때뿐이다.

1. 기존 에이전트에 넣으면 컨텍스트가 불어나 성능이 떨어지는 것이 관찰됐다.
2. 다른 일과 병렬로 돌고, 끝나면 그 컨텍스트를 버려도 된다.
3. 도구나 지시가 기존 에이전트의 것과 부딪친다(다른 런타임, 혼자 써야 하는 자원, 다른 권한).

서로의 출력에 이어 붙거나 같은 파일을 만지는 일은 한 에이전트에 둔다. 직함이 다르다는 것은 이유가 아니다. 역할 양식의 `- 기준:` 값은 이 셋을 차례로 `컨텍스트 분리`, `병렬`, `도구·지시 충돌`로 적는다.

- 반복해서 나온 일의 종류(화면, 데이터, 배포 등)를 묶어, 그 일을 맡을 에이전트와 더할 스킬 후보를 만든다.
- 명단에 이미 있는 에이전트와 스킬은 "있음"으로만 보여 준다. 기본 에이전트가 맡는 일은 새 에이전트로 추천하지 않는다. 요구사항 정리, 백로그 항목화와 우선순위, 요구사항 검토, 설계와 계획은 `product-manager`가 맡는다. 문서 색인과 감사는 `doc-steward`가 맡고, 제품 동작과 결정의 문서화는 그 내용을 소유할 에이전트에 포함한다.
- `frontend`와 `backend`는 만드는 단위의 기본값이다. 프로젝트의 기술이 다르면 이름과 스킬을 바꾸거나 더하는 것을 추천한다. 명단의 편집 범위가 `프로젝트가 정한다`이면 실제 경로를 추천한다.
- 근거를 댈 수 없는 추천은 하지 않는다. 세팅하는 프로젝트에는 아직 Run이 없으므로 근거는 Run 리포트가 아니라 1절에서 모은 세션 기록과 파이프라인 파일로 댄다.

추천 표의 칸:

| 에이전트 | 추천 | 스킬 | 편집 범위 | 근거 |
| --- | --- | --- | --- | --- |

- 추천: `스킬 더하기`, `이름·스킬 바꾸기`, `빼기`, `새 에이전트(<기준>)` 가운데 하나.
- 스킬: 기존 이름 또는 "새로 만듦"(4절).
- 근거: 요약과 위치(세션 날짜·파일 이름, 파이프라인 파일 경로)만 적는다. 요청 원문을 옮기지 않는다. 새 에이전트는 세 기준 가운데 무엇이 이 프로젝트의 어떤 사실로 참인지 적는다.

새 작업 단위마다 모델 표의 작업 단위 이름과 model·effort 추천도 정한다(기준은 7절). 추천은 표에 쓰지 않고 7절의 추천 파일에만 적는다.

## 3. 설문

질문 도구로 한 번 묻는다: 추천대로 구성 / 골라서·고쳐서 구성 / 직접 적어서 구성 / 지금은 만들지 않음.

- "골라서·고쳐서": 추천 목록을 multiSelect로 묻고, 고칠 내용(이름, 스킬, 편집 범위)은 채팅으로 받는다.
- "직접 적어서": 에이전트, 스킬, 편집 범위를 채팅으로 받아 2절의 표로 정리한다.
- "지금은 만들지 않음": 8단계로 간다.

### 문서 담당 추천과 선택

설치와 설치 후 agent-author의 스킬 더하기·에이전트 만들기에 같은 절차를 쓴다. 문서 담당은 그 문서의 지식을 가진 에이전트의 역할 파일 `## 문서 책임` 표에 적는다. 기존 색인이 다른 PRD·SRS를 지정하면 `product-manager`의 책임 표에도 실제 경로를 쓴다. 이미 편집된 역할이나 승인된 절의 담당이 다르면 유지하고 확인이 필요한 차이만 보여 준다.

1. `docs/DOCUMENTATION_INDEX.md`의 정본(기존 별도 경로 우선), 대응 작성 양식과 `## 작성자 배정 대기`를 읽는다. 배정 표의 열은 `| 문서 | 범위 | 배정 상태 |`이며 상태는 `미배정` 또는 `해당 없음`이다. 어느 역할 파일에도 작성자가 없는 문서만 이 표에 있다. 다른 절의 문서 최신성과 구별한다. 각 역할의 `## 문서 책임`과 꺼진 역할까지 확인한다. 기존 작성자, 해당 없음, 전문 범위 밖인 항목은 제외한다.
2. 역할마다 `정본 경로 | 담당 절 | 양식 | 추천 역할 | 그 내용을 결정·구현하는 근거`를 제시한다. PRD·SRS는 `product-manager`가 작성한다. 에이전트 이름이나 일반적인 직함만으로 다른 분야를 배정하지 않는다. 역할이 비어 있으면 적합한 역할 생성 / 나중에 배정 / 해당 없음 중 고르게 한다. 기존 에이전트와 무관한 새 역할에는 추천이 없을 수 있다.
3. 같은 문서의 일부만 배정할 때는 사용자가 정한 실제 절로 `전체` 행을 먼저 나눠 해당 절과 나머지 미배정 범위를 보존한다. **수락**은 실제 역할의 `작성` 행에 경로·절을 넣고 그 범위만 대기 표에서 뺀다. **거절·미선택**은 미배정 그대로, **해당 없음**은 그 행의 배정 상태만 바꾼다. `검토`·`확인` 담당을 정해도 작성자 대기는 유지한다. 역할마다 처리하고 기존 담당·다른 역할·다른 절·문서 이력과 초안은 보존한다.

전문성 대조와 선택 기록에는 플러그인의 `skills/agent-author/scripts/document-choice.mjs`를 프로젝트 루트에서 실행한다. `node "${CLAUDE_PLUGIN_ROOT}/skills/agent-author/scripts/document-choice.mjs" "정본 경로" "담당 절"`은 한 후보의 현재 상태를 읽는다. `미배정`일 때만 추천한다. 수락 후 정의에 작성 행을 넣고 같은 명령에 `--accept 역할`을 붙인다. 거절은 파일을 그대로 둔다. 영역이 불필요하다는 명시적 응답에는 `--exclude`를 붙인다. 대기 표 변경은 한 명이 순차로 처리하고 재개 때 현재 상태부터 읽는다.

4. 설치 뒤 새 역할을 작성할 때도 같은 대기 표를 다시 읽고, 미배정이며 전문성이 맞는 범위만 추천한다. 구형 색인에 배정 표가 없으면 이미 지정된 담당부터 대조하고 해당 표만 보완한다.

## 4. 스킬 정하기

더할 스킬마다 기존 스킬(`.claude/skills/`의 `requirements-write`, `backlog-management`, `product-review`, `phase-planning`, `research`, `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `change-review`, `qa-verification`, `harness-retro`, `docs-management`)의 `description`을 읽는다. 그 일의 절차가 거기 있으면 그 스킬을 쓴다. 틀만 있는 스킬이면 agent-author의 스킬 본문 채우기로 채운다.

없으면 `docs/harness/templates/skill.md`로 `.claude/skills/<스킬>/SKILL.md`를 새로 만든다. 스킬 하나는 한 가지 일만 다룬다. 그 일의 절차, 하지 않는 것, 대표 사례(정상 하나, 실패 하나)를 적고, 1절에서 확인한 프로젝트의 실제 명령(테스트, 빌드)을 넣는다. 대표 사례는 그 프로젝트의 실제 작업에서 가져온다.

Codex를 골랐으면(`_workspace/setup/answers.json`의 `codex`) `.agents/skills/<스킬>/SKILL.md`도 만든다. 기존 `.agents/skills/`의 파일과 같은 형식이다: `name`, `description` frontmatter와 "본문은 `.claude/skills/<스킬>/SKILL.md`를 읽는다." 한 줄.

## 5. 만들기

기존 에이전트에 스킬 더하기, 기본 에이전트 바꾸기, 새 에이전트 만들기 모두 아래 순서를 쓴다. 해당하지 않는 단계는 건너뛴다. 시작 전에 명단·모델 행과 역할·스킬 파일(OFF 포함)의 충돌을 확인한다. 같은 구성은 재사용하고 충돌은 사용자에게 알린다. 중간에 멈췄다면 이미 반영한 행을 먼저 대조하고 남은 부분만 진행한다. 양식의 안내 문장과 `<...>`는 남기지 않는다.

1. 모델 표에 새 작업 단위의 줄. runtime·model·effort는 표의 `*` 기본 줄(agent `*`, unit `기본`) 값을 그대로 쓴다(`rows` 명령으로 읽는다). 틀의 `*` 줄은 model이 `복잡도`인 산정 행이라 새 줄도 산정 행이 된다. 추천값은 넣지 않는다. 사용자가 8단계 설문에서 저장할 때만 표에 쓰인다. 이미 있는 역할·작업 행은 보존하고 새 줄만 `_workspace/setup/model-rows.json`에 모아 한 번에 넣는다.

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" rows --table docs/harness/model-selection.md
   ```

   ```json
   [{ "agent": "developer", "unit": "구현", "runtime": "<* 줄의 runtime>", "model": "<* 줄의 model>", "effort": "<* 줄의 effort>", "note": "" }]
   ```

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" add --table docs/harness/model-selection.md --rows _workspace/setup/model-rows.json
   ```

   `add`는 빈 `agent`나 `unit`, 칸 안의 `|`나 줄바꿈, `claude`·`codex` 밖의 runtime을 거절한다. runtime이 `claude`이면 목록 밖의 model(`opus`·`sonnet`·`haiku`·`fable`, 산정 행의 `복잡도`)과 effort(`low`·`medium`·`high`·`xhigh`·`max`), effort를 단 `haiku`나 `복잡도`도 거절한다. `codex`이면 빈 model만 거절하고 effort는 검사하지 않는다. runtime·model·effort가 모두 `*` 기본 줄과 같은 줄은 목록을 보지 않고 받는다. 그 값은 소유자가 정한 기본값이다(고정한 모델 ID 등). 이미 있는 (에이전트, 작업 단위) 줄도 거절한다. 거절되면 메시지를 보여 주고 이 에이전트의 나머지 단계로 가지 않는다.
2. 각 신규 역할은 **대상 프로젝트**의 `docs/harness/templates/agent.md`와 플러그인의 [전문 판단 질문](../../agent-author/references/agent-definition-template.md)을 함께 읽어 작성한다. `## 따로 두는 이유`에는 2절의 세 기준 가운데 이 역할에 참인 것과 그 근거를 적는다. 전문 역할은 [지정 원문 조사](../../agent-author/references/agent-corpus-research.md)로 판단 분기와 실패 신호를 비교하고 실제 프로젝트 경로·검증 증거·출처를 남긴다. `.claude/agents/<에이전트>.md`에는 위에서 수락한 문서·절만 배정한다. 직접 협의 경로는 양쪽에서 찾을 수 있게 하고 새 배정과 범위 변경은 배정자에게 올린다.
3. 스킬은 4절로 만들거나 고른다. 그 에이전트의 역할 파일 `- 로드할 스킬:` 줄과 `## 작업 단위와 스킬` 표에 같은 이름을 넣는다. `docs-management`는 모든 에이전트가 쓴다.
4. `docs/harness/agents.md`에서 기존 에이전트는 해당 행의 스킬·승인된 편집 범위만, 새 에이전트는 한 행(`| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |`)만 추가한다. 편집 범위는 다른 행과 겹치지 않게 한다. 기본 에이전트의 이름을 바꾸거나 빼면 역할 파일, 명단 행, 모델 표 행, 다른 역할의 직접 협업 행을 함께 고친다. setup이 깐 기본 에이전트의 역할 파일을 지우면 setup을 다시 돌려도 되살리지 않는다(`skipped`에 사유 `사용자가 지움`). 그 에이전트의 스킬 파일은 다시 깔린다. 사용자 선택에 따른 대기 표 변경은 해당 문서·절에만 적용한다.
5. 새 행과 파일이 모두 준비되면 추가·수정한 역할별로 프로젝트 루트에서 `node .claude/scripts/agent-definition.mjs --agent <에이전트>`를 실행하고 `node .claude/scripts/model-selection.mjs check`로 명단과 모델을 확인한다. Codex를 선택했다면 추가·수정한 역할마다 `node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <에이전트>`를 실행한다. 충돌(코드 2)은 기존 TOML을 보존하고 알린다. 기존 구형 정의를 읽거나 재동기화만 할 때는 신규 검사를 요구하지 않는다.
6. [내용 검사](../../agent-author/references/quality-checklist.md)로 더하거나 채운 스킬의 대표 사례(정상 하나, 실패 하나)를 따라가며 실제 판단·증거·협의 상대와 미확인 시 대응을 찾는다. 형식 검사와 별도로 결과를 보고한다.

## 6. 되묻기

만든 것을 표로 보여 주고 "더 필요한 스킬이나 에이전트가 있는지" 묻는다. 있으면 2절의 추천 표를 다시 만들고(방금 만든 것은 "있음") 3절로 간다.

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
복잡도 기준 여섯 줄, 고정할 역할, 승인 화면 Task 선택(기본 켬)을 함께 확인한다. Codex를 쓰면 치환표에 이 PC의 모델과 effort를 지정한다. 저장한 배열에는 기준표 행의 `rule`과 역할 행의 `fixed`도 있으므로 그대로 반영한다.

4. 사용자가 저장했다고 하면 ArtifactData로 읽는다: action `get`, 그 Artifact의 `url`, `collection` `model-selection`, `doc_id` `choices`. 문서는 `{ savedAt, choices: [{ agent, unit, runtime, model, effort }] }`이고 모든 줄이 들어 있다. `choices` 배열만 `_workspace/setup/model-choices.json`에 쓰고 반영한다.

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs" apply --table docs/harness/model-selection.md --choices _workspace/setup/model-choices.json
   node .claude/scripts/model-selection.mjs check
   ```

   바뀐 줄을 표로 보여 준다.
5. 문서가 없으면 사용자가 저장하지 않은 것이다. 표를 건드리지 않고 그렇게 알린다. 새 줄은 `*` 기본 줄 값 그대로다.
6. 저장이 실패하면 페이지가 같은 `choices` 배열을 복사 칸에 보여 준다. 사용자가 채팅에 붙여 넣은 배열을 `_workspace/setup/model-choices.json`으로 써서 4의 `apply`를 돌린다.
7. Artifact를 쓸 수 없으면 같은 줄을 채팅에 표로 보여 준다(새 줄은 추천값, 기존 줄은 지금 값과 추천). 고칠 줄만 받아 같은 `apply`로 반영한다. `choices`에는 바꿀 칸만 적는다. 새 줄은 사용자가 받아들인 추천값도 바꿀 칸이다. 없는 `model`, `effort`, `runtime` 키는 지금 값을 둔다.

## 8. 사라지는 것과 새 자리

0.5.1 프로젝트를 옮길 때(agent-author의 프로젝트 옮기기) 옛 팀 스킬과 옛 명단의 내용을 이 표대로 나눠 옮긴다.

| 사라지는 것 | 새 자리 |
| --- | --- |
| 팀 스킬의 에이전트 구성 표(맡는 일, 역할 스킬, 작업 단위) | 역할 양식의 `## 작업 단위와 스킬` 표 |
| 팀 스킬의 작업 흐름 표(순서, 산출물) | 같은 표의 `돌려주는 것` 칸과 스킬의 절차 |
| 팀 스킬의 직접 소통 짝 표에 있던 한도 | 역할 양식 `## 직접 협업` 표의 `한도` 칸 |
| 팀 스킬의 테스트 시나리오 | 스킬 양식의 `## 대표 사례` |
| 팀 스킬의 작업 규모별 모드 | 없앤다. 코디네이터가 일 단위로 배정한다 |
| 팀 명단의 팀장, 팀 스킬, 구분 | 없앤다 |
