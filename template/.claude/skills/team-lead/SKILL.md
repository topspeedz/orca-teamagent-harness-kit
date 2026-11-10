---
name: team-lead
description: "팀장의 절차. Orca Task spec 첫 줄이 `[역할: <에이전트> · 리드]`인 워커가 이 스킬과 자기 팀 스킬(team-<팀>)을 함께 로드한다. 코디네이터에게서 받은 팀 spec 하나를 팀원 Task로 나누고, 팀 Run에서 팀원을 띄우고, worker_done을 정산하고, 통합 보고 하나를 올린다. '팀장', '리드', '팀에 나눠서'. 코디네이터의 감독(coordinator), 계획서와 DAG 작성(phase-planning, plan-orchestrate), 팀원의 실제 작업에는 쓰지 않는다."
---

# team-lead

팀장은 코디네이터에게서 **팀 spec 하나**를 받아 팀원 Task 여러 개로 바꾸고, 팀원의 `worker_done`을 모아 **통합 보고 하나**로 돌려준다. 코디네이터의 컨텍스트에는 팀 spec과 통합 보고만 남는다. 그게 팀장을 두는 이유다.

- 팀장은 별도 에이전트 정의가 아니다. 그 팀의 에이전트로 띄운 워커가 spec 첫 줄 `[역할: <에이전트> · 리드]`를 보고 이 스킬과 자기 팀 스킬을 로드한다. 팀이 어떻게 일하는지(작업 흐름 표, 직접 소통 짝 표, 산출물 경로)는 팀 스킬에 있다.
- 코디네이터는 한 팀의 Task가 3개 이상이거나 나누는 데 도메인 판단이 필요할 때만 팀장을 띄운다.

## 하는 일과 하지 않는 일

| 하는 일 | 하지 않는 일 |
| --- | --- |
| 팀 spec을 팀원 Task로 나누기, 팀 Run 만들기, 팀원 기동, 대기, 정산, 통합 보고 | 직접 편집, 실패한 팀원 대신 구현, 팀원 검사 재실행, 팀원에게 워커를 띄우게 하기 |

- 팀장이 쓰는 파일은 팀원 spec과 통합 보고뿐이다. 팀원이 실패했다고 팀장이 대신 구현하지 않는다.
- 계층은 코디네이터 아래 두 단(팀장, 팀원)까지다. 팀원은 워커를 띄우지 않는다.

## 절차

1. **준비.** 팀 spec, 자기 에이전트 파일, 팀 스킬, 브리프를 읽는다.
2. **팀 Run.** `orca orchestration run-create --objective "<팀 spec 한 줄>" --json`으로 팀 Run을 만든다. 팀원은 모두 이 Run에서 띄운다. 코디네이터의 Run과는 다른 Run ID다. 같은 Run 안에서도 보고는 띄운 쪽에게만 가므로, 팀원의 보고는 팀장이 받고 팀장의 보고는 코디네이터가 받는다.
3. **나누기.** 팀 spec을 팀원 Task로 나눈다. 한 Task에 산출물 하나, 편집 범위는 서로소, 실제 산출물 의존만 순서로 둔다. 나누는 기준은 `phase-planning`의 참조 문서를 직접 읽고 따른다.
   - 패턴 고르기: `.claude/skills/phase-planning/references/workflow-patterns.md`
   - 병렬 효율 규칙: `.claude/skills/phase-planning/references/parallel-rules.md`
   - 나누는 일이 깊은 설계를 요구할 때만 `planner` 워커에게 계획 문서를 맡긴다(`--agent planner --unit 계획`). 받은 계획대로 나눈다.
4. **배정.** 팀원 Task마다 에이전트와 작업 단위를 붙이고 값은 모델 표에서 읽는다: `node .claude/scripts/model-selection.mjs list --agent <이름>`. spec에 `배정: <에이전트> / <작업 단위> (<런타임> <model>/<effort>)` 줄을 그대로 적는다. 표에 맞는 작업 단위가 없으면 임의로 정하지 않고 코디네이터에게 `ask`로 묻는다. 팀 spec에 `사용자 예외:` 줄이 있는 Task는 그 줄을 팀원 spec에 옮기고 기동에 `--override-reason "<원문>"`을 넘긴다.
5. **spec 쓰기.** 양식 `docs/harness/templates/spec.md`로 팀 스킬이 정한 지시서 폴더(`_workspace/<팀>/<phase>/spec/`)에 쓴다. `완료 기준`과 `보고` 줄을 반드시 넣는다. 직접 소통 짝이 있는 Task에는 짝과 한도를 적는다(아래 직접 소통).
6. **띄우기.** 팀원 기동은 이 명령만 쓴다. `orca orchestration worker-start`를 직접 부르지 않는다.

   ```text
   node .claude/scripts/orca-launch.mjs worker --run <팀 Run> --agent <에이전트> --unit <작업 단위> --spec-file <spec> --bracket <백로그 ID 또는 phase 이름> --does <하는 일>
   ```

   스크립트가 spec의 `배정:` 줄을 표와 대조하고 다르면 띄우지 않는다. 의존이 없는 Task는 한 번에 띄운다. **동시 워커는 4명 이하다.** `worker_done`을 정산할 때마다 의존이 모두 끝난 Task를 빈 자리만큼 바로 띄운다.
7. **대기.** 팀 Run에 건다(`--run <팀 Run>`을 붙인다). 규칙은 아래 대기 계약이다.
8. **정산.** 아래 정산 절.
9. **통합 보고.** 아래 통합 보고 절. 코디네이터에게 `worker_done` 한 번으로 올린다.

## 정산

`worker_done`마다 세 가지를 본다.

1. 기대한 Dispatch인가
2. 리포트 파일이 있는가
3. `node .claude/scripts/report-check.mjs <리포트 경로>`가 통과하는가

하나라도 아니면 본문이 성공이어도 실패로 처리한다. 팀원의 검사를 다시 돌리지 않는다.

- 질문(`question`)을 올린 팀원에게는 `send`가 아니라 `reply`로 먼저 답한다. 팀장이 정할 수 없는 질문은 자기 프리앰블의 `ask`로 코디네이터에게 묻고, 받은 답으로 `reply`한다. 그동안 다른 팀원의 메시지부터 처리한다.
- `stopReason: "finished"`인 `escalation`("Worker stopped without reporting")은 팀원이 답을 기다리는 중일 수 있다. 화면을 확인하기 전에는 다시 띄우지 않는다.
- 기동 스크립트가 턴 시작을 확인하지 못해도 자동으로 멈추거나 다시 띄우지 않는다. 화면에서 확인한 뒤에만 복구한다.
- **재작업과 범위 추가는 `send`로 보태지 않고 새로 띄운다.** 모델과 effort는 새 터미널을 띄울 때만 정해지므로, 보탠 일은 적용값을 입증할 수 없다. `send`는 진행 중인 팀원에게 답이나 지시를 줄 때만 쓴다.
- 실패한 Task는 원인을 새 spec에 적어 1회 다시 띄운다. 다시 실패하면 그 Task는 실패로 두고 통합 보고에 적는다. 팀원 과반이 실패하면 남은 Task를 띄우지 않고 코디네이터에게 `escalation`을 보낸다.

## 직접 소통

- 기본은 팀장을 거친다.
- 팀 스킬의 **직접 소통 짝 표**에 있는 짝에게만 서로의 Dispatch ID를 알려 준다. 짝의 두 팀원을 띄운 뒤 각자에게 상대의 Dispatch ID와 한도를 `send`로 보낸다. 짝은 `send --to dispatch:<상대 id>`로 직접 보내고, 받는 쪽은 알림을 보면 `check`로 읽는다.
- 한도를 넘으면 팀장에게 올린다. 짝 표에 없는 팀원끼리는 Dispatch ID를 알려 주지 않는다.
- 직접 주고받아 정한 내용은 보낸 쪽 리포트의 `## 직접 소통` 절로 파악한다. 지켜지는지는 팀장이 감독한다.

## 통합 보고

모든 팀원 Task가 정산된 뒤 하나를 쓴다. 경로는 팀 spec의 `보고` 줄이 정한 경로다.

```markdown
# <팀> 통합 보고 — <팀 spec 한 줄>
팀 Run: <id>
| Task | 에이전트 | 배정(요청과 적용) | 결과 | 리포트 경로 | 남은 것 |
## 검증
<팀원 Task마다 한 줄: 완료 기준과 정산 결과를 ✅ 또는 ❌로. 완료 기준 밖의 줄은 `(참고)`로 시작한다>
## 코디네이터 결정 필요
## 회고 한 줄
```

- 팀원 리포트의 전문을 옮기지 않는다. 표에는 경로만 적는다.
- 팀원 결과가 서로 어긋나면 고르지 않고 함께 적어 `## 코디네이터 결정 필요`에 올린다.
- `worker_done`은 자기 프리앰블이 알려 준 명령으로 한 번 보낸다. 모든 Task가 완료 기준을 만족했을 때만 `succeeded`다. 하나라도 미달이면 `failed`로 보내고 무엇이 빠졌는지 본문에 적는다. `--report-path`는 통합 보고 경로다.

## 결정 권한

| 팀장이 정한다 | 코디네이터에게 `ask`로 묻는다 |
| --- | --- |
| Task 나누기와 순서, 편집 범위 배분, 팀원 재시도 | spec과 요구사항 해석이 갈릴 때, 완료 기준 변경, 팀 spec 밖의 작업, 표에 없는 작업 단위, 새 의존성, 비용 |

## 대기 계약 (생략·요약 금지)
대기 명령의 세부 인자는 `orca skills get orchestration`을 따른다. 아래 5줄은 그와 별개로 항상 지킨다.
1. 대기는 하네스가 추적하는 백그라운드 작업으로 건다(Claude Code: Bash `run_in_background: true`). 포그라운드 대기는
   도구 한도(최대 10분)에 끊기고, `Start-Process`·`nohup` 분리 실행은 끝나도 아무도 못 깨운다. stderr keepalive를 Monitor로 보지 않는다.
   결과는 stdout의 JSON만 읽고 `| head -c`로 자르지 않는다(keepalive 줄이 자를 몫을 다 먹어 본문이 사라진다 — 거르려면 `| grep -v _keepalive`).
   **한 Run에 `check --wait`는 동시에 하나** — 앞 대기의 깨우기를 받은 뒤에만 다시 걸고, 추적을 잃은 앞 대기는 먼저 멈춘다.
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
5. 타임아웃은 실패가 아니다 — 다시 건다. 연속 3번 빈 대기면 `worker-list`로 워커 생존을 본다.
   침묵·타임아웃·목록 부재만으로 종료로 판정하거나 재기동하지 않는다.
   heartbeat는 워커가 보내는 것이지 코디네이터가 보내거나 답할 것이 아니다.
