// PreToolUse(Bash|PowerShell): commands that need human approval. Interactive modes are asked by permissions.ask;
// any other mode (bypass etc.) is denied here. Verdict goes to stdout JSON; exit code is always 0.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ASKED_MODES = ['default', 'acceptEdits', 'plan'];

// shortcut: 조각마다 접두어를 본다. 별칭·함수·변수 확장($G push)·eval·스크립트 파일·xargs·인자를 따로 받는 git 전역 옵션(--git-dir x)은 못 잡는다. 이런 우회가 확인되면 셸 파서로 바꾼다.
const SEP = new Set([';', '&', '|', '\n', '(', ')', '{', '}', '`']);
const LEAD = /^(?:(?:if|then|do|else|elif|while|until|!|env|command|exec|nohup|time)\s+|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)/;
const SHELL_C = /^(?:bash|sh|zsh|dash|pwsh|powershell)(?:\.exe)?\s+(?:-\S+\s+)*?-(?:\w*c|command)\s+([\s\S]*)$/i;
const GIT_OPTS = /^git(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))+(?=\s)/;
const HEREDOC = /^<<(-?)[ \t]*(?:'([\w.-]+)'|"([\w.-]+)"|\\([\w.-]+))/;
const TO_FILE = /\s1?>>?\s*[^&\s>]/;

// One piece without its leading keywords and VAR=value assignments.
function bare(piece) {
  let p = piece.trim();
  for (let prev; prev !== p;) { prev = p; p = p.replace(LEAD, ''); }
  return p;
}

// Index just past the heredoc's terminator line, or -1 when the body never ends.
function bodyEnd(command, newline, { word, dash }) {
  for (let s = newline + 1; s < command.length;) {
    const e = command.indexOf('\n', s);
    const end = e < 0 ? command.length : e;
    const line = command.slice(s, end);
    if ((dash ? line.replace(/^\t+/, '') : line) === word) return end;
    s = end + 1;
  }
  return -1;
}

// Splits at separators outside quotes; inside double quotes only $( and ` start a new piece. Backslash is not an escape (fails closed).
// A heredoc body is skipped as text only when `cat` redirects it to a file under a quoted delimiter: nothing in it expands or runs.
// Every other heredoc body (unquoted delimiter, another command, a pipe, no terminator) is still read as commands (fails closed).
function pieces(command) {
  const out = [];
  let cur = '';
  let quote = null;
  let here = null; // the only heredoc opened on this line, when its delimiter is quoted
  let seen = 0; // heredoc operators on this line
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { if (c === "'") quote = null; cur += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '`' || (c === '$' && command[i + 1] === '(')) { out.push(cur); cur = ''; if (c === '$') i++; continue; }
      cur += c;
      continue;
    }
    if (c === '<' && command[i + 1] === '<' && command[i - 1] !== '<' && command[i + 2] !== '<') {
      const m = HEREDOC.exec(command.slice(i));
      here = ++seen === 1 && m ? { word: m[2] ?? m[3] ?? m[4], dash: !!m[1], at: out.length } : null;
    }
    if (c === '\n') {
      // here.at === out.length: no separator split the line after the heredoc operator
      const end = here && here.at === out.length && /^cat\s/.test(bare(cur)) && TO_FILE.test(cur) ? bodyEnd(command, i, here) : -1;
      here = null;
      seen = 0;
      if (end >= 0) { out.push(cur); cur = ''; i = end - 1; continue; }
    }
    if (c === "'" || c === '"') quote = c;
    if (SEP.has(c)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function matches(command, prefix) {
  const words = prefix.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`^${words.join('\\s+')}`);
  return pieces(command).some((piece) => {
    const p = bare(piece);
    const inner = p.match(SHELL_C);
    if (inner && matches(inner[1].trim().replace(/^(["'])([\s\S]*)\1$/, '$2'), prefix)) return true;
    return re.test(p.replace(GIT_OPTS, 'git'));
  });
}

export function decide(payload, prefixes) {
  if (!prefixes?.length) return null;
  if (!payload || typeof payload !== 'object') return { deny: 'approval-gate: 입력을 해석하지 못했다(fail-closed).' };
  const command = payload.tool_input?.command;
  if (typeof command !== 'string') return { deny: 'approval-gate: tool_input.command가 문자열이 아니다(fail-closed).' };
  const prefix = prefixes.find((p) => matches(command, p));
  if (!prefix || ASKED_MODES.includes(payload.permission_mode)) return null;
  return { deny: `${prefix}는 사람 승인이 필요하다. Orca 워커면 orca orchestration ask로 코디네이터에게 올리고, 아니면 사용자에게 묻는다.` };
}

// realpath on both sides: run through a junction or symlink, the gate must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  let prefixes = [];
  try { prefixes = JSON.parse(readFileSync(new URL('./approval-gate.config.json', import.meta.url), 'utf8')).prefixes ?? []; } catch {}
  let payload = null;
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {}
  const verdict = decide(payload, prefixes);
  if (verdict) console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.deny } }));
  process.exit(0);
}
