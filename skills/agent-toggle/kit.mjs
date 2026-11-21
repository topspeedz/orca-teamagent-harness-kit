import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const stat = p => fs.lstatSync(p, { throwIfNoEntry: false })
export const offSuffix = '.agent-toggle-off'
export function definitionFile(active) {
  if (!stat(active + offSuffix)) return active
  if (stat(active)) throw Error('활성 파일과 보관 파일이 모두 있습니다: ' + active)
  return active + offSuffix
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Check every parent before following a source, destination or receipt path.
function target(root, rel) {
  const parts = rel.split('/')
  if (!['.claude', '.codex'].includes(parts[0]) || parts.some(p => !p || p === '.' || p === '..' || /[\\:]/.test(p)))
    throw Error('잘못된 키트 경로: ' + rel)
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part)
    if (stat(current) && !stat(current).isDirectory()) throw Error('폴더 경로 충돌: ' + rel)
  }
  return path.join(root, ...parts)
}

export function kitPlan(root, kitName, codexAgent) {
  const agentDir = target(root, '.claude/agents')
  if (!stat(agentDir)?.isDirectory()) throw Error('에이전트 폴더 없음')
  const agents = fs.readdirSync(agentDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
  if (!agents.length) throw Error('에이전트 정의 없음')
  const files = new Map()
  function visit(rel) {
    const p = target(root, rel)
    if (stat(p).isFile()) files.set(rel, fs.readFileSync(p))
    else if (stat(p).isDirectory()) {
      for (const child of fs.readdirSync(p)) visit(rel + '/' + child)
    } else throw Error('지원하지 않는 파일: ' + rel)
  }
  for (const name of agents) visit('.claude/agents/' + name + '.md')
  const dirs = new Set(['skills', kitName.replace(/-kit$/, ''), ...agents])
  if (['game-designer-agent-kit', 'game-design-team-kit'].includes(kitName)) dirs.add('game-design')
  for (const dir of dirs) {
    const rel = '.claude/' + dir
    if (stat(target(root, rel))) visit(rel)
  }
  for (const name of agents) {
    let markdown = files.get('.claude/agents/' + name + '.md').toString('utf8')
    const header = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    const preload = header.match(/^skills:[ \t]*\r?\n((?:[ \t]+- [^\r\n]+(?:\r?\n|$))+)/m)?.[1]
    for (const item of preload?.trim().split(/\r?\n/) ?? []) {
      const skill = '.claude/skills/' + item.trim().slice(2).trim() + '/SKILL.md'
      if (!files.has(skill)) throw Error('담당 스킬 없음: ' + skill)
      markdown += '\n\n작업 전에 프로젝트의 ' + skill + '을 읽고 해당 절차를 따른다.\n'
    }
    files.set('.codex/agents/' + name + '.toml', Buffer.from(codexAgent(markdown, name, [])))
  }
  return { agents, files }
}

export function conflict(project, plan) {
  for (const rel of plan.files.keys()) {
    if (stat(target(project, rel))) return '기존 파일과 충돌: ' + rel
    if (isDefinition(rel) && stat(target(project, rel + offSuffix))) return '꺼진 프로젝트 에이전트와 충돌: ' + rel
  }
}

export function installKit(project, plan, receipt) {
  const files = [], dirs = []
  function parents(rel) {
    const folder = path.posix.dirname(rel)
    if (folder === '.' || stat(target(project, folder))) return
    parents(folder)
    fs.mkdirSync(target(project, folder))
    dirs.push(folder)
  }
  try {
    for (const [rel, data] of plan.files) {
      parents(rel)
      const p = target(project, rel)
      const fd = fs.openSync(p, 'wx')
      try {
        files.push([rel, digest(data)])
        fs.writeFileSync(fd, data)
      } finally { fs.closeSync(fd) }
    }
    fs.writeFileSync(receipt, JSON.stringify({ version: 2, agents: plan.agents, files, dirs }), { flag: 'wx' })
  } catch (err) {
    for (const [rel] of files.reverse()) fs.unlinkSync(target(project, rel))
    for (const dir of dirs.reverse()) fs.rmdirSync(target(project, dir))
    throw err
  }
}

export function removeKit(project, record, receipt) {
  const installedPath = rel => isDefinition(rel) ? definitionFile(target(project, rel)) : target(project, rel)
  for (const [rel, hash] of record.files) {
    const p = installedPath(rel)
    if (stat(p) && (!stat(p).isFile() || digest(fs.readFileSync(p)) !== hash))
      throw Error('변경된 파일을 보존했습니다: ' + rel)
  }
  for (const dir of record.dirs) {
    const p = target(project, dir)
    if (stat(p) && !stat(p).isDirectory()) throw Error('변경된 폴더를 보존했습니다: ' + dir)
  }
  for (const [rel] of record.files) {
    const p = installedPath(rel)
    if (stat(p)) fs.unlinkSync(p)
  }
  for (const dir of [...record.dirs].reverse()) {
    const p = target(project, dir)
    if (stat(p) && !fs.readdirSync(p).length) fs.rmdirSync(p)
  }
  fs.unlinkSync(receipt)
}

function isDefinition(rel) {
  return /^\.(?:claude\/agents\/[^/]+\.md|codex\/agents\/[^/]+\.toml)$/.test(rel)
}
