// Self-test for setup.mjs — builds a small template in a temp folder. `node skills/setup/scripts/setup.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyInstall, inspect, mergeGitignore, planInstall } from './setup.mjs';
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
      assert.ok(pending.includes('| `' + path + '` | 전체 | 미배정 |'));
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
  const rel = '.claude/agents/code-reviewer.md';
  put(t, rel, '# 0.5.1 code-reviewer\n');
  addRecord(t, rel, '# 0.5.1 code-reviewer\n');
  const r = install(t);
  assert.equal(existsSync(join(t, rel)), false);
  assert.equal(rel in record(t), false);
  assert.deepEqual(r.retired, [rel]);
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
  put(t, 'docs/harness/agents.md', '# 명단\n');
  assert.equal(inspect(t, deps).migration, null);
  assert.equal(inspect(target('migration none'), deps).migration, null);
});

console.log(`setup.check: ${n} passed`);
