// Coordinator settings: keep list × this machine's inventory → .claude/coordinator.settings.local.json.
// `node .claude/scripts/coordinator-settings.mjs inventory|init-keep|generate` (cwd = project root)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COORDINATOR_ENV, COORDINATOR_COMPACT_WINDOW } from '../hooks/compact-gate.mjs';

export const KEEP_PATH = '.claude/coordinator.keep.json';
export const SETTINGS_PATH = '.claude/coordinator.settings.local.json';
export const ESSENTIAL_SKILLS = ['coordinator', 'orchestration', 'orca-cli', 'dag-swimlane', 'waterfall-timeline'];

export function buildSettings(keep, inventory) {
  const off = (kind, name) => keep[kind]?.[name] === 'off';
  return {
    env: { [COORDINATOR_ENV]: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(COORDINATOR_COMPACT_WINDOW) },
    enabledPlugins: Object.fromEntries(inventory.plugins.filter((p) => off('plugins', p)).map((p) => [p, false])),
    skillOverrides: Object.fromEntries(inventory.skills.filter((s) => off('skills', s)).map((s) => [s, 'off'])),
  };
}

export function unclassified(keep, inventory) {
  return {
    plugins: inventory.plugins.filter((p) => !(p in (keep.plugins ?? {}))),
    skills: inventory.skills.filter((s) => !(s in (keep.skills ?? {}))),
  };
}

// P7: the `system`/`init` line of a stream-json run lists plugins[].source and skills. @inline/@builtin are not installed plugins.
export function readInventory(run) {
  const out = run('claude', ['-p', 'ok', '--model', 'haiku', '--output-format', 'stream-json', '--verbose']);
  for (const line of out.split(/\r?\n/)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'system' || e.subtype !== 'init') continue;
    return {
      plugins: (e.plugins ?? []).map((p) => p.source).filter((s) => s && !/@(inline|builtin)$/.test(s)),
      skills: e.skills ?? [],
    };
  }
  throw new Error('coordinator-settings: claude 출력에 subtype init 줄이 없음');
}

const runCmd = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export function main(argv, run = runCmd, root = '.', log = console.log) {
  const [cmd] = argv;
  const keepPath = join(root, KEEP_PATH);
  if (cmd === 'inventory') { log(JSON.stringify(readInventory(run), null, 2)); return 0; }
  if (cmd === 'init-keep') {
    if (existsSync(keepPath)) { log(`${KEEP_PATH} 이미 있음 — 쓰지 않음`); return 0; }
    const inv = readInventory(run);
    const mark = (names, keepNames) => Object.fromEntries(names.map((n) => [n, keepNames.includes(n) ? 'keep' : 'off']));
    writeJson(keepPath, { permissionMode: 'default', plugins: mark(inv.plugins, []), skills: mark(inv.skills, ESSENTIAL_SKILLS) });
    log(`${KEEP_PATH} 씀: 플러그인 ${inv.plugins.length}, 스킬 ${inv.skills.length}`);
    return 0;
  }
  if (cmd === 'generate') {
    if (!existsSync(keepPath)) { console.error(`coordinator-settings: ${KEEP_PATH} 없음 — init-keep 먼저`); return 1; }
    const keep = JSON.parse(readFileSync(keepPath, 'utf8').replace(/^﻿/, ''));
    const inv = readInventory(run);
    const settings = buildSettings(keep, inv);
    writeJson(join(root, SETTINGS_PATH), settings);
    const un = unclassified(keep, inv);
    const n = un.plugins.length + un.skills.length;
    const offP = Object.keys(settings.enabledPlugins).length;
    const offS = Object.keys(settings.skillOverrides).length;
    log(`kept ${inv.plugins.length - offP - un.plugins.length}/${inv.skills.length - offS - un.skills.length}, off ${offP}/${offS}, 미분류 ${n}`);
    if (n) log(`경고: 분류되지 않은 항목 ${n}개`);
    return 0;
  }
  console.error('사용법: coordinator-settings.mjs inventory|init-keep|generate');
  return 1;
}

// realpath on both sides: run through a junction or symlink, main must still run
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
