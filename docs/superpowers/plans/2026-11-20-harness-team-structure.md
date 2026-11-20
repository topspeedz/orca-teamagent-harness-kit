# Orca 하네스 역할 구성과 실시간 팀 구조도 구현 계획

> 실행: Orca

**목표**는 setup으로 처음 설치하든 agent-author로 역할을 추가하든, 사용자가 구조도에서 본 사람·문서·작업별 배정이 실제 기동과 phase 마감에서도 일치하게 하는 것이다.

**구조**는 프로젝트의 `docs/harness/team-org.md`가 소속과 배정 경로를, `.claude/agents/<역할>.md`가 판단·협업·문서 책임을, `docs/harness/model-selection.md`가 다음 계획의 작업별 설정을 맡는 방식이다. 창구는 실행 승인 때 검토받은 Task별 배정을 고정한다. 코디네이터와 팀장은 그 배정으로 기동하고, 구조도는 같은 프로젝트의 정본·토글 상태를 읽는다.

**기술**은 기존 Node.js ESM 스크립트와 `node:assert/strict`, Markdown 설치 템플릿, Claude 역할 정의와 Codex TOML·스킬 포인터, Orca Run·Task·Dispatch, agent-toggle의 로컬 HTTP 서버와 브라우저 검사다.

**설계 기준**은 2026-11-20 현재 작업 트리의 승인본이다. 아래 K01–K18은 설계서 마지막 절의 검증 항목을 원문 순서대로 가리킨다. [승인 설계서](../specs/2026-11-20-harness-team-structure-design.md) · [인계 기록](../../../HANDOFF.md)

## 출발점과 작업 경계

| 확인한 상태 | 구현자가 이어갈 지점 |
| --- | --- |
| setup이 초안 13개를 생성한다. 설치 경로표의 서로 다른 양식은 12개다. 기존 검사 `node skills/setup/scripts/setup.check.mjs`는 16건 통과했다. | 생성기를 유지하고 T1에서 새 양식 링크와 구버전의 실제 편집본으로 검사를 확장한다. |
| 번들에 예상·진행 렌더러, Orca 변환기, 여러 Run 병합기가 있다. `node template/.claude/skills/waterfall-timeline/scripts/check.mjs`로 예제·변환·병합·정션 경유 CLI 검사를 통과했다. | T7은 실제 하네스의 계획 ID와 실행 Run을 연결하는 작업이다. 전체 템플릿 lint에는 이식한 두 스크립트의 기존 R3 지적 6건이 있다. 기능 검사와 별도로 기록한다. |
| `setPlannerRow(tableText, effort)`는 모든 Planner 행을 바꾼다. `orca-launch.mjs register`는 등록할 때 모델 표를 다시 읽는다. `worker --map`은 이미 등록된 값을 쓴다. | T3은 설치 설문의 적용 범위, T5는 승인과 등록 사이의 변경 및 재개를 검증한다. |
| 팀 구조도 세 보기의 시안이 있다. 현재 agent-toggle의 팀 파서는 활성 팀장 유무에 의존하고, 모델 설문은 setup의 Artifact 저장을 사용한다. | T8·T9는 실제 설치 프로젝트와 별도 스킬의 연동 작업이다. 시안의 예시 배정은 테스트 데이터로만 사용한다. |

- 체크박스는 계획 수립 당시 작성한 재현 절차다. 이후 사용자가 승인한 범위는 저장소에서 가능한 T1–T10 구현과 검증이다. 실행 결과와 실제 기동 범위는 마지막 절에 기록했다.
- 플러그인이 배포하는 파일과 별도 스킬 `~/.claude/skills/agent-toggle/`의 파일을 구분한다. T8·T9는 스킬의 작업 사본과 임시 설치로 검증한다. 프로젝트 setup으로 사용자 전역판에 쓰지 않는다.
- setup 초기 질문, 역할명 `doc-steward`·`harness-engineer`, QA 두 역할, 기존 사용자 승인·대기·재시도 규약을 유지한다. 문서 편집 권한은 역할 지침·구조도·리뷰로 확인한다. 편집 차단 훅을 추가하지 않는다.
- 조직 정본을 별도로 만들지 않는다. 팀을 꺼도 명단과 작성 책임은 남는다. 기존 프로젝트의 모델·역할·문서·설치 기록은 그 프로젝트의 값이 기준이다. 새 설치 기본값을 기존 설정에 일괄 적용하지 않는다.
- 실행 배정은 해당 프로젝트 모델 표와 사용자 승인에서 얻는다. 이 계획 번호는 구현 순서를 가리키며 실제 백로그 ID·워커·모델·슬롯을 부여하지 않는다. 승인된 설계 외에 제품 동작이나 범위를 결정해야 하면 그 결정만 창구로 올린다.

## 우선 검토할 다섯 가지

| 입력 또는 실패 조건 | 사용자에게 보여야 할 결과 | 소유 작업 |
| --- | --- | --- |
| 예전 양식과 초안이 편집됐고 색인에는 다른 정본이 있다 | 옛 링크에서 편집 내용을 읽을 수 있고 재설치 뒤 같은 정본·절별 담당을 찾는다 | T1, T10 |
| 승인 직후 표를 저장했고 T02는 아직 Orca ID조차 없다 | T02 최초 등록·기동과 등록된 T01의 지연 기동 모두 승인값을 사용한다. 다음 계획만 새 값을 얻는다 | T5, T9 |
| 팀장의 Claude 정의만 OFF이고 팀원과 Codex 정의는 ON이다 | 원소속·문서 담당을 보존하고 해당 실행 팀을 배정 대기로 표시한다. ON 복구 뒤에만 해당 팀으로 배정한다 | T6, T8, T10 |
| 문서 변경 발견 후 담당이 없거나 담당에게 증거만 전달했다 | 사용자 답변 전 phase가 열려 있다. 명시적 이월 뒤에도 해당 항목은 미완료로 남는다 | T2, T6 |
| 재개 시 옛 이름의 완료 리포트와 새로 수정된 계획이 함께 있다 | 완료한 단계와 Dispatch는 한 번만 정산한다. 바뀐 버전은 영향받은 부분을 재검토한 뒤 승인한다 | T4, T5, T10 |

## DAG

| 작업 | 선행 산출물 | 주 편집 영역 | 완료 증거 |
| --- | --- | --- | --- |
| T1 설치 양식과 링크 | 기존 초안 경로표 | setup·docs-management·제품 문서 양식 | 신규/기존 설치에서 실제 파일 열기 |
| T2 역할 생성과 문서 담당 | T1의 경로·양식 | agent-author·팀 구성 절차·역할 양식 | 같은 전문 역할의 두 생성본과 수락·거절 기록 |
| T3 명단·역할 스킬·모델 기본값 | T2의 역할 양식 | 팀 명단·모델 표·역할·Codex 포인터 | PM 4행·Planner 3행의 정확한 조회 |
| T4 접수·상호 검토 | T3의 역할과 작업 단위 | 창구·기획·브리프·계획 양식 | 세 요청의 호출·승인 기록 |
| T5 승인 배정과 기동 | T4의 검토 버전·계획 DAG | orca-launch·모델 조회·Run 복구 | Orca 인자·등록 spec·영수증 일치 |
| T6 팀 배정과 phase 마감 | T2의 문서 책임, T5의 기동 계약 | coordinator·team-lead·문서/PM 정산·회고 | 팀장 네 조건 및 완료·대기·이월 기록 |
| T7 예상·실측 그림 | T4의 계획 ID, T5의 실행 Run·Task 대응 | 계획/코디네이터의 그림 절·다이어그램 번들 | 같은 Run의 상태·시각, 두 Run 합본 |
| T8 구조도·문서·협업 | T1–T3의 프로젝트 파일, T6의 배정 경로 | agent-toggle의 파서·화면·서버 | 세 보기에서 같은 문서·역할로 이동 |
| T9 프로젝트 모델 표 즉시 저장 | T3의 작업별 표, T5의 승인값, T8의 서버 | 기존 모델 설문·표 편집기·agent-toggle | 실제 파일의 변경 행과 재조회값 |
| T10 기존 설치·진행 중 phase 통합 | T1–T9 | setup 보호·이관 완료된 호출처·통합 검사 | 신규 프로젝트와 구버전 사본의 전후 비교 |

T6과 T7은 기동 계약이 정해진 뒤 각각 작업할 수 있다. 두 작업이 모두 쓰는 coordinator 지침은 같은 파일에서 순차 반영한다. T8의 파서·읽기 검사는 설치 파일 형식이 확정되면 먼저 진행할 수 있다. 아래 경로는 별도 표기가 없으면 키트 저장소 루트 기준이며, 설치 명령의 `.claude/`는 **임시 대상 프로젝트** 기준이다.

### T1. 초안 13개의 링크와 기존 양식 보존

**파일** · `skills/setup/scripts/setup{,.check}.mjs`, `skills/setup/references/{document-drafts.json,foundation.md}`, `skills/setup/SKILL.md`, `template/docs/{DOCUMENTATION_INDEX.md,harness/templates/live-doc.md}`, `template/.claude/skills/docs-management/{SKILL.md,references/init.md,references/sync.md,references/audit.md,references/forms/}`, 새 `template/docs/harness/templates/product-docs/`. 사용자 안내의 경로는 `README.md`, `README.en.md`에도 반영한다.

**입출력** · `planInstall(templateDir,codexDir,target,answers,ins)`의 복사 계획과 `applyInstall(plan,{approve})`를 사용한다. 설치기의 `document-drafts.json`은 초안 경로 → 양식 파일명이다. 출력은 그 경로의 초안 및 그 **파일 위치 기준으로 해석되는 상대 링크**다. T8이 플러그인 소스 없이 읽을 설치용 경로표도 이 원본에서 `docs/harness/templates/document-drafts.json`으로 복사한다. 경로 목록은 한 곳에서만 편집한다.

- [ ] 기존 `product drafts use the installed forms …` 검사를 확장한다. 13개 링크를 Markdown에서 추출하고 각각을 초안의 부모 폴더에서 해석해 실제 정본 파일을 읽는다. docs-management의 대응표에도 같은 검사를 적용한다. 새 루트 기대값으로 먼저 실행하면 현재 옛 `references/forms/`에서 실패해야 한다.

  ```js
  assert.equal(Object.keys(draftForms).length, 13)
  assert.equal(new Set(Object.values(draftForms)).size, 12)
  assert.equal(draftForms['docs/05-api/draft.md'], 'contract.md')
  assert.equal(draftForms['docs/06-database/draft.md'], 'contract.md')
  assert.equal(resolvedForm, join(target, 'docs/harness/templates/product-docs', draftForms[draft]))
  ```

- [ ] 기존 12개 양식 `codebase-map, prd, srs, ui-spec, architecture, contract, adr, wbs, test-cases, rtm, runbook, changelog`를 새 정본 경로로 연결한다. `planDocumentDrafts`와 `documentDraft`의 기존 구조 추출·초안 전용 쓰기(`wx`)를 유지한다. API·DB·ADR·런북은 각 폴더의 `draft.md`에서 시작한다. 초안에 양식 예제의 제품 사실이나 미지정 전문가를 넣지 않는다. PRD·SRS 제품 작성자는 PM이고 색인 담당은 doc-steward다. 12개 양식의 머리말·작성 지시와 생성된 13개 초안에서 이전 담당이 그대로 복제되지 않는지도 확인한다.
- [ ] 구버전 설치 사본에 **서로 다른 표식**을 넣는다. 옛 양식 본문 편집, 그 양식을 가리키는 기존 초안, 절별 작성자, 다른 경로의 색인 정본, 루트 `CHANGELOG.md`, `해당 없음` 영역을 준비한다. 재설치 전후에 옛 링크를 실제로 따라가 편집한 본문을 읽고 각 파일·지정 작성자를 비교한다. 새 정본 위치에도 다른 사용자 파일이 있으면 기존 충돌 절차로 제시한다. 옛 링크 호환 방식은 빌더가 정하되 편집본을 기본 양식으로 덮거나 아무 내용 없는 안내 파일로 바꾸면 실패다.
- [ ] `node skills/setup/scripts/setup.check.mjs`를 실행한다. 신규 설치의 13개 초안과 12개 양식, 재설치 2회의 본문·링크·담당 보존, 기존 문서/해당 없음과 충돌 처리까지 통과해야 한다. 생성된 빈 초안은 색인에서 계속 초안 단계이며 실제 기록이 생긴 뒤 지정 작성자가 내용을 채운다.

### T2. 동일한 전문 역할 생성과 문서 담당 추천

**파일** · `template/docs/harness/templates/{agent,team-skill}.md`, `skills/agent-author/SKILL.md`, `skills/agent-author/references/{agent-definition-template,agent-corpus-research,expertise-research-protocol,quality-checklist}.md`, `skills/setup/references/team-composition.md`, `skills/setup/SKILL.md`. 기계 검사는 설치 프로젝트에서 실행할 `template/.claude/scripts/agent-definition{,.check}.mjs`에 둔다.

**입출력** · 승인된 독립 역할·기존 팀원·팀 전체와 프로젝트 파일을 입력받아 `.claude/agents/<name>.md`, 해당 명단 항목, 작업별 모델 행, 선택한 문서·절과 협업 경로를 연결한다. 신규 작성 완료 시 두 진입점에서 `node .claude/scripts/agent-definition.mjs --agent <name>`을 호출한다. 프로젝트 루트에서 해당 역할만 읽고, 형식·참조가 맞으면 종료 코드 0, 오류가 있으면 경로·사유와 코드 1이다. Codex 선택 시 기존 `setup.mjs sync-agent --target <프로젝트> --agent <name>`로 TOML을 만든다. 미배정과 해당 없음은 역할을 만들기 전에도 구분할 수 있도록 기존 색인에 기록하고, 절별 배정 상태와 문서 최신성은 따로 읽는다. 지정한 역할·절의 쓰기/검토 범위는 역할 정의에서 읽는다.

- [ ] 신규 역할의 형식 검사에 한 줄 본문 `Do good work.`, `model: inherit`, 안내문·미작성 자리표시자, 존재하지 않는 역할·스킬·문서·명단·모델 참조를 각각 넣는다. 기계 검사는 해당 위치와 이유를 보고하고 실패해야 한다. 구형 역할을 단순 재동기화하거나 읽는 경우는 T10의 호환 검사로 다룬다.
- [ ] 두 생성 진입점 모두 **대상 프로젝트**의 `docs/harness/templates/agent.md`를 출력 양식으로 읽게 한다. `agent-definition-template.md`에서는 전문 판단 질문과 좋은 예를 함께 읽는다. 하네스 없는 단독 설치의 범용 출력 예시는 유지한다. 설치 역할 머리말은 `name`, `description`. 본문은 핵심 역할·경계, 작업 원칙, 전문 판단, 입력과 출력, 완료 기준, 다시 호출될 때, 오류 처리, 협업을 채운다. 판단에는 조건→근거→행동→검증 증거→실패 대응을 담는다. 역할 소속과 모델값의 출처, 직접 협의 목적과 상향 경로, 읽는 입력·담당 절·리포트·검토 책임을 구별한다.
- [ ] setup에서 라이브 문서별 경로·양식·전문 역할·근거를 보여 주고 역할 생성/나중에 배정/해당 없음 중 응답을 기록한다. agent-author는 **생성할 때마다** 미배정 문서·절만 대조해 경로·절·추천 이유를 제시한다. 수락한 범위만 등록하고 미선택은 미배정으로 둔다. 기존 담당·해당 없음은 다시 추천하지 않는다. 거절해도 문서·초안은 남는다. 같은 역할의 명단·표 행 중복을 막고 확인된 협의는 양쪽에서 찾게 한다.
- [ ] 두 임시 프로젝트에 같은 API 전문가를 각각 setup 팀 생성과 설치 후 agent-author의 단일 역할 추가로 만든다. 설치 후 agent-author의 **팀 전체 생성**도 별도로 실행해 팀장·팀원 전원의 쓰기/검토·협의 범위와 모델 행을 대조한다. 관련 없는 역할에는 API 추천 0건, API 전문가에게만 미배정 API 절 추천, 수락/거절/해당 없음의 다음 추천 결과를 대조한다. 독립 역할과 기존 팀원 추가에서도 소속·모델·포인터가 맞는지 본다.
- [ ] `node template/.claude/scripts/agent-definition.check.mjs`와 설치본 `model-selection.mjs check`를 통과시킨다. **내용 검토는 별도로** 두 생성본에 같은 ‘사용 중인 응답 필드 삭제’와 소비자 확인 실패 사례를 준다. 실제 계약·소비 코드, 지정 저장소에서 비교한 관련 역할 원문, 채택 근거, 실패 신호, 계약 검사, 전환 순서와 인계 상대를 각 정의/연결된 제작 근거에서 찾는다. 미열람 자료는 미확인으로 남긴다. 자기평가 점수나 필수 절 존재만으로 내용 검토를 통과시키지 않는다.

### T3. 운영팀·독립 역할·작업별 모델 표

**파일** · `template/docs/harness/{team-org,model-selection}.md`, `template/.claude/agents/{product-manager,planner,doc-steward,harness-engineer}.md`, `skills/setup/{SKILL.md,references/team-composition.md,scripts/setup.mjs,scripts/setup.check.mjs}`, `skills/setup/scripts/model-table{,.check}.mjs`, `template/.claude/scripts/model-selection{,.check}.mjs`. 역할 스킬은 `template/.claude/skills/`, Codex 포인터는 `template-codex/.agents/skills/` 아래 같은 이름의 `SKILL.md`다.

**입출력** · `lookup(rows,agent,unit)`의 `matched, runtime, model, effort`를 사용한다. 아래 괄호는 기존 호출에서 쓸 수 있는 단일 조회 키 예다. 여러 별칭을 한 행에 적어도 호출에는 한 키만 넘긴다. 설계·계획은 독립된 두 행으로 둔다.

| 새 설치의 역할 | 작업 행 | 런타임·모델 | effort |
| --- | --- | --- | --- |
| product-manager | PRD·SRS 작성 (요구사항 정리) | claude · opus | max |
| product-manager | 수락 기준 작성·백로그 항목화·묶음 선정 (항목화) | claude · opus | high |
| product-manager | 계획 대조 | claude · opus | medium |
| product-manager | 백로그 완료 처리·장부 정리 (완료 처리) | claude · opus | medium |
| planner | 요구사항 검토 | claude · opus | high |
| planner | 기술 설계 (설계) | claude · fable | setup의 high 또는 max |
| planner | 실행 계획·DAG 작성 (계획) | claude · fable | setup의 high 또는 max |

- [ ] 실제 설치 템플릿과 setup 임시 fixture 각각에 대해 `high`와 `max`로 설치해 위 7행을 한 행씩 조회한다. `assert.equal(row.matched, 'exact')`와 런타임·모델·effort 동등성을 확인한다. 설계와 계획 중 한 행만 변경하고 다른 두 Planner 행이 유지되는지도 본다. 현재 한 줄 `설계, 계획` 및 모든 Planner 행을 덮는 구현에서는 이 검사가 실패한다.
- [ ] `setPlannerRow(tableText,effort)`를 설계·계획의 정확한 두 행에 적용한다. 초기 설문의 Planner effort 질문을 유지한다. 이후 두 작업에서 각각 Opus/Fable과 high/max를 선택할 수 있게 기존 설문·저장 검증·호출 지침을 맞춘다. 기존 사용자 설정, 다른 역할의 런타임, 메모, 기본 행과 사용자 지정 모델은 새 기본값으로 초기화하지 않는다.
- [ ] 팀 명단에 팀장 없는 운영팀의 동료 PM·Planner, 기존 QA 팀, 코디네이터 직속 필수 독립 역할 doc-steward·harness-engineer를 명시한다. 운영팀의 빈 팀장과 비활성 실행 팀장을 구별한다. 팀장이 없는 운영팀은 팀 스킬 파일 없이도 명단에서 읽을 수 있어야 한다.
- [ ] 기존 `product-planning/references/requirements.md`의 원문 대조·PRD·SRS 작성 규칙을 새 `prd-write/SKILL.md`·`srs-write/SKILL.md`로, `review.md`의 누락·계획 대조 기준을 PM·Planner 공용 리뷰 스킬로 옮긴다(파일명 `product-review/SKILL.md`). `decomposition.md`·`prioritization.md`의 분해·우선순위·선행 조건은 `backlog-management`에서 찾게 한다. 새 스킬의 Codex 포인터도 같은 정본으로 연다. 옛 진입점은 T4·T6에서 호출처를 옮긴 뒤 T10에서 신규 배포 목록을 정리한다.
- [ ] `node skills/setup/scripts/setup.check.mjs`, `node skills/setup/scripts/model-table.check.mjs`, `node template/.claude/scripts/model-selection.check.mjs`를 실행한다. 설치한 두 프로젝트에서 모델 표 검사, 신규 역할 TOML의 본문, 작업별 조회값·새 포인터의 도착 파일을 확인한다. PM과 Planner가 서로의 산출물을 검토할 수 있고 자기 검사는 상대 역할의 리뷰 영수증으로 취급되지 않아야 한다.

### T4. 세 가지 접수 경로와 검토 버전

**파일** · `template/AGENTS.md`, `template/.claude/skills/{plan-orchestrate,phase-planning,backlog-management,product-review}/SKILL.md`, `template/.claude/skills/coordinator/references/front-desk.md`, `template/docs/harness/templates/{brief,spec,report}.md`. 기존 `team-product/SKILL.md`의 단독 요청·리포트·재작업·재개 절차가 이관 원본이다.

**입출력** · 입력은 사용자 요청 원문 또는 명시한 BL ID와 기존 백로그다. 출력은 브리프에 기록한 선정 ID·목표·선정 이유·사용자 결정, 상대 역할의 검토 기록(문서 버전·BL ID·결과·열린 쟁점), 같은 버전의 계획·DAG·예상 워터폴이다.

| 정상 요청 | 창구가 기동할 역할과 검토 순서 | 실행 전 사용자 승인 |
| --- | --- | --- |
| 새 요구 여러 개 | PM이 원문→PRD/SRS→BL·수락 기준을 대조. Planner가 누락과 계획 가능성을 검토. 묶음 확인 뒤 Planner가 설계·계획하고 PM이 계획 대조 | 3회. 전체 요청의 반영 여부와 이번 묶음을 한 번에 확인 → 설계 → 계획·실행 |
| 사용자가 BL ID 지정 | 작은 항목도 Planner가 첫 담당. 명시 ID가 단축 규칙보다 우선. Planner의 설계·계획 뒤 PM이 계획 대조 | 2회. 설계 → 계획·실행 |
| 기존 백로그에서 한 phase 위임 | PM이 우선순위·선행 조건·관련성으로 목표 하나와 묶음·근거를 선정해 Planner에게 인계. PM이 완성 계획을 대조 | 1회. 목표·선정 이유·항목·예상 그림을 함께 보고 실행 승인 |

- [ ] 임시 브리프 3개를 같은 백로그로 시작한다. 각 요청을 끝까지 따라가며 최초 호출 역할·작업 단위, 검토자·버전, 창구가 묻는 시점, 코디네이터를 처음 띄울 수 있는 시점을 순서대로 적는다. 위 표와 다른 첫 호출 또는 승인 횟수에서 실패시킨다. 횟수는 정상 경로의 실행 전 게이트이며 결함 처리·사용자 질문은 별도로 기록한다.
- [ ] 새 요구는 ‘반영한 전체 목록’과 ‘이번 묶음 밖의 항목’까지 원문과 대조한다. 명시 ID가 없거나 완료됐거나 선행 조건이 지정 범위를 넓히면 해당 ID와 이유를 창구에 올린다. 위임 경로에서는 별도 묶음/설계 승인 없이 최종 승인 때 사용자가 바꿀 수 있다. `plan-orchestrate` 밖의 일반 단일 파일 수정 경로는 유지한다. 단독 PRD는 PM 작성→Planner 검토, 단독 계획 검토는 PM의 계획 대조로 연결한다.
- [ ] 각 Task에 BL ID, 실제 선행 산출물, 역할·작업 단위·런타임·모델·effort, 쓰기 범위, 검증 방법을 적는다. BL 하나를 나눈 여러 Task와 여러 BL이 공유하는 선행 계약을 양방향으로 따라가 본다. 설계 때는 팀 단위, 계획 때는 Task 단위의 대기 DAG와 T+ 워터폴을 같은 버전으로 제공한다.
- [ ] 변경한 버전은 영향받은 계획·그림·상대 리뷰만 갱신한다. 같은 버전 리뷰를 반복하지 않는다. 열린 High는 원작성자 수정→상대 재검토, 최대 2회 뒤 창구에 보고하고 Medium 이하 쟁점은 승인 질문에 싣는다. 워커 실패는 기존 1회 재시도와 최종 보고를 따른다. 이미 넘긴 리포트는 버전 파일로 이어간다.
- [ ] 미검토 v2와 검토 완료 v1을 함께 둬서 **v2 실행 기동 0회**를 확인한다. v2를 리뷰한 뒤 v2 그림·승인이 일치할 때만 코디네이터 기동 1회다. 정상 3건과 지정 ID 오류·단독 요청을 브리프/리포트와 대조한다. `node template/.claude/scripts/wait-contract-check.mjs --root template`로 coordinator·team-lead·plan-orchestrate의 실제 대기 계약 세 곳이 정본과 일치하는지 검사한다.

### T5. 승인 당시에 미등록인 Task의 기동과 현재 Run 재승인

**파일** · `template/.claude/scripts/orca-launch{,.check}.mjs`, `template/.claude/skills/{plan-orchestrate,phase-planning,coordinator,team-lead}/SKILL.md`, `template/.claude/skills/coordinator/references/{front-desk,recovery}.md`, `template/docs/harness/templates/{brief,spec,ledger}.md`.

**입출력** · 창구가 승인받은 계획 버전과 Task ID별 `agent, unit, runtime, model, effort`를 인계한다. 여기서 `agent`는 역할명이며 **그림**의 `nodes[].agent`와 **Orca 인자** `--agent`에는 런타임을 쓴다. 기동 검사는 기존 `main(argv,deps)`, `parseAssignLine(spec)`, `verifyAssignment(...)`, `workerStartArgs(...)`와 가짜 Orca 호출 기록을 재사용한다.

- [ ] 다음 순서로 `orca-launch.check.mjs`에 회귀 검사를 **먼저** 넣는다. QA Task T01·T02의 검토된 DAG는 `claude opus/high`다. v1 실행 승인을 기록한 뒤, T01만 등록하고 표를 `claude sonnet/medium`으로 바꾼다. 새 프로세스처럼 승인 기록과 map을 다시 읽고 T02를 처음 등록한다. T01과 T02를 기동한다. 둘 다 승인값이어야 한다. 표를 바꾸는 시점을 실행 Run 생성 **전**으로 옮긴 경우도 반복한다. 현행 `register`의 live 조회로 T02 등록이 실패하는 것을 확인한다.

  ```js
  assert.equal(receipt.requested.runtime, 'claude')
  assert.deepEqual(receipt.applied, { model: 'opus', effort: 'high' })
  assert.deepEqual(['--agent', '--model', '--effort'].map(k => args[args.indexOf(k) + 1]),
    ['claude', 'opus', 'high'])
  assert.equal(receipt.matched, true)
  ```

- [ ] 사용자 승인 원문·계획/DAG 버전과 **모든 승인 Task**의 배정을, 실행 Run 생성/Task 등록과 독립적으로 phase 작업 폴더에 고정한다. 구현안은 `_workspace/_run/<phase>/approved-plan.v<N>.json`에 Task ID·BL·의존·배정과 검토된 버전 식별자를 저장하고 브리프에서 그 버전을 가리키는 것이다. 창구가 승인 질문에 붙인 버전과 승인 응답이 가리키는 버전을 대조하고, 새 기록 쓰기가 끝난 뒤에만 그 버전을 실행에 사용한다. 기존 `waterfall.plan.json`은 회고용 시간 예측이므로 배정 근거와 구분한다.
- [ ] 코디네이터의 `exec-run`·`register --map … --id …`·`worker --map … --id …`·재시도/재개가 같은 승인 버전을 사용하게 한다. 등록한 Orca ID만 담던 `orca-tasks.json`을 미등록 Task 목록으로 오해하지 않는다. 등록 spec·의존·실제 기동 인자·영수증·장부·그림의 Task ID와 값을 맞춘다. 다른 버전이나 승인에 없는 배정으로는 새 Task/Dispatch를 만들지 않는다. 기존 사용자 예외는 승인 기록의 해당 Task와 대조한다.
- [ ] 팀장은 Run 소유자가 아니어서 팀원과 Planner를 `worker --agent … --unit … --spec-file …`로 직접 띄운다. 사전 승인된 작업은 이 경로에서도 부모 팀 spec이 가리키는 승인 버전·Task ID로 검증한다. 승인 범위 안의 내부 분해는 T6 경로를 사용한다. 승인 전 창구의 PM·Planner 기동과 다음 계획의 모델 조회는 계속 현재 표를 읽는다. 실제 팀원 기동 하나와 다음 계획 하나의 인자를 대조한다.
- [ ] 현재 Run의 배정을 바꿔 달라는 요청이 오면 해당 Task의 배정·DAG와 필요한 검토를 갱신하고 재승인까지 대기한다. 재승인 뒤에만 **그 Task**의 새 spec·기동값을 사용한다. 미등록, 등록됐지만 미기동인 Task를 각각 시험한다. 이미 등록한 Orca Task의 spec을 바꿀 수 없는 경우에는 기존 Task를 중복 실행하지 않도록 새 등록과 이전 ID·의존·게이트의 대응을 장부에 보존한다. 다른 Task와 이미 끝난 Dispatch의 영수증을 덮지 않는다.
- [ ] `node template/.claude/scripts/orca-launch.check.mjs` 통과. 가짜 Orca의 `task-create`에 건넨 **spec 본문**, `worker-start` 인자, 적용 모델·effort·턴 시작 영수증을 모두 확인한다. 명시적 재승인 전에는 변경 배정의 기동 0회, 후에는 1회, 다음 계획은 `sonnet/medium`이다. 런타임이 달라진 예시, effort 없는 행, 두 번 등록/재개, 의존·게이트, Codex 작업 지침도 기존 검사를 유지한다. 옛 map의 재개는 T10으로 검증한다.

### T6. 팀장 배정, 문서 인계, phase 정산

**파일** · `template/AGENTS.md`, `template/.claude/skills/{coordinator,team-lead,team-qa,phase-planning,docs-management,backlog-management,harness-retro}/SKILL.md`, `coordinator/references/{front-desk,settle,recovery}.md`, `phase-planning/references/{workflow-patterns,parallel-rules}.md`, `docs-management/references/{init,sync,audit}.md` (이 세 references 경로는 앞의 스킬 디렉터리 기준), `template/docs/harness/templates/{team-skill,spec,report,ledger}.md`, `template/.claude/agents/{doc-steward,harness-engineer}.md`. 회고 측정은 기존 `harness-retro/scripts/retro-measure.mjs`를 쓴다.

**입출력** · 실행 팀의 상태·Task 수/난이도·소속·승인 범위를 받아 팀장 또는 팀원에게 배정한다. 변경 근거는 `발견 리포트 → BL → 정본 경로와 절·ID → 지정 작성자 → 반영/현행 확인 증거`로 추적한다.

- [ ] 같은 팀에서 다음 네 입력을 재생하고 실제 배정자·보고 수신자를 기록한다. **ON·단순 1개**만 코디네이터가 팀원에게 직접 배정·직접 보고받을 수 있다. **ON·단순 2개**, **ON·전문 분해 1개**는 팀장을 거친다. **OFF·단순 1개**도 배정 대기다. OFF에서 개수를 늘려도 직접 기동은 0회다. QA·공통 경로·팀 양식의 기존 ‘3개 이상’ 및 ‘1~2개 직접’ 예시도 같은 경계로 맞춘다.
- [ ] 이미 배정받은 복잡한 Task에서 팀장→Planner(깊은 내부 분해)→같은 팀장→팀원을 재생한다. Planner는 팀장에게 분해안을 보고하고 운영팀 소속을 유지한다. 승인 범위 변경 또는 다른 팀 배정이 필요하면 팀장이 **배정 전에** 코디네이터에게 올리고 제품 결정은 창구로 간다. 실행 spec에 협의 상대·목적·수신 경로를 싣는다. 활성 상대끼리는 기존 Orca 메시지로 질의·회신하고, OFF/호출 불가면 배정자에게 돌린다. 새 배정은 협의 메시지로 처리하지 않는다. 결정으로 정본·계획이 바뀌면 원작성자가 근거를 기록한다.
- [ ] QA가 발견한 API 응답 변경 fixture에 재현 근거, BL, 계약의 연산 절·ID, 지정 작성자를 적는다. QA는 리포트를 남기고 그 작성자가 처음 작성하거나 수정한다. doc-steward는 코드·테스트·정본·색인을 대조하고 결함을 원작성자에게 돌려보낸다. 이미 현행이면 대조 대상과 결과를 남긴다. 미배정이면 발견자가 근거를 남기고 코디네이터가 지정 요청을 올린다. 이력만 남는 Task는 팀 리포트로 끝낼 수 있고, 하네스 개선은 해당 하네스 문서로 연결한다.
- [ ] 코디네이터의 `worker_done` 정산, PM의 완료 처리·보관, doc-steward 동기화 실패 분기를 함께 맞춘다. QA와 최종 검사를 통과했어도 필수 문서가 인계만 됐으면 ‘반영 대기’다. 정상 경로는 개발·QA → doc-steward 정합성 확인 및 작성자 반영/현행 확인 → PM 완료 항목 정산 → 독립 harness-engineer의 필수 회고 → phase 마감이다. 회고는 지연·재작업·인계 누락을 측정하고, 근거가 있으면 변경과 하네스 변경 이력, 없으면 측정과 ‘변경 없음’을 남긴다. 독립 역할 호출·실패 재시도와 최종 보고는 코디네이터가 맡는다.
- [ ] 필수 변경이 남은 BL A와 완료 가능한 BL B로 아래 세 번을 재생한다. ① 답변 대기 중에는 phase가 열리고 A를 보관하지 않는다. ② 담당자 반영/현행 확인 후 정산한다. ③ **사용자가 명시적으로 이월**하면 PM이 A에 남은 문서·절, 지정 작성자(없으면 미배정), 사유를 기록하고 미완료로 둔다. B만 완료·보관한 뒤 회고를 거쳐 phase를 닫는다. 리포트만 넘기거나 재시도를 소진한 것은 이월 동의가 아니다.
- [ ] 임시 phase의 브리프·spec·장부·팀 리포트·백로그·회고를 위 표본과 대조한다. 같은 Dispatch의 중복 완료 통지는 한 번만 정산해야 한다. `node template/.claude/scripts/report-check.check.mjs`, `node template/.claude/scripts/wait-contract-check.check.mjs`, `node template/.claude/skills/harness-retro/scripts/retro-measure.check.mjs` 통과와 시나리오별 호출/미호출 기록을 함께 남긴다.

### T7. 승인 그림에서 같은 실행 Run의 진행 그림까지

**파일** · `template/.claude/skills/{plan-orchestrate,phase-planning,dag-swimlane,waterfall-timeline,coordinator}/SKILL.md`, `template/.claude/skills/coordinator/references/{front-desk,settle}.md`, `template/.claude/skills/waterfall-timeline/{references/progress-input.md,scripts/from-orca.mjs,scripts/check.mjs}`. 기존 `scripts/{render,progress,merge,progress-check}.mjs`, 예제, 두 기준 HTML, DAG 기준 HTML의 CSS는 그대로 검증에 쓴다.

**입출력** · 계획의 Task ID·실제 의존·예상 시간 → `dag.json`·`waterfall.json`. 실행 중에는 같은 `실행 Run`의 Task 상태·시각과 로컬 ID↔Orca ID 대응 → 진행 입력 → 진행 HTML이다. 여러 Run은 Run별 진행 입력을 먼저 만들고 합친다.

- [ ] 전역 다이어그램이 없는 임시 설치에서 설계(팀 단위)·계획(Task 단위)의 **승인 전** 대기 DAG와 T+ low/likely/high 예상을 연다. 계획 노드의 런타임·모델·effort는 T5 승인 대상과 같고 사람 승인 노드에는 모델이 없어야 한다. 기존 번들을 처음부터 다시 만들지 않는다.
- [ ] `from-orca`에 계획의 BL을 공유하는 T01·T02와 실제 Run에서 돌려받은 서로 다른 Orca Task ID를 넣는다. 현재 장부 양식에는 변환기의 예시 장부처럼 매 행에 Orca Task ID가 들어 있지 않다. `orca-tasks.json`의 실제 대응을 써서 각 측정값이 정확히 하나의 계획 Task로 가는지 검사한다. 단일 BL 문자열로 두 Task를 추측해 합쳐서는 안 된다. 기존 `--ledger`·`--tasks`·`--run` 입력과 외부 Run 변환은 유지한다.
- [ ] 코디네이터가 같은 Run의 완료·진행·대기 상태와 예상 종료를 갱신한다. 완료/진행 막대 시작은 `created_at`, 완료 끝은 `completed_at`이다. 예를 들어 09:00 등록·09:10 기동·09:20 완료면 워터폴은 09:00–09:20, 기동 기준 회고 실측과는 별도다. 미기동 대기는 진행 중으로 표시하지 않는다. 재예측 뒤에도 승인 당시 `waterfall.plan.json`을 보존한다. 두 Run을 병합해 각 단계 접두, 실제 시간축, 승인 대기 구간과 원본별 값을 대조한다.
- [ ] `node template/.claude/skills/waterfall-timeline/scripts/check.mjs`를 실행한다. 정션 경유 CLI·예상·진행·병합·같은 BL의 두 Task가 모두 통과해야 한다. 임시 설치 루트에서는 `node .claude/skills/dag-swimlane/scripts/render.mjs .claude/skills/dag-swimlane/examples/reference.json dag-check.html`로 렌더한 뒤 같은 phase의 실제 입력으로 반복한다. 기존 게시 경로를 갱신했을 때 같은 Run의 진행이 보이는지 확인한다.

### T8. 실제 정본을 읽는 팀 구조도와 세 보기

**파일** · 별도 스킬 작업 사본의 `team.mjs`, `team.js`, `team.css`, `server.mjs`, `check.mjs`, `check-team-ui.py`. 기존 `manager.mjs`·`kit.mjs`의 엔진별 inventory·OFF 접미사·설치 기록을 사용한다. 비교 시안은 인계 기록의 `team-leader-toggle.html`, `document-ownership.html`, `direct-collaboration.html`이다.

**입출력** · `teamStructure(project)`와 `GET /team.json`이 T2–T3의 명단·역할 정의·모델 표, 엔진별 토글 상태를 조합한다. 문서 본문은 해당 프로젝트의 색인과 초안 경로를 사용한다. 브라우저에서 표시하는 역할 식별자는 모든 탭과 팝업이 공유한다.

- [ ] 새 설치 fixture에 운영팀·QA·두 독립 역할·활성 팀원·꺼진 팀장, 분할 소유 문서, 타 팀 검토자 둘, 명시적 협의 목적을 둔다. 구버전 fixture에는 새 표가 없다. 파서 검사에서 **팀장 OFF여도 팀원이 원래 팀에 남는지** 먼저 본다. 기존 활성 팀장 중심 파서에서 실패하는 것을 확인한다.
- [ ] 활성 Claude 역할을 기본 관점으로 쓰되 OFF 원문과 명단으로 원소속·작성 책임을 보존하고 Codex 원문과 상태는 해당 엔진에서 연다. 팀장 없는 운영팀에는 PM↔Planner의 동료 관계를, 독립 역할에는 코디네이터 직속 관계를 표시한다. 선은 배정·보고 실선, 직접 협의 점선이다. 팀장 OFF에서는 팀장 카드 ‘OFF’와 **‘팀 배정 대기’**를 표시하고 그 팀장을 지나는 배정선을 끈다. 양 끝이 ON인 협의선과 문서 소유는 유지한다. 팀원만 토글한 경우, 팀장을 다시 켠 경우, Planner를 실행 팀장이 임시 호출한 경우도 원소속·선·복구 결과를 확인한다.
- [ ] **공통 기준 문서**에서 코드 지도와 12개 번호 영역을 전부 열어 종류·경로·지정 작성자를 원본과 대조한다. 색인의 별도 정본이 있으면 그 파일 본문, 초안 단계면 설치 경로표의 실제 초안 본문을 연다. 예시 파일에 서로 다른 한 줄을 써서 화면 제목만 맞는 구현을 걸러낸다. 문서가 없는 ‘해당 없음’은 실제 상태로 표시한다. 절별 작성자 각각의 팀 색상·팝업, 미배정과 해당 없음을 확인한다. 읽기는 프로젝트가 가리키는 프로젝트 내 파일로 제한한다.
- [ ] **문서 소유권**은 `문서 · 범위 | 정본 작성자 | 주요 검토자` 그대로 세 열을 쓴다. 각 행에 경로와 범위, 역할 정의의 지정 작성자·검토자를 배치한다. 복수 검토자의 각 팀 색상·팝업을 따로 검사한다. **직접 협업**은 주제별 ‘역할 ↔ 역할’과 목적을 한 행에 두고, 양쪽 태그가 소유권 탭과 같은 역할을 여는지 본다. 구형 정의에서 누락된 협의선·담당은 이름으로 추론하지 않는다.
- [ ] 카드와 태그는 같은 역할 팝업을 사용한다. 핵심 책임·읽는 입력·작성할 라이브 문서와 절·작업 리포트 등 산출물·검토자·협업 상대·완료 기준을 라벨로 구분한다. 서로 다른 팀 태그를 따라가 상대 팝업을 열고 이전 역할로 돌아간다. 역할 하나/팀 전체 추가와 ON→OFF→ON을 한 뒤 현재의 1초 재조회와 ETag 갱신, 키트의 수정 파일 보호, 원본/프로젝트 위치 표기가 유지되는지 본다.
- [ ] 작업 사본에서 `node check.mjs`, `python check-team-ui.py`를 실행한다. 신규/구형 프로젝트의 세 보기, 데스크톱·모바일 폭, 클릭 도착점·색상·복구를 검사한다. 모의 HTTP 브라우저 검사 뒤에는 **임시 설치 루트를 cwd로 실제 서버**를 열어 색인/역할 파일을 바꾸고 재조회되는 본문까지 확인한다.

### T9. 같은 모델 설문으로 현재 프로젝트에 즉시 저장

**파일** · `skills/setup/assets/model-survey.html`, `skills/setup/scripts/model-table{,.check}.mjs`, `skills/setup/references/team-composition.md`, 별도 스킬 작업 사본의 `{server.mjs,team.js,check.mjs,check-team-ui.py}`. 설치 배치는 T1의 `planInstall`을 사용한다.

**입출력** · 같은 HTML과 `buildPage(templateHtml,data)`로 현재 행을 표시한다. 선택값 형식은 기존 `{agent,unit,runtime,model,effort}`, 기존 `applyChoices(tableText,choices)`의 출력은 수정한 Markdown 전체다. 저장 대상은 서버가 열린 프로젝트의 `docs/harness/model-selection.md` 한 파일이다.

- [ ] T3 모델 표를 가진 임시 설치 A와 별도 표를 가진 B를 준비한다. A의 구조도에서 **모델 선택 표 → 현재 값 조회 → 작업 한 행 변경 → 저장** 순서로 실행한다. 현재 클릭 동작·프로젝트 쓰기 경로가 없는 상태에서 파일 비교가 실패하는 것을 확인한다.
- [ ] 구조도 서버가 설치 버전에 맞는 setup 원본 설문·행 읽기·검증·표 편집기를 쓰게 한다. 구현안은 setup이 같은 소스에서 설문을 프로젝트의 `docs/harness/templates/model-survey.html`, 편집기를 `.claude/scripts/model-table.mjs`에 설치하는 것이다. 현재 편집기의 키트 상대 import·HTML 경로를 두 실행 위치에서 검증한다. 구조도는 현재 표와 빈 추천 목록으로 기존 페이지를 생성한다. 개발자 PC의 저장소 경로나 플러그인 캐시 버전을 하드코딩하지 않는다. 새 복사본에도 기존 파일 보호 규칙이 적용되어야 한다.
- [ ] 구조도에서 연 설문은 저장 시 현재 서버에 변경 행만 전송한다. 서버는 기존 로컬 Host/Origin/토큰 확인을 적용하고 현재 프로젝트 표에서 행을 검증·반영한 뒤 성공을 응답한다. 저장 완료를 다시 채팅으로 묻지 않는다. setup에서 연 설문은 기존 ArtifactData `model-selection/choices` 저장과 사용자 통보 후 apply 절차를 유지한다.
- [ ] `node skills/setup/scripts/model-table.check.mjs` 및 T8 서버·브라우저 검사를 실행한다. 실제 서버 응답 직후 **디스크의 해당 한 행**, 설문을 닫았다 다시 연 선택값, 다른 행·사용자 메모·B 프로젝트의 파일을 비교한다. 잘못된 선택이나 쓰기 실패가 성공으로 보이지 않아야 한다. 구형 표의 누락 행과 동시 외부 편집은 기존 사용자 값을 보존하고 충돌을 표시한다. 모델 저장 전 승인된 Run·미등록 Task와 저장 후 세운 다음 계획의 기동값은 T5 검사와 연결한다.

### T10. 신규 설치 정리, 구버전 재개, 전체 인수

**파일** · `skills/setup/scripts/setup{,.check}.mjs`, `template/.claude/scripts/model-selection{,.check}.mjs`, `template/.claude/skills/{plan-orchestrate,coordinator}/`의 재개 지침, `template/AGENTS.md`, `README.md`, `README.en.md`, `skills/setup/references/{foundation,team-composition}.md`. 제거 경로는 아래 표의 **신규 배포 템플릿** 기준이다.

| 이관이 끝난 예전 진입점 | 제거 전에 새 설치에서 직접 따라갈 경로 |
| --- | --- |
| `template/.claude/agents/{prd-writer,pm-reviewer}.md`, 옛 기본 모델 행 | PM의 PRD·SRS 작성, Planner의 요구 검토, PM의 계획 대조·완료 처리 |
| `template/.claude/skills/product-planning/`, `template-codex/.agents/skills/product-planning/` | 요구사항 작성 → prd-write/srs-write, 분해·우선순위 → backlog-management, 리뷰 → 공용 리뷰와 Codex 포인터 |
| `template/.claude/skills/team-product/` | plan-orchestrate의 단독 요청·인계·재작업/재개, coordinator의 실행 뒤 PM 호출, backlog-management의 완료·보관. 명단의 운영팀은 유지 |
| `template/.claude/skills/team-harness/` | 코디네이터의 독립 역할 호출·재시도·최종 보고, harness-retro의 측정·근거 있는 변경·이력 또는 변경 없음 |

- [ ] 구버전 임시 설치를 먼저 만든다. 옛 명단과 1인 harness 팀, 사용자 편집 Markdown과 TOML, 엔진별 OFF 파일(`.md.agent-toggle-off`, `.toml.agent-toggle-off`), 모델 행, 기존 포인터, 옛 양식 편집본과 절별 지정 작성자, 진행 중 phase의 Run·Task·Dispatch·장부·리포트를 보관한다. 재설치 전 파일 바이트·활성 상태·색인 경로와 다음에 재개할 단계를 기록한다.
- [ ] `planInstall`·`applyInstall`·`syncAgents`와 `model-selection.mjs check`에서 사용자 편집/충돌과 OFF 양쪽을 확인한다. OFF 파일 옆에 활성 기본 정의를 복제하지 않고, 표 검사가 꺼진 역할을 ‘없는 역할’로 오판하지 않게 한다. 미등록 모델 행·포인터나 옛 이름을 묵시적으로 삭제/치환하지 않는다. 전환 대상과 영향은 기존 경로별 승인·충돌 처리에 올린다. 이미 수정된 내용은 보존하고, 필요한 사용자 결정이 남아 있으면 부분 적용 결과까지 명시한다.
- [ ] 구 phase를 세 시점에서 재개한다. (1) `01_prd-writer_requirements_v*.md`·`03_pm-reviewer_review_v*.md`가 있는 브리프, (2) `06_pm-reviewer_plan-check_v*.md`와 계획 승인이 있는 브리프, (3) 기존 실행 map과 정산된 Dispatch가 있는 장부. 원래 리포트 이름을 읽고 그 버전의 승인/열린 쟁점에 맞는 다음 단계에서 이어가며 이미 끝난 검토·기동을 반복하지 않는다. 구 phase의 실제 배정·명단·리포트를 소급 변경하지 않는다. 등록된 값은 map에서, 미등록은 당시 승인 자료에서 확인한다. 과거 배정을 판별할 근거가 없으면 해당 건의 전환만 창구에 올린다.
- [ ] 새 설치에서 아래 검색 결과를 각 호출의 용도와 대조한다. 새 워커 기동·스킬 로드·모델 조회에서 폐기 이름을 고르는 경우는 0건이어야 한다. 옛 리포트 인식·보호 fixture는 남긴다. `examples/dev-team/`은 수동 예제이므로 기본 설치에 복사하지 않는다. QA의 `team-qa`, `team-lead`, `change-review`, `qa-verification`, 다이어그램 기준 자산과 설치 후 자체 검사는 배포 목록에 남긴다.

  ```powershell
  rg -n --hidden 'prd-writer|pm-reviewer|team-product|team-harness|product-planning' template template-codex skills examples README.md README.en.md
  ```

- [ ] 키트 루트와 임시 설치에서 아래 검사를 실행한다. `$project`는 실제 사용자 프로젝트와 분리한 임시 설치 절대 경로, `$answers`는 그 설치용 기존 설문 형식의 JSON 파일이다. Windows에서 셸 재현 검사는 Git Bash의 `bin`과 `powershell.exe`가 해당 프로세스 PATH에 있어야 한다. 테스트 fixture의 `globalDiagramSkills`를 false/true로 나눠 번들 설치와 전역 스킬이 있을 때의 기존 선택을 각각 확인한다.

  ```powershell
  node scripts/run-checks.mjs --min 16
  node scripts/template-lint.mjs
  node skills/setup/scripts/setup.mjs inspect --target $project
  node skills/setup/scripts/setup.mjs install --target $project --answers $answers
  node skills/setup/scripts/setup.mjs verify --target $project
  ```

  저장소 자체 검사와 `verify`는 `0 failed`가 기대값이다. 예상한 구버전 충돌 fixture에서는 install 종료 코드 2와 편집본 보존을 먼저 확인한다. 전체 lint의 현행 R3 기준선은 워터폴의 `scripts/check.mjs` 1건과 `scripts/from-orca.mjs` 5건이다. 새 지적이 생기면 해당 변경에서 해결하고, 남아 있는 기존 지적은 별도로 보고한다. 사용자판 역할 매핑을 바꾸거나 lint 규칙을 완화하는 결정은 이 계획에 포함하지 않는다.
- [ ] 끝으로 빈 설치와 구 설치에서 각각 대표 phase 하나를 추적한다. 승인받은 최신 검토 버전 → 대기 DAG/T+ → 동일 Run의 실제 기동·진행 그림 → QA → 문서 확인 → PM 정산 → 필수 회고가 같은 BL·Task·문서 절로 이어져야 한다. 자동 검사 결과와 실제 창구/Orca 영수증·브라우저 본문 확인을 따로 남긴다. 이번 문서 작성 시점에는 이 후속 인수 검사를 완료로 간주하지 않는다.

## 승인 설계의 검증 기준 대조표

아래 표는 설계서 마지막 절의 18개 항목을 하나씩 대조한다. ‘증거’는 구현 뒤 검사자가 확인할 산출물이다.

| 기준 | 판정할 결과 | 구현 작업 · 증거 |
| --- | --- | --- |
| K01 | 새 설치의 초안 13개와 docs-management → 새 정본 양식 12개. 구 설치의 옛 링크·편집·작성자 보존 | T1·T10 · 실제 링크 해석, 재설치 전후 파일·절 비교 |
| K02 | 새 요구/지정 ID/위임 각각의 첫 호출·검토자·승인 횟수·실행 조건 및 전 Task→BL 추적 | T4 · 브리프 3개, 호출 순서와 승인 3/2/1회, BL↔Task 표 |
| K03 | 같은 역할의 작업별 계획 배정과 실제 기동 일치. 표 수정 후 미등록/미기동은 옛 승인값, 다음 계획은 새 값. 현재 Run은 해당 배정·DAG 재승인 후 전환 | T3·T5·T9 · 승인 버전, 지연 등록 spec, 기동 인자·영수증 |
| K04 | PM 네 행 Opus max/high/medium/medium, Planner max 선택 시 Fable/max 두 행과 Opus/high 요구 검토 | T3 · 새 설치의 7행 exact 조회, high 선택과 행별 독립 변경 |
| K05 | 팀장이 내부 분해를 Planner에게 직접 맡긴 뒤 팀원에게 배정. 범위·타팀 변경은 배정 전에 코디네이터로 | T6·T8 · 발신자/수신자·분해안, 구조도의 임시 관계 |
| K06 | 팀장 ON·단순 1개만 직접 배정 가능. ON·2개 또는 전문 1개는 팀장, OFF면 단순 1개도 대기 | T6 · 네 입력의 실제 배정·보고 및 기동 0회 기록 |
| K07 | 단일 역할·팀 전체 추가 후 창구 배정, 직접 협업, 문서 책임, 모델 배정이 지침·구조도와 일치 | T2·T3·T8·T9 · 두 설치의 역할/명단/표/화면 대조 |
| K08 | 공통 문서 13종 경로·작성자, 색인 정본/설치 초안 본문, 절별 색상·팝업, 미배정/해당 없음 | T1·T8 · 13행 및 본문 표식·태그 도착점 |
| K09 | 문서 소유권 세 열과 복수 검토자의 팀별 색상·개별 팝업 | T8 · 작성자 1명/검토자 2명인 같은 범위의 한 행 |
| K10 | 직접 협업의 목적·양방향 태그·팀 색상·도착 역할이 소유권 탭과 동일 | T8 · 서로 다른 두 팀에서 각 방향 클릭 |
| K11 | 모델 한 행을 저장한 직후 실제 프로젝트 파일과 재조회값 일치. 팝업에서 입력·담당 문서·작업 산출물 구별, 타 팀 태그 이동 | T8·T9 · 실제 서버 저장·재열기와 역할 카드 |
| K12 | 같은 전문 역할을 setup 팀 생성/설치 후 단일 추가로 작성. 통합 양식 및 대표 업무의 판단 근거·검증 증거·인계 상대 | T2 · 형식 검사와 별도의 내용 검토 2건 |
| K13 | 팀장/팀원 OFF·ON, 팀장 없는 운영팀·직속 역할에서 원소속·문서 책임 유지 | T6·T8·T10 · 엔진별 상태 전후 명단·담당·선 |
| K14 | team-product 없는 신규 설치에 PM·Planner가 동료로 표시. 단독 PRD와 실행 뒤 완료 처리가 담당 스킬로 연결 | T3·T4·T6·T8·T10 · 신규 배포 목록과 두 진입점 |
| K15 | 미배정 API는 관련 역할에게만 추천. 수락 뒤 재추천 제외, 거절은 미배정 | T2 · 관련 없는 역할·전문가 추가 후 각각의 추천/저장 결과 |
| K16 | 변경 근거→담당→절/ID→반영 추적. 인계만 하면 반영 대기, 이력 전용은 팀 리포트로 종료 | T6 · QA 리포트·작성자 수정·doc-steward 확인 또는 이력 리포트 |
| K17 | 필수 문서 미반영이면 답변 전 phase 열림. 명시 이월이면 해당 BL에 문서·담당·사유와 미완료 보존, 나머지 정산·회고 뒤 마감 | T6 · 답변 전/반영/이월의 세 장부와 보관 파일 |
| K18 | 검토된 버전에서만 실행 승인. 전체 phase에서 QA·제품 문서 정합성 확인·필수 하네스 회고 | T4·T6·T10 · 버전 불일치 시 기동 0회와 정상 phase의 종료 증거 |

## 구현과 인수 검증 결과

2026-11-20에 저장소 작업 트리에서 T1–T10을 구현했다. 검증은 임시 설치, 로컬 HTTP 서버와 Chromium, 격리된 Orca 응답 fixture, 실제 Orca Run을 사용했다. 아래 표에서 실제 기동과 재현 검사의 범위를 확인할 수 있다.

| 설계 기준 | 실행한 검사와 관찰 결과 |
| --- | --- |
| K01 | 새 설치에서 독립 QA 워커가 초안 13개, 링크 13개, 고유 양식 12개, 끊긴 링크 0개를 확인했다. API와 DB가 계약 양식을 공유한다. 이전 커밋 `21a7273`의 설치기로 만든 프로젝트를 업그레이드해 기존 양식·링크·색인·모델·OFF 정의·리포트 등 9개 파일의 바이트가 보존되는지 대조했다. 경로별 충돌 62건이 표시됐고 임시 프로젝트에서 승인한 경로를 적용한 뒤 충돌은 0건이었다. |
| K02·K14 | `phase-routing.check.mjs`로 새 요구·지정 BL·phase 위임의 첫 담당과 검토자, 정상 승인 3·2·1회, 범위 밖 선행·없는 ID·완료 ID를 검사했다. 새 설치에는 역할 파일 6개가 있으며 단독 PRD는 PM 작성과 Planner 검토, 실행 후 정산은 PM의 완료 처리로 연결된다. |
| K03·K04 | PM 네 작업과 Planner 세 작업의 기본값, 설문 저장·재조회, 구 표 보존을 설치·모델 검사로 확인했다. 실제 Run `run_23610dbb9c96`에서 시험용 v1 배정 `gpt-6.2-astra/high`를 고정한 뒤 임시 프로젝트 표를 `medium`으로 바꾸고 처음 등록했다. Task `task_c7ba772c1af4`의 Dispatch `ctx_3807c6573da3`에서 요청·적용이 모두 `high`였고 완료 보고를 수신했다. 현재 Run의 재승인·교체·재시도와 구형 map 중복 기동 방지는 런처 fixture로 재현했다. |
| K05·K06·K13 | 팀장 ON·단순 1개, ON·2개, ON·전문 분해 1개, OFF·단순 1개를 검사했다. 런처 fixture에서 팀장 → Planner 내부 분해 → 승인한 팀원 배정을 확인했고, 승인 범위 밖 역할은 거부됐다. 연결된 팀장 노드의 내부 배정과 사람 승인 게이트를 DAG로 렌더했다. 구조도에서 팀장·팀원 토글 뒤 원소속·담당·협업선 변화를 확인했다. |
| K07·K12·K15 | 설치 fixture에서 독립 역할·기존 팀의 팀원·팀 전체를 추가하고 역할 정의, 팀 명단, 모델 조회, TOML·포인터를 검사했다. 대표 API 응답 변경에 대해 제공자·소비자의 판단 근거·검증·인계를 대조하고, 절별 작성자 수락·거절·재추천 제외를 확인했다. |
| K08–K11 | 별도 구조도 패치를 원본의 임시 사본에 적용해 7개 파일을 작업 사본과 바이트 단위로 비교했다. 적용한 사본에서 Node 검사와 실제 HTTP·Chromium 검사가 통과했다. 신규 A·B와 구형 프로젝트에서 13종 본문, 절별 작성자와 복수 검토자 태그, 협업 팝업, 데스크톱·모바일, 한 행 저장·재열기·충돌 처리·다른 프로젝트 파일 보존을 확인했다. [구조도 패치](../../../integrations/agent-toggle/agent-toggle.patch) |
| K16·K17 | 필수 문서에 QA 인계만 남으면 마감 검사가 실패한다. 정본·절·작성자·BL이 확인 리포트와 일치하면 통과한다. 명시 이월한 BL과 정상 BL이 섞인 장부, 잘못된 승인·타 문서나 타 BL의 근거, 미배정·설치 초안·외부 경로와 이력 전용을 재현했다. |
| K18 | 검토·승인한 v1과 달라진 v2 계획·DAG로 코디네이터가 기동되지 않는지 검사했다. 구 요구 검토·계획 승인·실행 중의 세 재개 시점을 재생했다. 실제 QA Task는 같은 Run의 진행 워터폴에 완료로 표시됐고, 이력 전용 문서 확인과 회고 측정기가 실제 Task 한 건을 읽었다. PM 정산과 복수 역할의 전체 마감 절차는 임시 자료·역할 지침으로 대조했다. |

저장소 자체 검사 21개, 신규 설치 검증 18개, 런처 회귀 57건, 대기 계약 3곳이 통과했다. DAG 자체 검사와 워터폴 예상·진행·병합·실제 ID 변환, 패치 적용 사본의 브라우저 검사도 통과했다. 같은 답변으로 신규 설치를 반복했을 때 작성 파일과 충돌은 모두 0개였다.

실제 QA 기동에는 인수용 합성 승인 응답과 이미 연결된 Orca 작업 트리를 썼다. 미등록 임시 폴더는 Orca 작업 트리 선택자로 사용할 수 없어 워커가 등록된 저장소에서 임시 설치를 읽었다. 사용자가 전역에 설치한 구조도에는 패치를 적용하지 않았다. 구조도의 모델 저장은 프로젝트에 설치된 설문 자산과 일치하는 키트가 사용자 플러그인 캐시에 있을 때 동작한다. 전체 템플릿 lint에는 처음부터 있던 워터폴 R3 지적 6건이 남아 있다.
