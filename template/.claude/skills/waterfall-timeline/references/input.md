# 입력 계약

UTF-8 JSON. 시간은 모두 분. 아래 예제를 복사해 실제 값으로 채운다.

- `title`, `estimatedAt`, `clock`, `current`: 일반 문자열. HTML을 넣지 않는다.
- `assumptions`: 문자열 배열. 워커 제한, 승인 대기·준비·감독시간의 제외 여부, 추정 근거를 명시한다.
- `maxWorkers`: 동시에 실행 가능한 작업자 수(양의 정수).
- `now`: 선택 사항, 실제 측정한 T+분. 미측정이면 생략.
- `tasks`: 비어 있지 않은 배열.
  - `id`: 고유 영문/숫자/밑줄/하이픈. `title`, `role`, `bl`(선택), `basis`: 일반 문자열.
  - `tone`: plan/dev/verify/coord/harness.
  - `status`: wait/run/done/blocked. 실제 장부에서 읽는다.
  - `deps`: 선행 ID 배열. 순환 불가.
  - `kind`: work 또는 approval. approval은 시간 미정임을 나타내며 일정상 길이 0인 표식이다. **실제 대기 0분이라는 뜻이 아니다.**
  - `estimate`: work는 `{low,likely,high}`(0 이상, 오름차순). approval은 null.
  - `schedule`: `{low:{start,end},likely:{start,end},high:{start,end}}`.
  - `resource`: 동시 사용을 금지할 자원 이름(예: visual-1, engineer-2), 생략 가능. work 하나는 maxWorkers 슬롯 하나를 쓴다. 별도 코디네이터 등은 가정에 적고 승인된 스케줄을 제공한다.

각 일정은 end-start=해당 추정값, start>=모든 선행 end를 만족해야 한다. maxWorkers와 resource를 동시에 검사한다. 현재 시간은 스케줄 좌표와 동일한 기준시각에서 측정한 값만 넣는다.

자동 산출: 시나리오별 작업 경과(max end), 작업 시간 합(sum duration), 최대 동시 작업 수. 출력 HTML은 입력 파일에 의존하지 않고 단독으로 열린다.
