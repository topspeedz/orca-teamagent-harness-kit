---
name: plan-orchestrate
description: "새 요구사항, 사용자가 지정한 백로그 ID, 한 phase 위임을 접수하고 PM 기획 세션과 설계·계획·실행 승인을 잇는다. 단독 PRD 작성과 계획 검토도 창구가 배정한다. 일반 단일 파일 수정은 공통 지침을 따른다."
---

# plan-orchestrate

창구는 실행 승인 전까지 각 워커를 직접 기동한다. 기획은 `product-manager` 세션 하나가 요구사항 정리부터 설계, 계획, 계획 대조까지 잇는다. 승인 이후에는 코디네이터가 배정과 마감을 감독한다.

## 접수 경로

창구는 프로젝트 루트에서 `node .claude/scripts/phase-routing.mjs intake`를 실행한다. 지정 항목은 `--ids BL-0001,BL-0002`, 기존 백로그 한 phase 위임은 `--delegated`를 붙인다. 지정 ID가 있으면 우선하며, 오류에 표시된 ID·선행 조건을 사용자에게 확인한다. 결과의 첫 담당과 승인 목록을 브리프에 옮긴다. 최종 계획은 PM이 해당 버전을 대조한다.

| 요청 | 첫 작업 | 실행까지의 승인 |
| --- | --- | --- |
| 새 요구사항 | PM이 원문 각 줄을 PRD·SRS·BL ID와 대조해 항목화하고, 같은 세션에서 누락·실행 가능성을 검토한다 | 전체 반영과 이번 묶음을 함께 확인 → 설계 승인 → 계획·실행 승인 |
| 사용자가 BL ID 지정 | 지정 ID로 PM이 바로 설계를 시작한다. 작거나 해법이 정해진 항목도 같다 | 설계 승인 → 계획·실행 승인 |
| 기존 백로그에서 한 phase 위임 | PM이 우선순위·연관성·선행 조건으로 목표 하나와 묶음·선정 이유를 정하고 같은 세션에서 설계로 잇는다 | 목표·이유·항목과 최종 예상 그림으로 계획·실행 승인 |

**검토는 PM의 단계다.** `요구사항 검토`와 `계획 대조`는 PM 세션이 `product-review`로 자기 단계로 한다. 다른 역할에 검토를 맡기는 단계는 없고, 사용자 승인이 그 자리의 확인이다.

지정 ID가 없거나 완료됐거나 선행 조건 때문에 범위를 넓혀야 하면 해당 ID와 사유를 창구가 사용자에게 올린다. 위임 경로에서는 묶음과 설계를 중간에 승인받지 않는다. 사용자가 최종 화면에서 범위를 바꾸면 영향받은 계획·그림·리뷰를 갱신한다. 이미 승인한 설계는 브리프에 그 결정과 범위를 적고 계획부터 잇는다.

단독 PRD 작성은 PM의 `요구사항 정리` → `요구사항 검토`, 단독 계획 대조는 PM의 `계획 대조`로 끝낸다. 새 제품 결정은 PM이 브리프의 근거와 함께 창구로 올린다.

## 재개

프로젝트 루트에서 `node .claude/scripts/phase-resume.mjs <phase>`로 조회한다. `_workspace/_run/<phase>/brief.md`의 사용자 결정·BL·Run, 같은 폴더의 설계·계획 리포트·장부·Task 대응표, `_workspace/product/<phase>/`의 PM 리포트를 읽는다. 계획·DAG 기본 경로의 현재 해시도 출력한다. 브리프가 다른 정본을 지정하면 그 파일과 당시 검토 기록을 직접 대조한다.

먼저 기존 실행을 확인한다. 실행 Run, 대응표, 코디네이터 Dispatch, 장부 중 하나라도 실행 흔적이 있으면 `coordinator/references/recovery.md`로 Run·Task·Dispatch와 장부를 대조한다. 창구 Run에는 기획 워커도 있으므로 누가 받은 Dispatch인지 확인한다. 이미 정산한 Dispatch와 message id는 건너뛴다. 등록 Task는 기존 대응표, 미등록 Task는 당시 승인 자료에서 배정을 찾고 근거가 부족한 Task만 창구에 올린다.

| 있는 기록 | 다음 작업 |
| --- | --- |
| 새 요구이며 요구사항 정리나 생략 근거가 없음 | PM이 PRD·SRS와 원문 대조 결과를 작성 |
| 요구사항 정리는 있고 항목 리포트가 없음 | PM이 항목화하고 BL ID·수락 기준·묶음 이유를 남김 |
| 항목화 뒤 새 요구 검토가 없거나 열린 High가 있음 | PM의 요구사항 검토, 열린 High면 PM이 고치고 그 결함 ID를 다시 본다 |
| 새 요구 검토 뒤 묶음 확인이 없음 | 전체 반영 여부와 묶음을 한 번에 확인 |
| 지정/선정된 묶음이 있음 | 미완료 설계·계획부터 진행. 위임 경로의 중간 승인 생략 |
| 계획이 있으나 그 버전의 계획 대조가 없음 | PM이 현재 계획과 DAG를 대조하고 `review` 해시를 남긴다 |
| 현 버전 검토 완료·실행 승인 전 | 최종 예상 그림과 해당 버전으로 승인 요청 |
| 같은 버전의 검토·계획 실행 승인 완료 | 당시 검토한 계획·DAG, BL, 그림, 승인 질문과 날짜 있는 응답 원문을 대조한다. 기존 코디네이터 기동 여부를 확인한 뒤 미기동이면 창구 절차로 한 번 인계 |

구 phase의 `01_prd-writer_requirements_v*.md`는 요구사항 작성, `03_pm-reviewer_review_v*.md`와 `03_planner_review_v*.md`는 요구 검토, `06_pm-reviewer_plan-check_v*.md`는 계획 대조, Run 폴더의 `03_planner_design_v*.md`와 `04_planner_plan_v*.md`는 설계와 계획에서 읽는다. 새 이름의 리포트도 같은 작업에 모인다. 파일명의 숫자는 리포트 회차다. 각 본문의 검토 대상 버전·BL·열린 결함과 브리프의 승인 원문을 확인한다. 검증 줄이 통과해도 열린 High가 있으면 해당 결함만 원작성자에게 돌린다. 계획·DAG가 달라졌으면 영향받은 범위만 다시 검토·승인받는다. 검토·승인·기동 여부가 불분명하면 기존 파일을 보존하고 빠진 근거만 창구에 올린다.

## 1. 설문 (창구)

`superpowers:brainstorming`의 문답 절차로 사용자와 문답한다. 문서는 쓰지 않는다. 요구사항, 설계와 계획은 PM이 쓴다.

- phase 이름은 `<YYYY-MM-DD>-<주제>`이다. 양식 `docs/harness/templates/brief.md`로 `_workspace/_run/<phase>/brief.md`를 쓴다. 문답과 사용자 결정 원문을 날짜와 함께 `## 사용자 결정`에 적는다.
- **설문에서 반드시 묻는 것:** 새 의존성, 기술 결정 변경, 외부에 쓰는 행위, 비용. 이 넷은 이 단계에서 끝낸다. 뒤 단계에서 처음 나오면 설계가 아니라 사용자 결정으로 다시 묻는다.
- 요구사항이 여럿이면 각각의 중요도와 그 근거, 닿는 사용자 수를 아는지와 그 숫자의 출처를 묻는다. 숫자가 오면 우선순위(RICE)에 쓰고, 없으면 등급만 쓴다. 모르는 것은 모른다고 적는다.
- 맥락 조사는 `AGENTS.md`의 정본 문서 목록, `docs/DOCUMENTATION_INDEX.md`, `docs/backlog.md`부터 한다. 기존 결정과 충돌하면 기획으로 정하지 않고 사용자에게 묻는다.

## 기획 세션은 하나다

기획 단계에서 창구는 `product-manager` 세션 하나를 쓴다. 한 세션이 자기 단계를 차례로 잇는다(요구사항 정리, 항목화, 요구사항 검토, 설계, 계획, 계획 대조). 단계마다 새로 띄우면 워커가 같은 정본을 처음부터 다시 읽는다.

- **단계의 끝은 `ask`다.** 워커는 한 단계를 마치면 `worker_done`이 아니라 `ask`로 리포트 경로를 올리고 턴을 끝낸다. `worker_done`은 창구가 마지막이라고 알린 단계에서 한 번 보낸다. spec의 `보고` 줄에 이 순서를 적는다.
- **창구는 `ask`마다 그 단계를 정산한다.** 리포트 파일이 있는지와 `node .claude/scripts/report-check.mjs <리포트 경로>`를 본다. 사용자에게 물을 것(결정, 승인)을 묻고 답을 원문과 날짜로 브리프에 더한다.
- **다음 단계와 사용자 결정은 그 질문에 `reply`로 돌려준다.** 본문에 다음 단계의 spec 경로, 브리프에 더한 결정, 고칠 결함 ID를 적는다. 결정을 반영한 재작업과 검토 결함의 수정도 같은 방법으로 맡긴다.
- **세션의 배정은 하나다.** 모델 표의 `product-manager / 기획` 행(setup에서 사용자가 정한 고정 값)으로 띄우고, 요구에서 계획까지 같은 값으로 잇는다. 사용자가 다른 model·effort를 지시하면 그 원문을 브리프와 spec의 `사용자 예외:` 줄에 적고 기동 명령에 같은 원문을 `--override-reason`으로 넘긴다. 세션의 model과 effort는 띄울 때 정해지므로 그 값은 새로 띄우는 세션에만 적용된다.
- `worker_done`을 보낸 세션에는 일을 보태지 않는다. 세션이 죽었으면(화면에서 확인한 뒤) 그 단계부터 새로 띄우고 이전 리포트 경로를 spec에 넣는다.

## 2. 기획 (창구가 PM 세션을 띄운다)

PM은 `requirements-write`·`backlog-management`로 작성하고 `product-review`로 요구사항을 검토한다. 리포트는 `_workspace/product/<phase>/`에 `01_product-manager_requirements_v<N>.md`, `02_product-manager_backlog_v<N>.md`, `03_product-manager_review_v<N>.md`, `06_product-manager_plan-check_v<N>.md`로 기록한다. 다음 단계의 spec에 앞 리포트와 버전을 적는다. High 결함은 PM의 수정과 그 결함 ID의 재검토를 최대 2회까지 돌리고 여전히 열려 있으면 사용자에게 올린다. 워커 자체 실패는 사유와 이전 파일을 갖고 1회 재기동한 뒤 창구에 보고한다.

- spec은 양식 `docs/harness/templates/spec.md`로 `_workspace/product/<phase>/spec/`에 쓴다. 담는 것: 브리프 경로, 앞 단계의 리포트 경로, 지금의 PRD·SRS·백로그 경로, 산출물과 리포트 경로, 다시 띄울 때는 이전 리포트와 결함 ID.
- 배정 줄은 모델 표에서 읽는다: `node .claude/scripts/model-selection.mjs lookup --agent product-manager --unit 기획`.
- 기동은 `node .claude/scripts/orca-launch.mjs worker --agent product-manager --unit 기획 --spec-file <spec> --bracket <phase> --does <하는 일>`만 쓴다. 처음 띄운 `창구 Run` 칸이 비어 있으면 영수증의 Run ID를 적는다.
- 대기와 정산은 아래 "설계·계획 단계의 spec"의 마지막 줄과 같다.
- PM 리포트의 `## 사용자 결정 필요`는 아래 "왕복"과 같은 방법으로 처리한다.

### 묶음 승인

검토에 열린 `High`가 없으면 먼저 PM 리포트의 `## 사용자 결정 필요`(등급, RICE 추천값 포함)를 묻고, 답을 브리프에 더한 뒤 PM 세션에 돌려줘 확정 값으로 순서와 묶음 제안을 다시 쓰게 한다. 그다음 창구가 묶음 승인을 묻는다. 질문에는 원문 요구의 반영표, 전체와 이번 묶음의 항목 수·ID, 남은 항목, 목표, 우선순위·복잡도 근거, 남은 Medium 이하 쟁점을 싣는다. 이 질문은 새 요구 경로에서만 한다.

- 승인 답은 원문과 날짜로 브리프의 `## 사용자 결정`에 적는다. 승인된 이번 묶음의 백로그 ID를 브리프의 `## 백로그 항목`에, 목표 한 문장을 `## 목표`에 적는다.

## 3~4. 설계와 계획 (같은 PM 세션이 잇는다)

### 설계 전 조사

설계에 출처를 모아야 하는 질문이 있으면(PM이 리포트에 조사를 요청했거나 창구가 문답에서 그렇게 판단했으면) 창구가 설계 전에 `research`를 띄운다. 그 spec은 아래 "설계·계획 단계의 spec"과 같이 `_workspace/_run/<phase>/spec/`에 쓴다. 조사 리포트 경로는 설계 단계 spec의 `먼저 읽을 것`에 넣는다.

- `research / 조사`는 산정 행이라 점수 없이는 뜨지 않는다. 창구가 질문의 C·U·R·V·F 값과 근거를 `phase-planning`의 배정 절과 같은 형식으로 쓰고 `node .claude/scripts/model-routing.mjs plan --agent research --unit 조사 --input <근거.json>`으로 배정을 얻어 spec의 배정 줄에 적는다.
- 기동은 같은 점수를 평가 파일 `{ "input": <근거.json의 내용>, "reason": "<점수의 근거를 대조한 결과>" }`로 붙인다: `node .claude/scripts/orca-launch.mjs worker --agent research --unit 조사 --spec-file <spec> --bracket <phase> --does <하는 일> --assessment <평가.json>`.
- 대기와 정산은 아래 "설계·계획 단계의 spec"의 마지막 줄과 같다.

### 설계·계획 단계의 spec

양식 `docs/harness/templates/spec.md`로 `_workspace/_run/<phase>/spec/`에 쓴다. 담는 것은 다음 여섯 가지다.

| 항목 | 내용 |
| --- | --- |
| 목표 | 이번 문서가 답할 것 한두 문장. 설계서의 목표는 브리프의 `## 목표`다 |
| 브리프 경로 | `_workspace/_run/<phase>/brief.md`. 사용자 결정 원문과 승인된 묶음(`## 백로그 항목`)은 여기서 읽는다 |
| 범위와 금지 | 다룰 범위(승인된 묶음), 다루지 않을 것, 고치지 않을 파일 |
| 산출물 경로 | 설계서 또는 계획서, 그림 입력 파일(`_workspace/_run/<phase>/dag.json`, `waterfall.json`) |
| 문서 종류 | 설계 또는 계획 |
| 리포트 경로 | `_workspace/_run/<phase>/NN_product-manager_<design 또는 plan>_v<N>.md`. `NN`은 이 스킬의 단계 번호(03 설계, 04 계획) |

- 배정 줄은 기획 세션의 것(`배정: product-manager / 기획 (<런타임> <model>/<effort>)`)을 그대로 쓴다.
- 설계 단계의 spec 경로는 묶음 승인 뒤(지정·위임 경로에서는 접수 뒤) `reply`로 PM 세션에 돌려준다. 계획 단계도 설계를 정산한 뒤 같은 방법으로 돌려준다. 지정 경로처럼 띄워 둔 세션이 없으면 위 2절의 기동 명령으로 띄우고 영수증의 Run ID를 브리프의 `창구 Run` 칸에 적는다.
- 띄운 뒤에는 아래 대기 절대로 기다린다. 창구의 수신함은 `run:<창구 Run>`이다. 정산은 단계를 마친 `ask`와 마지막 `worker_done`마다 기대한 Dispatch인가, 리포트 파일이 있는가, `node .claude/scripts/report-check.mjs <리포트 경로>`가 통과하는가를 본다.

### `## 사용자 결정 필요` 왕복

PM은 spec에 없는 결정을 정하지 않고 문서와 리포트 끝 `## 사용자 결정 필요`에 추천 하나와 함께 적는다. 창구는 이렇게 처리한다.

1. 창구가 그 목록을 사용자에게 묻는다.
2. 답을 원문과 날짜로 브리프의 `## 사용자 결정`에 더한다.
3. 답을 그 세션에 돌려줘 다시 맡긴다(위 기획 세션). `worker_done`을 보낸 세션이면 새로 띄우고 이전 문서 경로를 spec에 넣는다.
4. 목록이 비면 승인 질문으로 간다.

PM이 단계의 끝이 아닌 때에 `ask`를 쓰는 것은 문서를 쓸 수 없을 만큼 막혔을 때뿐이다.

### 계획 대조

계획서가 나오면 PM이 같은 세션에서 `계획 대조`를 한다. BL별 수락 기준·Task·의존·쓰는 파일·배정과 승인 범위를 대조하고 검토한 버전, BL ID, 결과, 열린 쟁점을 보고한다. 열린 High는 PM이 계획을 고치고 그 결함을 다시 확인한다. 최대 2회 뒤에도 High가 남으면 창구로 올린다. Medium 이하는 승인 질문에 싣는다.

### superpowers 기본값 덮어쓰기

PM은 문서 형식을 위해 `superpowers:brainstorming`(설계서)과 `superpowers:writing-plans`(계획서)를 로드하고 아래 다섯 가지를 덮어쓴다. 문답 단계는 창구가 이미 했으므로 PM은 문서만 쓴다.

1. 설계 문서를 바로 커밋하지 않는다.
2. 계획에 Task마다 커밋 단계를 넣지 않는다. 워커는 커밋하지 않는다.
3. 계획서 머리의 "서브에이전트로 실행" 안내 대신 `> 실행: Orca`를 적는다.
4. 끝의 실행 방식 질문(서브에이전트 또는 인라인)을 하지 않는다. 계획 승인만 받는다.
5. 실행은 Orca로만 한다. `superpowers:subagent-driven-development`, `superpowers:executing-plans`, 서브에이전트 도구로 실행하지 않는다.

계획서의 `## DAG` 절 형식과 Task를 나누는 규칙은 `phase-planning`이 정본이다. 여기에 옮겨 적지 않는다.

### 승인 그림

창구가 해당 경로의 승인 시점마다 대기 상태의 DAG와 T+ 예상 워터폴을 보여 준다. 위임 경로는 최종 실행 승인에서 두 그림을 함께 보여 준다. 그림은 계획서에 넣지 않는다. 처음 게시할 때 그 주소를 브리프의 `그림:` 줄에 적는다. 새 계획의 승인본은 v2 점수와 Task별 직접 지정·위임을 표시하는 키트의 `dag-swimlane/scripts/render.mjs`로 그린다. setup이 전역 그림 스킬을 선택했다면 설치한 키트의 `template/.claude/skills/dag-swimlane/scripts/render.mjs`를 사용한다.

| 단계 | 굵기 | 그림 |
| --- | --- | --- |
| 설계 승인 | 에이전트 단위의 굵은 흐름 | PM이 쓴 입력 파일로 `dag-swimlane`과 `waterfall-timeline` |
| 계획 승인 | Task 단위 | 같은 두 스킬. 스윔레인 노드마다 런타임, model, effort가 보인다 |

- 계획 승인 질문에 폭을 숫자로 넣는다: 작업 시간 합 ÷ 임계 경로 길이, 슬롯 수, 최대 동시 Task 수. 값은 계획서의 `## DAG` 절 끝에서 옮긴다. `검증 워커 ÷ 구현 워커`와 그 이유, `afterFix`가 붙은 Task와 그 사유도 싣는다.
- 최종 계획을 PM이 검토하면 창구는 승인 대상 버전과 준비된 그림을 보여 주고 ask(Claude의 `AskUserQuestion` 또는 Codex의 선택형 질문 도구)로 “이 계획을 Orca로 실행할까요?”를 묻는다. 기본 선택지는 1·2번이다. setup에서 Task 선택이 켜져 있고 해당 버전의 `dag.json`에 직접 지정할 수 있는 Task가 있을 때만 3번을 추가한다. 선택용 DAG가 없으면 경로를 묻지 않고 기본 질문을 띄운다. 3번을 고른 뒤 선택용 DAG가 없어진 경우에도 1·2번으로 다시 묻고 답을 기다린다.
  1. **승인** — 표시한 버전, Task의 배정과 기동 직전 위임 여부를 함께 승인한다. 질문에 자동 재평가할 배정과 직접 고정한 배정을 구분해 보여 준다. 사용자가 이미 그림에서 선택을 저장했다면 3번과 같은 절차로 현재 그림의 저장값을 대조하고, 검토본과 다른 선택은 먼저 새 버전에 반영해 확인받는다.
  2. **거절** — 응답을 브리프에 기록하고 실행 절차를 멈춘다.
  3. **모델 직접 지정 후 승인** — 선택용 DAG를 `capabilities: {db: {}}`로 게시하거나 로컬 HTML로 연다. 사용자는 고정 역할을 제외한 Task마다 모델·effort·런타임, 직접 지정 또는 기동 시 재평가를 고른다. 추천과 같은 값도 직접 고정할 수 있다. Artifact에서 `ArtifactData list choices` 전체를 `[{id,data}]` 배열로 저장하거나, 로컬 그림의 **선택 파일 저장**으로 같은 형식의 JSON을 받는다. 창구가 `node .claude/scripts/dag-routing-choices.mjs --dag <그림 원본.json> --choices <선택.json> --out <새 DAG.json>`을 실행하고 반영된 ID를 확인한다. 선택 내용을 계획·브리프·spec에 옮기고 PM이 바뀐 버전을 검토한다. 창구는 최종 그림을 보여 주고 사용자 승인 응답을 받은 뒤 실행한다.
- PM이 `node .claude/scripts/orca-launch.mjs review --version <vN> --plan <계획.md> --dag <dag.json>` 결과의 review 해시를 검토 리포트에 남긴다. 창구는 같은 버전·해시로 그림을 보여 주고 사용자 원문과 날짜를 브리프에 적는다. 승인 대상이 바뀌었으면 새 버전으로 다시 검토한다.
- `node .claude/scripts/orca-launch.mjs approve --version <vN> --plan <계획.md> --dag <dag.json> --review <PM이 확인한 해시> --response "<승인 원문>"`으로 승인 파일을 고정한다. 코디네이터 spec에 그 경로를 싣는다. 실행 중에는 코디네이터가 같은 파일 경로로 다시 게시해 같은 주소에서 진행을 보여 준다.

## 5~8. 계획 승인 뒤

창구는 브리프에 설계서·계획서 경로, 슬롯 수, 지정·선정·승인한 BL을 적는다. `coordinator/references/front-desk.md`의 기동 명령에 승인 파일, 버전, 검토한 계획과 DAG를 함께 넘긴다. 실행·정산·검증·수정 루프는 `coordinator`가 정본이다.

- **7단계 하네스 회고는 조건이 맞을 때 띄운다.** 조건과 `skip`은 `coordinator`가 정본이다. 띄우지 않아도 측정 표는 코디네이터가 남긴다. 띄운 회고가 고칠 근거를 못 찾으면 측정 결과와 "변경 없음"만 남긴다.
- **커밋은 8단계에서 코디네이터가 승인 뒤 한 번에 한다.** 회고가 고친 하네스 파일은 같은 PR의 별도 커밋이다.
- **워커는 커밋하지 않는다.** 같은 작업 트리를 함께 쓰므로 서로의 변경이 섞인다. 커밋은 코디네이터가 경로를 지정해서 한다.

## 대기

대기는 이 명령 하나로 건다. heartbeat, 재배달, 워커의 재전송, 타임아웃은 명령이 거르고 처리할 메시지만 돌려준다.

```text
node .claude/scripts/orca-launch.mjs wait --inbox <내 수신함>
```

- `<내 수신함>`은 `run:<Run ID>`다(코디네이터는 실행 Run, 창구는 창구 Run).
- 하네스가 추적하는 백그라운드 작업으로 건다(Claude Code: Bash `run_in_background: true`). 다른 명령과 한 줄에 묶지 않고, 한 세션에 하나만 건다.
- 끝났다는 알림을 받으면 출력의 `messages`를 모두 처리한 뒤에만 다시 건다. 대기가 가져간 메시지는 다시 오지 않는다. 출력을 잃었으면 `--last`를 붙여 마지막 묶음을 다시 본다.
- 대기가 걸려 있는 동안 "You have N orchestration messages" 알림이 오면 도구 호출 없이 턴을 끝낸다.
- `idle: true`는 빈 대기가 세 번 이어졌다는 뜻이다. `orca orchestration worker-list`로 워커 생존을 본다. 침묵만으로 종료로 판정하거나 다시 띄우지 않는다. 올 보고가 오지 않으면 `orca orchestration inbox --terminal <내 수신함> --limit 20`으로 읽기만 한다.
- Codex는 대기를 걸지 않는다. 끝난 백그라운드 명령이 Codex를 깨우지 못한다. 할 일을 마치면 턴을 끝내고, "You have N orchestration message" 알림이 오면 같은 명령에 `--once`를 붙여 한 번 돌린다.
