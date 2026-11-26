// Read the installed project's backlog and roster from its root.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readRoster } from './roster.mjs';

function intake(args) {
  const { values } = parseArgs({ args, options: {
    ids: { type: 'string' }, delegated: { type: 'boolean' },
  } });
  if (values.ids === undefined) {
    if (values.delegated) return { route: 'delegated', first: 'product-manager', approvals: ['계획·실행'] };
    return { route: 'new', first: 'product-manager', approvals: ['묶음', '설계', '계획·실행'] };
  }
  const ids = [...new Set(values.ids.split(',').map(id => id.trim()))];
  if (!ids.every(id => /^BL-\d{4}$/.test(id))) throw new Error('지정 ID 형식: BL-####');
  const backlog = new Map();
  for (const file of ['docs/backlog.md', 'docs/backlog-archive.md']) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const row = /^\s*\|\s*(BL-\d{4})\s*\|[^|]*\|[^|]*\|\s*(todo|doing|blocked|done)\s*\|(.*)/.exec(line);
      if (row) backlog.set(row[1], { status: row[2], notes: row[3] });
    }
  }
  const issues = [];
  for (const id of ids) {
    const row = backlog.get(id);
    if (!row || row.status === 'done') {
      issues.push(id + (row ? ' 완료' : ' 없는 ID'));
      continue;
    }
    const deps = /(?:^|·)\s*선행\s+([^·|]+)/.exec(row.notes)?.[1];
    for (const dep of deps?.match(/BL-\d{4}/g) ?? []) {
      if (!ids.includes(dep) && backlog.get(dep)?.status !== 'done') issues.push(id + ' 범위 밖 선행 ' + dep);
    }
  }
  if (issues.length) throw new Error(issues.join('\n'));
  return { route: 'specified', ids, first: 'product-manager', approvals: ['설계', '계획·실행'] };
}

function agentRoute(args) {
  const { values } = parseArgs({ args, options: { agent: { type: 'string' } } });
  if (!values.agent) throw new Error('사용법: phase-routing.mjs agent --agent <이름>');
  if (!readRoster().some(row => row.agent === values.agent)) throw new Error('명단에서 에이전트를 찾을 수 없음: ' + values.agent);
  const file = join('.claude/agents', values.agent + '.md');
  const active = existsSync(file) && !existsSync(file + '.agent-toggle-off');
  return { agent: values.agent, route: active ? 'direct' : 'wait' };
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['intake', 'agent'].includes(command)) throw new Error('사용법: phase-routing.mjs intake 또는 agent');
  console.log(JSON.stringify(command === 'intake' ? intake(args) : agentRoute(args)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
