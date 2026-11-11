#!/usr/bin/env node
// secret-gate.check.mjs — secret-gate.mjs 셀프테스트. 범용 이름만 쓴다(프로젝트 전용 이름 없음).
// 실행: node .claude/hooks/secret-gate.check.mjs   (실패 시 exit 1)
//
// 검사 항목: 3층 탐지 각각, 오탐 방지(Author/Email/Log in), fail-closed 3종(파일 없음·입력 깨짐·설정 깨짐),
//           storage-state 로드 경로 허용, denyTools, 그리고 "거부 사유에 값이 새지 않는가".
// 이 테스트로 못 하는 것: onFailure:"block" 동작. qa-verification 의 references/browser.md "재측정" 절대로 Claude Code 안에서 확인한다.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./secret-gate.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-'));

// 범용 프로젝트 설정(테스트용). 훅 옆의 실제 config 는 건드리지 않고 SECRET_GATE_CONFIG 로 가리킨다.
const baseCfg = path.join(tmp, 'secret-gate.config.json');
fs.writeFileSync(baseCfg, JSON.stringify({
  cookieNames: ['acme_admin_'],
  envNames: ['ACME_'],
  extraValuePatterns: ['\\bacme_live_[A-Za-z0-9]{24,}\\b'],
}, null, 2));
const denyToolsCfg = path.join(tmp, 'deny-tools.json');
fs.writeFileSync(denyToolsCfg, JSON.stringify({ denyTools: ['browser_cookie_set'] }));
const brokenCfg = path.join(tmp, 'broken.json');
fs.writeFileSync(brokenCfg, '{ not json');

// 합성 비밀값(실제 값 아님). 거부 사유에 이 문자열이 나오면 실패.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0X3VzZXIifQ.c2lnbmF0dXJlX3Rlc3RfdmFsdWVfMTIzNDU2';
const PASSWORD = 'hunter2-synthetic';
// joined at run time so the file holds no literal a secret scanner would take for a real access token
const SHP_TOKEN = ['shp', 'at_', '0123456789abcdef0123456789abcdef'].join('');
const LEAK_MARKERS = [JWT, PASSWORD, SHP_TOKEN, 'acme_live_'];

const secretFile = path.join(tmp, 'with-secret.js');
fs.writeFileSync(secretFile, `await page.setExtraHTTPHeaders({ Cookie: 'sid=${JWT}' });\n`);
const cleanFile = path.join(tmp, 'clean.js');
fs.writeFileSync(cleanFile, 'await page.goto("http://localhost:3000"); await page.screenshot({ path: "out.png" });\n');

const T = (short) => `mcp__playwright__${short}`;

function run(ev, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof ev === 'string' ? ev : JSON.stringify(ev),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, SECRET_GATE_CONFIG: baseCfg, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (r.error) return { decision: 'crash', reason: String(r.error) };
  if (r.status !== 0) return { decision: 'exit' + r.status, reason: r.stderr };
  if (!r.stdout.trim()) return { decision: 'allow', reason: '' };
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput;
    return { decision: o.permissionDecision, reason: o.permissionDecisionReason || '' };
  } catch { return { decision: 'bad-output', reason: r.stdout }; }
}

const cases = [
  // ---- allow 해야 하는 것(오탐 방지) ----
  ['navigate: 일반 URL', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost:3000/products?page=2&sort=asc' } }, 'allow'],
  ['navigate: 경로에 auth 단어(경로는 안 봄)', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost:3000/auth/callback' } }, 'allow'],
  ['fill_form: Email 만', { tool_name: T('browser_fill_form'), tool_input: { fields: [{ name: 'Email', type: 'textbox', ref: 'e1', value: 'a@b.c' }] } }, 'allow'],
  ['fill_form: Author 필드(auth 오탐 금지)', { tool_name: T('browser_fill_form'), tool_input: { fields: [{ name: 'Author', type: 'textbox', ref: 'e1', value: 'Kim' }] } }, 'allow'],
  ['click: Log in 버튼(payload 없음)', { tool_name: T('browser_click'), tool_input: { element: 'Log in button', ref: 'e3' } }, 'allow'],
  ['press_key: key 파라미터(bare key 는 비밀 아님)', { tool_name: T('browser_press_key'), tool_input: { key: 'Enter' } }, 'allow'],
  ['evaluate: 무해한 코드', { tool_name: T('browser_evaluate'), tool_input: { function: '() => document.title' } }, 'allow'],
  ['evaluate: localStorage 일반 키', { tool_name: T('browser_evaluate'), tool_input: { function: '() => localStorage.getItem("theme")' } }, 'allow'],
  ['run_code: 깨끗한 파일', { tool_name: T('browser_run_code'), tool_input: { filename: cleanFile } }, 'allow'],
  ['set_storage_state: 파일 경로만', { tool_name: T('browser_set_storage_state'), tool_input: { filename: path.join(tmp, 'auth-state.json') } }, 'allow'],
  ['비-Playwright 도구는 이 훅 대상 아님', { tool_name: 'Bash', tool_input: { command: `echo ${JWT}` } }, 'allow'],

  // ---- ① 값 모양 ----
  ['run_code: JWT', { tool_name: T('browser_run_code'), tool_input: { code: `await page.setExtraHTTPHeaders({ Authorization: 'Bearer ${JWT}' })` } }, 'deny'],
  ['type: shp 접두어 토큰 모양', { tool_name: T('browser_type'), tool_input: { element: 'Search box', ref: 'e1', text: SHP_TOKEN } }, 'deny'],
  ['type: 프로젝트 추가 패턴(extraValuePatterns)', { tool_name: T('browser_type'), tool_input: { element: 'Note', ref: 'e1', text: 'acme_live_ABCDEFGHIJKLMNOPQRSTUVWX12' } }, 'deny'],

  // ---- ② 키·필드 이름 ----
  ['fill_form: Password 필드', { tool_name: T('browser_fill_form'), tool_input: { fields: [{ name: 'Email', type: 'textbox', ref: 'e1', value: 'a@b.c' }, { name: 'Password', type: 'textbox', ref: 'e2', value: PASSWORD }] } }, 'deny'],
  ['type: element 가 Password', { tool_name: T('browser_type'), tool_input: { element: 'Password textbox', ref: 'e2', text: PASSWORD } }, 'deny'],
  ['type: element 가 camelCase authToken', { tool_name: T('browser_type'), tool_input: { element: 'authToken input', ref: 'e2', text: 'x' } }, 'deny'],
  ['navigate: 프래그먼트 access_token', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost:3000/cb#access_token=abc123&state=1' } }, 'deny'],
  ['navigate: 쿼리 session', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost:3000/?session=abc' } }, 'deny'],
  ['임의 키 이름 token', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost', token: 'abc' } }, 'deny'],

  // ---- 코드 구조 ----
  ['evaluate: addCookies', { tool_name: T('browser_evaluate'), tool_input: { function: '() => context.addCookies([{name:"x",value:"y"}])' } }, 'deny'],
  ['evaluate: document.cookie 읽기(반환값이 기록에 남음)', { tool_name: T('browser_evaluate'), tool_input: { function: '() => document.cookie' } }, 'deny'],
  ['evaluate: context.cookies() 덤프', { tool_name: T('browser_evaluate'), tool_input: { function: 'async () => await page.context().cookies()' } }, 'deny'],
  ['evaluate: localStorage 비밀 키', { tool_name: T('browser_evaluate'), tool_input: { function: '() => localStorage.getItem("sb-access-token")' } }, 'deny'],
  ['run_code: process.env 비밀 변수(일반 규칙)', { tool_name: T('browser_run_code'), tool_input: { code: 'const t = process.env.SOME_API_TOKEN;' } }, 'deny'],

  // ---- ③ 프로젝트 목록 ----
  ['run_code: 프로젝트 쿠키 이름=값', { tool_name: T('browser_run_code'), tool_input: { code: 'document.title; const c = "acme_admin_session=abc";' } }, 'deny'],
  ['fill_form: 프로젝트 쿠키 이름이 필드명', { tool_name: T('browser_fill_form'), tool_input: { fields: [{ name: 'acme_admin_code', type: 'textbox', ref: 'e1', value: '1' }] } }, 'deny'],
  ['run_code: 프로젝트 env 접두어(비밀 단어 없어도)', { tool_name: T('browser_run_code'), tool_input: { code: 'const r = process.env.ACME_REGION;' } }, 'deny'],

  // ---- 파일 검사 ----
  ['run_code: 파일 안에 Cookie 헤더+JWT', { tool_name: T('browser_run_code'), tool_input: { filename: secretFile } }, 'deny'],
  ['run_code: 파일 없음 → fail-closed', { tool_name: T('browser_run_code'), tool_input: { filename: path.join(tmp, 'nope.js') } }, 'deny'],
  ['run_code: 디렉터리 경로 → fail-closed', { tool_name: T('browser_run_code'), tool_input: { filename: tmp } }, 'deny'],

  // ---- fail-closed ----
  ['stdin 깨짐 → fail-closed', '{ not json', 'deny'],
  ['설정 JSON 깨짐 → fail-closed', { tool_name: T('browser_navigate'), tool_input: { url: 'http://localhost' } }, 'deny', { SECRET_GATE_CONFIG: brokenCfg }],

  // ---- denyTools ----
  ['denyTools: browser_cookie_set', { tool_name: T('browser_cookie_set'), tool_input: { cookies: [{ name: 'theme', value: 'dark' }] } }, 'deny', { SECRET_GATE_CONFIG: denyToolsCfg }],
];

let fail = 0;
const rows = [];
for (const [name, ev, expect, env] of cases) {
  const r = run(ev, env);
  let ok = r.decision === expect;
  let note = '';
  if (r.decision === 'deny') {
    const leaked = LEAK_MARKERS.filter((m) => r.reason.includes(m));
    if (leaked.length) { ok = false; note = ' ← 거부 사유에 값이 노출됨'; }
  }
  if (!ok) fail++;
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${expect.padEnd(5)} got=${r.decision.padEnd(6)} ${name}${note}`);
  if (!ok && r.reason) rows.push(`      reason: ${r.reason.split('\n')[0].slice(0, 160)}`);
}

console.log(rows.join('\n'));
console.log('참고: onFailure:"block" 은 여기서 검증하지 못한다(Claude Code 안에서 확인).');
console.log(`secret-gate.check: ${cases.length - fail}/${cases.length} passed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
