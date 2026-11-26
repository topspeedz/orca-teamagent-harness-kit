# 지식 단위 에이전트 구현 계획 (키트 0.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀, 팀장, 직함별 역할을 걷어내고 지식 단위 에이전트 일곱 개와 스킬로 키트를 다시 짠다.

**Architecture:** 팀 명단(`team-org.md`)을 평면 명단(`agents.md`)으로 바꾸고, 그 명단을 읽는 스크립트 세 개를 같은 Task에서 함께 고친다. 기동 스크립트에서는 팀장 경로와 등록 없는 직접 기동을 지우고, 점수 없는 산정 행의 기동을 거부한다. 스킬 본문과 플러그인 스킬(setup, agent-author, agent-toggle)은 그 뒤에 새 이름과 새 명단에 맞춘다.

**Tech Stack:** Node 내장 모듈만 쓰는 `.mjs` 스크립트와 그 셀프테스트(`*.check.mjs`), Markdown 스킬과 역할 파일, Python Playwright(구조도 화면 검사 하나).

**Spec:** `docs/superpowers/specs/2026-11-26-knowledge-unit-agents-design.md`. 실행하는 사람은 이 계획과 설계서를 함께 읽는다.

**작업 폴더:** `D:/Projects/orca-teamagent-harness-kit-wt060`, 브랜치 `redesign/knowledge-unit-agents`. Task마다 이 브랜치에 커밋한다. 푸시, PR, 버전 올리기는 사용자 확인 뒤에 한다.

## Global Constraints

- 스크립트와 훅은 Node 내장 모듈만 쓴다. 새 의존성을 넣지 않는다.
- 고친 스크립트마다 같은 폴더의 `*.check.mjs`가 그 동작을 시험한다.
- 옛 명단(`team-org.md`)을 같이 읽는 호환 코드를 두지 않는다. 옛 명단만 있는 프로젝트에서는 안내 문구로 멈춘다.
- 프로젝트가 고쳐 쓴 파일은 승인 없이 지우거나 덮어쓰지 않는다.
- 역할 파일의 머리말은 `name`과 `description` 두 줄이다. 양식은 `template/docs/harness/templates/agent.md`다.
- 스킬 하나는 한 가지 일만 다룬다. 코드 리뷰(`change-review`)와 QA(`qa-verification`)를 한 스킬로 합치지 않는다.
- 플러그인 이름(`orca-teamagent-harness-kit`)은 바꾸지 않는다. 버전은 0.6.0이다.
- 사람이 읽는 문서와 오류 문구는 한국어로 쓴다. 코드, 식별자, 커밋 메시지는 영어로 쓴다.
- 에이전트 이름과 스킬 이름은 아래 표를 그대로 쓴다.

| 에이전트 | 맡는 단위 | 스킬(`- 로드할 스킬:` 줄과 명단에 이 순서로) |
| --- | --- | --- |
| `product-manager` | 기획 | `requirements-write`, `backlog-management`, `product-review`, `phase-planning`, `plan-orchestrate`, `docs-management` |
| `research` | 조사 | `research`, `docs-management` |
| `frontend` | 프론트엔드 | `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `docs-management` |
| `backend` | 백엔드 | `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `docs-management` |
| `verifier` | 검증 | `change-review`, `qa-verification`, `docs-management` |
| `doc-steward` | 문서 정합성 | `docs-management` |
| `harness-engineer` | 하네스 회고 | `harness-retro`, `docs-management` |

`frontend-*`와 `backend-*` 여덟 개의 이름에 접두어를 붙인 것은 사용자 스코프나 플러그인의 같은 이름 스킬(`security` 등)과 겹치지 않게 하려는 것이다.

## Review Focus

설계서가 뜻하지만 어느 Task의 시험도 저절로는 밟지 않는 입력이다. 각 줄의 시험은 그 코드를 가진 Task에 넣었다.

1. **옛 명단만 있는 프로젝트에서 스크립트를 돌린다.** 스택 트레이스가 아니라 "setup을 다시 돌려 옮기라"는 한 줄로 멈춰야 한다. (Task 1)
2. **0.5.1에서 승인받은 phase를 0.6.0으로 이어 간다.** 승인 기록의 해시가 달라진다. 다시 승인받으라는 문구로 멈춰야 한다. (Task 2)
3. **창구가 계획 없이 산정 행의 워커(`research`)를 띄운다.** 점수 파일이 있으면 뜨고, 없으면 거부돼야 한다. `--override-reason`으로도 넘어가지 못해야 한다. (Task 3)
4. **프로젝트가 고쳐 쓴 물러난 파일.** 승인 없이는 지워지지 않고 설치 기록에도 남아야 한다. (Task 4)
5. **줄끝이 CRLF인 명단과 역할 파일.** Windows에서 그대로 읽혀야 한다. (Task 1)

---

### Task 1: 평면 명단, 새 역할 파일, 새 스킬

명단 형식이 바뀌면 그것을 읽는 스크립트와 설치 직후의 역할 파일이 한꺼번에 맞아야 셀프테스트가 통과한다. 그래서 한 Task다.

**Files:**
- Create: `template/docs/harness/agents.md`
- Create: `template/.claude/scripts/roster.mjs`, `template/.claude/scripts/roster.check.mjs`
- Create: `template/.claude/agents/{research,frontend,backend,verifier}.md`
- Create: `template/.claude/skills/research/SKILL.md`
- Create: `template/.claude/skills/{frontend-ux,frontend-ui,frontend-dev,frontend-test,backend-db,backend-dev,backend-performance,backend-security}/SKILL.md`
- Modify: `template/.claude/agents/product-manager.md`(`planner.md`의 일을 받아 다시 쓴다), `doc-steward.md`, `harness-engineer.md`
- Modify: `template/.claude/scripts/agent-definition.mjs:7,104-121`, `agent-definition.check.mjs`
- Modify: `template/.claude/scripts/phase-routing.mjs:11-12,36,39-59`, `phase-routing.check.mjs`
- Modify: `skills/agent-author/scripts/registration.check.mjs:12,38,45,56,63,109-133,158`
- Modify: `skills/setup/references/document-drafts.json`(문서 담당 이름)
- Modify: `template/docs/harness/templates/agent.md`(설계서 3.10의 다섯 항목)
- Create: `template/docs/harness/templates/skill.md`
- Delete: `template/docs/harness/team-org.md`, `template/.claude/agents/{planner,code-reviewer,qa-inspector}.md`

**Interfaces:**
- Produces: `roster.mjs`의 `export function readRoster(root = '.')`. 돌려주는 값은 `[{ agent, unit, skills: string[], scope }]`이다. `docs/harness/agents.md`의 머리 줄 `| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |` 아래 행을 읽는다. 백틱을 벗기고 CRLF를 받는다.
- Produces: `readRoster`가 던지는 오류 문구 둘.
  - 명단이 없고 `docs/harness/team-org.md`만 있을 때: `docs/harness/agents.md가 없고 옛 명단(team-org.md)만 있습니다. setup을 다시 돌려 새 구조로 옮기세요.`
  - 둘 다 없거나 머리 줄이 없을 때: `명단 표 필요: docs/harness/agents.md의 에이전트|맡는 단위|스킬|편집 범위`
- Produces: `phase-routing.mjs agent --agent <이름>`이 `{"agent":"<이름>","route":"direct"}` 또는 `"wait"`를 찍는다. `wait`는 `.claude/agents/<이름>.md`가 없거나 `.agent-toggle-off`가 있을 때다.
- Produces: `phase-routing.mjs intake`의 출력에서 `reviewer`가 없어지고 `first`는 세 경로 모두 `product-manager`다.
- Produces: 역할 양식의 새 절과 그것을 검사하는 `agent-definition.mjs`의 오류 문구(설계서 3.10).

| 양식의 항목 | 검사 | 오류 문구 |
| --- | --- | --- |
| `## 따로 두는 이유`와 그 안의 `- 기준:` 줄 | 값이 `컨텍스트 분리`, `병렬`, `도구·지시 충돌` 가운데 하나 | `따로 두는 이유의 기준은 컨텍스트 분리, 병렬, 도구·지시 충돌 중 하나: <값>` |
| `## 작업 단위와 스킬` 표(머리 `작업 단위\|쓰는 스킬\|돌려주는 것`) | 작업 단위가 모델 표의 그 에이전트 행에 있다. 쓰는 스킬이 `- 로드할 스킬:` 줄에 있다 | `<이름>의 작업 단위 없음: <단위>`(지금 문구), `작업 단위 표의 스킬이 로드할 스킬에 없음: <스킬>` |
| `## 경계` | 내용이 있다 | `## 경계 내용 누락`(지금의 누락 문구와 같은 꼴) |
| 작업 원칙의 `- 런타임과 자원:` 줄, `- 서브에이전트:` 줄 | 줄이 있다. 없으면 `없음`이라고 적는다 | `런타임과 자원 줄 누락 (없으면 없음)`, `서브에이전트 줄 누락 (없으면 없음)` |
| `## 직접 협업` 표의 넷째 칸 `한도` | 칸이 있으면 행마다 비어 있지 않다. 칸이 없는 표도 받는다 | `직접 협업의 한도가 비어 있음: <상대>` |

`- 작업 단위:` 줄을 읽던 검사는 `## 작업 단위와 스킬` 표의 첫 칸을 읽게 바꾼다.

- Produces: 스킬 양식 `skill.md`. 절은 넷이다: 머리말(`name`, `description`), `## 절차`, `## 하지 않는 것`, `## 대표 사례`(`- 정상:` 한 줄과 `- 실패:` 한 줄).

- [ ] **Step 1: `roster.check.mjs`에 실패하는 시험을 쓴다**

`agent-definition.check.mjs`와 같은 방식으로 `mkdtempSync` 폴더에 픽스처를 쓰고 `readRoster(dir)`를 부른다.

```js
// 1. 정상: 두 행, 백틱과 여러 스킬
put('docs/harness/agents.md', '# 명단\n\n| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |\n| --- | --- | --- | --- |\n| `frontend` | 프론트엔드 | `frontend-ux`, `frontend-dev` | `app/` |\n| `verifier` | 검증 | `change-review` | 테스트 파일 |\n');
assert.deepEqual(readRoster(dir), [
  { agent: 'frontend', unit: '프론트엔드', skills: ['frontend-ux', 'frontend-dev'], scope: '`app/`' },
  { agent: 'verifier', unit: '검증', skills: ['change-review'], scope: '테스트 파일' },
]);
// 2. CRLF로 저장한 같은 파일도 같은 결과
// 3. agents.md 없이 team-org.md만 있으면 /setup을 다시 돌려 새 구조로 옮기세요/ 로 던진다
// 4. 둘 다 없으면 /명단 표 필요/ 로 던진다
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node template/.claude/scripts/roster.check.mjs`
Expected: `Cannot find module` 또는 `readRoster is not a function`으로 실패.

- [ ] **Step 3: `roster.mjs`에 `readRoster(root)`를 쓴다**

`scope` 칸은 백틱을 벗기지 않고 그대로 둔다(사람이 읽는 글이다). `skills` 칸만 백틱 안의 이름을 뽑는다.

- [ ] **Step 4: `agent-definition.check.mjs`의 명단 시험을 새 형식으로 바꾼다**

픽스처(`:26`)를 4칸 명단으로 바꾸고 아래 경우를 둔다. 팀과 팀장에 관한 경우(`:28`, `:57-58`)는 지운다.

```js
check(valid, null);                                             // 명단에 행 하나, 스킬 일치 → OK
check(valid, '명단 행이 하나여야 합니다', { roster: noRow });   // 행 없음
check(valid, '명단과 역할 파일의 스킬이 다름', { roster: wrongSkills });
check(valid, 'setup을 다시 돌려 새 구조로 옮기세요', { roster: null, legacy: true });
// 양식의 새 절 (valid는 새 절을 모두 가진 역할이다)
check(valid.replace('- 기준: 병렬', '- 기준: 팀이 달라서'), '따로 두는 이유의 기준은');
check(without(valid, '## 경계'), '## 경계 내용 누락');
check(valid.replace(/^- 런타임과 자원:.*$/m, ''), '런타임과 자원 줄 누락');
check(valid.replace(/^- 서브에이전트:.*$/m, ''), '서브에이전트 줄 누락');
check(unitRow(valid, '없는 단위'), '의 작업 단위 없음: 없는 단위');
check(unitSkill(valid, 'not-loaded'), '작업 단위 표의 스킬이 로드할 스킬에 없음: not-loaded');
check(peerLimit(valid, ''), '직접 협업의 한도가 비어 있음');
check(dropLimitColumn(valid), null);                            // 한도 칸이 없는 3칸 표도 통과
```

`without`, `unitRow`, `unitSkill`, `peerLimit`, `dropLimitColumn`은 픽스처 문자열을 고치는 작은 도우미다. 그 파일에 함께 쓴다.

- [ ] **Step 5: `agent-definition.mjs`를 고친다**

`:7`의 `rosterPath`와 `:104-121`의 팀 검사를 지우고 `readRoster()`로 바꾼다. 남는 검사는 둘이다. 그 이름의 행이 정확히 하나일 것(`<이름>의 명단 행이 하나여야 합니다 (현재 N)`), 그 행의 스킬 집합이 역할 파일 `- 로드할 스킬:` 줄의 스킬 집합과 같을 것(`명단과 역할 파일의 스킬이 다름: <이름>`). 모델 표 검사와 문서 책임·직접 협업 표 검사는 그대로 둔다.

- [ ] **Step 6: `phase-routing.check.mjs`를 고친다**

```js
// intake: 세 경로 모두 first가 product-manager이고 reviewer 키가 없다
assert.deepEqual(intake([]), { route: 'new', first: 'product-manager', approvals: ['묶음', '설계', '계획·실행'] });
assert.deepEqual(intake(['--delegated']), { route: 'delegated', first: 'product-manager', approvals: ['계획·실행'] });
assert.equal(intake(['--ids', 'BL-0001']).first, 'product-manager');
// agent: 켜져 있으면 direct, 꺼지거나 파일이 없으면 wait, 명단에 없으면 오류
assert.deepEqual(agent('verifier'), { agent: 'verifier', route: 'direct' });
// verifier.md.agent-toggle-off만 있을 때 → route: 'wait'
// 명단에 없는 이름 → 종료 코드 1, stderr에 '명단에서 에이전트를 찾을 수 없음: ghost'
// team 명령 → 종료 코드 1, stderr에 '사용법: phase-routing.mjs intake 또는 agent'
```

`--count`, `--complex`, 팀장 OFF/ON 경우(`:20-29`)는 지운다. 성공 줄은 `phase-routing: three intake paths, dependencies and archived IDs, agent OFF/ON passed`로 바꾼다.

- [ ] **Step 7: `phase-routing.mjs`를 고친다**

`teamRoute`(`:39-59`)를 `agentRoute`로 바꾸고 `readRoster()`를 쓴다. `intake`의 세 반환값에서 `reviewer`를 지우고 `first`를 `product-manager`로 맞춘다.

- [ ] **Step 8: 명단과 역할 파일, 스킬을 쓴다**

- `agents.md`: 위 Global Constraints의 표를 4칸 명단으로 옮긴다. 편집 범위는 지금 `team-org.md`의 값을 쓰고, `frontend`와 `backend`는 "프로젝트가 정한다", `research`는 `_workspace/research/`, `verifier`는 "테스트 파일, `_workspace/qa/`"다.
- 역할 파일 다섯 개는 설계서 3.1~3.3과 3.8을 옮긴다. `verifier`는 지금의 `code-reviewer.md`와 `qa-inspector.md`의 원칙을 두 스킬별 문단으로 나눠 담는다. `product-manager`는 `planner.md`의 요구사항 검토, 설계, 계획 절을 받는다.
- 일곱 역할 모두 `- 로드할 스킬:` 줄 끝에 `docs-management`를 넣고, `## 문서 책임` 표를 설계서 3.8의 배정으로 채운다. 표의 문서 경로는 설치 직후 실제로 있는 파일이어야 한다. 없는 문서는 넣지 않는다.
- `doc-steward.md`와 `harness-engineer.md`의 직접 협업 표에서 `qa-inspector`, `code-reviewer`, `planner`를 `verifier`, `product-manager`로 바꾼다.
- 양식 `agent.md`에 설계서 3.10의 다섯 항목을 더하고 "명단에서의 소속"이라는 안내를 "맡는 단위"로 고친다. 절의 순서는 핵심 역할, 따로 두는 이유, 작업 원칙, 작업 단위와 스킬, 경계, 전문 판단, 입력과 출력, 문서 책임, 직접 협업, 완료 기준, 다시 호출될 때, 오류 처리다.
- 양식 `skill.md`를 새로 쓴다. 머리말의 `description`에는 무엇을 하는 절차인지, 언제 읽는지, 쓰지 않는 경우와 그때 읽을 스킬을 적게 한다. 안내에 "스킬은 한 가지 일만 다룬다. 길어지면 `references/`로 나눈다"를 넣는다.
- 일곱 역할 파일은 새 양식의 절을 모두 갖는다. `따로 두는 이유`의 기준은 설계서 3.1의 "따로 두는 이유" 칸에서 가져온다(`research`는 병렬, `verifier`와 `product-manager`는 컨텍스트 분리, `frontend`와 `backend`는 컨텍스트 분리). `직접 협업` 표는 `한도` 칸을 갖고, `frontend`와 `backend`는 서로를 상대로 둔다(협의 주제: 인터페이스와 계약).
- `research/SKILL.md`: 설계서 3.3의 네 가지(질문을 나누는 법, 서브에이전트 지시의 네 항목, 미확인 표기, 리포트 양식). 스킬 양식의 네 절을 따른다.
- 틀 스킬 여덟 개: 스킬 양식의 네 절을 제목만 두고, 머리말과 정확히 이 한 줄을 둔다. Task 4의 setup이 이 줄로 "아직 채우지 않은 스킬"을 찾는다.

```markdown
> 이 스킬은 틀이다. `agent-author`가 프로젝트에 맞게 채운다.
```

- [ ] **Step 9: `registration.check.mjs`와 `document-drafts.json`을 새 이름으로 고친다**

고정된 역할 목록(`:63`)을 일곱 개로 바꾸고, `team-org`, `team-qa`, `qa-inspector.md`를 고치는 시나리오(`:109-133`)를 `agents.md`와 `verifier.md`로 바꾼다. `document-drafts.json`의 담당 이름은 설계서 3.8의 표로 바꾼다.

- [ ] **Step 10: 돌려서 통과를 확인한다**

Run: `node template/.claude/scripts/roster.check.mjs && node template/.claude/scripts/agent-definition.check.mjs && node template/.claude/scripts/phase-routing.check.mjs && node skills/agent-author/scripts/registration.check.mjs`
Expected: 네 파일 모두 종료 코드 0. `registration.check`는 일곱 역할이 `agent-definition: OK`다.

- [ ] **Step 11: 커밋한다**

```bash
git add template/docs/harness template/.claude/agents template/.claude/skills template/.claude/scripts skills/agent-author/scripts skills/setup/references/document-drafts.json
git commit -m "feat: flat agent roster and the seven knowledge-unit agents"
```

---

### Task 2: 기동 스크립트에서 팀장 경로와 직접 기동을 지운다

**Files:**
- Modify: `template/.claude/scripts/orca-launch.mjs`, `orca-launch.check.mjs`
- Modify: `template/.claude/scripts/orca-launch-approval.mjs:14,67,73-77,126`
- Modify: `template/.claude/scripts/dag-routing-choices.mjs:15-17,25-27`, `dag-routing-choices.check.mjs:13-31`

**Interfaces:**
- Consumes: Task 1의 `readRoster()`(옮기지 않은 프로젝트를 막는 데만 쓴다).
- Produces: `orca-launch.mjs`의 옵션에서 `--lead`와 `--parent`가 없어진다. 워커는 `worker --map <map> --id <Task>`(등록한 Task)와 `worker --agent --unit --spec-file`(Run 밖의 임시 기동) 두 길로만 뜬다.
- Produces: `verifyAssignment({ spec, agent, unit, row, overrideReason })`. `lead` 인자가 없다.
- Produces: 승인 기록의 Task 행에 `members`가 없다.

지울 곳은 조사에서 줄까지 확인했다.

| 파일 | 지울 것 |
| --- | --- |
| `orca-launch.mjs` | 주석 `:6-7,14`, 옵션 `'parent'` `:123`과 `'lead'` `:125`, `verifyAssignment`의 `:71-75`, `checkedSpec`의 `lead`와 `:327`, 승인 루프의 `members` 순회 `:260-267`, `launchRefusal`의 `ids`와 `m.direct` 읽기 `:349-353,375`, `prepareAttempt`의 `parent` `:412`, `registerTask`의 `lead`와 `members` `:490-515`, `register`의 `:527`, `reapprove`의 `리드` 판정과 `direct` 처리 `:552-553,566,577,585-587`, `skip`의 `:768,798-800`, `actual`의 `m.direct` `:856`, 임시 기동의 `o.lead` `:863-866`, 직접 기동 분기 전체 `:870-913,937,953-962` |
| `orca-launch-approval.mjs` | `members`를 읽고 쓰는 줄 전부와 `팀 내부 배정은 팀장 Task에서만 가능함`, `팀 내부 배정 중복` |
| `dag-routing-choices.mjs` | 팀원 키(`node~role~unit`)와 `parent` |

- [ ] **Step 1: 실패하는 시험을 쓴다**

`orca-launch.check.mjs`에 아래를 더한다. 도우미(`t`, `ta`, `fake`, `fakeDag`, `reg`, `go`, `approve`, `node`)는 그 파일의 것을 쓴다.

```js
// --lead와 --parent는 알 수 없는 옵션으로 거부된다
// DAG 노드에 members가 있으면 승인 검토가 거부한다: /팀 내부 배정\(members\)은 없어졌습니다/
// 실행 Run에서 --map 없이 worker --approval --id로 띄우면 거부한다: /register한 Task를 worker --map --id로 띄운다/
// 옛 대응표(map.direct가 있는 파일)로 worker나 register를 부르면 거부한다:
//   /옛 직접 기동 기록이 있는 Run입니다. 새 Run에서 계획을 다시 승인하세요/
// 승인 기록의 Task 행에 members 키가 없다
// (Review Focus 2) 0.5.1이 만든 승인 파일(행에 members: []가 있는 것)로 coordinator를 띄우면
//   기존 문구 '현재 계획·DAG와 실행 승인 버전이 다름'으로 멈춘다
// agents.md 없이 team-org.md만 있는 폴더에서 worker나 register를 부르면
//   /setup을 다시 돌려 새 구조로 옮기세요/ 로 멈춘다
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 새 경우에서 실패.

- [ ] **Step 3: 위 표대로 지우고, 문구 둘을 바꾼다**

- `:915`의 `실행 Run의 직접 기동은 --approval과 --id가 필요함`을 `실행 Run에서는 register한 Task를 worker --map --id로 띄운다`로 바꾼다.
- `launchRefusal`, `taskId`, `statuses`는 `m.tasks`만 읽게 한다.
- 대응표를 읽는 자리에 `m.direct`나 `m.previousDirect`가 있으면 위 문구로 거부하는 검사를 하나 둔다.
- `worker`와 `register`의 첫머리에서 `readRoster()`를 불러 옮기지 않은 프로젝트를 막는다.

- [ ] **Step 4: 팀장 경로를 시험하던 경우를 지운다**

`orca-launch.check.mjs`: `:19`의 `lead: false`, `:97`의 `(*, 리드)` 행, `:103`의 `lead.md`, 경우 7(`:63-69`), 경우 12(`:167-175`), `:551-587`, `:617`의 `members` 항목 하나, `:632-650`, `:1048-1081`, `:1166`의 `members: []`, `:1519-1540`, 경우 76~80(`:1595-1650`), 경우 81의 직접 기동 절반(`:1663-1666`), 경우 85~86(`:1699-1717`). `dag-routing-choices.check.mjs`: `:13-18`, `:22-27`, `:31`. 그 파일의 성공 줄에서 `task/member`를 `task`로 바꾼다.

위 줄 번호는 낱말 검색으로 찾은 것이다. `orca-launch.check.mjs`의 `:420-540`과 `:660-940`은 경우 하나하나를 읽지 않았다. 지운 뒤 그 구간에 `lead`, `parent`, `members`, `direct`, `리드`를 쓰는 도우미나 픽스처가 남았는지 읽어서 확인한다.

수정 루프를 시험하는 경우는 지우지 않는다. 결함 ID가 없는 수정 Task의 거부, `skip`, `수정 diff:`, 라운드 상한이 그것이다(설계서 3.9). 이 경우들의 픽스처에서 역할 이름만 `frontend`와 `verifier`로 바꾼다.

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `node template/.claude/scripts/orca-launch.check.mjs && node template/.claude/scripts/dag-routing-choices.check.mjs`
Expected: `orca-launch.check: N passed`(N은 지운 만큼 115보다 작다), `dag-routing-choices: task assignments, manual locks, runtime and revision validation passed`.

- [ ] **Step 6: 커밋한다**

```bash
git add template/.claude/scripts/orca-launch.mjs template/.claude/scripts/orca-launch.check.mjs template/.claude/scripts/orca-launch-approval.mjs template/.claude/scripts/dag-routing-choices.mjs template/.claude/scripts/dag-routing-choices.check.mjs
git commit -m "refactor: drop lead, member and direct launch paths from orca-launch"
```

---

### Task 3: 산정 행은 점수로만 띄운다. 모델 표를 에이전트 행으로 다시 쓴다

**Files:**
- Modify: `template/.claude/scripts/model-selection.mjs`(+ `.check.mjs:31,58`), `model-routing.mjs:176`(+ `.check.mjs:95,103`)
- Modify: `template/.claude/scripts/orca-launch.mjs:268-279,613-623,916`, `orca-launch.check.mjs`
- Modify: `template/docs/harness/model-selection.md:64-84`

**Interfaces:**
- Produces: `model-selection.mjs`의 `export const isFixed = (row) => row.note.startsWith('고정')`. 지금 세 군데(`orca-launch.mjs:270,279`, `model-routing.mjs:176`)에 흩어진 같은 판정을 이것으로 바꾼다.
- Produces: 임시 기동 `worker --agent --unit --spec-file`이 `--assessment <JSON>`을 받는다. 파일의 모양은 등록한 Task의 `--assessment`와 같다(`{ "input": { "C":n, "U":n, "R":n, "V":n, "F":n }, "reason": "..." }`).

새 모델 표의 행이다. 고정은 사용자가 정한 것뿐이고 나머지는 산정 행이다.

```markdown
| `coordinator` | 실행 감독 | claude | opus | high | 고정(사용자 결정 2026-11-22). 100만 토큰 창 전제 |
| `product-manager` | 기획 | claude | fable | xhigh | 고정(setup에서 사용자가 정한다). 요구에서 계획까지 한 세션 |
| `product-manager` | 완료 처리 | claude | 복잡도 | | 백로그 완료·보관 |
| `research` | 조사 | claude | 복잡도 | | |
| `frontend` | 구현, 결함 수정, 시험 갱신 | claude | 복잡도 | | |
| `backend` | 구현, 결함 수정, 시험 갱신 | claude | 복잡도 | | |
| `verifier` | 중간 변경 리뷰 | claude | 복잡도 | | 코드를 읽는 검토만 |
| `verifier` | 끝 검증 | claude | 복잡도 | | 읽기와 실행. 영역마다 Task 하나 |
| `verifier` | 재검 | claude | 복잡도 | | 재현 테스트가 없는 결함의 재현 확인만 |
| `verifier` | 보안·돈이 걸린 변경 리뷰 | claude | fable | xhigh | 고정(사용자 결정 2026-11-22) |
| `harness-engineer` | 회고, 구조 변경 | claude | 복잡도 | | |
| `doc-steward` | 문서 초기화, 문서 동기화, 문서 감사 | claude | 복잡도 | | 동기화는 장부의 `## 라이브 문서 확인`에 행이 있을 때만 |
| `*` | 기본 | claude | 복잡도 | | 표에 없는 조합 |
```

`일반 변경 리뷰`와 `흐름 검증`은 `끝 검증` 하나가 된다(설계서 3.2). `* / 리드` 행은 없앤다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`orca-launch.check.mjs`에 더한다.

```js
// 승인 검토: 고정이 아닌 행의 Task에 routing(점수)이 없으면 routingVersion과 상관없이 거부한다
//   /산정 행은 점수가 필요함: T01 \(frontend, 구현\)/
// worker --map: 승인 기록에 그 Task의 routing이 없고 행이 고정이 아니면 거부한다 (같은 문구)
// (Review Focus 3) 임시 기동, 산정 행:
//   --assessment 없음 → /산정 행은 점수가 필요함 — --assessment <JSON>을 지정한다/
//   --assessment 있음 → 그 점수로 계산한 model·effort로 뜬다 (C=1,U=1,R=1,V=1,F=0 → sonnet/medium)
//   --override-reason만 있고 --assessment가 없음 → 여전히 거부
// 임시 기동, 고정 행(product-manager 기획) → 표의 값으로 뜬다
```

`sonnet/medium`은 표의 산정식에서 나온다. 모델은 넷째 조건(나머지)이라 Sonnet이고, `E = 2·1 + 1 + 0 = 3`이라 medium이다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node template/.claude/scripts/orca-launch.check.mjs`
Expected: 새 경우에서 실패.

- [ ] **Step 3: `isFixed`를 내보내고 세 군데를 그것으로 바꾼다. 거부 검사를 넣는다**

- 승인 루프(`:268-279`): `!isFixed(row) && !a.routing`이면 던진다.
- `worker --map`(`:613-623`): `approved?.routing`이 없고 `!isFixed(row)`면 거부한다.
- 임시 기동(`:916` 부근): 산정 행이면 `--assessment`를 읽어 `assessRouting(input, row.runtime, codexMap, classify)`로 계산한다. 이미 있는 함수다. `--complexity`만으로는 띄우지 않는다.

- [ ] **Step 4: 모델 표와 그 표를 쓰는 시험 픽스처를 고친다**

`model-selection.md`의 배정 표를 위 표로 바꾸고, `## 계획과 기동 직전의 배정`의 첫 문단에서 "PM은… Planner는…"을 "PM이 수락 기준을 쓸 때 C·U·R·V의 값과 근거를 남기고, 계획에서 Task마다 좁힌다"로 고친다. `model-selection.check.mjs:31,58`과 `model-routing.check.mjs:95,103`이 예로 쓰던 `(*, 리드)` 행을 `(*, 기본)`으로 바꾼다.

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `node template/.claude/scripts/orca-launch.check.mjs && node template/.claude/scripts/model-selection.check.mjs && node template/.claude/scripts/model-routing.check.mjs && (cd template && node .claude/scripts/model-selection.mjs check)`
Expected: 셋 모두 통과, 마지막 줄은 `model-selection: OK 13 rows`.

- [ ] **Step 6: 커밋한다**

```bash
git add template/.claude/scripts template/docs/harness/model-selection.md
git commit -m "feat: formula rows launch only with scores; model table by agent"
```

---

### Task 4: setup이 물러난 파일을 치우고 PM의 모델을 묻는다

**Files:**
- Modify: `skills/setup/scripts/setup.mjs:28,84-91,156-239,320-345`, `setup.check.mjs`
- Modify: `skills/setup/scripts/session-digest.mjs:83`

**Interfaces:**
- Produces: answers JSON의 `planner.effort`가 `pm: { model, effort }`로 바뀐다. 허용 값은 `PM_MODELS = ['sonnet', 'opus', 'fable']`, `PM_EFFORTS = ['medium', 'high', 'xhigh', 'max']`이고 기본값은 `{ model: 'fable', effort: 'xhigh' }`다.
- Produces: `setPmRow(text, pm)`. 모델 표에서 ``| `product-manager` | 기획 |`` 행의 model 칸과 effort 칸을 바꾼다. `setPlannerRow`를 대신한다.
- Produces: `planInstall`의 결과에 `retire: [{ path, state }]`가 더해진다. `state`는 `'unchanged'`(설치 기록의 해시와 같음), `'modified'`(다름), `'untracked'`(기록에 없음) 가운데 하나다.
- Produces: `inspect`의 결과에 `migration`(옛 명단이 있고 새 명단이 없을 때 `{ roster: 'docs/harness/team-org.md', projectRoles: [...] }`, 아니면 `null`)과 `unfilledSkills`(Task 1의 틀 줄이 남은 스킬 이름들)가 더해진다.

물러난 파일의 목록이다. `setup.mjs`에 상수 `RETIRED`로 둔다. 설치 기록에는 병합하거나 생성한 파일도 들어 있어서 "기록에는 있는데 틀에는 없는 것"으로 찾으면 그 파일들까지 지운다. 그래서 목록을 명시한다.

```js
const RETIRED = [
  '.claude/skills/team-lead/SKILL.md', '.claude/skills/team-qa/SKILL.md',
  '.agents/skills/team-lead/SKILL.md', 'docs/harness/templates/team-skill.md',
  '.claude/agents/planner.md', '.claude/agents/code-reviewer.md', '.claude/agents/qa-inspector.md',
  '.codex/agents/planner.toml', '.codex/agents/code-reviewer.toml', '.codex/agents/qa-inspector.toml',
];
```

`docs/harness/team-org.md`는 이 목록에 넣지 않는다. `agent-author`가 프로젝트의 역할을 옮기는 데 읽어야 하므로 그 절차의 끝에서 지운다(Task 7).

- [ ] **Step 1: 실패하는 시험을 쓴다**

`setup.check.mjs`에 더한다. 도우미 `put`, `read`, `target`, `install`, `test`를 쓴다.

```js
test('retired file with the recorded hash is deleted and leaves the record', () => {
  // 0.5.1처럼 team-lead SKILL.md를 깔고 기록에 그 해시를 둔 뒤 install
  // → 파일 없음, harness-install.json의 files에 그 경로 없음, 결과의 retired에 경로 있음
});
test('(Review Focus 4) a retired file the project edited stays until approved', () => {
  // planner.md를 고친 뒤 install → 파일 그대로, conflicts에 '.claude/agents/planner.md', 종료 코드 2
  // 같은 install을 --approve .claude/agents/planner.md 로 다시 → 파일 없음
});
test('pm.model and pm.effort land in the PM 기획 row', () => {
  // answers.pm = { model: 'opus', effort: 'high' } → model-selection.md에
  // '| `product-manager` | 기획 | claude | opus | high |' 로 시작하는 줄이 있다
});
test('answers with planner.effort are refused', () => {
  // /planner.effort는 pm.model과 pm.effort로 바뀌었다/
});
test('a default agent the project removed is not installed again', () => {
  // 한 번 설치한 뒤 .claude/agents/backend.md를 지우고 다시 install
  // → 파일이 다시 생기지 않는다, skipped에 { to: '.claude/agents/backend.md', reason: '사용자가 지움' }
});
test('inspect reports a pending migration and unfilled skills', () => {
  // team-org.md만 있는 대상 → migration.roster === 'docs/harness/team-org.md',
  //   migration.projectRoles에 틀에 없는 역할 이름
  // 틀 줄이 남은 frontend-ux → unfilledSkills에 'frontend-ux'
});
```

역할과 명단에 묶인 기존 경우(`:169` 옛 설치본 재설치, `:237` planner 토글, `:311-339` PM·Planner 행, `:361` planner.toml)는 새 이름으로 고친다. `:182`와 `:191-192`의 `team-org.md` 픽스처는 위 "이전" 시험의 재료로 쓴다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node skills/setup/scripts/setup.check.mjs`
Expected: 새 경우에서 실패.

- [ ] **Step 3: `setup.mjs`를 고친다**

- `planInstall`: 파일 순회가 끝난 뒤 `RETIRED`를 돌며 대상에 있는 것만 `plan.retire`에 넣고 `state`를 정한다.
- `planInstall`: 설치 기록에 있는데 대상에 없는 파일은 다시 깔지 않고 `'사용자가 지움'`으로 건너뛴다. setup 7단계에서 이름을 바꾸거나 뺀 기본 에이전트가 되살아나지 않게 하는 규칙이다(설계서 4.4). 기록은 그대로 둔다.
- `applyInstall`: `unchanged`는 지운다. `modified`와 `untracked`는 `opts.approve`에 있을 때만 지우고, 아니면 `conflicts`에 넣는다. 지운 경로는 설치 기록에서 뺀다. 결과에 `retired` 배열을 더한다.
- `PLANNER_EFFORTS`(`:28`)와 `setPlannerRow`(`:84-91`)를 위 인터페이스로 바꾼다. 검증(`:329`)도 같이 바꾼다.
- `inspect`에 `migration`과 `unfilledSkills`를 더한다.
- `session-digest.mjs:83`이 `docs/harness/agents.md`를 넣게 한다. 옛 명단은 `migration`이 있을 때만 함께 넣는다.

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `node skills/setup/scripts/setup.check.mjs && node skills/setup/scripts/session-digest.check.mjs`
Expected: `setup.check: N passed`(17에 새 경우 여섯을 더한 수), 종료 코드 0.

- [ ] **Step 5: 커밋한다**

```bash
git add skills/setup/scripts
git commit -m "feat: setup retires old files, asks the PM model, reports a pending migration"
```

---

### Task 5: 작은 스크립트 셋

**Files:**
- Modify: `template/.claude/scripts/phase-resume.mjs:6-12,32-33`, `phase-resume.check.mjs`
- Modify: `template/.claude/hooks/worker-intake-context.mjs:9,31-36`, 그 `.check.mjs`
- Modify: `template/.claude/skills/harness-retro/scripts/retro-measure.mjs:181-208`, `retro-measure.check.mjs`

**Interfaces:**
- Produces: `phase-resume.mjs`의 리포트 이름 표에 PM 한 세션의 이름을 더한다. `03_product-manager_design` → `design`, `04_product-manager_plan` → `plan`. 옛 이름(`03_planner_design`, `04_planner_plan`, `03_planner_review`, `06_product-manager_plan-check`)은 그대로 읽는다. 진행 중이던 phase의 리포트를 버리지 않기 위해서다.
- Produces: `retro-measure.mjs`의 `지표|값` 표에 두 줄. `워커 기동 수`(대응표 `tasks`에서 `dispatch`가 있는 항목 수에 `previous[]`의 길이를 더한 값), `항목당 워커 수`(그 값을 대응표 행의 서로 다른 `bl` 수로 나눈 값, 소수 한 자리). `bl`이 하나도 없으면 `측정 불가`다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
// phase-resume.check: 04_product-manager_plan_v1.md가 reports.plan에, 03_planner_design_v1.md가 reports.design에 들어온다
// worker-intake-context.check: 출력에 '팀장'이 없다. 출력에 '일을 나눠 맡기는 팬아웃은 research만 한다'가 있다
// retro-measure.check: 대응표에 dispatch가 있는 Task 3개(하나는 previous 1개), bl 두 가지
//   → '워커 기동 수' 4, '항목당 워커 수' 2.0
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node template/.claude/scripts/phase-resume.check.mjs; node template/.claude/hooks/worker-intake-context.check.mjs; node template/.claude/skills/harness-retro/scripts/retro-measure.check.mjs`
Expected: 셋 모두 새 경우에서 실패.

- [ ] **Step 3: 고친다**

훅의 규칙 ⑥에서 팀장을 말하는 두 곳과 `:9` 주석의 "부모(팀장)"을 지운다. 규칙 ③ 뒤에 한 줄을 더한다: `일을 나눠 맡기는 팬아웃은 research만 한다. 다른 에이전트는 ③의 읽기만 서브에이전트에 맡긴다.`

- [ ] **Step 4: 돌려서 통과를 확인하고 커밋한다**

Run: Step 2와 같은 명령.
Expected: 셋 모두 종료 코드 0.

```bash
git add template/.claude/scripts/phase-resume.mjs template/.claude/scripts/phase-resume.check.mjs template/.claude/hooks template/.claude/skills/harness-retro/scripts
git commit -m "feat: resume by PM report names, research-only fan-out rule, worker counts in retro"
```

---

### Task 6: 스킬 본문과 양식을 새 구조로 고친다

글을 고치는 Task다. 시험은 금지어 검색과 역할 검사기다.

**Files:**
- Delete: `template/.claude/skills/team-lead/`, `template/.claude/skills/team-qa/`, `template/docs/harness/templates/team-skill.md`, `template-codex/.agents/skills/team-lead/`
- Modify: `template/.claude/skills/coordinator/SKILL.md`와 `references/{front-desk,recovery,settle}.md`
- Modify: `template/.claude/skills/plan-orchestrate/SKILL.md`, `phase-planning/SKILL.md`와 `references/{workflow-patterns,parallel-rules}.md`
- Modify: `template/.claude/skills/{product-review,docs-management,backlog-management,requirements-write,harness-retro,change-review,qa-verification}/SKILL.md`
- Modify: `template/docs/harness/templates/{spec,agent}.md`, `template/AGENTS.md:26,34,43,47`
- Create: `template-codex/.agents/skills/research/SKILL.md`와 `frontend-*`, `backend-*` 여덟 개의 포인터 래퍼(기존 래퍼와 같은 모양)

**무엇을 어떻게 바꾸나**

| 파일 | 바꾸는 내용 |
| --- | --- |
| `coordinator` | 팀 배정 절을 에이전트 배정으로(`phase-routing.mjs agent --agent`). "백로그 항목 하나는 만드는 에이전트 하나가 끝까지"와 설계서 3.4의 기준 셋을 적는다. 끝 검증을 "영역마다 `verifier` Task 하나, 작업 단위 `끝 검증`"으로. `--lead`, `--complex`, 팀장 문단을 지운다. 수정 루프의 다섯 규칙과 최종 테스트 절은 한 글자도 줄이지 않는다(설계서 3.9) |
| 병렬 규칙 | **그대로 둔다.** `coordinator`의 `## 워커 기동`(의존·편집 범위·자원과 함께 등록, `launchable --slots`로 띄우기, 깰 때마다 `launchable`, 대기 중인 Task 당기기, 준비된 Task를 남긴 채 대기하지 않기, 폭은 계획과 `launchable`이 정한다), `phase-planning/references/parallel-rules.md`의 규칙 아홉 줄과 승인 전 점검, 계획서 `## DAG`의 임계 경로와 병렬도 수치, `harness-retro`의 병렬 지표다. 팀을 말하는 곳만 고친다. "한 팀의 동시 워커는 4명 이하"(`parallel-rules.md:14`, `coordinator/SKILL.md:90`, `phase-planning/SKILL.md:17`, `harness-retro/SKILL.md:76`)는 "같은 에이전트의 동시 워커는 4명 이하"로 바꾼다. `parallel-rules.md:23`의 팀장 문장은 지우고, `:25`의 "코디네이터나 팀장이"는 "코디네이터가"로 바꾼다 |
| `team-qa`를 지우기 전에 | 그 스킬에만 있는 줄을 `coordinator`의 검증 절로 옮긴다. 옮길 후보: 횡단 검증이 보는 항목, 공개 API 변경의 예외 응답 재현, 직접 소통 짝의 한도, 오류 처리 표의 "실행 환경이 뜨지 않으면 ❌와 failed" |
| `plan-orchestrate` | PM과 Planner의 두 세션과 교차 검토 단계를 PM 한 세션으로. 설계 전에 창구가 `research`를 띄우는 자리를 적는다(점수 파일과 함께, Task 3) |
| `phase-planning` | "Task는 직함별 단계가 아니라 일 단위로 나눈다. 한 항목의 설계, 구현, 테스트 코드는 한 Task다"를 넣는다. `workflow-patterns.md`의 계층 행을 지운다 |
| `product-review` | "검토자는 작성자와 달라야 한다"와 Planner·PM의 교차 검토 조건을 지우고, PM이 자기 요구와 계획을 원문과 대조하는 절차로 다시 쓴다 |
| `docs-management` | 문서별 담당 표를 설계서 3.8로. "모든 에이전트가 자기 문서를 쓸 때 읽는다"와 "만든 에이전트가 같은 Task에서 자기 문서를 고친다"를 적는다 |
| 나머지 다섯 스킬 | 소유 역할 이름만(`planner` → `product-manager`, `code-reviewer`와 `qa-inspector` → `verifier`) |
| `spec.md` | 첫 줄 설명에서 `· 리드`를 지우고, 팀장 spec에 관한 줄을 지운다. 검증 Task의 spec에 "쓰는 스킬: `change-review` / `qa-verification`" 줄을 더한다 |
| `template/AGENTS.md` | 역할 계층 절을 설계서 3절의 그림으로, 명단 경로를 `docs/harness/agents.md`로 |

- [ ] **Step 1: 금지어 검색이 지금은 걸리는 것을 확인한다**

Run: `grep -rnE "팀장|· 리드|team-lead|--lead|--complex|팀 스킬|team-qa|team-org|\`planner\`|code-reviewer|qa-inspector" template template-codex | grep -v "\.check\.mjs" | wc -l`
Expected: 0보다 큰 수.

- [ ] **Step 2: 위 표대로 고친다**

- [ ] **Step 3: 검색과 검사기를 돌린다**

Run: 위 검색 명령.
Expected: `0`. 남는 줄이 `phase-resume.mjs`의 옛 리포트 이름(Task 5에서 일부러 남긴 것)뿐이면 그 파일을 검색에서 빼고 0을 확인한다.

Run: `node skills/agent-author/scripts/registration.check.mjs`
Expected: 종료 코드 0. 일곱 역할이 가리키는 스킬이 모두 있다.

Run: `grep -cE "launchable|--slots|--edits|--resource" template/.claude/skills/coordinator/SKILL.md && grep -c "" template/.claude/skills/phase-planning/references/parallel-rules.md`
Expected: 첫 수는 고치기 전(`git show HEAD:template/.claude/skills/coordinator/SKILL.md | grep -cE "launchable|--slots|--edits|--resource"`)과 같다. 병렬 규칙의 줄이 줄지 않았다는 확인이다. 둘째 수는 고치기 전보다 한 줄만 적다(팀장 문장 하나).

- [ ] **Step 4: 커밋한다**

```bash
git add template template-codex
git commit -m "docs: skills and templates follow knowledge-unit agents; team-lead and team-qa removed"
```

---

### Task 7: agent-author와 setup 절차

**Files:**
- Modify: `skills/agent-author/SKILL.md`, `references/{AGENT_AUTHORING_MASTER,agent-definition-template,quality-checklist}.md`
- Modify: `skills/agent-author/scripts/document-choice.mjs`(담당 이름을 읽는 곳이 있으면)
- Rename: `skills/setup/references/team-composition.md` → `agent-units.md`
- Modify: `skills/setup/SKILL.md:3,151-156,171,176`과 2단계의 질문

**무엇을 어떻게 바꾸나**

- `agent-author/SKILL.md`의 "하네스에 독립 역할·기존 팀원·팀 전체 추가" 절을 설계서 3.7의 세 가지 일로 다시 쓴다. 순서는 스킬 더하기, 스킬 본문 채우기, 에이전트 만들기다. 네 번째 절로 "0.5.1 프로젝트 옮기기"를 더한다.
- "스킬 본문 채우기"의 절차: `setup.mjs inspect`의 `unfilledSkills`를 받는다 → 그 스킬이 속한 에이전트의 편집 범위와 프로젝트의 기술을 읽는다 → 본문을 쓰고 틀 줄을 지운다 → `agent-definition.mjs --agent <이름>`을 돌린다.
- "옮기기"의 절차(설계서 4.4의 3번): `inspect`의 `migration.projectRoles`를 받는다 → 역할마다 설계서 3.4의 기준으로 "어느 단위에 합친다" 또는 "따로 남긴다"를 표로 추천한다 → 사용자가 고른다 → 역할 파일의 지식을 그 단위의 스킬로 옮기고, 명단과 모델 표와 문서 책임을 고친다 → 옛 역할 파일, 옛 팀 스킬, `docs/harness/team-org.md`를 지운다 → 프로젝트 문서에 남은 옛 역할 이름을 `grep`으로 찾아 목록으로 보여 준다.
- `agent-units.md`: 팀장과 팀 스킬을 요구하던 줄(`:28,34,90,91`)을 지우고 설계서 3.4의 기준 셋을 추천의 근거로 둔다. 설계서 3.10의 "사라지는 것 → 새 자리" 표를 옮겨 적는다. 옛 팀 스킬을 옮길 때 이 표를 보고 내용을 나눈다.
- `agent-definition-template.md`의 작성 질문에 새 절의 질문을 더한다.
  - 따로 두는 이유: 이 에이전트를 다른 에이전트의 스킬로 합치면 무엇이 나빠지는가? 세 기준 가운데 무엇이고, 이 프로젝트의 어떤 사실이 근거인가? 그 사실이 사라지면 어디로 합치는가?
  - 작업 단위와 스킬: 작업 단위마다 어느 스킬을 읽고, 받는 쪽이 다시 묻지 않아도 되려면 무엇을 돌려줘야 하는가?
  - 경계: 이웃 에이전트와 판단이 갈리는 요청은 무엇이고, 그때 누구에게 넘기는가?
  - 직접 협업의 한도: 협의가 몇 번을 넘으면 배정자에게 올리는가?
  - 런타임과 자원: 혼자 써야 하는 자원이나 다른 런타임이 필요한가?
- "스킬 더하기"와 "스킬 본문 채우기"는 양식 `docs/harness/templates/skill.md`를 쓴다. 대표 사례(정상 하나, 실패 하나)는 그 프로젝트의 실제 작업에서 가져온다. `quality-checklist.md`의 "대표 성공·실패 사례를 따라간다"는 점검은 에이전트가 아니라 스킬의 대표 사례를 따라가게 고친다.
- `AGENT_AUTHORING_MASTER.md`와 `agent-definition-template.md`의 "옵션 필드 선택 가이드"에 한 줄을 더한다: 하네스에 설치하는 역할은 머리말에 `tools`, `model`, `skills`를 쓰지 않는다. 같은 파일에서 Codex 정의를 만들고, 모델과 effort는 모델 표가 정한다.
- `setup/SKILL.md`: 머리말의 "운영팀·QA팀과 직속 독립 역할, … 팀 스킬"을 "지식 단위 에이전트 일곱 개"로. 2단계의 Planner effort 질문을 "PM의 model과 effort"로(기본 fable/xhigh). 7단계를 "에이전트 단위 구성"으로 바꾸고 `agent-author`의 두 절차(스킬 본문 채우기, 옮기기)를 부르게 한다. 9단계의 "워커의 깊이: 세 단" 줄을 "두 단(코디네이터, 에이전트)"으로 고친다.

- [ ] **Step 1: 금지어 검색이 지금은 걸리는 것을 확인한다**

Run: `grep -rnE "팀장|team-lead|팀 스킬|team-qa|team-skill|team-composition|세 단|\`planner\`|code-reviewer|qa-inspector" skills/agent-author skills/setup --include=*.md | wc -l`
Expected: 0보다 큰 수.

- [ ] **Step 2: 위대로 고친다**

- [ ] **Step 3: 검색과 시험을 돌린다**

Run: 위 검색 명령.
Expected: `0`. `team-org`는 "옮기기" 절차에만 남는다.

Run: `node skills/agent-author/scripts/registration.check.mjs && node skills/setup/scripts/setup.check.mjs`
Expected: 둘 다 종료 코드 0.

- [ ] **Step 4: 커밋한다**

```bash
git add skills/agent-author skills/setup
git commit -m "docs: agent-author adds skills first, fills skill bodies and migrates old roles"
```

---

### Task 8: 그림 도구 둘

**Files:**
- Modify: `template/.claude/skills/waterfall-timeline/scripts/from-orca.mjs:12-13,20,78,91,95-102,109,126,137`, `check.mjs:39-79`
- Modify: `template/.claude/skills/dag-swimlane/scripts/render.mjs:445,466,469-473,515-527`, `node-details.js:8`
- Modify: `template/.claude/skills/dag-swimlane/examples/{reference,choices}.json`, `assets/reference.html`
- Modify: 두 스킬의 `SKILL.md`에서 팀과 팀장을 말하는 줄

**Interfaces:**
- Produces: `from-orca.mjs`의 `ROLE_LANE`이 새 이름을 레인에 잇는다. `product-manager` → `plan`, `research` → `plan`, `frontend`와 `backend` → `dev`, `verifier` → `verify`, `harness-engineer`와 `doc-steward` → `harness`, 그 밖은 `coord`.
- Produces: `from-orca.mjs`에서 `isLead`, 팀장 행("… — 리더"), `memberIds`가 없어진다.
- Produces: `render.mjs`가 노드의 `members`를 읽지 않는다. 예시의 레인 이름은 에이전트 단위(기획, 프론트엔드, 백엔드, 검증, 하네스)다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
// waterfall check.mjs: 팀장 spec 경우(task_a4, :57, :59)를 지우고 아래를 둔다
//   spec 첫 줄이 '[역할: verifier]'이고 계획 행에 없는 Task → 그 행의 lane === 'verify'
//   '[역할: frontend]' → lane === 'dev', '[역할: research]' → lane === 'plan'
// render.mjs 셀프테스트: unit '리드'와 members를 쓰던 경우(:515-525)를 지우고,
//   노드에 members가 있으면 /members는 없어졌습니다/ 로 던지는 경우를 둔다
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node template/.claude/skills/waterfall-timeline/scripts/check.mjs; node template/.claude/skills/dag-swimlane/scripts/render.mjs --self-test`
Expected: 새 경우에서 실패. `render.mjs`의 셀프테스트를 부르는 인자가 다르면 그 파일 머리의 사용법을 따른다.

- [ ] **Step 3: 고치고, 예시와 `reference.html`을 다시 만든다**

`reference.html`은 `reference.json`을 렌더한 결과와 바이트로 비교된다(`render.mjs:527`). 예시를 고친 뒤 같은 명령으로 다시 만들어 넣는다.

- [ ] **Step 4: 돌려서 통과를 확인하고 커밋한다**

Run: Step 2와 같은 명령.
Expected: 둘 다 종료 코드 0.

```bash
git add template/.claude/skills/waterfall-timeline template/.claude/skills/dag-swimlane
git commit -m "feat: waterfall and swimlane draw by agent unit, no lead rows"
```

---

### Task 9: 구조도(agent-toggle)

**Files:**
- Modify: `skills/agent-toggle/team.mjs:127-233`, `team.js`, `team.css`, `check.mjs:89-111`, `check-team-ui.py`, `SKILL.md`
- Regenerate: `integrations/agent-toggle/agent-toggle.patch`

**Interfaces:**
- Consumes: 명단 형식(Task 1). `team.mjs`는 `docs/harness/agents.md`의 4칸 표를 읽는다. 플러그인 스킬이라 `roster.mjs`를 가져다 쓰지 않고 같은 규칙(머리 줄 이름으로 칸을 찾는다)으로 직접 읽는다.
- Produces: `teamStructure()`가 돌려주는 묶음에서 `lead`, `isTeam`, `kind`(운영팀·실행팀·직속)가 없어진다. 에이전트마다 `{ name, unit, skills, scope, waiting }`을 갖고, `waiting`은 그 에이전트의 Claude 정의가 꺼져 있을 때 참이다.
- Produces: 명단이 없고 옛 명단만 있으면 구조도 자리에 `setup을 다시 돌려 새 구조로 옮기세요` 한 줄을 보인다.

화면의 규칙이다.

- `product-manager`는 창구 아래에, 나머지는 코디네이터 아래에 같은 층으로 그린다.
- 팀장 리본, "팀장 또는 워커 배정" 레일 이름, "리본 = 팀장" 범례, "운영팀 · 팀장 없음" 절, "복잡한 내부 분해 시 팀장이 Planner에게…" 문장을 지운다.
- 꺼진 에이전트의 카드에 "배정 대기"를 보이고 그 에이전트로 가는 레일은 그리지 않는다.
- 창고 키트를 팀장이 있는 실행팀으로 고정한 줄(`team.mjs:220`)을 지운다. 키트의 에이전트는 다른 에이전트와 같은 카드로 보인다.
- 모델 표의 `* / 리드` 행을 팀장에게 주던 줄(`team.mjs:233`)을 지운다.

탭 셋의 규칙이다(설계서 3.11). 탭의 자료는 지금처럼 역할 파일의 `## 직접 협업` 표와 `## 문서 책임` 표, 문서 색인에서 만든다(`team.mjs:54-124`). 옛 양식의 역할 본문을 읽는 줄(`:87-93`, `:102-108`)은 창고의 다른 키트가 쓰므로 그대로 둔다.

| 탭 | 지금 | 바꾼 뒤 |
| --- | --- | --- |
| 첫째 | 이름 `팀 구조도`(`team.js:2`), 탭 목록의 이름표 `팀 보기`(`:153`). 팀 패널마다 "업무 관계 보기"(`:413`) | 이름 `에이전트 구조도`, 이름표 `에이전트 보기`. "업무 관계 보기"는 전체에 하나다. 실선은 코디네이터(PM은 창구)의 배정과 보고, 점선은 직접 협업이다 |
| 직접 협업 | 양쪽이 켜진 쌍의 주제와 목적(`:236-241`, `:435-444`) | 그대로 두고 행에 `한도`를 더한다. `team.mjs:82`가 표의 넷째 칸을 읽어 `{ peer, topic, purpose, limit }`을 만든다. 칸이 없으면 `limit`은 빈 문자열이고 화면에 보이지 않는다 |
| 문서 | 이름 `문서 소유권`, 칸 `문서 · 범위`, `정본 작성자`, `주요 검토자`(`:447-465`) | 이름 `문서 담당`, 둘째 칸 `담당 에이전트`. 표 위에 한 줄: `모든 에이전트가 docs-management로 자기 문서를 쓴다. 전체 정합성은 doc-steward가 확인한다.` 담당 에이전트가 꺼져 있으면 그 칸에 `담당 꺼짐`, 담당이 없는 행(색인의 `작성자 배정 대기`)에는 `담당 없음` |

- 에이전트 상세(`team.js:310-316`)는 역할 본문의 절을 그대로 보여 준다. `따로 두는 이유`, `작업 단위와 스킬`, `경계`가 함께 나오는지 화면 검사로 확인한다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
// check.mjs: 명단 픽스처를 4칸으로 바꾼다
//   '| `kit-agent` | 검증 | `team-x` | tests |'
// 켜져 있을 때 → structure의 그 에이전트 waiting === false, lead 키 없음
// 그 에이전트를 끈 뒤 → waiting === true
// team-org.md만 있는 대상 → 구조 결과의 notice에 'setup을 다시 돌려 새 구조로 옮기세요'
```

`check.mjs`에 탭의 자료를 보는 경우를 더한다.

```js
// 직접 협업 표에 넷째 칸 '한도'가 있는 역할 → collaboration[0].limit === '질문 3회, 넘으면 배정자에게'
// 한도 칸이 없는 3칸 표 → collaboration[0].limit === ''
// 문서 책임 표의 작성 행 → ownership에서 그 문서의 writers에 그 에이전트 이름
// 색인의 '작성자 배정 대기'에만 있는 문서 → ownership 행의 writers가 빈 배열
```

`check-team-ui.py`에서는 팀장 OFF/ON 경우(`:94-103`, `:168-176`)와 5칸 옛 명단 경우(`:347`)를 지우고 아래를 둔다. 탭 이름을 쓰는 줄(`:130`, `:146`, `:165`, `:169`, `:198`, `:203`, `:207`, `:311`, `:315`)은 새 이름으로 고친다.

```python
# 구조도: 꺼진 에이전트 카드에 '배정 대기'가 있고 그 레일이 없다. 화면 어디에도 '팀장'이 없다
# 구조도: '업무 관계 보기'가 정확히 하나다
expect(page.get_by_text("업무 관계 보기")).to_have_count(1)
# 문서 담당 탭
page.get_by_role("tab", name="문서 담당").click()
expect(page.get_by_role("columnheader")).to_have_text(["문서 · 범위", "담당 에이전트", "주요 검토자"])
expect(page.get_by_text("전체 정합성은 doc-steward가 확인한다")).to_be_visible()
# 문서의 담당 에이전트를 끈 뒤 → 그 행에 '담당 꺼짐'. 담당이 없는 문서의 행에 '담당 없음'
# 직접 협업 탭
page.get_by_role("tab", name="직접 협업").click()
# 한도가 있는 쌍의 행에 그 한도 글자가 보인다. 한쪽을 끄면 그 행이 사라진다
# 에이전트 상세: 제목 목록(:121)에 '따로 두는 이유', '작업 단위와 스킬', '경계'가 더해진다
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node skills/agent-toggle/check.mjs`
Expected: 새 경우에서 실패.

- [ ] **Step 3: 고친다**

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `node skills/agent-toggle/check.mjs`
Expected: 종료 코드 0.

Run: `python skills/agent-toggle/check-team-ui.py --kit "<창고의 키트 하나의 경로>"`
Expected: 종료 코드 0. Python Playwright와 Chromium이 없으면 돌리지 못한 것으로 적고 넘어가지 않는다. 그 환경을 갖춘 뒤 돌린다.

- [ ] **Step 5: 패치 파일을 다시 만들고 커밋한다**

`agent-toggle.patch`는 사용자 스코프의 원본 스킬에서 키트 사본으로 가는 diff다. 만든 방법은 `docs/superpowers/plans/2026-11-20-harness-team-structure.md:266` 부근에 있다. 같은 방법으로 다시 만든다.

```bash
git add skills/agent-toggle integrations/agent-toggle
git commit -m "feat: agent-toggle draws the flat roster, no leads"
```

---

### Task 10: 안내 문서, 버전, 전체 검증

**Files:**
- Modify: `README.md`, `README.en.md`, `examples/dev-team/{README,rows}.md`
- Modify: `.claude-plugin/plugin.json:3`(`"version": "0.6.0"`), 마켓플레이스 파일에 버전이 있으면 함께
- Modify: `template/docs/harness/changelog.md`(키트의 변경 이력 한 행)

**무엇을 쓰나**

- README의 구조 그림과 "Multi-Team Agent 방식" 절을 설계서 3절로 바꾼다. 근거 글(2026-10-22)의 링크를 단다. 기본 제공 역할 표를 일곱 개로 바꾼다.
- "0.5.x에서 올리기" 절을 새로 쓴다. 넣을 것: 진행 중인 phase는 0.5.1에서 끝내거나 올린 뒤 계획을 다시 승인받는다(승인 기록의 해시가 달라진다), setup을 다시 돌리면 물러난 파일을 치우고 새 구조를 깐다, 프로젝트가 만든 역할은 `agent-author`의 "옮기기"로 합친다, 옮기기 전에 작업 트리를 커밋해 둔다.
- `examples/dev-team`은 개발 팀을 더하는 예다. `frontend`와 `backend`의 스킬을 채우는 예로 다시 쓴다.

- [ ] **Step 1: 문서와 버전을 고친다**

- [ ] **Step 2: 키트 전체의 셀프테스트를 돌린다**

Run:
```bash
for f in $(find template skills -name "*.check.mjs" -o -name "check.mjs" | sort); do node "$f" > /dev/null 2>&1 || echo "FAIL $f"; done; echo done
```
Expected: `done`만 찍힌다. `FAIL` 줄이 하나도 없다.

- [ ] **Step 3: 빈 프로젝트에 깔아 검증한다**

Run:
```bash
T=$(mktemp -d) && cd "$T" && git init -q && \
echo '{"codex":true,"approvalPrefixes":[],"coordinatorPermissionMode":"default","pm":{"model":"fable","effort":"xhigh"}}' > answers.json && \
node "<키트>/skills/setup/scripts/setup.mjs" install --target . --answers answers.json && \
node "<키트>/skills/setup/scripts/setup.mjs" verify --target . && \
for a in product-manager research frontend backend verifier doc-steward harness-engineer; do node .claude/scripts/agent-definition.mjs --agent $a; done && \
node .claude/scripts/phase-routing.mjs agent --agent frontend
```
Expected: `verify`가 `0 failed`, 일곱 줄의 `agent-definition: OK <이름>`, 마지막 줄 `{"agent":"frontend","route":"direct"}`.

- [ ] **Step 4: 0.5.1 설치본에서 올려 본다**

Run: 태그 `v0.5.1`(없으면 커밋 `48b23d4`)의 키트로 임시 프로젝트에 설치한 뒤, 이 브랜치의 `setup.mjs install`을 같은 폴더에 다시 돌린다.
Expected: 결과의 `retired`에 `RETIRED`의 열 경로 가운데 설치돼 있던 것이 모두 있고, `docs/harness/agents.md`가 생기고, `docs/harness/team-org.md`는 남아 있고, `inspect`의 `migration.roster`가 `docs/harness/team-org.md`다.

- [ ] **Step 5: 설계서의 금지어 검색을 돌린다**

Run: `grep -rnE "팀장|· 리드|team-lead|--lead|--complex|팀 스킬|team-qa|\`planner\`|code-reviewer|qa-inspector" template template-codex skills integrations | grep -vE "RETIRED|phase-resume|changelog|옮기기|0\.5" | wc -l`
Expected: `0`. 0이 아니면 남은 줄을 읽고, 이전 절차의 설명이 아닌 것은 고친다.

- [ ] **Step 6: 커밋한다**

```bash
git add README.md README.en.md examples .claude-plugin template/docs/harness/changelog.md
git commit -m "docs: README and upgrade notes for 0.6.0; bump plugin version"
```

푸시와 PR은 여기서 하지 않는다. 사용자에게 결과를 보고하고 확인을 받는다.

---

## 이 계획이 정한 것

설계서가 만드는 사람에게 남긴 것과, 코드를 읽고 나서 정한 것이다.

1. **명단 읽기를 `roster.mjs` 하나에 둔다.** 세 스크립트가 같은 표를 읽고, 옮기지 않은 프로젝트를 막는 문구도 한 곳에서 나온다.
2. **등록 없는 직접 기동을 통째로 지운다.** 팀장이 팀원을 띄우는 길과 같은 분기를 쓰고 있었고, 워커를 등록한 Task로만 띄우면 둘 다 필요 없다.
3. **끝 검증의 작업 단위는 `끝 검증` 하나다.** `일반 변경 리뷰`와 `흐름 검증`을 합쳤다.
4. **`doc-steward`, `harness-engineer`, PM의 완료 처리도 산정 행으로 둔다.** 설계서 3.5의 "고정은 사용자가 정한 것뿐"을 따랐다. 지금의 기본값(fable/high, opus/high, opus/medium)이 점수로 계산한 값으로 바뀐다.
5. **계획 없이 띄우는 워커도 점수를 낸다.** 창구가 `research`를 띄울 때 점수 파일을 함께 넘긴다.
6. **물러난 파일은 목록으로 명시한다.** 설치 기록과 틀의 차이로 찾으면 병합하거나 생성한 파일까지 지운다.
7. **`team-org.md`는 setup이 지우지 않는다.** `agent-author`의 옮기기 절차가 읽은 뒤 지운다.
8. **0.5.1에서 승인받은 phase는 이어 가지 못한다.** 승인 기록의 해시에 팀 내부 배정 칸이 들어 있어서다. 호환 코드를 두지 않고 안내문에 적는다.
9. **`frontend-*`와 `backend-*`로 스킬 이름에 접두어를 붙인다.**
