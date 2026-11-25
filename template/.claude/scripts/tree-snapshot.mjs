// Snapshot the working tree as a git tree id without committing or touching the real index.
// `node .claude/scripts/tree-snapshot.mjs take` | `diff --from <tree> --to <tree> [--path <p>]...`
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultGit = (args, env = {}) => {
  const r = spawnSync('git', args, { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') };
};

const must = (r) => {
  if (r.status !== 0) throw new Error(r.stderr.trim() || 'git failed');
  return r.stdout;
};

export function take(git) {
  const gitDir = must(git(['rev-parse', '--absolute-git-dir'])).trim();
  const env = { GIT_INDEX_FILE: join(gitDir, 'snap-index') };
  const hasHead = git(['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  must(git(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], env));
  must(git(['add', '-A'], env));
  return must(git(['write-tree'], env)).trim();
}

export function diff(git, from, to, paths = []) {
  const args = ['diff', '--name-status', '-z', '--no-renames', from, to];
  if (paths.length) args.push('--', ...paths);
  const parts = must(git(args)).split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i], path: parts[i + 1] });
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === 'take') console.log(JSON.stringify({ tree: take(defaultGit) }));
    else if (cmd === 'diff') {
      const o = { path: [] };
      for (let i = 0; i < rest.length; i += 2) {
        const k = rest[i].replace(/^--/, '');
        if (k === 'path') o.path.push(rest[i + 1]); else o[k] = rest[i + 1];
      }
      if (!o.from || !o.to) throw new Error('usage: diff --from <tree> --to <tree> [--path <p>]...');
      console.log(JSON.stringify({ files: diff(defaultGit, o.from, o.to, o.path) }));
    } else throw new Error('usage: tree-snapshot.mjs take | diff --from <tree> --to <tree> [--path <p>]...');
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
