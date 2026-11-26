import fs from 'node:fs'
import path from 'node:path'
import { offSuffix } from './kit.mjs'

const codes = text => [...text.matchAll(/`([\w.-]+)`/g)].map(match => match[1])

// Read only regular project files, including when a directory is replaced by a link.
export function regular(root, rel, directory = false) {
  let current = root
  const parts = rel.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\:\0]/.test(p) || /[ .]$/.test(p))) return
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part)
    const st = fs.lstatSync(current, { throwIfNoEntry: false })
    if (!st || (i === parts.length - 1 && !directory ? !st.isFile() : !st.isDirectory())) return
  }
  return current
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const clean = value => value.replaceAll('`', '').trim()

function table(text, section, header) {
  const rows = []
  let inSection = false, inTable = false, fence = '', width = 0
  const want = header.split('|')
  for (const line of text.split(/\r?\n/)) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)?.[1]
    if (marker) { if (!fence) fence = marker; else if (marker.startsWith(fence)) fence = ''; continue }
    if (fence) continue
    if (/^#{1,2} /.test(line)) { inSection = line.trim() === '## ' + section; inTable = false; continue }
    if (!inSection || !line.trim().startsWith('|')) { inTable = false; continue }
    const row = cells(line)
    // Match the leading columns only, so tables with extra trailing columns (e.g. 양식) still parse.
    if (want.every((h, i) => row[i] === h)) { inTable = true; width = row.length; continue }
    if (inTable && row.length === width && !row.every(c => /^:?-+:?$/.test(c))) rows.push(row)
  }
  return rows
}

function docPath(cell, markdownFile) {
  const link = cell.match(/^\[[^\]]*\]\(([^)]+)\)/) // a cell listing several links uses the first
  const target = clean(link?.[1] ?? cell).split('#')[0]
  if (!target) return
  if (target.startsWith('/') || /[\\:\0]/.test(target)) return target
  return path.posix.normalize(link ? path.posix.join(path.posix.dirname(markdownFile), target) : target)
}

function documentData(project, roles) {
  const read = rel => {
    const file = regular(project, rel)
    return file ? fs.readFileSync(file, 'utf8') : null
  }
  const indexPath = 'docs/DOCUMENTATION_INDEX.md'
  const index = read(indexPath) ?? ''
  const entries = table(index, '문서', '위치|담는 것|정본 문서|관련 ID|마지막으로 갱신한 phase|상태')
  const drafts = JSON.parse(read('docs/harness/templates/document-drafts.json') ?? '{}')
  const common = [], aliases = new Map()
  const responsibilityKeys = {작성:'writers', 검토:'reviewers', 확인:'checks'}
  for (const draft of Object.keys(drafts)) {
    const folder = path.posix.dirname(draft)
    const location = folder === 'docs' ? draft : folder + '/'
    const entry = entries.find(row => clean(row[0]) === location)
    const canonical = entry?.[2] && clean(entry[2]) !== '없음' ? docPath(entry[2], indexPath) : ''
    const rel = canonical || draft
    aliases.set(draft, rel)
    common.push({ path: rel, title: entry?.[1] || draft, status: clean(entry?.[5] ?? ''), draft: !canonical })
  }
  if (!common.length) for (const [location, title, canonical, , , status] of entries) {
    const rel = clean(canonical) && clean(canonical) !== '없음' ? docPath(canonical, indexPath) : clean(location)
    if (rel) common.push({path:rel, title, status:clean(status), locationOnly:rel.endsWith('/')})
  }
  const ownership = []
  function scopeRow(rel, scope) {
    const target = aliases.get(rel) ?? rel
    let row = ownership.find(r => r.path === target && r.scope === scope)
    if (!row) { row = { path: target, scope, writers: [], reviewers: [], checks: [] }; ownership.push(row) }
    return row
  }
  for (const role of roles.values()) {
    const body = role.docs[0].body
    role.collaboration = table(body, '직접 협업', '상대|협의 주제|목적').flatMap(([peer, topic, purpose]) => {
      const names = codes(peer)
      return (names.length ? names : [clean(peer)]).filter(n => roles.has(n) && n !== role.name && topic && purpose)
        .map(name => ({ peer: name, topic: clean(topic), purpose: clean(purpose) }))
    })
    if (!/^## 직접 협업\s*$/m.test(body)) {
      const legacy = body.split(/^#{1,2} /m).find(s => /^(협업|직접 협의)[ \t]*\r?\n/.test(s)) ?? ''
      for (const line of legacy.split(/\r?\n/)) {
        const purpose = clean(line.replace(/^\s*[-*]\s*/, ''))
        if (!/^\s*[-*]\s/.test(line) || /^(?:정본 소유|소유 문서|편집 범위|출력)\s*[:：]/.test(purpose)) continue
        for (const peer of new Set(purpose.match(/[\w.-]+/g) ?? []))
          if (peer !== role.name && roles.has(peer)) role.collaboration.push({peer, topic:'협업', purpose})
      }
    }
    for (const [doc, scope, responsibility] of table(body, '문서 책임', '문서|범위|책임')) {
      const key = Object.hasOwn(responsibilityKeys, clean(responsibility)) && responsibilityKeys[clean(responsibility)]
      const rel = docPath(doc, role.docs[0].rel)
      if (rel && key) {
        const row = scopeRow(rel, clean(scope))
        if (!row[key].includes(role.name)) row[key].push(role.name)
        // Kit 0.4.1 names reviewers inside the scope cell: "(검토 `planner`)".
        for (const name of codes(scope.match(/검토 ([^)]*)/)?.[1] ?? ''))
          if (roles.has(name) && !row.reviewers.includes(name)) row.reviewers.push(name)
      }
    }
    if (!/^## 문서 책임\s*$/m.test(body)) {
      for (const match of body.matchAll(/^\s*[-*]\s*(?:정본 소유|소유 문서|문서 소유권)\s*[:：]\s*(.+)$/gm)) {
        const paths = [...match[1].matchAll(/`([^`]+)`/g)].map(m => m[1])
        for (const rel of paths.length ? paths : [match[1].trim()]) {
          if (!/\.[\w-]+$/.test(rel)) continue
          const names = scopeRow(rel, '').writers
          if (!names.includes(role.name)) names.push(role.name)
        }
      }
    }
  }
  for (const [doc, scope, status] of table(index, '작성자 배정 대기', '문서|범위|배정 상태')) {
    const rel = docPath(doc, indexPath)
    if (rel && ['미배정', '해당 없음'].includes(clean(status))) scopeRow(rel, clean(scope)).status = clean(status)
  }
  const files = Object.fromEntries([...new Set([...common, ...ownership].map(row => row.path))]
    .map(rel => [rel, read(rel)]))
  return { common, ownership, files }
}

export function teamStructure(project) {
  const roles = new Map()
  function files(dir, ext = '') {
    const folder = regular(project, dir, true)
    return folder ? fs.readdirSync(folder, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(ext)).map(e => e.name) : []
  }
  for (const [dir, ext, engine] of [['.claude/agents', '.md', 'Claude Code'], ['.codex/agents', '.toml', 'Codex']]) {
    const entries = files(dir)
    for (const file of entries.filter(f => f.endsWith(ext) || f.endsWith(ext + offSuffix))) {
      const off = file.endsWith(offSuffix)
      const active = off ? file.slice(0, -offSuffix.length) : file
      if (off && entries.includes(active)) continue
      const state = off ? 'off' : entries.includes(active + offSuffix) ? 'conflict' : 'on'
      const name = active.slice(0, -ext.length)
      if (engine === 'Codex' && !roles.has(name)) continue
      const role = roles.get(name) ?? { name, description: '', skills: [], engines: [], docs: [] }
      const rel = dir + '/' + file
      const p = regular(project, rel)
      if (!p) continue
      const body = fs.readFileSync(p, 'utf8')
      const header = body.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
      if (ext === '.md') {
        role.state = state
        role.description = (header.match(/^description:[ \t]*(.*(?:\r?\n[ \t]+[^\r\n]*)*)/m)?.[1] ?? '')
          .replace(/^[>|][-+]?\s*/, '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ')
        const preload = header.match(/^skills:[ \t]*\r?\n((?:[ \t]+- [^\r\n]+(?:\r?\n|$))+)/m)?.[1]
        const inline = header.match(/^skills:[ \t]*\[([^\]]*)\]/m)?.[1]
        role.skills = [...new Set([...(preload?.trim().split(/\r?\n/).map(s => s.trim().slice(2).trim()) ?? []),
          ...(inline?.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) ?? []),
          ...codes(body.match(/로드할 스킬:[^\n]*/)?.[0] ?? '')])]
      }
      role.engines.push(engine)
      role.docs.push({ rel, body, engine, state })
      roles.set(name, role)
    }
  }
  for (const role of roles.values()) {
    const refs = new Set()
    const edits = new Set()
    function collect(body) {
      for (const line of body.split(/\r?\n/)) {
        const target = /편집 범위|쓰기 경로|^\s*-\s*출력:/.test(line) ? edits : refs
        for (const match of line.matchAll(/`([^`\n]+)`|\]\(([^)\n]+)\)|((?:\.claude|docs|_workspace)\/[\w./*-]+\.(?:md|json|yaml|toml))/g)) {
          const value = match[1] ?? match[2] ?? match[3]
          if (!/^(?!\w+:\/\/)[^`|]+(?:\/|\.(?:md|mdx|txt|pdf|json|ya?ml|toml))(?:#\S+)?$/i.test(value)) continue
          target.add(value)
        }
      }
    }
    const body = role.docs[0].body
    collect(body)
    for (const m of body.matchAll(/\.claude\/skills\/([\w.-]+)\/SKILL\.md/g)) refs.add(m[0])
    for (const skill of role.skills) {
      if (/^[\w-][\w.-]*$/.test(skill) && regular(project, '.claude/skills/' + skill + '/SKILL.md'))
        refs.add('.claude/skills/' + skill + '/SKILL.md')
    }
    for (const rel of [...refs]) {
      if (!/^\.claude\/skills\/[\w-][\w.-]*\/SKILL\.md$/.test(rel)) continue
      const file = regular(project, rel)
      if (file) collect(fs.readFileSync(file, 'utf8'))
    }
    role.references = [...refs]
    role.editPaths = [...edits]
  }
  const groups = []
  const assigned = new Set()
  function group(name, members, kind, lead, skill) {
    const nodes = [...new Set(members)].filter(n => roles.has(n) && !assigned.has(n))
    if (!nodes.length) return
    nodes.forEach(n => assigned.add(n))
    const waiting = kind === '실행팀' && roles.get(lead)?.state !== 'on'
    groups.push({ name, kind, isTeam: kind === '실행팀', waiting, lead, skill, members: nodes.map(n => roles.get(n)) })
  }
  const org = regular(project, 'docs/harness/team-org.md')
  const orgLines = org ? fs.readFileSync(org, 'utf8').split(/\r?\n/) : []
  for (const line of orgLines) {
    const [team, lead, members, skill, , category] = cells(line)
    if (!team || members === undefined || !line.trim().startsWith('|')) continue
    const leader = codes(lead)[0]
    const kind = ['운영팀','실행팀','직속'].includes(clean(category ?? '')) ? clean(category)
      : leader ? '실행팀' : /창구가 직접/.test(lead) ? '운영팀' : ''
    if (!codes(team).length && !kind) continue
    group(clean(team), [...codes(lead), ...codes(members)], kind, leader, codes(skill ?? '')[0])
  }
  for (const line of orgLines) {
    const direct = line.match(/^- `([\w.-]+)`[은는] 어느 팀에도 속하지 않는다\.\s*코디네이터가 띄운다\./)
    if (direct) group(direct[1], [direct[1]], '직속')
  }
  for (const file of files('.claude/agent-toggle', '.json')) {
    const record = JSON.parse(fs.readFileSync(regular(project, '.claude/agent-toggle/' + file), 'utf8'))
    const kit = file.slice(0, -5)
    if (record.version === 2 || record.kit === true) group(kit.replace(/-kit$/, ''), record.agents ?? [kit],
      kit === 'game-design-team-kit' ? '실행팀' : '', kit === 'game-design-team-kit' ? 'game-design-lead' : null)
  }
  group('프로젝트 에이전트', [...roles.keys()], '')
  const modelFile = regular(project, 'docs/harness/model-selection.md')
  const assignments = []
  if (modelFile) for (const line of fs.readFileSync(modelFile, 'utf8').split(/\r?\n/)) {
    const [, agent, unit, runtime, model, effort] = line.trim().split('|').map(cell => cell.trim().replaceAll('`', ''))
    if (agent && model && ['claude','codex'].includes(runtime)) assignments.push({ agent, unit, runtime, model, effort })
  }
  for (const { lead, members } of groups) for (const role of members) {
    const exact = assignments.filter(a => a.agent === role.name)
    role.tasks = exact.flatMap(a => a.unit.split(',').map(s => s.trim()))
    role.assignments = [...exact, ...assignments.filter(a => a.agent === '*' &&
      (a.unit === '기본' || (role.name === lead && a.unit === '리드')) && !role.tasks.includes(a.unit))]
    if (!role.assignments.length) {
      const source = role.docs[0].body.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
      const model = source.match(/^model\s*[:=]\s*["']?([^\s"'#]+)/m)?.[1]
      const effort = source.match(/^(?:model_reasoning_effort|effort)\s*[:=]\s*["']?([^\s"'#]+)/m)?.[1]
      if (model || effort) role.assignments.push({ unit:'역할 정의', runtime:'claude', model, effort })
    }
  }
  const workflow = regular(project, '.claude/skills/plan-orchestrate/SKILL.md') &&
    regular(project, '.claude/skills/coordinator/SKILL.md') ? {
      documents: Boolean(regular(project, 'docs/DOCUMENTATION_INDEX.md')),
      modelSelection: Boolean(modelFile)
    } : null
  return { project: path.basename(project), groups, workflow, modelSelection:Boolean(modelFile), ...documentData(project, roles) }
}
