// Claude Code 세션 기록에서 토큰 소모 분포를 실측한다(읽기 전용). 하네스·문서 구조를 바꾸기 전후에 돌려 비교한다.
// 사용: (프로젝트 루트에서) node "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/measure-token-usage.mjs" [일수=7]
// Orca를 안 쓰는 프로젝트에서는 Orca 항목(Bash:orca·Orca알림 깨움·코디네이터/워커 행)이 0이라 출력에서 빠진다.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const days = Number(process.argv[2]) || 7
const since = Date.now() - days * 86400e3
const root = path.join(os.homedir(), '.claude', 'projects')
// Claude Code는 cwd의 영숫자 외 문자를 '-'로 바꿔 폴더명을 만든다. 접두 일치로 중첩 워크트리(data-2 등) 세션도 포함한다.
const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-')
// Read 경로를 프로젝트 상대경로로 줄인다 — 형제 워크트리(<프로젝트>-xxx/)도 같은 이름으로 접는다
const cwdPrefix = new RegExp('^.*?' + path.basename(process.cwd()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^/]*/', 'i')
if (!fs.existsSync(root)) { console.error(`세션 기록 폴더가 없다: ${root} — Claude Code를 쓴 머신에서 실행한다`); process.exit(1) }
const dirs = fs.readdirSync(root).filter(d => d.toLowerCase().startsWith(slug.toLowerCase()))
// 서브에이전트 기록은 <세션>/subagents/*.jsonl에 따로 있다(줄마다 isSidechain) — 같이 읽어 서브에이전트 합계로만 센다
const files = dirs.flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true }).filter(f => f.endsWith('.jsonl')).map(f => path.join(root, d, f)))
  .filter(f => fs.statSync(f).mtimeMs >= since)

const bump = (m, k, chars = 0) => {
  const v = m.get(k) || { n: 0, chars: 0, max: 0 }
  v.n++; v.chars += chars; v.max = Math.max(v.max, chars); m.set(k, v)
}
const sessions = []
const bands = [[0, 100], [100, 200], [200, 400], [400, Infinity]].map(([lo, hi]) => ({ lo, hi, turns: 0, tok: 0 }))
const startAttach = new Map(), toolChars = new Map(), bashCmd = new Map(), readFiles = new Map()
const agentCalls = new Map(), skillCalls = new Map(), causes = new Map()
let compacts = 0, skipped = 0, outside = 0, memLookups = 0
// 턴을 만든 원인 — 도구 1회 = 1턴 = 그때의 컨텍스트 전체 재독이라, 결과 크기보다 이쪽이 실제 비용이다
const SEARCH_BIN = new Set(['grep', 'egrep', 'rg', 'find', 'ls', 'cat', 'sed', 'head', 'tail', 'wc', 'awk', 'select-string', 'get-content', 'gc'])
// Orca CLI — orca·orca.exe·orca-dev·orca-ide (orchestration Skill의 실행 파일 선택 규칙)
const ORCA_CMD = /(^|[\s;&|("'\\/])orca(-dev|-ide)?(\.exe)?["']?\s/i
// 워커 판별 프리앰블 — worker-intake-context.mjs와 같은 환경변수·기본값
const WORKER_MARK = new RegExp(process.env.WORKER_PREAMBLE_REGEX || 'You are a dispatched worker')
const cause = c => {
  if (c.name !== 'Bash' && c.name !== 'PowerShell') return c.name.startsWith('mcp__') ? 'MCP' : c.name
  const cmd = String(c.input?.command || '')
  // heartbeat를 다음 명령에 병합한 턴은 나머지 명령으로 센다 — 단독 heartbeat 턴만 남겨야 병합 효과가 보인다
  if (cmd.includes('--type heartbeat')) {
    const rest = cmd.split(/;|&&/).filter(s => s.trim() && !s.includes('--type heartbeat') && !/^\s*(cd|export)\b/.test(s)).join(';')
    if (!rest.trim()) return 'Bash:orca:heartbeat'
    return cause({ ...c, input: { command: rest } })
  }
  if (ORCA_CMD.test(cmd)) return 'Bash:orca'
  // 세그먼트마다 바이너리 이름을 정규화한다 — `command grep`·절대경로·`Select-String` 우회도 탐색으로 센다(훅 도입 후 우회를 놓치지 않기 위해)
  const bins = cmd.split(/&&|\|\||;|\|/).map(s => {
    const ws = s.trim().split(/\s+/).filter(w => w && !/^[A-Za-z_]\w*=/.test(w))
    let w = ws[0] || ''; if (/^(command|exec|sudo|time)$/.test(w)) w = ws[1] || ''
    return w.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
  }).filter(b => b && b !== 'cd' && b !== 'export')
  const heavy = bins.find(b => ['python', 'python3', 'node', 'npm', 'npx', 'git', 'gh'].includes(b))
  if (heavy) return `Bash:${heavy.replace(/3$|x$/, '')}`
  if (bins.some(b => SEARCH_BIN.has(b))) return 'Bash:탐색·열람'
  return 'Bash:기타'
}
// 서브에이전트가 쓴 토큰 — 메인 수치에서 빼기만 하면 위임으로 옮긴 비용이 "절감"으로 보인다
const side = { t: 0, c: 0, o: 0 }
// 처리 토큰의 대부분은 캐시 읽기(단가 0.1배)라 합계만 보면 비용이 부풀어 보인다 — 캐시 종류별로 따로 센다
const cache = { main: { in: 0, w5: 0, w1h: 0, r: 0, o: 0 }, side: { in: 0, w5: 0, w1h: 0, r: 0, o: 0 } }
const addCache = (b, u) => {
  b.in += u.input_tokens || 0; b.r += u.cache_read_input_tokens || 0; b.o += u.output_tokens || 0
  // TTL 내역이 없는 기록은 기본 TTL(5분)로 본다
  if (u.cache_creation) { b.w5 += u.cache_creation.ephemeral_5m_input_tokens || 0; b.w1h += u.cache_creation.ephemeral_1h_input_tokens || 0 }
  else b.w5 += u.cache_creation_input_tokens || 0
}

for (const file of files) {
  const s = { id: path.basename(file).slice(0, 8), turns: 0, first: 0, peak: 0, total: 0, out: 0, calls: 0, firstEdit: 0, orca: 0, worker: false }
  const seen = new Set(), sideSeen = new Set(), toolUse = new Map(), ctxOf = new Map(), caused = new Set()
  let notified = false
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln) continue
    // 진행 중 세션은 마지막 줄이 잘려 있을 수 있다 — 건너뛰되 건수를 드러낸다
    let o; try { o = JSON.parse(ln) } catch { skipped++; continue }
    // 서브에이전트 줄은 메인 컨텍스트가 아니다 — 섞이면 도구 결과가 '?' 버킷으로 샌다
    // 파일 mtime으로만 거르면 오래된 세션을 오늘 resume했을 때 창 밖 턴이 통째로 들어온다 — 줄 단위로 다시 거른다
    const inWindow = !o.timestamp || Date.parse(o.timestamp) >= since
    if (o.isSidechain) {
      const u = o.message?.usage, id = o.message?.id
      if (inWindow && o.type === 'assistant' && u && !(id && sideSeen.has(id))) {
        sideSeen.add(id)
        side.t++; side.o += u.output_tokens || 0
        side.c += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
        addCache(cache.side, u)
      }
      continue
    }
    if (!inWindow) { if (o.type === 'assistant' && o.message?.usage) outside++; continue }
    if (o.subtype === 'compact_boundary') compacts++
    if (o.attachment && !s.turns) bump(startAttach, o.attachment.type, JSON.stringify(o.attachment).length)
    // Orca 워커 프리앰블로 워커 세션을 가른다
    if (!s.turns && o.type === 'user' && WORKER_MARK.test(ln)) s.worker = true
    const m = o.message
    // Orca가 코디네이터 터미널에 타이핑하는 알림 — 도구 없이도 한 턴을 깨운다
    // content는 문자열이거나 text 블록 배열이다 — String(배열)은 "[object Object]"라 항상 놓친다
    const utext = typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
    if (o.type === 'user' && /^\s*You have \d+ orchestration message/.test(utext)) notified = true
    if (o.type === 'assistant' && m?.usage) {
      // 같은 message.id가 content 블록마다 중복 기록된다 — usage는 1회만 센다(id 없는 메시지는 매번 센다)
      if (!m.id || !seen.has(m.id)) {
        seen.add(m.id)
        const u = m.usage
        const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
        addCache(cache.main, u)
        s.turns++; s.first ||= ctx; s.peak = Math.max(s.peak, ctx); s.total += ctx; s.out += u.output_tokens || 0
        ctxOf.set(m.id, ctx)
        if (notified) { notified = false; caused.add(m.id); const v = causes.get('Orca알림 깨움') || { t: 0, c: 0 }; v.t++; v.c += ctx; causes.set('Orca알림 깨움', v) }
        const b = bands.find(b => ctx / 1e3 >= b.lo && ctx / 1e3 < b.hi); b.turns++; b.tok += ctx
      }
      for (const c of m.content || []) {
        if (c.type !== 'tool_use' || toolUse.has(c.id)) continue
        toolUse.set(c.id, c)
        const why = cause(c)
        s.calls++; if (why === 'Bash:orca') s.orca++
        if (!s.firstEdit && (c.name === 'Edit' || c.name === 'Write')) s.firstEdit = s.calls
        if (c.name.includes('claude-mem') || (c.name === 'Skill' && String(c.input?.skill).includes('mem'))) memLookups++
        // 한 턴에 도구를 여럿 묶어 불러도 재독은 1번 — 첫 도구에만 귀속한다
        if (!caused.has(m.id)) { caused.add(m.id); const v = causes.get(why) || { t: 0, c: 0 }; v.t++; v.c += ctxOf.get(m.id) || 0; causes.set(why, v) }
        if (c.name === 'Agent' || c.name === 'Task') bump(agentCalls, c.input?.subagent_type || '(default)')
        if (c.name === 'Skill') bump(skillCalls, c.input?.skill || '?')
      }
    }
    if (o.type === 'user' && Array.isArray(m?.content)) for (const c of m.content) {
      if (c.type !== 'tool_result') continue
      const t = toolUse.get(c.tool_use_id)
      const len = (typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '')).length
      bump(toolChars, t?.name || '?', len)
      if (t?.name === 'Read') bump(readFiles, String(t.input?.file_path).replace(/\\/g, '/').replace(cwdPrefix, ''), len)
      if (t?.name === 'Bash') {
        const cmd = String(t.input?.command || '').replace(/^cd [^&;]+(&&|;)\s*/, '').replace(/"[^"]*"/g, '""')
        bump(bashCmd, cmd.split(/\s+/).slice(0, 3).join(' ').slice(0, 50), len)
      }
    }
  }
  if (s.turns) sessions.push(s)
}

// 접두 일치는 형제 경로(<프로젝트>-old 등)도 잡는다 — 섞였는지 볼 수 있게 이름을 찍는다
console.log(`기록 폴더 ${dirs.length}개(${slug}*) · 파일 ${files.length}개
  ${dirs.join(' ')}`)
if (!sessions.length) { console.log('집계할 세션이 없다 — 폴더 일치 여부와 일수를 확인한다'); process.exit(1) }
const k = n => (n / 1e3).toFixed(0) + 'k'
const tot = sessions.reduce((a, s) => ({ t: a.t + s.turns, c: a.c + s.total, o: a.o + s.out }), { t: 0, c: 0, o: 0 })
const firsts = sessions.map(s => s.first).sort((a, b) => a - b)
console.log(`== 최근 ${days}일 · 세션 ${sessions.length}개 · 턴 ${tot.t} · 파싱 실패 줄 ${skipped} ==`)
console.log(`처리 토큰 ${k(tot.c)} · 출력 ${k(tot.o)} · 턴당 평균 컨텍스트 ${k(tot.c / tot.t)} · compact ${compacts}회`)
console.log(`서브에이전트(sidechain) ${side.t}턴 · 처리 ${k(side.c)} · 출력 ${k(side.o)} — 위 메인 수치에 미포함 · 창 밖이라 뺀 턴 ${outside}(usage 중복 포함)`)
console.log(`세션 시작 고정비(첫 턴 컨텍스트) 중앙값 ${k(firsts[firsts.length >> 1])}`)

// 환산 = API 단가 비율(기본 입력 1 기준, 출력은 모든 Claude 모델에서 입력의 5배). 구독 한도가 같은 비율로 세는지는 미확인
console.log('\n== 캐시 구분 (토큰 · 환산 입력 토큰 · 환산 비중) — 가중치: 캐시 없음 1 · 쓰기 5분 1.25 · 쓰기 1시간 2 · 읽기 0.1 · 출력 5 ==')
const W = { in: 1, w5: 1.25, w1h: 2, r: 0.1, o: 5 }
const LABEL = { in: '캐시 없음', w5: '캐시 쓰기 5분', w1h: '캐시 쓰기 1시간', r: '캐시 읽기', o: '출력' }
const wsum = b => Object.keys(W).reduce((a, key) => a + b[key] * W[key], 0)
const wall = wsum(cache.main) + wsum(cache.side)
for (const [name, b] of Object.entries(cache)) {
  const inputs = b.in + b.w5 + b.w1h + b.r
  console.log(`${name === 'main' ? '메인' : '서브에이전트'} · 캐시 적중률 ${(b.r / (inputs || 1) * 100).toFixed(1)}% · 환산 ${k(wsum(b))}`)
  for (const key of Object.keys(W))
    console.log('  ' + LABEL[key].padEnd(10), k(b[key]).padStart(9), k(b[key] * W[key]).padStart(9), (b[key] * W[key] / (wall || 1) * 100).toFixed(1).padStart(6) + '%')
}

console.log('\n== 컨텍스트 크기 구간별 비중 ==')
for (const b of bands) console.log(`${b.lo}k~`.padEnd(8), String(b.turns).padStart(6), '턴', (b.tok / tot.c * 100).toFixed(1).padStart(6) + '%')

console.log('\n== 턴을 만든 원인 (턴 · 재독 토큰 · 비중 · 턴당 컨텍스트) — 나머지는 도구 없는 답변 턴 ==')
for (const [key, v] of [...causes].sort((a, b) => b[1].c - a[1].c).slice(0, 12))
  console.log(String(v.t).padStart(6), k(v.c).padStart(9), (v.c / tot.c * 100).toFixed(1).padStart(6) + '%', k(v.c / v.t).padStart(6), key)

// 코디네이터 = orca 명령 20회 이상, 워커 = Orca 워커 프리앰블로 시작 — 워커 크기 상한(60턴·200k)의 준수 여부를 본다
console.log('\n== 세션 종류별 (세션 · 턴 · 비중 · 턴당 컨텍스트 · 세션당 턴 중앙값/최대) ==')
const kinds = { 코디네이터: sessions.filter(s => s.orca >= 20), 워커: sessions.filter(s => s.worker && s.orca < 20), 일반: sessions.filter(s => !s.worker && s.orca < 20) }
for (const [name, g] of Object.entries(kinds)) {
  if (!g.length) continue
  const t = g.reduce((a, s) => a + s.turns, 0), c = g.reduce((a, s) => a + s.total, 0), ts = g.map(s => s.turns).sort((a, b) => a - b)
  console.log(name.padEnd(6), String(g.length).padStart(4), String(t).padStart(6), (c / tot.c * 100).toFixed(1).padStart(6) + '%', k(c / t).padStart(6), `${ts[ts.length >> 1]}/${ts.at(-1)}`.padStart(9))
}
const fe = sessions.map(s => s.firstEdit).filter(Boolean).sort((a, b) => a - b)
console.log(`첫 수정(Edit·Write)까지 도구 호출 수 중앙값 ${fe[fe.length >> 1] ?? '-'} (수정 있던 세션 ${fe.length}) · claude-mem 조회 호출 ${memLookups}회`)

console.log('\n== 소모 상위 세션 (id · 턴 · 첫턴 · 최대 · 처리합계 · 점유율) ==')
for (const s of sessions.sort((a, b) => b.total - a.total).slice(0, 10))
  console.log(s.id, String(s.turns).padStart(6), k(s.first).padStart(6), k(s.peak).padStart(6), k(s.total).padStart(9), (s.total / tot.c * 100).toFixed(1).padStart(6) + '%')

const top = (label, m, n, per) => {
  console.log(`\n== ${label} ==`)
  for (const [key, v] of [...m].sort((a, b) => b[1].chars - a[1].chars || b[1].n - a[1].n).slice(0, n))
    console.log(String(v.n).padStart(6), ((per ? v.chars / per : v.chars) / 1e3).toFixed(1).padStart(8) + 'kc', String((v.max / 1e3).toFixed(0)).padStart(5) + 'kc', key)
}
top('세션 시작 주입물 (횟수 · 세션당 평균 · 최대)', startAttach, 12, sessions.length)
top('도구별 결과 (호출 · 총 문자 · 최대)', toolChars, 10)
top('Bash 결과 상위 명령', bashCmd, 15)
top('Read 상위 파일', readFiles, 20)
top('Agent 호출', agentCalls, 10)
top('Skill 호출', skillCalls, 15)
