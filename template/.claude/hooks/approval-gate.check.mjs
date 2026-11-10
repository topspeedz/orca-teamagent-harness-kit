import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './approval-gate.mjs';

const HOOK = fileURLToPath(new URL('./approval-gate.mjs', import.meta.url));
const P = ['git push'];
const bash = (command, permission_mode = 'bypassPermissions') => ({ tool_name: 'Bash', tool_input: { command }, permission_mode });
let n = 0;

// decide() directly
const denied = decide(bash('git push origin main'), P);
assert.ok(denied?.deny.includes('ask') && denied.deny.startsWith('git push'), JSON.stringify(denied)); n++;
assert.equal(decide(bash('git push origin main', 'default'), P), null); n++;
assert.equal(decide(bash('git push origin main', 'acceptEdits'), P), null); n++;
assert.equal(decide(bash('git push origin main', 'plan'), P), null); n++;
assert.ok(decide(bash('cd x && git push'), P)?.deny); n++;
assert.ok(decide(bash('git status; git push'), P)?.deny); n++;
assert.ok(decide(bash('git status\ngit push'), P)?.deny); n++;
assert.ok(decide(bash('true | git push'), P)?.deny); n++;
assert.equal(decide(bash('echo "git push"'), P), null); n++;
// R1 A-2: the 13 shapes a bypass worker writes in plain shell are all denied.
for (const command of [
  '(git push)',
  '{ git push; }',
  'if true; then git push; fi',
  'env A=1 git push',
  'GIT_TRACE=1 git push',
  'command git push',
  'bash -c "git push"',
  'x=$(git push)',
  'x=`git push`',
  'git  push',
  'git	push',
  'git -C "my repo" push origin main',
  'git -c core.x=1 push',
]) { assert.ok(decide(bash(command), P)?.deny.startsWith('git push'), command); n++; }
// related forms from the same fix direction
for (const command of ['for r in a; do git push; done', '! git push', 'nohup git push &', 'echo "$(git push)"',
  'pwsh -NoProfile -Command "git status; git push"', "sh -c 'cd x && git push'"]) {
  assert.ok(decide(bash(command), P)?.deny, command); n++;
}
assert.equal(decide(bash("echo 'a; git push'"), P), null); n++;
assert.equal(decide(bash('git status && git pull'), P), null); n++;
assert.equal(decide(bash('git status'), P), null); n++;
assert.ok(decide(null, P)?.deny); n++;
assert.ok(decide({ tool_input: { command: 42 } }, P)?.deny); n++;
assert.equal(decide(bash('git push origin main'), []), null); n++;

// Setup fills prefixes per project, so only the shape of the installed config is checked.
const { prefixes } = JSON.parse(readFileSync(new URL('./approval-gate.config.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(prefixes) && prefixes.every((p) => typeof p === 'string'), JSON.stringify(prefixes)); n++;

// Run the hook as a child process: verdict on stdout, exit code always 0.
const dir = mkdtempSync(join(tmpdir(), 'approval-gate-'));
try {
  const hook = join(dir, 'approval-gate.mjs');
  copyFileSync(HOOK, hook);
  const run = (input) => {
    const r = spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  // no config file → nothing printed
  assert.equal(run(JSON.stringify(bash('git push'))), null); n++;
  writeFileSync(join(dir, 'approval-gate.config.json'), JSON.stringify({ prefixes: P }));
  const out = run(JSON.stringify(bash('git push origin main')));
  assert.equal(out.hookEventName, 'PreToolUse'); n++;
  assert.equal(out.permissionDecision, 'deny'); n++;
  assert.ok(out.permissionDecisionReason.includes('orca orchestration ask')); n++;
  assert.equal(run(JSON.stringify(bash('git push origin main', 'default'))), null); n++;
  assert.equal(run(JSON.stringify(bash('git status'))), null); n++;
  assert.equal(run('{not json')?.permissionDecision, 'deny'); n++;
  assert.equal(run('')?.permissionDecision, 'deny'); n++;
  // FX-E: run through a junction or symlink to the hook folder — the hook must still deny, not exit 0 silently
  const link = join(dir, 'linked hooks');
  let linked = true;
  try { symlinkSync(dir, link, 'junction'); } catch (e) { linked = false; console.log(`건너뜀: 링크를 만들 수 없어 링크 경유 실행 사례를 돌리지 않음 (${e.code ?? e.message})`); }
  if (linked) {
    const r = spawnSync(process.execPath, [join(link, 'approval-gate.mjs')], { input: JSON.stringify(bash('git push origin main')), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim() && JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', `stdout: ${r.stdout}`); n++;
    rmSync(link);
  }
  writeFileSync(join(dir, 'approval-gate.config.json'), JSON.stringify({ prefixes: [] }));
  assert.equal(run(JSON.stringify(bash('git push'))), null); n++;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`approval-gate.check: ${n} passed`);
