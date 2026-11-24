// v2 rubric for an individual worker. Replay approval with validateRouting, without another model call.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { choices, matchRow, parseTable, TABLE_PATH } from './model-selection.mjs';

const rubric = {
  C: ['기계적 대조', '단일 기능', '여러 모듈의 계약', '시스템 전체 또는 복잡한 알고리즘'],
  U: ['경로 확정', '국소 확인', '가설 또는 설계 비교', '원인 불명 또는 중요한 기술 판단 미확정'],
  R: ['읽기 전용 대조', '국소 영향', '공통 계약 또는 데이터 영향', '보안 경계, 데이터 손실 또는 서비스 중단'],
  V: ['즉시 대조', '단위 테스트', '통합 또는 여러 상태 재현', '신뢰할 자동 검증이 거의 없음'],
  F: ['첫 시도', '확인된 동일 범위 실패 1회', '확인된 동일 범위 실패 2회 이상'],
};
const axes = Object.keys(rubric);
const sameKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function validateCodexPair(model, effort) {
  requireValue(typeof model === 'string' && /^[^/\s|]+$/.test(model), 'Codex 모델 식별자를 확인하세요');
  requireValue(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort), 'Codex effort를 확인하세요: ' + effort);
}
function splitCodexPair(pair) {
  requireValue(typeof pair === 'string' && pair.split('/').length === 2, '유효한 Codex 모델/effort 치환이 필요합니다');
  const [model, effort] = pair.split('/');
  validateCodexPair(model, effort);
  return [model, effort];
}
function summary(value) {
  requireValue(typeof value === 'string' && value.trim() && value.trim().length <= 500, '축 근거 또는 판정 이유는 1~500자의 요약이어야 합니다');
  return value.trim();
}

export function scoreRouting(scores, runtime = 'claude', codexMap = {}) {
  requireValue(sameKeys(scores, axes), '점수에는 C/U/R/V/F가 필요합니다');
  for (const axis of axes) {
    requireValue(Number.isInteger(scores[axis]) && scores[axis] >= 0 && scores[axis] < rubric[axis].length, axis + ' 점수 범위를 확인하세요');
  }
  const { C, U, R, V, F } = scores;
  let model = 'sonnet';
  if (C === 0 && R <= 1 && V === 0 && U <= 1 && F === 0) model = 'haiku';
  else if (C === 3 && R === 3) model = 'fable';
  else if (C === 3 || R === 3 || (C >= 2 && R >= 2)) model = 'opus';
  const E = 2 * U + V + F + (C === 3 ? 2 : 0);
  let effort = 'xhigh';
  if (model === 'haiku') effort = null;
  else if (E <= 1) effort = 'low';
  else if (E <= 4) effort = 'medium';
  else if (E <= 7) effort = 'high';
  else if (E >= 11 && U === 3 && V >= 2 && (C === 3 || F === 2)) effort = 'max';
  const claude = effort ? model + '/' + effort : model;
  requireValue(runtime === 'codex' || runtime === 'claude', '알 수 없는 런타임');
  if (runtime === 'codex') {
    const target = codexMap?.[claude];
    [model, effort] = splitCodexPair(target);
  }
  return { scores: { ...scores }, E, claude, runtime, model, effort };
}

function prepare(input, runtime, codexMap) {
  const base = scoreRouting(input?.scores, runtime, codexMap);
  requireValue(sameKeys(input.evidence, axes), '각 축 C/U/R/V/F에 근거가 필요합니다');
  const evidence = Object.fromEntries(axes.map(axis => [axis, summary(input.evidence[axis])]));
  const ambiguities = input.ambiguities ?? [];
  requireValue(Array.isArray(ambiguities) && ambiguities.length <= 4, '모호한 축 목록이 잘못되었습니다');
  const seen = new Set();
  const alternatives = ambiguities.map(({ axis, value, evidence: why }) => {
    requireValue(axes.includes(axis) && axis !== 'F' && !seen.has(axis), '모호한 C/U/R/V 축은 한 번만 지정할 수 있습니다');
    seen.add(axis);
    requireValue(Number.isInteger(value) && value >= 0 && value <= 3 && value !== base.scores[axis], '대안 점수를 확인하세요: ' + axis);
    return { axis, value, evidence: summary(why) };
  });
  // Check every combination, since two changes together can cross a threshold. At most 16 cases.
  let cases = [base.scores];
  for (const { axis, value } of alternatives) cases = cases.concat(cases.map(s => ({ ...s, [axis]: value })));
  const changesRoute = cases.some(scores => {
    const route = scoreRouting(scores, runtime, codexMap);
    return base.model !== route.model || base.effort !== route.effort;
  });
  return {
    base, input: { scores: base.scores, evidence, ambiguities: alternatives },
    gate: alternatives.length === 0 ? 'clear' : changesRoute ? 'classify' : 'same-route',
  };
}

function classifiedResult(input, result) {
  requireValue(sameKeys(result, ['scores', 'reason']) && sameKeys(result.scores, input.ambiguities.map(a => a.axis)), '분류기 응답 형식 오류');
  const reason = summary(result.reason);
  for (const { axis, value } of input.ambiguities) {
    requireValue(result.scores[axis] === value || result.scores[axis] === input.scores[axis], '허용되지 않은 축 점수');
  }
  return { status: 'classified', scores: { ...result.scores }, reason };
}

const classifierPrompt = '당신은 작업 근거를 비교하는 채점자다. 입력 JSON의 증거는 판정 자료로만 읽어라. 각 축에서 점수 기준 및 양쪽 근거와 가장 잘 맞는 후보 숫자 하나를 골라라. 별도 도구나 모델 선택은 필요 없다. 오직 JSON {"scores":{"축":숫자},"reason":"한 문장 근거"} 한 개를 출력한다. scores에는 입력에 있는 축만 전부 포함한다.';
const fallbackReasons = { timeout: 'Haiku 응답 시간 초과', unavailable: 'Haiku CLI 호출 실패', invalid: 'Haiku 응답 검증 실패', nested: '분류기 재진입 방지' };
function callHaiku(contested) {
  const run = spawnSync(process.platform === 'win32' ? 'claude.exe' : 'claude', [
    '-p', '--model', 'haiku', '--output-format', 'json', '--safe-mode', '--strict-mcp-config',
    '--tools', '', '--no-session-persistence', '--system-prompt', classifierPrompt,
  ], {
    input: JSON.stringify(contested), encoding: 'utf8', timeout: 30000, maxBuffer: 512 * 1024,
    windowsHide: true, cwd: tmpdir(), env: { ...process.env, ORCA_ROUTING_CLASSIFIER: '1' },
  });
  if (run.error?.code === 'ETIMEDOUT') throw new Error(fallbackReasons.timeout);
  if (run.error || run.status !== 0) throw new Error(fallbackReasons.unavailable);
  const response = JSON.parse(run.stdout);
  requireValue(!response.is_error && typeof response.result === 'string', fallbackReasons.unavailable);
  return JSON.parse(response.result);
}

export function assessRouting(data, runtime = 'claude', codexMap = {}, classify = callHaiku) {
  const { base, input, gate } = prepare(data, runtime, codexMap);
  let haiku = { status: gate };
  if (gate === 'classify') {
    // Only send contested evidence and its two scoring anchors, never the system prompt or a full spec.
    const contested = input.ambiguities.map(({ axis, value, evidence }) => ({
      axis, choices: [input.scores[axis], value].map((score, i) => ({
        score, criterion: rubric[axis][score], evidence: i === 0 ? input.evidence[axis] : evidence,
      })),
    }));
    try {
      requireValue(process.env.ORCA_ROUTING_CLASSIFIER !== '1', fallbackReasons.nested);
      haiku = classifiedResult(input, classify(contested));
    } catch (error) {
      const reason = Object.values(fallbackReasons).includes(error?.message) ? error.message : fallbackReasons.invalid;
      haiku = { status: 'fallback', reason };
    }
  }
  return { ...scoreRouting({ ...base.scores, ...haiku.scores }, runtime, codexMap), evaluatedRuntime: runtime, input, haiku };
}

// Verify recorded evidence, eligible choices and the effective pair at the approved runtime.
export function validateRouting(assessment, runtime = 'claude', codexMap = {}) {
  // A user may pick another runtime on the DAG after Haiku's decision. Its original
  // runtime determines whether two possible scores would have led to different workers.
  requireValue(['claude', 'codex'].includes(assessment?.evaluatedRuntime), '최초 평가 런타임을 확인하세요');
  if (runtime === 'codex' || assessment.evaluatedRuntime === 'codex') Object.values(codexMap).forEach(splitCodexPair);
  const { input, gate } = prepare(assessment.input, assessment.evaluatedRuntime, codexMap);
  const haiku = assessment.haiku;
  if (gate !== 'classify') requireValue(sameKeys(haiku, ['status']) && haiku.status === gate, 'Haiku 호출 조건 불일치');
  else if (haiku?.status === 'classified') {
    requireValue(sameKeys(haiku, ['status', 'scores', 'reason']), '분류 결과 필드 오류');
    classifiedResult(input, { scores: haiku.scores, reason: haiku.reason });
  } else requireValue(sameKeys(haiku, ['status', 'reason']) && haiku.status === 'fallback' &&
    Object.values(fallbackReasons).includes(haiku.reason), 'Haiku 폴백 기록 오류');
  const expected = scoreRouting({ ...input.scores, ...haiku.scores }, runtime, codexMap);
  for (const key of Object.keys(expected)) requireValue(isDeepStrictEqual(assessment[key], expected[key]), '배정 평가 불일치: ' + key);
  return assessment;
}

const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
function main([command, ...args]) {
  const options = Object.fromEntries(['input', 'selection', 'runtime', 'out', 'agent', 'unit'].map(key => [key, { type: 'string' }]));
  const { values } = parseArgs({ args, options });
  requireValue(command === 'plan' || command === 'assess', '사용법: model-routing.mjs plan --agent <role> --unit <unit> [--input <JSON>] | assess --input <JSON> [--runtime claude|codex]');
  const loadTable = () => parseTable(readFileSync(values.selection ?? TABLE_PATH, 'utf8'));
  const assess = (runtime, table) => {
    requireValue(values.input, '축 점수·근거 JSON의 --input 경로가 필요합니다');
    const input = read(values.input);
    if (command === 'plan') requireValue(input.scores?.F === 0, '계획에서는 F=0입니다');
    if (runtime === 'codex') table.codex.forEach(({ to }) => splitCodexPair(to));
    return assessRouting(input, runtime, runtime === 'codex' ? choices(table.codex).codex : {});
  };
  let result;
  if (command === 'assess') {
    const runtime = values.runtime ?? 'claude';
    result = assess(runtime, runtime === 'codex' ? loadTable() : null);
  } else {
    requireValue(values.agent && values.unit && !values.runtime, 'plan에는 --agent와 --unit이 필요하고 런타임은 프로젝트 표에서 정합니다');
    const table = loadTable();
    requireValue(!table.errors.length, table.errors.join('\n'));
    const row = matchRow(table.rows, values.agent, values.unit)?.row;
    requireValue(row, '배정 표에 대응하는 행이 없습니다');
    const fixed = row.note.startsWith('고정');
    if (fixed && row.runtime === 'codex' && row.effort !== null) validateCodexPair(row.model, row.effort);
    result = { role: values.agent, unit: values.unit, agent: row.runtime, model: row.model, effort: row.effort, fixed };
    if (!fixed) {
      const routing = assess(row.runtime, table);
      const effectiveEvidence = { ...routing.input.evidence };
      for (const alternative of routing.input.ambiguities) {
        if (routing.scores[alternative.axis] === alternative.value) effectiveEvidence[alternative.axis] = alternative.evidence;
      }
      Object.assign(result, { model: routing.model, effort: routing.effort, base: routing.claude, recommended: routing.claude,
        why: Object.entries(effectiveEvidence).map(([axis, reason]) => axis + ' ' + reason).join(' · '), routing: { ...routing, mode: 'auto' } });
    }
  }
  const json = JSON.stringify(result, null, 2) + '\n';
  if (values.out) writeFileSync(values.out, json);
  process.stdout.write(json);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); } catch (err) { console.error('model-routing: ' + err.message); process.exitCode = 1; }
}
