> 이 블록을 `coordinator`, `team-lead`, `plan-orchestrate`의 본문에 그대로 넣는다. 고칠 때는 여기를 고치고 세 스킬에 다시 붙인다.

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
