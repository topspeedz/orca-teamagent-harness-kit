---
name: plan-orchestrate
description: "새 요구사항, 사용자가 지정한 백로그 ID, 한 phase 위임을 접수하고 운영팀과 설계·계획·실행 승인을 잇는다. 단독 PRD 작성과 계획 검토도 창구가 배정한다. 일반 단일 파일 수정은 공통 지침을 따른다."
---

# plan-orchestrate

창구는 실행 승인 전까지 각 워커를 직접 기동한다. 운영팀의 `product-manager`와 `planner`는 파일과 브리프로 인계하는 동료다. 승인 이후에는 코디네이터가 배정과 마감을 감독한다.

## 접수 경로

창구는 프로젝트 루트에서 `node .claude/scripts/phase-routing.mjs intake`를 실행한다. 지정 항목은 `--ids BL-0001,BL-0002`, 기존 백로그 한 phase 위임은 `--delegated`를 붙인다. 지정 ID가 있으면 우선하며, 오류에 표시된 ID·선행 조건을 사용자에게 확인한다. 결과의 첫 담당, 첫 검토자와 승인 목록을 브리프에 옮긴다. 세 경로 모두 최종 계획은 PM이 해당 버전을 대조한다.

| 요청 | 첫 작업 | 실행까지의 승인 |
| --- | --- | --- |
| 새 요구사항 | PM이 원문 각 줄을 PRD·SRS·BL ID와 대조해 항목화하고 Planner가 누락·실행 가능성을 검토한다 | 전체 반영과 이번 묶음을 함께 확인 → 설계 승인 → 계획·실행 승인 |
| 사용자가 BL ID 지정 | 지정 ID를 Planner에게 바로 전달한다. 작거나 해법이 정해진 항목도 같다 | 설계 승인 → 계획·실행 승인 |
| 기존 백로그에서 한 phase 위임 | PM이 우선순위·연관성·선행 조건으로 목표 하나와 묶음·선정 이유를 정해 Planner에게 넘긴다 | 목표·이유·항목과 최종 예상 그림으로 계획·실행 승인 |

지정 ID가 없거나 완료됐거나 선행 조건 때문에 범위를 넓혀야 하면 해당 ID와 사유를 창구가 사용자에게 올린다. 위임 경로에서는 묶음과 설계를 중간에 승인받지 않는다. 사용자가 최종 화면에서 범위를 바꾸면 영향받은 계획·그림·리뷰를 갱신한다. 이미 승인한 설계는 브리프에 그 결정과 범위를 적고 계획부터 잇는다.

단독 PRD 작성은 PM의 `요구사항 정리` → Planner의 `요구사항 검토`, 단독 계획 대조는 PM의 `계획 대조`로 끝낸다. 요구사항·계획의 검토자는 작성자와 달라야 한다. 새 제품 결정은 PM이 브리프의 근거와 함께 창구로 올린다.

## 재개

프로젝트 루트에서 `node .claude/scripts/phase-resume.mjs <phase>`로 조회한다. `_workspace/_run/<phase>/brief.md`의 사용자 결정·BL·Run, 같은 폴더의 설계·계획 리포트·장부·Task 대응표, `_workspace/product/<phase>/`의 운영팀 리포트를 읽는다. 계획·DAG 기본 경로의 현재 해시도 출력한다. 브리프가 다른 정본을 지정하면 그 파일과 당시 검토 기록을 직접 대조한다.

먼저 기존 실행을 확인한다. 실행 Run, 대응표, 코디네이터 Dispatch, 장부 중 하나라도 실행 흔적이 있으면 `coordinator/references/recovery.md`로 Run·Task·Dispatch와 장부를 대조한다. 창구 Run에는 기획 워커도 있으므로 누가 받은 Dispatch인지 확인한다. 이미 정산한 Dispatch와 message id는 건너뛴다. 등록 Task는 기존 대응표, 미등록 Task는 당시 승인 자료에서 배정을 찾고 근거가 부족한 Task만 창구에 올린다.

| 있는 기록 | 다음 작업 |
| --- | --- |
| 새 요구이며 요구사항 정리나 생략 근거가 없음 | PM이 PRD·SRS와 원문 대조 결과를 작성 |
| 요구사항 정리는 있고 항목 리포트가 없음 | PM이 항목화하고 BL ID·수락 기준·묶음 이유를 남김 |
| 항목화 뒤 새 요구 검토가 없거나 열린 High가 있음 | Planner의 요구 검토 또는 원작성자 재작업 |
| 새 요구 검토 뒤 묶음 확인이 없음 | 전체 반영 여부와 묶음을 한 번에 확인 |
| 지정/선정된 묶음이 있음 | 미완료 설계·계획부터 진행. 위임 경로의 중간 승인 생략 |
| 계획이 있으나 그 버전의 상대 검토가 없음 | PM이 현재 계획과 DAG를 대조 |
| 현 버전 검토 완료·실행 승인 전 | 최종 예상 그림과 해당 버전으로 승인 요청 |
| 같은 버전의 검토·계획 실행 승인 완료 | 당시 검토한 계획·DAG, BL, 그림, 승인 질문과 날짜 있는 응답 원문을 대조한다. 기존 코디네이터 기동 여부를 확인한 뒤 미기동이면 창구 절차로 한 번 인계 |

구 phase의 `01_prd-writer_requirements_v*.md`는 요구사항 작성, `03_pm-reviewer_review_v*.md`는 요구 검토, `06_pm-reviewer_plan-check_v*.md`는 계획 대조에서 읽는다. 새 이름의 리포트도 같은 작업에 모인다. 파일명의 숫자는 리포트 회차다. 각 본문의 검토 대상 버전·BL·열린 결함과 브리프의 승인 원문을 확인한다. 검증 줄이 통과해도 열린 High가 있으면 해당 결함만 원작성자에게 돌린다. 계획·DAG가 달라졌으면 영향받은 범위만 다시 검토·승인받는다. 검토·승인·기동 여부가 불분명하면 기존 파일을 보존하고 빠진 근거만 창구에 올린다.

## 1. 설문 (창구)

`superpowers:brainstorming`의 문답 절차로 사용자와 문답한다. 문서는 쓰지 않는다. 요구사항은 PM이, 설계와 계획은 Planner가 쓴다.

- phase 이름은 `<YYYY-MM-DD>-<주제>`이다. 양식 `docs/harness/templates/brief.md`로 `_workspace/_run/<phase>/brief.md`를 쓴다. 문답과 사용자 결정 원문을 날짜와 함께 `## 사용자 결정`에 적는다.
- **설문에서 반드시 묻는 것:** 새 의존성, 기술 결정 변경, 외부에 쓰는 행위, 비용. 이 넷은 이 단계에서 끝낸다. 뒤 단계에서 처음 나오면 설계가 아니라 사용자 결정으로 다시 묻는다.
- 요구사항이 여럿이면 각각의 중요도와 그 근거, 닿는 사용자 수를 아는지와 그 숫자의 출처를 묻는다. 숫자가 오면 우선순위(RICE)에 쓰고, 없으면 등급만 쓴다. 모르는 것은 모른다고 적는다.
- 맥락 조사는 `AGENTS.md`의 정본 문서 목록, `docs/DOCUMENTATION_INDEX.md`, `docs/backlog.md`부터 한다. 기존 결정과 충돌하면 기획으로 정하지 않고 사용자에게 묻는다.

## 2. 기획 (창구가 운영팀에 배정한다)

PM은 `prd-write`·`srs-write`·`backlog-management`로 작성하고 Planner는 `product-review`로 대조한다. 운영팀 리포트는 `01_product-manager_requirements_v<N>.md`, `02_product-manager_backlog_v<N>.md`, `03_planner_review_v<N>.md`, `06_product-manager_plan-check_v<N>.md`로 기록한다. 다음 워커의 spec에 앞 리포트와 버전을 적는다. High 결함은 작성자 수정과 상대의 결함 ID 재검토를 최대 2회까지 돌리고 여전히 열려 있으면 사용자에게 올린다. 워커 자체 실패는 사유와 이전 파일을 갖고 1회 재기동한 뒤 창구에 보고한다.

- spec은 양식 `docs/harness/templates/spec.md`로 `_workspace/product/<phase>/spec/`에 쓴다. 담는 것: 브리프 경로, 앞 팀원의 리포트 경로, 지금의 PRD·SRS·백로그 경로, 산출물과 리포트 경로, 다시 띄울 때는 이전 리포트와 결함 ID.
- 배정 줄은 모델 표에서 읽는다: `node .claude/scripts/model-selection.mjs lookup --agent <에이전트> --unit <작업 단위>`.
- 기동은 `node .claude/scripts/orca-launch.mjs worker --agent <에이전트> --unit <작업 단위> --spec-file <spec> --bracket <phase> --does <하는 일>`만 쓴다. 처음 띄운 `창구 Run` 칸이 비어 있으면 영수증의 Run ID를 적는다.
- 대기와 정산은 planner와 같다(아래 "planner spec"의 마지막 줄).
- 각 팀원의 `## 사용자 결정 필요`는 아래 "왕복"과 같은 방법으로 처리한다.

### 묶음 승인

검토에 열린 `High`가 없으면 먼저 팀원들의 `## 사용자 결정 필요`(등급, RICE 추천값 포함)를 묻고, 답을 브리프에 더한 뒤 `product-manager`를 새로 띄워 확정 값으로 순서와 묶음 제안을 다시 쓰게 한다. 그다음 창구가 묶음 승인을 묻는다. 질문에는 원문 요구의 반영표, 전체와 이번 묶음의 항목 수·ID, 남은 항목, 목표, 우선순위·복잡도 근거, 남은 Medium 이하 쟁점을 싣는다. 이 질문은 새 요구 경로에서만 한다.

- 승인 답은 원문과 날짜로 브리프의 `## 사용자 결정`에 적는다. 승인된 이번 묶음의 백로그 ID를 브리프의 `## 백로그 항목`에, 목표 한 문장을 `## 목표`에 적는다.

## 3~4. 설계와 계획 (창구가 planner를 띄운다)

### planner spec

양식 `docs/harness/templates/spec.md`로 `_workspace/_run/<phase>/spec/`에 쓴다. 담는 것은 다음 여섯 가지다.

| 항목 | 내용 |
| --- | --- |
| 목표 | 이번 문서가 답할 것 한두 문장. 설계서의 목표는 브리프의 `## 목표`다 |
| 브리프 경로 | `_workspace/_run/<phase>/brief.md`. 사용자 결정 원문과 승인된 묶음(`## 백로그 항목`)은 여기서 읽는다 |
| 범위와 금지 | 다룰 범위(승인된 묶음), 다루지 않을 것, 고치지 않을 파일 |
| 산출물 경로 | 설계서 또는 계획서, 그림 입력 파일(`_workspace/_run/<phase>/dag.json`, `waterfall.json`) |
| 문서 종류 | 설계 또는 계획 |
| 리포트 경로 | `_workspace/_run/<phase>/NN_planner_<design 또는 plan>_v<N>.md`. `NN`은 이 스킬의 단계 번호(03 설계, 04 계획) |

- 배정 줄은 모델 표에서 읽는다: `node .claude/scripts/model-selection.mjs lookup --agent planner --unit <설계 또는 계획>`. spec에는 `배정: planner / <작업 단위> (<런타임> <model>/<effort>)` 한 줄로 적는다.
- 기술 설계는 `planner / 설계` 설정으로 기동한다. 계획서를 작성할 때마다 창구는 기동 전에 `planner / 계획` 설정을 조회하고 “이번 계획서는 Planner의 현재 설정인 <model>/<effort>로 작성할까요? 다른 값을 원하면 알려 주세요.”라고 묻는다. 사용자가 답한 뒤 그 값으로 spec의 배정 줄을 작성한다.
- 사용자가 다른 값을 고르면 이번 계획서 작성에만 적용한다. 사용자 답변 원문을 브리프와 spec의 `사용자 예외:` 줄에 적고 기동 명령에 같은 원문을 `--override-reason`으로 넘긴다. 계획서가 나온 뒤에는 승인용 DAG에서 실행 Task의 배정을 별도로 확인한다.
- 기동은 `node .claude/scripts/orca-launch.mjs worker --agent planner --unit <설계 또는 계획> --spec-file <spec> --bracket <phase> --does <하는 일>`만 쓴다. 영수증의 Run ID를 브리프의 `창구 Run` 칸에 적는다.
- 띄운 뒤에는 아래 대기 계약대로 기다린다. 정산은 `worker_done`마다 기대한 Dispatch인가, 리포트 파일이 있는가, `node .claude/scripts/report-check.mjs <리포트 경로>`가 통과하는가를 본다.

### `## 사용자 결정 필요` 왕복

planner는 spec에 없는 결정을 정하지 않고 문서 끝 `## 사용자 결정 필요`에 추천 하나와 함께 적는다. PM과 Planner도 리포트의 같은 절에 적고, 창구는 같은 방법으로 처리한다.

1. 창구가 그 목록을 사용자에게 묻는다.
2. 답을 원문과 날짜로 브리프의 `## 사용자 결정`에 더한다.
3. 그 팀원을 새로 띄워 다시 맡긴다. 이전 문서 경로를 spec에 넣는다. 정산된 워커에 `send`로 일을 보태지 않는다.
4. 목록이 비면 승인 질문으로 간다.

팀원은 문서를 쓸 수 없을 만큼 막혔을 때만 `ask`를 쓴다.

### 계획 대조

계획서가 나오면 창구가 PM을 `계획 대조`로 띄운다. PM은 BL별 수락 기준·Task·의존·쓰는 파일·배정과 승인 범위를 대조하고 검토한 버전, BL ID, 결과, 열린 쟁점을 보고한다. 열린 High는 Planner가 수정하고 PM이 그 결함을 다시 확인한다. 최대 2회 뒤에도 High가 남으면 창구로 올린다. Medium 이하는 승인 질문에 싣는다.

### superpowers 기본값 덮어쓰기

planner는 문서 형식을 위해 `superpowers:brainstorming`(설계서)과 `superpowers:writing-plans`(계획서)를 로드하고 아래 다섯 가지를 덮어쓴다. 문답 단계는 창구가 이미 했으므로 planner는 문서만 쓴다.

1. 설계 문서를 바로 커밋하지 않는다.
2. 계획에 Task마다 커밋 단계를 넣지 않는다. 워커는 커밋하지 않는다.
3. 계획서 머리의 "서브에이전트로 실행" 안내 대신 `> 실행: Orca`를 적는다.
4. 끝의 실행 방식 질문(서브에이전트 또는 인라인)을 하지 않는다. 계획 승인만 받는다.
5. 실행은 Orca로만 한다. `superpowers:subagent-driven-development`, `superpowers:executing-plans`, 서브에이전트 도구로 실행하지 않는다.

계획서의 `## DAG` 절 형식과 Task를 나누는 규칙은 `phase-planning`이 정본이다. 여기에 옮겨 적지 않는다.

### 승인 그림

창구가 해당 경로의 승인 시점마다 대기 상태의 DAG와 T+ 예상 워터폴을 보여 준다. 위임 경로는 최종 실행 승인에서 두 그림을 함께 보여 준다. 그림은 계획서에 넣지 않는다. 처음 게시할 때 그 주소를 브리프의 `그림:` 줄에 적는다. setup이 선택한 전역 DAG 렌더러에 팀장 `members` 표시가 없는 경우 설치한 키트의 `template/.claude/skills/dag-swimlane/scripts/render.mjs`로 승인본을 그린다.

| 단계 | 굵기 | 그림 |
| --- | --- | --- |
| 설계 승인 | 팀 단위의 굵은 흐름 | planner가 쓴 입력 파일로 `dag-swimlane`과 `waterfall-timeline` |
| 계획 승인 | Task 단위 | 같은 두 스킬. 스윔레인 노드마다 런타임, model, effort가 보인다 |

- 계획 승인 질문에 폭을 숫자로 넣는다: 작업 시간 합 ÷ 임계 경로 길이, 슬롯 수, 최대 동시 Task 수. 값은 계획서의 `## DAG` 절 끝에서 옮긴다.
- 최종 계획을 PM이 검토하면 창구는 승인 대상 버전과 준비된 그림을 보여 주고 ask(Claude의 `AskUserQuestion` 또는 Codex의 선택형 질문 도구)로 “이 계획을 Orca로 실행할까요?”를 묻는다. 기본 선택지는 1·2번이다. setup에서 Task 선택이 켜져 있고 해당 버전의 `dag.json`에 직접 지정할 수 있는 Task가 있을 때만 3번을 추가한다. 선택용 DAG가 없으면 경로를 묻지 않고 기본 질문을 띄운다. 3번을 고른 뒤 선택용 DAG가 없어진 경우에도 1·2번으로 다시 묻고 답을 기다린다.
  1. **승인** — 표시한 버전과 배정으로 승인 파일을 만들고 실행한다.
  2. **거절** — 응답을 브리프에 기록하고 실행 절차를 멈춘다.
  3. **모델 직접 지정 후 승인** — 선택용 DAG를 열어 고정 역할을 제외한 실행 Task의 모델·effort와 Codex 여부를 고르게 한다. 키트 렌더러로 팀장 구성원까지 표시하고 `capabilities: {db: {}}`로 게시한다. 사용자가 선택을 마치면 `ArtifactData list choices`에서 이번 그림의 선택을 읽는다. 바뀐 Task에만 모델·effort·런타임과 사용자 예외 원문을 계획·DAG·브리프·spec에 반영한다(DAG는 `overrideReason`, Codex 치환은 `model-selection.mjs codex --pair <Claude 조합>`). 바뀐 버전을 PM이 검토한 뒤 최종 배정을 보여 주고 사용자 승인을 받아 실행한다. 프로젝트의 에이전트 설정은 유지한다.
- PM이 `node .claude/scripts/orca-launch.mjs review --version <vN> --plan <계획.md> --dag <dag.json>` 결과의 review 해시를 검토 리포트에 남긴다. 창구는 같은 버전·해시로 그림을 보여 주고 사용자 원문과 날짜를 브리프에 적는다. 승인 대상이 바뀌었으면 새 버전으로 다시 검토한다.
- `node .claude/scripts/orca-launch.mjs approve --version <vN> --plan <계획.md> --dag <dag.json> --review <PM이 확인한 해시> --response "<승인 원문>"`으로 승인 파일을 고정한다. 코디네이터 spec에 그 경로를 싣는다. 실행 중에는 코디네이터가 같은 파일 경로로 다시 게시해 같은 주소에서 진행을 보여 준다.

## 5~8. 계획 승인 뒤

창구는 브리프에 설계서·계획서 경로, 슬롯 수, 지정·선정·승인한 BL을 적는다. `coordinator/references/front-desk.md`의 기동 명령에 승인 파일, 버전, 검토한 계획과 DAG를 함께 넘긴다. 실행·정산·검증·수정 루프는 `coordinator`가 정본이다.

- **7단계 하네스 회고는 생략하지 않는다.** 고칠 근거가 없으면 측정 결과와 "변경 없음"만 남긴다.
- **커밋은 8단계에서 코디네이터가 승인 뒤 한 번에 한다.** 회고가 고친 하네스 파일은 같은 PR의 별도 커밋이다.
- **워커는 커밋하지 않는다.** 같은 작업 트리를 함께 쓰므로 서로의 변경이 섞인다. 커밋은 코디네이터가 경로를 지정해서 한다.

## 대기 계약 (생략·요약 금지)
대기 명령의 세부 인자는 `orca skills get orchestration`을 따른다. 아래 1~5는 그와 별개로 항상 지킨다. Codex는 1~5 대신 6을 지킨다.
1. 대기는 하네스가 추적하는 백그라운드 작업으로 건다(Claude Code: Bash `run_in_background: true`). 포그라운드 대기는
   도구 한도(최대 10분)에 끊기고, `Start-Process`·`nohup` 분리 실행은 끝나도 아무도 못 깨운다. stderr keepalive를 Monitor로 보지 않는다.
   결과는 stdout의 JSON만 읽고 `| head -c`로 자르지 않는다(keepalive 줄이 자를 몫을 다 먹어 본문이 사라진다 — 거르려면 `| grep -v _keepalive`).
   **한 세션에 `check --wait`는 동시에 하나** — 앞 대기의 깨우기를 받은 뒤에만 다시 걸고, 추적을 잃은 앞 대기는 먼저 멈춘다.
2. 깨우는 조건에서 heartbeat를 뺀다: `orca orchestration check --wait --types "worker_done,escalation,question,status" --timeout-ms 1800000 --json`.
   heartbeat를 빼도 타임아웃마다 1회는 깨므로 짧게 잡으면 빈 깨움만 는다.
   `status`는 빼지 않는다 — 사용자 지시가 대기 중인 코디네이터에게 전달되는 통로다(빼면 사용자 지시를 놓친다).
3. 깨면 돌려받은 묶음 전체를 처리한다. `--types`는 깨우는 조건일 뿐 묶음에는 heartbeat도 섞여 온다. 소비하는 `check`가
   묶음을 처리됨으로 표시하므로 `--ack`는 붙이지 않는다(그 표시를 하지 않는 구버전 Orca 전용 옵션이다).
   이미 처리한 message id는 다시 정산하지 않는다 — `"replayed": true` 묶음(heartbeat뿐인 묶음의 재배달, 또는 겹쳐 건 대기가
   거부 없이 받은 같은 `worker_done`)이 그 경우다. 같은 Dispatch의 `worker_done`이 id만 다르게 수 초 간격으로 두 번 오면 워커
   재전송이다 — 첫 것으로만 정산한다. 소비하는 `check`는 대기를 건 쪽 본인만 실행한다(서브에이전트는 쓰지 않는다).
4. 묶음에 heartbeat만 있으면 사용자에게 보고하지 않고 말없이 대기를 다시 건다.
   "You have N orchestration messages" 알림도 같다 — 추적 중인 대기가 있으면 도구 호출 없이 턴을 끝낸다.
5. 타임아웃은 실패가 아니다. 다시 걸기 전에 `orca orchestration inbox --terminal <내 수신함> --limit 5`로 최근 5개만 한 번 보고,
   아직 정산하지 않은 message id가 있으면 정산한 뒤 다시 건다(가져갔는데 읽지 못한 메시지는 여기에만 남는다).
   `<내 수신함>`은 Run을 가진 쪽은 `run:<Run ID>`, Run이 없는 팀장은 `dispatch:<자기 Dispatch ID>`다.
   연속 3번 빈 대기면 `worker-list`로 워커 생존을 본다. 침묵·타임아웃·목록 부재만으로 종료로 판정하거나 재기동하지 않는다.
   heartbeat는 워커가 보내는 것이지 코디네이터가 보내거나 답할 것이 아니다.
6. Codex는 `check --wait`를 걸지 않는다. 끝난 백그라운드 명령은 Codex를 깨우지 못하고, 대기가 가져간 메시지에는 Orca 알림도 오지 않아
   메시지가 묻힌다. 할 일을 마치면 턴을 끝낸다. "You have N orchestration message" 알림이 오면 알림이 적어 준 `check` 명령을 그대로 한 번 돌려
   묶음 전체를 3대로 처리한다. 사용자 지시도 이 알림으로 온다. 그 `check`가 비어 있으면 5의 `inbox --limit 5`를 한 번 본다.
