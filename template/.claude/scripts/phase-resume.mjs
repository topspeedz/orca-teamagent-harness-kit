import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './report-check.mjs';

const stages = {
  '01_prd-writer_requirements': 'requirements', '01_product-manager_requirements': 'requirements',
  '02_product-manager_backlog': 'backlog',
  '03_pm-reviewer_review': 'review', '03_planner_review': 'review',
  '06_pm-reviewer_plan-check': 'planCheck', '06_product-manager_plan-check': 'planCheck',
};
const planner = { '03_planner_design': 'design', '04_planner_plan': 'plan', '03_product-manager_design': 'design', '04_product-manager_plan': 'plan' };

function optional(path, read) {
  try { return read(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const read = path => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
function fingerprint(path) {
  const source = optional(path, read);
  return source === null ? null : { path, sha256: createHash('sha256').update(source).digest('hex') };
}

try {
  const [phase, ...extra] = process.argv.slice(2);
  if (!phase || extra.length || /[\\/:]/.test(phase) || ['.', '..'].includes(phase))
    throw new Error('사용법: 프로젝트 루트에서 phase-resume.mjs <phase 이름>');
  const run = join('_workspace/_run', phase);
  const brief = read(join(run, 'brief.md'));
  const reports = Object.fromEntries([...Object.values(stages), ...Object.values(planner)].map(key => [key, []]));
  for (const [folder, names] of [[join('_workspace/product', phase), stages], [run, planner]]) {
    for (const name of optional(folder, readdirSync) ?? []) {
      const match = /^(.+)_v(\d+)\.md$/.exec(name);
      if (!match || !Object.hasOwn(names, match[1])) continue;
      const path = join(folder, name);
      const text = read(path);
      reports[names[match[1]]].push({ path, revision: Number(match[2]), verification: check(text), text });
    }
  }
  for (const group of Object.values(reports)) group.sort((a, b) => a.revision - b.revision || a.path.localeCompare(b.path));
  const map = optional(join(run, 'orca-tasks.json'), path => JSON.parse(read(path)));
  const ledger = optional(join(run, 'ledger.md'), read);
  const plan = fingerprint(join('docs/superpowers/plans', phase + '.md'));
  const dag = fingerprint(join(run, 'dag.json'));
  console.log(JSON.stringify({ brief, reports, plan, dag, map, ledger }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
