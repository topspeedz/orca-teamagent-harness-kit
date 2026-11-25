# 압축에서 돌아왔을 때

> 읽는 시점: 코디네이터의 대화가 압축된 직후. 압축 요약만 믿고 이어 가지 않는다.

압축 요약에는 Run ID, 진행 중인 Dispatch ID, 추적 중인 대기 작업, 현재 단계, 사용자 결정 원문이 남아 있어야 한다(공통 지침의 `## Compact Instructions`). 그래도 아래 순서로 다시 맞춘다.

1. **브리프, 장부, Task 대응표를 다시 읽는다.** `_workspace/_run/<phase>/`의 `brief.md`, `ledger.md`, `orca-tasks.json`이다. 실행 Run ID와 현재 승인 파일은 대응표의 `run`, `approval`에서 찾는다. 승인 파일의 `tasks`는 미등록 Task까지 포함한다. 대응표의 `tasks`에는 등록 영수증이 있는 Task만 있다. `direct`에는 팀장의 직접 기동 영수증이 있다.
2. **추적을 잃은 대기를 먼저 멈춘다.** 하네스가 추적하는 백그라운드 작업 목록을 보고, 지금 기억에 없는 `check --wait`는 멈춘다. 한 세션에 대기는 동시에 하나다. 앞 대기를 남긴 채 새 대기를 걸면 같은 묶음을 두 대기가 나눠 가진다. 답을 기다리는 `ask --wait`가 목록에 있으면 그대로 둔다.
3. **상태를 본다.** 메시지를 소비하지 않는 명령으로 본다.

   ```text
   node .claude/scripts/orca-launch.mjs ready --map _workspace/_run/<phase>/orca-tasks.json
   node .claude/scripts/orca-launch.mjs snapshot --run <실행 Run>
   ```

   Task의 상태는 기억이 아니라 `ready`가 돌려준 Orca의 상태로 이어 간다. 대기 중인 메시지와 워커 목록을 장부와 대조한다. 장부에 없는 `worker_done`이 있으면 다음 대기에서 받아 정산한다. 이미 장부에 정산된 message id는 다시 정산하지 않는다.
4. **대기를 다시 건다.** `SKILL.md`의 대기 계약대로 백그라운드 대기 하나를 `--run <실행 Run>`을 붙여 건다.

- 침묵, 타임아웃, 목록 부재만으로 워커를 종료로 판정하거나 다시 띄우지 않는다.
- 스윔레인은 `ready`의 상태로 같은 파일 경로에 다시 게시한다.
- 진행 워터폴은 같은 폴더의 `orca-tasks.json`을 `from-orca.mjs --map <map> --plan <waterfall.json> --out <진행.json>`에 준다. 최초 `waterfall.plan.json`은 회고에 쓴다.

## 승인과 현재 Run의 재승인

1. 실행 승인을 받기 전 창구는 `review --version v1 --plan <계획.md> --dag <dag.json>` 결과의 `version`과 `review`(SHA-256)를 검토 리포트와 승인 질문에 함께 싣는다. 질문에 연결된 사용자의 명시적 승인 응답을 받으면 같은 입력으로 `approve --version v1 --plan <계획.md> --dag <dag.json> --review <그 해시> --response <응답 원문>`을 실행한다. 응답이 다른 버전을 지칭하거나 쟁점이 열려 있으면 새로 검토·확인한다. 명령은 DAG 옆 `approved-plan.v1.json`을 한 번 기록한다. 브리프에는 이 경로와 해시를 남긴다. 명령 앞에는 모두 `node .claude/scripts/orca-launch.mjs`를 붙인다.
2. 새 실행은 `exec-run --phase <phase> --map <map> --approval <승인파일>`로 연결한다. 재개는 동일 map으로 이어 간다. 같은 Run의 미등록 Task도 승인 파일의 의존·모델로 등록한다. 사용자가 다음 계획용 모델 표를 저장해도 현재 Run의 승인 파일은 그대로다.
3. 사용자가 현재 Run의 배정을 바꾸라고 하면 해당 Task는 기동 대기한다. 검토자(`plan-orchestrate`의 조건이 맞으면 PM, 아니면 창구. `plan-orchestrate`의 계획 대조)가 수정 계획·DAG에 새 버전으로 review하고 창구가 그 질문의 응답으로 approve한다. 등록된 Task라면 변경 spec을 기존 등록 경로에 준비한다. `reapprove --map <map> --approval <새 승인파일> --id <변경 Task>`로 해당 Task만 전환한다. 미등록이면 이후 최초 등록에 새 버전이 쓰인다. 이미 기동한 Task와 다른 Task의 배정은 이 명령으로 바뀌지 않는다.
4. 등록한 미기동 Task에 열린 게이트가 있으면 전환이 `transition`에 남는다. 실제 응답을 원래 게이트에 `resolve`한 뒤 같은 재승인 명령을 다시 실행한다. 옛 Task를 기동 불가 상태로 만든 다음 새 spec으로 등록한다. `tasks[ID].previous`의 옛 Orca ID·의존·게이트와 새 Orca ID를 장부에 함께 기록한다. 후속 Task는 원래 ID·spec을 유지하며 런처가 새 선행 ID의 완료를 확인한 뒤 풀어 준다. 전환 중 압축·등록 응답 유실 때도 같은 명령으로 재개한다. 승인 표식이 같은 새 Task가 이미 있으면 기존 ID를 회수한다.
5. 직접 기동한 팀원의 영수증이나 중단된 기동 요청(`direct[ID]`)이 있으면 worker-list·메시지·장부와 대조한다. 같은 ID로 다시 보내지 않는다. 프로세스가 비정상 종료되어 `orca-tasks.json.lock`이 남았으면 파일에 적힌 PID의 런처 종료와 Orca의 마지막 동작을 먼저 확인한 뒤 해당 잠금 파일만 해제한다.

구형 map은 기존 등록값·Dispatch로 재개한다. 미등록 건은 해당 시점의 계획·DAG·장부·승인 원문에서 배정을 대조한다. 당시 검토 입력과 원문으로 `review`·`approve`에 각각 `--legacy-map <구 map>`을 붙이면 현재 모델 표를 읽지 않고 해당 과거 Run에 한정한 기록을 복원한다. 그 뒤 `reapprove --map <구 map> --id <해당 Task> --approval <승인파일>`로 그 ID에만 연결한다. 과거 배정의 근거가 부족하면 그 건을 창구로 올려 명시적으로 검토·승인받는다. 옛 이름의 완료 리포트와 이미 정산된 Dispatch를 보존한다.
