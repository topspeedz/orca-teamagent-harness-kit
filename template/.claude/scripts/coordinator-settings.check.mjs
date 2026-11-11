// Self-test for coordinator-settings.mjs — no Claude run needed. `node .claude/scripts/coordinator-settings.check.mjs`
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettings, unclassified, main, KEEP_PATH, SETTINGS_PATH } from './coordinator-settings.mjs';
import { COORDINATOR_ENV, COORDINATOR_COMPACT_WINDOW } from '../hooks/compact-gate.mjs';

const keep = { permissionMode: 'default', plugins: { 'a@m': 'off', 'b@m': 'keep', 'gone@m': 'off' }, skills: { x: 'off', coordinator: 'keep' } };
const inventory = { plugins: ['a@m', 'b@m'], skills: ['x', 'coordinator', 'new-skill'] };
// Fake `claude -p … --output-format stream-json --verbose`: hook lines first, then init (P7).
const initLine = JSON.stringify({ type: 'system', subtype: 'init', skills: ['coordinator', 'x', 'p:s'],
  plugins: [{ name: 'a', source: 'a@m' }, { name: 'orca-agent-view', source: 'orca-agent-view@inline' }, { name: 'cc', source: 'cc-plugin-x@builtin' }] });
const run = () => [JSON.stringify({ type: 'system', subtype: 'hook_started' }), initLine, ''].join('\n');
const quiet = () => {};
let passed = 0;
const t = (fn) => { fn(); passed++; };

const out = buildSettings(keep, inventory);

// 1. off items present on this machine are turned off; keep items and missing items are not listed
t(() => {
  assert.deepEqual(out.enabledPlugins, { 'a@m': false });
  assert.deepEqual(out.skillOverrides, { x: 'off' });
});

// 2. env values come from compact-gate constants
t(() => assert.deepEqual(out.env, { [COORDINATOR_ENV]: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(COORDINATOR_COMPACT_WINDOW) }));

// 3. keep-only item (gone@m) is ignored without error
t(() => assert.equal('gone@m' in out.enabledPlugins, false));

// 4. machine-only skill stays on and is reported as unclassified
t(() => {
  assert.deepEqual(unclassified(keep, inventory), { plugins: [], skills: ['new-skill'] });
  assert.equal('new-skill' in out.skillOverrides, false);
});

const root = mkdtempSync(join(tmpdir(), 'coord-settings-'));
mkdirSync(join(root, '.claude'));

// 5. generate twice → same file; readInventory drops @inline/@builtin and reads the init line
t(() => {
  writeFileSync(join(root, KEEP_PATH), JSON.stringify(keep));
  assert.equal(main(['generate'], run, root, quiet), 0);
  const first = readFileSync(join(root, SETTINGS_PATH), 'utf8');
  assert.equal(main(['generate'], run, root, quiet), 0);
  assert.equal(readFileSync(join(root, SETTINGS_PATH), 'utf8'), first);
  assert.deepEqual(JSON.parse(first).enabledPlugins, { 'a@m': false });
});

// 6. init-keep does not touch an existing keep file; on a fresh project it writes ESSENTIAL_SKILLS as keep
t(() => {
  const before = readFileSync(join(root, KEEP_PATH), 'utf8');
  assert.equal(main(['init-keep'], run, root, quiet), 0);
  assert.equal(readFileSync(join(root, KEEP_PATH), 'utf8'), before);
  const fresh = mkdtempSync(join(tmpdir(), 'coord-settings-'));
  mkdirSync(join(fresh, '.claude'));
  assert.equal(main(['init-keep'], run, fresh, quiet), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(fresh, KEEP_PATH), 'utf8')),
    { permissionMode: 'default', plugins: { 'a@m': 'off' }, skills: { coordinator: 'keep', x: 'off', 'p:s': 'off' } });
});

// 7. the five template hooks are registered in settings.json (user hooks may sit beside them) and every hooks/<name>.mjs exists
t(() => {
  const settings = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url), 'utf8'));
  const names = Object.values(settings.hooks).flat().flatMap((g) => g.hooks)
    .map((h) => h.command?.match(/hooks\/([\w-]+)\.mjs/)?.[1]).filter(Boolean);
  for (const n of ['approval-gate', 'compact-gate', 'orca-wait-gate', 'secret-gate', 'worker-intake-context']) assert.ok(names.includes(n), n);
  for (const n of names) assert.ok(existsSync(new URL(`../hooks/${n}.mjs`, import.meta.url)), n);
});

// 8. front-desk.settings.json switches off exactly the browser env that settings.json switches on for every session
t(() => {
  const on = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url), 'utf8')).env ?? {};
  const off = JSON.parse(readFileSync(new URL('../front-desk.settings.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(off), ['env'], 'the override file carries env only');
  assert.deepEqual(Object.keys(off.env).sort(), Object.keys(on).filter((k) => k.startsWith('PLAYWRIGHT_MCP_')).sort());
  for (const k of Object.keys(off.env)) assert.deepEqual([on[k], off.env[k]], ['true', 'false'], k);
});

console.log(`coordinator-settings.check: ${passed} passed`);
