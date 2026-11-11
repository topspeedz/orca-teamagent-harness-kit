#!/usr/bin/env node
// Collects what this project's past Claude Code sessions asked for and which pipeline files it has (read only).
// Usage: node session-digest.mjs --target <dir> [--days 30] [--limit 120]   prints JSON, exit 0
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = [/\b(sk-|ghp_|gho_|AKIA|xox[bp]-)[A-Za-z0-9_-]{8,}/g, /\b[A-Fa-f0-9]{32,}\b/g];
const WORKER_MARK = 'You are a dispatched worker';
const TOP = 30;

// Claude Code names a project's record folder after its path with every non-alphanumeric character turned into '-'
export const slugOf = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');

export function recordRoots({ home, env, platform }) {
  const orca = platform === 'win32' ? join(env.APPDATA ?? '', 'orca')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'orca') : join(home, '.config', 'orca');
  const profiles = join(orca, 'claude-profiles');
  const all = [
    join(home, '.claude', 'projects'),
    ...(env.CLAUDE_CONFIG_DIR ? [join(env.CLAUDE_CONFIG_DIR, 'projects')] : []),
    ...(existsSync(profiles) ? readdirSync(profiles).map((p) => join(profiles, p, 'home', 'projects')) : []),
  ];
  // CLAUDE_CONFIG_DIR may point inside an Orca profile, and a profile's projects folder may be a link, so one folder can show up several times
  const key = (p) => (platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
  const seen = new Set();
  return all.filter((p) => existsSync(p) && !seen.has(key(p)) && seen.add(key(p)));
}

const tally = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
const ranked = (map, name) => [...map].sort((a, b) => b[1] - a[1]).map(([k, count]) => ({ [name]: k, count }));
const clean = (text) => SECRET.reduce((t, re) => t.replace(re, '[가림]'), text).slice(0, 300);

export function digest(files, { since, limit }) {
  const found = [], commands = new Map(), skills = new Map();
  let sessions = 0, skipped = 0;
  for (const file of files) {
    let counted = false;
    for (const ln of readFileSync(file, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      let o;
      try { o = JSON.parse(ln); } catch { skipped++; continue; }
      if (o.timestamp && Date.parse(o.timestamp) < since) continue;
      // subagent files carry user/assistant lines only as sidechain, so they do not count as sessions
      if ((o.type === 'user' || o.type === 'assistant') && !o.isSidechain && !counted) { counted = true; sessions++; }
      const content = o.message?.content;
      if (o.type === 'assistant' && Array.isArray(content)) for (const b of content) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Bash' || b.name === 'PowerShell') {
          // skip `cd`/`export` segments and leading VAR=value so the bin names the real work
          const words = String(b.input?.command ?? '').split(/&&|;|\|/).map((s) => s.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w)))
            .find((w) => w[0] && !/^(cd|export)$/i.test(w[0])) ?? [];
          const bin = (words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
          if (bin) tally(commands, bin);
        }
        if (b.name === 'Skill' && b.input?.skill) tally(skills, b.input.skill);
      }
      if (o.type !== 'user' || o.isSidechain || o.isMeta) continue;
      const text = (typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '').trim();
      if (!text || text.startsWith('<') || text.includes(WORKER_MARK)) continue;
      found.push({ date: o.timestamp?.slice(0, 10) ?? '', session: basename(file), text: clean(text), t: Date.parse(o.timestamp) || 0 });
    }
  }
  const seen = new Set();
  const unique = found.sort((a, b) => b.t - a.t).filter((p) => !seen.has(p.text) && seen.add(p.text)).map(({ t, ...p }) => p);
  return { sessions, promptsTotal: unique.length, prompts: unique.slice(0, limit ?? unique.length), commands: ranked(commands, 'bin'), skills: ranked(skills, 'name'), skipped };
}

export function pipelineFiles(target) {
  const list = (dir, max = Infinity) => (existsSync(join(target, dir)) ? readdirSync(join(target, dir)).slice(0, max).map((f) => `${dir}/${f}`) : []);
  return [
    ...list('.github/workflows'),
    ...['.gitlab-ci.yml', 'Jenkinsfile', 'Makefile', 'package.json'].filter((f) => existsSync(join(target, f))),
    ...list('scripts', 30),
    ...list('_workspace/_run'),
    ...['docs/harness/team-org.md'].filter((f) => existsSync(join(target, f))),
  ];
}

function main(argv) {
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const target = resolve(opt('--target') ?? '.');
  const since = Date.now() - Number(opt('--days') ?? 30) * 86400e3;
  const git = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: target, encoding: 'utf8' });
  const paths = git.status === 0 ? git.stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).trim()) : [];
  const slugs = new Set([target, ...paths].map((p) => slugOf(p).toLowerCase()));
  const roots = recordRoots({ home: homedir(), env: process.env, platform: process.platform });
  const dirs = roots.flatMap((r) => readdirSync(r).filter((d) => slugs.has(d.toLowerCase())).map((d) => join(r, d)));
  // recursive: subagent records live in <session>/subagents/
  const files = dirs.flatMap((d) => readdirSync(d, { recursive: true }).filter((f) => f.endsWith('.jsonl')).map((f) => join(d, f)))
    .filter((f) => statSync(f).mtimeMs >= since);
  const d = digest(files, { since, limit: Number(opt('--limit') ?? 120) });
  console.log(JSON.stringify({ roots, dirs, ...d, commands: d.commands.slice(0, TOP), skills: d.skills.slice(0, TOP), pipelines: pipelineFiles(target) }, null, 2));
  return 0;
}

// realpath on both sides: a junction or symlink in the plugin path must not stop the CLI from running
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
