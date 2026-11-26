---
name: waterfall-timeline
description: DR.LOMILOMI Orca Run·BL 작업의 워터폴 HTML을 만든다 — 진행 중 Run은 실제 시각 축·"지금" 세로선·실측+예상 막대, 시작 전 Run은 T+ 예상시간(low/likely/high) 견적·전후 비교. '워터폴', 'waterfall', '예상시간 타임라인', '얼마나 걸려', '언제 끝나', '일정 비교', 'QA 병렬로 하면 얼마나 줄어'. 흐름(누가 무엇 다음)만 그릴 땐 dag-swimlane.
---

# 워터폴

dag-swimlane은 **순서**, 이 스킬은 **시간에 비례한 일정**을 보여 준다. 의존성 없이 Node.js로 독립 HTML을 만든다. 렌더러를 바꾸면 프로젝트 루트에서 `node .claude/skills/waterfall-timeline/scripts/check.mjs`를 돌리고 예제를 다시 렌더해 `assets/` 기준 HTML을 갱신한다.

## 모드 고르기

| 모드 | 언제 | 렌더러 · 입력 | 기준 화면 |
|---|---|---|---|
| **진행** (기본) | Run이 이미 시작됨 — 진행 상황·남은 시간·예상 종료 | `scripts/progress.mjs` · [진행 입력](references/progress-input.md) | [progress-reference.html](assets/progress-reference.html) — 실제 시각 30분 축·"지금" 세로선 |
| **예측** | 아직 아무 Task도 시작 전 — 견적, 워커 수·QA 병렬 전후 비교 | `scripts/render.mjs` · [예측 입력](references/input.md) | [reference.html](assets/reference.html) — T+ 축, low/likely/high 탭 |

Run에 실측 시작 기록이 하나라도 있으면 진행 모드다. 예측 모드를 진행 중 Run에 쓰지 않는다(T+ 좌표는 실제 시각과 맞지 않는다).

## 출처 (기억으로 채우지 않는다)

| 값 | 출처 |
|---|---|
| Task·의존성·상태 | `_workspace/<run>/00_ledger.md`(Run 장부)·`coordinator-checkpoint.md`·에이전트 `*-progress.md` — 더 최신 기록이 장부와 다르면 그쪽을 쓰고 보고에 적는다. 장부가 없으면 계획 문서 `docs/superpowers/plans/*.md`의 DAG |
| 실측 시작·끝(진행) | Orca 워터폴은 Task의 생성 시각(`created_at`)과 완료 시각(`completed_at`)을 사용한다. Orca 밖 작업은 리포트의 실측 시각을 쓴다. 시각 기록이 없는 Task는 추측하지 않는다 — 사용자에게 묻거나 그 Task를 notes에 "시각 미기록"으로 적는다 |
| 남은 막대(진행)·추정(예측) | 같은 종류 과거 Run 장부 실측, 없으면 PM 추정(`estimates.json` 등), 그것도 없으면 `docs/backlog.md` BL 행의 크기(S/M/L, `backlog-management`) |
| BL · 역할 | `docs/backlog.md`의 BL-#### · `.claude/agents/<역할>.md` 이름 |

## 진행 모드

**Orca Run이면 먼저 변환기로 뽑는다** — 실측 시각을 손으로 옮기지 않는다:

```
node .claude/skills/waterfall-timeline/scripts/from-orca.mjs --map _workspace/_run/<phase>/orca-tasks.json \
  --plan _workspace/_run/<phase>/waterfall.json \
  --out _workspace/_run/<phase>/waterfall-progress.json [--slots 2] [--dag <url>] [--patch patch.json]
```

하네스에서는 `--map`이 실행 Run과 Task ID를 제공한다. child Run도 합칠 때는 `--run <실행 Run>,<child>`를 더한다. 캡처로 재현할 때는 `--tasks <task-list.json>`을 쓴다.

`orca orchestration task-list`의 Task 생성·완료 시각 = 완료/진행 막대, 계획 JSON(예측 모드 입력 또는 PM 추정)의 likely = 지금 이후 대기 막대. 매칭·승인 규칙은 [진행 입력 §from-orca](references/progress-input.md#from-orca). 결과를 보고 지금 걸린 결정·지연 요인을 `--patch`의 `notes`로 덮어쓴 뒤 progress.mjs로 렌더한다. 실제 동시 워커 수가 계획과 다르면 `--slots`로 맞춘다. Orca 밖 작업이면 아래 1~3을 손으로 채운다.

1. 위 출처에서 Task마다 lane·상태·시작·끝을 정한다. `done` = 실측 시작·끝, `run` = 실측 시작 + 예상 끝, `wait` = 의존성을 지킨 예상 시작·끝(선행의 예상 끝 뒤). 임계 경로는 `crit: true`.
2. lane: `plan` 기획·조사(`product-manager`·`research`) · `coord` 코디네이터·사용자 승인(✋ 접두) · `design` 디자인(blender 포함) · `dev` 개발·마케팅 산출 · `verify` 검증(`verifier`) · `harness` 하네스(`harness-engineer`·`doc-steward`).
3. notes 카드 3~4개: **예상 근거**(실측 출처·추정 근거), **임계 경로**(사슬과 어디까지 완료), 구조 변경·지연 요인, **사용자 대기**(승인·훅 신뢰 등 미정 시간, "추정이며 보장 아님").
4. `_workspace/<run>/waterfall-progress.json`에 쓰고 `node .claude/skills/waterfall-timeline/scripts/progress.mjs <json> _workspace/<run>/waterfall-progress.html`. `now`를 비우면 렌더 순간이 "지금" — 다시 그릴 때마다 선이 옮겨 간다. 모든 Task가 `done`이면 끝난 Run으로 보고 "지금" 선 없이 축을 첫 시작~마지막 끝으로 자르고 페이지 폭에 맞춰 늘린다(헤더 = 종료·소요 = 작업 + 사용자 대기 + 빈 시간).
5. 같은 Run의 DAG 스윔레인 Artifact가 있으면 `dag`에 URL을 넣는다.

## 여러 Run 합치기 (프로그램 전체)

한 프로그램이 Run 여러 개로 나뉘면(예: 지식체계 K0~K6 — 단계마다 plan-orchestrate Run) Run별 워터폴과 별도로 **전체 워터폴 1장**을 같은 실제 시각 축에 둔다. Run별 워터폴이 정본이고 전체는 그 합본이다.

1. Run마다 진행 입력(`_workspace/<run>/waterfall-progress.json`)을 위 절차로 먼저 갱신한다. 다른 창구가 감독하는 Run(계획 JSON이 없음)도 `from-orca.mjs --run <run> --ledger <장부> --patch <patch.json> --out <json>`처럼 **`--plan` 없이** 뽑는다 — 실측 막대만 나오고, ✋ 게이트·남은 예상 막대는 patch의 `tasks`(진행 입력 형식)로 더한다. task-list 시각을 손으로 옮기지 않는다. 승인 `✋` 막대 시각은 그 Run 장부 `## 게이트` 표(질문 보낸 시각·답 받은 시각)에서.
2. 아직 시작 전인 단계는 예상 막대(`wait`)로 넣는다 — 계획·✋승인(시간 미정)·실행·검증·회고, 길이는 끝난 단계들의 실측 기준. notes에 "계획 전이라 Task는 바뀐다"를 적는다.
3. `node .claude/skills/waterfall-timeline/scripts/merge.mjs --out _workspace/<program>-roadmap/waterfall-all.json --title "<제목>" [--dag <로드맵 DAG url>] [--notes notes.json] K0=<json> K1=<json> …` — 제목 앞에 `<단계> · `가 붙는다(`K2 · ✋…`도 사용자 대기로 인식). 그다음 progress.mjs로 렌더.
4. notes 카드: 읽는 법(한 줄 = Task, 접두 = 단계, 점선 = 사용자 대기), 실측 출처(어느 Run을 이 창에서 읽었나), 예상 근거, 주의(예상 종료는 추정이며 보장 아님, 빠진 단계).
5. 게시는 한 URL로 유지(같은 파일 경로 재게시). Run별 워터폴을 다시 그리면 전체도 다시 합친다.

## 예측 모드

설계 승인 전 에이전트 단위, 실행 승인 전 Task 단위로 같은 DAG의 실제 선행과 예상 시간을 사용해 대기 상태의 T+ low/likely/high를 게시한다. 실행 중 재예측은 `waterfall.json`에 쓰고 승인 당시 `waterfall.plan.json`은 회고까지 보존한다.

1. 입력은 [예측 입력](references/input.md), 예시 [example.json](examples/example.json). tone은 `plan`·`dev`·`verify`·`coord`·`harness`(디자인은 `dev`), 승인 게이트는 `kind: "approval"`.
2. 시나리오별 시작·종료는 의존성·`maxWorkers`·`resource`를 지켜 계산한다. 검증은 같은 빌드에서 증거가 준비된 영역부터 병렬, 최종 수락은 모든 검증 뒤.
3. `_workspace/<run>/waterfall.json` → `node .claude/skills/waterfall-timeline/scripts/render.mjs <json> _workspace/<run>/waterfall.html`.
4. 실제 경과·작업자 시간 합·병렬 경과를 섞지 않는다. 승인 대기·워커 기동·감독·수정 루프는 0분으로 확정하지 말고 `assumptions`에 따로 적는다. 전후 비교는 같은 범위·같은 자원으로, 워커를 늘린 비교는 별도 가정으로.

## 공통

- **사용자 대기 = 세로 점선 구간** 사용자 승인·결정을 기다린 시간은 제목을 `✋`로 시작하는 Task 하나로 넣는다(여러 Run 합본에서는 `K2 · ✋…`). progress.mjs가 그 막대를 점선(채움 없음)으로, 그 시작~끝 구간을 **모든 행을 가로지르는 세로 점선 띠**로 그려 그 시간에 다른 Task가 무엇을 했는지 함께 보이게 한다. 끝난 Run 헤더의 "작업" 시간에서는 이 구간을 뺀다(소요 = 작업 + 사용자 대기 + 빈 시간). 시각 출처는 장부 `## 게이트` 표의 질문 보낸 시각·답 받은 시각(없으면 질문·답 파일 시각, 근사임을 notes에). 승인 시간이 미정이면 `wait` 막대로 자리만 잡고 notes에 "미정"이라 적는다.
- 로컬 파일 경로를 준다. 공유·페이지를 원하면 Artifact로 게시하고(첫 게시 `icon: "chart"`), 갱신은 같은 경로 재게시로 URL 유지.
- 렌더러는 검증·표현만 하고 최적화하지 않는다. 오류(순환·기간·자원 초과·완료가 지금보다 늦음 등)는 데이터를 고친 뒤 출력한다. 예상 막대를 "지금"선에 맞춰 옮기지 않는다 — 어긋남이 곧 지연·선행이다.
- 이 스킬은 계획을 바꾸거나 워커를 더 띄우지 않는다. 사용자 작업명·범위·승인 상태를 시각화 때문에 바꾸지 않는다.
