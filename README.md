# orca-teamagent-harness-kit

**한국어** | [English](README.en.md)

**Orca 기반 멀티 에이전트 하네스를 새 프로젝트에 한 번에 설치하는 Claude Code 플러그인.**

창구, 코디네이터, 팀장, 팀원으로 이어지는 역할 계층과 그 계층이 따르는 규칙(대기, 승인, 모델 배정, 검증, 문서화)을 skill, hook, 스크립트, 템플릿으로 패키징했다. 플러그인이 제공하는 skill은 `setup` 하나이고, 프로젝트에 설치되는 파일은 `template/` 아래에 대상 프로젝트와 같은 경로 구조로 들어 있다.

> **기본 환경: Orca + Superpowers + TeamAgent Harness**
>
> 이 키트는 아래 세 가지를 함께 쓰는 것을 전제로 한다. 하나라도 빠지면 동작하지 않는다.
>
> | 구성 | 역할 |
> | --- | --- |
> | **Orca** | 워커 실행과 오케스트레이션 (터미널, Run, Task, 메시지) |
> | **Superpowers** | 설계와 계획 skill (`brainstorming`, `writing-plans`) |
> | **TeamAgent Harness** (이 키트) | 역할 계층, 규칙, hook, 스크립트, 템플릿 |

```
사용자
  │
창구 (사용자 세션)            요구사항 인터뷰와 승인, 요청 분류, 최종 보고
  ├── planner                설계 문서와 구현 계획, DAG
  └── 코디네이터 (별도 터미널)  워커 실행, 결과 수집, ledger 갱신, commit과 PR
        ├── 팀장 ── 팀원 ×N
        ├── 팀장 ── 팀원 ×N
        └── 검증 팀장 ── QA, 코드 리뷰
```

## Quick Start

```sh
# 1. 플러그인 설치
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. 대상 프로젝트의 루트에서 Claude Code를 열고 실행
/orca-teamagent-harness-kit:setup
```

설치가 끝나면 창구 세션에 작업을 요청한다. 팀은 `setup`의 7단계에서 고르고, 나중에 직접 추가할 수도 있다([팀 추가](#팀-추가)).

## 특징

**Multi-Team Agent 방식**

팀 에이전트 구조는 [revfactory/harness](https://github.com/revfactory/harness)를 참조했다. 차이는 팀의 수다.

| | revfactory/harness | 이 키트 |
| --- | --- | --- |
| 방식 | Single Team | **Multi-Team Agent** |
| 구조 | 하나의 에이전트 팀이 작업을 수행한다 | 코디네이터 아래에 여러 팀이 있고, 팀마다 팀장과 팀원을 둔다 |
| 조율 | 팀 내부에서 조율한다 | 코디네이터가 팀 사이의 순서와 병렬 실행을 DAG로 조율한다 |

- 기획, 개발, 검증, 하네스처럼 역할이 다른 팀이 하나의 phase 안에서 함께 동작한다.
- 팀마다 팀 skill을 갖고, 팀장이 자기 팀의 Task를 분할하고 팀원을 감독한다.
- 팀은 `setup`의 7단계가 지난 작업을 보고 추천해 고른 대로 만든다. 나중에 템플릿으로 직접 추가할 수도 있다.

**역할 계층과 요청 규모별 라우팅**

- 계층은 코디네이터 아래 두 단계까지다. 팀원은 워커를 실행하지 않고, 워커는 commit하지 않는다.
- 요청 규모에 따라 처리 경로가 달라진다. 작은 수정은 창구가 직접 처리하고, Task 1~2개는 코디네이터가 워커를 바로 실행하고, 3개 이상이면 팀장을 두고, 요구사항이 불명확한 큰 작업은 요구사항 인터뷰부터 시작한다.

**정해진 phase 워크플로**

```
1 요구사항 인터뷰 → 2 설계 ✋ → 3 계획 ✋ → 4 백로그 반영 → 5 실행 → 6 완료 처리 → 7 하네스 회고 → 8 commit과 PR ✋
```

- ✋는 사용자 승인 단계다. 설계와 계획을 승인받을 때는 DAG Swimlane 다이어그램과 Waterfall 다이어그램을 함께 제시한다.
- 설계 문서와 구현 계획은 planner가 superpowers의 `brainstorming`, `writing-plans` 형식으로 작성한다.
- 회고는 생략하지 않는다. 변경할 근거가 없으면 측정 결과와 "변경 없음"만 기록한다.

**기본 제공 역할**

| 팀 | 에이전트 | 담당 |
| --- | --- | --- |
| (공용) | `planner` | 설계 문서, 구현 계획, DAG |
| 기획 | `product-manager` | 백로그, 수락 기준, 완료 처리 |
| 검증 | `qa-inspector` | 실행 기반 검증 |
| 검증 | `code-reviewer` | 코드 리뷰 (읽기 전용) |
| 하네스 | `harness-engineer` | phase 종료 시 회고와 하네스 개선 |

개발, 디자인 같은 도메인 팀은 포함하지 않는다. `setup`의 7단계가 지난 작업을 보고 추천해 고른 대로 만들고, 템플릿으로 직접 추가할 수도 있다.

**규칙을 강제하는 hook과 스크립트**

| 구성 요소 | 역할 |
| --- | --- |
| `approval-gate` hook | 사용자 승인이 필요한 명령(배포, push 등)을 비대화형 세션에서 차단하고 `ask`로 에스컬레이션하게 한다. force push는 프로젝트 설정과 무관하게 항상 승인 대상이다. 무조건 막지 않고 사용자에게 묻는다 |
| `orca-wait-gate` hook | 대기 규약을 위반한 `check --wait`(셸 `&`로 실행한 것, `--timeout-ms`나 `--types`가 빠진 것, 다른 명령과 한 줄에 묶어 백그라운드로 건 것)를 차단한다 |
| `compact-gate` hook | 코디네이터가 tool call을 연속 실행하는 중이면 자동 컨텍스트 압축을 다음 턴 경계로 미룬다 |
| `worker-intake-context` hook | 워커가 시작될 때 워커용 규칙을 컨텍스트에 주입한다 |
| `secret-gate` hook | Playwright MCP 입력에 쿠키, 토큰, 비밀번호가 들어가거나 쿠키를 읽으려 하면 차단한다. 넣은 값이 대화 기록에 남는 것을 막는다 |
| `orca-launch.mjs` | 모델 배정표를 조회해 워커를 실행하고, 탭 제목을 `[BL-0012] qa-inspector : opus/medium - 결제 흐름 검증` 형식으로 설정한다. 코디네이터가 실행하는 Task를 의존 관계와 함께 Orca에 등록하고, 준비된 Task 조회, 결정 대기 게이트, 판정 실패 처리, 재시도를 하위 명령으로 제공한다 |
| `model-selection.mjs` | 모델 배정표를 검증한다 (존재하지 않는 에이전트, 중복 행, 지원하지 않는 조합) |
| `report-check.mjs` | 워커 리포트의 `## 검증` 섹션을 판정하고, 그 Task의 산출물 파일이 실제로 있는지 확인한다 |
| `wait-contract-check.mjs` | 세 skill에 포함된 대기 규약이 원본과 일치하는지 비교한다 |
| `coordinator-settings.mjs` | allowlist를 읽어 코디네이터 전용 설정 파일을 생성한다 |
| `browser/launch.cjs`, `browser/probe-fps.cjs` | 화면 캡처, 3D·WebGL 실측, 로그인이 필요한 검증을 Playwright MCP 밖에서 돌리는 런처와 GPU 실측 스크립트. 비밀값은 dotenv 파일에서만 읽고 로그에서 가린다 |

스크립트와 hook은 Node 내장 모듈만 사용하고, 각각 self-test(`*.check.mjs`)를 갖는다. 브라우저 런처만 예외로 Playwright를 쓴다(프로젝트에 설치된 것, 없으면 Playwright MCP가 받아 둔 복사본).

## 특장점

**코디네이터의 토큰 사용량을 줄인다**

- 코디네이터는 플러그인과 skill을 최소로 활성화한 전용 설정으로 실행된다. 활성화할 항목은 `.claude/coordinator.keep.json`에서 사용자가 직접 지정한다.
- 코디네이터는 heartbeat마다 깨어나지 않는다. 대기는 백그라운드 작업 하나로만 걸고, 대기 규약 5줄과 hook이 이를 강제한다.
- 코디네이터는 워커 리포트의 전문을 읽지 않고 워커의 테스트를 다시 실행하지도 않는다. 리포트 판정 스크립트의 결과만 확인한다.
- 코디네이터는 계획 승인 후 새 세션으로 실행된다. 설계 단계에서 로드한 skill이 컨텍스트에 남지 않는다.

**Task 순서와 결정 대기를 Orca가 강제한다**

- 코디네이터는 자신의 실행 Run에 계획의 Task를 의존 관계와 함께 등록한다. 선행 Task가 끝나기 전에는 Orca가 실행을 거부한다.
- 사용자 결정이 필요한 Task는 게이트로 막고, 결정을 받은 뒤에 푼다. 선행 Task가 아직 끝나지 않았으면 스크립트가 다시 대기 상태로 되돌린다.
- 워커가 성공을 보고했더라도 리포트 판정이 실패하면, 스크립트가 그 Task를 실패로 되돌리고 후속 Task를 다시 묶은 뒤 같은 Task를 재시도한다.
- Task 상태의 기준은 Orca다. 장부에는 Orca가 갖지 않는 정보(적용된 모델, 재시도 원인, 질문, 리포트 경로)만 기록한다.
- 팀장은 Run을 따로 만들지 않는다. 팀원은 코디네이터의 실행 Run에 들어가고, 팀장은 대기 하나로 팀원의 보고와 코디네이터의 답을 모두 받는다.

**모델과 effort를 표 하나로 관리한다**

- 에이전트와 작업 유형마다 한 행을 `docs/harness/model-selection.md`에 정의한다. planner는 모델을 고르지 않고 작업 유형만 지정한다.
- 실행 스크립트가 spec의 배정 행, 배정표, 전달된 인자를 비교하고 불일치하면 실행을 거부한다. 예외는 사용자의 지시 원문을 사유로 기록할 때만 허용된다.

**검증이 수렴한다**

- 수정 대상은 High와 완료 기준 미달뿐이다. Medium 이하는 인박스로 넘긴다.
- 재검증은 해당 결함의 재현 여부만 확인한다. 재검증 중에 새로 찾은 High도 남은 High로 센다. fix loop는 최대 2회이고, 그 뒤에도 High가 남아 3회째가 필요해지면 중단하고 사용자에게 묻는다.
- 구현한 에이전트가 자신의 결과를 승인하지 않는다. 구현 Task는 테스트를 먼저 작성한다(TDD).
- 끝 검증의 QA는 영역별 워커로 동시에 돈다. 브라우저를 쓰는 QA도 같다. `.claude/settings.json`의 `PLAYWRIGHT_MCP_ISOLATED`, `PLAYWRIGHT_MCP_HEADLESS` 두 줄이 워커마다 브라우저를 따로 띄우게 한다.
- 이 두 줄은 프로젝트의 모든 세션에 적용된다. 직접 여는 세션(창구 포함)에서 창이 보이고 로그인 상태가 유지되는 브라우저를 쓰려면 `claude --settings .claude/front-desk.settings.json`으로 연다.
- 혼자 써야 하는 자원(GPU, Blender MCP 등)을 쓰는 검증은 나누지 않는다. 구현 Task는 그 자원 없이 도는 간단한 코드 테스트로 끝내고, 그 자원을 쓰는 검증은 구현이 모두 끝난 뒤 Task 하나가 한 번 돌린다.

**승인 절차를 우회할 수 없다**

- 대화형 세션에서는 `permissions.ask`가 확인을 요청하고, 비대화형 세션에서는 hook이 차단한다. 권한 모드와 무관하게 이중으로 적용된다.
- 템플릿은 사용자 대신 팀이나 모델을 결정하지 않는다. 결정이 필요하면 문서의 "사용자 결정 필요" 목록으로 넘긴다.

**문서가 무분별하게 늘어나지 않는다**

- 작업 디렉터리는 `_workspace/<팀>/<phase>/`이고 `.gitignore`로 제외한다. 파일 이름은 `NN_<에이전트>_<산출물>_v1.md` 형식 하나로 통일한다.
- 같은 규칙을 두 곳에 두지 않는다. 대기 규약, 모델 배정표, 팀 구성표는 각각 단일 원본(single source of truth) 파일을 갖는다.

**Claude와 Codex를 함께 사용한다**

- 공통 규칙은 `AGENTS.md` 하나에 둔다. `CLAUDE.md`는 `@AGENTS.md`를 import하고, Codex용 skill은 Claude용 원본을 참조하는 포인터다.
- Codex를 사용하지 않으면 설치할 때 Codex 관련 파일을 제외한다.

**재실행해도 안전하다 (idempotent)**

- `setup` skill은 내용이 같은 파일은 건너뛰고, 내용이 다른 기존 파일은 diff를 보여 준 뒤 승인받은 파일만 덮어쓴다. 설치 후 사용자가 수정한 파일도 덮어쓰지 않는다.
- `.claude/settings.json`과 `.gitignore`는 덮어쓰지 않고 항목만 병합한다.

## 환경 구성

### 기본 환경 (필수)

**Orca + Superpowers + TeamAgent Harness**, 이 세 가지가 기본 환경이다. Orca가 워커를 실행하고, Superpowers가 설계와 계획의 형식을 제공하고, 이 키트가 그 위에 팀 구조와 규칙을 올린다.

| 구성 | 내용 |
| --- | --- |
| **Orca** | CLI 1.4.255에서 테스트했다. 실행 절차의 기준 문서는 `orca skills get orchestration`의 가이드다 |
| **Superpowers** | Claude Code 플러그인. `brainstorming`, `writing-plans` skill이 필요하다 |
| **TeamAgent Harness** | 이 플러그인. `setup` skill로 프로젝트에 설치한다 |

### 그 밖의 요구 사항

| 항목 | 내용 |
| --- | --- |
| Claude Code | 플러그인 설치와 `setup` skill 실행에 사용한다 |
| Node | 스크립트와 hook을 실행한다. 추가로 설치할 패키지는 없다 |
| git | 대상 프로젝트가 git 저장소가 아니면 `setup` skill이 알리고 계속할지 확인한다 |
| OS | Windows와 Git Bash에서만 테스트했다 |
| Codex | 함께 사용할 때만 필요하다. 설치할 때 선택한다 |

- 코디네이터는 1M 컨텍스트 윈도우 모델(`opus`)로 실행하는 것이 기본값이다. 컨텍스트 압축 시작점 350,000과 상한 500,000이 이 윈도우를 전제로 한다.
- `worker-start`로 실행되는 워커의 권한 모드는 명령 옵션으로 지정할 수 없고 Orca의 "새 에이전트 탭" 설정을 따른다.
- `setup` skill은 누락된 요구 사항을 알리기만 하고 대신 설치하지 않는다.

## 설치

GitHub 저장소를 marketplace로 등록해 설치한다.

```sh
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

또는 저장소를 clone해 로컬 디렉터리를 marketplace로 등록한다. 테스트는 이 방식으로만 했다.

```sh
git clone https://github.com/topspeedz/orca-teamagent-harness-kit.git
claude plugin marketplace add "<clone한 디렉터리 경로>"
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

## 사용법

### 1. `setup` skill 실행

대상 프로젝트의 루트에서 Claude Code를 열고 `/orca-teamagent-harness-kit:setup`을 실행한다(또는 "하네스 키트 세팅해줘"). skill은 아홉 단계로 진행된다.

1. **환경 점검**: git, Orca, Node, superpowers, DAG Swimlane 다이어그램과 Waterfall 다이어그램 skill, Codex, 기존 지침 파일(`AGENTS.md`, `CLAUDE.md`)을 확인한다.
2. **질문 5개**: Codex 사용 여부, 사용자 승인이 필요한 명령, 코디네이터 터미널의 권한 모드, planner의 effort, 코디네이터에서 활성화할 플러그인과 skill.
3. **설치**: 내용이 같은 파일은 건너뛰고, 내용이 다른 기존 파일은 diff를 보여 준 뒤 승인받은 파일만 덮어쓴다.
4. **설정 생성**: allowlist `.claude/coordinator.keep.json`을 수정하고 코디네이터 설정 파일을 생성한다.
5. **검증**: 설치된 self-test, 모델 배정표 검증, 대기 규약 비교를 실행한다.
6. **기반 설계**: 프로젝트의 검증 명령을 실제로 실행해 통과한 것만 지침에 기록하고, 금지 명령(`permissions.deny`), 문서 라우팅, 토큰 기준선을 정한다.
7. **팀 구성**: 지난 세션 기록과 기존 파이프라인을 분석해 팀과 팀원을 근거와 함께 추천하고, 사용자가 고른 대로 팀 skill, 에이전트, 역할 skill을 만들어 팀 구성표와 모델 배정표에 올린다.
8. **모델 표**: 모델 배정표의 모든 행을 설문 페이지(Artifact)로 띄우고, 사용자가 저장한 값만 표에 반영한다.
9. **결과 보고**: 설치한 파일, 건너뛴 파일, 실패한 검증, 기반 설계 결과, 만든 팀, 다음 단계.

Orca를 사용하지 않는 프로젝트에서는 1, 6, 9단계만 실행한다(템플릿은 설치하지 않는다).

재실행하면 누락된 파일만 추가하고 검증을 다시 실행한다. 스크립트를 직접 호출할 수도 있다.

```sh
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" inspect --target .
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" install --target . --answers <응답 파일> [--approve <경로,...>]
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" verify --target .
```

### 2. 프로젝트 설정

- `AGENTS.md`의 "명령"과 "기술 스택" 섹션을 작성한다. 명령은 실제로 실행해 확인한 것만 적는다.
- 모델 배정표 `docs/harness/model-selection.md`를 조정한다. 들어 있는 값은 기본값이다.
- 팀은 `setup`의 7단계에서 구성한다. 템플릿에는 구현 팀이 없으므로, 그 단계에서 팀을 만들지 않았으면 구현 Task를 실행할 수 없다.

### 팀 추가

`setup` skill의 7단계가 지난 작업을 분석해 팀을 추천하고 고른 대로 만든다. 나중에 직접 넣을 때는 아래 순서로 한다.

1. 팀 skill 템플릿 `docs/harness/templates/team-skill.md`를 `.claude/skills/team-<이름>/SKILL.md`로 복사해 작성한다.
2. 에이전트 템플릿 `docs/harness/templates/agent.md`를 `.claude/agents/<이름>.md`로 복사해 작성한다.
3. 팀 구성표 `docs/harness/team-org.md`에 팀 한 행을 추가한다.
4. 모델 배정표 `docs/harness/model-selection.md`에 새 에이전트의 행을 추가하고 `node .claude/scripts/model-selection.mjs check`로 검증한다.

팀의 정의는 팀 구성표가, 팀의 작업 방식은 팀 skill이 담당한다.

작성된 예제는 `examples/dev-team`에 있다. 의존성 없는 Node 프로젝트에서 `node --test`로 작업하는 `developer` 한 명으로 구성된 팀이다. `setup` skill은 이 디렉터리를 설치하지 않는다. 사용하려면 그 디렉터리의 `README.md`에 적힌 순서대로 프로젝트에 직접 추가한다.

### 3. 작업 요청

창구(평소의 Claude Code 세션)에 요청하면 `AGENTS.md`의 규모별 라우팅 규칙에 따라 처리된다.

| 요청 | 처리 경로 |
| --- | --- |
| 단순 질문, 파일 하나의 작은 수정 | 창구가 직접 처리한다 |
| 범위가 명확한 작은 작업 (한 팀의 Task 1~2개) | 코디네이터가 팀장 없이 워커를 직접 실행한다 |
| 한 팀의 Task가 3개 이상이거나 분할에 도메인 판단이 필요 | 코디네이터가 팀장을 실행하고, 팀장이 팀원을 실행한다 |
| 요구사항이 불명확한 큰 작업 | 요구사항 인터뷰부터 시작하는 전체 워크플로(`plan-orchestrate` skill)를 따른다 |

## 설치되는 파일

```
AGENTS.md, CLAUDE.md             공통 지침과 라우팅
.claude/
  agents/                        기본 에이전트 5개
  skills/                        coordinator, team-lead, plan-orchestrate, phase-planning,
                                 backlog-management, qa-verification, change-review, harness-retro,
                                 team-product, team-qa, team-harness, dag-swimlane, waterfall-timeline
  hooks/                         승인, 대기, 컨텍스트 압축, 워커 규칙 주입, 브라우저 비밀값 차단
  scripts/                       워커 실행, 모델 배정표, 리포트 판정, 대기 규약 비교, 코디네이터 설정, 브라우저 런처
  settings.json                  hook 등록, permissions, 브라우저 병렬용 env 두 줄 (기존 파일에는 항목만 병합한다)
  front-desk.settings.json       직접 여는 세션에서 그 env 두 줄을 끄는 설정
  coordinator.keep.json          코디네이터에서 활성화할 플러그인과 skill의 allowlist
docs/
  backlog.md, backlog-archive.md
  harness/                       모델 배정표, 팀 구성표, changelog, 템플릿 8개
.agents/skills/                  Codex용 포인터 (Codex 사용을 선택했을 때만)
```

## 테스트하지 않은 환경

- macOS, Linux
- Git Bash 없이 PowerShell만 사용하는 환경
- Orca 1.4.255 이외의 버전
- 로컬 디렉터리가 아닌 GitHub marketplace로 설치한 경우

## 개발

```sh
claude plugin validate .                                  # plugin manifest
claude plugin validate .claude-plugin/marketplace.json    # marketplace manifest
```
