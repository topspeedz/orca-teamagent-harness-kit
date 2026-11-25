import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { validateCodexPair, validateRouting } from './model-routing.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const digest = ({ version, planHash, dagHash, tasks, legacyRun, routingVersion }) => hash(JSON.stringify([version, planHash, dagHash, tasks, legacyRun ?? null, ...(routingVersion == null ? [] : [routingVersion])]));
const validVersion = v => /^v[1-9]\d*$/.test(v);
const required = (value, message) => { if (!value) throw new Error(message); };

// Project the drawing onto executable Tasks. Groups expand to their members,
// human checkpoints pass through their prerequisites, and review loops are not prerequisites.
function assignments(dag) {
  const nodes = new Map(), groups = new Map(), incoming = new Map();
  const routed = dag.routingVersion === 2 || dag.nodes.some(n => n.routing || n.members?.some(m => m.routing));
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
    const row = { ...(n.complexity == null ? {} : { complexity: n.complexity }), agent: n.role, unit: n.unit, runtime: n.agent, model: n.model, effort: n.effort ?? null, overrideReason: n.overrideReason ?? null };
    if (routed && row.runtime === 'codex' && row.effort !== null) validateCodexPair(row.model, row.effort);
    if (routed && n.fixed === true && !n.routing) row.routing = { version: 2, mode: 'manual', fixed: true };
    if (n.routing) {
      const { mode = 'auto', ...assessment } = n.routing;
      required(['auto', 'manual'].includes(mode), 'routing.mode는 auto 또는 manual');
      const needsMap = n.agent === 'codex' || assessment.evaluatedRuntime === 'codex';
      const codexMap = needsMap ? dag.choices?.codex : undefined;
      required(!needsMap || codexMap, 'Codex 라우팅 승인에는 DAG choices.codex 필요');
      validateRouting(assessment, n.agent, codexMap);
      required(assessment.scores.F === 0, '계획 승인에서는 실패 이력 F=0');
      required(!n.recommended || n.recommended === assessment.claude, 'DAG 추천과 라우팅 결과 불일치');
      const fixed = n.fixed === true;
      if (!fixed && mode === 'auto') {
        required(!row.overrideReason && row.model === assessment.model && row.effort === assessment.effort, '자동 배정과 추천 불일치');
      }
      if (!fixed && (mode === 'manual' || n.base)) {
        const base = n.base ?? assessment.claude;
        required(/^(haiku|(opus|sonnet|fable)\/(low|medium|high|xhigh|max))$/.test(base), '승인할 Claude 조합 확인 필요');
        const actual = row.effort ? row.model + '/' + row.effort : row.model;
        required(actual === (n.agent === 'codex' ? codexMap[base] : base), 'DAG에서 선택한 조합과 승인 배정 불일치');
      }
      row.routing = { version: 2, mode, fixed, assessment, ...(codexMap ? { codexMap } : {}) };
    }
    return row;
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
      required(![n.role, n.unit, n.agent, n.model, n.effort, n.members, n.overrideReason, n.routing].some(Boolean), `${id}의 비실행 노드에 배정이 있음`);
    } else {
      const bl = Array.isArray(n.bl) ? n.bl : String(n.bl ?? '').trim().split(/[,\s·]+/);
      required(bl.length && bl.every(value => typeof value === 'string' && /^BL-\d{4}$/.test(value)), `${id}의 BL-#### 확인 필요`);
      required(n.afterFix === undefined || (typeof n.afterFix === 'string' && n.afterFix !== ''), `${id}의 afterFix는 빈 문자열이 아닌 사유`);
      // New fields only when present, so a drawing without them keeps its review hash.
      tasks[id] = { ...normalized(n), bl: n.bl, deps, members: (n.members ?? []).map(normalized),
        ...(n.conditional === true ? { conditional: true } : {}), ...(n.afterFix ? { afterFix: n.afterFix } : {}) };
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
  const named = new Set();
  for (const round of dag.rounds ?? []) for (const kind of ['verify', 'fix', 'recheck']) {
    for (const id of [round[kind] ?? []].flat()) {
      required(Object.hasOwn(tasks, id), `rounds가 가리키는 노드 없음: ${id}`);
      required(!named.has(id), `rounds에 같은 Task가 두 번 나옴: ${id}`);
      named.add(id);
      required(Number.isInteger(round.n), `rounds의 n은 정수: ${id}`);
      Object.assign(tasks[id], { kind, round: round.n });
    }
  }
  // Walk the projected deps: a verify Task may not wait behind a fix Task unless it gives afterFix,
  // and no dependency path holds more than two fix Tasks.
  const behind = new Map(), fixes = new Map();
  const trace = id => {
    if (behind.has(id)) return;
    const { deps, kind } = tasks[id];
    deps.forEach(trace);
    behind.set(id, new Set(deps.flatMap(d => [d, ...behind.get(d)])));
    fixes.set(id, (kind === 'fix' ? 1 : 0) + Math.max(0, ...deps.map(d => fixes.get(d))));
  };
  for (const [id, t] of Object.entries(tasks)) {
    trace(id);
    required(fixes.get(id) <= 2, `수정 Task 사슬이 2단을 넘음: ${id}`);
    const fix = t.kind === 'verify' && !t.afterFix && [...behind.get(id)].find(d => tasks[d].kind === 'fix');
    required(!fix, `검증 Task ${id}가 수정 Task ${fix} 뒤에 걸려 있음`);
  }
  return tasks;
}

export function reviewPlan(o, io) {
  required(validVersion(o.version) && o.plan && o.dag, 'review/approve --version v<N> --plan <계획> --dag <DAG>');
  const dag = io.read(o.dag);
  const drawing = JSON.parse(dag);
  required(drawing.routingVersion == null || drawing.routingVersion === 2, '지원하지 않는 DAG routingVersion');
  const record = { version: o.version, planHash: hash(io.read(o.plan)), dagHash: hash(dag), tasks: assignments(drawing) };
  if (drawing.routingVersion === 2 || Object.values(record.tasks).some(t => [t, ...t.members].some(a => a.routing))) record.routingVersion = 2;
  if (o['legacy-map']) {
    const map = JSON.parse(io.read(o['legacy-map']));
    required(map.run && !map.approval && resolve(dirname(o['legacy-map'])) === resolve(dirname(o.dag)), '이전 Run의 대응표가 필요함');
    required(!record.routingVersion, '구 Run 복원은 당시 승인 배정만 가능');
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
