# orca-teamagent-harness-kit

**한국어** | [English](README.en.md)

**Orca 기반 멀티 에이전트 하네스를 새 프로젝트에 한 번에 설치하는 Claude Code 플러그인.**

창구는 실행 승인 전까지 `product-manager` 한 세션에 기획을 맡기고, 승인 뒤에는 코디네이터가 계획의 Task를 지식 단위 에이전트에게 직접 배정한다. 설치용 `setup`과 에이전트·스킬 구성용 `agent-author`를 제공한다. 프로젝트용 파일은 `template/`에, 선택 설치하는 Codex 파일은 `template-codex/`에 있다.

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
  ├── product-manager         PM. 요구·백로그·설계·계획 (스킬)
  └── 코디네이터 (실행 승인 뒤)
        ├── research              조사. 세션 안 서브에이전트로 나눠 조사
        ├── frontend              UX · UI · 개발 · 테스트 코드 (스킬)
        ├── backend               데이터베이스 · 백엔드 · 성능 · 보안 (스킬)
        ├── verifier              코드 리뷰 · QA(유닛 테스트, 브라우저 확인) (스킬)
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

설치가 끝나면 창구 세션에 작업을 요청한다. 에이전트에 더할 스킬과 새 에이전트는 `setup`의 7단계에서 고르고, 나중에는 `agent-author`로 더한다([에이전트와 스킬 추가](#에이전트와-스킬-추가)).

## 특징

**지식 단위 에이전트**

역할을 직함대로 잘게 나눈 에이전트와 그 위의 관리 계층 대신, 지식이 공유돼야 하는 단위마다 에이전트 하나를 둔다. 전문성은 에이전트를 늘려서가 아니라 그 에이전트가 필요할 때 읽는 스킬로 준다. 근거는 Anthropic의 [When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)(2026-10-22)다. 팀이나 문제 유형마다 서브에이전트를 주면 에이전트 구조가 조직도의 사본이 되고, 스킬을 가진 에이전트 하나가 서브에이전트 설계보다 품질이 좋은 경우가 많았고 비용과 지연도 낮았다는 글이다. PM의 방법(요구사항 정리, 분해와 복잡도, RICE, 기획 검토)은 [revfactory/harness-100의 46-product-manager](https://github.com/revfactory/harness-100/tree/main/ko/46-product-manager)(Apache-2.0)에서 가져와 이 키트의 규칙에 맞게 다시 썼다.

- 기획은 `product-manager` 한 세션이 잇는다. 요구사항 정리, 요구사항 검토, 백로그 항목화, 설계, 계획, 계획과 수락 기준의 대조를 같은 컨텍스트에서 한다.
- 백로그 항목 하나는 만드는 에이전트 하나(`frontend` 또는 `backend`)가 처음부터 끝까지 맡는다. 세부 설계, 구현, 테스트 코드를 같은 컨텍스트에서 한다. 인계는 두 번이다. 계획에서 만드는 에이전트로, 만드는 에이전트에서 `verifier`로.
- `verifier`는 코드를 읽는 검토(`change-review`)와 실행해서 하는 검증(`qa-verification`)을 스킬로 나눠 갖는다. 만든 쪽의 판단을 물려받지 않는다.
- `research`는 질문을 서로 독립인 하위 질문으로 나눠 세션 안의 서브에이전트에 병렬로 맡기고, 출처를 확인한 리포트 하나를 돌려준다. 일을 나눠 맡기는 팬아웃은 `research`만 한다.
- 기본은 기존 에이전트에 스킬을 더하는 것이다. 에이전트를 새로 만드는 것은 세 기준 가운데 하나가 사실일 때뿐이다: 기존 에이전트에 넣으면 컨텍스트가 불어나 성능이 떨어지는 것이 관찰됐다, 다른 일과 병렬로 돌고 끝나면 그 컨텍스트를 버려도 된다, 도구나 지시가 기존 에이전트의 것과 부딪친다. 직함이 다르다는 것은 이유가 아니다.

**역할 계층과 요청 규모별 라우팅**

- 팀이 없다. 코디네이터 아래의 에이전트는 모두 같은 층이고 Orca 워커를 띄우지 않으며, 워커는 commit하지 않는다.
- 승인된 계획의 Task는 코디네이터가 명단(`docs/harness/agents.md`)의 에이전트에게 직접 배정한다. 같은 에이전트를 편집 범위가 겹치지 않는 일 단위마다 하나씩 띄울 수 있다. 에이전트가 OFF이면 그 에이전트의 배정은 대기한다.

**phase 진행과 승인**

```
새 요구 · 지정 백로그 ID · 한 phase 위임 → 설계·계획 → 실행 승인 → 실행·QA → 완료 처리 → 하네스 회고 → commit과 PR 승인
```

- 새 요구는 PM이 PRD·SRS·백로그에 반영하고, 같은 세션에서 누락과 실행 가능성을 검토한다. 사용자가 전체 반영 여부와 이번 묶음을 확인한 뒤 같은 세션이 설계·계획으로 잇는다. 지정 ID는 PM이 바로 설계한다. 두 경로 모두 설계와 실행 계획을 승인받는다.
- 한 phase를 위임하면 PM이 목표·항목·선정 이유를 정하고 같은 세션에서 계획까지 잇는다. 사용자는 최종 실행 승인에서 묶음과 예상 그림을 함께 확인한다. 시작 전에는 대기 상태 DAG와 T+ 예상 워터폴을, 승인 뒤에는 같은 Run의 진행 상황을 본다.
- 설계 문서와 구현 계획은 PM이 superpowers의 `brainstorming`, `writing-plans` 형식으로 작성한다. 설계에 출처를 모아야 하는 질문이 있으면 창구가 설계 전에 `research`를 띄운다.
- 회고는 측정 표에 실패나 재시도가 있거나 수정 라운드가 2에 닿았거나 마지막 회고 뒤 phase가 5번 지났을 때 띄운다. 아니면 `skip`으로 닫고, 측정 표는 코디네이터가 매번 남긴다. 띄웠는데 고칠 근거가 없으면 측정 결과와 "변경 없음"만 기록한다. 조건은 coordinator 스킬이 정한다.
- 제품의 사실을 바꾼 에이전트는 같은 Task 안에서 자기가 담당하는 문서를 고친다. `doc-steward`는 코드·테스트와 대조해 색인과 연결을 정리하고, 내용 결함은 담당 에이전트에게 돌려보낸다.

**기본 제공 역할**

| 에이전트 | 담당 | 스킬 |
| --- | --- | --- |
| `product-manager` | 요구사항 정리와 검토, PRD·SRS, 백로그 항목화·우선순위·묶음 선정, 설계, 계획과 DAG, 계획 대조, 백로그 정산 | `requirements-write`, `backlog-management`, `product-review`, `phase-planning`, `plan-orchestrate`, `docs-management` |
| `research` | 읽기 전용 조사. 하위 질문을 세션 안 서브에이전트에 병렬로 맡기고 조사 리포트 하나를 돌려준다 | `research`, `docs-management` |
| `frontend` | 화면 하나의 UX·UI 설계, 프론트엔드 개발, 테스트 코드 | `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `docs-management` |
| `backend` | 데이터베이스, 백엔드 개발, 성능, 보안 | `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `docs-management` |
| `verifier` | 중간 변경 리뷰(읽기), 영역별 끝 검증(읽기와 실행), 재검 | `change-review`, `qa-verification`, `docs-management` |
| `doc-steward` | 장부의 `## 라이브 문서 확인`에 행이 있을 때 QA 뒤 제품 문서 정합성 확인, 색인과 연결 관리 | `docs-management` |
| `harness-engineer` | 조건이 맞을 때 문서 확인 뒤 회고와 근거 있는 하네스 개선 | `harness-retro`, `docs-management` |

명단의 원본은 `docs/harness/agents.md`다. `frontend`와 `backend`의 스킬 여덟 개는 이름과 틀만 깔린다. `setup`의 7단계가 `agent-author`의 "스킬 본문 채우기"로 프로젝트의 기술과 지난 작업을 보고 채우고, 두 에이전트의 편집 범위도 그때 정한다.

**규칙을 강제하는 hook과 스크립트**

| 구성 요소 | 역할 |
| --- | --- |
| `approval-gate` hook | 사용자 승인이 필요한 명령(배포, push 등)을 비대화형 세션에서 차단하고 `ask`로 에스컬레이션하게 한다. force push는 프로젝트 설정과 무관하게 항상 승인 대상이다. 무조건 막지 않고 사용자에게 묻는다 |
| `orca-wait-gate` hook | 대기 명령(`orca-launch.mjs wait`)을 거치지 않고 직접 건 `check --wait` 가운데 셸 `&`로 실행한 것, `--timeout-ms`나 `--types`가 빠진 것, 다른 명령과 한 줄에 묶어 백그라운드로 건 것을 차단한다 |
| `compact-gate` hook | 코디네이터가 tool call을 연속 실행하는 중이면 자동 컨텍스트 압축을 다음 턴 경계로 미룬다 |
| `worker-intake-context` hook | 워커가 시작될 때 워커용 규칙을 컨텍스트에 주입한다 |
| `secret-gate` hook | Playwright MCP 입력에 쿠키, 토큰, 비밀번호가 들어가거나 쿠키를 읽으려 하면 차단한다. 넣은 값이 대화 기록에 남는 것을 막는다 |
| `orca-launch.mjs` | 실행 Run에서 승인된 Task 배정으로 워커를 기동하고 탭에 역할·모델·effort를 표시한다. 의존 관계 등록, 준비된 Task 조회, 결정 대기, 실패 처리, 재시도를 지원한다. `skip` 명령은 `conditional: true`인 Task나 `rounds`의 수정·재검 Task를 워커 없이 닫는다 |
| `tree-snapshot.mjs` | 작업 폴더 전체를 실제 인덱스와 작업 트리를 건드리지 않고 트리로 찍고(`take`), 두 트리의 변경 파일을 낸다(`diff`) |
| `defect-ledger.mjs` | 리포트의 `## 결함` 표를 장부의 `## 결함 원장`에 옮긴다. 증거가 없는 High는 Medium으로 기록하고, 이미 있는 행은 다시 쓰지 않는다 |
| `model-selection.mjs` | 모델 배정표를 검증한다 (존재하지 않는 에이전트, 중복 행, 지원하지 않는 조합) |
| `report-check.mjs` | 워커 리포트의 `## 검증` 섹션을 판정하고, 그 Task의 산출물 파일이 실제로 있는지 확인한다 |
| `test-ledger.mjs` | 전체 테스트의 결과 JSON(vitest, jest)을 테스트 케이스 장부의 최근 결과와 추적표의 `구현됨`·`검증됨`에 옮긴다. 실행 결과에 없는 케이스는 그대로 두고 목록으로 낸다 |
| `coordinator-settings.mjs` | allowlist를 읽어 코디네이터 전용 설정 파일을 생성한다 |
| `browser/launch.cjs`, `browser/probe-fps.cjs` | 화면 캡처, 3D·WebGL 실측, 로그인이 필요한 검증을 Playwright MCP 밖에서 돌리는 런처와 GPU 실측 스크립트. 비밀값은 dotenv 파일에서만 읽고 로그에서 가린다 |

스크립트와 hook은 Node 내장 모듈만 사용하고, 각각 self-test(`*.check.mjs`)를 갖는다. 브라우저 런처만 예외로 Playwright를 쓴다(프로젝트에 설치된 것, 없으면 Playwright MCP가 받아 둔 복사본).

## 특장점

**코디네이터의 토큰 사용량을 줄인다**

- 코디네이터는 플러그인과 skill을 최소로 활성화한 전용 설정으로 실행된다. 활성화할 항목은 `.claude/coordinator.keep.json`에서 사용자가 직접 지정한다.
- 코디네이터는 heartbeat, 재배달, 타임아웃에 깨어나지 않는다. 대기는 `orca-launch.mjs wait` 하나를 백그라운드 작업으로 걸고, 이 명령은 처리할 메시지가 올 때만 끝난다. `worker_done`의 정산(네 가지 확인, 실패 처리, 결함 원장, 스냅샷)도 `orca-launch.mjs settle` 한 명령이다.
- 코디네이터는 워커 리포트의 전문을 읽지 않고 워커의 테스트를 다시 실행하지도 않는다. 리포트 판정 스크립트의 결과만 확인한다.
- 코디네이터는 계획 승인 후 새 세션으로 실행된다. 설계 단계에서 로드한 skill이 컨텍스트에 남지 않는다.

**Task 순서와 결정 대기를 Orca가 강제한다**

- 코디네이터는 자신의 실행 Run에 계획의 Task를 의존 관계와 함께 등록한다. 선행 Task가 끝나기 전에는 Orca가 실행을 거부한다.
- 사용자 결정이 필요한 Task는 게이트로 막고, 결정을 받은 뒤에 푼다. 선행 Task가 아직 끝나지 않았으면 스크립트가 다시 대기 상태로 되돌린다.
- 워커가 성공을 보고했더라도 리포트 판정이 실패하면, 스크립트가 그 Task를 실패로 되돌리고 후속 Task를 다시 묶은 뒤 같은 Task를 재시도한다.
- Task 상태의 기준은 Orca다. 장부에는 Orca가 갖지 않는 정보(적용된 모델, 재시도 원인, 질문, 리포트 경로)만 기록한다.
- 워커는 Run을 따로 만들지 않는다. 실행 승인 뒤의 워커는 모두 코디네이터의 실행 Run에 들어간다.

**모델과 effort를 표 하나로 관리한다**

- 점수는 에이전트가 아니라 Task에 붙는다. PM은 BL에 구조 복잡도·불확실성·실패 영향·검증 근거를 남기고, 계획에서 Task마다 C·U·R·V의 값과 근거를 적는다. `model-routing.mjs plan`이 model과 effort를 계산하고, 해석에 따라 배정이 달라질 때만 Haiku로 점수를 확인한다. 사용자는 DAG에서 추천을 검토하고 직접 고정하거나 기동 직전 재평가를 위임한다. 코디네이터는 승인된 런타임과 치환표에서 최종 배정을 적용한다.
- 모델 표에서 model이 `복잡도`인 산정 행의 Task는 점수 없이 뜨지 않는다. 기동 스크립트는 기본값으로 넘어가지 않고 거부한다. 계획 밖에서 띄우는 워커(설계 전의 `research` 등)는 `--assessment`로 점수를 함께 넘긴다.
- PM의 기획 세션은 `setup`에서 고른 model과 effort 하나로 뜬다(기본 fable/xhigh). 요구에서 계획까지 한 세션이 이 값으로 잇는다. [배정 기준과 Astra ultra 치환](template/docs/harness/model-selection.md)
- 표를 수정하면 다음 계획부터 적용된다. 현재 Run의 Task 배정을 바꾸려면 해당 배정과 DAG를 갱신하고 다시 승인받는다.

**검증이 수렴한다**

- 수정 대상은 High와 완료 기준 미달뿐이다. Medium 이하는 인박스로 넘긴다.
- 구현이 끝나면 코디네이터가 전체 테스트를 한 번 돌린다. 실패는 그 코드를 만든 에이전트의 시험 갱신 Task가 받고, 끝 검증은 전체 테스트를 다시 돌리지 않는다.
- 수정은 결함마다 재현 테스트를 남기고, 수정 뒤에는 코디네이터가 바로 최종 테스트를 돌려 그 테스트로 확인한다. 재검증은 재현 테스트가 없는 결함만 그 결함의 재현 여부를 확인한다. 재검증 중에 새로 찾은 High도 남은 High로 센다. fix loop는 최대 2회이고, 그 뒤에도 High가 남아 3회째가 필요해지면 중단하고 사용자에게 묻는다.
- 구현한 에이전트가 자신의 결과를 승인하지 않는다. 구현 Task는 테스트를 먼저 작성한다(TDD).
- 끝 검증은 영역마다 `verifier` Task 하나가 코드 읽기와 실행을 함께 하고, 영역별 워커가 동시에 돈다. 브라우저를 쓰는 검증도 같다. `.claude/settings.json`의 `PLAYWRIGHT_MCP_ISOLATED`, `PLAYWRIGHT_MCP_HEADLESS` 두 줄이 워커마다 브라우저를 따로 띄우게 한다.
- 이 두 줄은 프로젝트의 모든 세션에 적용된다. 직접 여는 세션(창구 포함)에서 창이 보이고 로그인 상태가 유지되는 브라우저를 쓰려면 `claude --settings .claude/front-desk.settings.json`으로 연다.
- 혼자 써야 하는 자원(GPU, Blender MCP 등)을 쓰는 검증은 나누지 않는다. 구현 Task는 그 자원 없이 도는 간단한 코드 테스트로 끝내고, 그 자원을 쓰는 검증은 구현이 모두 끝난 뒤 Task 하나가 한 번 돌린다.

**승인 절차를 우회할 수 없다**

- 대화형 세션에서는 `permissions.ask`가 확인을 요청하고, 비대화형 세션에서는 hook이 차단한다. 권한 모드와 무관하게 이중으로 적용된다.
- 템플릿은 사용자 대신 에이전트나 모델을 결정하지 않는다. 결정이 필요하면 문서의 "사용자 결정 필요" 목록으로 넘긴다.

**문서가 무분별하게 늘어나지 않는다**

- 작업 디렉터리는 `_workspace/<작업 폴더>/<phase>/`이고 `.gitignore`로 제외한다. 파일 이름은 `NN_<에이전트>_<산출물>_v1.md` 형식 하나로 통일한다.
- 같은 규칙을 두 곳에 두지 않는다. 모델 배정표와 에이전트 명단은 각각 단일 원본(single source of truth) 파일을 갖고, 판단이 없는 절차(대기, 정산)는 지침이 아니라 스크립트에 둔다.
- 작업 리포트는 이력이다. 라이브 문서의 첫 작성과 후속 수정은 그 문서·절을 담당하는 에이전트가 맡는다. 모든 에이전트가 `docs-management`로 자기 문서를 쓰고, PM은 PRD·SRS를 쓰고, `doc-steward`는 색인과 정합성을 확인한다. 담당자가 없으면 역할 생성, 나중에 배정, 해당 없음 중 사용자가 선택한다.
- 새 설치는 `docs/harness/templates/product-docs/`의 양식 12개로 코드 지도와 12개 번호 폴더의 초안 13개를 준비한다. 기존 색인이 가리키는 정본과 편집한 내용은 보존한다.

**Claude와 Codex를 함께 사용한다**

- 공통 규칙은 `AGENTS.md` 하나에 둔다. `CLAUDE.md`는 `@AGENTS.md`를 import하고, Codex용 skill은 Claude용 원본을 참조하는 포인터다.
- Codex를 사용하지 않으면 설치할 때 Codex 관련 파일을 제외한다.

**재실행해도 안전하다 (idempotent)**

- `setup` skill은 내용이 같은 파일은 건너뛰고, 내용이 다른 기존 파일은 diff를 보여 준 뒤 승인받은 파일만 덮어쓴다. 설치 후 사용자가 수정한 파일도 덮어쓰지 않는다.
- `.claude/settings.json`과 `.gitignore`는 덮어쓰지 않고 항목만 병합한다.

## 환경 구성

### 기본 환경 (필수)

**Orca + Superpowers + TeamAgent Harness**, 이 세 가지가 기본 환경이다. Orca가 워커를 실행하고, Superpowers가 설계와 계획의 형식을 제공하고, 이 키트가 그 위에 에이전트 구조와 규칙을 올린다.

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
2. **질문 5개**: Codex 사용 여부, 사용자 승인이 필요한 명령, 코디네이터 터미널의 권한 모드, PM의 model과 effort(기본 fable/xhigh), 코디네이터에서 활성화할 플러그인과 skill.
3. **설치**: 내용이 같은 파일은 건너뛰고, 내용이 다른 기존 파일은 diff를 보여 준 뒤 승인받은 파일만 덮어쓴다.
4. **설정 생성**: allowlist `.claude/coordinator.keep.json`을 수정하고 코디네이터 설정 파일을 생성한다.
5. **검증**: 설치된 self-test와 모델 배정표 검증을 실행한다.
6. **기반 설계**: 프로젝트의 검증 명령을 실제로 실행해 통과한 것만 지침에 기록하고, 금지 명령(`permissions.deny`), 문서 라우팅, 토큰 기준선을 정한다.
7. **에이전트 단위 구성**: 지난 세션 기록과 기존 파이프라인을 분석해 기존 에이전트에 더할 스킬, 기본 에이전트의 이름·스킬·편집 범위 바꾸기, 새 에이전트를 근거와 함께 추천하고, 사용자가 고른 대로 만들어 에이전트 명단과 모델 배정표에 올린다. 틀만 있는 스킬의 본문을 채운다. 0.5.1 프로젝트이면 옛 역할을 먼저 옮긴다.
8. **모델 표**: 모델 배정표의 모든 행을 설문 페이지(Artifact)로 띄우고, 사용자가 저장한 값만 표에 반영한다.
9. **결과 보고**: 설치한 파일, 건너뛴 파일, 실패한 검증, 기반 설계 결과, 더한 스킬과 만든 에이전트, 다음 단계.

Orca를 사용하지 않는 프로젝트에서는 1, 6, 9단계만 실행한다(템플릿은 설치하지 않는다).

재실행하면 누락된 파일만 추가하고 검증을 다시 실행한다. 0.5.x를 쓰던 프로젝트는 [0.5.x에서 올리기](#05x에서-올리기)를 먼저 읽는다. 스크립트를 직접 호출할 수도 있다.

```sh
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" inspect --target .
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" install --target . --answers <응답 파일> [--approve <경로,...>]
node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" verify --target .
```

### 2. 프로젝트 설정

- `AGENTS.md`의 "명령"과 "기술 스택" 섹션을 작성한다. 명령은 실제로 실행해 확인한 것만 적는다.
- 모델 배정표 `docs/harness/model-selection.md`를 조정한다. 들어 있는 값은 기본값이다.
- `frontend`와 `backend`의 스킬은 틀만 깔린다. `setup`의 7단계에서 채우지 않았으면 나중에 `agent-author`로 채운다. 명단에서 두 에이전트의 편집 범위가 `프로젝트가 정한다`로 남아 있으면 그때 실제 경로를 정한다.

### 에이전트와 스킬 추가

설치 후 `/orca-teamagent-harness-kit:agent-author`로 세 가지를 한다. 기존 에이전트에 스킬 더하기(기본), 틀만 있는 스킬의 본문 채우기, 새 에이전트 만들기(세 기준 가운데 하나가 사실일 때만)다. 기존 역할과 원문을 조사해 필요한 전문 판단, 협업 상대, 미배정 문서·절을 제안한다. 사용자가 선택한 범위를 역할 정의, 명단, 모델 표에 기록한다. [에이전트 제작 스킬](skills/agent-author/SKILL.md)

직접 스킬을 더할 때는 아래 순서로 한다.

1. 스킬 양식 `docs/harness/templates/skill.md`를 `.claude/skills/<스킬>/SKILL.md`로 복사해 작성한다.
2. 그 에이전트의 역할 파일 `.claude/agents/<에이전트>.md`의 `- 로드할 스킬:` 줄과 `## 작업 단위와 스킬` 표, 명단 `docs/harness/agents.md`의 스킬 칸에 같은 이름을 넣는다.
3. 새 작업 단위가 생기면 `docs/harness/model-selection.md`에 그 단위의 산정 행(model `복잡도`)을 추가한다.
4. `node .claude/scripts/agent-definition.mjs --agent <에이전트>`와 `node .claude/scripts/model-selection.mjs check`를 실행한다.

새 에이전트는 에이전트 양식 `docs/harness/templates/agent.md`를 `.claude/agents/<이름>.md`로 복사해 작성하고, 명단에 한 행(`| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |`)과 모델 표의 산정 행을 함께 더한 뒤 같은 두 검사를 실행한다.

Codex를 함께 쓰면 새 스킬마다 같은 이름의 포인터 `.agents/skills/<스킬>/SKILL.md`를 만들고, 고친 역할별로 `node "<플러그인 디렉터리>/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <이름>`을 실행한다.

작성된 예제는 `examples/dev-team`에 있다. 의존성 없는 Node 프로젝트에서 `node --test`로 일하는 `frontend`와 `backend`의 스킬 `frontend-dev`, `backend-dev`를 채우고 명단의 편집 범위를 정한 본보기다. `setup` skill은 이 디렉터리를 설치하지 않는다. 사용하려면 그 디렉터리의 `README.md`에 적힌 순서대로 프로젝트에 직접 넣는다.

### 3. 작업 요청

창구(평소의 Claude Code 세션)에 요청하면 `AGENTS.md`의 규모별 라우팅 규칙에 따라 처리된다.

| 요청 | 처리 경로 |
| --- | --- |
| 단순 질문, 파일 하나의 작은 수정 | 창구가 직접 처리한다 |
| 새 요구사항 | PM이 항목화하고 같은 세션에서 요구사항을 검토한다 |
| 명시한 백로그 ID / 한 phase 위임 | 지정 ID는 PM이 바로 설계한다. 위임하면 PM이 묶음을 선정한다 |
| 승인된 계획의 Task | 코디네이터가 그 Task의 에이전트에게 직접 배정한다. 에이전트가 OFF면 대기 |

## 설치되는 파일

```
AGENTS.md, CLAUDE.md             공통 지침과 라우팅
.claude/
  agents/                        기본 에이전트 7개
  skills/                        coordinator, plan-orchestrate, phase-planning, requirements-write,
                                 backlog-management, product-review, research, change-review,
                                 qa-verification, docs-management, harness-retro, dag-swimlane,
                                 waterfall-timeline, frontend-ux, frontend-ui, frontend-dev,
                                 frontend-test, backend-db, backend-dev, backend-performance,
                                 backend-security (frontend-*와 backend-*는 틀)
  hooks/                         승인, 대기, 컨텍스트 압축, 워커 규칙 주입, 브라우저 비밀값 차단
  scripts/                       워커 실행·대기·정산, 모델 배정표, 리포트 판정, 코디네이터 설정, 브라우저 런처
  settings.json                  hook 등록, permissions, 브라우저 병렬용 env 두 줄 (기존 파일에는 항목만 병합한다)
  front-desk.settings.json       직접 여는 세션에서 그 env 두 줄을 끄는 설정
  coordinator.keep.json          코디네이터에서 활성화할 플러그인과 skill의 allowlist
docs/
  backlog.md, backlog-archive.md
  DOCUMENTATION_INDEX.md         제품 문서 색인
  CODEBASE_MAP.md, 01-… ~ 12-…   setup이 준비하는 초안 13개
  harness/                       모델 배정표, 에이전트 명단, changelog, 하네스 템플릿
    templates/product-docs/      라이브 문서 양식 12개
.agents/skills/                  Codex용 포인터 (Codex 사용을 선택했을 때만)
```

플러그인을 설치한 뒤 대상 프로젝트에서 `/orca-teamagent-harness-kit:agent-toggle`을 실행하면 에이전트 토글과 실시간 에이전트 구조도가 열린다. [스킬 안내](skills/agent-toggle/SKILL.md)

## 0.5.x에서 올리기

0.6.0은 명단 형식이 바뀌어 0.5.x와 호환되지 않는다. 옛 명단을 같이 읽는 코드는 없고, 0.5.x 프로젝트는 `setup`을 다시 돌리고 `agent-author`의 "0.5.1 프로젝트 옮기기"로 새 구조로 옮긴다.

1. **진행 중인 phase는 0.5.1에서 끝낸다.** 0.5.1에서 승인받은 phase는 새로 띄운 코디네이터가 이어 가지 못한다. 기동은 두 메시지 가운데 하나로 멈춘다. 옛 DAG에 `members`가 있는 노드가 있으면 검토가 먼저 `<노드 ID>의 팀 내부 배정(members)은 없어졌습니다. 일마다 Task 하나로 나눠 다시 그리세요`로 멈추고, 없으면 승인 기록의 해시가 달라 `현재 계획·DAG와 실행 승인 버전이 다름`으로 멈춘다. 끝내지 못했으면 올린 뒤 계획을 다시 승인받는다. phase 중간에 올리지 않는다.
2. **작업 트리를 커밋해 둔다.** 옮기기는 프로젝트 파일을 지운다. 되돌릴 때는 그 커밋으로 돌아간다.
3. **플러그인을 올리고 `setup`을 다시 돌린다.** `docs/harness/agents.md`가 없는 동안, 곧 `setup`을 다시 돌리기 전에는 스크립트가 `docs/harness/agents.md가 없고 옛 명단(team-org.md)만 있습니다. setup을 다시 돌려 새 구조로 옮기세요.`로 멈춘다. 다시 돌린 뒤에는 `agent-author`의 옮기기가 남아 있어도 스크립트가 돈다.
   - 응답 파일의 `planner.effort`는 `pm.model`과 `pm.effort`로 바뀌었다(기본 fable/xhigh). 옛 키가 있으면 설치가 거절한다.
   - 키트가 깔았고 프로젝트가 고치지 않은 물러난 파일(`team-lead`·`team-qa` 스킬, `team-skill.md`, 역할 `planner`·`code-reviewer`·`qa-inspector`와 그 Codex 정의)을 지운다. 프로젝트가 고쳤거나 설치 기록에 없는 물러난 파일은 충돌로 보이고 `install --approve <경로>`로 승인했을 때만 지운다.
   - 새 명단 `docs/harness/agents.md`와 새 기본 에이전트를 깐다. `docs/harness/team-org.md`는 남는다.
   - 0.6.0에서 내용이 바뀐 키트 파일(스크립트, 스킬, `AGENTS.md`, 기본 역할 파일 등)은 프로젝트가 고치지 않았어도 충돌로 보이고 설치가 코드 2로 끝난다. diff를 보고 승인한 경로만 `install --approve <경로,...>`로 덮어쓴다. 승인하기 전에는 그 파일이 0.5.1 판으로 남는다.
   - 설치된 뒤 프로젝트가 고친 키트 파일(예: 옛 `product-manager.md`)은 `사용자가 고침`으로 건너뛰고 `--approve`로도 덮어쓰지 않는다. 0.5.1 판으로 남으므로 `agent-author`의 "0.5.1 프로젝트 옮기기" 5단계대로 손으로 옮긴다. 모델 표(`## 배정 표`를 0.6.0 틀의 행으로 다시 짜고 `setup`에서 고른 PM 값을 넣는다), `AGENTS.md`(`## 하네스` 절을 틀의 것으로 바꾼다), 고친 기본 역할 파일, 고친 `docs/DOCUMENTATION_INDEX.md`가 여기에 든다. 모델 표의 PM 행이 고른 값과 다르면 설치 출력의 `notices`에 나오고, 옮기기 전에는 `verify`가 모델 표에 행이 없는 에이전트를 실패로 적는다. 설치된 뒤 프로젝트가 지운 기본 에이전트의 역할 파일은 다시 깔지 않고, 그 밖의 빠진 키트 파일은 다시 깐다.
4. **프로젝트가 만든 역할은 `agent-author`의 "옮기기"로 합친다.** `setup`의 7단계가 이 절차를 부른다. 역할마다 어느 지식 단위에 합칠지 따로 남길지를 추천받아 고르고, 그 지식을 단위의 스킬로 옮긴다. 마지막에 옛 역할 파일, 옛 팀 스킬, 옛 역할의 꺼진 사본(`*.md.agent-toggle-off`), `docs/harness/team-org.md`를 지운다.

바뀐 명령과 형식:

- 계획의 DAG 노드에 `members`가 없다. 기동 스크립트에 `--lead`, `--parent`, `--complexity`가 없다.
- 모델 표의 산정 행은 점수가 있어야 뜬다. Run 밖에서 띄우는 워커(설계 전의 `research` 등)는 `--assessment <JSON>`으로 점수를 넘긴다.
- 사용자 범위에 설치한 `agent-toggle` 스킬은 `integrations/agent-toggle/agent-toggle.patch`로 이 버전에 맞춘다. 그 스킬 폴더에서 `git apply`로 적용한다.

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
