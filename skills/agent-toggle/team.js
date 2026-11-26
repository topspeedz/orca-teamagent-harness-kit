new EventSource('/alive') // server exits when every page holding this is closed
const views = ['에이전트 구조도', '직접 협업', '문서 담당']
const fontStylesheet = document.createElement('link')
fontStylesheet.rel = 'stylesheet'
fontStylesheet.href = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400&display=swap'
document.head.append(fontStylesheet)
const jobTitles = {
  'product-manager':'제품 기획 담당자', research:'조사 담당자', frontend:'프론트엔드 담당자',
  backend:'백엔드 담당자', verifier:'검증 담당자', 'harness-engineer':'하네스 엔지니어', 'doc-steward':'제품 문서 관리자'
}
const teamLabel = name => name === '프로젝트 에이전트' ? 'PROJECT AGENTS' : name.toUpperCase()
const skillNames = role => [...new Set(role.skills.map(name =>
  name.replace(/^(?:.*\/skills\/)?([^/]+)\/SKILL\.md$/i, '$1')
).filter(name => name && !name.includes('/') && !/\.(md|json|toml)$/i.test(name)))]

function outline(role) {
  const body = role.docs[0]?.body ?? ''
  const sections = new Map()
  let section = '', fence = ''
  for (const raw of body.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[^\n]*\n/, '').split(/\r?\n/)) {
    const line = raw.trim()
    const marker = line.match(/^(`{3,}|~{3,})/)?.[1]
    if (marker) { if (!fence) fence = marker; else if (marker.startsWith(fence)) fence = ''; continue }
    if (fence || !line) continue
    const heading = line.match(/^(#{1,6})\s+(.+)/)
    if (heading) { section = heading[1].length === 1 ? '' : heading[2]; continue }
    if (/^\|?[\s|:-]+\|?$/.test(line)) continue
    const item = line.replace(/^(?:[-*+]|\d+\.)\s+/, '').replaceAll('`', '')
    if (section) {
      if (!sections.has(section)) sections.set(section, [])
      sections.get(section).push(item)
    }
  }
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const title = heading && heading !== role.name ? heading : jobTitles[role.name] ??
    role.name.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  return { sections, title }
}

function workflowDiagram(data, row, openDocs) {
  const width = Math.max(1456, row.length * 364)
  const rail = 344
  const height = rail + 26
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', width)
  svg.setAttribute('height', height)
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', '사용자부터 에이전트까지의 업무 흐름')
  svg.classList.add('workflow')
  function shape(tag, attrs, value) {
    const node = document.createElementNS(svg.namespaceURI, tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (value) node.textContent = value
    svg.append(node)
    return node
  }
  const label = (x, y, value, cls = 'edge-label') => shape('text', { x, y, class: cls }, value)
  const line = (d, dashed = false) => shape('path', { d, class: dashed ? 'setting' : 'route' })
  function box(x, y, w, title, detail, activate) {
    const first = svg.children.length
    shape('rect', { x: x - w / 2, y, width: w, height: detail ? 68 : 44, rx: 9 })
    label(x, y + (detail ? 28 : 29), title, 'box-title')
    if (detail) label(x, y + 50, detail, 'box-detail')
    if (activate) {
      const control = shape('g', {role:'button', tabindex:'0', 'aria-label':title, class:'control'})
      control.append(...Array.from(svg.children).slice(first, -1))
      control.onclick = activate
      control.onkeydown = event => {
        if (['Enter',' '].includes(event.key)) { event.preventDefault(); activate() }
      }
    }
  }
  // One column per card below; product-manager hangs from the desk, the rest from the coordinator.
  const slot = width / Math.max(1, row.length)
  const x = role => slot * (row.indexOf(role) + .5)
  const pm = row.find(r => r.name === 'product-manager')
  const others = row.filter(r => r !== pm)
  const pmX = pm ? x(pm) : width * .10
  const exec = others.length ? (x(others[0]) + x(others.at(-1))) / 2 : width * .50
  const dag = (pmX + exec) / 2, desk = dag, settings = Math.min(width - 120, exec + 330)

  line(`M${desk} 44 V74 M${desk} 142 V173 H${exec} V228`)
  label((desk + exec) / 2, 165, '계획 승인 후 실행 요청')
  if (pm && !pm.waiting) {
    const path = line(`M${desk} 173 H${pmX} V${height}`)
    path.dataset.from = '창구'
    path.dataset.role = pm.name
    label((desk + pmX) / 2, 165, '요구 · 설계 · 계획 요청')
    line(`M${pmX} 262 H${dag - 80}`)
    label((pmX + dag - 80) / 2, 252, '작성 →')
  }
  line(`M${dag + 80} 262 H${exec - 104}`)
  label((dag + 80 + exec - 104) / 2, 252, '승인본 전달 →')
  if (data.workflow.modelSelection) {
    line(`M${settings - 110} 262 H${exec + 104}`, true)
    label((settings - 110 + exec + 104) / 2, 252, '← 실행 설정')
    box(settings, 228, 220, '모델 선택 표', '에이전트별 model · effort', () => window.open('/model-selection', '_blank', 'noopener'))
  }
  const active = others.filter(r => !r.waiting)
  if (active.length) {
    line(`M${exec} 296 V${rail} M${Math.min(exec, x(active[0]))} ${rail} H${Math.max(exec, x(active.at(-1)))}`)
    label(exec, rail - 9, '배정 · 결과 보고')
    for (const role of active) {
      const path = line(`M${x(role)} ${rail} V${height}`)
      path.dataset.from = '코디네이터'
      path.dataset.role = role.name
    }
  }
  box(desk, 0, 186, '사용자')
  box(desk, 74, 226, '창구 세션', '요청 정리 · 승인 · 최종 보고')
  if (data.workflow.documents || data.common.length) box(width * .10, 74, 242, 'docs/ · 공통 기준 문서', '문서 색인 · 문서 담당', openDocs)
  box(dag, 228, 160, 'DAG 계획서', '의존성 · 산출물 · 배정')
  box(exec, 228, 208, '코디네이터', '워커 기동 · 검증 · 보고 취합')
  return svg
}

class TeamChart extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/team.css"><section>
      <header><h2>Claude Code 에이전트 구조도</h2><span id="project"></span></header>
      <nav role="tablist" aria-label="에이전트 보기"></nav>
      <div class="chart" id="panel" role="tabpanel" tabindex="0"></div>
      <small role="status"></small><dialog><form method="dialog"><h3></h3><button>닫기</button></form><div id="docs"></div></dialog></section>`
    this.chart = this.shadowRoot.querySelector('.chart')
    this.dialog = this.shadowRoot.querySelector('dialog')
    this.history = []
    this.dialog.addEventListener('close', () => { this.history = []; this.selected = null })
    this.view = 0
    const nav = this.shadowRoot.querySelector('nav')
    views.forEach((label, i) => {
      const tab = document.createElement('button')
      tab.id = 'view-' + i
      tab.textContent = label
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', 'panel')
      tab.onclick = () => {
        this.view = i
        this.selectTab()
        if (this.data) this.draw(this.data)
      }
      tab.onkeydown = e => {
        const index = {ArrowRight:(i+1)%3, ArrowLeft:(i+2)%3, Home:0, End:2}[e.key]
        if (index === undefined) return
        e.preventDefault()
        nav.children[index].focus()
        nav.children[index].click()
      }
      nav.append(tab)
    })
    this.selectTab()
  }
  selectTab() {
    Array.from(this.shadowRoot.querySelector('nav').children).forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(this.view === i))
      tab.tabIndex = this.view === i ? 0 : -1
    })
    this.chart.setAttribute('aria-labelledby', 'view-' + this.view)
  }
  connectedCallback() { this.refresh() }
  disconnectedCallback() { clearTimeout(this.timer) }
  async refresh() {
    clearTimeout(this.timer)
    if (this.pending) return
    this.pending = true
    const status = this.shadowRoot.querySelector('[role=status]')
    try {
      const res = await fetch('/team.json', { headers: this.tag ? { 'If-None-Match': this.tag } : {} })
      if (res.status !== 304) {
        if (!res.ok) throw Error()
        const data = await res.json()
        this.draw(data)
        this.tag = res.headers.get('etag')
      }
      status.textContent = ''
    } catch { status.textContent = '구조도 연결을 확인하는 중입니다.' }
    finally {
      this.pending = false
      if (this.isConnected) this.timer = setTimeout(() => this.refresh(), 1000)
    }
  }
  draw(data) {
    this.data = data
    const all = data.groups.flatMap(g => g.members)
    const listed = data.groups.find(g => g.roster)?.members ?? []
    const lineup = [...listed.filter(r => r.name === 'product-manager'), ...listed.filter(r => r.name !== 'product-manager')]
    const outlines = new Map(all.map(role => [role, outline(role)]))
    const byName = new Map(all.map(r => [r.name, r]))
    const teamOf = new Map(data.groups.flatMap(g => g.members.map(r => [r, g])))
    const tones = ['#98bfe3','#deb781','#9bcaa7','#bba7de','#dfa6ae','#86cec7']
    const tone = new Map(all.map((r,i) => [r, tones[i] ?? `hsl(${(i * 137.508) % 360} 65% 72%)`]))
    const element = (tag, cls, text) => {
      const el = document.createElement(tag)
      el.className = cls
      if (text) el.textContent = text
      return el
    }
    const action = (label, fn) => {
      const b = element('button', 'action', label)
      b.type = 'button'
      b.onclick = fn
      return b
    }
    const relations = []
    for (const role of all) for (const {peer, topic, purpose, limit} of role.collaboration) {
      const other = byName.get(peer)
      if (!other) continue
      let existing = relations.find(r => r.topic === topic && r.pair.includes(role) && r.pair.includes(other))
      if (!existing) relations.push(existing = {pair:[role, other], topic, purposes:[], limits:[]})
      if (!existing.purposes.includes(purpose)) existing.purposes.push(purpose)
      if (limit && !existing.limits.includes(limit)) existing.limits.push(limit)
    }
    const limitText = r => r.limits.length ? '한도 ' + r.limits.join(' · ') : ''
    const navigate = target => {
      if (this.dialog.open && this.selected) this.history.push(this.selected)
      show(target)
    }
    const docs = this.dialog.querySelector('#docs')
    const heading = this.dialog.querySelector('h3')
    const roleButton = role => {
      const b = action(role.name, () => navigate({role:role.name}))
      b.classList.add('chip')
      b.style.setProperty('--tone', tone.get(role))
      b.setAttribute('aria-haspopup', 'dialog')
      return b
    }
    const pathButton = rel => {
      const b = action(rel, () => navigate({path:rel}))
      b.classList.add('path-chip')
      return b
    }
    const writers = row => row.writers.length ? row.writers.flatMap(n => byName.get(n).state === 'on' ? [roleButton(byName.get(n))]
      : [roleButton(byName.get(n)), element('span', 'state', '담당 꺼짐')]) : [row.status === '해당 없음' ? '해당 없음' : '담당 없음']
    const show = target => {
      const {role:name, source, path} = target
      this.selected = target
      docs.replaceChildren()
      heading.removeAttribute('data-team')
      heading.removeAttribute('aria-label')
      this.dialog.style.removeProperty('--tone')
      if (this.history.length) docs.append(action('← 이전', () => show(this.history.pop())))
      if (name && byName.has(name)) details(byName.get(name), source)
      else if (path) {
        heading.textContent = path
        docs.append(element('pre', '', data.files[path] ?? '현재 프로젝트에 문서 파일이 없습니다.'))
      } else {
        heading.textContent = '공통 기준 문서'
        for (const doc of data.common) {
          const block = element('article', 'document-entry')
          block.append(element('h4','',doc.title), doc.locationOnly ? element('code','path-chip',doc.path) : pathButton(doc.path))
          if (data.files[doc.path] == null || doc.status === '해당 없음')
            block.append(element('span','type-chip', doc.status === '해당 없음' ? '해당 없음' : doc.locationOnly ? '정본 경로 미지정' : '파일 없음'))
          const scopes = data.ownership.filter(row => row.path === doc.path)
          for (const row of scopes) {
            const line = element('p','scope')
            line.append(row.scope + ' · ', ...writers(row))
            block.append(line)
          }
          if (!scopes.length) block.append(element('p','scope',doc.status === '해당 없음' ? '해당 없음' : '담당 없음'))
          docs.append(block)
        }
        if (!data.common.length) docs.append(element('p','empty','설치된 공통 문서 경로표가 없습니다.'))
      }
      if (!this.dialog.open) this.dialog.showModal()
      this.dialog.scrollTop = 0
      this.dialog.querySelector('form button').focus()
    }
    const details = (role, source) => {
      this.dialog.style.setProperty('--tone', tone.get(role))
      this.dialog.querySelector('h3').textContent = role.name
      const group = teamOf.get(role)
      heading.dataset.team = role.unit || teamLabel(group.name)
      heading.setAttribute('aria-label', role.name)
      const doc = role.docs.find(d => d.rel === source)
      if (doc) {
        docs.append(element('h4', '', doc.rel), element('pre', '', doc.body))
      } else {
        docs.append(element('p', 'intro', role.description))
        const grid = element('div', 'summary-grid')
        const sections = outlines.get(role).sections
        const owned = data.ownership.filter(row => row.writers.includes(role.name))
        const blocks = [...sections].filter(([label]) => !['문서 책임','직접 협업'].includes(label))
        blocks.push(['작성할 라이브 문서 · 절', owned.map(row => row.path + ' · ' + row.scope)],
          ['검토할 문서', data.ownership.filter(r => r.reviewers.includes(role.name)).map(r => r.path + ' · ' + r.scope)],
          ['확인할 문서', data.ownership.filter(r => r.checks.includes(role.name)).map(r => r.path + ' · ' + r.scope)],
          ['주요 검토자', [...new Set(owned.flatMap(r => r.reviewers))].map(n => roleButton(byName.get(n)))],
          ['직접 협업 상대', relations.filter(r => r.pair.includes(role)).map(r => {
            const item = element('span','')
            item.append(roleButton(r.pair.find(p => p !== role)), ' ' + [r.topic, r.purposes.join(' '), limitText(r)].filter(Boolean).join(' · '))
            return item
          })], ['담당 스킬', skillNames(role)], ['참조 문서 경로', sections.has('읽는 입력') ? [] : role.references],
          ['모델 · effort', role.assignments.map(a => a.unit + ' · ' + a.runtime + ' · ' + (a.model || '미정') + ' / ' + (a.effort || '—'))])
        for (const [label, items] of blocks) {
          if (!items.length) continue
          const block = element('article', 'block')
          const skills = label === '담당 스킬'
          const list = element(skills ? 'div' : 'ul', skills ? 'skill-tags' : '')
          for (const item of items) {
            const entry = element(skills ? 'span' : 'li', skills ? 'skill-tag' : '')
            entry.append(item)
            list.append(entry)
          }
          block.dataset.label = label
          block.append(element('h4', '', label === '핵심 역할' ? '핵심 책임' : label), list)
          grid.append(block)
        }
        docs.append(grid)
        const buttons = element('div', 'sources')
        for (const d of role.docs) buttons.append(action(d.engine + ' 원문 보기 · ' + d.state.toUpperCase(), async () => {
          const res = await fetch('/open?' + new URLSearchParams({rel:d.rel}), {method:'POST', headers:{'x-agent-toggle':document.querySelector('meta[name=agent-toggle-token]')?.content ?? ''}})
          if (!res.ok) alert(await res.text())
        }))
        docs.append(buttons)
      }
    }
    const card = role => {
      const button = element('button', 'node')
      button.type = 'button'
      button.setAttribute('aria-haspopup', 'dialog')
      button.style.setProperty('--tone', tone.get(role))
      if (role.state !== 'on') {
        button.classList.add('inactive')
        button.append(element('b','state',role.state === 'off' ? '배정 대기' : '정의 충돌'))
      }
      const title = outlines.get(role).title
      button.append(element('strong', '', role.name), element('small', 'job-title', title),
        element('span', 'summary', role.description))
      const tags = element('span', 'role-tags')
      const tasks = role.tasks?.length ? role.tasks : [title]
      for (const task of new Set(tasks)) tags.append(element('i', '', task))
      const skills = element('span', 'skill-tags')
      for (const name of skillNames(role)) skills.append(element('span', 'skill-tag', name))
      if (skills.childElementCount) button.append(skills)
      const footer = element('span', 'card-footer')
      const configs = element('span', 'configs')
      const primary = role.assignments?.[0]
      const model = primary?.model || '?'
      const effort = primary ? primary.effort || '—' : '?'
      const cnf = element('span', 'config-pair')
      cnf.title = (primary?.unit || '정의 없음') + ' · model ' + model + ' / effort ' + effort
      cnf.setAttribute('aria-label', cnf.title)
      cnf.append(element('i', '', '◇ ' + model.charAt(0).toUpperCase()), element('i', '', '⚡' + effort.charAt(0).toUpperCase()))
      configs.append(cnf)
      footer.append(tags, configs)
      button.append(footer)
      button.onclick = () => navigate({role:role.name})
      return button
    }
    const active = this.shadowRoot.activeElement?.closest('.node')?.querySelector('strong')?.textContent
    const canvas = element('div', 'canvas')
    const branches = element('div', 'branches')
    const flowNames = ['작업 배정 · 보고', '직접 협의 · 설정 전달']
    const flowLine = (from, peers, index) => {
      const line = element('div', 'flow-line')
      line.append(from)
      if (peers.length) {
        const connector = element('i', 'connector kind-' + index, index ? '↔' : '')
        connector.setAttribute('aria-label', flowNames[index])
        line.append(connector, ...peers.map(roleButton))
      }
      return line
    }
    for (const role of lineup) {
      const branch = element('div', 'branch')
      if (role.waiting) branch.classList.add('waiting')
      branch.append(card(role))
      branches.append(branch)
    }
    const links = element('details', 'team-flows')
    links.append(element('summary', '', '업무 관계 보기'), element('h4', '', flowNames[0]))
    const pm = lineup.find(r => r.name === 'product-manager' && !r.waiting)
    const assigned = lineup.filter(r => r !== pm && !r.waiting)
    if (pm) links.append(flowLine(element('span', 'type-chip', '창구'), [pm], 0))
    if (assigned.length) links.append(flowLine(element('span', 'type-chip', '코디네이터'), assigned, 0))
    links.append(element('h4', '', flowNames[1]))
    for (const r of relations)
      if (r.pair.every(p => p.state === 'on'))
        links.append(flowLine(roleButton(r.pair[0]), [r.pair[1]], 1), element('p','',[r.topic, limitText(r)].filter(Boolean).join(' · ')))
    for (const heading of links.querySelectorAll('h4')) {
      if (!heading.nextElementSibling?.classList.contains('flow-line')) heading.after(element('p', 'empty', '명시된 역할 관계 없음'))
    }
    if (all.length && this.view === 1) {
      const content = element('div', 'collaboration-list')
      for (const r of relations) {
        const {pair:[a,b], topic, purposes} = r
        if (a.state !== 'on' || b.state !== 'on') continue
        const row = element('article', 'collaboration-row')
        const body = element('div', '')
        body.append(flowLine(roleButton(a),[b],1), element('p','',purposes.join(' ')))
        if (r.limits.length) body.append(element('p','',limitText(r)))
        row.append(element('h3','',topic), body)
        content.append(row)
      }
      if (!content.childElementCount) content.append(element('p','empty','활성 역할 사이에 명시된 직접 협업이 없습니다.'))
      this.chart.replaceChildren(content)
    } else if (this.view === 2) {
      const table = element('table', 'matrix')
      const header = table.createTHead().insertRow()
      for (const title of ['문서 · 범위', '담당 에이전트', '주요 검토자']) header.append(element('th', '', title))
      const rows = table.createTBody()
      for (const entry of data.ownership) {
        const row = rows.insertRow()
        const scope = row.insertCell()
        scope.append(pathButton(entry.path), element('p','scope',entry.scope))
        if (entry.checks.length) {
          const check = element('p','scope','확인 ')
          check.append(...entry.checks.map(n => roleButton(byName.get(n))))
          scope.append(check)
        }
        row.insertCell().append(...writers(entry))
        const reviewers = row.insertCell()
        for (const name of entry.reviewers) reviewers.append(roleButton(byName.get(name)))
        if (!reviewers.childElementCount) reviewers.textContent = '—'
      }
      const intro = element('p', 'intro', '모든 에이전트가 docs-management로 자기 문서를 쓴다. 전체 정합성은 doc-steward가 확인한다.')
      this.chart.replaceChildren(...rows.rows.length ? [intro, table] : [element('p', 'empty', '역할 정의에 명시된 ' + views[this.view] + ' 항목이 없습니다.')])
    } else if (this.view === 0 && data.notice) {
      this.chart.replaceChildren(element('p', 'empty', data.notice))
    } else if (this.view === 0 && (all.length || data.workflow || data.common.length || data.modelSelection)) {
      const legend = element('div', 'flow-legend')
      flowNames.forEach((name, i) => {
        const label = element('span', '')
        label.append(element('i', 'connector kind-' + i), name)
        legend.append(label)
      })
      if (data.workflow) canvas.classList.add('with-workflow')
      if (data.workflow) canvas.append(workflowDiagram(data, lineup, () => navigate({common:true})))
      else {
        if (data.common.length) legend.append(action('docs/ · 공통 기준 문서', () => navigate({common:true})))
        if (data.modelSelection) legend.append(action('모델 선택 표', () => window.open('/model-selection', '_blank', 'noopener')))
        if (lineup.length) canvas.append(element('div', 'root', data.project))
      }
      if (lineup.length) canvas.append(branches)
      this.chart.replaceChildren(legend, canvas)
      if (lineup.length) this.chart.append(links)
      for (const g of data.groups.filter(g => !g.roster)) {
        const section = element('section', 'independent-roles')
        section.append(element('h3', '', teamLabel(g.name)))
        for (const role of g.members) section.append(card(role))
        this.chart.append(section)
      }
    }
    else this.chart.replaceChildren(element('p', 'empty', '활성 Claude Code 에이전트가 없습니다.'))
    this.shadowRoot.querySelector('#project').textContent = data.project
    if (this.dialog.open) {
      if (this.selected?.role && !byName.has(this.selected.role)) this.dialog.close()
      else if (this.selected) {
        const top = this.dialog.scrollTop
        const focused = this.shadowRoot.activeElement?.textContent
        show(this.selected)
        Array.from(this.dialog.querySelectorAll('button')).find(b => b.textContent === focused)?.focus({preventScroll:true})
        this.dialog.scrollTop = top
      }
    } else if (active) {
      Array.from(this.chart.querySelectorAll('.node')).find(n => n.querySelector('strong').textContent === active)?.focus({preventScroll:true})
    }
  }
}
customElements.define('team-chart', TeamChart)
