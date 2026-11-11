#!/usr/bin/env node
// Setup for the Orca harness template: inspect a project, install the template, verify the result.
// Usage: node setup.mjs inspect --target <dir>
//        node setup.mjs install --target <dir> --answers <json file> [--approve <path,...>]   exit 2 when unapproved conflicts remain
//        node setup.mjs verify --target <dir>                                              exit 1 when a check fails
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const TEMPLATE = fileURLToPath(new URL('../../../template', import.meta.url));
const CODEX = fileURLToPath(new URL('../../../template-codex', import.meta.url));
const KEEP = '.claude/coordinator.keep.json';
const SETTINGS = '.claude/settings.json';
const GATE_CONFIG = '.claude/hooks/approval-gate.config.json';
const MODEL_TABLE = 'docs/harness/model-selection.md';
const INSTALL_RECORD = '.claude/harness-install.json';
const DIAGRAM = ['dag-swimlane', 'waterfall-timeline'];
const EXISTING = ['AGENTS.md', 'CLAUDE.md', '.claude', '.gitignore', '.agents', '.codex', 'package.json', 'Makefile'];
const MODES = ['default', 'acceptEdits', 'bypassPermissions'];
const PLANNER_EFFORTS = ['high', 'max'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'worktrees']);

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, base, out); }
    else out.push(p.slice(base.length + 1).replaceAll('\\', '/'));
  }
  return out;
}

export function inspect(target, { run, exists, globalSkillsDir }) {
  const out = (cmd, args) => { try { return run(cmd, args).trim(); } catch { return null; } };
  return {
    git: out('git', ['-C', target, 'rev-parse', '--is-inside-work-tree']) === 'true',
    orca: out('orca', ['--version']),
    node: process.version,
    superpowers: /superpowers@/.test(out('claude', ['plugin', 'list']) ?? ''),
    globalDiagramSkills: Object.fromEntries(DIAGRAM.map((s) => [s, exists(join(globalSkillsDir, s, 'SKILL.md'))])),
    codex: out('codex', ['--version']) !== null,
    existing: EXISTING.filter((p) => exists(join(target, p))),
  };
}

// Adds only hooks, permissions entries and missing env keys; a hook already registered with the same matcher and command
// is not added again, and an env value the project already set stays.
export function mergeSettings(existing, add) {
  const out = structuredClone(existing);
  for (const [event, groups] of Object.entries(add.hooks ?? {})) {
    const mine = ((out.hooks ??= {})[event] ??= []);
    for (const g of groups) {
      const same = mine.find((m) => m.matcher === g.matcher);
      const hooks = g.hooks.filter((h) => !same?.hooks?.some((x) => x.command === h.command));
      if (!hooks.length) continue;
      if (same) (same.hooks ??= []).push(...hooks);
      else mine.push({ ...g, hooks });
    }
  }
  for (const [key, list] of Object.entries(add.permissions ?? {})) {
    const cur = ((out.permissions ??= {})[key] ??= []);
    for (const v of list) if (!cur.includes(v)) cur.push(v);
  }
  for (const [k, v] of Object.entries(add.env ?? {})) (out.env ??= {})[k] ??= v;
  return out;
}

export function mergeGitignore(text, lines) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = [];
  for (const l of lines.map((x) => x.trim())) if (l && !have.has(l)) { have.add(l); add.push(l); }
  if (!add.length) return text;
  return (text && !text.endsWith('\n') ? text + eol : text) + add.map((l) => l + eol).join('');
}

// Setup asks only for the planner's effort; the model stays what the table says.
export function setPlannerRow(tableText, effort) {
  return tableText.replace(/^\|\s*`planner`\s*\|.*$/gm, (line) => {
    const cells = line.split('|');
    cells[5] = ` ${effort} `;
    return cells.join('|');
  });
}

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const sha = (data) => createHash('sha256').update(data).digest('hex');
// Hashes of the files setup wrote, keyed by target path. A missing or unreadable record is empty: its files are conflicts as before.
function readRecord(target) {
  try { return JSON.parse(readFileSync(join(target, INSTALL_RECORD), 'utf8')).files ?? {}; } catch { return {}; }
}

export function planInstall(templateDir, codexDir, target, answers, ins) {
  const plan = { target, copy: [], skip: [], conflict: [] };
  const installed = readRecord(target);
  const sources = walk(templateDir).map((rel) => [templateDir, rel]);
  if (answers.codex) sources.push(...walk(codexDir).map((rel) => [codexDir, rel]));
  for (const [dir, rel] of sources) {
    const from = join(dir, rel);
    const skill = DIAGRAM.find((s) => rel.startsWith(`.claude/skills/${s}/`));
    if (skill && ins.globalDiagramSkills[skill]) {
      const to = `.claude/skills/${skill}`;
      if (!plan.skip.some((s) => s.to === to)) plan.skip.push({ to, reason: '전역에 있음' });
      continue;
    }
    // the keep list comes from `coordinator-settings.mjs init-keep` after the copy (see initKeep)
    if (rel === KEEP) { plan.skip.push({ to: rel, reason: 'init-keep이 만든다' }); continue; }
    const to = rel === 'gitignore.add' ? '.gitignore' : rel;
    const curPath = join(target, to);
    const cur = existsSync(curPath) ? readFileSync(curPath) : null;
    const src = readFileSync(from, 'utf8');
    let content = readFileSync(from);
    let merged = false;
    if (rel === 'gitignore.add') {
      content = mergeGitignore(cur?.toString('utf8') ?? '', src.split(/\r?\n/));
      merged = true;
    } else if (rel === SETTINGS) {
      const add = JSON.parse(src);
      add.permissions = { ...add.permissions, ask: [...(add.permissions?.ask ?? []), ...answers.approvalPrefixes.flatMap((p) => [`Bash(${p}:*)`, `PowerShell(${p}:*)`])] };
      const existing = cur ? JSON.parse(cur.toString('utf8')) : {};
      const m = mergeSettings(existing, add);
      content = cur && isDeepStrictEqual(m, existing) ? cur : json(m);
      merged = true;
    } else if (rel === GATE_CONFIG) {
      content = json({ ...JSON.parse(src), prefixes: answers.approvalPrefixes });
    } else if (rel === MODEL_TABLE) {
      content = setPlannerRow(src, answers.planner.effort);
    }
    if (cur && cur.equals(Buffer.from(content))) { plan.skip.push({ to, reason: '같은 내용' }); continue; }
    if (cur && !merged) {
      // setup wrote this file and it changed since: the user's edit, not a conflict to approve (설계서 14.3절)
      if (installed[to] && installed[to] !== sha(cur)) { plan.skip.push({ to, reason: '사용자가 고침' }); continue; }
      plan.conflict.push(to);
    }
    plan.copy.push({ from, to, content });
  }
  return plan;
}

// plan.copy also holds conflicting files; they are written only when their path is in opts.approve.
export function applyInstall(plan, opts = { approve: [] }) {
  const approve = (opts.approve ?? []).map((a) => a.replaceAll('\\', '/'));
  const written = [];
  const conflicts = [];
  const files = readRecord(plan.target);
  for (const c of plan.copy) {
    if (plan.conflict.includes(c.to) && !approve.includes(c.to)) { conflicts.push(c.to); continue; }
    const p = join(plan.target, c.to);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c.content);
    written.push(c.to);
    files[c.to] = sha(c.content);
  }
  if (written.length) {
    mkdirSync(join(plan.target, '.claude'), { recursive: true });
    writeFileSync(join(plan.target, INSTALL_RECORD), json({ files }));
  }
  return { written, skipped: plan.skip, conflicts };
}

function initKeep(target, mode) {
  const keep = join(target, KEEP);
  let note = '있음';
  if (!existsSync(keep)) {
    const r = spawnSync(process.execPath, ['.claude/scripts/coordinator-settings.mjs', 'init-keep'], { cwd: target, encoding: 'utf8' });
    note = 'init-keep';
    if (r.status !== 0 || !existsSync(keep)) {
      mkdirSync(dirname(keep), { recursive: true });
      copyFileSync(join(TEMPLATE, KEEP), keep);
      note = `init-keep 실패, 틀의 빈 목록을 복사함: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop()}`;
    }
  }
  const k = JSON.parse(readFileSync(keep, 'utf8'));
  if (k.permissionMode !== mode) { k.permissionMode = mode; writeFileSync(keep, json(k)); }
  return note;
}

function verify(target) {
  const claudeDir = join(target, '.claude');
  const checks = existsSync(claudeDir) ? walk(claudeDir).filter((f) => f.endsWith('.check.mjs')).map((f) => [`.claude/${f}`]) : [];
  checks.push(['.claude/scripts/model-selection.mjs', 'check'], ['.claude/scripts/wait-contract-check.mjs']);
  let failed = 0;
  console.log('| 명령 | 결과 |\n| --- | --- |');
  for (const args of checks) {
    const r = spawnSync(process.execPath, args, { cwd: target, encoding: 'utf8' });
    const last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').pop()?.replaceAll('|', '\\|') ?? '';
    if (r.status !== 0) failed++;
    console.log(`| \`node ${args.join(' ')}\` | ${r.status === 0 ? '✅' : '❌'} ${last} |`);
  }
  console.log(`verify: ${checks.length - failed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

const DEPS = {
  run: (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw r.error ?? new Error(r.stderr);
    return r.stdout;
  },
  exists: existsSync,
  globalSkillsDir: join(homedir(), '.claude', 'skills'),
};

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  const target = resolve(opt('--target') ?? '.');
  if (cmd === 'inspect') { console.log(JSON.stringify(inspect(target, DEPS), null, 2)); return 0; }
  if (cmd === 'verify') return verify(target);
  if (cmd === 'install') {
    const answers = JSON.parse(readFileSync(opt('--answers'), 'utf8'));
    if (!MODES.includes(answers.coordinatorPermissionMode)) throw new Error(`coordinatorPermissionMode는 ${MODES.join(', ')} 중 하나다`);
    if (!Array.isArray(answers.approvalPrefixes)) throw new Error('answers에 approvalPrefixes 배열이 있어야 한다');
    if (!PLANNER_EFFORTS.includes(answers.planner?.effort)) throw new Error(`planner.effort는 ${PLANNER_EFFORTS.join(', ')} 중 하나다`);
    const approve = (opt('--approve') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const r = applyInstall(planInstall(TEMPLATE, CODEX, target, answers, inspect(target, DEPS)), { approve });
    r.keep = initKeep(target, answers.coordinatorPermissionMode);
    console.log(JSON.stringify(r, null, 2));
    return r.conflicts.length ? 2 : 0;
  }
  console.log('usage: setup.mjs inspect|install|verify --target <dir> [--answers <json>] [--approve <path,...>]');
  return 1;
}

// realpath on both sides: a junction or symlink in the plugin path must not stop the CLI from running
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
