---
name: setup
description: 이 프로젝트에 하네스를 세운다. "하네스 키트 세팅", "orca-teamagent 깔아줘", "이 저장소에 Orca 하네스 세팅", "CLAUDE.md 구조 잡아줘", "문서 라우팅 설계", "승인 게이트 설계", 새 저장소·모듈 부트스트랩, 세팅을 다시 돌려 빠진 것 채우기에 사용. Orca 멀티 에이전트 틀(공통 지침, 에이전트 5개, 절차·역할·팀 스킬, 훅 5개, 기동·검사 스크립트, 설정, 문서 뼈대)을 깔고 검증하고, 기반(항상 로드되는 지침, 실제로 돌려 본 검증 명령, 금지·승인 게이트, 문서 라우팅, 토큰 기준선)을 설계한다. Orca를 쓰지 않으면 기반만 설계한다. 프로젝트의 지난 작업을 보고 팀과 팀원을 추천해 사용자가 고른 대로 만든다.
---

# 하네스 세팅

프로젝트 루트에서 실행한다. 아래 경로는 플러그인 안의 것이다.

- 스크립트: `${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs`
- 틀: `${CLAUDE_PLUGIN_ROOT}/template` (Codex를 고르면 `${CLAUDE_PLUGIN_ROOT}/template-codex`도)
- 세션 분석: `${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/session-digest.mjs`
- 모델 표: `${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/model-table.mjs`
- 기반 설계 절차: [references/foundation.md](references/foundation.md)

## 0. 범위 판정

Orca DAG로 워커를 굴리는지 먼저 정한다. 요청에서 알 수 없으면 묻는다.

| 상황 | 하는 일 |
| --- | --- |
| Orca로 굴린다 | 1~9단계 전부 |
| Orca를 쓰지 않는다 | 1단계 점검 → 6단계 기반 설계 → 9단계 보고. 2~5단계(Orca 틀)와 7~8단계는 하지 않는다 |
| 하네스가 있는 저장소의 새 모듈 | 6단계의 범위 모드만 |
| 빈 저장소(코드와 명령이 없다) | Orca로 굴리면 1~5단계 뒤 6단계의 빈 저장소 처리, 아니면 6단계의 빈 저장소 처리만 |
| 이미 깔린 하네스가 오작동한다 | 이 스킬의 범위가 아니다. 알리고 멈춘다 |

다시 실행해도 된다. 같은 내용의 파일은 건너뛰고 빠진 것만 채운 뒤 검증을 다시 돌린다. 세팅이 깐 뒤 사용자가 고친 파일은 건너뛴다(깔 때 `.claude/harness-install.json`에 남긴 해시와 다르면 `skipped`에 사유 `사용자가 고침`으로 나온다). 그 기록에 없는 파일이 틀과 다르면 충돌로 올릴 뿐 승인 없이 덮어쓰지 않는다.

하지 않는 것:

- 사용자가 고르지 않은 팀과 에이전트를 만들지 않는다. 기존 에이전트 5개와 팀 3개의 정의를 고치지 않는다.
- 프로젝트에 없는 검증 명령을 지어내지 않는다.
- 빠진 전제(Orca, Node, superpowers 등)를 대신 설치하지 않는다.

## 1. 점검

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" inspect --target .
```

출력 JSON을 사용자에게 표로 보여 준다.

| 칸 | 거짓이거나 비었을 때 |
| --- | --- |
| `git` | git 저장소가 아니다. 알리고 계속할지 묻는다 |
| `orca` | Orca CLI가 없다. 코디네이터와 워커를 띄울 수 없다고 알린다 |
| `superpowers` | 계획 도구(`brainstorming`, `writing-plans`)가 없다고 알린다 |
| `globalDiagramSkills` | 참인 그림 스킬은 전역 사본을 쓰고 프로젝트에 깔지 않는다 |
| `codex` | Codex를 함께 쓸 수 없다. 2단계의 Codex 질문에 이 사실을 붙인다 |
| `existing` | 이미 있는 지침·설정 파일. 3단계에서 충돌로 올라올 수 있다고 알린다 |

`existing`에 `package.json`이나 `Makefile`이 있으면 읽어서 프로젝트의 검증 명령(테스트, 린트, 빌드)을 찾아 보고에 적는다. 없으면 없다고 적는다.

## 2. 질문 (다섯 개, 두 번에 나눠)

**첫 번째 (질문 도구로 네 개).**

1. Codex를 함께 쓰는가 (예 / 아니오).
2. 사람 승인이 필요한 행위는 무엇인가. 명령의 접두어로 받는다(예: `git push`, `gh pr create`, 배포 명령). 여러 개를 고를 수 있게 하고 직접 적을 수 있게 한다.
3. 코디네이터 터미널의 권한 모드: `default` / `acceptEdits` / `bypassPermissions`. `default`와 `acceptEdits`에서는 승인 목록에 없는 셸 명령마다 코디네이터가 승인 화면에서 멈추고, 사용자가 그 터미널에서 직접 승인해야 이어진다(멈추면 Orca가 창구에 `escalation`으로 알린다). 지켜보지 않고 돌릴 것이면 `bypassPermissions`를 고르라고 함께 알린다. 승인이 필요한 명령은 권한 질문이 실제로 뜨는 세션만 실행한다는 것을 함께 알린다. 승인 없이 도는 모드면 코디네이터는 커밋까지만 하고 push와 PR은 창구에 넘긴다.
4. planner의 effort: `max` (권장) / `high`. `max`는 설계와 계획에 1~2시간이 걸리지만 한 번에 완전한 워크플로와 검증이 되므로 권장한다고 함께 알린다. model은 묻지 않는다. 표의 `opus`가 기본값이다.

**두 번째 (코디네이터에 남길 플러그인과 스킬).** 이 기계의 목록을 읽는다.

```sh
node "${CLAUDE_PLUGIN_ROOT}/template/.claude/scripts/coordinator-settings.mjs" inventory
```

목록을 표로 보여 주고 남길 것을 적어 달라고 한다. 선택지가 많아 질문 도구로 고르게 하지 않는다.

- 기본으로 남는 것은 감독 절차에 꼭 필요한 것뿐이다: `coordinator`, `orchestration`, `orca-cli`, `dag-swimlane`, `waterfall-timeline`.
- 남길 근거는 코디네이터나 그 세션의 서브에이전트가 실제로 부르는 것, 절차에 로드하라고 적힌 것이다. 워커 spec에 적어 넘기는 스킬은 워커가 로드하므로 남길 근거가 아니다.
- 끄면 잃는 기능을 고르기 전에 알린다. 예: 메모리 플러그인을 끄면 코디네이터 세션은 기록되지 않는다.

답을 `_workspace/setup/answers.json`에 쓴다(`_workspace/`는 깔기 뒤 `.gitignore`로 빠진다). 다시 실행할 때는 이 파일을 보여 주고 바꿀 것만 묻는다.

```json
{
  "codex": false,
  "approvalPrefixes": ["git push"],
  "coordinatorPermissionMode": "default",
  "planner": { "effort": "max" }
}
```

남길 목록은 이 파일에 넣지 않고 4단계에서 쓴다.

## 3. 깔기

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" install --target . --answers _workspace/setup/answers.json
```

스크립트가 하는 일:

- 없는 파일은 복사하고, 같은 내용의 파일은 건너뛴다.
- `.claude/settings.json`은 훅, `permissions` 항목, 없는 `env` 키만 더한다. 프로젝트가 이미 정한 `env` 값은 바꾸지 않는다. `.gitignore`는 없는 줄만 덧붙인다. 둘은 충돌로 올리지 않는다.
- 승인 접두어를 `permissions.ask`(`Bash(<접두어>:*)`, `PowerShell(<접두어>:*)`)와 `.claude/hooks/approval-gate.config.json`에 넣는다. 둘은 늘 같이 고친다. `permissions.ask`에만 있으면 무인 워커가 확인 화면에서 멈춘다.
- 모델 표 `docs/harness/model-selection.md`의 planner 줄에 고른 effort를 넣는다. model은 표의 값을 그대로 둔다.
- 전역에 있는 그림 스킬은 건너뛴다(사유 `전역에 있음`).
- `.claude/coordinator.keep.json`이 없으면 `coordinator-settings.mjs init-keep`으로 만들고, `permissionMode`에 고른 권한 모드를 넣는다.

출력의 `conflicts`가 비지 않으면(코드 2) 내용이 다른 기존 파일이다. 파일마다 차이를 보여 준다.

```sh
git diff --no-index -- "${CLAUDE_PLUGIN_ROOT}/template/<경로>" "<경로>"
```

모델 표와 `approval-gate.config.json`은 틀에 답을 넣은 값으로 비교된다는 것을 함께 알린다. 사용자가 덮어써도 된다고 한 경로만 쉼표로 이어 다시 실행한다.

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" install --target . --answers _workspace/setup/answers.json --approve "CLAUDE.md,AGENTS.md"
```

승인받지 못한 충돌은 그대로 두고 보고에 적는다.

## 4. 생성

`.claude/coordinator.keep.json`에서 2단계에서 남기기로 한 항목을 `"keep"`으로 바꾼다. 나머지는 `"off"`로 둔다. 그다음 코디네이터 설정을 만든다.

```sh
node .claude/scripts/coordinator-settings.mjs generate
```

출력의 `kept`, `off`, 미분류 개수를 보고에 옮긴다. `경고: 분류되지 않은 항목`이 나오면 그 항목을 남길 목록에 넣을지 사용자에게 묻는다.

## 5. 검증

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.mjs" verify --target .
```

`.claude/` 아래 셀프테스트 전부, `node .claude/scripts/model-selection.mjs check`, `node .claude/scripts/wait-contract-check.mjs`를 돌려 표로 찍는다. 하나라도 실패하면 코드 1이다. 실패를 고치려고 틀의 파일을 고치지 않는다. 실패한 줄을 그대로 보고에 옮긴다.

## 6. 기반 설계

[references/foundation.md](references/foundation.md)를 읽고 따른다. Orca 틀을 깔았으면 깔린 `AGENTS.md`와 `.claude/settings.json`을 채우고, 깔지 않았으면 그 문서의 뼈대로 새로 쓴다.

- 1단계에서 찾은 검증 명령을 실제로 한 번씩 돌려 표로 남기고(V1), 통과한 명령만 지침의 `명령` 절에 적는다.
- 어느 세션에서도 금지할 명령을 물어 `permissions.deny`에 더한다.
- 문서 라우팅 표를 채우고 `/context`로 토큰 기준선을 잡는다.

파일을 쓰거나 설정을 바꾸기 전에 범위를 보여 주고 승인받는다. 다시 실행할 때는 이미 채워진 절을 건드리지 않고 빈 것만 묻는다.

## 7. 팀 구성

[references/team-composition.md](references/team-composition.md)를 읽고 따른다. 시작하기 전에 사용자에게 권한다: 팀 설계는 무거운 일이니 지금 세션의 모델이나 effort를 높여 달라(예: `/model opus`, `/effort max`). 권한 뒤 턴을 끝내고 답을 기다린다. 사용자가 높였다고 하거나 그대로 하라고 하면 이어 간다.

1. 지난 세션 기록과 기존 파이프라인을 모은다(`session-digest.mjs`).
2. 근거와 함께 팀과 팀원을 추천하고 설문으로 고르게 한다: 추천대로 / 골라서·고쳐서 / 직접 적기 / 지금은 만들지 않음.
3. 고른 대로 팀 스킬, 팀원 에이전트, 필요한 역할 스킬을 만들고 명단과 모델 표에 올린다.
4. "더 필요한 팀이나 팀원이 있는지" 묻는다. 없다고 할 때까지 2~3을 되풀이한다.

## 8. 모델 표

[references/team-composition.md](references/team-composition.md)의 "모델 표 설문"을 따른다. 표의 모든 줄을 Artifact 페이지로 띄운다. 새 팀의 줄은 추천값으로 채우고, 기존 줄은 지금 값을 두고 추천을 참고로만 보여 준다. 사용자가 저장했다고 알리면 그 값을 읽어 표에 반영하고 `node .claude/scripts/model-selection.mjs check`를 돌린다. 사용자가 저장하지 않은 값은 표에 쓰지 않는다.

## 9. 보고

사용자에게 다음을 알린다. Orca 틀을 깔지 않았으면 6단계의 것만 알린다.

- 깔린 것: 3단계의 `written`.
- 건너뛴 것: `skipped`와 사유, 승인받지 못한 `conflicts`.
- 실패한 검증: 5단계 표의 ❌ 줄, 8단계 `node .claude/scripts/model-selection.mjs check`가 실패했으면 그 출력.
- 8단계의 결과: 모델 표에서 바뀐 줄(없으면 없다고)과 `node .claude/scripts/model-selection.mjs check`의 결과.
- 6단계의 산출물: V1 표(검증 명령이 없으면 없다고), 게이트 표(deny, ask, 훅), 라우팅 표, 토큰 기준선(또는 측정하지 못한 사유), 하지 않기로 한 것.
- 다음 할 일: 만든 팀과 팀원, 건너뛴 추천. 팀을 나중에 더 넣으려면 setup을 다시 돌리거나 양식(`docs/harness/templates/`의 팀 스킬·에이전트 양식과 명단 `docs/harness/team-org.md`)으로 직접 넣는다.
- 브라우저 설정: 이 프로젝트의 세션은 기본으로 Playwright 브라우저를 창 없이, 세션마다 따로 띄운다(QA를 병렬로 돌리기 위한 값이다). 직접 여는 세션에서 창이 보이고 로그인 상태가 유지되는 브라우저를 쓰려면 `claude --settings .claude/front-desk.settings.json`으로 열어야 한다고 전한다.
- 워커의 깊이: 이 틀은 워커를 세 단(코디네이터, 팀장, 팀원)까지 띄운다. Orca는 워커가 워커를 띄우는 깊이에 한도를 두므로, 팀장이 팀원을 띄우지 못하면 Orca 설정에서 그 한도를 확인해야 한다고 전한다.
- force push: 막지 않고 항상 사용자 승인을 거친다. 대화형 세션은 확인 질문을 받고, 무인 워커는 승인 훅이 막은 뒤 `ask`로 올린다. 어느 세션에서도 막아야 하는 명령이 따로 있으면 `permissions.deny`에 넣으라고 전한다.
- 워커의 권한 모드: `worker-start`로 뜨는 워커의 권한 모드는 명령 옵션으로 정할 수 없고 Orca의 "새 에이전트 탭" 설정을 따른다. 그 설정의 위치는 CLI에서 확인하지 못했으므로 Orca 설정 화면에서 직접 찾아야 한다고 전한다.
