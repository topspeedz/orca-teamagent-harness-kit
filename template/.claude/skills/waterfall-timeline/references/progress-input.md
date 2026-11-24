# 진행 입력 (progress.mjs)

UTF-8 JSON. 시각은 모두 오프셋 포함 ISO(`2026-10-31T11:20+09:00`). 화면 시각은 첫 Task의 오프셋으로 표시한다(+09:00이면 KST). 예시: [examples/progress.json](../examples/progress.json).

- `title`: 제목(예 `P57 홈 UI — 워터폴 (실측 + 예상)`). `pageTitle`(선택): 브라우저 탭 이름, 2~4단어(예 `P57 Waterfall`).
- `run`(선택): Run ID. `dag`(선택): DAG 스윔레인 Artifact URL.
- `now`(선택): 기준 시각. 비우면 렌더한 순간.
- `tasks`: 비어 있지 않은 배열, 화면에 적은 순서대로 그린다(보통 시작 시각 순).
  - `title`: 작업명 — `· BL-####`, 등급, 결과(`✓`, `High 0`)를 붙여도 된다. 승인 대기는 `✋` 접두 — `✋` 막대는 점선(채움 없음)으로 그리고 그 구간을 모든 행에 세로 점선 띠로 표시하며(제목이 `K2 · ✋…`처럼 단계 접두로 시작해도 같다), 끝난 Run 헤더의 `작업 · 사용자 대기 · 빈 시간` 분해에서 작업 시간에 넣지 않는다.
  - `lane`: plan/coord/design/dev/verify/harness.
  - `status`: done(실측) / run(시작 실측·끝 예상) / wait(예상).
  - `start`, `end`: end ≥ start. done의 end와 run의 start는 `now`보다 늦을 수 없다.
  - `crit`(선택): 임계 경로면 true.
- `notes`: `{title, body}` 배열 — 하단 카드. 일반 문자열, HTML 넣지 않음.

헤더의 시작·예상 종료는 tasks의 최소 start·최대 end로 자동 계산한다. 축은 30분 눈금(1분 = 2.2px), 마지막 끝 또는 지금 뒤로 한 칸 여유. 모든 Task가 `done`이면 끝난 Run — "지금" 선·진행/대기 범례 없이 축이 첫 start~마지막 end만 덮고(여유 없음) 페이지 폭을 채우도록 늘어나며, 헤더는 `종료 · 소요`, 끝에 붙은 막대의 시각 라벨은 막대 왼쪽에 둔다.

## from-orca

막대 시작은 이 순서로 정한다. ① `--map` 항목에 `orca-launch.mjs`가 적은 실제 기동 시각(`okStarted`, 없으면 `started`). ② 없으면 Task가 준비된 시각 — 선행 Task의 가장 늦은 완료 시각(생성 시각보다 이르지 않게). 첫 팀원이 그보다 먼저 생성됐으면 그 시각. ③ 팀원 Task(`parent_id` 있음)는 생성 시각(`created_at`). 하네스가 Run 시작 때 계획 Task를 한꺼번에 등록해도 막대가 등록 시각부터 늘어지지 않는다. 팀원 행 이름은 spec 첫 줄이 `[역할: …]`뿐이면 `display_name`의 작업 번호와 할 일로 짓는다(`(BL-…)`은 계획 Task와 다시 맞물리지 않게 뺀다).

`scripts/from-orca.mjs`가 위 JSON을 만든다. `--plan`은 선택 — 없으면(다른 창구의 Run 등) Orca 실측 막대만 만들고 예상 막대는 `--patch`의 `tasks`로 받는다. 역할(`[역할: …]`)이 없는 Orca Task는 빼고, 목록은 `task-list --full`로 읽는다(요약 보기에는 spec·완료 시각이 없다). 입력: `--run`(쉼표로 리더 child Run을 함께 — 부모 task-list엔 child Run Task가 없다, 또는 저장한 task-list JSON `--tasks`), `--plan`(예측 입력 형식 또는 PM `lane` 형식 — `id`·`deps`·`kind`·`estimate.likely`·`bl`), 선택 `--map <orca-tasks.json>`·`--ledger`·`--now`·`--slots`(기본 계획 `maxWorkers`, 없으면 3)·`--title`·`--dag`·`--patch`.

- **매칭:** `--map`을 주면 실제 Orca Task ID → 계획 ID를 가장 먼저 적용한다. 같은 BL의 T01·T02도 각자의 시각을 받는다. 미기동 상태에서 재승인으로 교체한 옛 ID는 측정에서 제외한다. 대응표만 주면 그 실행 Run을 조회한다. `--run`을 함께 주면 첫 Run이 대응표의 Run과 같아야 한다. 대응표가 없는 Task는 장부 행의 `task_…` → 계획 ID를 사용한다. 없으면 spec 머리(`등급:` 앞)의 BL이나 계획 ID 토큰이 정확히 한 계획 Task에 맞을 때. 못 맞추면 역할로 lane을 정한 별도 행(계획 전 planner 단계 등).
- **재작업:** 같은 계획 ID에 두 번째 Task(FIX·재실행)가 오면 `<ID> ↻ <이름>` 별도 행, 계획 Task의 끝은 늦은 쪽.
- **리더(`· 리드]`):** 조정 lane 행. 진행 중이면 끝 = max(지금+10분, 묶음 BL 멤버의 끝)이고, 묶음 밖에서 멤버를 선행으로 둔 Task는 리더 보고 뒤에 시작한다.
- **승인(`kind` approval/done):** 선행이 모두 완료 + 후행(또는 후행이 속한 리더 묶음)이 시작 → 완료(선행 끝~후행 시작). 후행 미시작 → 진행(선행 끝~지금). 그 밖은 0분 대기 + "대기 시간 미정".
- **대기 배치:** 지금 이후, 의존성·슬롯(`work`만 슬롯 사용) 안에서 가장 먼저 시작 가능한 Task부터, 같으면 남은 경로가 긴 것부터. 임계 = 가장 늦은 끝에서 가장 늦게 끝난 선행을 따라간 사슬.
- **`--patch`:** `{ "notes": [{title, body}], "extraDeps": { "<ID>": ["<선행 ID>"] }, "tasks": [진행 입력 형식 행] }` — `tasks`는 그대로 더한다(장부 ✋ 게이트, 계획 없는 Run의 남은 예상) — 지금 걸린 결정·지연 요인 카드, 계획에 없던 대기.
- 코디네이터 gate처럼 Orca Task가 없는 계획 Task는 지났어도 추정으로 남는다 — notes에 실제 진행을 적는다.
