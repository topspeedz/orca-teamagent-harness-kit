// Read the installed project's backlog and roster from its root.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

function intake(args) {
  const { values } = parseArgs({ args, options: {
    ids: { type: 'string' }, delegated: { type: 'boolean' },
  } });
  if (values.ids === undefined) {
    if (values.delegated) return { route: 'delegated', first: 'product-manager', reviewer: 'product-manager', approvals: ['계획·실행'] };
    return { route: 'new', first: 'product-manager', reviewer: 'planner', approvals: ['묶음', '설계', '계획·실행'] };
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
  return { route: 'specified', ids, first: 'planner', reviewer: 'product-manager', approvals: ['설계', '계획·실행'] };
}

function teamRoute(args) {
  const { values } = parseArgs({ args, options: {
    team: { type: 'string' }, count: { type: 'string' }, complex: { type: 'boolean' },
  } });
  const count = Number(values.count);
  if (!values.team || !Number.isSafeInteger(count) || count < 1)
    throw new Error('사용법: phase-routing.mjs team --team <팀> --count <양의 정수> [--complex]');
  const rows = readFileSync('docs/harness/team-org.md', 'utf8').split(/\r?\n/)
    .filter(line => line.trim().startsWith('|'))
    .map(line => line.trim().split('|').slice(1, -1).map(cell => cell.replaceAll('`', '').trim()));
  const header = rows.find(row => row.includes('팀장이 되는 에이전트') && row.includes('팀'));
  const team = header && rows.find(row => row[header.indexOf('팀')] === values.team);
  if (!team) throw new Error('팀 명단에서 실행 팀을 찾을 수 없음: ' + values.team);
  const lead = team[header.indexOf('팀장이 되는 에이전트')];
  const group = team[header.indexOf('구분')];
  if ((group && group !== '실행팀') || !/^[a-z0-9][a-z0-9_-]*$/i.test(lead))
    throw new Error('명시된 팀장이 있는 실행 팀만 배정할 수 있음: ' + values.team);
  const file = join('.claude/agents', lead + '.md');
  const active = existsSync(file) && !existsSync(file + '.agent-toggle-off');
  let route = 'wait';
  if (active) route = count === 1 && !values.complex ? 'direct' : 'lead';
  return { team: values.team, lead, route };
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['intake', 'team'].includes(command)) throw new Error('사용법: phase-routing.mjs intake 또는 team');
  console.log(JSON.stringify(command === 'intake' ? intake(args) : teamRoute(args)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
