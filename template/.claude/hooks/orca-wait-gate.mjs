// PreToolUse (Bash): deny an `orca orchestration check --wait` that the shell backgrounds with a lone `&`, or that
// lacks `--timeout-ms` or `--types` (the option verdict applies whatever `run_in_background` is).
// Why `&`: a shell-`&` waiter is invisible to Claude Code (no task to stop), so it lingers as an orphan and the next
// `check --wait` of the Run fails `waiter_exists`.
// Bash `run_in_background` is the tracked way (the project's wait contract).
// Why options: waits without `--timeout-ms` wake the coordinator empty about every 2 minutes, and without
// `--types` heartbeats wake it too. Only flag presence is checked, per command of a compound line.
// Fail-open by design (zero false positives first): an unparseable payload or command (unterminated quote,
// heredoc) passes. Quoted strings, heredoc bodies, comments and escaped chars are dropped before the scans,
// so `--body "a & b"` or `--spec "$(cat f)"` never count. Always exit 0.
const ORCA = /(?:^|[\s;&|(){}])(?:[\w.:~/\\-]*[/\\])?(?:orca(?:-ide|-dev)?(?:\.exe|\.cmd)?|\$\{?ORCA_CLI_COMMAND\}?)\s+orchestration\s+check(?=\s|$)/;
const WAIT = /(?:^|\s)--wait(?=[\s=)]|$)/;
const REASON = 'orca-wait-gate: 셸 `&`로 띄운 `orca orchestration check --wait`는 추적·정지할 수 없는 고아 waiter가 되어 다음 대기가 waiter_exists로 막힌다. `&`를 빼고 Bash run_in_background로 띄워라(대기 계약).';
const missingReason = (flags) => `orca-wait-gate: \`orca orchestration check --wait\`에 대기 옵션이 없으면 빈 깨움으로 턴을 쓴다. 빠진 옵션: ${flags.join(', ')}. 올바른 형태: \`check --wait --types "worker_done,escalation,question,status" --timeout-ms 1800000\` (대기 계약).`;
// One command per piece; the `&` of `2>&1`, `>&`, `<&`, `&>` stays inside (same lone-`&` test as backgroundedJobs).
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

// Each job a lone `&` puts in the background: the and-or list since the last `;`/newline/`&` at the same
// group depth, or the whole `( … )` / `{ …; }` group it closes. `&&`, `>&`, `&>`, `<&`, `|&` are not lone.
function backgroundedJobs(t) {
  const jobs = [];
  const starts = [0];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const prev = t[i - 1] ?? ' ';
    const next = t[i + 1] ?? ' ';
    if (c === '(' || (c === '{' && /[\s;&|(]/.test(prev) && /\s/.test(next))) starts.push(i + 1);
    else if ((c === ')' || (c === '}' && /[\s;]/.test(prev))) && starts.length > 1) starts.pop();
    else if (c === ';' || c === '\n') starts[starts.length - 1] = i + 1;
    else if (c === '&') {
      if (next === '&') { i++; continue; }
      if (/[<>|]/.test(prev) || next === '>') continue;
      jobs.push(t.slice(starts[starts.length - 1], i));
      starts[starts.length - 1] = i + 1;
    }
  }
  return jobs;
}

function verdict(input) {
  if (typeof input?.command !== 'string') return null;
  const t = stripShell(input.command);
  if (t === null) return null;
  if (input.run_in_background !== true && backgroundedJobs(t).some(isWait)) return REASON;
  // An unclosed `$(` after `--wait` is a truncated value fragment we cannot judge.
  for (const command of t.split(COMMAND_SEPARATOR).filter((c) => isWait(c) && !/\s--wait\s.*\$\([^)]*$/s.test(c))) {
    const missing = ['--timeout-ms', '--types'].filter((flag) => !new RegExp(`(?:^|\\s)${flag}(?=[\\s=]|$)`).test(command));
    if (missing.length) return missingReason(missing);
  }
  return null;
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
