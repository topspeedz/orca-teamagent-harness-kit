# orca-teamagent-harness-kit

**Orca 위에서 여러 AI 에이전트를 팀으로 굴리는 하네스를, 새 프로젝트에 한 번에 까는 Claude Code 플러그인.**

창구, 코디네이터, 팀장, 팀원의 계층과 그 계층이 지킬 규칙(대기, 승인, 모델 배정, 검증, 문서)을 스킬, 훅, 스크립트, 양식으로 묶었다. 플러그인은 세팅 스킬 `setup` 하나만 내놓고, 프로젝트에 깔리는 파일은 `template/` 아래에 프로젝트 안의 경로 그대로 들어 있다.

```
사용자
  │
창구 (사용자 세션)            설문과 승인, 요청 분류, 최종 보고
  ├── planner                설계서와 계획서, DAG
  └── 코디네이터 (별도 터미널)  워커 기동, 보고 정산, 장부 갱신, 커밋과 PR
        ├── 팀장 ── 팀원 ×N
        ├── 팀장 ── 팀원 ×N
        └── 검증 팀장 ── QA, 코드 리뷰
```

## 빠른 시작

```sh
# 1. 플러그인 설치
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. 하네스를 깔 프로젝트의 루트에서 Claude Code를 열고
/orca-teamagent-harness-kit:setup
```

세팅이 끝나면 팀을 하나 추가하고([팀을 추가하는 방법](#팀을-추가하는-방법)) 창구 세션에 일을 요청한다.

## 특징

**역할 계층과 규모별 경로**

- 계층은 코디네이터 아래 두 단까지다. 팀원은 워커를 띄우지 않고, 워커는 커밋하지 않는다.
- 요청의 크기에 따라 경로가 갈린다. 작은 수정은 창구가 직접 하고, Task 1~2개는 코디네이터가 워커를 바로 띄우고, 3개 이상이면 팀장을 세우고, 요구사항이 흐릿한 큰 작업은 설문부터 시작한다.

**한 phase의 정해진 흐름**

```
1 설문 → 2 설계 ✋ → 3 계획 ✋ → 4 백로그 반영 → 5 실행 → 6 완료 처리 → 7 하네스 회고 → 8 커밋과 PR ✋
```

- ✋는 사용자 승인이다. 설계와 계획 승인 때는 DAG 스윔레인과 워터폴 타임라인 그림을 함께 보여 준다.
- 설계서와 계획서는 superpowers의 `brainstorming`, `writing-plans` 형식으로 planner가 쓴다.
- 회고는 생략하지 않는다. 고칠 근거가 없으면 측정 결과와 "변경 없음"만 남긴다.

**처음부터 들어 있는 공통 역할**

| 팀 | 에이전트 | 맡는 일 |
| --- | --- | --- |
| (공용) | `planner` | 설계서, 계획서, DAG |
| 기획 | `product-manager` | 백로그, 수락 기준, 완료 처리 |
| 검증 | `qa-inspector` | 실행해서 찾는 검증 |
| 검증 | `code-reviewer` | 읽어서 찾는 검증 (읽기 전용) |
| 하네스 | `harness-engineer` | phase 끝의 회고와 하네스 개선 |

개발, 디자인 같은 도메인 팀은 넣지 않았다. 양식으로 직접 추가한다.

**규칙을 지키게 하는 훅과 스크립트**

| 장치 | 하는 일 |
| --- | --- |
| `approval-gate` 훅 | 사람 승인이 필요한 명령(배포, push 등)을 승인 없이 도는 세션에서 거부하고 `ask`로 올리게 한다. 강제 push는 `permissions.deny`가 어느 세션에서도 막는다 |
| `orca-wait-gate` 훅 | 대기 계약을 어긴 `check --wait`(셸 `&`로 띄운 것, `--timeout-ms`나 `--types`가 빠진 것)를 거부한다 |
| `compact-gate` 훅 | 코디네이터가 도구를 잇달아 쓰는 중이면 자동 압축을 다음 턴 경계로 미룬다 |
| `worker-intake-context` 훅 | 워커가 시작할 때 워커 쪽 규칙을 주입한다 |
| `orca-launch.mjs` | 모델 표를 조회해 워커를 띄우고, 탭 이름을 `[BL-0012] qa-inspector : opus/medium - 결제 흐름 검증` 형식으로 붙인다 |
| `model-selection.mjs` | 모델 표의 형식을 검사한다 (없는 에이전트, 중복 줄, 쓸 수 없는 조합) |
| `report-check.mjs` | 워커 리포트의 `## 검증` 절을 판정한다 |
| `wait-contract-check.mjs` | 세 스킬에 들어간 대기 계약이 정본과 같은지 대조한다 |
| `coordinator-settings.mjs` | 남길 목록을 읽어 코디네이터 전용 설정을 만든다 |

모든 스크립트와 훅은 Node 내장 모듈만 쓰고, 각자 셀프테스트(`*.check.mjs`)를 갖는다.

## 특장점

**코디네이터의 토큰을 아낀다**

- 코디네이터는 플러그인과 스킬을 최소로 켠 전용 설정으로 뜬다. 남길 것은 `.claude/coordinator.keep.json`에서 사용자가 직접 고른다.
- 코디네이터는 heartbeat마다 깨지 않는다. 대기는 백그라운드로 한 번만 걸고, 대기 계약 5줄과 훅이 이를 지키게 한다.
- 코디네이터는 워커의 리포트 전문을 읽지 않고 워커의 검사도 다시 돌리지 않는다. 리포트 판정 스크립트의 결과만 본다.
- 코디네이터는 계획 승인 뒤에 새 세션으로 뜬다. 설계 단계의 스킬이 컨텍스트에 남지 않는다.

**모델과 effort를 표 하나로 직접 설계한다**

- 에이전트와 작업 단위마다 한 줄을 `docs/harness/model-selection.md`에 적는다. planner는 model을 고르지 않고 작업 단위만 붙인다.
- 기동 스크립트가 spec의 배정 줄, 표, 넘긴 인자를 대조하고 서로 다르면 기동을 거부한다. 예외는 사용자의 지시 원문을 사유로 남길 때만 통한다.

**검증이 수렴한다**

- 고치는 것은 High와 완료 기준 미달뿐이다. Medium 이하는 인박스로 보낸다.
- 재검은 그 결함의 재현 확인만 한다. 수정 루프는 최대 2회이고, 그 뒤에도 High가 남으면 멈추고 사용자에게 보고한다.
- 구현한 에이전트가 자기 결과를 승인하지 않는다. 구현 Task는 테스트를 먼저 쓴다.

**승인이 뚫리지 않는다**

- 대화형 세션에서는 `permissions.ask`가 묻고, 승인 없이 도는 세션에서는 훅이 거부한다. 권한 모드와 상관없이 두 겹으로 걸린다.
- 틀은 사용자 대신 팀이나 모델을 정하지 않는다. 결정이 필요하면 문서의 "사용자 결정 필요" 목록으로 올린다.

**문서가 불어나지 않는다**

- 작업 폴더는 `_workspace/<팀>/<phase>/`이고 git에 올리지 않는다. 파일 이름은 `NN_<에이전트>_<산출물>_v1.md` 한 가지 형식이다.
- 같은 규칙을 두 곳에 적지 않는다. 대기 계약, 모델 표, 팀 명단은 각각 정본 파일이 하나다.

**Claude와 Codex를 함께 쓴다**

- 공통 규칙은 `AGENTS.md` 하나에 둔다. `CLAUDE.md`는 `@AGENTS.md`를 가리키고, Codex 쪽 스킬은 Claude 쪽 원본을 가리키는 포인터다.
- Codex를 쓰지 않으면 세팅할 때 Codex 부분을 깔지 않는다.

**다시 실행해도 안전하다**

- 세팅 스킬은 같은 내용은 건너뛰고, 내용이 다른 기존 파일은 차이를 보여 준 뒤 승인받은 것만 덮어쓴다. 깐 뒤에 사용자가 고친 파일도 덮어쓰지 않는다.
- `.claude/settings.json`과 `.gitignore`는 항목만 더한다.

## 환경 구성

| 항목 | 내용 |
| --- | --- |
| Orca | CLI 1.4.255에서 실측했다. 실행 절차의 정본은 `orca skills get orchestration`의 가이드다 |
| Claude Code | 플러그인 설치와 세팅 스킬 실행에 쓴다 |
| superpowers 플러그인 | `brainstorming`, `writing-plans` 스킬이 있어야 한다 |
| Node | 스크립트와 훅을 돌린다. 따로 설치할 패키지는 없다 |
| git | 대상 프로젝트가 git 저장소가 아니면 세팅 스킬이 알리고 계속할지 묻는다 |
| 운영 체제 | Windows와 Git Bash에서만 검증했다 |
| Codex | 함께 쓸 때만 필요하다. 세팅할 때 고른다 |

- 코디네이터는 100만 토큰 창 모델(`opus[1m]`)로 띄우는 것을 기본으로 한다. 압축 시작점 350,000과 상한 500,000이 이 창을 전제로 한다.
- `worker-start`로 뜨는 워커의 권한 모드는 명령 옵션으로 정할 수 없고 Orca의 "새 에이전트 탭" 설정을 따른다.
- 세팅 스킬은 빠진 전제를 알리기만 하고 대신 설치하지 않는다.

## 설치

GitHub에서 바로 설치한다.

```sh
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

또는 저장소를 받아 로컬 폴더를 마켓플레이스로 등록한다. 검증은 이 방식으로만 했다.

```sh
git clone https://github.com/topspeedz/orca-teamagent-harness-kit.git
claude plugin marketplace add "<받은 폴더의 경로>"
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

## 사용법

### 1. 세팅 스킬 실행

하네스를 깔 프로젝트의 루트에서 Claude Code를 열고 `/orca-teamagent-harness-kit:setup`을 실행한다(또는 "하네스 키트 세팅해줘"). 스킬은 여섯 단계로 진행한다.

1. **점검**: git, Orca, Node, superpowers, 전역 그림 스킬, Codex, 이미 있는 지침 파일을 확인한다.
2. **질문 다섯 개**: Codex 병용, 사람 승인이 필요한 행위, 코디네이터 터미널의 권한 모드, planner의 모델, 코디네이터에 남길 플러그인과 스킬.
3. **깔기**: 같은 내용은 건너뛰고, 내용이 다른 기존 파일은 차이를 보여 주고 승인받은 것만 덮어쓴다.
4. **생성**: 남길 목록 `.claude/coordinator.keep.json`을 고치고 코디네이터 설정을 만든다.
5. **검증**: 깔린 셀프테스트, 모델 표 검사, 대기 계약 대조를 돌린다.
6. **보고**: 깔린 것, 건너뛴 것, 실패한 검증, 다음 할 일.

다시 실행하면 빠진 것만 채우고 검증을 다시 돌린다. 스크립트를 직접 부를 수도 있다.

```sh
node "<플러그인 폴더>/skills/setup/scripts/setup.mjs" inspect --target .
node "<플러그인 폴더>/skills/setup/scripts/setup.mjs" install --target . --answers <답 파일> [--approve <경로,...>]
node "<플러그인 폴더>/skills/setup/scripts/setup.mjs" verify --target .
```

### 2. 프로젝트에 맞게 채우기

- `AGENTS.md`의 "명령"과 "기술 스택"을 채운다. 명령은 실제로 돌려 본 것만 적는다.
- 모델 표 `docs/harness/model-selection.md`를 손본다. 들어 있는 값은 시작값이다.
- 팀을 추가한다. 틀에는 구현 팀이 없어서 세팅 직후에는 구현 Task를 돌릴 수 없다.

### 팀을 추가하는 방법

세팅 스킬은 팀과 에이전트를 만들지 않는다. 팀은 양식 두 개와 명단 하나로 직접 추가한다.

1. 팀 스킬 양식 `docs/harness/templates/team-skill.md`를 `.claude/skills/team-<이름>/SKILL.md`로 복사해 채운다.
2. 에이전트 양식 `docs/harness/templates/agent.md`를 `.claude/agents/<이름>.md`로 복사해 채운다.
3. 명단 `docs/harness/team-org.md`에 팀 한 줄을 넣는다.
4. 모델 표 `docs/harness/model-selection.md`에 새 에이전트의 줄을 넣고 `node .claude/scripts/model-selection.mjs check`로 확인한다.

팀이 무엇인지는 명단이, 팀이 어떻게 일하는지는 팀 스킬이 소유한다.

채워진 본보기는 `examples/dev-team`에 있다. 의존성 없는 Node 프로젝트에서 `node --test`로 일하는 `developer` 하나로 된 팀이다. 세팅 스킬은 이 폴더를 깔지 않는다. 쓰려면 그 폴더의 `README.md`에 적힌 순서대로 프로젝트에 직접 넣는다.

### 3. 일 시키기

창구(평소의 Claude Code 세션)에 요청하면 `AGENTS.md`의 규모별 경로에 따라 갈린다.

| 요청 | 경로 |
| --- | --- |
| 단순 질문, 한 파일의 작은 수정 | 창구가 직접 한다 |
| 답이 정해진 작은 작업 (한 팀의 Task 1~2개) | 코디네이터가 팀장 없이 워커를 직접 띄운다 |
| 한 팀의 Task가 3개 이상이거나 나누는 데 도메인 판단이 필요 | 코디네이터가 팀장을 띄우고, 팀장이 팀원을 띄운다 |
| 요구사항이 흐릿한 큰 작업 | 설문부터 시작하는 전체 흐름(`plan-orchestrate` 스킬)을 탄다 |

## 프로젝트에 깔리는 것

```
AGENTS.md, CLAUDE.md             공통 지침과 라우팅
.claude/
  agents/                        공통 에이전트 5개
  skills/                        coordinator, team-lead, plan-orchestrate, phase-planning,
                                 backlog-management, qa-verification, change-review, harness-retro,
                                 team-product, team-qa, team-harness, dag-swimlane, waterfall-timeline
  hooks/                         승인, 대기, 압축, 워커 규칙 주입
  scripts/                       기동, 모델 표, 리포트 판정, 대기 계약 대조, 코디네이터 설정
  settings.json                  훅 등록과 권한 (기존 파일에는 항목만 더한다)
  coordinator.keep.json          코디네이터에 남길 플러그인과 스킬
docs/
  backlog.md, backlog-archive.md
  harness/                       모델 표, 팀 명단, 변경 이력, 양식 8개
.agents/skills/                  Codex용 포인터 (Codex 병용을 골랐을 때만)
```

## 검증하지 않은 환경

- macOS, Linux
- Git Bash 없이 PowerShell만 쓰는 환경
- Orca 1.4.255가 아닌 버전
- 로컬 폴더가 아닌 GitHub 마켓플레이스로 설치한 경우

## 키트 개발

```sh
claude plugin validate .                                  # 플러그인 매니페스트
claude plugin validate .claude-plugin/marketplace.json    # 마켓플레이스 매니페스트
```
