---
name: harness-retro
description: "phase 끝의 하네스 회고 절차. harness-engineer가 phase 흐름 7단계에서 이번 phase를 재고(병렬 지표, 코디네이터가 깬 횟수, 수정 루프, 재시도와 원인, 작업 폴더 크기), 근거가 있는 하네스 파일만 최소로 고친다. '하네스 회고', 'phase 회고', '하네스 개선', '병렬 효율 측정', '출발값 고치기'. 팀 운영과 Task 나누기(team-harness), 제품 결함 수정, 백로그 정리, 모델 표 직접 수정에는 쓰지 않는다."
---

# harness-retro

매 phase가 하네스의 테스트다. 이 스킬은 그 결과를 하네스에 되돌리는 절차다. 재지 않고 바꾸지 않고, 바꾼 뒤 같은 것을 다시 잰다.

## 언제

- phase 흐름의 7단계에서 **항상** 돌린다. 생략하지 않는다.
- 고칠 근거가 없으면 측정 결과와 "변경 없음"만 남기고 끝낸다.
- 한 번 일어난 일은 규칙으로 굳히지 않는다. 같은 발견이 두 번째일 때 규칙으로 올릴지 검토한다. 이전 회고 리포트가 있으면 그것을 기준선으로 쓴다.

## 1. 측정

### 재는 것

| 지표 | 출처 |
| --- | --- |
| 병렬 지표: 작업 시간 합 ÷ 임계 경로, 최대 동시 Task 수, 계획값과 실제값 | 계획값 `waterfall.json`의 likely 일정, 실제값 `actual.json` |
| 코디네이터가 깬 턴 수와 그 가운데 heartbeat만 든 깸 | Claude Code 세션 기록(`.jsonl`) |
| 수정 루프 횟수 | `ledger.md`의 예산 줄 |
| 재시도와 원인, 질문이 있던 Task | `ledger.md`의 표 |
| 실패 Task | `actual.json`의 `status` (Orca의 기록) |
| 준비→기동 지연: 마지막 의존이 끝난 때부터 그 Task를 띄운 때까지. 합, 최댓값, 최댓값인 Task | `actual.json`의 시각과 `waterfall.json`의 의존 |
| 작업 폴더의 크기 | `_workspace/` |

### 명령

프로젝트 루트에서 실행한다.

```bash
node .claude/skills/harness-retro/scripts/retro-measure.mjs \
  --waterfall _workspace/_run/<phase>/waterfall.plan.json \
  --actual _workspace/_run/<phase>/actual.json \
  --ledger _workspace/_run/<phase>/ledger.md \
  --workspace _workspace
```

- `waterfall.plan.json`은 `exec-run`이 실행 Run을 만들 때 `waterfall.json`을 한 번 복사해 얼려 둔 승인 계획이다. `waterfall.json`은 phase 동안 재예측으로 덮어써지므로 계획 열에 쓰지 않는다. 사본이 없는 phase는 `waterfall.json`을 넘기고, 리포트에 계획 열이 재예측일 수 있다고 적는다.

- 출력은 리포트에 그대로 붙일 표다. 입력이 없거나 읽을 수 없는 지표는 `측정 불가`로 찍히고 끝에 사유가 붙는다. 0으로 세지 않는다.
- 세션 기록은 기본으로 `~/.claude/projects/` 아래 현재 폴더 이름의 기록을 최근 7일만 읽는다. 다른 위치면 `--sessions <폴더>`, 기간은 `--days <일수>`.
- 코디네이터 세션은 `orca-launch.mjs`의 `exec-run`이나 `register`를 쓴 세션으로 가르고, 세션마다 한 줄씩 찍는다(합치지 않는다). 워커와 팀장도 같은 알림을 받기 때문이다.
- 셀프테스트: `node .claude/skills/harness-retro/scripts/retro-measure.check.mjs`.

### `actual.json` 만드는 법

코디네이터가 7단계를 띄우기 전에 아래 명령으로 만든다. 손으로 적지 않는다.

```bash
node .claude/scripts/orca-launch.mjs actual --map _workspace/_run/<phase>/orca-tasks.json > _workspace/_run/<phase>/actual.json
```

`start`는 기동 스크립트가 그 Task를 띄운 시각이고, `end`와 `status`는 Orca의 기록이다. 재시도한 Task는 마지막 기동의 시각이 남는다. 계획(`waterfall.json`)에 없는 Task(팀장에게 준 팀 Task, 4·6단계의 Task)는 병렬 지표에서 빠지고 그 개수가 출력 끝에 찍힌다. 이 파일이 없으면 실제값 열은 `측정 불가`다.

### heartbeat만 든 깸은 근사다

세션 기록에는 깬 묶음에 무엇이 들었는지 남지 않는다. 그래서 스크립트는 Orca 알림("You have N orchestration message")이나 백그라운드 `check --wait`의 완료 알림으로 깬 턴 가운데 **도구 호출 없이 끝난 깸 수**를 세고, 이것을 heartbeat만 든 깸의 근사로 쓴다. 리포트에도 "근사"라고 적는다. 대기 계약대로라면 heartbeat만 든 묶음에는 도구 없이 턴을 끝내므로 근사가 맞지만, 다른 이유로 도구 없이 끝난 깸도 함께 세어진다.

## 2. 출발값 고치기

계획 규칙의 출발값 셋을 실측으로 고친다. 정본은 `phase-planning`의 `references/parallel-rules.md`다.

| 출발값 | 실측 | 고치는 때 |
| --- | --- | --- |
| 워커 기동 비용 3분 | 기동 영수증 시각에서 워커의 첫 보고까지 | 두 phase 연속으로 실측이 출발값과 크게 다를 때 |
| 합치는 기준 두 배 | 기동 비용보다 짧았던 Task의 실제 소요 | 짧은 Task가 따로 서서 기동 비용이 작업보다 컸을 때 |
| 팀 동시 4명 | 최대 동시 Task 수와 그때의 대기·재시도 | 동시 수를 늘려도 재시도가 늘지 않았거나, 4명에서 충돌이 났을 때 |

- 계획값과 실제값의 비율이 크게 다르면 먼저 원인을 장부에서 찾는다(재시도, 질문, 승인 대기). 원인이 출발값이 아니면 출발값을 고치지 않는다.
- 고친 값은 그 한 곳에서만 고친다. 사본을 만들지 않는다.

## 3. 진단

- 결과 결함(잘못된 산출물, 실패, 재시도)은 먼저 **어느 Task가 틀렸는지** 장부와 리포트로 거슬러 올라가 분류한다.

| 입력 | 출력 | 원인 | 고칠 곳 |
| --- | --- | --- | --- |
| 맞음 | 틀림 | 그 역할, 스킬, 배정의 결함 | 에이전트 파일, 스킬의 절, 배정 제안 |
| 이미 틀림 | — | 상류 Task의 결함 | 더 거슬러 올라간다 |
| 맞음 | 맞음, 하류가 잘못 씀 | 리포트나 spec의 계약 결함 | 리포트 양식, spec 양식 |

- 실행 결함(훅 차단, 스킬을 못 찾음, 워커가 살아 있는데 보고 없음)은 실제 실행 기록과 화면으로 판정한다. 문서만 보고 판정하지 않는다.
- 모든 발견은 `파일:줄`로 적는다.

## 4. 수정

- 근거가 있는 항목만, 원인이 있는 가장 가까운 파일 하나에서 최소로 고친다. 사실은 한 줄도 잃지 않는다.
- 안내 문구로 실행 제약을 대신하지 않는다. 막아야 하면 훅 차단이고, 그것은 사용자 승인 대상이다.
- 항상 로드되는 파일(`AGENTS.md`, `CLAUDE.md`, description)이 늘면 어디서 줄였는지 적는다. 세부는 스킬과 참조 문서로 내린다.
- QA 리포트의 `## 점검표 후보`는 `qa-verification`의 `references/boundary-checklist.md`의 "이 프로젝트에서 겪은 것"에 옮긴다. 출처(phase 이름과 결함 ID)를 붙이고, 같은 뜻의 항목이 있으면 더하지 않는다. 점검 항목은 규칙이 아니라서 한 번 겪은 것도 옮긴다.
- 고친 하네스 파일마다 `docs/harness/changelog.md`에 한 줄(변경 내용 · 대상 · 사유)을 적는다.
- 고친 하네스 파일은 같은 PR의 **별도 커밋**으로 들어간다. 커밋은 코디네이터가 한다. 워커는 커밋하지 않는다.
- **모델 표 `docs/harness/model-selection.md`는 직접 고치지 않는다.** 바꿀 배정과 근거(재시도, 실패, 적용값)를 리포트에 제안으로 적고 사용자 승인을 받는다.
- 사용자 승인 뒤에만 고치는 것: `.claude/settings*.json`, 훅의 차단 범위, 권한, 모델 표. 승인 전에는 제안으로만 남긴다.

## 5. 검증

1. 고친 스크립트와 훅의 셀프테스트(`<이름>.check.mjs`)를 돌린다. 실패하면 그 변경을 되돌리고 제안으로 남긴다.
2. 바꾼 스킬은 frontmatter의 `name`이 폴더 이름과 같고 `SKILL.md`가 500줄 미만인지 본다.
3. 1절의 측정을 같은 명령으로 다시 돌려 전후 표를 만든다. 효과가 없으면 되돌릴지 적는다.

## 6. 리포트

경로: `_workspace/harness/<phase>/01_harness-engineer_retro_v<N>.md`(team-harness의 작업 흐름 표). 형식은 양식 `docs/harness/templates/report.md`를 따르고 아래 절을 넣는다.

```markdown
# 하네스 회고 — <phase>
## 측정            retro-measure.mjs 출력 표 그대로 (근사·측정 불가 표시 유지)
## 진단            | 표면 | 파일:줄 | 근본 원인 | 근거(장부·리포트 경로) |
## 변경            파일별 한 줄. 없으면 "변경 없음"
## 출발값          기동 비용·두 배·동시 수의 전과 후, 또는 "유지"와 이유
## 사용자 승인 필요  모델 표 제안, 설정·권한 제안
## 작업 폴더        크기. 지울지는 사용자가 정한다
## 검증            실제 명령과 결과, 줄마다 ✅ 또는 ❌
```

- 작업 폴더는 틀이 지우지 않는다. 크기를 보고하고 사용자가 지울지 정한다.
- 추적되는 문서(`changelog.md` 등)는 `_workspace/` 경로를 근거로 가리키지 않는다. 근거는 `docs/history/<phase>/`를 가리킨다.

## 하지 않는 것

- 측정 없는 개선, 효과 없는 규칙 유지, 한 번 일어난 일의 규칙화.
- 제품 코드, 백로그, 모델 표 직접 수정. 권한, 차단 범위 완화, 훅 우회.
- 사용자 전역 스킬 수정. 역할 신설 후보는 근거와 함께 인박스로 보낸다.
