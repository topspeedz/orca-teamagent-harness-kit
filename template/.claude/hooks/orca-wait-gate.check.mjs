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
  // closing parens are a boundary after --wait
  [bash(`x=$(${C} --wait)`, true), 'deny'],
  [bash(`(${C} --wait)`, true), 'deny'],
  [bash(`(${C} --wait) &`), 'deny'],
  // split substitution values fail open, but a nested waiter still counts
  [bash(`${C} --wait --types $(cat t | tr -d x) --timeout-ms 1`, true), null],
  [bash(`${C} --wait --types $(echo a; echo b) --timeout-ms 1`, true), null],
  [bash(`x=$(${C} --wait | tee f)`, true), 'deny'],
  // a heredoc inside a substitution is unparseable
  [bash(`git commit -m "$(cat <<'EOF'\n1) block "${C} --wait" now\nEOF\n)"`), null],
  [bash(`gh pr comment 1 --body "$(cat <<'EOF'\n- a) "${C} --wait" is denied\nEOF\n)"`), null],
  // deny: the waiter itself is backgrounded by a lone `&`
  [bash(`${W} &`), 'deny'],
  [bash(`${W} > /tmp/w.json 2>&1 &`), 'deny'],
  [bash(`${W} --wait ... & echo started`), 'deny'],
  [bash(`(${W}) &`), 'deny'],
  [bash(`( cd /d/repo && ${W} ) & sleep 1`), 'deny'],
  [bash(`{ ${W}; } &`), 'deny'],
  [bash(`nohup ${W} | tee w.log &\necho bg`), 'deny'],
  [bash(`orca-ide orchestration check --wait&`), 'deny'],
  [bash('$ORCA_CLI_COMMAND orchestration check --wait &'), 'deny'],
  [bash(`/opt/orca/bin/orca orchestration check --wait &`), 'deny'],
  [bash(`${W} &`, false), 'deny'],
  // allow: not backgrounded by the shell, or not a wait
  [bash(`${W} && echo done`), null],
  [bash(`${W} 2>&1`), null],
  [bash(`${W} > /tmp/w.json 2>&1`), null],
  [bash(`${W} &> /tmp/w.json`), null],
  [bash(`${W} |& tee w.log`), null],
  [bash(W, true), null],
  [bash(`${W} &`, true), null], // run_in_background true skips only the shell-`&` verdict
  [bash('orca orchestration check --terminal term_x --json &'), null],
  [bash('orca orchestration check --terminal term_x --ack dlv_123 --json'), null],
  [bash('orca orchestration check --terminal term_x --wait-ms 10 &'), null],
  [bash('npm run dev &'), null],
  [bash(`${W}; npm run dev &`), null],
  [bash(`npm run dev & ${W}`), null],
  [bash(`orca orchestration send --type worker_done --body "ran ${W} & checked" --json`), null],
  [bash(`orca orchestration send --type worker_done --body "$(cat "/tmp/body.md")" --json # ${W} &`), null],
  [bash(`echo '${W} &'`), null],
  [bash(`cat > /tmp/note.md <<'EOF'\nnever run ${W} &\nEOF\norca orchestration send --body "$(cat /tmp/note.md)"`), null],
  [bash(`echo \\& ${W}`), null],
  [bash(`grep -n "check --wait" .claude/skills -r && grep -c "&" f`), null],
  [bash(`echo "unterminated ${W} &`), null], // unparseable → fail-open
  [{ tool_name: 'Bash', tool_input: {} }, null],
  ['{broken', null],
  ['null', null],
  // option verdict ignores run_in_background
  [bash(`${C} --wait --types x --timeout-ms 1`, true), null],
  [bash(`${C} --wait --types x`, true), 'deny'],
  [bash(`${C} --wait --types x`), 'deny'],
  [bash(`${C} --wait --timeout-ms 1`, true), 'deny'],
  [bash(`${C} --wait --timeout-ms 1`), 'deny'],
  [bash(`${C} --wait --types x --timeout-ms 1 &`), 'deny'],
  [bash(`${C} --terminal term_x --json`), null],
  // options of another command in the line do not count
  [bash(`${C} --wait --types x --timeout-ms 1 ; ${C} --wait`), 'deny'],
  [bash(`echo --types a --timeout-ms 1 && ${C} --wait`), 'deny'],
  [bash(`${C} --wait | tee --types a --timeout-ms 1`), 'deny'],
  [bash(`echo --types a --timeout-ms 1 || ${C} --wait`), 'deny'],
  [bash(`echo --types a --timeout-ms 1 & ${C} --wait`, true), 'deny'],
  [bash(`${C} --wait\n--types x --timeout-ms 1`), 'deny'],
  [bash(`${C} --wait --x--types y --timeout-ms 1`), 'deny'],
  // redirections and line continuations stay inside one command
  [bash(`${C} --wait 2>&1 --types x --timeout-ms 1`), null],
  [bash(`${C} --wait >& /tmp/w --types x --timeout-ms 1`), null],
  [bash(`${C} --wait &> /tmp/w --types x --timeout-ms 1`), null],
  [bash(`${C} --wait \\\n  --types x \\\n  --timeout-ms 1`), null],
  // `=` form and quoted values
  [bash(`${C} --wait --types=x --timeout-ms=1800000`), null],
  [bash(`${C} --wait --types="a,b" --timeout-ms=1`), null],
  [bash(`${C} --wait --types "a,b" --timeout-ms 1`), null],
  // quoted text and longer flag names are not the options
  [bash(`${C} --wait --body "--types x --timeout-ms 1"`), 'deny'],
  [bash(`${C} --wait --timeout-ms-x 1 --types x`), 'deny'],
  [bash(`${C} --wait --timeout-ms 1 --types-x x`), 'deny'],
];
for (const [payload, want] of cases) assert.equal(run(payload), want, JSON.stringify(payload).slice(0, 160));

// Each verdict states its own reason, and the option reason names only what is missing.
const FORM = '--types "worker_done,escalation,question,status" --timeout-ms 1800000';
for (const [command, missing] of [
  [`${C} --wait --types x`, '--timeout-ms'],
  [`${C} --wait --timeout-ms 1`, '--types'],
  [`${C} --wait`, '--timeout-ms, --types'],
]) {
  const reason = reasonOf(bash(command, true));
  assert.ok(reason.includes(`빠진 옵션: ${missing}.`) && reason.includes(FORM), reason);
}
const shellReason = reasonOf(bash(`${C} --wait &`));
assert.ok(shellReason.includes('waiter_exists') && !shellReason.includes('빠진 옵션'), shellReason);

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
    for (const [payload, want] of [[bash(`${W} &`), 'deny'], [bash(W, true), null]]) {
      const r = spawnSync(shell, [...flags, command.replaceAll('${CLAUDE_PROJECT_DIR}', root)], {
        cwd, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', ...payload }),
      });
      assert.equal(decide(r), want, `${shell} @ ${cwd}`);
      replays++;
    }
  }
}
console.log(`✅ orca-wait-gate: ${cases.length} cases + matcher + ${replays} settings replays passed`);
