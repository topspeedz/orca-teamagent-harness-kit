import { kitPlan, conflict, installKit, removeKit, definitionFile, offSuffix } from './kit.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const stat = p => fs.lstatSync(p, { throwIfNoEntry: false })
function directory(p) {
  if (stat(p) && !stat(p).isDirectory()) throw Error('일반 폴더가 아닙니다: ' + p)
}

function snapshot(base, name, ext = '.md', folder = name, includeReferences = false, kit = false) {
  const entries = []
  function visit(rel, p = path.join(base, rel)) {
    const s = stat(p)
    if (s.isFile()) entries.push([rel, createHash('sha256').update(fs.readFileSync(p)).digest('hex')])
    else if (s.isDirectory()) {
      entries.push([rel, null])
      for (const child of fs.readdirSync(p).sort()) visit(path.join(rel, child))
    } else throw Error('링크 또는 특수 파일: ' + p)
  }
  const active = path.join(base, name + ext)
  const definition = includeReferences ? definitionFile(active) : active
  if (stat(definition)) visit(name + ext, definition)
  if (!['reference', 'references'].includes(folder) && stat(path.join(base, folder))) visit(folder)
  if (kit && stat(path.join(base, '..', name))) visit(path.join('..', name))
  if (includeReferences) {
    for (const parent of ['reference', 'references']) {
      directory(path.join(base, parent))
      const reference = path.join(parent, name)
      if (stat(path.join(base, reference))) visit(reference)
    }
  }
  return JSON.stringify(entries)
}

function referencePaths(body, name, references, agentsPath) {
  for (const file of references) {
    const relative = file.slice(file.indexOf('/') + 1)
    const target = agentsPath + '/references/' + file
    body = body.replaceAll('references/' + file, (match, offset) =>
      body[offset - 1] === '/' ? match : target)
    for (const original of ['references/' + relative, 'docs/ai/' + file,
      '.claude/agents/' + file, '.codex/agents/' + file]) {
      body = body.replaceAll(original, () => target)
    }
  }
  if (references.length) body += '\n\n프로젝트 루트 기준 참조 자료 폴더: ' + agentsPath + '/references/' + name + '/\n'
  return body
}

function codexAgent(markdown, name, references) {
  const header = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  const metadata = header?.[1] ?? ''
  const agentName = metadata.match(/^name:[ \t]*(.+)$/m)?.[1].trim() ?? name
  const description = metadata.match(/^description:[ \t]*(.*(?:\r?\n[ \t]+[^\r\n]*)*)/m)?.[1]
    .replace(/^[>|][+-]?[ \t]*(?:\r?\n|$)/, '').replace(/\s+/g, ' ').trim() || name
  const body = referencePaths(markdown.slice(header?.[0].length ?? 0), name, references, '.codex/agents')
  return Object.entries({ name: agentName, description, developer_instructions: body })
    .map(([key, value]) => key + ' = ' + JSON.stringify(value).replaceAll('\x7f', '\\u007f') + '\n').join('')
}

export function manager(source, project) {
  const config = path.join(project, '.claude')
  const dest = path.join(config, 'agents')
  const codexConfig = path.join(project, '.codex')
  const codex = path.join(codexConfig, 'agents')
  const receipts = path.join(config, 'agent-toggle')
  const engines = [[dest, '.md', 'Claude Code'], [codex, '.toml', 'Codex']]
  function names(folder, ext) {
    directory(folder)
    return stat(folder) ? fs.readdirSync(folder, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(ext)).map(e => e.name.slice(0, -ext.length))
      .filter(n => n && n !== '.' && n !== '..' && !n.endsWith('.')) : []
  }
  function readRecord(name) {
    const p = path.join(receipts, name + '.json')
    if (!stat(p)?.isFile()) throw Error('설치 기록이 일반 파일이 아닙니다.')
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }
  function list() {
    directory(config)
    directory(dest)
    directory(codexConfig)
    directory(codex)
    directory(path.join(dest, 'reference'))
    directory(path.join(codex, 'reference'))
    directory(path.join(dest, 'references'))
    directory(path.join(codex, 'references'))
    directory(source)
    const records = new Map(names(receipts, '.json').map(name => [name, readRecord(name)]))
    const rows = []
    for (const entry of stat(source) ? fs.readdirSync(source, { withFileTypes: true }) : []) {
      if (!entry.isDirectory() || !entry.name.endsWith('kit')) continue
      const name = entry.name
      const record = records.get(name)
      try {
        if (record?.version === 2) {
          rows.push({ name, state: 'on', agents: record.agents })
        } else {
          const plan = kitPlan(path.join(source, name), name, codexAgent)
          const old = plan.agents.length === 1 && records.get(plan.agents[0])?.kit === true
          const reason = old ? undefined : conflict(project, plan)
          rows.push({ name, state: old ? 'on' : reason ? 'conflict' : 'off',
            agents: plan.agents, old: old ? plan.agents[0] : undefined, reason })
          if (old) records.delete(plan.agents[0])
        }
        records.delete(name)
      } catch (err) {
        rows.push({ name, state: 'conflict', reason: err.message })
      }
    }
    const installed = [...records.keys()]
    const flat = [...new Set([...names(source, '.md'), ...installed])].filter(name => !rows.some(r => r.name === name)).map(name => {
      const codexOccupied = stat(path.join(codex, name)) || stat(path.join(codex, name + '.toml'))
      if (installed.includes(name)) {
        const record = records.get(name)
        return { name, state: Array.isArray(record) ? 'legacy' : 'on', agents: record.agents }
      }
      const occupied = engines.some(([dir, ext]) => stat(path.join(dir, name + ext + offSuffix))) ||
        stat(path.join(dest, name)) || stat(path.join(dest, name + '.md')) || codexOccupied ||
        stat(path.join(dest, 'reference', name)) || stat(path.join(codex, 'reference', name)) ||
        stat(path.join(dest, 'references', name)) || stat(path.join(codex, 'references', name))
      return { name, state: occupied ? 'conflict' : 'off' }
    })
    return rows.concat(flat).sort((a, b) => a.name.localeCompare(b.name))
  }
  function set(name, on) {
    const row = list().find(r => r.name === name)
    if (!row || row.state === 'conflict') throw Error(row?.reason ?? '대상이 없거나 기존 프로젝트 파일과 충돌합니다.')
    if (row.state === (on ? 'on' : 'off')) return
    name = row.old ?? name
    const receipt = path.join(receipts, name + '.json')
    if (row.state !== 'off' && !stat(receipt)?.isFile()) throw Error('설치 기록이 일반 파일이 아닙니다.')
    const previous = row.state === 'off' ? null : JSON.parse(fs.readFileSync(receipt, 'utf8'))
    if (previous?.version === 2) return removeKit(project, previous, receipt)
    if (on && row.agents && !previous) {
      const plan = kitPlan(path.join(source, name), name, codexAgent)
      const reason = conflict(project, plan)
      if (reason) throw Error(reason)
      fs.mkdirSync(receipts, { recursive: true })
      return installKit(project, plan, receipt)
    }
    const claudeData = snapshot(dest, name, '.md', name, true, previous?.kit === true)
    const codexData = snapshot(codex, name, '.toml', name, true)
    if (previous && (JSON.stringify(previous.claude ?? previous) !== claudeData ||
        (previous.codex && JSON.stringify(previous.codex) !== codexData))) {
      throw Error('프로젝트 복사본이 변경되어 보존했습니다.')
    }
    if (on) {
      if (codexData !== '[]') throw Error('기존 Codex 프로젝트 파일과 충돌합니다.')
      // The VFX agent's reference folder predates its current filename.
      directory(path.join(source, 'reference'))
      directory(path.join(source, 'references'))
      const canonical = path.join('references', name)
      const legacy = path.join('reference', name)
      const folder = stat(path.join(source, canonical)) ? canonical :
        stat(path.join(source, legacy)) ? legacy :
        name === 'unity-vfx-expert' && !stat(path.join(source, name)) &&
        stat(path.join(source, 'unity-vfx-agent')) ? 'unity-vfx-agent' : name
      directory(path.join(source, folder))
      const references = JSON.parse(snapshot(source, name, '.md', folder))
        .filter(([rel]) => rel !== name + '.md')
      const targetReference = rel => path.join(name, path.relative(folder, rel))
      const files = references.filter(([, hash]) => hash !== null)
        .map(([rel]) => targetReference(rel).split(path.sep).join('/'))
      const definitionBytes = fs.readFileSync(path.join(source, name + '.md'))
      const markdown = definitionBytes.toString('utf8')
      const toml = codexAgent(markdown, name, files)
      fs.mkdirSync(dest, { recursive: true })
      fs.mkdirSync(codex, { recursive: true })
      fs.mkdirSync(receipts, { recursive: true })
      const created = []
      try {
        for (const base of previous ? [codex] : [dest, codex]) {
          if (references.length) fs.mkdirSync(path.join(base, 'references'), { recursive: true })
          for (const [rel, hash] of references) {
            const target = path.join(base, 'references', targetReference(rel))
            if (hash === null) fs.mkdirSync(target)
            else fs.copyFileSync(path.join(source, rel), target, fs.constants.COPYFILE_EXCL)
            created.push([target, hash])
          }
        }
        if (!previous) {
          const definition = path.join(dest, name + '.md')
          fs.writeFileSync(definition, referencePaths(markdown, name, files, '.claude/agents'), { flag: 'wx' })
          created.push([definition, true])
        }
        const definition = path.join(codex, name + '.toml')
        fs.writeFileSync(definition, toml, { flag: 'wx' })
        created.push([definition, true])
        const record = JSON.stringify({
          claude: JSON.parse(snapshot(dest, name, '.md', name, true)),
          codex: JSON.parse(snapshot(codex, name, '.toml', name, true)),
        })
        if (previous) {
          const pending = receipt + '.tmp'
          fs.writeFileSync(pending, record, { flag: 'wx' })
          created.push([pending, true])
          fs.renameSync(pending, receipt)
        } else fs.writeFileSync(receipt, record, { flag: 'wx' })
      } catch (error) {
        for (const [p, hash] of created.reverse()) hash === null ? fs.rmdirSync(p) : fs.unlinkSync(p)
        throw error
      }
    } else {
      for (const [base, entries] of [[dest, JSON.parse(claudeData)], [codex, previous.codex ?? []]]) {
        for (const [rel, hash] of entries.reverse()) {
          const active = path.join(base, rel)
          const p = rel === name + (base === dest ? '.md' : '.toml') ? definitionFile(active) : active
          if (hash === null) fs.rmdirSync(p)
          else fs.unlinkSync(p)
        }
      }
      fs.unlinkSync(receipt)
    }
  }
  function inventory() {
    const installed = new Map(list().filter(row => ['on', 'legacy'].includes(row.state))
      .flatMap(row => (row.agents ?? [row.name]).map(name => [name, row.state])))
    return engines.flatMap(([folder, ext, engine]) => {
      const roles = new Set([...names(folder, ext), ...names(folder, ext + offSuffix)])
      return [...roles].map(name => {
        const active = path.join(folder, name + ext)
        const saved = stat(active + offSuffix)
        const state = saved && stat(active) ? 'conflict' : saved ? 'off' : 'on'
        const copied = ext === '.md' ? installed.has(name) : installed.get(name) === 'on'
        return { name, engine, scope: copied ? 'copied' : 'project', state }
      })
    })
  }
  function setProject(name, engine, on) {
    const role = inventory().find(r => r.name === name && r.engine === engine)
    if (!role || role.state === 'conflict') throw Error('대상이 없거나 활성 파일과 보관 파일이 충돌합니다.')
    if (role.state === (on ? 'on' : 'off')) return
    const [folder, ext] = engines.find(([, , label]) => label === engine)
    const active = path.join(folder, name + ext)
    const saved = active + offSuffix
    const from = on ? saved : active
    const to = on ? active : saved
    fs.linkSync(from, to)
    fs.unlinkSync(from)
  }
  return { list, set, inventory, setProject }
}
