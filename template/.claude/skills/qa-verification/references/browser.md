# 브라우저 검증

> 읽는 시점: 브라우저를 여는 QA Task를 받았을 때. Playwright MCP나 Claude Code를 업데이트한 뒤에는 4절을 다시 본다.

## 1. 병렬

- 옵션 없는 Playwright MCP(공식 플러그인의 기본값)는 작업 폴더마다 영구 프로필 하나를 잠근다. 그래서 같은 폴더의 두 번째 워커부터 `Browser is already in use … use --isolated`나 `Target page, context or browser has been closed`로 실패한다.
- 키트는 `.claude/settings.json`의 `env`에 두 줄을 넣어 둔다. 이 두 줄은 플러그인이 띄우는 Playwright MCP까지 전달되고, 워커와 창구 세션 모두에 적용된다.

  ```json
  "env": {
    "PLAYWRIGHT_MCP_ISOLATED": "true",
    "PLAYWRIGHT_MCP_HEADLESS": "true"
  }
  ```

  잠금을 푸는 것은 `PLAYWRIGHT_MCP_ISOLATED`다. `PLAYWRIGHT_MCP_HEADLESS`는 창을 띄우지 않게 한다.
- **사용자가 직접 여는 세션(창구 포함)만 예외로 둘 수 있다.** 그 세션을 `claude --settings .claude/front-desk.settings.json`으로 열면 두 줄이 `"false"`로 덮여, 그 세션의 브라우저는 창이 보이고 로그인 상태 같은 프로필이 유지된다. 워커는 이 파일로 띄우지 않는다. 둘 이상이 같은 프로필을 잠가 병렬이 깨진다.
- 워커 한 종류에만 다른 설정을 주는 방법은 없다. Orca는 워커에게 환경 변수를 넘기지 않고, 팀장이 띄우는 팀원에게는 전용 설정 파일도 줄 수 없다. 그래서 기본값을 프로젝트 전체에 두고 사용자 세션만 예외로 한다.
- **병렬은 워커 단위다.** Playwright MCP 서버는 세션마다 하나라서, 한 세션 안의 서브에이전트끼리는 브라우저를 동시에 쓰지 못한다. 브라우저 검증을 나누려면 QA 워커를 영역별로 띄운다(`team-qa`의 배치).
- 격리하려고 플러그인을 끄지 않는다. 워커별 MCP 설정 파일이나 `--strict-mcp-config`를 만들지 않고, 업데이트 때 덮이는 플러그인 cache의 `.mcp.json`도 고치지 않는다. 필요한 설정(격리, 헤드리스, storage state, GPU)은 `PLAYWRIGHT_MCP_*` 환경 변수로 준다.
- `claude mcp get <Playwright 서버 이름>`으로 본 args에 `--user-data-dir`가 있으면 격리 설정과 부딪혀 두 줄이 듣지 않는다. 있으면 뺀다.
- Codex 워커는 Codex의 MCP 설정 `args`에 `--isolated --headless`를 넣는다. 이 경로는 재 보지 않았다.

## 2. 비밀값

- 쿠키, 토큰, 비밀번호를 Playwright MCP 입력에 넣지 않는다. MCP는 받은 입력과 실행한 코드를 결과에 되돌려 주므로, 넣은 값이 대화 기록에 남는다.
- 쿠키를 읽는 것도 같다(`document.cookie`, `context.cookies()`). 반환값이 기록으로 돌아온다.
- 문구만으로는 지켜지지 않아 `secret-gate` 훅이 막는다. `.claude/settings.json`의 PreToolUse에 Playwright 도구 매처로 등록돼 있고, 훅이 죽거나 시간을 넘겨도 막도록 `onFailure: "block"`을 쓴다(Claude Code 2.1.295 이상에서 동작한다).
- 훅은 세 가지를 본다. 값의 모양(JWT, Bearer, 알려진 토큰 접두어), 키와 필드 이름(`Password`, `authToken` 등), 프로젝트 목록이다. 프로젝트의 쿠키 이름과 환경 변수 접두어는 `.claude/hooks/secret-gate.config.json`에 **이름만** 적는다. 훅 파일 자체는 고치지 않는다.
- 훅이 거부하면 우회하지 않는다. 로그인이 필요한 검증은 `.claude/scripts/browser/launch.cjs`로 한다. 비밀값은 `PW_SECRETS_FILE`이 가리키는 dotenv 파일에서 `loadSecrets()`로만 읽고, 어디에도 출력하지 않는다. 그 파일은 작업 폴더 밖에 둔다.
- 훅이 못 잡는 것: 이름이 평범한 비밀 필드(예: "Code")는 `secret-gate.config.json`의 `cookieNames`에 넣거나 `denyTools`로 그 도구를 막는다. 직접 짠 스크립트가 값을 `console.log`로 찍는 것은 막지 못한다. 스크립트에서는 `launch.cjs`의 `log()`만 쓴다.
- 오탐이면 값을 대화에 붙여 설명하지 말고 `secret-gate.config.json`의 규칙을 고친다.

## 3. 캡처와 3D

- **화면을 여러 장 찍는 캡처와 3D·WebGL 실측은 Playwright MCP로 하지 않는다.** `launch.cjs`의 `launch()`로 헤드리스 스크립트를 돌려 결과를 파일로 저장하고, 판정은 그 파일을 읽어서 한다. 워커끼리 서로 잠그지 않고, 이미지가 대화에 쌓이지 않는다.

  ```js
  const { launch, log } = require('./.claude/scripts/browser/launch.cjs');
  const browser = await launch();   // 헤드리스, 이 OS의 GPU 플래그
  ```

- `launch()`는 프로젝트에 설치된 `playwright`를 먼저 쓰고, 없으면 Playwright MCP가 받아 둔 npx 캐시의 복사본을 쓰면서 경고를 찍는다. 캐시 복사본은 버전이 고정되지 않으므로, 수치를 적을 때 경고에 찍힌 버전을 함께 적는다.
- 브라우저 실행 파일이 없다는 오류(`Executable doesn't exist …`)가 나면 `PW_CHANNEL=chrome`으로 설치된 Chrome을 쓰거나 `npx playwright install chromium`으로 받는다. Playwright MCP는 설치된 Chrome으로 돌 수 있어서, MCP가 된다고 런처가 쓸 브라우저까지 있는 것은 아니다.
- 3D·WebGL은 GPU 플래그가 있어야 한다. MCP의 헤드리스 브라우저는 소프트웨어로 그려 프레임이 한 자릿수로 떨어진다. `launch.cjs`의 OS별 플래그 표는 `node .claude/scripts/browser/probe-fps.cjs`로 잰 OS에서만 믿는다. 출력의 renderer에 SwiftShader가 없고 `--no-gpu`와 fps 차이가 나면 그 OS의 `status`를 `measured`로 올린다.
- **성능 수치는 병렬 부하에서 판정하지 않는다.** 다른 검증이 끝난 뒤 혼자, 여러 번 잰다.

## 4. 재측정

- 플러그인은 `@latest`라서 버전을 고정할 수 없다. 브라우저로 잰 수치를 리포트에 적을 때는 그 옆에 `@playwright/mcp` 버전과 Claude Code 버전을 함께 적는다.
- 둘 중 하나가 바뀌면 세 가지를 다시 돌린다.
  1. 같은 폴더에서 워커 둘이 동시에 Playwright MCP를 쓴다. 둘 다 성공해야 한다.
  2. `node .claude/hooks/secret-gate.check.mjs`
  3. `node .claude/scripts/browser/probe-fps.cjs`
- 재 보지 않았다고 적힌 항목은 다시 재현하기 전까지 규칙을 바꾸지 않는다.
