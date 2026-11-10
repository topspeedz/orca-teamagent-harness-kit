// PreToolUse (Bash): deny every `orca orchestration check --wait`.
// Why: a waiting check takes the mail it returns. If its output is missed (chained command, lost background
// task, cut-off foreground call) the message never comes again and Orca has nothing left to wake the session with.
// The wait contract is: end the turn, Orca wakes the chat, run the `check` the notice names without `--wait`.
// `ask --wait` is not a check and passes.
// Fail-open by design (zero false positives first): an unparseable payload or command (unterminated quote,
// heredoc) passes. Quoted strings, heredoc bodies, comments and escaped chars are dropped before the scan,
// so `--body "check --wait"` never counts. Always exit 0.
const ORCA = /(?:^|[\s;&|(){}])(?:[\w.:~/\\-]*[/\\])?(?:orca(?:-ide|-dev)?(?:\.exe|\.cmd)?|\$\{?ORCA_CLI_COMMAND\}?)\s+orchestration\s+check(?=\s|$)/;
const WAIT = /(?:^|\s)--wait(?=[\s=)]|$)/;
const REASON = 'orca-wait-gate: `orca orchestration check --wait`로 기다리지 않는다. 대기 명령이 가져간 메시지는 다시 오지 않고, Orca가 깨울 것도 없어진다. 턴을 끝내면 Orca가 알림으로 깨운다. 깨면 알림이 적어 준 `check`를 `--wait` 없이 실행하라(대기 계약).';
// One command per piece; the `&` of `2>&1`, `>&`, `<&`, `&>` stays inside.
const COMMAND_SEPARATOR = /&&|\|\||\|&|[;\n|]|(?<![<>|])&(?!>)/;
const isWait = (text) => ORCA.test(text) && WAIT.test(text);

// Skip a "..." string starting at s[i] === '"'; returns the index after the closing quote (-1 if unterminated).
function skipDouble(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i + 1;
    else if (s[i] === '$' && s[i + 1] === '(') { i = skipSubst(s, i + 2) - 1; if (i < 0) return -1; }
  }
  return -1;
}
// Skip to after the `)` closing a `$(` whose body starts at s[i]; nested quotes and parens included.
function skipSubst(s, i) {
  for (let depth = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === "'") { i = s.indexOf("'", i + 1); if (i < 0) return -1; }
    else if (c === '"') { i = skipDouble(s, i) - 1; if (i < 0) return -1; }
    else if (c === '<' && s[i + 1] === '<') return -1;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

// Command text with quoted strings, heredoc bodies, comments and escapes blanked to spaces; null if unparseable.
function stripShell(s) {
  let out = '';
  const heredocs = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { out += '  '; i++; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) return null; out += ' '.repeat(j - i + 1); i = j; continue; }
    if (c === '"') { const j = skipDouble(s, i); if (j < 0) return null; out += ' '.repeat(j - i); i = j - 1; continue; }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(s[i - 1]))) { while (i < s.length && s[i] !== '\n') i++; i--; continue; }
    const hd = c === '<' && s[i - 1] !== '<' && /^<<(?!<)-?\s*(['"]?)([\w.-]+)\1/.exec(s.slice(i));
    if (hd) { heredocs.push(hd[2]); out += ' '.repeat(hd[0].length); i += hd[0].length - 1; continue; }
    if (c === '\n' && heredocs.length) {
      out += '\n';
      for (const tag of heredocs.splice(0)) {
        const end = new RegExp(`\\n[\\t ]*${tag.replace(/[.-]/g, '\\$&')}(?=\\n|$)`).exec(s.slice(i));
        if (!end) return null;
        i += end.index + end[0].length;
      }
      i--;
      continue;
    }
    out += c;
  }
  return out;
}

function verdict(input) {
  if (typeof input?.command !== 'string') return null;
  const t = stripShell(input.command);
  if (t === null) return null;
  return t.split(COMMAND_SEPARATOR).some(isWait) ? REASON : null;
}

let reason = null;
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  reason = verdict(JSON.parse(raw.replace(/^﻿/, '')).tool_input);
} catch {
  // fail-open: a payload we cannot read is not evidence of a backgrounded waiter
}
if (reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}
