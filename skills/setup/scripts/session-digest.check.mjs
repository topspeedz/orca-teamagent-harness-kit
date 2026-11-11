// Self-test for session-digest.mjs — builds fake records in a temp folder. `node skills/setup/scripts/session-digest.check.mjs`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, pipelineFiles, recordRoots, slugOf } from './session-digest.mjs';

const SCRIPT = fileURLToPath(new URL('./session-digest.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'session-digest-check-'));
const put = (rel, body) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, 'utf8');
  return p;
};
const at = (min) => new Date(Date.UTC(2026, 10, 1, 9, min)).toISOString();
const user = (min, content, extra = {}) => JSON.stringify({ type: 'user', timestamp: at(min), message: { role: 'user', content }, ...extra });
const tool = (min, name, input) => JSON.stringify({ type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${min}`, name, input }] } });

const home = join(root, 'home');
const cfg = join(root, 'cfg');
mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
mkdirSync(join(cfg, 'projects'), { recursive: true });

const file = put('home/.claude/projects/D--proj/s1.jsonl', [
  user(1, '배포 키는 ghp_abcdefgh12345678 이야'),
  user(2, [{ type: 'text', text: '로그인 화면 만들어줘' }]),
  user(3, '<system-reminder>알림</system-reminder>'),
  user(4, [{ type: 'tool_result', tool_use_id: 't5', content: '결과' }]),
  user(5, '서브에이전트에게 준 일', { isSidechain: true }),
  user(6, 'You are a dispatched worker. Task: x'),
  '{깨진 줄',
  tool(7, 'Bash', { command: 'cd /d/proj && npm test' }),
  tool(8, 'Bash', { command: 'CI=1 npm run build' }),
  tool(9, 'PowerShell', { command: 'git status' }),
  tool(10, 'Skill', { skill: 'superpowers:brainstorming' }),
  user(11, '로그인 화면 만들어줘'),
].join('\n') + '\n');
// subagent records: real ones carry bookkeeping lines without isSidechain
const subFile = put('home/.claude/projects/D--proj/s1/subagents/agent-a.jsonl', [
  JSON.stringify({ type: 'api-request', timestamp: at(12) }),
  user(12, '서브에이전트 지시', { isSidechain: true }),
].join('\n') + '\n');
const HEX = 'abcdef0123456789abcdef0123456789';
const longFile = put('long.jsonl', user(1, `${HEX} ${'가'.repeat(400)}`) + '\n');
const oddFile = put('odd.jsonl', ['null', '42', '"x"', JSON.stringify({ type: 'user', timestamp: 5, message: { content: '숫자 시각' } })].join('\n') + '\n');

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

test('slug', () => {
  assert.equal(slugOf('D:\\Projects\\my app'), 'D--Projects-my-app');
  assert.equal(slugOf('D:/Projects/my app'), 'D--Projects-my-app');
});

test('roots: existing folders only, each once', () => {
  assert.deepEqual(recordRoots({ home, env: { CLAUDE_CONFIG_DIR: cfg }, platform: 'linux' }), [join(home, '.claude', 'projects'), join(cfg, 'projects')]);
  assert.deepEqual(recordRoots({ home, env: { CLAUDE_CONFIG_DIR: join(home, '.claude') }, platform: 'linux' }), [join(home, '.claude', 'projects')]);
  // an Orca profile's projects folder can be a link to the same folder
  const linked = join(home, '.config', 'orca', 'claude-profiles', 'p1', 'home');
  mkdirSync(linked, { recursive: true });
  symlinkSync(join(home, '.claude', 'projects'), join(linked, 'projects'), 'junction');
  assert.deepEqual(recordRoots({ home, env: {}, platform: 'linux' }), [join(home, '.claude', 'projects')]);
});

const d = digest([file], { since: 0 });
test('human prompts only, newest first, once each; broken lines skipped; limit keeps newest', () => {
  assert.deepEqual(d.prompts.map((p) => p.text), ['로그인 화면 만들어줘', '배포 키는 [가림] 이야']);
  assert.deepEqual(d.prompts[0], { date: '2026-11-01', session: 's1.jsonl', text: '로그인 화면 만들어줘' });
  assert.equal(d.promptsTotal, 2);
  assert.equal(d.skipped, 1);
  const lim = digest([file], { since: 0, limit: 1 });
  assert.deepEqual(lim.prompts.map((p) => p.text), ['로그인 화면 만들어줘']);
  assert.equal(lim.promptsTotal, 2);
  assert.equal(digest([file, subFile], { since: 0 }).sessions, 1);
  // valid JSON that is not an object is skipped; a non-string timestamp counts as none
  const odd = digest([oddFile], { since: 0 });
  assert.equal(odd.skipped, 3);
  assert.deepEqual(odd.prompts, [{ date: '', session: 'odd.jsonl', text: '숫자 시각' }]);
});

test('300 character cut', () => {
  const cut = digest([longFile], { since: 0 }).prompts[0].text;
  assert.equal(cut.length, 300);
  assert.ok(!cut.includes(HEX));
});

test('command and skill counts', () => {
  assert.deepEqual(d.commands[0], { bin: 'npm', count: 2 });
  assert.deepEqual(d.commands, [{ bin: 'npm', count: 2 }, { bin: 'git', count: 1 }]);
  assert.deepEqual(d.skills, [{ name: 'superpowers:brainstorming', count: 1 }]);
  assert.equal(digest([file], { since: Date.parse(at(9)) }).commands.length, 1);
});

test('no records still exits 0', () => {
  const emptyHome = join(root, 'empty-home');
  const emptyProject = join(root, 'empty-project');
  mkdirSync(emptyHome, { recursive: true });
  mkdirSync(emptyProject, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--target', emptyProject], { env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, APPDATA: emptyHome, CLAUDE_CONFIG_DIR: '' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).prompts, []);
});

test('pipelines: existing ones only', () => {
  const proj = join(root, 'proj');
  put('proj/.github/workflows/ci.yml', 'on: push\n');
  put('proj/package.json', '{}\n');
  assert.deepEqual(pipelineFiles(proj), ['.github/workflows/ci.yml', 'package.json']);
  // _workspace/_run lists folders only
  const runProj = join(root, 'run-proj');
  mkdirSync(join(runProj, '_workspace', '_run', 'phase-1'), { recursive: true });
  put('run-proj/_workspace/_run/notes.md', 'x\n');
  assert.deepEqual(pipelineFiles(runProj), ['_workspace/_run/phase-1']);
});

console.log(`session-digest.check: ${n} cases passed`);
