new EventSource('/alive') // server exits when every page holding this is closed
const views = ['팀 구조도', '직접 협업', '문서 소유권']
const fontStylesheet = document.createElement('link')
fontStylesheet.rel = 'stylesheet'
fontStylesheet.href = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400&display=swap'
document.head.append(fontStylesheet)
const jobTitles = {
  'prd-writer':'제품 요구사항 작성자', 'product-manager':'제품 기획 담당자', planner:'설계·계획 담당자',
  'pm-reviewer':'기획 검토자', 'qa-inspector':'품질 검증 담당자', 'code-reviewer':'코드 리뷰어',
  'harness-engineer':'하네스 엔지니어', 'doc-steward':'제품 문서 관리자'
}
const teamLabel = name => name === '프로젝트 에이전트' ? 'PROJECT AGENTS' : name.toUpperCase()
const koreanTeamNames = {
  qa:'검증팀', harness:'하네스팀', operations:'운영팀',
  'game-design':'게임기획팀', 'game-design-team':'게임기획팀', 'game-designer-agent':'게임 기획팀',
  'ux-ui':'UX/UI 디자인팀', 'mobile-ui-designer-claude':'모바일 UI 디자인팀',
  '3d-art':'3D 아트팀', 'blender-copy-modeler':'블렌더 모델링팀',
  unity:'Unity 개발팀', 'unity-vfx-expert':'유니티 시각효과팀'
}
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

function workflowDiagram(data, teams, planning, direct, openDocs, openRole) {
  const width = Math.max(1456, teams.length * 364)
  const rail = 344 + direct.length * 78
  const height = rail + 26
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', width)
  svg.setAttribute('height', height)
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', '사용자부터 실행 팀까지의 업무 흐름')
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
  const desk = width * .50, pm = width * .10, planner = width * .32
  const dag = width * .50, exec = width * .69, settings = width * .91
  const directRoles = new Set(planning.filter(r => r.state === 'on').map(r => r.name))
  const hasPM = directRoles.has('product-manager'), hasPlanner = directRoles.has('planner')
  function deskLine(d, role) {
    const path = line(d)
    path.dataset.from = '창구'
    path.dataset.role = role
  }

  line(`M${desk} 44 V74 M${desk} 142 V173 H${exec} V228`)
  label((desk + exec) / 2, 165, '계획 승인 후 실행 요청')
  if (hasPlanner) {
    deskLine(`M${desk} 173 H${planner} V228`, 'planner')
    label((desk + planner) / 2, 165, '설계 · 계획 요청')
    line(`M${planner + 95} 262 H${dag - 80}`)
    label((planner + 95 + dag - 80) / 2, 252, '작성 →')
  }
  if (hasPM) deskLine(`M${desk} 173 H${pm} V228`, 'product-manager')
  for (const [role, x, detail] of [['prd-writer', width * .23, '요구사항 작성'], ['pm-reviewer', width * .36, '기획 검토 · 계획 대조']]) {
    if (!directRoles.has(role)) continue
    deskLine(`M${desk - 113} 108 H${x} V68`, role)
    box(x, 0, 146, role, detail)
  }
  if (hasPM && hasPlanner) {
    line(`M${pm + 105} 262 H${planner - 95}`, true)
    label((pm + 105 + planner - 95) / 2, 252, '동료 · 업무 인계')
  }
  line(`M${dag + 80} 262 H${exec - 104}`)
  label((dag + 80 + exec - 104) / 2, 252, '승인본 전달 →')
  if (data.workflow.modelSelection) {
    line(`M${settings - 110} 262 H${exec + 104}`, true)
    label((settings - 110 + exec + 104) / 2, 252, '← 실행 설정')
    box(settings, 228, 220, '모델 선택 표', '에이전트별 model · effort', () => window.open('/model-selection', '_blank', 'noopener'))
  }
  for (const [i, role] of direct.entries()) {
    const y = 318 + i * 78
    if (role.state === 'on') {
      const route = line(`M${exec + 74} 296 V${y + 34} H${settings - 110}`)
      route.dataset.from = '코디네이터'
      route.dataset.role = role.name
    }
    box(settings, y, 220, role.name, '코디네이터 직속' + (role.state === 'on' ? '' : ' · OFF'), () => openRole(role))
  }
  const slot = width / Math.max(1, teams.length)
  const execution = teams.map((g, i) => ({ g, x: slot * (i + .5) })).filter(({g}) => !g.waiting)
  if (execution.length) {
    line(`M${exec} 296 V${rail} M${Math.min(exec, execution[0].x)} ${rail} H${Math.max(exec, execution.at(-1).x)}`)
    label(exec, rail - 9, '팀장 또는 워커 배정 · 결과 보고')
    for (const { g, x } of execution) {
      const path = line(`M${x} ${rail} V${height}`)
      path.dataset.from = '코디네이터'
      path.dataset.team = g.name
    }
  }
  box(desk, 0, 186, '사용자')
  box(desk, 74, 226, '창구 세션', '요청 정리 · 승인 · 최종 보고')
  if (data.workflow.documents || data.common.length) box(pm, 74, 242, 'docs/ · 공통 기준 문서', '문서 색인 · 지정 작성자', openDocs)
  if (hasPM) box(pm, 228, 210, 'Product Manager', '범위 · 우선순위 · 백로그', () => openRole(planning.find(r => r.name === 'product-manager')))
  if (hasPlanner) box(planner, 228, 190, 'Planner', '설계서 · 실행 계획 작성', () => openRole(planning.find(r => r.name === 'planner')))
  box(dag, 228, 160, 'DAG 계획서', '의존성 · 산출물 · 배정')
  box(exec, 228, 208, '코디네이터', '워커 기동 · 검증 · 보고 취합')
  return svg
}

class TeamChart extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/team.css"><section>
      <header><h2>Claude Code 팀 구조도</h2><span id="project"></span></header>
      <nav role="tablist" aria-label="팀 보기"></nav>
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
    const teams = data.groups.filter(g => g.kind === '실행팀')
    const planning = data.groups.filter(g => g.kind === '운영팀').flatMap(g => g.members)
    const direct = data.groups.filter(g => g.kind === '직속').flatMap(g => g.members)
    const outlines = new Map(all.map(role => [role, outline(role)]))
    const byName = new Map(all.map(r => [r.name, r]))
    const teamOf = new Map(data.groups.flatMap(g => g.members.map(r => [r, g])))
    const tones = ['#98bfe3','#deb781','#9bcaa7','#bba7de','#dfa6ae','#86cec7']
    const teamTone = new Map(data.groups.map((g,i) => [g, tones[i] ?? `hsl(${(i * 137.508) % 360} 65% 72%)`]))
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
    for (const role of all) for (const {peer, topic, purpose} of role.collaboration) {
      const other = byName.get(peer)
      if (!other) continue
      const existing = relations.find(r => r.topic === topic && r.pair.includes(role) && r.pair.includes(other))
      if (!existing) relations.push({pair:[role, other], topic, purposes:[purpose]})
      else if (!existing.purposes.includes(purpose)) existing.purposes.push(purpose)
    }
    const navigate = target => {
      if (this.dialog.open && this.selected) this.history.push(this.selected)
      show(target)
    }
    const docs = this.dialog.querySelector('#docs')
    const heading = this.dialog.querySelector('h3')
    const roleButton = role => {
      const b = action(role.name, () => navigate({role:role.name}))
      b.classList.add('chip')
      b.style.setProperty('--tone', teamTone.get(teamOf.get(role)))
      b.setAttribute('aria-haspopup', 'dialog')
      return b
    }
    const pathButton = rel => {
      const b = action(rel, () => navigate({path:rel}))
      b.classList.add('path-chip')
      return b
    }
    const writers = row => row.writers.length ? row.writers.map(n => roleButton(byName.get(n))) : [row.status || '미배정']
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
          if (!scopes.length) block.append(element('p','scope',doc.status === '해당 없음' ? '해당 없음' : '미배정'))
          docs.append(block)
        }
        if (!data.common.length) docs.append(element('p','empty','설치된 공통 문서 경로표가 없습니다.'))
      }
      if (!this.dialog.open) this.dialog.showModal()
      this.dialog.scrollTop = 0
      this.dialog.querySelector('form button').focus()
    }
    const details = (role, source) => {
      this.dialog.style.setProperty('--tone', teamTone.get(teamOf.get(role)))
      this.dialog.querySelector('h3').textContent = role.name
      const group = teamOf.get(role)
      heading.dataset.team = [teamLabel(group.name), group.kind].filter(Boolean).join(' · ')
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
            item.append(roleButton(r.pair.find(p => p !== role)), ' ' + r.topic + ' · ' + r.purposes.join(' '))
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
    const card = (role, lead) => {
      const button = element('button', 'node' + (lead ? ' lead' : ''))
      button.type = 'button'
      button.setAttribute('aria-haspopup', 'dialog')
      if (lead) button.append(element('b', 'ribbon', '팀장'))
      if (role.state !== 'on') {
        button.classList.add('inactive')
        button.append(element('b','state',role.state === 'off' ? 'OFF' : '정의 충돌'))
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
    const flowLine = (role, peers, index) => {
      const line = element('div', 'flow-line')
      line.append(roleButton(role))
      if (peers.length) {
        const connector = element('i', 'connector kind-' + index, index ? '↔' : '')
        connector.setAttribute('aria-label', flowNames[index])
        line.append(connector, ...peers.map(roleButton))
      }
      return line
    }
    for (const g of teams) {
      const branch = element('div', 'branch')
      if (g.waiting) branch.classList.add('waiting')
      const panel = element('section', 'group')
      panel.style.setProperty('--tone', teamTone.get(g))
      const heading = element('div', 'team-heading')
      heading.append(element('h3', '', teamLabel(g.name)))
      const koreanName = koreanTeamNames[g.name] ?? (/[가-힣]/.test(g.name) ? g.name : '')
      if (koreanName) heading.append(element('small', '', koreanName))
      panel.append(heading)
      if (g.waiting) panel.append(element('strong','state','팀 배정 대기'))
      const lead = g.members.find(r => r.name === g.lead)
      if (lead) panel.append(card(lead, true))
      const members = element('div', 'members')
      for (const role of g.members.filter(r => r !== lead)) {
        const slot = element('div', lead && !g.waiting && role.state === 'on' ? 'reports' : '')
        slot.append(card(role, false))
        members.append(slot)
      }
      if (members.childElementCount) panel.append(members)
      const links = element('details', 'team-flows')
      links.append(element('summary', '', '업무 관계 보기'))
      links.append(element('h4', '', flowNames[0]))
      if (lead && !g.waiting) {
        const active = g.members.filter(r => r !== lead && r.state === 'on')
        if (active.length) links.append(flowLine(lead, active, 0),
          element('p','','단순 Task 하나는 코디네이터가 팀원에게 직접 배정할 수 있습니다.'))
        const planner = planning.find(r => r.name === 'planner' && r.state === 'on')
        if (planner && data.workflow) links.append(flowLine(lead, [planner], 0),
          element('p','','복잡한 내부 분해 시 팀장이 Planner에게 임시 배정'))
      }
      links.append(element('h4', '', flowNames[1]))
      for (const {pair:[a,b], topic} of relations)
        if ((g.members.includes(a) || g.members.includes(b)) && a.state === 'on' && b.state === 'on')
          links.append(flowLine(a, [b], 1), element('p','',topic))
      for (const heading of links.querySelectorAll('h4')) {
        if (!heading.nextElementSibling?.classList.contains('flow-line')) heading.after(element('p', 'empty', '명시된 역할 관계 없음'))
      }
      panel.append(links)
      branch.append(panel)
      branches.append(branch)
    }
    if (all.length && this.view === 1) {
      const content = element('div', 'collaboration-list')
      for (const {pair:[a,b], topic, purposes} of relations) {
        if (a.state !== 'on' || b.state !== 'on') continue
        const row = element('article', 'collaboration-row')
        const body = element('div', '')
        body.append(flowLine(a,[b],1), element('p','',purposes.join(' ')))
        row.append(element('h3','',topic), body)
        content.append(row)
      }
      if (!content.childElementCount) content.append(element('p','empty','활성 역할 사이에 명시된 직접 협업이 없습니다.'))
      this.chart.replaceChildren(content)
    } else if (this.view === 2) {
      const table = element('table', 'matrix')
      const header = table.createTHead().insertRow()
      for (const title of ['문서 · 범위', '정본 작성자', '주요 검토자']) header.append(element('th', '', title))
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
      this.chart.replaceChildren(rows.rows.length ? table : element('p', 'empty', '역할 정의에 명시된 ' + views[this.view] + ' 항목이 없습니다.'))
    } else if (this.view === 0 && (all.length || data.workflow || data.common.length || data.modelSelection)) {
      const legend = element('div', 'flow-legend')
      flowNames.forEach((name, i) => {
        const label = element('span', '')
        label.append(element('i', 'connector kind-' + i), name)
        legend.append(label)
      })
      if (teams.some(g => g.lead)) legend.append(element('span', '', '리본 = 팀장'))
      if (data.workflow) canvas.classList.add('with-workflow')
      if (data.workflow) canvas.append(workflowDiagram(data, teams, planning, direct, () => navigate({common:true}), role => navigate({role:role.name})))
      else {
        if (data.common.length) legend.append(action('docs/ · 공통 기준 문서', () => navigate({common:true})))
        if (data.modelSelection) legend.append(action('모델 선택 표', () => window.open('/model-selection', '_blank', 'noopener')))
        if (teams.length) canvas.append(element('div', 'root', data.project))
      }
      if (teams.length) canvas.append(branches)
      this.chart.replaceChildren(legend, canvas)
      const independent = all.filter(role => !teams.includes(teamOf.get(role)) && !planning.includes(role) && !direct.includes(role))
      const operations = data.groups.filter(g => g.kind === '운영팀').map(g => [g.name + ' · 운영팀 · 팀장 없음', g.members])
      for (const [title, roles] of [...operations, ['코디네이터 직속',direct], ['독립 역할', independent]]) {
        if (!roles.length) continue
        const section = element('section', 'independent-roles')
        section.append(element('h3', '', title))
        for (const role of roles) {
          const button = card(role, false)
          button.style.setProperty('--tone',teamTone.get(teamOf.get(role)))
          section.append(button)
        }
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
