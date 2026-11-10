import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./orca-wait-gate.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const decide = (r) => {
  assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
};
const exec = (payload) => spawnSync(process.execPath, [HOOK], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', timeout: 9000,
});
const run = (payload) => decide(exec(payload));
const reasonOf = (payload) => {
  const out = exec(payload).stdout.trim();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecisionReason : null;
};
const bash = (command, run_in_background) => ({ tool_name: 'Bash', tool_input: { command, ...(run_in_background === undefined ? {} : { run_in_background }) } });

const W = 'orca orchestration check --terminal term_x --wait --types worker_done --timeout-ms 600000 --json';
const C = 'orca orchestration check';
const cases = [
  // deny: any check that waits, however it is launched
  [bash(W), 'deny'],
  [bash(W, true), 'deny'],
  [bash(`${W} &`), 'deny'],
  [bash(`${W} && echo done`), 'deny'],
  [bash(`${W} 2>&1`), 'deny'],
  [bash(`${W} |& tee w.log`), 'deny'],
  [bash(`x=$(${C} --wait)`, true), 'deny'],
  [bash(`(${C} --wait)`), 'deny'],
  [bash(`${W}; npm run dev &`), 'deny'],
  [bash(`npm run dev & ${W}`), 'deny'],
  [bash(`${C} --json; ${C} --wait`), 'deny'],
  [bash(`${C} --wait \
  --types x \
  --timeout-ms 1`), 'deny'],
  [bash(`${C} --wait=true`), 'deny'],
  [bash(`orca-ide orchestration check --wait&`), 'deny'],
  [bash('$ORCA_CLI_COMMAND orchestration check --wait'), 'deny'],
  [bash(`/opt/orca/bin/orca orchestration check --wait`), 'deny'],
  // allow: a check that does not wait, and waits that are not a check
  [bash(C), null],
  [bash(`${C} --run run_x`), null],
  [bash(`${C} --terminal term_x --json &`), null],
  [bash(`${C} --terminal term_x --ack dlv_123 --json`), null],
  [bash(`${C} --terminal term_x --wait-ms 10`), null],
  [bash('orca orchestration ask --question q --wait --timeout-ms 1800000 --json', true), null],
  [bash(`${C} --json; orca orchestration ask --question q --wait`), null],
  [bash('orca terminal wait --terminal term_x --for tui-idle'), null],
  [bash('npm run dev &'), null],
  // quoted text, heredoc bodies and comments are not commands
  [bash(`orca orchestration send --type worker_done --body "ran ${W} & checked" --json`), null],
  [bash(`orca orchestration send --type worker_done --body "$(cat "/tmp/body.md")" --json # ${W} &`), null],
  [bash(`echo '${W} &'`), null],
  [bash(`cat > /tmp/note.md <<'EOF'
never run ${W} &
EOF
orca orchestration send --body "$(cat /tmp/note.md)"`), null],
  [bash(`grep -n "check --wait" .claude/skills -r && grep -c "&" f`), null],
  // unparseable → fail-open
  [bash(`git commit -m "$(cat <<'EOF'
1) block "${C} --wait" now
EOF
)"`), null],
  [bash(`echo "unterminated ${W} &`), null],
  [{ tool_name: 'Bash', tool_input: {} }, null],
  ['{broken', null],
  ['null', null],
];
for (const [payload, want] of cases) assert.equal(run(payload), want, JSON.stringify(payload).slice(0, 160));

const reason = reasonOf(bash(W, true));
assert.ok(reason.includes('대기 계약') && reason.includes('--wait'), reason);

// settings.json routes Bash (only Bash) here and the command string runs from root and a nested cwd.
const entry = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url), 'utf8'))
  .hooks.PreToolUse.find((h) => h.hooks.some((x) => x.command?.includes('orca-wait-gate')));
assert.ok(entry, 'orca-wait-gate is not registered in settings.json PreToolUse');
const command = entry.hooks.find((x) => x.command?.includes('orca-wait-gate')).command;
const routed = (name) => new RegExp(`^(?:${entry.matcher})$`).test(name);
assert.ok(routed('Bash') && !routed('PowerShell') && !routed('mcp__example__query'), `matcher ${entry.matcher}`);
const shells = [['bash', ['-c']]];
if (process.platform === 'win32') shells.push(['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command']]);
let replays = 0;
for (const [shell, flags] of shells) {
  for (const cwd of [root, fileURLToPath(new URL('../skills/', import.meta.url))]) {
    for (const [payload, want] of [[bash(W, true), 'deny'], [bash(C), null]]) {
      const r = spawnSync(shell, [...flags, command.replaceAll('${CLAUDE_PROJECT_DIR}', root)], {
        cwd, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', ...payload }),
      });
      assert.equal(decide(r), want, `${shell} @ ${cwd}`);
      replays++;
    }
  }
}
console.log(`✅ orca-wait-gate: ${cases.length} cases + matcher + ${replays} settings replays passed`);
