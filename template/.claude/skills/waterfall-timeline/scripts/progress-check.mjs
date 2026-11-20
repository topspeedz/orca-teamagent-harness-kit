import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderProgress } from './progress.mjs';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const progress = JSON.parse(fs.readFileSync(path.join(examples, 'progress.json'), 'utf8'));
assert.throws(() => renderProgress({ ...progress, now: '11:40' }), /now must be ISO with offset/);

// Orca profiles reach these entry points through a directory junction.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waterfall-'));
const link = path.join(tmp, 'scripts');
fs.symlinkSync(fileURLToPath(new URL('.', import.meta.url)), link, 'junction');
try {
  const run = (script, ...args) => execFileSync(process.execPath, [path.join(link, script), ...args], { cwd: tmp, stdio: 'pipe' });
  run('render.mjs', path.join(examples, 'estimate.json'), 'estimate.html');
  assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'estimate.html'), 'utf8'), /class="now"/);
  fs.writeFileSync(path.join(tmp, 'tasks.json'), '[]');
  run('from-orca.mjs', '--tasks', 'tasks.json', '--plan', path.join(examples, 'example.json'),
    '--now', progress.now, '--out', 'forecast.json');
  const plan = JSON.parse(fs.readFileSync(path.join(examples, 'example.json'), 'utf8'));
  const work = plan.tasks.find(t => t.kind === 'work');
  plan.tasks = ['T01', 'T02', 'T03'].map(id => ({ ...work, id, bl: 'BL-0001', deps: [] }));
  const put = (name, data) => fs.writeFileSync(path.join(tmp, name), JSON.stringify(data));
  put('plan.json', plan);
  put('orca-tasks.json', { run: 'run_a', tasks: {
    T01: { orca: 'task_b', previous: [{ orca: 'task_old' }] }, T02: { orca: 'task_a' }, T03: { orca: 'task_c' },
  } });
  const task = { spec: '[역할: qa-inspector] BL-0001', run_id: 'run_a', created_at: '2026-10-31 00:00:00' };
  put('capture.json', { result: { tasks: [
    { ...task, id: 'task_a', status: 'dispatched', created_at: '2026-10-31 00:25:00' },
    { ...task, id: 'task_b', status: 'completed', started_at: '2026-10-31 00:10:00', completed_at: '2026-10-31T00:20:00Z' },
    { ...task, id: 'task_c', status: 'ready' },
    { ...task, id: 'task_old', status: 'failed', completed_at: '2026-10-31T00:05:00Z' },
  ] } });
  fs.writeFileSync(path.join(tmp, 'ledger.md'), '| T01 | task_a |');
  const mapped = ['--map', 'orca-tasks.json', '--tasks', 'capture.json', '--plan', 'plan.json', '--ledger', 'ledger.md', '--now', progress.now, '--out', 'mapped.json'];
  run('from-orca.mjs', ...mapped);
  const result = JSON.parse(fs.readFileSync(path.join(tmp, 'mapped.json'), 'utf8'));
  assert.equal(result.run, 'run_a');
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(result.tasks.map(t => [t.title.split(' ')[0], t.status]), [['T01','done'],['T02','run'],['T03','wait']]);
  assert.equal(result.tasks[0].start, '2026-10-31T09:00+09:00');
  assert.equal(result.tasks[0].end, '2026-10-31T09:20+09:00');
  assert.equal(result.tasks[1].start, '2026-10-31T09:25+09:00');
  run('progress.mjs', 'mapped.json', 'progress.html');
  assert.throws(() => run('from-orca.mjs', ...mapped, '--run', 'run_other'), /Run/);
  run('merge.mjs', '--title', 'Runs', '--out', 'merged.json', 'K1=' + path.join(examples, 'progress.json'), 'K2=forecast.json');
  const merged = JSON.parse(fs.readFileSync(path.join(tmp, 'merged.json'), 'utf8'));
  assert.ok(merged.tasks.some(t => t.title.startsWith('K2 · ')));
  run('merge.mjs', '--title', 'Two Runs', '--out', 'two.json', 'K1=' + path.join(examples, 'progress.json'), 'K2=mapped.json');
  const two = JSON.parse(fs.readFileSync(path.join(tmp, 'two.json'), 'utf8'));
  assert.deepEqual(two.tasks, [
    ...progress.tasks.map(t => ({ ...t, title: 'K1 · ' + t.title })),
    ...result.tasks.map(t => ({ ...t, title: 'K2 · ' + t.title })),
  ]);
  assert.ok(renderProgress(two).includes('class="uw"'));
  run('progress.mjs', path.join(examples, 'progress.json'), 'progress.html');
  const html = fs.readFileSync(path.join(tmp, 'progress.html'), 'utf8');
  assert.match(html, /class="now"/);
  assert.ok(html.includes('지금 11:40'));
} finally {
  fs.unlinkSync(link);
  fs.rmSync(tmp, { recursive: true, force: true });
}
