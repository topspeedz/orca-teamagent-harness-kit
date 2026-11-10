// Self-test for wait-contract-check.mjs — no Orca needed. `node .claude/scripts/wait-contract-check.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./wait-contract-check.mjs', import.meta.url));
const block = '## 대기 계약 (생략·요약 금지)\n1. 대기는 백그라운드로 건다.\n2. `--timeout-ms 1800000 --json`\n';
const canonical = `# 정본\n> 안내\n\n${block}`;
const skill = (body = block) => `---\nname: x\n---\n# 스킬\n\n${body}\n## 다음 절\n본문\n`;

let n = 0;
const setup = (skills) => {
  const root = mkdtempSync(join(tmpdir(), 'wait-contract-'));
  mkdirSync(join(root, 'docs/harness/templates'), { recursive: true });
  writeFileSync(join(root, 'docs/harness/templates/wait-contract.md'), canonical, 'utf8');
  for (const [name, text] of Object.entries(skills)) {
    mkdirSync(join(root, '.claude/skills', name), { recursive: true });
    writeFileSync(join(root, '.claude/skills', name, 'SKILL.md'), text, 'utf8');
  }
  return root;
};
const run = (root, ...extra) => {
  const r = spawnSync(process.execPath, [script, '--root', root, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const all = (over = {}) => ({ coordinator: skill(), 'team-lead': skill(), 'plan-orchestrate': skill(), ...over });

// 1. all same
let r = run(setup(all()));
assert.equal(r.code, 0); assert.match(r.out, /3\/3 same/); n++;

// 2. drift in one file → names it
r = run(setup(all({ 'team-lead': skill(block.replace('1800000', '900000')) })));
assert.equal(r.code, 1); assert.match(r.out, /team-lead/); n++;

// 3. CRLF is ignored
r = run(setup(all({ coordinator: skill().replace(/\n/g, '\r\n') })));
assert.equal(r.code, 0); n++;

// 4. block missing
r = run(setup(all({ 'plan-orchestrate': '# 스킬\n본문\n' })));
assert.equal(r.code, 1); assert.match(r.out, /대기 계약 없음/); n++;

// 5. skill file missing
r = run(setup({ coordinator: skill(), 'team-lead': skill() }));
assert.equal(r.code, 1); n++;

// 6. --only
r = run(setup({ 'team-lead': skill() }), '--only', 'team-lead');
assert.equal(r.code, 0); assert.match(r.out, /1\/1 same/); n++;

console.log(`wait-contract-check.check: ${n} passed`);
