#!/usr/bin/env node
// Setup for the Orca harness template: inspect a project, install the template, verify the result.
// Usage: node setup.mjs inspect --target <dir>
//        node setup.mjs install --target <dir> --answers <json file> [--approve <path,...>]   exit 2 when unapproved conflicts remain
//        node setup.mjs verify --target <dir>                                              exit 1 when a check fails
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readRoster } from '../../../template/.claude/scripts/roster.mjs';

const TEMPLATE = fileURLToPath(new URL('../../../template', import.meta.url));
const CODEX = fileURLToPath(new URL('../../../template-codex', import.meta.url));
const KEEP = '.claude/coordinator.keep.json';
const SETTINGS = '.claude/settings.json';
const GATE_CONFIG = '.claude/hooks/approval-gate.config.json';
const MODEL_TABLE = 'docs/harness/model-selection.md';
const DOCS_SKILL = '.claude/skills/docs-management';
const TEMPLATES = 'docs/harness/templates';
const DRAFT_MANIFEST = new URL('../references/document-drafts.json', import.meta.url);
const DRAFT_FORMS = JSON.parse(readFileSync(DRAFT_MANIFEST, 'utf8'));
const INSTALL_RECORD = '.claude/harness-install.json';
const DIAGRAM = ['dag-swimlane', 'waterfall-timeline'];
const EXISTING = ['AGENTS.md', 'CLAUDE.md', '.claude', '.gitignore', '.agents', '.codex', 'package.json', 'Makefile'];
const MODES = ['default', 'acceptEdits', 'bypassPermissions'];
const PM_MODELS = ['sonnet', 'opus', 'fable'];
const PM_EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const PM_DEFAULT = { model: 'fable', effort: 'xhigh' };
// Files earlier kit versions installed. Listed by name: the install record also holds merged and generated files.
const RETIRED = [
  '.claude/skills/team-lead/SKILL.md', '.claude/skills/team-qa/SKILL.md',
  '.agents/skills/team-lead/SKILL.md', 'docs/harness/templates/team-skill.md',
  '.claude/agents/planner.md', '.claude/agents/code-reviewer.md', '.claude/agents/qa-inspector.md',
  '.codex/agents/planner.toml', '.codex/agents/code-reviewer.toml', '.codex/agents/qa-inspector.toml',
];
const OLD_ROSTER = 'docs/harness/team-org.md';
const SKELETON = '> 이 스킬은 틀이다. `agent-author`가 프로젝트에 맞게 채운다.';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'worktrees']);
const fileNames = (dir, re) => (existsSync(dir) ? readdirSync(dir).map((f) => re.exec(f)?.[1]).filter(Boolean).sort() : []);

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
    migration: exists(join(target, OLD_ROSTER)) ? {
      roster: OLD_ROSTER,
      projectRoles: fileNames(join(target, '.claude/agents'), /^(.+)\.md(?:\.agent-toggle-off)?$/)
        .filter((n) => !existsSync(join(TEMPLATE, '.claude/agents', n + '.md')) && !RETIRED.includes(`.claude/agents/${n}.md`)),
    } : null,
    unfilledSkills: fileNames(join(target, '.claude/skills'), /^(.+)$/).filter((n) => {
      const skill = join(target, '.claude/skills', n, 'SKILL.md');
      return existsSync(skill) && readFileSync(skill, 'utf8').split(/\r?\n/).includes(SKELETON);
    }),
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

// Setup asks for the PM's model and effort; they go to the one 기획 row.
const PM_ROW = /^\|[ \t]*`product-manager`[ \t]*\|[ \t]*기획[ \t]*\|.*$/m;
export function setPmRow(tableText, pm) {
  return tableText.replace(PM_ROW, (line) => {
    const cells = line.split('|');
    cells[4] = ` ${pm.model} `;
    cells[5] = ` ${pm.effort} `;
    return cells.join('|');
  });
}
function hasPmRow(tableText, pm) {
  const cells = PM_ROW.exec(tableText)?.[0].split('|').map((c) => c.trim());
  return cells?.[4] === pm.model && cells?.[5] === pm.effort;
}

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const sha = (data) => createHash('sha256').update(data).digest('hex');
function agentOff(target, to) {
  return /^(?:\.claude\/agents\/[^/]+\.md|\.codex\/agents\/[^/]+\.toml)$/.test(to) && existsSync(join(target, to + '.agent-toggle-off'));
}
// Hashes of the files setup wrote, keyed by target path. A missing or unreadable record is empty: its files are conflicts as before.
function readRecord(target) {
  try { return JSON.parse(readFileSync(join(target, INSTALL_RECORD), 'utf8')).files ?? {}; } catch { return {}; }
}

function documentDraft(to, formPath, source) {
  const structure = /^(`{3,})markdown\n([\s\S]+?)^\1$/m.exec(source.replaceAll('\r\n', '\n'))?.[2];
  if (!structure) throw new Error(`문서 구조가 없는 양식: ${formPath}`);
  const [title, ...blocks] = structure.trimEnd().split(/\n\n+/);
  const parts = [title.includes('<') ? source.split(/\r?\n/)[0].replace(/ 양식$/, '') : title];
  parts.push(`> 설치 초안 · [작성 양식](${posix.relative(posix.dirname(to), formPath)})`);
  // Copy the structure. Example IDs, commands, releases and results stay in the form.
  let omitSection = false;
  for (const block of blocks) {
    if (block.startsWith('## ')) {
      omitSection = (to.startsWith('docs/05-api/') && block === '## 스키마: 객체')
        || (to.startsWith('docs/06-database/') && block === '## 스키마: 연산')
        || block.startsWith('## [<버전>]');
    }
    if (omitSection) continue;
    if (block.startsWith('- 읽는 시점:')) parts.push(block.replace('<phase>', '없음'));
    else if (block.startsWith('##')) parts.push(block.replace(/-\d{3}\b/g, '-###'));
    else if (block.startsWith('|')) {
      const [header, separator, ...rows] = block.split('\n');
      const table = [header, separator];
      if (/^\| 항목 \| (값|정의) \|$/.test(header)) {
        for (const row of rows) {
          const field = row.split('|')[1]?.trim();
          if (field && !field.includes('<')) table.push(`| ${field} | |`);
        }
      }
      parts.push(table.join('\n'));
    } else if (['요청', '응답', '오류'].includes(block)) {
      parts.push(block);
    }
  }
  return parts.join('\n\n') + '\n';
}

function planDocumentDrafts(plan, templateDir) {
  const index = join(plan.target, 'docs/DOCUMENTATION_INDEX.md');
  const rows = existsSync(index) ? readFileSync(index, 'utf8').split(/\r?\n/).map(line => line.split('|').map(cell => cell.trim())) : [];
  for (const [to, form] of Object.entries(DRAFT_FORMS)) {
    const folder = posix.dirname(to);
    const location = folder === 'docs' ? to : folder + '/';
    const [, , , canonical, , , status] = rows.find(cells => cells[1] === '`' + location + '`') ?? [];
    const indexed = (canonical && canonical !== '없음') || status === '해당 없음';
    const rootChangelog = form === 'changelog.md' && existsSync(join(plan.target, 'CHANGELOG.md'));
    if (existsSync(join(plan.target, to)) || rootChangelog || indexed) {
      plan.skip.push({ to, reason: '기존 문서 또는 색인 유지' });
      continue;
    }
    const formPath = `${TEMPLATES}/product-docs/${form}`;
    const from = join(templateDir, formPath);
    plan.copy.push({ from, to, content: documentDraft(to, formPath, readFileSync(from, 'utf8')), draft: true });
  }
}

export function planInstall(templateDir, codexDir, target, answers, ins) {
  const plan = { target, copy: [], skip: [], conflict: [], notices: [] };
  const pm = { ...PM_DEFAULT, ...answers.pm };
  const installed = readRecord(target);
  const sources = walk(templateDir).map((rel) => [join(templateDir, rel), rel]);
  if (answers.codex) sources.push(...walk(codexDir).map((rel) => [join(codexDir, rel), rel]));
  sources.push(
    [fileURLToPath(DRAFT_MANIFEST), `${TEMPLATES}/document-drafts.json`],
    [fileURLToPath(new URL('../assets/model-survey.html', import.meta.url)), `${TEMPLATES}/model-survey.html`],
    [fileURLToPath(new URL('./model-table.mjs', import.meta.url)), '.claude/scripts/model-table.mjs'],
  );
  for (const [from, rel] of sources) {
    if (rel === DOCS_SKILL + '/SKILL.md') planDocumentDrafts(plan, templateDir);
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
    if (agentOff(target, to)) {
      plan.skip.push({ to, reason: '에이전트 OFF' });
      continue;
    }
    // a default agent setup wrote and the project renamed or dropped in step 7 stays gone (설계서 4.4); other missing files are refilled.
    // An agent switched OFF was handled above.
    if (/^\.claude\/agents\/[^/]+\.md$/.test(to) && installed[to] && !existsSync(curPath)) { plan.skip.push({ to, reason: '사용자가 지움' }); continue; }
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
      content = setPmRow(src, pm);
    }
    if (cur && cur.equals(Buffer.from(content))) { plan.skip.push({ to, reason: '같은 내용' }); continue; }
    if (cur && !merged) {
      // setup wrote this file and it changed since: the user's edit, not a conflict to approve (설계서 14.3절)
      if (installed[to] && installed[to] !== sha(cur)) {
        plan.skip.push({ to, reason: '사용자가 고침' });
        if (rel === MODEL_TABLE && !hasPmRow(cur.toString('utf8'), pm)) {
          plan.notices.push(`${MODEL_TABLE}는 사용자가 고친 파일이라 건너뛰었다. \`product-manager | 기획\` 행이 없거나 고른 값 ${pm.model}/${pm.effort}와 다르다. 0.5.1에서 올리는 중이면 agent-author의 "0.5.1 프로젝트 옮기기"대로 표를 직접 옮긴다.`);
        }
        continue;
      }
      plan.conflict.push(to);
    }
    plan.copy.push({ from, to, content });
  }
  plan.retire = RETIRED.filter((p) => existsSync(join(target, p))).map((path) => {
    const recorded = installed[path];
    return { path, state: !recorded ? 'untracked' : recorded === sha(readFileSync(join(target, path))) ? 'unchanged' : 'modified' };
  });
  return plan;
}

// plan.copy also holds conflicting files; they are written only when their path is in opts.approve.
// A retired file the project edited or setup never recorded is deleted only when approved, the same way.
export function applyInstall(plan, opts = { approve: [] }) {
  const approve = (opts.approve ?? []).map((a) => a.replaceAll('\\', '/'));
  const written = [];
  const conflicts = [];
  const skipped = [...plan.skip];
  const files = readRecord(plan.target);
  for (const c of plan.copy) {
    if (agentOff(plan.target, c.to)) { skipped.push({ to: c.to, reason: '에이전트 OFF' }); continue; }
    if (plan.conflict.includes(c.to) && !approve.includes(c.to)) { conflicts.push(c.to); continue; }
    const p = join(plan.target, c.to);
    mkdirSync(dirname(p), { recursive: true });
    try {
      writeFileSync(p, c.content, { flag: c.draft ? 'wx' : 'w' });
    } catch (error) {
      if (!c.draft || error.code !== 'EEXIST') throw error;
      skipped.push({ to: c.to, reason: '기존 문서 유지' });
      continue;
    }
    written.push(c.to);
    files[c.to] = sha(c.content);
  }
  const retired = [];
  for (const { path, state } of plan.retire ?? []) {
    if (state !== 'unchanged' && !approve.includes(path)) { conflicts.push(path); continue; }
    unlinkSync(join(plan.target, path));
    const dir = dirname(join(plan.target, path));
    if (readdirSync(dir).length === 0) rmdirSync(dir); // only the now-empty folder, never recursive
    delete files[path];
    retired.push(path);
  }
  if (written.length || retired.length) {
    mkdirSync(join(plan.target, '.claude'), { recursive: true });
    writeFileSync(join(plan.target, INSTALL_RECORD), json({ files }));
  }
  return { written, skipped, conflicts, retired, notices: plan.notices ?? [] };
}

// Use the installed Markdown so project-specific role edits reach Codex too.
function syncAgents(target, names, approve = []) {
  const files = readRecord(target);
  const plan = { target, copy: [], skip: [], conflict: [] };
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name ?? '') || !name) throw new Error('잘못된 에이전트 이름');
    const to = `.codex/agents/${name}.toml`;
    const path = join(target, to);
    if (agentOff(target, to)) {
      plan.skip.push({ to, reason: '에이전트 OFF' });
      continue;
    }
    const active = join(target, '.claude/agents', name + '.md');
    const from = existsSync(active) ? active : active + '.agent-toggle-off';
    const source = readFileSync(from, 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
    const match = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n([\s\S]+)$/.exec(source);
    if (!match || match[1] !== name || !match[3].trim()) throw new Error(`${from}: docs/harness/templates/agent.md 양식을 확인하세요`);
    const description = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    if (!description.trim()) throw new Error(`${from}: description이 비어 있습니다`);
    const content = `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(description)}\ndeveloper_instructions = ${JSON.stringify(match[3])}\n`;
    if (existsSync(path)) {
      const current = readFileSync(path);
      if (current.equals(Buffer.from(content))) continue;
      if (files[to] !== sha(current)) plan.conflict.push(to);
    }
    plan.copy.push({ from, to, content });
  }
  return applyInstall(plan, { approve });
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
  checks.push(['.claude/scripts/model-selection.mjs', 'check']);
  let failed = 0, passed = 0;
  console.log('| 명령 | 결과 |\n| --- | --- |');
  // every agent on the installed roster passes the role checker (설계서 4.4의 4); a switched-off one has no role file to check
  let agents = [];
  try { agents = [...new Set(readRoster(target).map((r) => r.agent))]; } catch (error) { failed++; console.log(`| \`docs/harness/agents.md\` | ❌ ${error.message.replaceAll('|', '\\|')} |`); }
  for (const name of agents) {
    if (!existsSync(join(target, '.claude/agents', name + '.md')) && existsSync(join(target, '.claude/agents', name + '.md.agent-toggle-off'))) continue;
    checks.push(['.claude/scripts/agent-definition.mjs', '--agent', name]);
  }
  for (const args of checks) {
    const r = spawnSync(process.execPath, args, { cwd: target, encoding: 'utf8' });
    const last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').pop()?.replaceAll('|', '\\|') ?? '';
    if (r.status !== 0) failed++; else passed++;
    console.log(`| \`node ${args.join(' ')}\` | ${r.status === 0 ? '✅' : '❌'} ${last} |`);
  }
  console.log(`verify: ${passed} passed, ${failed} failed`);
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
  if (cmd === 'sync-agent') {
    const result = syncAgents(target, [opt('--agent')]);
    console.log(json(result));
    return result.conflicts.length ? 2 : 0;
  }
  if (cmd === 'install') {
    const answers = JSON.parse(readFileSync(opt('--answers'), 'utf8'));
    if (!MODES.includes(answers.coordinatorPermissionMode)) throw new Error(`coordinatorPermissionMode는 ${MODES.join(', ')} 중 하나다`);
    if (!Array.isArray(answers.approvalPrefixes)) throw new Error('answers에 approvalPrefixes 배열이 있어야 한다');
    if (answers.planner) throw new Error('planner.effort는 pm.model과 pm.effort로 바뀌었다. answers에서 planner를 지우고 pm을 쓴다');
    const pm = { ...PM_DEFAULT, ...answers.pm };
    if (!PM_MODELS.includes(pm.model)) throw new Error(`pm.model은 ${PM_MODELS.join(', ')} 중 하나다`);
    if (!PM_EFFORTS.includes(pm.effort)) throw new Error(`pm.effort는 ${PM_EFFORTS.join(', ')} 중 하나다`);
    const approve = (opt('--approve') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const r = applyInstall(planInstall(TEMPLATE, CODEX, target, answers, inspect(target, DEPS)), { approve });
    if (answers.codex && r.conflicts.length) {
      r.skipped.push({ to: '.codex/agents/', reason: '설치 충돌 해결 뒤 역할 동기화' });
    } else if (answers.codex) {
      // a default agent the project removed has no Markdown to sync from
      const names = readdirSync(join(TEMPLATE, '.claude/agents')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
        .filter((n) => ['', '.agent-toggle-off'].some((off) => existsSync(join(target, '.claude/agents', n + '.md' + off))));
      const agents = syncAgents(target, names, approve);
      r.written.push(...agents.written);
      r.skipped.push(...agents.skipped);
      r.conflicts.push(...agents.conflicts);
    }
    r.keep = initKeep(target, answers.coordinatorPermissionMode);
    console.log(JSON.stringify(r, null, 2));
    return r.conflicts.length ? 2 : 0;
  }
  console.log('usage: setup.mjs inspect|install|verify|sync-agent --target <dir> [--answers <json>] [--approve <path,...>] [--agent <name>]');
  return 1;
}

// realpath on both sides: a junction or symlink in the plugin path must not stop the CLI from running
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
