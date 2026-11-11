// Self-test for setup.mjs — builds a small template in a temp folder. `node skills/setup/scripts/setup.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyInstall, mergeGitignore, planInstall } from './setup.mjs';

const root = mkdtempSync(join(tmpdir(), 'setup-check-'));
const put = (base, rel, body) => {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, 'utf8');
};
const read = (base, rel) => readFileSync(join(base, rel), 'utf8');

const tpl = join(root, 'template');
const codex = join(root, 'template-codex');
const hook = (name) => ({ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${name}.mjs"` });
put(tpl, 'AGENTS.md', '# 공통 지침\n');
put(tpl, 'CLAUDE.md', '@AGENTS.md\n');
put(tpl, 'gitignore.add', '_workspace/\n.claude/coordinator.settings.local.json\n');
put(tpl, '.claude/settings.json', JSON.stringify({
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [hook('orca-wait-gate')] }], UserPromptSubmit: [{ hooks: [hook('worker-intake-context')] }] },
  permissions: { deny: ['Bash(git push --force:*)'], ask: [] },
  env: { PLAYWRIGHT_MCP_ISOLATED: 'true', PLAYWRIGHT_MCP_HEADLESS: 'true' },
}, null, 2));
put(tpl, '.claude/coordinator.keep.json', '{ "permissionMode": "default", "plugins": {}, "skills": {} }\n');
put(tpl, '.claude/hooks/approval-gate.config.json', '{ "prefixes": [] }\n');
put(tpl, 'docs/harness/model-selection.md', '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |\n| --- | --- | --- | --- | --- | --- |\n| `planner` | 설계, 계획 | claude | opus | max | 최고 추론 고정 |\n| `*` | 기본 | claude | opus | medium | |\n');
put(tpl, '.claude/skills/dag-swimlane/SKILL.md', '---\nname: dag-swimlane\n---\n');
put(tpl, '.claude/skills/waterfall-timeline/SKILL.md', '---\nname: waterfall-timeline\n---\n');
put(codex, '.codex/hooks.json', '{}\n');
put(codex, '.agents/skills/coordinator/SKILL.md', 'pointer\n');

const ANSWERS = { codex: false, approvalPrefixes: [], coordinatorPermissionMode: 'default', planner: { model: 'opus', effort: 'max' } };
const INS = { git: true, orca: '1.4.255', node: process.version, superpowers: true, globalDiagramSkills: { 'dag-swimlane': false, 'waterfall-timeline': false }, codex: false, existing: [] };
const ALL = ['.claude/hooks/approval-gate.config.json', '.claude/settings.json', '.claude/skills/dag-swimlane/SKILL.md', '.claude/skills/waterfall-timeline/SKILL.md', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'docs/harness/model-selection.md'];
let n = 0;
const target = (name) => { const t = join(root, name); mkdirSync(t, { recursive: true }); return t; };
const install = (t, answers = {}, ins = {}, approve = []) =>
  applyInstall(planInstall(tpl, codex, t, { ...ANSWERS, ...answers }, { ...INS, ...ins }), { approve });
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

test('empty target', () => {
  const r = install(target('empty'));
  assert.deepEqual([...r.written].sort(), ALL);
  assert.deepEqual(r.conflicts, []);
});

test('different CLAUDE.md is a conflict until approved', () => {
  const t = target('conflict');
  put(t, 'CLAUDE.md', '# 내 지침\n');
  const r = install(t);
  assert.deepEqual(r.conflicts, ['CLAUDE.md']);
  assert.equal(read(t, 'CLAUDE.md'), '# 내 지침\n');
  const r2 = install(t, {}, {}, ['CLAUDE.md']);
  assert.deepEqual(r2.conflicts, []);
  assert.ok(r2.written.includes('CLAUDE.md'));
  assert.equal(read(t, 'CLAUDE.md'), '@AGENTS.md\n');
});

test('user hook in settings.json is kept and template hooks added', () => {
  const t = target('settings');
  const mine = { type: 'command', command: 'echo mine' };
  put(t, '.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }] } }));
  const r = install(t);
  assert.deepEqual(r.conflicts, []);
  const s = JSON.parse(read(t, '.claude/settings.json'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.PreToolUse[0].hooks, [mine, hook('orca-wait-gate')]);
  assert.deepEqual(s.hooks.UserPromptSubmit[0].hooks, [hook('worker-intake-context')]);
  assert.deepEqual(s.permissions.deny, ['Bash(git push --force:*)']);
});

test('installed self-tests pass when settings.json already has user hooks', () => {
  const t = target('user hooks 한글');
  const mine = { type: 'command', command: 'echo mine' };
  put(t, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }], Stop: [{ hooks: [mine] }] } }));
  const real = (dir) => fileURLToPath(new URL(`../../../${dir}`, import.meta.url));
  const r = applyInstall(planInstall(real('template'), real('template-codex'), t, ANSWERS, INS), { approve: [] });
  assert.deepEqual(r.conflicts, []);
  for (const check of ['.claude/hooks/orca-wait-gate.check.mjs', '.claude/hooks/secret-gate.check.mjs', '.claude/scripts/coordinator-settings.check.mjs']) {
    const run = spawnSync(process.execPath, [join(t, check)], { cwd: t, encoding: 'utf8' });
    assert.equal(run.status, 0, `${check}
${run.stdout}${run.stderr}`);
  }
});

test('template env is installed; a value the user already set is kept', () => {
  const fresh = target('env-fresh');
  install(fresh);
  assert.deepEqual(JSON.parse(read(fresh, '.claude/settings.json')).env, { PLAYWRIGHT_MCP_ISOLATED: 'true', PLAYWRIGHT_MCP_HEADLESS: 'true' });
  const t = target('env-user');
  put(t, '.claude/settings.json', JSON.stringify({ env: { PLAYWRIGHT_MCP_HEADLESS: 'false', MINE: '1' } }));
  install(t);
  assert.deepEqual(JSON.parse(read(t, '.claude/settings.json')).env, { PLAYWRIGHT_MCP_HEADLESS: 'false', MINE: '1', PLAYWRIGHT_MCP_ISOLATED: 'true' });
});

// R1 A-8: through the CLI with the real template, so the exit code is the one the setup skill sees
test('reinstall skips a template file the user edited, exit 0', () => {
  const t = target('user edit 한글');
  // an existing keep list keeps init-keep (a real claude run) out of the test
  put(t, '.claude/coordinator.keep.json', '{ "permissionMode": "default", "plugins": {}, "skills": {} }\n');
  put(root, 'answers.json', JSON.stringify(ANSWERS));
  const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
  const cli = () => {
    const r = spawnSync(process.execPath, [setup, 'install', '--target', t, '--answers', join(root, 'answers.json')], { encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout || '{}'), err: r.stderr };
  };
  const first = cli();
  assert.equal(first.code, 0, first.err);
  const table = 'docs/harness/model-selection.md';
  const edited = `${read(t, table)}| \`my-agent\` | 내 작업 | claude | sonnet | low | 사용자가 더한 줄 |\n`;
  put(t, table, edited);
  const again = cli();
  assert.deepEqual(again.out.conflicts, []);
  assert.deepEqual(again.out.skipped.filter((x) => x.reason === '사용자가 고침'), [{ to: table, reason: '사용자가 고침' }]);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(again.out.written, []);
  assert.equal(read(t, table), edited);
});

test('second install writes nothing and duplicates nothing', () => {
  const t = target('twice');
  put(t, '.gitignore', 'node_modules/\n');
  install(t, { approvalPrefixes: ['git push'] });
  const hooks = () => Object.values(JSON.parse(read(t, '.claude/settings.json')).hooks).flatMap((g) => g.flatMap((x) => x.hooks)).length;
  const before = [hooks(), read(t, '.gitignore').split('\n').length, read(t, '.claude/settings.json')];
  const r = install(t, { approvalPrefixes: ['git push'] });
  assert.deepEqual(r.written, []);
  assert.deepEqual([hooks(), read(t, '.gitignore').split('\n').length, read(t, '.claude/settings.json')], before);
});

test('global dag-swimlane is skipped', () => {
  const t = target('global');
  const r = install(t, {}, { globalDiagramSkills: { 'dag-swimlane': true, 'waterfall-timeline': false } });
  assert.deepEqual(r.skipped.filter((s) => s.reason === '전역에 있음'), [{ to: '.claude/skills/dag-swimlane', reason: '전역에 있음' }]);
  assert.equal(existsSync(join(t, '.claude/skills/dag-swimlane')), false);
  assert.ok(existsSync(join(t, '.claude/skills/waterfall-timeline/SKILL.md')));
});

test('codex false installs no codex files', () => {
  const t = target('nocodex');
  install(t, { codex: false });
  assert.equal(existsSync(join(t, '.agents')), false);
  assert.equal(existsSync(join(t, '.codex')), false);
  install(target('codex'), { codex: true });
  assert.ok(existsSync(join(root, 'codex', '.codex/hooks.json')));
});

test('planner row gets the chosen model', () => {
  const t = target('planner');
  install(t, { planner: { model: 'fable', effort: 'max' } });
  const row = read(t, 'docs/harness/model-selection.md').split('\n').find((l) => l.startsWith('| `planner`'));
  assert.deepEqual(row.split('|').map((c) => c.trim()).slice(4, 6), ['fable', 'max']);
});

test('approval prefixes go to permissions.ask and the gate config', () => {
  const t = target('approve');
  install(t, { approvalPrefixes: ['git push'] });
  const ask = JSON.parse(read(t, '.claude/settings.json')).permissions.ask;
  assert.ok(ask.includes('Bash(git push:*)'));
  assert.ok(ask.includes('PowerShell(git push:*)'));
  assert.deepEqual(JSON.parse(read(t, '.claude/hooks/approval-gate.config.json')).prefixes, ['git push']);
});

test('path with spaces and Korean', () => {
  const r = install(target('내 프로젝트 1'));
  assert.deepEqual([...r.written].sort(), ALL);
  assert.deepEqual(r.conflicts, []);
});

test('mergeGitignore adds only missing lines', () => {
  assert.equal(mergeGitignore('a\n', ['_workspace/', 'a']), 'a\n_workspace/\n');
});

console.log(`setup.check: ${n} passed`);
