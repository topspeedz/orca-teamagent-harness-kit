---
name: backend-dev
description: "백엔드 개발 절차. 서버 코드, API 계약, 테스트 코드를 쓴다. backend 에이전트의 구현, 결함 수정, 시험 갱신 Task에서 읽는다. 저장 구조(backend-db), 성능(backend-performance), 보안(backend-security), 화면 코드(frontend-dev)에는 쓰지 않는다."
---

# backend-dev

`server/`의 HTTP 처리 코드를 Node 내장 모듈(`node:http`, `node:fs`)만으로 쓰고, API 계약을 `node --test`로 고정한다.

## 절차

1. spec의 수락 기준을 API마다 요청·응답·오류로 바꿔 `docs/04-architecture/architecture.md`의 계약 절에 적는다. 화면이 부르는 API이면 `frontend`와 이 계약을 맞춘다.
2. 계약마다 `test/server/`에 테스트를 먼저 쓴다. 테스트는 서버를 포트 0으로 띄우고 내장 `fetch`로 부른 뒤 닫는다. 실패를 확인한다.
3. 처리 함수는 `server/routes/`에 요청 하나당 하나로 두고, 저장은 `server/store.js`만 거친다. 테스트를 통과시키는 가장 작은 코드를 쓴다. 외부 패키지를 더하지 않는다.
4. 잘못된 입력은 400과 `{ "error": "<이유>" }`, 없는 대상은 404로 돌려준다. 오류마다 테스트가 있다.
5. `node --test`를 돌려 실패 수 0을 리포트의 `## 검증`에 적는다. 계약이 바뀌었으면 같은 Task에서 계약 절을 고친다.

## 하지 않는 것

- `web/`의 화면 코드는 고치지 않는다. `frontend`가 맡는다.
- 저장 형식 바꾸기는 `backend-db`, 응답 시간 측정은 `backend-performance`, 입력 검사 밖의 보안 점검은 `backend-security`를 따른다.
- 자기 결과를 승인하지 않는다. 리뷰와 끝 검증은 `verifier`가 한다.

## 대표 사례

- 정상: "할 일에 마감일을 넣을 수 있다" → `POST /tasks`가 `due`를 받는 계약을 적고 → 잘못된 날짜에 400을 기대하는 테스트가 먼저 실패 → 구현 → `node --test` 실패 0 → 계약 절을 갱신했다.
- 실패: 테스트가 고정 포트 3000으로 서버를 띄웠다 → 같은 에이전트의 두 워커가 동시에 돌 때 `EADDRINUSE`로 실패한다 → 포트 0으로 띄우고 `server.address().port`를 쓰게 고친다.
