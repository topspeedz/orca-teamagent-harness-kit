'use strict';
// launch.cjs — Playwright MCP 가 못 하는 작업(3D·WebGL 실측, 로그인·비밀값 주입)용 로컬 런처.
// secret-gate 훅이 MCP 입력을 거부할 때 안내하는 "포장된 길"이다. 그래서 이 파일 자체가 구조적으로 안전해야 한다:
//   - 비밀값은 PW_SECRETS_FILE(dotenv) 에서만 읽고, 이 모듈의 log() 는 로드된 값을 항상 가린다(redact).
//   - 비밀값을 argv 로 받지 않는다. 호출자가 콘솔에 값을 찍는 것까지는 못 막는다 → 호출 스크립트는 log() 만 쓸 것.
//
// Playwright 해석 순서: ① 프로젝트 devDependency(playwright → playwright-core) ② npx 캐시(@playwright/mcp 가 받아 둔 복사본) ③ 실패.
//   ②는 비결정적 경로다(캐시 구조·버전). 경고를 찍는다. @playwright/mcp 를 버전 핀하면 ②도 안정된다.
//
// 사용:
//   const { launch, loadSecrets, saveStorageState, log } = require('./.claude/scripts/browser/launch.cjs');
//   const browser = await launch();                       // headless + 이 OS 의 GPU 플래그
//   const browser = await launch({ gpu: false });         // 소프트웨어 렌더 비교용
//   const browser = await launch({ channel: 'chromium' }); // Playwright ≥1.49: headless 기본은 headless-shell(구 headless). 새 headless 는 channel:'chromium'
//   const S = loadSecrets();                               // PW_SECRETS_FILE 의 KEY=VALUE. 이후 log() 가 값을 가린다
//   await saveStorageState(context, process.env.PW_STORAGE_STATE); // 로그인 후 상태 저장 → MCP 가 PLAYWRIGHT_MCP_STORAGE_STATE 로 로드

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------------------------
// GPU 플래그 표. status 가 'measured' 가 아니면 launch() 가 경고를 찍는다. 측정은 probe-fps.cjs 로.
// 규칙: 실측하지 않은 값은 'candidate' 로 두고, probe 결과(renderer 문자열 + fps)를 적은 뒤에만 'measured' 로 올린다.
const GPU_PROFILES = {
  win32: {
    status: 'candidate', // probe-fps.cjs 로 잰 뒤 'measured' 로 올리고 measuredOn 을 적는다
    measuredOn: null,     // 예: 'Windows 11, Chromium 141, ANGLE D3D11, 60fps'
    args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11', '--enable-gpu-rasterization'],
  },
  darwin: {
    status: 'candidate',
    measuredOn: null,
    args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal'],
  },
  linux: {
    status: 'candidate',
    measuredOn: null,
    // GPU 없는 서버/CI 가 대부분 → 소프트웨어 렌더 전제. GPU 데스크톱이면 '--use-angle=gl' 또는 'vulkan' 을 probe 로 비교.
    args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
};

function gpuProfile(platform = process.platform) {
  return GPU_PROFILES[platform] || { status: 'unknown', measuredOn: null, args: [] };
}

// ---------------------------------------------------------------------------------------------
// 로그: 로드된 비밀값은 항상 가린다.
const _secretValues = new Set();
function redact(text) {
  let s = String(text);
  for (const v of _secretValues) if (v && v.length >= 4) s = s.split(v).join('***');
  return s;
}
function log(...parts) {
  process.stderr.write('[launch] ' + parts.map(redact).join(' ') + '\n');
}

// ---------------------------------------------------------------------------------------------
function compareVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function npxCacheRoots() {
  const roots = [];
  if (process.env.npm_config_cache) roots.push(path.join(process.env.npm_config_cache, '_npx'));
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  roots.push(path.join(os.homedir(), '.npm', '_npx'));
  return [...new Set(roots)];
}

function findInNpxCache() {
  const found = [];
  for (const root of npxCacheRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const hash of fs.readdirSync(root)) {
      for (const name of ['playwright', 'playwright-core']) {
        const dir = path.join(root, hash, 'node_modules', name);
        const pkg = path.join(dir, 'package.json');
        if (!fs.existsSync(pkg)) continue;
        try { found.push({ dir, name, version: JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '0.0.0' }); } catch { /* skip */ }
      }
    }
  }
  found.sort((x, y) => compareVersion(y.version, x.version) || (x.name === 'playwright' ? -1 : 1));
  return found;
}

let _resolved = null;
function resolvePlaywright() {
  if (_resolved) return _resolved;
  for (const name of ['playwright', 'playwright-core']) {
    try {
      const pw = require(name); // 이 파일이 프로젝트 트리 안에 있으면 <project>/node_modules 까지 올라가며 찾는다
      const version = safeVersion(name);
      _resolved = { pw, source: `project:${name}@${version}`, version, deterministic: true };
      return _resolved;
    } catch { /* next */ }
  }
  const cached = findInNpxCache();
  if (!cached.length) {
    throw new Error('playwright 를 찾을 수 없다. `npm i -D playwright` (권장) 또는 @playwright/mcp 를 한 번 실행해 npx 캐시를 채울 것.');
  }
  const pick = cached[0];
  log(`경고: 프로젝트에 playwright 가 없어 npx 캐시 복사본을 쓴다 (${pick.name}@${pick.version}). 비결정적 경로 — 재현 수치를 적을 때 이 버전을 함께 기록할 것.`);
  if (process.env.PW_EXPECTED_VERSION && compareVersion(process.env.PW_EXPECTED_VERSION, pick.version) !== 0) {
    log(`경고: PW_EXPECTED_VERSION=${process.env.PW_EXPECTED_VERSION} 와 다른 버전이다.`);
  }
  _resolved = { pw: require(pick.dir), source: `npx-cache:${pick.name}@${pick.version}`, version: pick.version, deterministic: false };
  return _resolved;
}
function safeVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { return 'unknown'; }
}

// ---------------------------------------------------------------------------------------------
async function launchWithMeta(opts = {}) {
  const { pw, source, version, deterministic } = resolvePlaywright();
  const profile = gpuProfile();
  const useGpu = opts.gpu !== false;
  if (useGpu && profile.status !== 'measured') {
    log(`경고: ${process.platform} 의 GPU 플래그는 '${profile.status}' (미실측). probe-fps.cjs 로 renderer/fps 를 확인하고 GPU_PROFILES 를 갱신할 것.`);
  }
  const args = [...(useGpu ? profile.args : []), ...(opts.args || [])];
  const channel = opts.channel ?? (process.env.PW_CHANNEL || undefined);
  const browser = await pw.chromium.launch({
    headless: opts.headless ?? true,
    ...(channel ? { channel } : {}),
    args,
    ...(opts.launchOptions || {}),
  });
  const meta = {
    platform: process.platform,
    playwright: source,
    playwrightVersion: version,
    deterministicResolve: deterministic,
    browserVersion: browser.version(),
    channel: channel || '(default)',
    gpu: useGpu ? { status: profile.status, measuredOn: profile.measuredOn, args: profile.args } : { status: 'disabled', args: [] },
  };
  return { browser, meta };
}

async function launch(opts = {}) {
  return (await launchWithMeta(opts)).browser;
}

// ---------------------------------------------------------------------------------------------
// 비밀값: dotenv 형식 파일에서만. 값은 이 프로세스 밖으로 내보내지 말 것(결과·스크린샷 파일명·로그 포함).
function loadSecrets(file = process.env.PW_SECRETS_FILE) {
  if (!file) throw new Error('PW_SECRETS_FILE 이 설정되지 않았다. 비밀값은 argv 가 아니라 dotenv 파일로 준다.');
  const abs = path.resolve(file);
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (abs.startsWith(projectDir + path.sep)) {
    log(`경고: 비밀 파일이 작업 폴더 안에 있다 (${path.relative(projectDir, abs)}). 워크스페이스 밖 또는 .gitignore 확인.`);
  }
  const out = {};
  for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
    _secretValues.add(v);
  }
  log(`secrets 로드: ${Object.keys(out).length}개 (${Object.keys(out).join(', ')})`); // 이름만
  return Object.freeze(out);
}

// 로그인 후 상태 저장. MCP 는 PLAYWRIGHT_MCP_STORAGE_STATE / --storage-state 로 이 파일을 서버 측에서 로드한다(값이 LLM 을 거치지 않음).
async function saveStorageState(context, file = process.env.PW_STORAGE_STATE) {
  if (!file) throw new Error('저장 경로가 없다. PW_STORAGE_STATE 또는 인자로 준다(워크스페이스 밖 권장).');
  const abs = path.resolve(file);
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (abs.startsWith(projectDir + path.sep)) log(`경고: storage state 가 작업 폴더 안에 저장된다 (${path.relative(projectDir, abs)}). 쿠키가 들어 있으니 .gitignore 필수.`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await context.storageState({ path: abs });
  log(`storage state 저장: ${abs}`); // 경로만
  return abs;
}

module.exports = { launch, launchWithMeta, resolvePlaywright, gpuProfile, GPU_PROFILES, loadSecrets, saveStorageState, log, redact };
