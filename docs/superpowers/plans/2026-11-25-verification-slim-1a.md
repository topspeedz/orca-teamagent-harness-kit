# 검증 수렴 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 킷에 이미 있는 검증 규칙(수정에는 High만, 수정 뒤에는 결함 ID만, 전체 테스트는 한 번)을 기동 경로의 스크립트가 지키게 하고, 고칠 것이 없는 Task를 건너뛰는 길과 측정 기록을 더한다.

**Architecture:** 계획 검토(`orca-launch-approval.mjs`)가 DAG의 `rounds` 표기에서 Task마다 종류(검증, 수정, 재검)를 읽어 승인 기록에 싣는다. 기동 스크립트(`orca-launch.mjs`)는 그 종류와 장부의 결함 원장을 보고 띄우기 전에 거부한다. 결함 원장은 새 스크립트가 검증 리포트의 결함 표에서 만든다. 스킬과 양식은 이 스크립트들이 읽는 줄 이름에 맞춰 고친다.

**Tech Stack:** Node.js ESM 스크립트(의존성 없음), `node:test` 없이 `assert` 기반 `*.check.mjs`, git CLI, Markdown 스킬 문서.

**Spec:** `docs/superpowers/specs/2026-11-25-verification-slim-design.md`의 3절(1a). 4절과 5절은 이 계획의 범위가 아니다.

## Global Constraints

- 새 의존성을 더하지 않는다. 스크립트는 프로젝트 루트에서 `node`로 돈다.
- Windows에서 돈다. 스크립트 안에서 셸 문법을 쓰지 않고 `spawnSync`에 인자 배열과 `env`를 넘긴다.
- `node scripts/run-checks.mjs`가 모두 통과한다. `node scripts/template-lint.mjs`의 결함은 12건에서 늘지 않는다.
- `template/` 아래 파일(검사 파일 포함)에는 백로그 번호를 `BL-0001`, `BL-0002`, `BL-0012`만 쓴다. `template/.claude/`와 `template/AGENTS.md`에는 `20dd-dd-dd` 꼴의 날짜를 쓰지 않는다. `template/AGENTS.md`는 13312바이트 이하, `SKILL.md`는 500줄 미만이다.
- 각 스킬의 `## 대기 계약` 절은 한 글자도 고치지 않는다.
- `phase-routing.mjs`와 팀장을 거치는 기준은 고치지 않는다(사용자 결정 D).
- `rounds`, `conditional`, `afterFix`가 없는 옛 승인 기록과 옛 계획은 지금과 똑같이 동작한다.
- 작업 브랜치는 `refactor/requirements-write-skill`에서 딴 `feat/verification-slim-1a`다. 커밋 메시지 끝에는 세션이 준 귀속 줄을 붙인다. push와 PR은 사용자에게 다시 묻는다.

**모든 Task가 같이 쓰는 이름 (글자 그대로)**

| 무엇 | 값 |
| --- | --- |
| spec의 결함 줄 | `결함 ID: H-1, A-H-2` (쉼표로 구분) |
| spec의 수정 diff 줄 | `수정 diff: <파일 경로>` |
| `AGENTS.md` `## 명령` 절의 표시 | 그 줄 끝의 `(전체 테스트)` |
| 리포트의 결함 표 머리 | `\| ID \| 심각도 \| 증거 \| 위치 \| 요지 \|` (`## 결함` 절 안) |
| 증거 칸의 첫 낱말 | `관찰`, `인용`, `없음` 중 하나 |
| 장부의 결함 원장 | `## 결함 원장` 절, 머리 `\| ID \| 제기한 검증 \| 심각도 \| 증거 \| 라운드 \| 상태 \|` |
| 상태 값 | `열림`, `확정`, `인용`, `기각`, `이월` |
| 장부 `## 결정`의 수정 예외 | `- <결함 ID> \| 수정 포함 승인 \| <사용자 답변 원문>` |
| 장부 `## 결정`의 전 범위 예외 | `- <Task ID> \| 전 범위 검증 승인 \| <사용자 답변 원문>` |
| DAG 노드의 새 선택 필드 | `conditional: true`, `afterFix: "<사유>"` |
| 승인 기록 Task 행의 새 필드 | `kind`(`verify`, `fix`, `recheck`), `round`(정수), `conditional`, `afterFix` |

## Review Focus

1. **옛 승인 기록으로 띄우기.** `kind`가 없는 승인으로 등록·기동하면 새 검사가 하나도 걸리지 않아야 한다. (Task 3, Task 5의 검사)
2. **결함 표의 변형.** CRLF 줄 끝, 영역 접두어가 붙은 ID(`A-H-1`), 표가 없거나 본문이 `없음`인 리포트를 넣어도 죽지 않고 맞게 읽어야 한다. (Task 2의 검사)
3. **`skip`이 반쯤 된 상태를 남기지 않기.** 앞 Task가 등록되지 않았거나 이미 기동한 Task에 `skip`을 주면 거부하고 Orca와 대응표를 건드리지 않아야 한다. (Task 4의 검사)
4. **완료 기준 밖에 적힌 전체 테스트 명령.** spec의 `금지:` 줄에 "전체 테스트를 돌리지 않는다"고 그 명령을 적은 경우는 거부하면 안 된다. `AGENTS.md`가 없거나 표시가 없을 때도 거부하면 안 된다. (Task 5의 검사)
5. **한글과 공백이 든 경로.** 스냅샷과 diff가 `문서 폴더/새 파일.txt` 같은 경로를 깨지 않고 돌려줘야 한다. 커밋이 하나도 없는 저장소에서도 돌아야 한다. (Task 1의 검사)

---

### Task 1: 작업 폴더 스냅샷 스크립트

**Files:**
- Create: `template/.claude/scripts/tree-snapshot.mjs`
- Test: `template/.claude/scripts/tree-snapshot.check.mjs`

**Interfaces:**
- Produces:
  - `take(git): string` — 작업 폴더 전체의 tree ID. `git(args: string[], env?: Record<string,string>) => { status: number, stdout: string, stderr: string }`
  - `diff(git, from: string, to: string, paths?: string[]): { status: string, path: string }[]`
  - CLI `node .claude/scripts/tree-snapshot.mjs take` → `{"tree":"<40자>"}`
  - CLI `node .claude/scripts/tree-snapshot.mjs diff --from <tree> --to <tree> [--path <p>]…` → `{"files":[{"status":"M","path":"a.txt"}]}`
  - 실패하면 종료 코드 1과 `{"error":"<사유>"}`

- [ ] **Step 1: 실패하는 검사를 쓴다**

임시 폴더에 실제 git 저장소를 만들어 돌린다(다른 검사 파일의 `let passed = 0; const t = …` 꼴을 따른다).

```js
// 1. 수정, 새 파일, 삭제가 잡히고 무시 경로는 빠진다
const s1 = take(git);                       // a.txt 수정, new.txt 추가, c.txt 스테이징, _workspace/r.md(무시)
assert.deepEqual(names(diff(git, 'HEAD', s1)), ['M a.txt', 'A c.txt', 'A new.txt']);
// 2. 실제 인덱스와 작업 폴더가 그대로다
assert.equal(run('git', ['diff', '--cached', '--name-status']), stagedBefore);
assert.equal(run('git', ['status', '--porcelain']), statusBefore);
// 3. 두 스냅샷 사이의 변경과 경로 좁히기
const s2 = take(git);                       // a.txt 다시 수정, b.txt 삭제
assert.deepEqual(names(diff(git, s1, s2)), ['M a.txt', 'D b.txt']);
assert.deepEqual(names(diff(git, s1, s2, ['a.txt'])), ['M a.txt']);
// 4. 한글과 공백 경로
assert.ok(diff(git, s2, take(git)).some(f => f.path === '문서 폴더/새 파일.txt'));
// 5. 커밋이 없는 저장소에서도 tree ID가 나온다
assert.match(take(emptyRepoGit), /^[0-9a-f]{40}$/);
```

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/scripts/tree-snapshot.check.mjs`
Expected: `Cannot find module` 오류로 실패

- [ ] **Step 3: `take`, `diff`, CLI를 구현한다**

임시 인덱스 파일은 `git rev-parse --git-dir`가 돌려준 폴더의 `snap-index`다. `GIT_INDEX_FILE`을 `env`로 넘겨 `read-tree HEAD`(커밋이 없으면 `read-tree --empty`), `add -A`, `write-tree` 순서로 돌린다. `diff`는 `git diff --name-status -z`로 받아 경로가 인용 부호로 바뀌지 않게 한다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/scripts/tree-snapshot.check.mjs`
Expected: 종료 코드 0, 통과 수 출력

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/scripts/tree-snapshot.mjs template/.claude/scripts/tree-snapshot.check.mjs
git commit -m "feat: add tree-snapshot script for task and fix diffs"
```

---

### Task 2: 결함 원장 스크립트

**Files:**
- Create: `template/.claude/scripts/defect-ledger.mjs`
- Test: `template/.claude/scripts/defect-ledger.check.mjs`

**Interfaces:**
- Produces:
  - `parseDefects(reportText: string): { id: string, severity: 'High'|'Medium'|'Low', evidence: '관찰'|'인용'|'없음', where: string, demoted?: true }[]`
  - `readLedger(ledgerText: string): { defects: { id, source, severity, evidence, round: number, state }[], decisions: string[] }`
  - `addDefects(ledgerText: string, { source: string, round: number, defects }): string`
  - `currentRound(map: { tasks: Record<string, { kind?: string, round?: number, dispatch?: string|null }> }): number`
  - `fixAllowed(ledger: ReturnType<typeof readLedger>, ids: string[]): { ok: boolean, refused: { id: string, reason: string }[] }`
  - CLI `node .claude/scripts/defect-ledger.mjs add --ledger <ledger.md> --map <orca-tasks.json> --report <리포트.md> --source <Task ID>` → `{"added":["H-1"],"round":1,"open":{"High":1,"Medium":0,"Low":0}}`

- [ ] **Step 1: 실패하는 검사를 쓴다**

```js
const report = '# 리포트\n\n## 결함\n\n| ID | 심각도 | 증거 | 위치 | 요지 |\n| --- | --- | --- | --- | --- |\n'
  + '| H-1 | High | 관찰 `tests/login.test.mjs` | `src/login.mjs:12` | 잠금이 풀리지 않음 |\n'
  + '| A-H-2 | High | 없음 | `src/a.mjs:3` | 근거 없이 올린 것 |\n'
  + '| M-1 | Medium | 인용 수락 기준 2 | `src/b.mjs:9` | 문구 다름 |\n\n## 검증\n';
// 1. 표를 읽는다. 증거가 없는 High는 Medium으로 내린다
assert.deepEqual(parseDefects(report).map(d => [d.id, d.severity, d.evidence, !!d.demoted]),
  [['H-1', 'High', '관찰', false], ['A-H-2', 'Medium', '없음', true], ['M-1', 'Medium', '인용', false]]);
// 2. CRLF, 표 없음, 본문 "없음"
assert.equal(parseDefects(report.replace(/\n/g, '\r\n')).length, 3);
assert.deepEqual(parseDefects('# 리포트\n\n## 결함\n\n없음\n'), []);
assert.deepEqual(parseDefects('# 리포트\n'), []);
// 3. 원장에 넣는다. `## 결정` 앞에 절이 생기고, 두 번 넣어도 같다
const led = '# 장부: phase-a\n\n## 결정\n\n- 첫 줄\n';
const once = addDefects(led, { source: 'T07', round: 1, defects: parseDefects(report) });
assert.ok(once.indexOf('## 결함 원장') < once.indexOf('## 결정'));
assert.equal(addDefects(once, { source: 'T07', round: 1, defects: parseDefects(report) }), once);
assert.deepEqual(readLedger(once).defects.map(d => [d.id, d.source, d.severity, d.round, d.state]),
  [['H-1', 'T07', 'High', 1, '열림'], ['A-H-2', 'T07', 'Medium', 1, '열림'], ['M-1', 'T07', 'Medium', 1, '열림']]);
// 4. 손으로 고친 상태 칸은 다시 넣어도 남는다
const closed = once.replace('| H-1 | T07 | High | 관찰 | 1 | 열림 |', '| H-1 | T07 | High | 관찰 | 1 | 확정 |');
assert.equal(addDefects(closed, { source: 'T07', round: 1, defects: parseDefects(report) }), closed);
// 5. 라운드: 띄운 수정 회차 + 1
assert.equal(currentRound({ tasks: { F1: { kind: 'fix', round: 1, dispatch: null } } }), 1);
assert.equal(currentRound({ tasks: { F1: { kind: 'fix', round: 1, dispatch: 'ctx_1' }, F1b: { kind: 'fix', round: 1, dispatch: 'ctx_2' } } }), 2);
// 6. 수정에 넣을 수 있는가
const L = readLedger(once.replace('- 첫 줄', '- M-1 | 수정 포함 승인 | 이번에 같이 고쳐 주세요'));
assert.equal(fixAllowed(L, ['H-1', 'M-1']).ok, true);
assert.deepEqual(fixAllowed(readLedger(once), ['M-1', 'X-9']).refused.map(r => r.id), ['M-1', 'X-9']);
assert.equal(fixAllowed(readLedger(closed), ['H-1']).ok, false);   // 이미 닫힌 High
```

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/scripts/defect-ledger.check.mjs`
Expected: `Cannot find module` 오류로 실패

- [ ] **Step 3: 다섯 함수와 CLI를 구현한다**

`parseDefects`는 `## 결함` 절에서 머리가 `ID`, `심각도`, `증거`, `위치`로 시작하는 첫 표만 읽는다. `addDefects`는 이미 있는 ID의 줄을 건드리지 않는다. `currentRound`는 `kind`가 `fix`이고 `dispatch`가 있는 Task의 서로 다른 `round` 수에 1을 더한다. `fixAllowed`는 High이고 상태가 `열림`인 것, 또는 `decisions`에 그 ID의 `수정 포함 승인` 줄이 있는 것만 받는다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/scripts/defect-ledger.check.mjs`
Expected: 종료 코드 0

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/scripts/defect-ledger.mjs template/.claude/scripts/defect-ledger.check.mjs
git commit -m "feat: build the defect ledger from verification reports"
```

---

### Task 3: 계획 검토가 Task의 종류를 읽고 두 가지를 거부한다

**Files:**
- Modify: `template/.claude/scripts/orca-launch-approval.mjs` (`assignments` 함수)
- Test: `template/.claude/scripts/orca-launch.check.mjs` (끝에 사례를 더한다. 기존 `approve(f, nodes, edges, version, drawing)` 도우미를 쓴다)

**Interfaces:**
- Consumes: DAG 입력의 `rounds: [{ n, verify, fix, recheck }]`(각 값은 노드 ID 하나 또는 배열), 노드의 `conditional`, `afterFix`
- Produces: 승인 기록 `tasks[id]`에 `kind`, `round`, `conditional`, `afterFix`가 있을 때만 붙는다. Task 4와 Task 5가 이 필드를 읽는다.

- [ ] **Step 1: 실패하는 검사를 쓴다**

```js
// A. 표기가 없는 DAG의 승인 기록에는 새 필드가 하나도 없다
const plain = await approve(f, [T('T01'), T('T02')], [E('T01', 'T02')]);
for (const row of Object.values(record(plain).tasks))
  for (const k of ['kind', 'round', 'conditional', 'afterFix']) assert.equal(k in row, false);
// B. rounds가 종류와 회차를 붙인다
const marked = await approve(f, [T('T01'), T('Q1'), T('F1'), T('R1'), { ...T('D1'), conditional: true }],
  [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'R1'), E('R1', 'D1')], 'v1',
  { rounds: [{ n: 1, verify: ['Q1'], fix: 'F1', recheck: 'R1' }] });
assert.deepEqual(['Q1', 'F1', 'R1'].map(id => [record(marked).tasks[id].kind, record(marked).tasks[id].round]),
  [['verify', 1], ['fix', 1], ['recheck', 1]]);
assert.equal(record(marked).tasks.D1.conditional, true);
// C. 검증이 수정 뒤에 걸리면 거부한다
assert.match(await reviewError([T('T01'), T('Q1'), T('F1'), T('Q2')], [E('T01', 'Q1'), E('Q1', 'F1'), E('F1', 'Q2')],
  { rounds: [{ n: 1, verify: ['Q1', 'Q2'], fix: 'F1' }] }), /검증 Task Q2가 수정 Task F1 뒤에/);
// D. 사유를 적은 검증은 통과하고 사유가 기록에 남는다
// (Q2에 afterFix: '고친 빌드가 있어야 볼 수 있는 실기기 회차') → tasks.Q2.afterFix가 그 문자열
// E. 수정 사슬이 3단이면 거부한다
// (F1 → R1 → F2 → R2 → F3) → /수정 Task 사슬이 2단을 넘음/
// F. rounds가 없는 노드를 가리키면 거부한다 → /rounds가 가리키는 노드 없음/
```

`T`, `E`, `record`, `reviewError`는 이 사례들 위에 두는 작은 도우미다. `T(id)`는 기존 사례가 쓰는 배정이 든 노드를 만든다.

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 새 사례 B에서 `undefined !== 'verify'`로 실패

- [ ] **Step 3: `assignments`에 표기 읽기와 두 검사를 넣는다**

Task 행을 다 만든 뒤에 돈다. 검증이 수정 뒤에 걸렸는지는 `deps`를 끝까지 따라가서 본다. 수정 사슬은 어느 의존 경로에서든 `kind`가 `fix`인 Task가 2개를 넘는지로 본다. `afterFix`는 빈 문자열이 아닌 문자열일 때만 받는다. 새 필드는 값이 있을 때만 행에 넣어서 표기가 없는 DAG의 해시가 바뀌지 않게 한다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 종료 코드 0. 기존 사례도 모두 통과한다

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/scripts/orca-launch-approval.mjs template/.claude/scripts/orca-launch.check.mjs
git commit -m "feat: read task kinds from rounds and refuse verify-after-fix plans"
```

---

### Task 4: `skip` 명령

**Files:**
- Modify: `template/.claude/scripts/orca-launch.mjs` (머리 주석의 명령 목록, `fail` 명령 아래에 `skip`, `worker --map`의 첫 검사)
- Test: `template/.claude/scripts/orca-launch.check.mjs`

**Interfaces:**
- Consumes: Task 3의 `tasks[id].kind`, `tasks[id].conditional`
- Produces: `node .claude/scripts/orca-launch.mjs skip --map <map> --id <Task ID> --reason <사유>` → `{"id":"D1","skipped":true,"promoted":["P1"]}`. 대응표의 그 Task에 `skipped: { reason, at }`가 생긴다.

- [ ] **Step 1: 실패하는 검사를 쓴다**

`fakeDag`와 `approve`로 `T01 → D1(conditional) → P1` 계획을 만든다.

```js
// 1. 표시가 없는 Task는 건너뛸 수 없다. 아무것도 바뀌지 않는다
const no = await main(['skip', ...M, '--id', 'T01', '--reason', '필요 없음'], f.deps);
assert.equal(no.code, 1); assert.match(no.out.error, /건너뛸 수 있는 Task가 아님/);
assert.equal(f.count('task-update'), 0);
// 2. 앞 Task가 등록되지 않았으면 거부한다
assert.match((await main(['skip', ...M, '--id', 'D1', '--reason', '문서 영향 없음'], f.deps)).out.error, /미등록 선행 Task: T01/);
// 3. 등록 없이 건너뛴다: Orca에 Task가 생기고 끝난 것으로 표시된다
await main(reg('T01', 'a.md'), f.deps); f.tasks.get(f.map().tasks.T01.orca).status = 'completed';
const ok = await main(['skip', ...M, '--id', 'D1', '--reason', '문서 영향 없음'], f.deps);
assert.equal(ok.code, 0, JSON.stringify(ok.out));
assert.equal(f.tasks.get(f.map().tasks.D1.orca).status, 'completed');
assert.equal(f.map().tasks.D1.skipped.reason, '문서 영향 없음');
assert.match(f.tasks.get(f.map().tasks.D1.orca).spec, /건너뜀: 문서 영향 없음/);
// 4. 뒤 Task를 등록하면 준비 상태가 된다. 이미 등록돼 대기 중이던 뒤 Task는 skip이 준비 상태로 올린다
// (P1을 D1보다 먼저 등록해 둔 변형에서 out.promoted가 ['P1'])
// 5. 건너뛴 Task는 띄울 수 없고 actual에 나오지 않는다
assert.match((await main(go('D1'), f.deps)).out.error, /건너뛴 Task/);
assert.equal((await main(['actual', ...M], f.deps)).out.some(r => r.id === 'D1'), false);
// 6. 이미 기동한 Task는 거부한다 → /이미 기동했거나 끝난 Task/
```

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 새 사례 1에서 `사용법` 또는 알 수 없는 명령 오류로 실패

- [ ] **Step 3: `skip`을 구현한다**

건너뛸 수 있는 것은 승인 행의 `conditional`이 참이거나 `kind`가 `fix` 또는 `recheck`인 Task뿐이다. 등록되지 않은 Task는 `건너뜀: <사유>` 한 줄과 승인 표식이 든 spec으로 Orca에 만들고, 등록된 의존을 그대로 건다. 그다음 `task-update --status completed --result "건너뜀: <사유>"`를 부른다. 끝으로 이 Task에 의존하고, 다른 의존이 모두 끝났고, 게이트가 없고, 상태가 `pending`인 등록 Task를 `ready`로 올린다. 거부할 때는 Orca를 부르기 전에 돌아간다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 종료 코드 0

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/scripts/orca-launch.mjs template/.claude/scripts/orca-launch.check.mjs
git commit -m "feat: add skip command for conditional, fix and recheck tasks"
```

---

### Task 5: 띄우기 전의 세 가지 거부

**Files:**
- Modify: `template/.claude/scripts/orca-launch.mjs` (`checkedSpec`, `worker --map`, 팀원 직접 기동 경로)
- Test: `template/.claude/scripts/orca-launch.check.mjs`

**Interfaces:**
- Consumes: Task 2의 `readLedger`, `fixAllowed`, `currentRound`. Task 3의 `kind`, `afterFix`. 장부는 대응표와 같은 폴더의 `ledger.md`, `AGENTS.md`는 프로젝트 루트.
- Produces: 아래 거부 문구(검사가 이 문구를 본다)
  - `수정 Task의 결함 ID 줄이 없음`
  - `수정에 넣을 수 없는 결함: <ID>(<사유>)`
  - `수정 뒤의 검증은 결함 ID와 수정 diff가 필요함`
  - `완료 기준에 전체 테스트 명령이 있음: <명령>`
  - `장부를 읽을 수 없음`

- [ ] **Step 1: 실패하는 검사를 쓴다**

`T01 → Q1(verify) → F1(fix) → R1(recheck)` 계획과, `Q1`이 팀장이고 팀원을 직접 띄우는 변형을 쓴다.

```js
// 수정 Task (3.1)
// 1. `결함 ID:` 줄이 없으면 거부
// 2. Medium인 ID가 있으면 거부, 문구에 그 ID가 나온다
// 3. 열린 High만 있으면 기동된다
// 4. Medium이어도 장부 `## 결정`에 `- M-1 | 수정 포함 승인 | …`이 있으면 기동된다
// 5. 장부 파일이 없으면 /장부를 읽을 수 없음/으로 거부하고 예외를 던지지 않는다
// 수정 뒤의 검증 (3.2)
// 6. 수정 라운드 전의 검증 Q1은 `결함 ID:` 없이 기동된다
// 7. F1을 띄운 뒤 R1은 `결함 ID:`와 `수정 diff:`가 둘 다 있어야 기동된다
// 8. F1을 띄운 뒤 Q1 팀장이 새 팀원을 띄울 때 팀원 spec에 `결함 ID:`가 없으면 거부된다
// 9. 장부 `## 결정`에 `- <Task ID> | 전 범위 검증 승인 | …`이 있거나 승인 행에 afterFix가 있으면 7과 8이 통과한다
// 옛 승인
// 10. kind가 없는 승인에서는 1~8의 어떤 거부도 일어나지 않는다
// 완료 기준의 전체 테스트 (3.3)
// 11. AGENTS.md의 `## 명령`에 "- `npm test` — 저장소 전체 (전체 테스트)"가 있고
//     spec의 `완료 기준:`에 `npm test`가 있으면 register가 거부한다
// 12. 같은 명령이 `금지:` 줄에만 있으면 등록된다
// 13. AGENTS.md가 없거나 표시가 없으면 등록된다
```

각 사례는 `main([...])`의 `code`와 `out.error`를 위 Produces의 문구로 단언한다.

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 사례 1에서 `code === 0`이라 실패(지금은 거부하지 않는다)

- [ ] **Step 3: 세 검사를 넣는다**

- 전체 테스트 검사는 `checkedSpec` 안에 둔다. 등록, 재승인, 팀원 기동이 모두 이 함수를 지난다. `완료 기준:` 줄부터 다음 `검증 환경값`, `막히면:`, `보고:` 줄 앞까지만 본다.
- 수정 Task 검사와 수정 뒤 검증 검사는 워커를 실제로 띄우기 직전에 둔다. `worker --map`에서는 Orca에 등록된 spec을, 팀원 직접 기동에서는 넘겨받은 spec 파일을 본다. 팀원은 부모 Task의 `kind`를 따른다.
- "수정 뒤"는 `currentRound(대응표) > 1`로 판정한다. `kind`가 `recheck`인 Task는 라운드와 관계없이 두 줄이 필요하다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 종료 코드 0

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/scripts/orca-launch.mjs template/.claude/scripts/orca-launch.check.mjs
git commit -m "feat: refuse fix, post-fix verification and full-test specs at launch"
```

---

### Task 6: 측정 표에 결함과 건너뛴 Task를 더한다

**Files:**
- Modify: `template/.claude/skills/harness-retro/scripts/retro-measure.mjs`
- Test: `template/.claude/skills/harness-retro/scripts/retro-measure.check.mjs`

**Interfaces:**
- Consumes: Task 2의 `readLedger`, `currentRound`(경로 `../../../scripts/defect-ledger.mjs`). 새 선택 인자 `--map <orca-tasks.json>`
- Produces: `defects(ledgerText, map?): { rounds: number|null, high: number, confirmed: number, cited: number, dismissed: number, open: number, lowerFixed: number, skipped: number|null }`와 출력 표의 새 줄

- [ ] **Step 1: 실패하는 검사를 쓴다**

```js
const led = '## 결함 원장\n\n| ID | 제기한 검증 | 심각도 | 증거 | 라운드 | 상태 |\n| --- | --- | --- | --- | --- | --- |\n'
  + '| H-1 | Q1 | High | 관찰 | 1 | 확정 |\n| H-2 | Q1 | High | 인용 | 1 | 인용 |\n| H-3 | Q1 | High | 관찰 | 1 | 기각 |\n| M-1 | Q1 | Medium | 관찰 | 1 | 확정 |\n\n'
  + '## 결정\n\n- M-1 | 수정 포함 승인 | 같이 고쳐 주세요\n';
const map = { tasks: { F1: { kind: 'fix', round: 1, dispatch: 'ctx_1' }, D1: { skipped: { reason: '문서 영향 없음' } } } };
assert.deepEqual(defects(led, map), { rounds: 1, high: 3, confirmed: 1, cited: 1, dismissed: 1, open: 0, lowerFixed: 1, skipped: 1 });
// 원장이 없는 옛 장부는 null을 돌려주고, 출력에는 `측정 불가`가 찍힌다
assert.equal(defects('# 장부: phase-a\n\n수정 루프 1회\n'), null);
```

- [ ] **Step 2: 검사가 실패하는지 본다**

Run: `node template/.claude/skills/harness-retro/scripts/retro-measure.check.mjs`
Expected: `defects is not a function`으로 실패

- [ ] **Step 3: `defects`와 출력 줄을 구현한다**

출력 표에 `수정 라운드(결함 원장)`, `제기된 High`, `확정 · 인용 · 기각 · 열림`, `High가 아닌데 수정에 든 결함`, `건너뛴 Task` 줄을 더한다. `--map`이 없으면 라운드와 건너뛴 Task는 `측정 불가`다. 원장이 없으면 지금처럼 예산 줄의 `수정 루프 <N>회`를 쓴다.

- [ ] **Step 4: 검사가 통과하는지 본다**

Run: `node template/.claude/skills/harness-retro/scripts/retro-measure.check.mjs`
Expected: 종료 코드 0

- [ ] **Step 5: 커밋한다**

```bash
git add template/.claude/skills/harness-retro/scripts/
git commit -m "feat: report defect rounds and skipped tasks in retro measurements"
```

---

### Task 7: 양식과 공통 지침

**Files:**
- Modify: `template/docs/harness/templates/spec.md`, `template/docs/harness/templates/ledger.md`, `template/docs/harness/templates/report.md`, `template/AGENTS.md`, `template/.claude/skills/dag-swimlane/SKILL.md`

**Interfaces:**
- Consumes: Global Constraints의 이름 표
- Produces: 스킬이 가리킬 양식의 줄. Task 8~10이 이 양식을 가리킨다.

- [ ] **Step 1: 양식 다섯 곳을 고친다**

| 파일 | 넣는 것 (설계서의 절) |
| --- | --- |
| `templates/spec.md` | 수정 Task와 수정 뒤 검증 Task의 `결함 ID:` 줄, `수정 diff:` 줄, 고정 완료 기준 문장 "결함 ID마다 원래 재현 절차를 다시 돌린다"(3.2). 수정 Task는 받은 실패 테스트를 고치지 않고, 고쳐야 하면 사유를 리포트에 적는다(3.6). 시험 갱신 Task의 처리 두 가지: 옛 기대값이면 시험을 고치고 근거가 된 계획이나 수락 기준의 줄을 적는다, 근거를 댈 수 없으면 고치지 않고 리포트의 `## 결함` 표에 High로 적는다(3.3). 검증 Task의 `이미 아는 것:` 줄과 그 범위 규칙(3.9). 작업 단위의 뜻을 적는 한 줄(3.9). 완료 기준에 전체 테스트 명령을 넣으면 등록이 거부된다는 것(3.3) |
| `templates/ledger.md` | `## 결함 원장` 절과 머리. 이 표는 `defect-ledger.mjs`가 쓰고 손으로는 상태 칸만 고친다는 것. 예산 줄에서 `수정 루프 <N>회`를 빼고 라운드는 스크립트가 센다고 적기. `## 결정`의 두 예외 줄 형식(3.1, 3.2, 3.8) |
| `templates/report.md` | 검증 리포트의 `## 결함` 표 머리와 증거 칸의 세 값(3.6, 3.8) |
| `AGENTS.md` | `## 명령` 절에 전체 테스트 명령 줄 끝에 `(전체 테스트)`를 붙이는 규칙 한 줄(3.3). 역할 계층 문단의 "상대 산출물을 검토시킨다"를 조건이 맞을 때로(3.10). 13312바이트를 넘지 않는다 |
| `dag-swimlane/SKILL.md` | 입력 형식에 노드의 선택 필드 `conditional`, `afterFix` 두 줄. `rounds`가 계획 검토에 쓰인다는 한 줄(3.2) |

- [ ] **Step 2: 확인한다**

Run: `node scripts/template-lint.mjs 2>&1 | grep -c .` → `12`
Run: `grep -c "결함 ID:" template/docs/harness/templates/spec.md` → 1 이상
Run: `grep -c "## 결함 원장" template/docs/harness/templates/ledger.md` → `1`
Run: `node scripts/run-checks.mjs` → 실패 0 (양식 문구에 기대는 검사가 깨졌으면 그 검사를 같은 뜻으로 고친다)

- [ ] **Step 3: 커밋한다**

```bash
git add template/docs/harness/templates template/AGENTS.md template/.claude/skills/dag-swimlane/SKILL.md
git commit -m "docs: add defect ledger, fix-scope and full-test markers to templates"
```

---

### Task 8: 코디네이터의 실행 규칙

**Files:**
- Modify: `template/.claude/skills/coordinator/SKILL.md`, `template/.claude/skills/coordinator/references/settle.md`

**Interfaces:**
- Consumes: Task 1의 `tree-snapshot.mjs`, Task 2의 `defect-ledger.mjs add`, Task 4의 `skip`, Task 5의 거부 문구, Task 7의 양식

- [ ] **Step 1: `coordinator/SKILL.md`를 고친다**

| 절 | 바꾸는 것 (설계서의 절) |
| --- | --- |
| 워커 기동 2번(등록) | 수정 Task와 재검 Task의 spec은 끝 검증이 정산된 뒤에 쓰고 그때 등록한다(3.1) |
| phase의 단계 표와 그 아래 | 6단계 문서 동기화와 7단계 회고 워커는 조건이 맞을 때만 띄우고 아니면 `skip`(3.10). 조건: 장부의 `## 라이브 문서 확인`에 행이 있는가, 측정 표에 실패·재시도가 있거나 수정 라운드가 2에 닿았거나 마지막 회고 뒤 5 phase가 지났는가. 측정 표는 항상 코디네이터가 `retro-measure.mjs`로 남긴다 |
| 검증과 수정 루프의 배치 | 시험 갱신 Task가 준비되면 전체 테스트를 돌리고, 통과면 `skip`, 실패면 실패 목록을 spec에 넣어 띄운다. 그 리포트가 High로 적은 것만 `defect-ledger.mjs add`로 원장에 올리고, 옛 기대값을 고친 것은 올리지 않고 라운드에 세지 않는다. 끝 QA의 spec에 전체 테스트 결과 경로와 이미 열린 결함 ID를 넣는다(3.3, 3.6) |
| 수정 루프의 다섯 규칙 | 1번: High만. "완료 기준 미달"은 High로 적힌 것만. Medium 이하는 사용자 결정 줄이 있어야 한다. 열린 High가 0이면 라운드를 시작하지 않고 수정·재검 Task를 `skip`한다. 3번: 재검 spec에 `결함 ID:`와 `수정 diff:`를 넣는다. 전 범위를 다시 봐야 하면 띄우지 않고 사용자에게 올린다. 4번: 3회째 질문에 라운드별 High 수와 검증·수정에 쓴 워커 수·시간을 싣는다(3.1, 3.2) |
| 정산 | 검증 리포트를 정산할 때 `defect-ledger.mjs add`를 돌린다. Task와 수정을 정산할 때 `tree-snapshot.mjs take`를 돌려 값을 장부에 적는다(3.7, 3.8) |

- [ ] **Step 2: `references/settle.md`를 고친다**

장부 절에서 예산 줄의 수정 루프 횟수 갱신을 빼고 결함 원장과 상태 칸 규칙을 넣는다. 백로그 상태 열 절의 "정산 뒤 독립 harness-engineer의 회고를 받아 마감한다"를 조건부로 바꾼다.

- [ ] **Step 3: 확인한다**

Run: `node template/.claude/scripts/wait-contract-check.check.mjs` → 종료 코드 0 (대기 계약 절을 건드리지 않았다)
Run: `grep -n "생략하지\|매 phase" template/.claude/skills/coordinator/SKILL.md template/.claude/skills/coordinator/references/settle.md` → 출력 없음
Run: `grep -c "defect-ledger.mjs\|tree-snapshot.mjs\|orca-launch.mjs skip" template/.claude/skills/coordinator/SKILL.md` → 3 이상
Run: `node scripts/template-lint.mjs 2>&1 | grep -c .` → `12`

- [ ] **Step 4: 커밋한다**

```bash
git add template/.claude/skills/coordinator
git commit -m "docs: coordinator rules for fix entry, post-fix scope, full test and skip"
```

---

### Task 9: 검증 스킬과 계획 스킬

**Files:**
- Modify: `template/.claude/skills/team-qa/SKILL.md`, `qa-verification/SKILL.md`, `qa-verification/references/boundary-checklist.md`, `change-review/SKILL.md`, `phase-planning/SKILL.md`, `phase-planning/references/parallel-rules.md`, `phase-planning/references/workflow-patterns.md`

- [ ] **Step 1: 검증 스킬 셋을 고친다**

| 파일 | 바꾸는 것 (설계서의 절) |
| --- | --- |
| `team-qa` | 작업 흐름 표의 03 재검: 결함 ID와 수정 diff만, 새 지적은 수정 diff가 만든 것만. 판정 줄: High는 증거가 있는 것만. 배치: 끝 QA는 전체 테스트를 다시 돌리지 않는다. 테스트 시나리오를 새 규칙에 맞게 |
| `qa-verification` | 결함 표를 통일된 머리로. 심각도 절에 High의 증거 두 가지와 "옛 기대값으로 깨진 시험은 결함으로 적지 않는다". 실패 테스트는 리포트 폴더에 낸다(편집 범위 절). 재검 4번을 "수정 diff 밖에서 본 것은 인박스 후보"로. 점검표는 spec이 넘긴 경계면만, `## 점검표 후보`의 두 길 |
| `boundary-checklist.md` | 줄마다 경계면 표시(경로나 계약 ID)를 두는 형식 한 줄. 이 파일에 줄을 더하지 않는다는 안내 |
| `change-review` | 리포트에 통일된 결함 표를 둔다(지금의 `### R-1 [High]` 절은 표 아래 상세로 남긴다). 심각도와 판정에 증거 규칙과 닫힌 목록 |

- [ ] **Step 2: 계획 스킬을 고친다**

| 파일 | 바꾸는 것 (설계서의 절) |
| --- | --- |
| `phase-planning/SKILL.md` | DAG 절 끝의 병렬도 수치 옆에 `검증 워커 ÷ 구현 워커`와 0.5를 넘을 때의 이유. 그림 입력 파일 절에 `rounds`를 수정 Task가 있으면 반드시 적는다는 것, `conditional`을 붙일 Task(수정, 재검, 시험 갱신, 문서 동기화, 회고), `afterFix` |
| `parallel-rules.md` | 규칙 6번에 "끝 검증은 한 묶음이고 모두 구현과 시험 갱신 Task에만 의존한다. 재검이 아닌 검증을 수정 뒤에 걸지 않는다. 수정 사슬은 2단까지". 시험 갱신 Task 한 줄. 승인 전 점검에 같은 세 줄 |
| `workflow-patterns.md` | 검증과 수정 패턴의 설명을 위 규칙에 맞게 |

- [ ] **Step 3: 확인한다**

Run: `grep -c "| ID | 심각도 | 증거 | 위치 | 요지 |" template/.claude/skills/qa-verification/SKILL.md template/.claude/skills/change-review/SKILL.md` → 두 파일 모두 1 이상
Run: `grep -c "afterFix\|conditional\|rounds" template/.claude/skills/phase-planning/SKILL.md` → 3 이상
Run: `node scripts/template-lint.mjs 2>&1 | grep -c .` → `12`
Run: `node scripts/run-checks.mjs` → 실패 0

- [ ] **Step 4: 커밋한다**

```bash
git add template/.claude/skills/team-qa template/.claude/skills/qa-verification template/.claude/skills/change-review template/.claude/skills/phase-planning
git commit -m "docs: evidence rule, unified defect table and one-batch end verification"
```

---

### Task 10: 기획·마감의 조건과 역할 정의

**Files:**
- Modify: `template/.claude/skills/plan-orchestrate/SKILL.md`, `product-review/SKILL.md`, `requirements-write/SKILL.md`, `backlog-management/SKILL.md`, `docs-management/SKILL.md`, `docs-management/references/sync.md`, `harness-retro/SKILL.md`
- Modify: `template/.claude/agents/` 의 `product-manager.md`, `planner.md`, `doc-steward.md`, `harness-engineer.md`, `qa-inspector.md`, `code-reviewer.md`
- Modify: `template/docs/harness/team-org.md`, `template/docs/harness/model-selection.md`

- [ ] **Step 1: 기획 쪽을 고친다 (3.10)**

| 파일 | 바꾸는 것 |
| --- | --- |
| `plan-orchestrate` | 접수 경로 표와 재개 표: Planner의 요구사항 검토는 항목의 `모델 근거`에 `U ≥ 2` 또는 `R = 3`이 있을 때, PM의 계획 대조는 계획의 Task에 `R = 3`이 있을 때만 띄운다. 점수가 없으면 띄운다. 계획이 새 버전이 돼도 조건이 안 맞으면 다시 띄우지 않는다. 계획 대조가 꺼졌으면 `review` 해시를 창구가 만든다. 승인 질문에 `검증 워커 ÷ 구현 워커`와 이유, `afterFix`가 붙은 Task와 사유를 싣는다. "7단계 하네스 회고는 생략하지 않는다"를 조건부로 |
| `product-review` | 첫 문단에 "조건이 맞아 불렸을 때만 쓴다" |
| `requirements-write` | 절차 6번을 "검토가 켜졌으면"으로 |
| `backlog-management` | 항목화 리포트에 `요구사항 검토: 켬 또는 끔 · <근거 항목과 점수>` 줄. 인박스에 `게이트 후보` 라벨과 정리 주체 |

- [ ] **Step 2: 마감 쪽과 역할 정의를 고친다 (3.9, 3.10)**

| 파일 | 바꾸는 것 |
| --- | --- |
| `docs-management`, `sync.md` | `문서 동기화`를 "phase의 6단계마다"에서 "장부의 라이브 문서 확인에 행이 있을 때"로 |
| `harness-retro` | "언제" 절을 조건 셋으로. 측정 표는 코디네이터가 매번 남긴다. 점검표에 줄을 더하지 않는다. 측정 절에 새 줄과 `--map` 인자 |
| 에이전트 여섯 | `doc-steward`와 `harness-engineer`의 "필수 역할", "매 phase"를 조건부로. `product-manager`와 `planner`의 상호 검토 문장을 조건부로. `qa-inspector`와 `code-reviewer`에 증거 규칙과 수정 뒤의 범위 |
| `team-org.md`, `model-selection.md` | "직속 두 역할은 매 phase 필수"와 메모 칸의 "동기화는 phase의 6단계마다"를 조건부로 |

- [ ] **Step 3: 확인한다**

Run: `grep -rn "생략하지\|매 phase\|6단계마다\|검토시킨다\|필수 역할\|필수다" template --include=*.md | grep -v "대기 계약"` → 조건 없이 검증이나 검토를 요구하는 줄이 없다(남은 줄은 하나씩 읽어 확인한다)
Run: `for a in product-manager planner qa-inspector code-reviewer doc-steward harness-engineer; do node template/.claude/scripts/agent-definition.mjs --agent $a; done` → 모두 종료 코드 0 (`template/`에서 실행)
Run: `node scripts/template-lint.mjs 2>&1 | grep -c .` → `12`
Run: `node scripts/run-checks.mjs` → 실패 0

- [ ] **Step 4: 커밋한다**

```bash
git add template/.claude/skills template/.claude/agents template/docs/harness
git commit -m "docs: make planning reviews, doc sync and retro workers conditional"
```

---

### Task 11: setup, README, 버전, 전체 확인

**Files:**
- Modify: `skills/setup/SKILL.md`, `README.md`, `README.en.md`, `.claude-plugin/plugin.json`
- Add to the commit: `docs/superpowers/specs/2026-11-25-verification-slim-design.md`, `docs/superpowers/plans/2026-11-25-verification-slim-1a.md`

- [ ] **Step 1: setup과 README를 고친다**

- `skills/setup/SKILL.md`: 검증 명령을 확인하는 단계에서 전체 테스트 명령을 물어 `AGENTS.md`의 그 줄에 `(전체 테스트)`를 붙인다. 추천값을 보여 주되 사용자가 고르기 전에는 파일에 쓰지 않는다. 끝 안내의 "phase마다 6단계에서 반영한다"를 조건부로.
- `README.md`, `README.en.md`: 스크립트 표에 `tree-snapshot.mjs`, `defect-ledger.mjs`, `orca-launch.mjs skip` 줄. 흐름 설명의 "회고는 생략하지 않는다"와 직속 역할 설명을 조건부로. 두 파일의 내용을 맞춘다.
- `.claude-plugin/plugin.json`: `"version": "0.4.0"`.

- [ ] **Step 2: 전체를 확인한다**

Run: `node scripts/run-checks.mjs`
Expected: `checks: 25 passed, 0 failed` (기존 23에 새 검사 파일 2)

Run: `node scripts/template-lint.mjs 2>&1 | grep -c .`
Expected: `12`

Run: `grep -rn "생략하지\|매 phase\|6단계마다\|검토시킨다\|필수 역할" template skills/setup README.md README.en.md | grep -v "대기 계약"`
Expected: 조건 없이 검증이나 검토를 요구하는 줄이 없다

- [ ] **Step 3: 커밋한다**

```bash
git add skills/setup/SKILL.md README.md README.en.md .claude-plugin/plugin.json docs/superpowers/specs/2026-11-25-verification-slim-design.md docs/superpowers/plans/2026-11-25-verification-slim-1a.md
git commit -m "chore: document verification-slim 1a and bump plugin version to 0.4.0"
```

---

## 이 계획 뒤에 남는 것

- 설계서 9절 4번: 새 판을 프로젝트에 깔고 작업 1~2개를 돌린 뒤 설계서 2절의 표를 다시 채워 7절과 비교한다. 이 계획의 Task가 아니다.
- 이미 설치된 프로젝트는 setup을 다시 돌려야 새 스크립트와 양식을 받는다. 사용자가 고친 파일은 충돌로 보고된다(지금의 동작).
