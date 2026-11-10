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

// Splits at separators outside quotes; inside double quotes only $( and ` start a new piece. Backslash is not an escape (fails closed).
function pieces(command) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { if (c === "'") quote = null; cur += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '`' || (c === '$' && command[i + 1] === '(')) { out.push(cur); cur = ''; if (c === '$') i++; continue; }
      cur += c;
      continue;
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
    let p = piece.trim();
    for (let prev; prev !== p;) { prev = p; p = p.replace(LEAD, ''); }
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
