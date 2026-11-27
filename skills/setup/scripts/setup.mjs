#!/usr/bin/env node
// Setup for the Orca harness template: inspect a project, install the template, verify the result.
// Usage: node setup.mjs inspect --target <dir>
//        node setup.mjs install --target <dir> --answers <json file> [--approve <path,...>] [--routing <id,...>]   exit 2 when unapproved conflicts remain
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

// Request routing lines older kits installed and the lines that replace them. In an existing file setup changes only these
// lines; a hunk applies only when the template ships its new lines. `find` locates a line the project rewrote;
// `known` is the new rule in the project's own words, taken as migrated while no direct-handling rule is left in the file.
const OLD_DIRECT_ROW = '| 단순 질문, BL 지정이 없는 한 파일의 작은 수정 | 창구가 직접 한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다. |';
const DIRECT = /창구가 (?:직접|바로)/; // a rule that lets the front desk act without asking
const DIRECT_ROW = /^\|[^|]*\|[^|]*창구가 (?:직접|바로)/;
export const ROUTING = {
  'AGENTS.md': [
    {
      old: ['**규모별 경로.**'],
      new: ['**규모별 경로.** 창구는 새 수행 요청마다 규모를 판단한다. 아래의 간단한 수행 요청 외에는 모두 작업 착수 전에 `plan-orchestrate`로 접수한다. 진행 중 요청의 범위가 달라지면 새 범위로 판단한다.'],
      find: /^\*\*규모별 경로\.\*\*/,
      known: /^\*\*규모별 경로\.\*\*.*plan-orchestrate/,
    },
    {
      old: [OLD_DIRECT_ROW],
      new: [
        '| 단순 설명 질문 | 창구가 답한다. |',
        '| 간단한 수행 요청(예: BL 지정이 없는 한 파일의 작은 수정) | 매 요청마다 작업 전에 ask로 “plan-orchestrate 없이 제가 수행할까요?”라고 묻는다. 명시적으로 동의하면 해당 요청만 직접 수행하고 검증한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다. 직접 수행을 거절하면 plan-orchestrate로 접수하고, 답변 전에는 기다린다. |',
      ],
      find: DIRECT_ROW,
      known: /^\|.*ask.*동의/,
    },
  ],
  '.claude/skills/coordinator/SKILL.md': [{
    old: [OLD_DIRECT_ROW],
    new: ['| 단순 질문·간단한 수행 요청·그 밖의 새 수행 요청 | `AGENTS.md` §규모별 경로에 따라 답변·ask·plan-orchestrate 접수를 구분한다. |'],
    find: DIRECT_ROW,
    known: /^\|.*규모별 경로.*ask/,
  }],
  '.claude/skills/coordinator/references/front-desk.md': [{
    old: ['- 단순 질문이나 백로그 ID 지정이 없는 한 파일의 작은 수정은 창구가 직접 한다. Run도 phase 폴더도 만들지 않는다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다.'],
    new: ['- 새 요청은 `AGENTS.md` §규모별 경로를 따른다. 간단한 수행 요청은 ask에서 직접 수행에 동의한 경우에만 Run·phase 폴더 없이 진행한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다.'],
    find: /^- .*창구가 (?:직접|바로)/,
    known: /^- .*ask.*동의/,
  }, {
    old: ['- 브리프에 승인된 BL과 동일한 버전의 배정·DAG·검토 기록을 전달한다. 일반 소규모 수정은 원래 창구 경로를 따른다. 승인된 계획의 Task는 코디네이터가 그 Task의 에이전트에게 직접 배정한다.'],
    new: ['- 브리프에 승인된 BL과 동일한 버전의 배정·DAG·검토 기록을 전달한다. 간단한 수행 요청은 첫 항목의 ask 동의 규칙을 따른다. 승인된 계획의 Task는 코디네이터가 그 Task의 에이전트에게 직접 배정한다.'],
    find: /^- 브리프에 승인된 BL/,
    known: /^- .*ask.*동의/, // with the ask bullet in place, "원래 창구 경로" already means that rule
  }],
  '.claude/skills/plan-orchestrate/SKILL.md': [{
    old: ['## 접수 경로', ''],
    new: ['## 접수 경로', '', '창구는 `AGENTS.md` §규모별 경로에 따라 접수한다. 간단한 수행 요청에서 사용자가 직접 수행을 거절한 경우도 이 절차로 진행한다.', ''],
    find: /^## 접수 경로/,
    known: /직접 수행을 거절/,
  }],
};
const blockAt = (lines, block) => lines.flatMap((_, i) => (block.every((b, k) => lines[i + k] === b) ? [i] : []));

// Rewrites the routing hunks of one file when every hunk still holds the exact old lines, once and with no other direct-handling
// rule in its paragraph or table. Otherwise nothing is written and each hunk is returned as a proposal whose id
// binds its position, current lines and proposed lines; only ids in `chosen` are applied, so an edit after display drops the id.
export function migrateRouting(path, text, hunks, chosen = []) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const raw = text.split(/(?<=\n)/);
  const lines = raw.map((l) => l.replace(/\r?\n$/, ''));
  const all = [];
  let done = 0;
  const offer =(state, at, len, proposed, extra = {}) => {
    const current = lines.slice(at, at + len);
    all.push({ id: sha([path, at, ...current, '\0', ...proposed].join('\n')).slice(0, 12), path, state, line: at + 1, current, proposed, ...extra });
  };
  for (const h of hunks) {
    const fresh = blockAt(lines, h.new);
    const old = blockAt(lines, h.old).filter((i) => !fresh.some((f) => i < f + h.new.length && f < i + h.old.length));
    if (!old.length && fresh.length) { done++; continue; } // already the new rule
    if (!fresh.length && lines.some((l) => h.known.test(l)) && !lines.some((l) => DIRECT.test(l))) { done++; continue; } // migrated by hand
    if (old.length === 1 && !fresh.length) {
      const [at] = old;
      let a = at, b = at + h.old.length;
      while (a > 0 && lines[a - 1].trim()) a--;
      while (b < lines.length && lines[b].trim()) b++;
      const conflicts = [];
      for (let i = a; i < b; i++) if ((i < at || i >= at + h.old.length) && DIRECT.test(lines[i]) && !hunks.some((o) => o.old.includes(lines[i]))) conflicts.push({ line: i + 1, text: lines[i] });
      offer(conflicts.length ? 'conflict' : 'old', at, h.old.length, h.new, conflicts.length ? { conflicts } : {});
    } else if (old.length) {
      for (const at of old) offer('duplicate', at, h.old.length, fresh.length ? [] : h.new); // the new rule is there too: drop the old lines
    } else {
      const near = lines.flatMap((l, i) => (h.find.test(l) ? [i] : []));
      if (!near.length) all.push({ id: null, path, state: 'missing', line: null, current: [], proposed: h.new });
      for (const at of near) offer(near.length === 1 ? 'modified' : 'ambiguous', at, 1, h.new);
    }
  }
  // A file part rewritten by hand (some hunks new, some old) is a project edit: what is left waits for a choice.
  const auto = !done && all.every((p) => p.state === 'old');
  const apply = auto ? all : all.filter((p) => chosen.includes(p.id));
  for (const p of [...apply].sort((x, y) => y.line - x.line)) {
    const at = p.line - 1, len = p.current.length;
    const last = /\r?\n$/.exec(raw[at + len - 1])?.[0] ?? '';
    raw.splice(at, len, ...p.proposed.map((l, k) => l + (k === p.proposed.length - 1 ? last : eol)));
  }
  return { text: raw.join(''), applied: apply.map((p) => p.id), proposals: auto ? [] : all.filter((p) => !apply.includes(p)) };
}
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

// choices.routing: proposal ids from an earlier run's `routing` the user chose to apply.
export function planInstall(templateDir, codexDir, target, answers, ins, choices = {}) {
  const plan = { target, copy: [], skip: [], conflict: [], notices: [], patch: [], routing: [] };
  const chosen = choices.routing ?? [];
  const applied = [];
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
    // Routing lines change before the whole-file rules below, which still classify the rest of the file as before.
    if (cur && ROUTING[to]) {
      const shipped = content.toString('utf8').split(/\r?\n/);
      const hunks = ROUTING[to].filter((h) => blockAt(shipped, h.new).length);
      const r = migrateRouting(to, cur.toString('utf8'), hunks, chosen);
      plan.routing.push(...r.proposals);
      applied.push(...r.applied);
      if (r.text !== cur.toString('utf8')) {
        const same = Buffer.from(r.text).equals(content);
        // The record keeps saying what setup wrote: a project's own edits are never recorded as kit content.
        plan.patch.push({ to, content: r.text, record: same ? sha(content) : installed[to] === sha(cur) ? sha(r.text) : installed[to] });
        if (same) continue;
      }
    }
    if (cur && !merged) {
      // setup wrote this file and it changed since: the user's edit, overwritten only when its path is approved, never a conflict (설계서 4.4)
      if (installed[to] && installed[to] !== sha(cur)) {
        const notice = rel === MODEL_TABLE && !hasPmRow(cur.toString('utf8'), pm)
          ? `${MODEL_TABLE}는 사용자가 고친 파일이라 건너뛰었다. \`product-manager | 기획\` 행이 없거나 고른 값 ${pm.model}/${pm.effort}와 다르다. 0.5.1에서 올리는 중이면 agent-author의 "0.5.1 프로젝트 옮기기"대로 표를 직접 옮긴다.`
          : undefined;
        // listed only when the kit has something new since the record
        plan.copy.push({ from, to, content, edited: true, listed: sha(content) !== installed[to], notice });
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
  plan.stale = chosen.filter((id) => !applied.includes(id));
  return plan;
}

// plan.copy also holds conflicting and project-edited files; they are written only when their path is in opts.approve.
// A retired file the project edited or setup never recorded is deleted only when approved, the same way.
export function applyInstall(plan, opts = { approve: [] }) {
  const approve = (opts.approve ?? []).map((a) => a.replaceAll('\\', '/'));
  const written = [];
  const conflicts = [];
  const edited = [];
  const notices = [...(plan.notices ?? [])];
  const skipped = [...plan.skip];
  const files = readRecord(plan.target);
  const routed = [];
  for (const p of plan.patch ?? []) {
    if (approve.includes(p.to) && plan.copy.some((c) => c.to === p.to)) continue; // the approved whole file is written below
    writeFileSync(join(plan.target, p.to), p.content);
    routed.push(p.to);
    if (p.record) files[p.to] = p.record;
  }
  for (const c of plan.copy) {
    if (agentOff(plan.target, c.to)) { skipped.push({ to: c.to, reason: '에이전트 OFF' }); continue; }
    if (plan.conflict.includes(c.to) && !approve.includes(c.to)) { conflicts.push(c.to); continue; }
    if (c.edited && !approve.includes(c.to)) {
      skipped.push({ to: c.to, reason: '사용자가 고침' });
      if (c.listed) edited.push(c.to);
      if (c.notice) notices.push(c.notice);
      continue;
    }
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
  if (written.length || retired.length || routed.length) {
    mkdirSync(join(plan.target, '.claude'), { recursive: true });
    writeFileSync(join(plan.target, INSTALL_RECORD), json({ files }));
  }
  return { written, routed, skipped, conflicts, edited, retired, notices, routing: plan.routing ?? [], stale: plan.stale ?? [] };
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
    const list = (k) => (opt(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const approve = list('--approve');
    const r = applyInstall(planInstall(TEMPLATE, CODEX, target, answers, inspect(target, DEPS), { routing: list('--routing') }), { approve });
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
  console.log('usage: setup.mjs inspect|install|verify|sync-agent --target <dir> [--answers <json>] [--approve <path,...>] [--routing <id,...>] [--agent <name>]');
  return 1;
}

// realpath on both sides: a junction or symlink in the plugin path must not stop the CLI from running
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
