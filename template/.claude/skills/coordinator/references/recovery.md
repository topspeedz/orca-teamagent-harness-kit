# 압축에서 돌아왔을 때

> 읽는 시점: 코디네이터의 대화가 압축된 직후. 압축 요약만 믿고 이어 가지 않는다.

압축 요약에는 Run ID, 진행 중인 Dispatch ID, 추적 중인 대기 작업, 현재 단계, 사용자 결정 원문이 남아 있어야 한다(공통 지침의 `## Compact Instructions`). 그래도 아래 순서로 다시 맞춘다.

1. **브리프, 장부, Task 대응표를 다시 읽는다.** `_workspace/_run/<phase>/`의 `brief.md`, `ledger.md`, `orca-tasks.json`이다. 실행 Run ID는 브리프와 대응표에 있다.
2. **백그라운드 작업을 본다.** 하네스가 추적하는 백그라운드 작업 목록에 `check --wait`가 있으면 멈춘다(대기 계약은 그 명령을 쓰지 않는다). 답을 기다리는 `ask --wait`가 있으면 그대로 둔다.
3. **상태를 본다.** 메시지를 소비하지 않는 명령으로 본다.

   ```text
   node .claude/scripts/orca-launch.mjs ready --map _workspace/_run/<phase>/orca-tasks.json
   node .claude/scripts/orca-launch.mjs snapshot --run <실행 Run>
   ```

   Task의 상태는 기억이 아니라 `ready`가 돌려준 Orca의 상태로 이어 간다. 대기 중인 메시지와 워커 목록을 장부와 대조한다. 장부에 없는 `worker_done`이 있으면 `orca orchestration check --run <실행 Run>`으로 받아 정산한다. 이미 장부에 정산된 message id는 다시 정산하지 않는다.
4. **턴을 끝낸다.** 띄울 Task와 정산할 메시지가 없으면 `SKILL.md`의 대기 계약대로 턴을 끝낸다. 다음 보고는 Orca가 알림으로 깨운다.

- 침묵, 타임아웃, 목록 부재만으로 워커를 종료로 판정하거나 다시 띄우지 않는다.
- 스윔레인은 `ready`의 상태로 같은 파일 경로에 다시 게시한다.
