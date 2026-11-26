// Read the flat agent roster of an installed project.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const header = '에이전트|맡는 단위|스킬|편집 범위';
const cells = (line) => line.trim().slice(1, -1).split('|').map(c => c.trim());
const unquote = (s) => s.replace(/^`|`$/g, '');

export function readRoster(root = '.') {
  const file = join(root, 'docs/harness/agents.md');
  const missing = '명단 표 필요: docs/harness/agents.md의 ' + header;
  if (!existsSync(file)) {
    if (existsSync(join(root, 'docs/harness/team-org.md'))) {
      throw new Error('docs/harness/agents.md가 없고 옛 명단(team-org.md)만 있습니다. setup을 다시 돌려 새 구조로 옮기세요.');
    }
    throw new Error(missing);
  }
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith('|') && cells(l).join('|') === header);
  if (start < 0) throw new Error(missing);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [agent = '', unit = '', skills = '', scope = ''] = cells(line);
    rows.push({ agent: unquote(agent), unit: unquote(unit), skills: [...skills.matchAll(/`([^`]+)`/g)].map(m => m[1]), scope });
  }
  return rows;
}
