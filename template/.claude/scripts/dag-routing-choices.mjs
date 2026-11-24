// Apply the choices from one approval drawing to a new DAG for PM review.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scoreRouting, validateRouting } from './model-routing.mjs';

export function applyChoices(dag, documents) {
  if (dag.routingVersion !== 2 || !Array.isArray(documents)) throw new Error('v2 DAG와 선택 문서 배열이 필요합니다');
  const drawing = createHash('sha256').update(JSON.stringify(dag)).digest('hex');
  const result = structuredClone(dag);
  const entries = new Map();
  for (const node of result.nodes) {
    entries.set(node.id, { row: node });
    for (const member of node.members ?? []) {
      const key = [node.id, member.role, member.unit].map(s => encodeURIComponent(s).replaceAll('~', '%7E')).join('~');
      entries.set(key, { row: member, parent: node.id });
    }
  }
  const codex = dag.choices?.codex ?? {};
  const applied = new Set();
  let skipped = 0;
  for (const { id, data } of documents) {
    if (data?.drawing !== drawing) { skipped++; continue; }
    const { row, parent } = entries.get(id) ?? {};
    if (!row?.routing || row.fixed || applied.has(id)) throw new Error('고정·중복 또는 대상이 없는 선택: ' + id);
    if (parent !== data.parentId || (parent && (row.role !== data.role || row.unit !== data.unit))) throw new Error('팀원 선택 ID 불일치: ' + id);
    if (!['manual', 'auto'].includes(data.mode) || typeof data.codex !== 'boolean') throw new Error('위임·런타임 선택 확인 필요: ' + id);
    const efforts = Object.hasOwn(dag.choices.claude, data.model) && dag.choices.claude[data.model];
    if (!efforts || !(efforts.length ? efforts.includes(data.effort) : data.effort === null)) throw new Error('선택할 수 없는 모델·effort: ' + id);
    const pair = data.effort ? data.model + '/' + data.effort : data.model;
    if (data.mode === 'auto' && pair !== row.routing.claude) throw new Error('자동 모드와 추천 불일치: ' + id);
    validateRouting(row.routing, row.agent, codex);
    const runtime = data.codex ? 'codex' : 'claude';
    const target = data.codex ? codex[pair] : pair;
    if (!target) throw new Error('Codex 치환값 없음: ' + pair);
    const [model, effort = null] = target.split('/');
    row.routing = { ...row.routing, ...scoreRouting(row.routing.scores, runtime, codex), mode: data.mode };
    Object.assign(row, { base: pair, agent: runtime, model, effort });
    // A new structured selection supersedes a previous free-text choice.
    delete row.overrideReason;
    applied.add(id);
  }
  if (skipped && !applied.size) throw new Error('이 그림의 선택이 없습니다. 검토한 DAG와 선택 파일의 버전을 확인하세요');
  return { dag: result, applied: [...applied], skipped };
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { values } = parseArgs({ options: { dag: { type: 'string' }, choices: { type: 'string' }, out: { type: 'string' } } });
    if (!values.dag || !values.choices || !values.out) throw new Error('--dag <DAG> --choices <선택.json> --out <새 DAG>');
    const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const { dag, applied, skipped } = applyChoices(read(values.dag), read(values.choices));
    writeFileSync(values.out, JSON.stringify(dag, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ applied, skipped, out: values.out }));
  } catch (error) { console.error('dag-routing-choices: ' + error.message); process.exitCode = 1; }
}
