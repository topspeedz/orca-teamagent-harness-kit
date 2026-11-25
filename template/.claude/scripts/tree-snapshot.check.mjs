// Self-test for tree-snapshot.mjs — real temp git repos. `node .claude/scripts/tree-snapshot.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diff, take } from './tree-snapshot.mjs';

let passed = 0;
const ok = () => passed++;
const repos = [];
const mk = (commit) => {
  const cwd = mkdtempSync(join(tmpdir(), 'tree-snapshot-'));
  repos.push(cwd);
  const git = (args, env = {}) => {
    const r = spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  git(['init', '-q']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  git(['config', 'core.autocrlf', 'false']);
  const put = (p, body) => { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), body); };
  if (commit) {
    put('.gitignore', '_workspace/\n');
    put('a.txt', 'a\n');
    put('b.txt', 'b\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
  }
  return { cwd, git, put };
};
const names = (fs) => fs.map((f) => `${f.status} ${f.path}`);

try {
  const { cwd, git, put } = mk(true);
  put('a.txt', 'a2\n');
  put('new.txt', 'n\n');
  put('c.txt', 'c\n');
  git(['add', 'c.txt']);
  put('_workspace/r.md', 'ignored\n');
  const stagedBefore = git(['diff', '--cached', '--name-status']).stdout;
  const statusBefore = git(['status', '--porcelain']).stdout;

  // 1. modify, add, staged-add are caught; ignored path is not
  const s1 = take(git);
  assert.match(s1, /^[0-9a-f]{40}$/);
  assert.deepEqual(names(diff(git, 'HEAD', s1)), ['M a.txt', 'A c.txt', 'A new.txt']);
  ok();

  // 2. real index and working tree untouched
  assert.equal(git(['diff', '--cached', '--name-status']).stdout, stagedBefore);
  assert.equal(git(['status', '--porcelain']).stdout, statusBefore);
  ok();

  // 3. between two snapshots, and path narrowing
  put('a.txt', 'a3\n');
  unlinkSync(join(cwd, 'b.txt'));
  const s2 = take(git);
  assert.deepEqual(names(diff(git, s1, s2)), ['M a.txt', 'D b.txt']);
  assert.deepEqual(names(diff(git, s1, s2, ['a.txt'])), ['M a.txt']);
  ok();

  // 4. Korean and space paths come back unquoted
  put('문서 폴더/새 파일.txt', 'x\n');
  assert.ok(diff(git, s2, take(git)).some((f) => f.path === '문서 폴더/새 파일.txt'));
  ok();

  // 5. repository with no commit
  const e = mk(false);
  e.put('x.txt', 'x\n');
  assert.match(take(e.git), /^[0-9a-f]{40}$/);
  ok();

  // 6. CLI
  const script = join(import.meta.dirname, 'tree-snapshot.mjs');
  const cli = (args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  let r = cli(['take']);
  assert.equal(r.status, 0);
  const t = JSON.parse(r.stdout).tree;
  assert.match(t, /^[0-9a-f]{40}$/);
  r = cli(['diff', '--from', 'HEAD', '--to', t, '--path', 'a.txt']);
  assert.deepEqual(JSON.parse(r.stdout), { files: [{ status: 'M', path: 'a.txt' }] });
  r = cli(['diff', '--from', 'nope', '--to', t]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).error);
  ok();
} finally {
  for (const d of repos) rmSync(d, { recursive: true, force: true });
}
console.log(`tree-snapshot.check: ${passed} passed`);
