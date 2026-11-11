#!/usr/bin/env node
// secret-gate.mjs — Claude Code PreToolUse 훅.
// Playwright MCP 도구 입력에 비밀값(쿠키·토큰·비밀번호 등)이 들어가면 deny.
//
// 왜: MCP는 실행한 코드·입력을 결과에 되돌려 주므로, 입력에 들어간 비밀값은 대화 기록에 남는다.
// 어떻게: 3층 탐지. ① 값 모양(JWT, Bearer, 알려진 접두어) ② 키·필드 이름 휴리스틱 ③ 프로젝트 목록(별도 config)
// 원칙:
//   - fail-closed: 내부 오류·파일 못 읽음·설정 깨짐 → 전부 deny. settings의 onFailure:"block"은 crash/timeout을 추가로 덮는다.
//   - 거부 사유에 매치된 "값"은 절대 넣지 않는다(값이 대화 기록에 남는 것이 막으려는 사고 그 자체다). 규칙 이름과 위치만.
//   - 이 파일은 프로젝트별로 수정하지 않는다. 프로젝트 설정은 같은 폴더의 secret-gate.config.json 에만 쓴다.
//
// 등록: .claude/settings.json 의 PreToolUse, 매처는 아래 TOOL_MATCH 와 같은 식, onFailure:"block". 설정·셀프테스트도 같은 폴더에 있다.
// 입력(stdin JSON): { tool_name, tool_input, cwd, session_id, ... }
// 출력: deny → hookSpecificOutput JSON + exit 0. allow → 출력 없음 + exit 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// settings.json 의 matcher 와 같은 식. 매처가 넓어져도 이 훅은 Playwright 도구에만 작용한다.
const TOOL_MATCH = /^(functions\.|tools\.)?mcp__.*[Pp]laywright.*/;

const DEFAULTS = {
  // ③ 프로젝트 목록 — 접두어 또는 완전 이름. 예: ["acme_admin_", "sb-access-token"]
  cookieNames: [],
  // ③ 프로젝트 환경변수 접두어 — 코드 문자열 안의 process.env.X / $X / ${X} 참조를 막는다. 예: ["ACME_", "SUPABASE_"]
  envNames: [],
  // 추가 값 모양 정규식(문자열). 예: ["\\bacme_live_[A-Za-z0-9]{24,}\\b"]
  extraValuePatterns: [],
  // 도구 이름(서버 접두어 제외)이 여기 있으면 입력과 무관하게 deny. 예: ["browser_cookie_set"]
  denyTools: [],
  // 이 도구들의 파일 경로 파라미터는 파일 내용까지 검사한다(못 읽으면 deny).
  fileScanTools: ['browser_run_code'],
  filePathParams: ['filename', 'file', 'path'],
  maxFileBytes: 1_000_000,
  // 거부 사유에서 안내할 도우미 경로(프로젝트 기준 상대). 없으면 일반 문구로 분기.
  helperPath: '.claude/scripts/browser/launch.cjs',
};

// ① 값 모양 ---------------------------------------------------------------
const VALUE_PATTERNS = [
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
  ['basic-auth', /\bBasic\s+[A-Za-z0-9+/=]{16,}/],
  ['shp-token', /\bshp(at|ca|pa|ss|ua)_[0-9a-fA-F]{16,}\b/],
  ['google-oauth-secret', /\bGOCSPX-[A-Za-z0-9_-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['openai-like', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['github', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe', /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['cookie-header', /\b(Set-Cookie|Cookie)\s*:\s*[^\s=]+=/i],
  ['authorization-header', /\bAuthorization\s*:\s*\S+/i],
];

// 코드 문자열(browser_run_code / browser_evaluate / 파일 내용)에서 막는 구조 ----------
const CODE_PATTERNS = [
  ['addCookies', /\.addCookies\s*\(/],
  ['cookies-dump', /\.cookies\s*\(/],                 // context.cookies() → 결과에 쿠키 값이 그대로 실린다
  ['document.cookie', /document\.cookie\b/],           // 읽기도 막는다: 반환값이 대화 기록으로 간다
  ['storageState-inline', /storageState\s*:\s*\{/],
  ['env-read', /process\.env\.[A-Za-z0-9_]*(TOKEN|SECRET|KEY|PASS|PWD|COOKIE|SESSION|AUTH|CREDENTIAL)[A-Za-z0-9_]*/i],
  ['setExtraHTTPHeaders-auth', /setExtraHTTPHeaders\s*\([^)]*\b(Authorization|Cookie)\b/i],
];
// localStorage/sessionStorage 는 키 이름이 비밀값스러울 때만.
const STORAGE_ACCESS = /(localStorage|sessionStorage)\.(setItem|getItem)\s*\(\s*['"`]([^'"`]+)/g;

// ② 키·필드 이름 휴리스틱 -------------------------------------------------------
// 식별자를 단어로 쪼갠 뒤(camelCase, snake_case) 단어 경계로 본다 → "Author" 는 안 걸리고 "authToken" 은 걸린다.
const KEY_WORDS = /\b(auth|authn|authz|authentication|authorization|session|token|secret|passw\w*|pwd|cookie|cookies|api ?key|apikey|access ?key|private ?key|csrf|xsrf|credentials?|bearer|otp|mfa|refresh ?token|id ?token)\b/i;
const splitIdent = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.:/]+/g, ' ');
const isSecretName = (s) => KEY_WORDS.test(splitIdent(s));

// 폼 필드 형태의 객체: 설명 키가 비밀값 이름이고 payload 키가 있으면 deny.
const DESCRIPTOR_KEYS = ['name', 'label', 'element', 'field', 'selector', 'description', 'placeholder'];
const PAYLOAD_KEYS = ['value', 'values', 'text', 'content', 'cookie'];

// ------------------------------------------------------------------------------
function loadConfig() {
  // 기본: 이 훅 파일과 같은 폴더의 secret-gate.config.json. SECRET_GATE_CONFIG 로 덮어쓸 수 있다(셀프테스트용).
  const p = process.env.SECRET_GATE_CONFIG || path.join(HERE, 'secret-gate.config.json');
  if (!fs.existsSync(p)) return { ...DEFAULTS, _configPath: null, _extra: [] };
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')); // 깨진 JSON → throw → deny(fail-closed)
  const cfg = { ...DEFAULTS, ...raw, _configPath: p };
  cfg._extra = (cfg.extraValuePatterns || []).map((s) => new RegExp(s));
  return cfg;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchesProjectName = (s, names) => {
  const t = String(s);
  return (names || []).some((n) => t === n || t.startsWith(n) || t.toLowerCase().includes(String(n).toLowerCase()));
};

function scanString(s, at, out, cfg) {
  for (const [rule, re] of VALUE_PATTERNS) if (re.test(s)) out.push({ layer: 'value-shape', rule, at });
  for (const re of cfg._extra) if (re.test(s)) out.push({ layer: 'value-shape', rule: 'project-pattern', at });
  for (const [rule, re] of CODE_PATTERNS) if (re.test(s)) out.push({ layer: 'code', rule, at });

  for (const m of s.matchAll(STORAGE_ACCESS)) {
    if (isSecretName(m[3]) || matchesProjectName(m[3], cfg.cookieNames)) out.push({ layer: 'code', rule: 'storage-secret-key', at });
  }
  // URL 쿼리·프래그먼트 파라미터 이름 (?token=…, #access_token=…)
  for (const m of s.matchAll(/[?#&]([A-Za-z0-9_\-.%]+)=([^&\s#'"]+)/g)) {
    if (isSecretName(m[1]) || matchesProjectName(m[1], cfg.cookieNames)) out.push({ layer: 'url-param', rule: 'secret-param-name', at });
  }
  // ③ 프로젝트 쿠키 이름이 "이름=값" / "이름: 값" 꼴로 등장
  for (const n of cfg.cookieNames || []) {
    if (new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(n)}[A-Za-z0-9_\\-]*\\s*[=:]\\s*\\S`).test(s)) out.push({ layer: 'project-list', rule: 'cookie-name', at });
  }
  // ③ 프로젝트 환경변수 참조
  for (const n of cfg.envNames || []) {
    if (new RegExp(`(process\\.env\\.|\\$\\{?|env\\[['"\`])${escapeRe(n)}[A-Za-z0-9_]*`).test(s)) out.push({ layer: 'project-list', rule: 'env-name', at });
  }
}

function walk(node, at, out, cfg) {
  if (typeof node === 'string') return scanString(node, at, out, cfg);
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`, out, cfg));
  if (!node || typeof node !== 'object') return;

  const payloadKey = PAYLOAD_KEYS.find((k) => node[k] !== undefined && node[k] !== null && node[k] !== '');
  if (payloadKey) {
    for (const dk of DESCRIPTOR_KEYS) {
      const d = node[dk];
      if (typeof d === 'string' && (isSecretName(d) || matchesProjectName(d, cfg.cookieNames))) {
        out.push({ layer: 'field-name', rule: dk, at: `${at}.${dk}→${payloadKey}` });
        break;
      }
    }
  }
  for (const [k, v] of Object.entries(node)) {
    const kp = `${at}.${k}`;
    const primitive = v !== null && v !== '' && typeof v !== 'object';
    if (primitive && !DESCRIPTOR_KEYS.includes(k) && (isSecretName(k) || matchesProjectName(k, cfg.cookieNames))) {
      out.push({ layer: 'key-name', rule: 'secret-key', at: kp });
    }
    walk(v, kp, out, cfg);
  }
}

function scanFiles(shortTool, input, cfg, projectDir, out) {
  if (!cfg.fileScanTools.includes(shortTool) || !input || typeof input !== 'object') return;
  for (const k of cfg.filePathParams) {
    const v = input[k];
    if (typeof v !== 'string' || !v) continue;
    const abs = path.isAbsolute(v) ? v : path.resolve(projectDir, v);
    let st;
    try { st = fs.statSync(abs); } catch { out.push({ layer: 'file', rule: 'unreadable(fail-closed)', at: `tool_input.${k}` }); continue; }
    if (!st.isFile()) { out.push({ layer: 'file', rule: 'not-a-file(fail-closed)', at: `tool_input.${k}` }); continue; }
    if (st.size > cfg.maxFileBytes) { out.push({ layer: 'file', rule: 'too-large(fail-closed)', at: `tool_input.${k}` }); continue; }
    scanString(fs.readFileSync(abs, 'utf8'), `file(${k})`, out, cfg);
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function formatReason(findings, cfg, projectDir) {
  const seen = new Set();
  const lines = [];
  for (const f of findings) {
    const key = `${f.layer}:${f.rule}@${f.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${f.layer}(${f.rule}) @ ${f.at}`);
    if (lines.length >= 6) { lines.push('…'); break; }
  }
  const helperAbs = path.resolve(projectDir, cfg.helperPath);
  const alt = fs.existsSync(helperAbs)
    ? `대안: 로컬 스크립트에서 require('${cfg.helperPath}').launch() 로 브라우저를 띄우고, 비밀값은 PW_SECRETS_FILE(dotenv) 로만 주입한다. 값은 어떤 경로로도 출력·로그하지 않는다.`
    : `대안: 프로젝트의 playwright 라이브러리로 로컬 스크립트를 쓰고, 비밀값은 env/파일로만 주입한다(값 출력·로그 금지). 도우미(.claude/scripts/browser/launch.cjs)가 없다 — 하네스 세팅을 다시 돌려 채운다.`;
  const cfgNote = cfg._configPath
    ? `오탐이면 ${path.relative(projectDir, cfg._configPath)} 규칙을 조정한다(값을 대화에 붙여 설명하지 말 것).`
    : `오탐이면 훅과 같은 폴더에 secret-gate.config.json 을 만들어 조정한다(값을 대화에 붙여 설명하지 말 것).`;
  return [
    '[secret-gate] Playwright MCP 입력에 비밀값(또는 그렇게 보이는 것)이 있어 차단했다. 비밀값·로그인·쿠키는 MCP로 보내지 않는다.',
    `탐지: ${lines.join('; ')}`,
    alt,
    cfgNote,
  ].join('\n');
}

// ------------------------------------------------------------------------------
async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;

  let ev;
  try { ev = JSON.parse(raw); }
  catch { return deny('[secret-gate] 훅 입력(JSON)을 해석할 수 없어 차단(fail-closed).'); } // 메시지에 입력 조각을 넣지 않는다

  const toolName = String(ev?.tool_name ?? '');
  if (!TOOL_MATCH.test(toolName)) return process.exit(0); // 우리 대상 아님

  const projectDir = process.env.CLAUDE_PROJECT_DIR || ev.cwd || process.cwd();
  const cfg = loadConfig();
  const shortTool = toolName.split('__').pop();

  if ((cfg.denyTools || []).includes(shortTool)) {
    return deny(`[secret-gate] 도구 ${shortTool} 는 이 프로젝트에서 금지(denyTools). ${cfg._configPath ? path.relative(projectDir, cfg._configPath) : 'secret-gate.config.json'} 참고.`);
  }

  const findings = [];
  walk(ev.tool_input ?? {}, 'tool_input', findings, cfg);
  scanFiles(shortTool, ev.tool_input, cfg, projectDir, findings);

  if (findings.length) return deny(formatReason(findings, cfg, projectDir));
  process.exit(0);
}

main().catch((e) => {
  // 오류 메시지에 입력 조각이 섞일 수 있으므로(JSON 오류 등) 종류만 적는다.
  deny(`[secret-gate] 내부 오류(${e?.constructor?.name ?? 'Error'})로 차단(fail-closed). 설정 파일·파일 경로를 확인할 것.`);
});
