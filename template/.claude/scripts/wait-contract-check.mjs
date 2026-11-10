// Compares the wait-contract block in three skills against the canonical file.
// Usage: node .claude/scripts/wait-contract-check.mjs [--root <dir>] [--only <skill>]
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = '## 대기 계약 (생략·요약 금지)';
const SKILLS = ['coordinator', 'team-lead', 'plan-orchestrate'];

export function extractContract(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === HEADING);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  const body = lines.slice(start, end);
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}

const norm = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).join('\n');
export const sameContract = (canonical, other) => norm(canonical) === norm(other);

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const root = resolve(opt('--root') ?? '.');
  const only = opt('--only');
  const names = only ? [only] : SKILLS;
  const canonPath = join(root, 'docs/harness/templates/wait-contract.md');
  if (!existsSync(canonPath)) { console.log(`wait-contract: 정본 없음 ${canonPath}`); return 1; }
  const canon = extractContract(readFileSync(canonPath, 'utf8'));
  if (canon === null) { console.log('wait-contract: 정본에 대기 계약 없음'); return 1; }
  let same = 0;
  for (const name of names) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const p = join(root, rel);
    if (!existsSync(p)) { console.log(`${rel}: 파일 없음`); continue; }
    const got = extractContract(readFileSync(p, 'utf8'));
    if (got === null) { console.log(`${rel}: 대기 계약 없음`); continue; }
    if (sameContract(canon, got)) { same++; continue; }
    const c = norm(canon).split('\n'), g = norm(got).split('\n');
    const i = c.findIndex((l, k) => l !== g[k]);
    const k = i < 0 ? c.length : i;
    console.log(`${rel}: ${k + 1}번째 줄부터 다름\n  정본: ${c[k] ?? '(끝)'}\n  사본: ${g[k] ?? '(끝)'}`);
  }
  console.log(`wait-contract: ${same}/${names.length} same`);
  return same === names.length ? 0 : 1;
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main();
