import { readFileSync, readdirSync, realpathSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, lstatSync, accessSync, constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { regular, teamStructure } from './team.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { manager } from './manager.mjs'

const css = readFileSync(new URL('./page.css', import.meta.url), 'utf8')
const project = process.cwd()
const source = path.join(os.homedir(), '.claude', 'agents-hans')
const m = manager(source, project)
const token = randomUUID()
const revision = text => createHash('sha256').update(text).digest('hex')
const tablePath = 'docs/harness/model-selection.md'
// Open an agent file with the user's .md default app (also for .toml, which usually has no handler).
async function openWithMarkdownApp(file) {
  if (process.platform !== 'win32') return execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [file])
  const run = promisify(execFile)
  try {
    const value = async (key, name) => (await run('reg', ['query', key, ...(name ? ['/v', name] : ['/ve'])])).stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/)[1].trim()
    const progId = await value('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice', 'ProgId')
    const command = await value('HKCR\\' + progId + '\\shell\\open\\command')
    const [exe, ...args] = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map(m => (m[1] ?? m[2]).replace(/%[1L]/g, file))
    execFile(exe.replace(/%(\w+)%/g, (_, v) => process.env[v] ?? ''), args).on('error', () => {})
  } catch { execFile('explorer.exe', [file]) } // shortcut: no .md handler found -> Windows picks (exits 1 even on success)
}
let pages = 0
const problem = (status, message) => Object.assign(Error(message), {status})
// Only load code from the user's installed kit. The project copies (including HTML) are data for version matching.
async function surveyAssets() {
  const assets = [
    ['.claude/scripts/model-table.mjs', 'skills/setup/scripts/model-table.mjs'],
    ['.claude/scripts/model-selection.mjs', 'template/.claude/scripts/model-selection.mjs'],
    ['docs/harness/templates/model-survey.html', 'skills/setup/assets/model-survey.html']
  ]
  const installed = assets.map(([rel]) => {
    const file = regular(project, rel)
    if (!file) throw problem(503,'모델 설문 설치 파일이 없습니다: ' + rel)
    return readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
  })
  const homes = new Set([process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude'),
    process.env.CODEX_HOME, path.join(os.homedir(), '.codex')].filter(Boolean))
  for (const home of homes) {
    const cache = path.join(home, 'plugins/cache/orca-teamagent/orca-teamagent-harness-kit')
    if (!lstatSync(cache, {throwIfNoEntry:false})?.isDirectory()) continue
    for (const version of readdirSync(cache)) {
      const kit = regular(cache, version, true)
      if (!kit) continue
      const relative = path.relative(realpathSync(project), realpathSync(kit))
      if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) continue
      if (!assets.every(([, rel], i) => {
        const file = regular(kit, rel)
        return file && readFileSync(file, 'utf8').replaceAll('\r\n', '\n') === installed[i]
      })) continue
      const editor = await import(pathToFileURL(path.join(kit, assets[0][1])).href)
      if (editor.pageData && editor.buildPage && editor.applyChoices) return {editor, html: installed[2]}
    }
  }
  throw problem(503,'설치한 모델 설문과 일치하는 사용자 키트 버전을 찾을 수 없습니다.')
}

async function modelSelection(req, res) {
  const {editor, html} = await surveyAssets()
  const currentTable = () => {
    const file = regular(project, tablePath)
    if (!file) throw problem(404,'현재 프로젝트에 모델 선택 표가 없습니다.')
    return file
  }
  if (req.method === 'GET') {
    const text = readFileSync(currentTable(), 'utf8')
    const data = editor.pageData(text, [], Boolean(regular(project, '.codex', true)) || /^\|[^|\n]+\|[^|\n]+\|\s*codex\s*\|/m.test(text))
    data.localSave = {token, revision: revision(text)}
    return res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(editor.buildPage(html, data))
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415,'JSON 요청이 필요합니다.')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw problem(413,'요청 크기가 너무 큽니다.')
    chunks.push(chunk)
  }
  const { choices, revision: expected } = JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {}
  if (typeof expected !== 'string' || !Array.isArray(choices) || choices.some(c => !c || typeof c.agent !== 'string' ||
      typeof c.unit !== 'string' || ['runtime','model','effort'].some(k => k in c && (typeof c[k] !== 'string' || /[|\r\n]/.test(c[k])))))
    throw Error('모델 선택 행을 확인하세요.')
  const file = currentTable()
  accessSync(file, constants.W_OK)
  const pending = file + '.agent-toggle-save'
  const fd = openSync(pending, 'wx', lstatSync(file).mode)
  let renamed = false
  let next
  try {
    const text = readFileSync(currentTable(), 'utf8')
    const conflict = () => problem(409,'모델 표가 변경되었습니다. 다시 열어 현재 값을 확인하세요.')
    if (revision(text) !== expected) throw conflict()
    next = editor.applyChoices(text, choices)
    if (next !== text) {
      writeFileSync(fd, next)
      if (readFileSync(currentTable(), 'utf8') !== text) throw conflict()
      renameSync(pending, file)
      renamed = true
    }
  } finally {
    closeSync(fd)
    if (!renamed) unlinkSync(pending)
  }
  return res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ revision: revision(next) }))
}
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const server = http.createServer(async (req, res) => {
  const host = '127.0.0.1:' + server.address().port
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Frame-Options', 'DENY')
  try {
    if (req.headers.host !== host) throw problem(403,'잘못된 호스트')
    const url = new URL(req.url, 'http://' + host)
    if (req.method === 'POST' && (req.headers.origin !== 'http://' + host || req.headers['x-agent-toggle'] !== token))
      throw problem(403,'잘못된 요청')
    if (url.pathname === '/model-selection' && ['GET','POST'].includes(req.method)) {
      if ((req.headers.origin && req.headers.origin !== 'http://' + host) || req.headers['sec-fetch-site'] === 'cross-site')
        throw problem(403,'잘못된 요청')
      return await modelSelection(req, res)
    }
    if (req.method === 'POST' && url.pathname === '/toggle') {
      const name = url.searchParams.get('name')
      const value = url.searchParams.get('on')
      if (!['true', 'false'].includes(value)) throw Error('잘못된 토글 값')
      if (url.searchParams.has('engine')) m.setProject(name, url.searchParams.get('engine'), value === 'true')
      else m.set(name, value === 'true')
      res.writeHead(204).end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/open') {
      const rel = url.searchParams.get('rel') ?? ''
      const file = /^\.(claude|codex)\/agents\/[\w.-]+$/.test(rel) && regular(project, rel)
      if (!file) throw problem(400, '열 수 없는 파일')
      await openWithMarkdownApp(file)
      return res.writeHead(204).end()
    }
    if (req.method === 'GET' && url.pathname === '/alive') {
      pages++
      res.writeHead(200, {'Content-Type':'text/event-stream'}).write(':\n\n')
      // Exit once every page is closed; the grace period lets a reload reconnect.
      req.on('close', () => { if (--pages === 0) setTimeout(() => pages || process.exit(0), 5000) })
      return
    }
    if (req.method === 'GET' && url.pathname === '/team.json') {
      const json = JSON.stringify(teamStructure(project))
      const tag = '"' + createHash('sha256').update(json).digest('hex') + '"'
      res.setHeader('ETag', tag)
      if (req.headers['if-none-match'] === tag) return res.writeHead(304).end()
      return res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}).end(json)
    }
    if (req.method === 'GET' && ['/team.js', '/team.css'].includes(url.pathname)) {
      const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'
      return res.writeHead(200, {'Content-Type':type + '; charset=utf-8'}).end(readFileSync(new URL('.' + url.pathname, import.meta.url)))
    }
    if (req.method === 'GET' && url.pathname === '/team-structure.html') {
      return res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="agent-toggle-token" content="' + token + '"><meta name="viewport" content="width=device-width,initial-scale=1"><title>에이전트 구조도</title><style>body{margin:0;background:#101012}</style><team-chart></team-chart><script src="/team.js"></script></html>')
    }
    if (req.method !== 'GET' || url.pathname !== '/') return res.writeHead(404).end()
    function row({name, state, reason, engine, scope}) {
      const title = esc(name)
      const buttons = ['on', 'off'].map(value =>
        `<button data-v="${value}" aria-pressed="${state === value}" ${state === 'conflict' ? 'disabled' : ''}>${value === 'on' ? 'ON' : 'OFF'}</button>`
      ).join('')
      const copied = scope === 'copied'
      const label = engine ? `<span class="sub">${engine}${copied ? ' · 창고에서 복사' : ''}</span>` : ''
      return `<article class="row ${copied ? 'synced' : 'project'} ${state}" data-name="${title}" data-state="${state}" ${engine ? 'data-engine="' + engine + '"' : ''}><b class="name">${title}</b><div class="seg" role="group" aria-label="${title} ${engine ?? ''}">${buttons}</div>${label}${state === 'conflict' ? '<small>' + esc(reason ?? '기존 파일과 충돌') + '</small>' : state === 'legacy' ? '<small>Claude만 설치됨</small>' : ''}</article>`
    }
    const projectRows = m.inventory().map(row).join('')
    const rows = m.list().map(row).join('')
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><html lang="ko">
<meta charset="utf-8"><meta name="agent-toggle-token" content="${token}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Toggle</title><style>${css}</style>
<header><h1>Agent Toggle</h1><div class="sub" id="meta"><span><b>프로젝트</b>${esc(project)}</span><span><b>원본</b>${esc(source)}</span></div>
<div class="sub">켬 = Claude Code와 Codex에 설치 · 끔 = 설치한 복사본 제거</div>
<div class="bar"><input type="search" id="q" placeholder="키트·에이전트 이름 검색" aria-label="키트·에이전트 이름 검색">
${['전체','켬','끔'].map((label,i) => `<button class="chip" data-f="${['all','on','off'][i]}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div></header>
<main><details class="section" open><summary>에이전트 창고 <span></span></summary><div class="grid" id="toggles">${rows}</div><p class="sub">표시할 에이전트가 없습니다.</p></details>
<details class="section" open><summary>프로젝트 에이전트 <span></span></summary><div class="grid">${projectRows}</div><p class="sub">표시할 에이전트가 없습니다.</p></details><team-chart></team-chart></main>
<script src="/team.js"></script>
<div id="toast" role="status"></div>
<script>
const sections = [...document.querySelectorAll('.section')]
const chips = [...document.querySelectorAll('.chip')]
let filter = 'all'
function render() {
  for (const section of sections) {
    const cards = [...section.querySelectorAll('.row')]
    for (const card of cards) {
      const state = card.dataset.state === 'legacy' ? 'on' : card.dataset.state
      card.hidden = (filter !== 'all' && state !== filter) || !card.dataset.name.toLowerCase().includes(q.value.trim().toLowerCase())
    }
    const visible = cards.filter(card => !card.hidden).length
    section.querySelector('summary span').textContent = visible + ' / ' + cards.length
    section.querySelector('p').hidden = visible > 0
  }
}
q.oninput = render
for (const chip of chips) chip.onclick = () => {
  filter = chip.dataset.f
  for (const item of chips) item.setAttribute('aria-pressed', item === chip)
  render()
}
document.querySelector('main').onclick = async event => {
  const button = event.target.closest('button[data-v]')
  if (!button || button.disabled) return
  const card = button.closest('.row')
  const state = button.dataset.v
  if (state === card.dataset.state) return
  const buttons = card.querySelectorAll('button')
  for (const item of buttons) item.disabled = true
  try {
    const query = new URLSearchParams({name:card.dataset.name, on:state === 'on'})
    if (card.dataset.engine) query.set('engine', card.dataset.engine)
    const response = await fetch('/toggle?' + query, {method:'POST', headers:{'x-agent-toggle':'${token}'}})
    if (!response.ok) throw Error(await response.text())
    document.querySelector('team-chart').refresh()
    const current = await fetch('/')
    if (!current.ok) throw Error(await current.text())
    const page = new DOMParser().parseFromString(await current.text(), 'text/html')
    sections.forEach((section, i) => {
      section.querySelector('.grid').replaceChildren(...page.querySelectorAll('.section .grid')[i].children)
    })
    render()
  } catch (error) {
    toast.textContent = error.message
    toast.classList.add('show')
  } finally {
    for (const item of buttons) item.disabled = false
  }
}
render()
</script></html>`)
  } catch (err) {
    const status = err.status ?? (req.url === '/model-selection' ? err.code ? 500 : 400 : 409)
    res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8'}).end(err.message)
  }
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/'))

