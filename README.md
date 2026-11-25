# orca-teamagent-harness-kit

**한국어** | [English](README.en.md)

**Orca 기반 멀티 에이전트 하네스를 새 프로젝트에 한 번에 설치하는 Claude Code 플러그인.**

창구는 실행 승인 전까지 PM과 Planner에게 기획을 맡기고, 승인 뒤에는 코디네이터가 실행 팀과 직속 역할을 기동한다. 설치용 `setup`과 팀 구성용 `agent-author`를 제공한다. 프로젝트용 파일은 `template/`에, 선택 설치하는 Codex 파일은 `template-codex/`에 있다.

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
  ├── 운영팀 (팀장 없음)
  │     ├── product-manager       PRD·SRS, 백로그, 계획 대조
  │     └── planner               요구 검토, 기술 설계, 계획·DAG
  └── 코디네이터 (실행 승인 뒤)
        ├── 실행 팀장 ── 팀원     검증 팀 및 프로젝트에서 추가한 팀
        ├── doc-steward           라이브 문서 확인 행이 있을 때 QA 뒤 문서 정합성 확인
        └── harness-engineer      조건이 맞을 때 문서 확인 뒤 회고
```

## Quick Start

```sh
# 1. 플러그인 설치
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. 대상 프로젝트의 루트에서 Claude Code를 열고 실행
/orca-teamagent-harness-kit:setup
```

설치가 끝나면 창구 세션에 작업을 요청한다. 팀은 `setup`의 7단계에서 고르고, 나중에는 `agent-author`으로 팀이나 팀원을 추가한다([팀 추가](#팀-추가)).

## 특징

**Multi-Team Agent 방식**

팀 에이전트 구조는 [revfactory/harness](https://github.com/revfactory/harness)를 참조했다. 차이는 팀의 수다. 기획 팀의 방법(요구사항 정리, 분해와 복잡도, RICE, 기획 검토)은 [revfactory/harness-100의 46-product-manager](https://github.com/revfactory/harness-100/tree/main/ko/46-product-manager)(Apache-2.0)에서 가져와 이 키트의 규칙에 맞게 다시 썼다.

| | revfactory/harness | 이 키트 |
| --- | --- | --- |
| 방식 | Single Team | **Multi-Team Agent** |
| 구조 | 하나의 에이전트 팀이 작업을 수행한다 | 팀장 없는 운영팀, 팀장이 있는 실행 팀, 코디네이터 직속 역할로 나뉜다 |
| 조율 | 팀 내부에서 조율한다 | 코디네이터가 팀 사이의 순서와 병렬 실행을 DAG로 조율한다 |

- 운영팀의 PM과 Planner는 동료다. 창구가 각각 기동하고, 브리프와 산출물을 통해 인계한다.
- 실행 팀장은 팀 스킬에 따라 승인된 Task를 나누고 팀원을 감독한다. 내부 분해에 깊은 설계가 필요하면 Planner에게 분해안을 맡길 수 있다.
- 팀은 `setup`의 7단계가 지난 작업을 보고 추천해 고른 대로 만든다. 나중에 템플릿으로 직접 추가할 수도 있다.

**역할 계층과 요청 규모별 라우팅**

- 계층은 코디네이터 아래 두 단계까지다. 팀원은 워커를 실행하지 않고, 워커는 commit하지 않는다.
- 승인된 실행 팀에 단순 Task가 하나이고 팀장이 ON이면 코디네이터가 팀원에게 직접 배정할 수 있다. Task가 2개 이상이거나 하나라도 전문 분해가 필요하면 팀장을 거친다. 팀장이 OFF이면 해당 팀의 배정은 대기한다.

**phase 진행과 승인**

```
새 요구 · 지정 백로그 ID · 한 phase 위임 → 설계·계획 → 실행 승인 → 실행·QA → 완료 처리 → 하네스 회고 → commit과 PR 승인
```

- 새 요구는 PM이 PRD·SRS·백로그에 반영하고, `plan-orchestrate`의 조건이 맞으면 Planner가 누락과 실행 가능성을 검토한다. 사용자가 전체 반영 여부와 이번 묶음을 확인한 뒤 설계·계획으로 넘어간다. 지정 ID는 Planner가 바로 설계한다. 두 경로 모두 설계와 실행 계획을 승인받는다.
- 한 phase를 위임하면 PM이 목표·항목·선정 이유를 정하고 Planner가 계획한다. 사용자는 최종 실행 승인에서 묶음과 예상 그림을 함께 확인한다. 시작 전에는 대기 상태 DAG와 T+ 예상 워터폴을, 승인 뒤에는 같은 Run의 진행 상황을 본다.
- 설계 문서와 구현 계획은 planner가 superpowers의 `brainstorming`, `writing-plans` 형식으로 작성한다.
- 회고는 측정 표에 실패나 재시도가 있거나 수정 라운드가 2에 닿았거나 마지막 회고 뒤 phase가 5번 지났을 때 띄운다. 아니면 `skip`으로 닫고, 측정 표는 코디네이터가 매번 남긴다. 띄웠는데 고칠 근거가 없으면 측정 결과와 "변경 없음"만 기록한다. 조건은 coordinator 스킬이 정한다.
- 완료 처리에서는 지정 작성자가 제품 문서를 갱신한다. `doc-steward`는 코드·테스트와 대조해 색인과 연결을 정리하고, 내용 결함은 원작성자에게 돌려보낸다.

**기본 제공 역할**

| 팀 | 에이전트 | 담당 |
| --- | --- | --- |
| 운영 | `product-manager` | PRD·SRS 작성, 수락 기준, 항목화·우선순위, 묶음 선정, 계획 대조와 백로그 정산 |
| 운영 | `planner` | 요구사항 검토, 기술 설계, 실행 계획과 DAG |
| 직속 | `doc-steward` | 장부의 `## 라이브 문서 확인`에 행이 있을 때 QA 뒤 제품 문서 정합성 확인, 색인과 연결 관리 |
| 검증 | `qa-inspector` | 실행 기반 검증 |
| 검증 | `code-reviewer` | 코드 리뷰 (읽기 전용) |
| 직속 | `harness-engineer` | 조건이 맞을 때 문서 확인 뒤 회고와 근거 있는 하네스 개선 |

개발, 디자인 같은 도메인 팀은 포함하지 않는다. `setup`의 7단계가 지난 작업을 보고 추천해 고른 대로 만들고, 템플릿으로 직접 추가할 수도 있다.

**규칙을 강제하는 hook과 스크립트**

| 구성 요소 | 역할 |
| --- | --- |
| `approval-gate` hook | 사용자 승인이 필요한 명령(배포, push 등)을 비대화형 세션에서 차단하고 `ask`로 에스컬레이션하게 한다. force push는 프로젝트 설정과 무관하게 항상 승인 대상이다. 무조건 막지 않고 사용자에게 묻는다 |
| `orca-wait-gate` hook | 대기 규약을 위반한 `check --wait`(셸 `&`로 실행한 것, `--timeout-ms`나 `--types`가 빠진 것, 다른 명령과 한 줄에 묶어 백그라운드로 건 것)를 차단한다 |
| `compact-gate` hook | 코디네이터가 tool call을 연속 실행하는 중이면 자동 컨텍스트 압축을 다음 턴 경계로 미룬다 |
| `worker-intake-context` hook | 워커가 시작될 때 워커용 규칙을 컨텍스트에 주입한다 |
| `secret-gate` hook | Playwright MCP 입력에 쿠키, 토큰, 비밀번호가 들어가거나 쿠키를 읽으려 하면 차단한다. 넣은 값이 대화 기록에 남는 것을 막는다 |
| `orca-launch.mjs` | 실행 Run에서 승인된 Task 배정으로 워커를 기동하고 탭에 역할·모델·effort를 표시한다. 의존 관계 등록, 준비된 Task 조회, 결정 대기, 실패 처리, 재시도를 지원한다. `skip` 명령은 `conditional: true`인 Task나 `rounds`의 수정·재검 Task를 워커 없이 닫는다 |
| `tree-snapshot.mjs` | 작업 폴더 전체를 실제 인덱스와 작업 트리를 건드리지 않고 트리로 찍고(`take`), 두 트리의 변경 파일을 낸다(`diff`) |
| `defect-ledger.mjs` | 리포트의 `## 결함` 표를 장부의 `## 결함 원장`에 옮긴다. 증거가 없는 High는 Medium으로 기록하고, 이미 있는 행은 다시 쓰지 않는다 |
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

- PM은 BL에 구조 복잡도·불확실성·실패 영향·검증 근거를 남긴다. Planner는 Task와 팀원별 모델·effort를 계산하고, 해석에 따라 배정이 달라질 때만 Haiku로 점수를 확인한다. 사용자는 DAG에서 추천을 검토하고 직접 고정하거나 기동 직전 재평가를 위임한다. 코디네이터와 팀장은 승인된 런타임과 치환표에서 최종 배정을 적용한다. [배정 기준과 Astra ultra 치환](template/docs/harness/model-selection.md)
- 표를 수정하면 다음 계획부터 적용된다. 현재 Run의 Task 배정을 바꾸려면 해당 배정과 DAG를 갱신하고 다시 승인받는다.

**검증이 수렴한다**

- 수정 대상은 High와 완료 기준 미달뿐이다. Medium 이하는 인박스로 넘긴다.
- 끝 리뷰는 합쳐진 코드에서 브라우저 없이 도는 검사(문법, 타입, 린트, 단위 테스트)를 먼저 한 번 돌린다.
- 수정은 결함마다 재현 테스트를 남기고, 수정 뒤에는 코디네이터가 바로 최종 테스트를 돌려 그 테스트로 확인한다. 재검증은 재현 테스트가 없는 결함만 그 결함의 재현 여부를 확인한다. 재검증 중에 새로 찾은 High도 남은 High로 센다. fix loop는 최대 2회이고, 그 뒤에도 High가 남아 3회째가 필요해지면 중단하고 사용자에게 묻는다.
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
- 팀의 작업 리포트는 이력이다. 라이브 문서의 첫 작성과 후속 수정은 지정된 문서·절의 작성자가 맡는다. PM은 PRD·SRS를 쓰고 `doc-steward`는 색인과 정합성을 확인한다. 담당자가 없으면 역할 생성, 나중에 배정, 해당 없음 중 사용자가 선택한다.
- 새 설치는 `docs/harness/templates/product-docs/`의 양식 12개로 코드 지도와 12개 번호 폴더의 초안 13개를 준비한다. 기존 색인이 가리키는 정본과 편집한 내용은 보존한다.

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

설치 후 `/orca-teamagent-harness-kit:agent-author`로 독립 역할, 기존 팀원, 실행 팀 전체를 추가할 수 있다. 기존 역할과 원문을 조사해 필요한 전문 판단, 협업 상대, 미배정 문서·절을 제안한다. 사용자가 선택한 범위를 역할 정의와 명단에 기록하고 필요한 팀 스킬과 모델 표를 갱신한다. [팀 구성 스킬](skills/agent-author/SKILL.md)

직접 추가할 때는 아래 순서로 한다.

1. 팀 skill 템플릿 `docs/harness/templates/team-skill.md`를 `.claude/skills/team-<이름>/SKILL.md`로 복사해 작성한다.
2. 에이전트 템플릿 `docs/harness/templates/agent.md`를 `.claude/agents/<이름>.md`로 복사해 작성한다.
3. 팀 구성표 `docs/harness/team-org.md`에 팀 한 행을 추가한다.
4. `docs/harness/model-selection.md`에 작업 단위별 행을 추가하고 `node .claude/scripts/model-selection.mjs check`와 새 역할별 `node .claude/scripts/agent-definition.mjs --agent <이름>`을 실행한다.

Codex를 함께 쓰면 같은 이름의 팀 스킬 포인터를 만들고 새 역할별로 `node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <이름>`을 실행한다.

작성된 예제는 `examples/dev-team`에 있다. 의존성 없는 Node 프로젝트에서 `node --test`로 작업하는 `developer` 한 명으로 구성된 팀이다. `setup` skill은 이 디렉터리를 설치하지 않는다. 사용하려면 그 디렉터리의 `README.md`에 적힌 순서대로 프로젝트에 직접 추가한다.

### 3. 작업 요청

창구(평소의 Claude Code 세션)에 요청하면 `AGENTS.md`의 규모별 라우팅 규칙에 따라 처리된다.

| 요청 | 처리 경로 |
| --- | --- |
| 단순 질문, 파일 하나의 작은 수정 | 창구가 직접 처리한다 |
| 새 요구사항 | PM이 항목화하고 Planner가 요구사항을 검토한다 |
| 명시한 백로그 ID / 한 phase 위임 | 지정 ID는 Planner에게 바로 넘긴다. 위임하면 PM이 묶음을 선정한다 |
| 승인된 실행 팀 배정 | 팀장 ON이고 단순 Task 1개면 직접 배정 가능, 2개 이상 또는 전문 분해 1개면 팀장 경유, 팀장 OFF면 대기 |

## 설치되는 파일

```
AGENTS.md, CLAUDE.md             공통 지침과 라우팅
.claude/
  agents/                        기본 에이전트 6개
  skills/                        coordinator, team-lead, plan-orchestrate, phase-planning,
                                 backlog-management, qa-verification, change-review, harness-retro,
                                 docs-management, requirements-write, product-review, team-qa,
                                 dag-swimlane, waterfall-timeline
  hooks/                         승인, 대기, 컨텍스트 압축, 워커 규칙 주입, 브라우저 비밀값 차단
  scripts/                       워커 실행, 모델 배정표, 리포트 판정, 대기 규약 비교, 코디네이터 설정, 브라우저 런처
  settings.json                  hook 등록, permissions, 브라우저 병렬용 env 두 줄 (기존 파일에는 항목만 병합한다)
  front-desk.settings.json       직접 여는 세션에서 그 env 두 줄을 끄는 설정
  coordinator.keep.json          코디네이터에서 활성화할 플러그인과 skill의 allowlist
docs/
  backlog.md, backlog-archive.md
  DOCUMENTATION_INDEX.md         제품 문서 색인
  CODEBASE_MAP.md, 01-… ~ 12-…   setup이 준비하는 초안 13개
  harness/                       모델 배정표, 팀 구성표, changelog, 하네스 템플릿
    templates/product-docs/      라이브 문서 양식 12개
.agents/skills/                  Codex용 포인터 (Codex 사용을 선택했을 때만)
```

플러그인을 설치한 뒤 대상 프로젝트에서 `/orca-teamagent-harness-kit:agent-toggle`을 실행하면 에이전트 토글과 실시간 팀 구조도가 열린다. [스킬 안내](skills/agent-toggle/SKILL.md)

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
