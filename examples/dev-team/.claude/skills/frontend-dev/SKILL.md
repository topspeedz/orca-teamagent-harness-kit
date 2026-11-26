---
name: frontend-dev
description: "프론트엔드 개발 절차. 화면 코드, 상태 관리, 백엔드 계약을 부르는 코드를 쓴다. frontend 에이전트의 구현과 결함 수정 Task에서 읽는다. 흐름과 모양의 설계(frontend-ux, frontend-ui), 테스트 코드(frontend-test), 서버 코드(backend-dev)에는 쓰지 않는다."
---

# frontend-dev

`web/`의 화면 코드를 브라우저 표준 API만으로 쓴다. 화면 로직은 DOM 없이 `node --test`로 도는 모듈에 두고, 화면 코드는 그 모듈을 부르기만 한다.

## 절차

1. spec의 백로그 항목과 수락 기준을 읽고, 화면이 부르는 API의 요청·응답·오류를 `backend`가 쓰는 API 계약 문서 `docs/05-api/draft.md`에서 확인한다. 계약이 없으면 `backend`와 협의하고, 정해지기 전에는 구현하지 않는다.
2. 화면 로직(상태 계산, 입력 검사, 응답을 화면 값으로 바꾸는 함수)은 `web/lib/`의 ES 모듈에 둔다. DOM을 만지는 코드는 `web/app.js` 한 곳에서 그 함수를 부른다. 통과 조건: `web/lib/`의 파일이 `document`와 `window`를 참조하지 않는다.
3. `frontend-test`의 절차로 쓴 테스트가 실패하는 것을 본 뒤, 그 테스트를 통과시키는 가장 작은 코드를 쓴다. 외부 패키지를 더하지 않는다.
4. 빈 목록, 로딩, 서버 오류(4xx, 5xx)마다 화면 값이 수락 기준과 맞는지 테스트로 확인한다.
5. `node --test`를 돌려 실패 수 0을 리포트의 `## 검증`에 적는다. 화면의 사실이 바뀌었으면 같은 Task에서 `docs/03-ui-ux/ui-spec.md`의 해당 절을 고친다.

## 하지 않는 것

- `server/`의 코드와 API 응답 형식은 고치지 않는다. `backend`가 맡는다.
- 테스트를 쓰는 규칙은 `frontend-test`를 따른다.
- 브라우저로 화면을 열어 하는 확인은 `verifier`가 한다.

## 대표 사례

- 정상: "할 일 목록을 마감일 순으로 보여 준다" → `web/lib/sort-tasks.js`의 테스트(마감일 없는 항목은 끝)가 먼저 실패 → 구현 → `node --test` 실패 0 → `ui-spec.md`의 목록 절에 정렬 규칙을 적었다.
- 실패: 정렬을 `web/app.js`의 DOM 코드 안에 썼다 → DOM 없이는 돌지 않아 `node --test`에 정렬 테스트가 없다는 것이 리포트의 `## 검증`에서 드러난다 → 정렬 함수를 `web/lib/`로 옮기고 테스트를 먼저 쓴 뒤 다시 구현한다.
