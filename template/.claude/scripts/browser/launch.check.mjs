// Self-test for launch.cjs — the parts that run without a browser. `node .claude/scripts/browser/launch.check.mjs`
// Launching itself (GPU flags, renderer, fps) is measured with probe-fps.cjs, not here.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { loadSecrets, redact, gpuProfile } = createRequire(import.meta.url)('./launch.cjs');
const dir = mkdtempSync(join(tmpdir(), 'launch-check-'));
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

test('loadSecrets reads dotenv lines and redact hides every loaded value', () => {
  const file = join(dir, 'secrets.env');
  writeFileSync(file, '# comment\nLOGIN_ID=tester\nexport LOGIN_PASSWORD="synthetic-pass-1234"\n\nPLAIN=\'quoted value\'\n');
  // the loader logs to stderr: capture it, it must name the keys and never carry a value
  const write = process.stderr.write;
  let logged = '';
  process.stderr.write = (chunk) => { logged += chunk; return true; };
  let s;
  try { s = loadSecrets(file); } finally { process.stderr.write = write; }
  assert.match(logged, /LOGIN_ID, LOGIN_PASSWORD, PLAIN/);
  assert.doesNotMatch(logged, /synthetic-pass-1234|tester|quoted value/);
  assert.deepEqual({ ...s }, { LOGIN_ID: 'tester', LOGIN_PASSWORD: 'synthetic-pass-1234', PLAIN: 'quoted value' });
  assert.equal(redact('id=tester pw=synthetic-pass-1234 end'), 'id=*** pw=*** end');
  assert.throws(() => { s.LOGIN_ID = 'x'; }, TypeError, 'the returned object is frozen');
});

test('loadSecrets without a file names PW_SECRETS_FILE and never takes values from argv', () => {
  const before = process.env.PW_SECRETS_FILE;
  delete process.env.PW_SECRETS_FILE;
  try { assert.throws(() => loadSecrets(), /PW_SECRETS_FILE/); }
  finally { if (before !== undefined) process.env.PW_SECRETS_FILE = before; }
});

test('gpuProfile gives flags per OS and marks an unknown OS', () => {
  for (const os of ['win32', 'darwin', 'linux']) {
    const p = gpuProfile(os);
    assert.ok(Array.isArray(p.args) && p.args.length > 0, os);
    assert.ok(['candidate', 'measured'].includes(p.status), `${os} ${p.status}`);
  }
  assert.deepEqual(gpuProfile('plan9'), { status: 'unknown', measuredOn: null, args: [] });
});

rmSync(dir, { recursive: true, force: true });
console.log(`launch.check: ${n} passed`);
