import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

const hash = text => createHash('sha256').update(text).digest('hex');
const digest = ({ version, planHash, dagHash, tasks, legacyRun }) => hash(JSON.stringify([version, planHash, dagHash, tasks, legacyRun ?? null]));
const validVersion = v => /^v[1-9]\d*$/.test(v);
const required = (value, message) => { if (!value) throw new Error(message); };

// Project the drawing onto executable Tasks. Groups expand to their members,
// human checkpoints pass through their prerequisites, and review loops are not prerequisites.
function assignments(dag) {
  const nodes = new Map(), groups = new Map(), incoming = new Map();
  for (const node of dag.nodes) {
    required(typeof node.id === 'string' && /^[\w-]+$/.test(node.id) && !(node.id in {}) && !nodes.has(node.id), '중복 또는 잘못된 DAG 노드 ID');
    nodes.set(node.id, node);
    incoming.set(node.id, []);
  }
  for (const group of dag.groups ?? []) {
    required(!nodes.has(group.id) && !groups.has(group.id) && group.nodes.length && group.nodes.every(id => nodes.has(id)), '잘못된 DAG 그룹');
    groups.set(group.id, group.nodes);
  }
  for (const edge of dag.edges) {
    for (const from of groups.get(edge.from) ?? [edge.from]) for (const to of groups.get(edge.to) ?? [edge.to]) {
      required(nodes.has(from) && nodes.has(to), '없는 DAG 연결 노드');
      if (!edge.loop) incoming.get(to).push(from);
    }
  }
  const normalized = n => {
    required(n.role && n.unit && ['codex', 'claude'].includes(n.agent) && n.model, 'DAG 배정에 role/unit/agent/model이 필요함');
    return { agent: n.role, unit: n.unit, runtime: n.agent, model: n.model, effort: n.effort ?? null, overrideReason: n.overrideReason ?? null };
  };
  const tasks = {};
  const frontier = new Map(), visiting = new Set();
  const visit = id => {
    if (frontier.has(id)) return frontier.get(id);
    required(!visiting.has(id), 'DAG 의존 순환');
    visiting.add(id);
    const deps = [...new Set(incoming.get(id).flatMap(visit))].sort();
    const n = nodes.get(id);
    if (n.kind === 'approval' || n.kind === 'milestone') {
      required(![n.role, n.unit, n.agent, n.model, n.effort, n.members, n.overrideReason].some(Boolean), `${id}의 비실행 노드에 배정이 있음`);
    } else {
      const bl = Array.isArray(n.bl) ? n.bl : String(n.bl ?? '').trim().split(/[,\s·]+/);
      required(bl.length && bl.every(value => typeof value === 'string' && /^BL-\d{4}$/.test(value)), `${id}의 BL-#### 확인 필요`);
      tasks[id] = { ...normalized(n), bl: n.bl, deps, members: (n.members ?? []).map(normalized) };
      required(!tasks[id].members.length || n.unit === '리드', `${id}의 팀 내부 배정은 팀장 Task에서만 가능함`);
      const keys = tasks[id].members.map(m => JSON.stringify([m.agent, m.unit]));
      required(new Set(keys).size === keys.length, `${id}의 팀 내부 배정 중복`);
    }
    visiting.delete(id);
    frontier.set(id, tasks[id] ? [id] : deps);
    return frontier.get(id);
  };
  for (const id of nodes.keys()) visit(id);
  required(Object.keys(tasks).length, '실행 Task가 없는 DAG');
  return tasks;
}

export function reviewPlan(o, io) {
  required(validVersion(o.version) && o.plan && o.dag, 'review/approve --version v<N> --plan <계획> --dag <DAG>');
  const dag = io.read(o.dag);
  const record = { version: o.version, planHash: hash(io.read(o.plan)), dagHash: hash(dag), tasks: assignments(JSON.parse(dag)) };
  if (o['legacy-map']) {
    const map = JSON.parse(io.read(o['legacy-map']));
    required(map.run && !map.approval && resolve(dirname(o['legacy-map'])) === resolve(dirname(o.dag)), '이전 Run의 대응표가 필요함');
    record.legacyRun = map.run;
  }
  return { ...record, review: digest(record) };
}

export function approvePlan(o, record, io) {
  required(o.response?.trim() && o.review === record.review, '검토·승인한 버전 또는 사용자 원문을 확인한다');
  const versions = o.response.match(/\bv[1-9]\d*\b/g) ?? [];
  const hashes = o.response.match(/\b[0-9a-f]{64}\b/gi) ?? [];
  required((!versions.length || versions.includes(record.version)) &&
    (!hashes.length || hashes.some(value => value.toLowerCase() === record.review)), '사용자 응답이 다른 검토 버전을 지칭함');
  const approval = join(dirname(o.dag), `approved-plan.${o.version}.json`);
  const content = { ...record, response: o.response };
  const current = io.optional(approval);
  if (current !== null) required(JSON.stringify(JSON.parse(current)) === JSON.stringify(content), '이미 기록된 승인 버전이 다름');
  else io.create(approval, JSON.stringify(content, null, 2) + '\n');
  return { approval, version: o.version, review: record.review };
}

export function loadApproval(path, io, map) {
  required(path, '--approval <승인 파일> 필요');
  if (map) required(resolve(dirname(map)) === resolve(dirname(path)), '다른 phase의 승인 파일');
  const record = JSON.parse(io.read(path));
  required(validVersion(record.version) && basename(path) === `approved-plan.${record.version}.json` &&
    record.response?.trim() && record.review === digest(record), '승인 버전 또는 기록 무결성 불일치');
  return record;
}
