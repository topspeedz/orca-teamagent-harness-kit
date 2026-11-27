// Self-test for setup.mjs — builds a small template in a temp folder. `node skills/setup/scripts/setup.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyInstall, inspect, mergeGitignore, migrateRouting, planInstall, ROUTING } from './setup.mjs';
import { lookup, parseTable } from '../../../template/.claude/scripts/model-selection.mjs';
import { applyChoices } from './model-table.mjs';

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
const realTemplate = fileURLToPath(new URL('../../../template', import.meta.url));
const tablePath = 'docs/harness/model-selection.md';
put(tpl, tablePath, read(realTemplate, tablePath));
put(tpl, '.claude/agents/backend.md', '---\nname: backend\ndescription: 백엔드\n---\n# backend\n');
put(tpl, '.claude/skills/dag-swimlane/SKILL.md', '---\nname: dag-swimlane\n---\n');
put(tpl, '.claude/skills/waterfall-timeline/SKILL.md', '---\nname: waterfall-timeline\n---\n');
put(codex, '.codex/hooks.json', '{}\n');
put(codex, '.agents/skills/coordinator/SKILL.md', 'pointer\n');

const ANSWERS = { codex: false, approvalPrefixes: [], coordinatorPermissionMode: 'default' };
const INS = { git: true, orca: '1.4.255', node: process.version, superpowers: true, globalDiagramSkills: { 'dag-swimlane': false, 'waterfall-timeline': false }, codex: false, existing: [] };
const ALL = ['.claude/agents/backend.md', '.claude/hooks/approval-gate.config.json', '.claude/scripts/model-table.mjs', '.claude/settings.json', '.claude/skills/dag-swimlane/SKILL.md', '.claude/skills/waterfall-timeline/SKILL.md', '.gitignore', 'AGENTS.md', 'CLAUDE.md', tablePath, 'docs/harness/templates/document-drafts.json', 'docs/harness/templates/model-survey.html'];
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

test('product drafts use the installed forms and preserve project documents on reinstall', () => {
  const t = target('문서 초안');
  const real = fileURLToPath(new URL('../../../template', import.meta.url));
  const plan = () => planInstall(real, codex, t, ANSWERS, INS);
  const first = applyInstall(plan());
  const drafts = first.written.filter(path => /^docs\/(?:CODEBASE_MAP\.md|\d\d-)/.test(path));
  const forms = JSON.parse(readFileSync(new URL('../references/document-drafts.json', import.meta.url), 'utf8'));
  const pending = read(t, 'docs/DOCUMENTATION_INDEX.md').split('## 작성자 배정 대기')[1].split('## 이 폴더 밖의 문서')[0];
  assert.equal(drafts.length, 13);
  assert.deepEqual([...drafts].sort(), Object.keys(forms).sort());
  assert.deepEqual(JSON.parse(read(t, 'docs/harness/templates/document-drafts.json')), forms);
  const survey = 'docs/harness/templates/model-survey.html';
  assert.equal(read(t, survey), readFileSync(new URL('../assets/model-survey.html', import.meta.url), 'utf8'));
  assert.equal(read(t, '.claude/scripts/model-table.mjs'), readFileSync(new URL('./model-table.mjs', import.meta.url), 'utf8'));
  put(t, 'recommend.json', '[]');
  const page = spawnSync(process.execPath, ['.claude/scripts/model-table.mjs', 'page', '--table', tablePath, '--recommend', 'recommend.json', '--out', 'page.html'], { cwd: t, encoding: 'utf8' });
  assert.equal(page.status, 0, page.stderr);
  const data = JSON.parse(read(t, 'page.html').match(/const DATA = (.*);/)[1]);
  assert.deepEqual(data.rows.filter(r => r.agent === 'product-manager').map(r => r.unit), ['기획', '완료 처리']);
  assert.equal(new Set(Object.values(forms)).size, 12);
  assert.equal(forms['docs/05-api/draft.md'], 'contract.md');
  assert.equal(forms['docs/06-database/draft.md'], 'contract.md');
  assert.equal(drafts.filter(path => path.endsWith('/draft.md')).length, 4);
  const skill = '.claude/skills/docs-management';
  const formRoot = 'docs/harness/templates/product-docs';
  const skillRows = read(t, skill + '/SKILL.md').split(/\r?\n/);
  const roles = readdirSync(join(t, '.claude/agents')).filter(f => f.endsWith('.md')).map(f => read(t, '.claude/agents/' + f)).join('\n');
  for (const path of drafts) {
    const body = read(t, path);
    const link = body.match(/> 설치 초안 · \[작성 양식\]\((.+?)\)/)[1];
    const canonical = join(t, formRoot, forms[path]);
    assert.equal(resolve(t, dirname(path), link), canonical);
    const rowPath = dirname(path) === 'docs' ? path : path.slice(0, path.lastIndexOf('/') + 1);
    const skillRow = skillRows.find(line => line.startsWith('| `' + rowPath + '`'));
    assert.equal(resolve(t, skill, skillRow.match(/\]\(([^)]+\.md)\)/)[1]), canonical);
    assert.match(readFileSync(canonical, 'utf8'), /## 문서 구조/);
    assert.match(read(t, skill + '/references/forms/' + forms[path]), /## 문서 구조/);
    assert.doesNotMatch(body, /prd-writer|doc-steward/);
    if (['prd.md', 'srs.md'].includes(forms[path])) {
      assert.match(body, /소유 에이전트: `product-manager`/);
      assert.ok(!pending.includes(path));
    } else {
      assert.equal(pending.includes('| `' + path + '` | 전체 | 미배정 |'), !roles.includes('`' + path + '`'), path);
    }
    assert.match(body, /^## /m);
    assert.doesNotMatch(body, /\b(?:FR|SCR|ADR|API|US)-\d+|통과 \(<phase 이름>\)/);
  }
  assert.match(read(t, 'docs/05-api/draft.md'), /## 스키마: 연산/);
  assert.doesNotMatch(read(t, 'docs/06-database/draft.md'), /## 스키마: 연산/);
  assert.match(read(t, 'docs/06-database/draft.md'), /## 스키마: 객체/);
  const prd = 'docs/01-product/prd.md';
  put(t, prd, '# 우리 제품\n');
  assert.deepEqual(applyInstall(plan()).written, []);
  assert.equal(read(t, prd), '# 우리 제품\n');
  const missing = 'docs/11-operations/draft.md';
  unlinkSync(join(t, missing));
  assert.deepEqual(applyInstall(plan()).written, [missing]);

  const existing = target('기존 정본');
  put(existing, 'CHANGELOG.md', '# Releases\n');
  put(existing, 'docs/CODEBASE_MAP.md', '내 지도');
  put(existing, 'docs/DOCUMENTATION_INDEX.md', [
    '| `docs/01-product/` | PRD | `product.md` | | | 최신 |',
    '| `docs/03-ui-ux/` | UI | 없음 | | | 해당 없음 |',
  ].join('\n'));
  put(existing, 'product.md', '기존 정본');
  applyInstall(planInstall(real, codex, existing, ANSWERS, INS));
  for (const skipped of [prd, 'docs/03-ui-ux/ui-spec.md', 'docs/12-changelog/CHANGELOG.md']) {
    assert.equal(existsSync(join(existing, skipped)), false);
  }
  assert.equal(read(existing, 'docs/CODEBASE_MAP.md'), '내 지도');
  assert.equal(read(existing, 'product.md'), '기존 정본');
  assert.equal(read(existing, 'CHANGELOG.md'), '# Releases\n');
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

test('legacy links, OFF engines, custom owners and in-progress records survive two reinstalls', () => {
  const t = target('기존 프로젝트');
  const keep = '.claude/coordinator.keep.json';
  put(t, keep, '{"permissionMode":"default"}\n');
  put(t, 'answers.json', JSON.stringify({ ...ANSWERS, codex: true }));
  const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [setup, ...args, '--target', t], { encoding: 'utf8' });
  const reinstall = () => cli('install', '--answers', join(t, 'answers.json'));
  assert.equal(reinstall().status, 0);
  const oldForm = '.claude/skills/docs-management/references/forms/prd.md';
  const draft = 'docs/01-product/prd.md';
  const index = 'docs/DOCUMENTATION_INDEX.md';
  const contract = 'docs/contracts/team-api.md';
  const md = '.claude/agents/backend.md', toml = '.codex/agents/doc-steward.toml';
  for (const file of [md, toml]) renameSync(join(t, file), join(t, file + '.agent-toggle-off'));
  const apiDraft = 'docs/05-api/draft.md';
  unlinkSync(join(t, apiDraft));
  const saved = {
    [oldForm]: '# 우리 팀 양식\n## 작성 규칙\n기존 양식 표식\n',
    [draft]: '# 배포된 PRD\n[작성 양식](../../' + oldForm + ')\n',
    [contract]: '# API 계약\n응답 절 작성자: api-editor\n오류 절 작성자: api-errors\n',
    [index]: '| `docs/05-api/` | API | `' + contract + '` | | 이전 phase | 최신 |\n',
    [tablePath]: '| 에이전트 | 작업 단위 | 런타임 | model | effort | 메모 |\n| --- | --- | --- | --- | --- | --- |\n| `product-manager` | 기획 | codex | custom-id | high | 보존 |\n| `prd-writer` | 요구사항 정리 | claude | custom-claude | high | 유지 |\n| `*` | 기본 | claude | pinned-default | medium | 사용자 기본값 |\n',
    'docs/harness/team-org.md': '# 옛 명단\n| harness | harness-engineer | 단독 |\n',
    '.claude/agents/prd-writer.md': '# 옛 역할의 편집본\n',
    '.agents/skills/product-planning/SKILL.md': '# 옛 사용자 포인터\n',
    [md + '.agent-toggle-off']: read(t, md + '.agent-toggle-off') + '\n꺼진 원문의 편집\n',
    [toml + '.agent-toggle-off']: '# 꺼진 TOML 편집본\n',
    '.claude/scripts/model-table.mjs': '// 사용자 버전의 편집기\n',
    'docs/harness/templates/model-survey.html': '<title>사용자 설문</title>',
    'docs/harness/templates/document-drafts.json': '{"my-doc.md":"my-form.md"}',
    'CHANGELOG.md': '# 프로젝트 릴리스 이력\n',
    '_workspace/_run/old/01_prd-writer_requirements_v2.md': '# 구 요구 검토 이력\n',
    '_workspace/_run/old/03_pm-reviewer_review_v2.md': '# 구 검토 이력\n',
    '_workspace/_run/old/06_pm-reviewer_plan-check_v3.md': '# 구 승인 이력\n',
    '_workspace/_run/old/ledger.md': '기존 Run · Task · Dispatch\n',
  };
  for (const [file, body] of Object.entries(saved)) put(t, file, body);
  // An untracked canonical form at the new path belongs to this project.
  const freshForm = 'docs/harness/templates/product-docs/prd.md';
  const record = JSON.parse(read(t, '.claude/harness-install.json'));
  delete record.files[freshForm];
  put(t, '.claude/harness-install.json', JSON.stringify(record));
  put(t, freshForm, '새 경로의 기존 사용자 양식\n');
  for (let pass = 0; pass < 2; pass++) {
    const result = reinstall();
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.conflicts.includes(freshForm));
    assert.ok(report.skipped.some(s => s.to === '.codex/agents/' && s.reason.includes('충돌')));
    for (const [file, body] of Object.entries(saved)) assert.equal(read(t, file), body, file);
    const link = read(t, draft).match(/\[작성 양식\]\((.+?)\)/)[1];
    assert.equal(readFileSync(resolve(t, dirname(draft), link), 'utf8'), saved[oldForm]);
    assert.equal(read(t, freshForm), '새 경로의 기존 사용자 양식\n');
    for (const path of [md, toml, apiDraft]) assert.equal(existsSync(join(t, path)), false);
  }
  // Claude and Codex toggle independently, including an explicit sync.
  assert.equal(cli('sync-agent', '--agent', 'backend').status, 0);
  assert.match(read(t, '.codex/agents/backend.toml'), /꺼진 원문의 편집/);
  const syncOff = cli('sync-agent', '--agent', 'doc-steward');
  assert.equal(syncOff.status, 0, syncOff.stderr);
  assert.equal(JSON.parse(syncOff.stdout).skipped[0].to, toml);
  assert.equal(existsSync(join(t, toml)), false);
  assert.equal(read(t, toml + '.agent-toggle-off'), saved[toml + '.agent-toggle-off']);
  const check = spawnSync(process.execPath, ['.claude/scripts/model-selection.mjs', 'check'], { cwd: t, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('a role switched off after planning stays off when the plan is applied', () => {
  const t = target('toggle during install');
  const path = '.claude/agents/backend.md';
  const plan = planInstall(realTemplate, codex, t, ANSWERS, INS);
  assert.ok(plan.copy.some(c => c.to === path));
  put(t, path + '.agent-toggle-off', '기존 비활성 정의');
  const result = applyInstall(plan);
  assert.ok(result.skipped.some(s => s.to === path && s.reason === '에이전트 OFF'));
  assert.equal(existsSync(join(t, path)), false);
  assert.equal(read(t, path + '.agent-toggle-off'), '기존 비활성 정의');
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

test('the PM 기획 row resolves exactly, fable/xhigh unless answers.pm says otherwise', () => {
  for (const template of [tpl, realTemplate]) {
    for (const [pm, model, effort] of [[undefined, 'fable', 'xhigh'], [{ model: 'opus' }, 'opus', 'xhigh'], [{ model: 'sonnet', effort: 'max' }, 'sonnet', 'max']]) {
      const t = mkdtempSync(join(root, 'pm-'));
      applyInstall(planInstall(template, codex, t, { ...ANSWERS, pm }, INS));
      const table = read(t, tablePath);
      const { rows } = parseTable(table);
      const r = lookup(rows, 'product-manager', '기획');
      assert.deepEqual([r.matched, r.runtime, r.model, r.effort], ['exact', 'claude', model, effort]);
      assert.equal(rows.filter(r => r.agent === 'product-manager').length, 2);
      const changed = applyChoices(table, [{ agent: 'product-manager', unit: '기획', model: 'opus', effort: 'high' }]);
      assert.equal(changed, table.replace(`| 기획 | claude | ${model} | ${effort} |`, '| 기획 | claude | opus | high |'));
    }
  }
});

test('install refuses a pm model or effort outside the lists', () => {
  const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
  for (const [pm, field] of [[{ model: 'haiku' }, /pm\.model/], [{ effort: 'low' }, /pm\.effort/]]) {
    put(root, 'bad-pm.json', JSON.stringify({ ...ANSWERS, pm }));
    const r = spawnSync(process.execPath, [setup, 'install', '--target', target('bad pm'), '--answers', join(root, 'bad-pm.json')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, field);
  }
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

test('Codex install and team edits preserve the role and protect local TOML edits', () => {
  const t = target('codex roles');
  put(t, '.claude/coordinator.keep.json', '{}');
  put(root, 'codex-answers.json', JSON.stringify({ ...ANSWERS, codex: true }));
  const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [setup, ...args, '--target', t], { encoding: 'utf8' });
  const result = cli('install', '--answers', join(root, 'codex-answers.json'));
  assert.equal(result.status, 0, result.stderr);
  const rel = '.codex/agents/backend.toml';
  assert.match(read(t, rel), /developer_instructions = .*## 핵심 역할/u);
  const body = '# custom\n\n## 입력과 출력\n\n"결과" C:\\tmp\n';
  put(t, '.claude/agents/custom.md', '---\nname: custom\ndescription: "설명"\n---\n' + body);
  const sync = () => cli('sync-agent', '--agent', 'custom');
  assert.equal(sync().status, 0);
  const custom = '.codex/agents/custom.toml';
  assert.equal(read(t, custom), 'name = "custom"\ndescription = "설명"\ndeveloper_instructions = ' + JSON.stringify(body) + '\n');
  put(t, '.claude/agents/custom.md', read(t, '.claude/agents/custom.md') + '변경\n');
  assert.equal(sync().status, 0);
  assert.match(read(t, custom), /변경/u);
  put(t, custom, '# local\n');
  assert.equal(sync().status, 2);
  assert.equal(read(t, custom), '# local\n');
});

const SETUP = fileURLToPath(new URL('./setup.mjs', import.meta.url));
const hash = (body) => createHash('sha256').update(body).digest('hex');
const record = (t) => JSON.parse(read(t, '.claude/harness-install.json')).files;
const addRecord = (t, rel, body) => put(t, '.claude/harness-install.json', JSON.stringify({ files: { ...record(t), [rel]: hash(body) } }));

// Ruling 4: a retired path the template no longer ships, so this holds before and after the template drops the team skills.
test('retired file with the recorded hash is deleted and leaves the record', () => {
  const t = target('retire unchanged');
  install(t);
  const rel = '.claude/agents/code-reviewer.md', skill = '.claude/skills/team-lead/SKILL.md';
  put(t, rel, '# 0.5.1 code-reviewer\n');
  addRecord(t, rel, '# 0.5.1 code-reviewer\n');
  put(t, skill, '# 0.5.1 team-lead\n');
  addRecord(t, skill, '# 0.5.1 team-lead\n');
  const r = install(t);
  assert.equal(existsSync(join(t, rel)), false);
  assert.equal(rel in record(t), false);
  assert.deepEqual(r.retired, [skill, rel]);
  assert.equal(existsSync(join(t, '.claude/skills/team-lead')), false, 'empty folder of a retired skill is removed');
  assert.equal(existsSync(join(t, '.claude/agents')), true, 'a non-empty parent stays');
  assert.deepEqual(r.conflicts, []);
});

test('(Review Focus 4) a retired file the project edited stays until approved', () => {
  const t = target('retire edited');
  put(t, '.claude/coordinator.keep.json', '{ "permissionMode": "default", "plugins": {}, "skills": {} }\n');
  put(t, 'answers.json', JSON.stringify(ANSWERS));
  const cli = (...more) => spawnSync(process.execPath, [SETUP, 'install', '--target', t, '--answers', join(t, 'answers.json'), ...more], { encoding: 'utf8' });
  assert.equal(cli().status, 0);
  const planner = '.claude/agents/planner.md', qa = '.claude/agents/qa-inspector.md';
  addRecord(t, planner, '# 0.5.1 planner\n');
  put(t, planner, '# 0.5.1 planner\n프로젝트가 고친 줄\n');
  put(t, qa, '# 기록에 없는 qa-inspector\n');
  const held = cli();
  assert.equal(held.status, 2, held.stderr);
  assert.deepEqual(JSON.parse(held.stdout).conflicts.sort(), [planner, qa]);
  assert.deepEqual(JSON.parse(held.stdout).retired, []);
  assert.equal(read(t, planner), '# 0.5.1 planner\n프로젝트가 고친 줄\n');
  assert.equal(read(t, qa), '# 기록에 없는 qa-inspector\n');
  const approved = cli('--approve', planner);
  assert.equal(approved.status, 2, approved.stderr);
  assert.deepEqual(JSON.parse(approved.stdout).conflicts, [qa]);
  assert.equal(existsSync(join(t, planner)), false);
  assert.equal(planner in record(t), false);
  assert.equal(read(t, qa), '# 기록에 없는 qa-inspector\n');
  const both = cli('--approve', qa);
  assert.equal(both.status, 0, both.stderr);
  assert.equal(existsSync(join(t, qa)), false);
});

test('pm.model and pm.effort land in the PM 기획 row', () => {
  const t = target('pm row');
  install(t, { pm: { model: 'opus', effort: 'high' } });
  assert.ok(read(t, tablePath).split('\n').some((l) => l.startsWith('| `product-manager` | 기획 | claude | opus | high |')));
});

test('an edited model table without the answered PM row is named in notices', () => {
  const t = target('pm notice');
  assert.deepEqual(install(t).notices, []);
  const mine = '| `my-agent` | 내 작업 | claude | sonnet | low | 고정 |\n';
  put(t, tablePath, read(t, tablePath).replace(/^\| `product-manager` \| 기획 \|.*\r?\n/m, '') + mine);
  const r = install(t, { pm: { model: 'opus', effort: 'max' } });
  assert.ok(r.skipped.some((s) => s.to === tablePath && s.reason === '사용자가 고침'));
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /product-manager \| 기획/);
  assert.match(r.notices[0], /opus\/max/);
  // the row is there with other values: still named
  const other = target('pm notice values');
  install(other);
  put(other, tablePath, read(other, tablePath) + mine);
  assert.equal(install(other, { pm: { model: 'opus', effort: 'max' } }).notices.length, 1);
  // an edited table that carries the answered row: no notice
  assert.deepEqual(install(other).notices, []);
});

// a file the project edited after an older install (the record holds what the older kit wrote)
const editedOlder = (name) => {
  const t = target(name);
  install(t);
  addRecord(t, 'AGENTS.md', '# 0.5.1 지침\n');
  put(t, 'AGENTS.md', '# 0.5.1 지침\n프로젝트가 고친 줄\n');
  return t;
};

test('an edited file whose kit content changed is listed in edited and left untouched', () => {
  const t = editedOlder('edited listed');
  const r = install(t);
  assert.equal(read(t, 'AGENTS.md'), '# 0.5.1 지침\n프로젝트가 고친 줄\n');
  assert.deepEqual(r.edited, ['AGENTS.md']);
  assert.ok(r.skipped.some((s) => s.to === 'AGENTS.md' && s.reason === '사용자가 고침'));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.written, []);
});

test('an approved edited file is overwritten with the kit content', () => {
  const t = editedOlder('edited approved');
  const r = install(t, {}, {}, ['AGENTS.md']);
  assert.equal(read(t, 'AGENTS.md'), '# 공통 지침\n');
  assert.deepEqual(r.written, ['AGENTS.md']);
  assert.deepEqual(r.edited, []);
  assert.equal(r.skipped.some((s) => s.to === 'AGENTS.md'), false);
  assert.equal(record(t)['AGENTS.md'], hash('# 공통 지침\n'));
  assert.ok(install(t).skipped.some((s) => s.to === 'AGENTS.md' && s.reason === '같은 내용'));
});

test('an approved edited model table takes the answered PM row and gives no notice', () => {
  const t = target('edited table approved');
  install(t);
  put(t, tablePath, read(t, tablePath) + '| `my-agent` | 내 작업 | claude | sonnet | low | 고정 |\n');
  const pm = { model: 'opus', effort: 'max' };
  const held = install(t, { pm });
  assert.deepEqual([held.edited, held.notices.length], [[tablePath], 1]);
  const r = install(t, { pm }, {}, [tablePath]);
  assert.deepEqual([r.written, r.edited, r.notices], [[tablePath], [], []]);
  assert.ok(read(t, tablePath).split('\n').some((l) => l.startsWith('| `product-manager` | 기획 | claude | opus | max |')));
});

test('an edited file whose kit content is unchanged is not listed', () => {
  const t = target('edited same kit');
  install(t);
  put(t, 'AGENTS.md', '# 공통 지침\n프로젝트가 고친 줄\n');
  const r = install(t);
  assert.deepEqual(r.edited, []);
  assert.ok(r.skipped.some((s) => s.to === 'AGENTS.md' && s.reason === '사용자가 고침'));
  assert.equal(read(t, 'AGENTS.md'), '# 공통 지침\n프로젝트가 고친 줄\n');
});

test('answers with planner.effort are refused', () => {
  put(root, 'old-answers.json', JSON.stringify({ ...ANSWERS, planner: { effort: 'max' } }));
  const r = spawnSync(process.execPath, [SETUP, 'install', '--target', target('old answers'), '--answers', join(root, 'old-answers.json')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /planner\.effort는 pm\.model과 pm\.effort로 바뀌었다/);
});

test('a default agent the project removed is not installed again', () => {
  const t = target('removed agent');
  install(t);
  const rel = '.claude/agents/backend.md';
  unlinkSync(join(t, rel));
  const r = install(t);
  assert.equal(existsSync(join(t, rel)), false);
  assert.ok(r.skipped.some((s) => s.to === rel && s.reason === '사용자가 지움'));
  assert.ok(rel in record(t));
  assert.deepEqual(r.written, []);
  // the boundary from the other side: a recorded file that is not an agent is refilled
  const other = '.claude/hooks/approval-gate.config.json';
  unlinkSync(join(t, other));
  assert.deepEqual(install(t).written, [other]);
  assert.equal(existsSync(join(t, rel)), false);
  // a toggled-off agent is not a removed one
  const off = target('toggled agent');
  install(off);
  renameSync(join(off, rel), join(off, rel + '.agent-toggle-off'));
  const offRun = install(off);
  assert.ok(offRun.skipped.some((s) => s.to === rel && s.reason === '에이전트 OFF'));
  assert.ok(!offRun.skipped.some((s) => s.reason === '사용자가 지움'));
  // through the CLI with Codex: the role sync skips the removed agent instead of failing on it
  const c = target('removed agent codex');
  put(c, '.claude/coordinator.keep.json', '{ "permissionMode": "default", "plugins": {}, "skills": {} }\n');
  put(c, 'answers.json', JSON.stringify({ ...ANSWERS, codex: true }));
  const cli = () => spawnSync(process.execPath, [SETUP, 'install', '--target', c, '--answers', join(c, 'answers.json')], { encoding: 'utf8' });
  assert.equal(cli().status, 0);
  unlinkSync(join(c, rel));
  const again = cli();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(existsSync(join(c, rel)), false);
});

test('inspect reports a pending migration and unfilled skills', () => {
  const deps = { run: () => { throw new Error('no'); }, exists: existsSync, globalSkillsDir: join(root, 'no-global') };
  const t = target('migration');
  put(t, 'docs/harness/team-org.md', '# 옛 명단\n| harness | harness-engineer | 단독 |\n');
  put(t, '.claude/agents/prd-writer.md', '# 옛 역할\n');
  put(t, '.claude/agents/api-editor.md.agent-toggle-off', '# 꺼진 옛 역할\n');
  put(t, '.claude/agents/backend.md', '# 틀의 역할\n');
  put(t, '.claude/agents/planner.md', '# 물러난 역할\n');
  put(t, '.claude/skills/frontend-ux/SKILL.md', '# frontend-ux\n\n> 이 스킬은 틀이다. `agent-author`가 프로젝트에 맞게 채운다.\n');
  put(t, '.claude/skills/backend-db/SKILL.md', '# backend-db\n\n채운 스킬\n');
  const r = inspect(t, deps);
  assert.equal(r.migration.roster, 'docs/harness/team-org.md');
  assert.deepEqual(r.migration.projectRoles, ['api-editor', 'prd-writer']);
  assert.deepEqual(r.unfilledSkills, ['frontend-ux']);
  // both rosters: the migration stays pending until its last step deletes team-org.md
  put(t, 'docs/harness/agents.md', '# 명단\n');
  assert.equal(inspect(t, deps).migration.roster, 'docs/harness/team-org.md');
  unlinkSync(join(t, 'docs/harness/team-org.md'));
  assert.equal(inspect(t, deps).migration, null);
  assert.equal(inspect(target('migration none'), deps).migration, null);
});

test('verify runs the role checker for every agent on the installed roster', () => {
  const real = (dir) => fileURLToPath(new URL(`../../../${dir}`, import.meta.url));
  const t = target('verify roster');
  applyInstall(planInstall(real('template'), real('template-codex'), t, ANSWERS, INS));
  const verify = () => spawnSync(process.execPath, [SETUP, 'verify', '--target', t], { encoding: 'utf8' });
  const agentLine = (out, name) => out.split('\n').find((l) => l.includes('agent-definition.mjs --agent ' + name + '`')) ?? '';
  const agents = ['product-manager', 'research', 'frontend', 'backend', 'verifier', 'doc-steward', 'harness-engineer'];
  const ok = verify();
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(ok.stdout.split('\n').filter((l) => l.includes('agent-definition.mjs --agent')).length, 7);
  for (const name of agents) assert.match(agentLine(ok.stdout, name), /✅ agent-definition: OK/);
  put(t, tablePath, read(t, tablePath).replace(/^\| `research` \|.*\r?\n/m, ''));
  const bad = verify();
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(agentLine(bad.stdout, 'research'), /❌ .*research의 작업 단위/);
  assert.match(agentLine(bad.stdout, 'frontend'), /✅/);
});

// Request routing: the template ships the ask rule, an older install gets only its routing lines rewritten,
// and a routing the project rewrote is shown as proposals and changed only by the ids the user picks.
const lf = (s) => s.replaceAll('\r\n', '\n');
const crlf = (s) => lf(s).replaceAll('\n', '\r\n');
const ROUTE_FILES = Object.keys(ROUTING).sort();
const AGENTS = 'AGENTS.md';
const OLD_ROW = ROUTING[AGENTS][1].old[0];
const block = (lines) => lines.map((l) => l + '\n').join('');
const shipped = Object.fromEntries(ROUTE_FILES.map((rel) => [rel, lf(read(realTemplate, rel))]));
// the shape an older kit shipped: each new hunk swapped back to its old lines
const toOld = (rel) => ROUTING[rel].reduce((s, h) => s.replace(block(h.new), block(h.old)), shipped[rel]);
const PROJECT_HEAD = '# 우리 프로젝트\n\n프로젝트 전용 앞 절.\n\n';
const PROJECT_TAIL = '\n## 프로젝트 끝 절\n\n끝 절 본문.\n';
const withProject = (body) => PROJECT_HEAD + body + PROJECT_TAIL;
const rtpl = join(root, 'routing-template');
for (const rel of ROUTE_FILES) put(rtpl, rel, shipped[rel]);
const routeInstall = (t, choices = {}, approve = []) => applyInstall(planInstall(rtpl, codex, t, ANSWERS, INS, choices), { approve });
const routeFiles = (t) => Object.fromEntries(ROUTE_FILES.map((rel) => [rel, readFileSync(join(t, rel))]));

test('routing (a): the template ships the per-request ask rule and a fresh install gets it', () => {
  for (const rel of ROUTE_FILES) {
    const lines = shipped[rel].split('\n');
    for (const h of ROUTING[rel]) {
      assert.equal(lines.filter((_, i) => h.new.every((b, k) => lines[i + k] === b)).length, 1, `${rel}: new hunk once`);
      if (h.old.length === 1) assert.ok(!lines.includes(h.old[0]), `${rel}: no old line`);
    }
    assert.notEqual(toOld(rel), shipped[rel], `${rel}: the old shape differs`);
    assert.deepEqual(migrateRouting(rel, shipped[rel], ROUTING[rel]), { text: shipped[rel], applied: [], proposals: [] });
  }
  const t = target('routing fresh');
  const r = routeInstall(t);
  assert.deepEqual([r.routed, r.routing, r.conflicts], [[], [], []]);
  for (const rel of ROUTE_FILES) assert.ok(r.written.includes(rel) && read(t, rel) === shipped[rel], rel);
  const agents = read(t, AGENTS);
  assert.match(agents, /“plan-orchestrate 없이 제가 수행할까요\?”/);
  assert.match(agents, /명시적으로 동의하면 해당 요청만 직접 수행/);
  assert.match(agents, /직접 수행을 거절하면 plan-orchestrate로 접수하고, 답변 전에는 기다린다/);
  assert.match(agents, /간단한 수행 요청 외에는 모두 작업 착수 전에 `plan-orchestrate`로 접수/);
  for (const rel of ROUTE_FILES) assert.doesNotMatch(read(t, rel), /창구가 직접 (?:한다|처리한다)/, rel);
});

for (const [eolName, eol] of [['LF', lf], ['CRLF', crlf]]) {
  for (const recorded of [true, false]) {
    test(`routing (b)(c)(f): ${eolName}, install record ${recorded ? 'present' : 'absent'} — only the routing lines change, once`, () => {
      const t = target(`routing partial ${eolName} ${recorded}`);
      install(t); // an install record for an older kit
      const oldKit = {};
      for (const rel of ROUTE_FILES) {
        oldKit[rel] = eol(toOld(rel));
        put(t, rel, eol(withProject(toOld(rel))));
      }
      const files = record(t);
      for (const rel of ROUTE_FILES) if (recorded) files[rel] = hash(oldKit[rel]); else delete files[rel];
      put(t, '.claude/harness-install.json', JSON.stringify({ files }));
      const r = routeInstall(t);
      assert.deepEqual([...r.routed].sort(), ROUTE_FILES);
      assert.deepEqual([r.routing, r.stale], [[], []]);
      for (const rel of ROUTE_FILES) {
        assert.equal(read(t, rel), eol(withProject(shipped[rel])), `${rel}: routing lines only, rest byte for byte`);
        assert.ok(!r.written.includes(rel), rel);
      }
      // (f) the record still says what setup wrote, so the project's file stays a project edit
      const after = record(t);
      for (const rel of ROUTE_FILES) assert.equal(after[rel], recorded ? hash(oldKit[rel]) : undefined, rel);
      const expectHeld = (res) => {
        for (const rel of ROUTE_FILES) {
          if (recorded) assert.ok(res.skipped.some((s) => s.to === rel && s.reason === '사용자가 고침'), rel);
          else assert.ok(res.conflicts.includes(rel), rel);
          assert.ok(!res.skipped.some((s) => s.to === rel && s.reason === '같은 내용'), rel);
        }
      };
      expectHeld(r);
      // (c) the second run writes nothing
      const bytes = routeFiles(t), rec = read(t, '.claude/harness-install.json');
      const again = routeInstall(t);
      assert.deepEqual([again.routed, again.routing, again.written], [[], [], []]);
      for (const rel of ROUTE_FILES) assert.ok(readFileSync(join(t, rel)).equals(bytes[rel]), rel);
      assert.equal(read(t, '.claude/harness-install.json'), rec);
      expectHeld(again);
    });
  }
}

test('routing (f): an unedited older-kit file becomes the template and is recorded as it', () => {
  const t = target('routing pristine');
  install(t);
  for (const rel of ROUTE_FILES) { put(t, rel, toOld(rel)); addRecord(t, rel, toOld(rel)); }
  const r = routeInstall(t);
  assert.deepEqual([[...r.routed].sort(), r.conflicts], [ROUTE_FILES, []]);
  for (const rel of ROUTE_FILES) assert.equal(record(t)[rel], hash(shipped[rel]), rel);
  for (const rel of ROUTE_FILES) assert.ok(routeInstall(t).skipped.some((s) => s.to === rel && s.reason === '같은 내용'), rel);
});

// the project's AGENTS.md in the older shape, with one routing change of its own
const heldCase = (name, edit) => {
  const t = target(`routing held ${name}`);
  const body = edit(withProject(toOld(AGENTS)));
  put(t, AGENTS, body);
  return { t, body };
};
const HELD = {
  modified: (s) => s.replace(OLD_ROW, '| 단순 질문, 두 파일 이하의 수정 | 창구가 직접 한다. |'),
  conflict: (s) => s.replace(OLD_ROW, OLD_ROW + '\n| 문서 오타 | 창구가 바로 고친다. |'),
  duplicate: (s) => s.replace(OLD_ROW, OLD_ROW + '\n| 승인 대기 |  |\n' + OLD_ROW),
  ambiguous: (s) => s.replace(OLD_ROW, '| 단순 질문 | 창구가 직접 한다. |\n| 문서 수정 | 창구가 직접 한다. |'),
  missing: (s) => s.replace(OLD_ROW + '\n', ''),
};

test('routing (d): a rewritten, conflicting, duplicated or missing rule is reported, not written', () => {
  for (const [state, edit] of Object.entries(HELD)) {
    const { t, body } = heldCase(state, edit);
    const r = routeInstall(t);
    assert.equal(read(t, AGENTS), body, state);
    assert.ok(!r.routed.includes(AGENTS), state);
    const rows = r.routing.filter((p) => p.path === AGENTS);
    const heading = rows.find((p) => p.current[0] === '**규모별 경로.**');
    assert.equal(heading.state, 'old', state);
    assert.deepEqual(heading.proposed, ROUTING[AGENTS][0].new, state);
    const row = rows.filter((p) => p !== heading);
    assert.deepEqual([...new Set(row.map((p) => p.state))], [state], state);
    assert.equal(row.length, ['duplicate', 'ambiguous'].includes(state) ? 2 : 1, state);
    assert.equal(new Set(row.map((p) => p.id)).size, row.length, `${state}: one id per location`);
    for (const p of row) {
      assert.deepEqual(p.proposed, ROUTING[AGENTS][1].new, state);
      if (state === 'missing') { assert.deepEqual([p.id, p.line, p.current], [null, null, []]); continue; }
      assert.match(p.id, /^[0-9a-f]{12}$/);
      assert.equal(body.split('\n')[p.line - 1], p.current[0], state);
    }
    if (state === 'conflict') assert.deepEqual(row[0].conflicts.map((c) => c.text), ['| 문서 오타 | 창구가 바로 고친다. |']);
  }
});

test('routing (e): kept until chosen, a chosen id changes only its lines, an edit after display drops the id', () => {
  const { t, body } = heldCase('choice', HELD.modified);
  const shown = routeInstall(t).routing;
  const row = shown.find((p) => p.state === 'modified');
  const heading = shown.find((p) => p.state === 'old');
  // keep: running again without a choice leaves the file as it was and shows the same proposals
  const kept = routeInstall(t);
  assert.equal(read(t, AGENTS), body);
  assert.deepEqual(kept.routing, shown);
  // apply: only the displayed row changes; the heading the user did not pick stays, on this run and the next
  const picked = routeInstall(t, { routing: [row.id] });
  const expected = body.replace(row.current[0] + '\n', row.proposed.map((l) => l + '\n').join(''));
  assert.equal(read(t, AGENTS), expected);
  assert.deepEqual([picked.routed, picked.stale, picked.routing.map((p) => p.id)], [[AGENTS], [], [heading.id]]);
  assert.deepEqual(routeInstall(t).routed, []);
  assert.equal(read(t, AGENTS), expected);
  // an edit after display: the shown id no longer applies, the new difference is shown
  const { t: t2 } = heldCase('choice stale', HELD.modified);
  const id = routeInstall(t2).routing.find((p) => p.state === 'modified').id;
  const changed = read(t2, AGENTS).replace('두 파일 이하의 수정', '세 파일 이하의 수정');
  put(t2, AGENTS, changed);
  const late = routeInstall(t2, { routing: [id] });
  assert.equal(read(t2, AGENTS), changed);
  assert.deepEqual([late.routed, late.stale], [[], [id]]);
  const fresh = late.routing.find((p) => p.state === 'modified');
  assert.notEqual(fresh.id, id);
  assert.deepEqual(fresh.current, ['| 단순 질문, 세 파일 이하의 수정 | 창구가 직접 한다. |']);
});

test('routing (e)(g): through the CLI with the real template, other files keep their conflict and approval rules', () => {
  const t = target('routing cli');
  put(t, '.claude/coordinator.keep.json', '{ "permissionMode": "default", "plugins": {}, "skills": {} }\n');
  put(t, 'answers.json', JSON.stringify(ANSWERS));
  const cli = (...more) => {
    const r = spawnSync(process.execPath, [SETUP, 'install', '--target', t, '--answers', join(t, 'answers.json'), ...more], { encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout || '{}'), err: r.stderr };
  };
  const body = HELD.modified(withProject(toOld(AGENTS)));
  put(t, AGENTS, body);
  put(t, 'CLAUDE.md', '# 내 지침\n');
  const first = cli();
  assert.equal(first.code, 2, first.err);
  assert.deepEqual(first.out.conflicts.sort(), [AGENTS, 'CLAUDE.md']);
  assert.equal(read(t, AGENTS), body);
  assert.equal(read(t, 'CLAUDE.md'), '# 내 지침\n');
  const row = first.out.routing.find((p) => p.path === AGENTS && p.state === 'modified');
  // approving CLAUDE.md is not a routing choice: AGENTS.md stays as it was
  const approved = cli('--approve', 'CLAUDE.md');
  assert.deepEqual([approved.out.conflicts, approved.out.routed], [[AGENTS], []]);
  assert.equal(read(t, 'CLAUDE.md'), read(realTemplate, 'CLAUDE.md'));
  assert.equal(read(t, AGENTS), body);
  const chosen = cli('--routing', row.id);
  assert.deepEqual([chosen.out.routed, chosen.out.stale], [[AGENTS], []]);
  assert.equal(read(t, AGENTS), body.replace(row.current[0] + '\n', row.proposed.map((l) => l + '\n').join('')));
  // approving the whole AGENTS.md is the old full overwrite, never a partial one
  const whole = cli('--approve', AGENTS);
  assert.deepEqual([whole.out.routed, whole.out.written.includes(AGENTS), whole.code], [[], true, 0]);
  assert.equal(read(t, AGENTS), read(realTemplate, AGENTS));
});

const FD = '.claude/skills/coordinator/references/front-desk.md';
const OLD_FD_SMALL = '일반 소규모 수정은 원래 창구 경로를 따른다.';
const FD_BRIEF = '- 브리프에 승인된 BL과 동일한 버전의 배정·DAG·검토 기록을 전달한다. 일반 소규모 수정은 원래 창구 경로를 따른다. 승인된 계획의 Task는 코디네이터가 그 Task의 에이전트에게 직접 배정한다.';

test('routing V-1: the old "원래 창구 경로" sentence is updated in an older-kit front-desk.md, once', () => {
  assert.ok(!shipped[FD].includes(OLD_FD_SMALL), 'the template no longer ships the old sentence');
  const t = target('routing V-1');
  const old = withProject(toOld(FD));
  assert.ok(old.includes(FD_BRIEF) && old.includes(ROUTING[FD][0].old[0]), 'fixture is the older kit shape');
  put(t, FD, crlf(old));
  const r = routeInstall(t);
  assert.deepEqual([r.routed, r.routing.filter((p) => p.path === FD)], [[FD], []]);
  assert.equal(read(t, FD), crlf(withProject(shipped[FD])));
  const bytes = readFileSync(join(t, FD));
  const again = routeInstall(t);
  assert.deepEqual([again.routed, again.routing.filter((p) => p.path === FD)], [[], []]);
  assert.ok(readFileSync(join(t, FD)).equals(bytes));
});

// DRLOMILOMI's hand migration (2026-11-27): the ask rule is there in its own words, one sentence short of the template
const HAND_AGENTS = [
  '**규모별 경로.** 창구는 새 수행 요청마다 규모를 판단한다. 아래의 간단한 수행 요청 외에는 모두 작업 착수 전에 `plan-orchestrate`로 접수한다. 진행 중 요청의 범위가 달라지면 새 범위로 판단한다.',
  '',
  '| 요청 | 경로 |',
  '| --- | --- |',
  '| 단순 설명 질문 | 창구가 답한다. |',
  '| 간단한 수행 요청(예: BL 지정이 없는 한 파일의 작은 수정) | 매 요청마다 작업 전에 ask로 “plan-orchestrate 없이 제가 수행할까요?”라고 묻는다. 명시적으로 동의하면 해당 요청만 직접 수행하고 검증한다. 직접 수행을 거절하면 plan-orchestrate로 접수하고, 답변 전에는 기다린다. |',
  '| 지정 BL 또는 한 phase 위임 | 창구가 `plan-orchestrate`의 해당 접수 경로를 따른다. 지정 ID는 PM의 설계, 묶음 선정 위임은 PM의 묶음 선정부터 시작한다. |',
  '| 승인된 계획의 Task | 코디네이터가 그 Task의 에이전트에게 직접 배정한다. 에이전트가 OFF면 배정 대기다. |',
  '| 요구사항이 흐릿한 큰 작업 | 설문부터 시작하는 전체 흐름(`plan-orchestrate`)을 탄다. |',
].join('\n') + '\n';
const HAND_FD = [
  '- 새 요청은 `AGENTS.md` §규모별 경로를 따른다. 간단한 수행 요청은 ask에서 직접 수행에 동의한 경우에만 Run·phase 폴더 없이 진행한다. 테스트 먼저 쓰기와 검증 명령은 그대로 지킨다.',
  '- 새 요구는 PM 항목화부터 시작하고 같은 PM 세션이 검토한다. 지정 BL은 PM의 설계부터, 한 phase 위임은 PM 묶음 선정부터 시작한다. 지정 ID는 ‘답이 정해진 작업’보다 우선한다. 설계·계획 승인 횟수와 단독 PRD·계획 검토는 `plan-orchestrate`의 접수 표를 따른다.',
  FD_BRIEF,
].join('\n') + '\n';

test('routing V-2: a hand migration in other words gets no proposal and no write; a real gap is still missing', () => {
  const t = target('routing V-2');
  const files = { [AGENTS]: withProject(HAND_AGENTS), [FD]: crlf(withProject(HAND_FD)) };
  for (const [rel, body] of Object.entries(files)) {
    assert.ok(!body.includes(ROUTING[AGENTS][1].new[1]), `${rel}: not the template wording`);
    assert.deepEqual(migrateRouting(rel, body, ROUTING[rel]), { text: body, applied: [], proposals: [] }, rel);
    put(t, rel, body);
  }
  for (let run = 0; run < 2; run++) {
    const r = routeInstall(t);
    assert.deepEqual([r.routed, r.routing.filter((p) => p.path in files)], [[], []], `run ${run}`);
    for (const [rel, body] of Object.entries(files)) assert.equal(read(t, rel), body, `${rel} run ${run}`);
  }
  // no ask rule and no direct-handling rule: nothing to call migrated, so the gap is reported
  const ASK_ROW = HAND_AGENTS.split('\n')[5];
  const gap = withProject(HAND_AGENTS.replace(ASK_ROW + '\n', ''));
  const p = migrateRouting(AGENTS, gap, ROUTING[AGENTS]);
  assert.equal(p.text, gap);
  assert.deepEqual(p.proposals.map((x) => [x.state, x.id]), [['missing', null]]);
  const fdGap = withProject(HAND_FD.replace(HAND_FD.split('\n')[0] + '\n', ''));
  assert.deepEqual(migrateRouting(FD, fdGap, ROUTING[FD]).proposals.map((x) => x.state), ['missing', 'old']);
  // the ask rule beside a rule that still lets the front desk act alone is not a migration
  const mixed = withProject(HAND_AGENTS.replace(ASK_ROW, ASK_ROW + '\n| 문서 오타 | 창구가 바로 고친다. |'));
  assert.deepEqual(migrateRouting(AGENTS, mixed, ROUTING[AGENTS]).proposals.map((x) => x.state), ['modified']);
});

console.log(`setup.check: ${n} passed`);
