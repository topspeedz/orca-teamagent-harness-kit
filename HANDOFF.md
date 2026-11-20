# 다음 세션 인계 · Orca 하네스 플러그인

2026-11-20 10:03 KST · Windows PowerShell · `D:\Projects\orca-teamagent-harness-kit`

## 먼저 읽을 것

[설계서의 현재 작업 트리 버전](docs/superpowers/specs/2026-11-20-harness-team-structure-design.md)이 사용자가 승인한 전체 설계다. 사용자는 새 세션에서 구현 계획 작성부터 시작하도록 요청했다. 이 작업 트리에서 `superpowers:writing-plans`로 계획을 작성한다. 이미 반영된 초안 생성과 워터폴 번들을 기준으로 남은 구현과 검증 범위를 구분한다.

## 이번 세션에서 마친 팀 구조도 UI

- **공통 기준 문서** 버튼은 13종의 종류·경로·지정 작성자를 보여 준다. 경로를 누르면 색인의 정본 본문(초안 단계는 설치 초안), 작성자 팀 색상 태그를 누르면 역할 상세가 열린다. 절별 담당, 미배정, 해당 없음을 구분한다.
- **문서 소유권**은 사용자가 시안에서 확인한 `문서 · 범위 | 정본 작성자 | 주요 검토자` 세 열이다. 작성자와 복수 검토자 모두 개별 팀 색상 태그로 역할 상세에 연결한다. PRD·SRS의 PM 작성과 Planner 검토 외에 시안에서 보여 준 담당 배정은 예시다.
- **직접 협업**은 협의 주제마다 참여자 태그를 `↔`로 연결하고 협의 목적을 표시한다. 어느 쪽을 눌러도 같은 역할 팝업이 열린다. 팝업에서도 직접 협업 상대를 팀 색상 태그로 따라갈 수 있고, 읽는 입력·담당 라이브 문서·작업 산출물은 구분된 라벨로 보인다.
- **모델 선택 표**는 setup의 기존 HTML에서 프로젝트의 작업 단위별 런타임·모델·effort를 조회·선택한다. **구조도에서 연 화면의 저장은 현재 프로젝트 `docs/harness/model-selection.md`에 즉시 반영**한다. setup 설문의 기존 채팅 인계 절차를 구조도에 추가하지 않는다. 실제 모델 표 쓰기는 후속 구현 항목이다.

## 목표와 확정한 결정

사용자는 setup의 초기 질문을 유지하면서, 설치 직후와 나중에 agent-author로 팀·에이전트를 추가했을 때 같은 조직·문서·역할 기준이 작동하기를 원한다.

- 창구의 plan-orchestrate 진입은 세 가지. 새 요구사항은 PM이 항목화하고 **사용자가 전체 반영과 이번 묶음을 확인**한 뒤 Planner가 설계한다. 사용자가 BL ID를 지정하면 Planner 직행. “알아서 한 phase”면 PM이 우선순위·관련성·선행 조건으로 묶음을 골라 중간 승인 없이 Planner로 넘긴다. 예상 DAG·워터폴과 함께 실행 승인을 받은 뒤 코디네이터가 실행을 감독한다.
- 팀장 없는 운영팀은 PM과 Planner. PM이 prd-write·srs-write·backlog-management로 PRD·SRS·백로그 작성, Planner는 기술 설계·병렬 Task·DAG 계획. 두 역할이 공용 리뷰 스킬로 상대 산출물을 검토한다. prd-writer·pm-reviewer는 새 설치에서 별도 에이전트로 두지 않는다. 모델·effort는 작업 단위마다 설정한다. QA 유지.
- 새 설치 모델은 PM 전 작업에 Opus를 쓴다. PRD·SRS 작성은 max, 수락 기준 작성·백로그 항목화·묶음 선정은 high, 계획 대조·완료 처리는 medium이다. Planner의 기술 설계와 실행 계획·DAG 작성은 각각 Fable에 setup에서 선택한 high 또는 max를 쓰고, 요구사항 검토는 Opus/high다. 기존 프로젝트의 사용자 설정은 보존한다.
- doc-steward와 harness-engineer는 코디네이터 직속 필수 독립 역할. 개발·QA 뒤 제품 문서 정합성을 확인하고 이어서 매 phase 하네스 회고를 한다. team-product의 절차를 plan-orchestrate·backlog-management로 통합하고 실행 뒤 PM 정산은 coordinator에 둔다. 운영팀은 명단에 남는다.
- **두 가지 A 선택**. 조직의 정본은 기존 팀 명단·역할 정의·모델 표를 연결한다. 팀장 OFF 시 팀원을 원래 팀에 남기고 ‘팀 배정 대기’로 표시한다. 직접 협업 상대끼리 기술 협의 가능, 새 배정·범위 변경은 팀장/코디네이터 경유. 문서 담당은 지침·구조도에 표시하고 리뷰로 확인한다. 편집 차단 훅은 원하지 않는다.
- agent-author는 `agent-definition-template.md`의 전문 판단 기준과 프로젝트 `docs/harness/templates/agent.md`를 함께 사용한다. setup 팀 생성과 설치 후 단일 역할 추가 모두 동일한 통합 양식으로 출력한다. 지정한 저장소의 전문 역할 원문을 활용하고 판단·실패 대응·검증·인계를 구체화한다.
- **사용자의 마지막 정정이 우선한다.** 이력 전용 리포트는 `_workspace/`나 팀별 문서로 마쳐도 된다. 라이브 docs는 미리 정한 경로와 양식에 맞춰 **지정된 분야 전문가만** 처음 쓰고 이후에도 갱신한다. 발견자와 작성자가 다르면 근거를 넘긴다. doc-steward는 정합성을 확인한다. setup에서 담당을 추천하고, **agent-author로 에이전트를 만들 때마다** 미배정 문서·절을 새 역할과 대조해 적합한 것만 추천한다. 사용자가 수락하면 담당으로 기록한다. 거절은 미배정, ‘해당 없음’은 향후 추천 대상에서 제외한다. 모든 Task에 라이브 문서 수정을 의무화한다는 앞선 해석은 폐기했다.

## 실제 작업 상태와 파일

`main`은 로컬 커밋 `21a7273`으로 origin/main보다 한 커밋 앞서 있다. 이 커밋에는 설계서 초판 한 파일이 들어 있다. **이후의 양식 통합, 팀 스킬 정리, 라이브 문서 담당 및 팀 구조도 UI 결정은 같은 설계서의 미커밋 수정**이다. 스테이징된 변경은 없고 이 인계 파일은 미추적 로컬 파일이다.

| 위치 | 상태와 용도 |
| --- | --- |
| `skills/setup/scripts/setup.mjs`, `setup.check.mjs`, `skills/setup/references/document-drafts.json` | 이전의 별도 요청으로 이미 구현한 초안 13개 생성과 테스트. 아직 미커밋이며 JSON 경로표는 미추적이다. |
| `README.md`, `README.en.md`, `skills/setup/SKILL.md`, `skills/setup/references/foundation.md` | 위 초안 설치 동작과 사용 안내 변경. |
| `template/docs/DOCUMENTATION_INDEX.md`, `template/.claude/skills/docs-management/{SKILL.md,references/audit.md,references/sync.md}`, `template/.claude/skills/product-planning/references/requirements.md` | 초안 상태와 처음 작성·감사 시 처리. 13개 초안은 코드 지도 1개와 번호 폴더 12개. API·DB 계약, ADR, 런북은 draft.md에서 시작한다. |
| `skills/agent-author/SKILL.md`, 그 아래 `references/{agent-definition-template,expertise-research-protocol,agent-corpus-research,quality-checklist}.md`, `skills/setup/references/team-composition.md`, `template/docs/harness/templates/agent.md` | 두 작성 경로와 전문성 기준을 비교한 근거. 코드에 통합 양식을 구현하는 일은 후속이다. |
| `template/docs/harness/{team-org,model-selection}.md`, `template/.claude/agents/`, `template/.claude/skills/`, `template-codex/.agents/skills/` | 현재 배포 명단·실행·스킬과 Codex 포인터. 옛 이름·리포트를 읽는 재개 경로에 유의한다. |
| `C:/Users/SPeeD/.claude/skills/agent-toggle/`, `C:/Users/SPeeD/Downloads/Agents/Unity-3D-Agent-Team.html` | 전자는 별도로 설치된 스킬이고 후자는 사용자가 준 화면 참고본. 현재 전역 구현은 변경하지 않았다. |
| `_workspace/team-preview/.superpowers/brainstorm/1111-1795133418/content/team-leader-toggle.html` | A/B 비교용 로컬 시안. 브라우저로 토글과 세 탭을 검증했다. 새 세션에서 이전 서버가 살아 있다고 가정할 필요 없다. |
| [문서 소유권 시안](_workspace/team-preview/.superpowers/brainstorm/1111-1795133418/content/document-ownership.html) · [직접 협업 시안](_workspace/team-preview/.superpowers/brainstorm/1111-1795133418/content/direct-collaboration.html) | 새로 확인한 두 로컬 HTML. 각각 해당 탭에서 시작한다. 13개 예시 문서 본문과 역할 상세가 파일에 들어 있어 서버가 종료돼도 HTML을 직접 열 수 있다. |
| `skills/setup/assets/model-survey.html`, `skills/setup/scripts/model-table.mjs`, `skills/setup/references/team-composition.md` | setup의 모델 선택 화면·표 반영 코드·기존 설문 절차. 전역 agent-toggle의 `team.js`와 `team.mjs`는 이번 세션에서 읽기만 했다. |

## 확인한 문제와 검증

- 설치된 agent-toggle의 기존 구조도는 공통 기준 문서와 모델 선택 표를 클릭 동작 없는 상자로 그린다. 이번 세션에서 수정·검증한 대상은 설계서와 로컬 시안이다. 브라우저에서 13종 본문, 작성자·검토자·협업 상대 팝업, 뒤로 이동, 데스크톱·모바일 폭에서의 태그 색상과 동작을 확인했다. 실제 설치 프로젝트에서 정본을 읽고 모델 표를 저장하는 통합 검증은 구현 후에 한다.
- 사용자가 설치 후 생성된 Agent가 양식을 어기고 허술하다고 했다. 플러그인 0.3.0 설치 캐시와 저장소의 작성 지침은 개행을 제외하면 일치했다. 단일 역할 요청과 팀 등록 요청에 제시하는 양식이 다르다. 임시 프로젝트에서 한 줄 본문 `Do good work.`는 모델 표 검사·Codex 동기화를 모두 통과했고, 범용 양식의 `model: inherit`를 추가하자 동기화가 실패했다. 특정 세션의 실제 생성본은 제공받지 않았다.
- 13개 초안 변경은 당시 저장소 검사 **16/16**, 임시 설치의 setup verify **14/14** 통과. Windows에서는 Git Bash의 bin이 PATH에 있어야 하고 셸 재현 검사에는 powershell.exe도 필요했다. 이 수치는 후속 하네스 리팩토링의 검증 결과가 아니다.
- 새 구조에서 team-harness 및 product-planning의 기존 진입점도 이관 후 제거 후보. 요구사항 작성, 우선순위·분해, 리뷰, 재시도 규칙의 목적지를 설계서에 적었다. 역할·파일 삭제나 플러그인 재배포는 수행하지 않았다.

## 구현 계획 작성 재개 순서

1. 같은 작업 디렉터리에서 `git status --short --branch`와 설계서의 현재 내용을 확인한다. 미커밋 작업이 있으므로 새 클론이나 커밋 초판만 읽으면 최신 결정이 빠진다.
2. 팀장 OFF, 라이브 문서 작성자, 구조도 UI 및 모델 표의 즉시 저장은 결정되었다. 실행 중 팀장이 이미 배정받은 Task의 복잡한 내부 분해를 Planner에게 직접 맡기고, 승인 범위 변경이나 다른 팀 배정이 필요하면 코디네이터에게 올리는 경로도 확정했다. 사용자 요청으로 워터폴 번들에 이 컴퓨터 전역판의 진행 모드·Orca 변환·여러 Run 병합을 가져왔다. 변환기는 Task 생성 시각을 시작으로 쓰며 번들은 Orca 프로필의 정션 경유 실행을 지원한다. 제품 문서 양식 12개의 정본 경로는 `docs/harness/templates/product-docs/`로 확정했다. 기존 양식 링크는 유지하며 호환 방법은 빌더에게 맡긴다.
3. 최종 검토 뒤 세 가지를 확정했다. 모델 표는 즉시 저장하고 이미 승인된 Task는 미기동이어도 승인 당시 설정으로 실행한다. 현재 Run의 배정을 바꾸려면 해당 배정·DAG를 다시 승인받는다. 팀장이 ON일 때 직접 배정은 한 팀에 단순 Task가 1개뿐인 경우만 허용한다. 필수 문서 수정은 이번 phase에서 마무리한다. 사용자가 명시적으로 이월하면 해당 항목에 남은 문서·담당·사유를 남기고 미완료로 유지한 채 나머지 완료 항목 정산과 회고 뒤 phase를 마감한다. 답변 대기 중에는 phase를 열어 둔다. 세 결정은 승인된 설계와 구현 계획의 검증 기준에 포함한다.
4. 이후 구현 단계에서 설치본 보호·Codex 포인터·진행 중 phase 재개를 함께 검증한다. 실제 코드를 변경하기 전에 사용자 제공 AGENTS 지침을 적용한다. 한국어로 소통하고 미승인 범위·모델 교체·삭제를 임의로 진행하지 않는다.

## 참고용 메모리

claude-mem의 이전 관찰 #135565는 모델 표 검사 범위를 설명한다. 이번 설계의 최신 근거는 작업 트리의 설계서와 위 실험이다. 과거 기획 팀 개편 완료 기록은 11월 20일 설계의 구현 완료로 해석하지 않는다.
