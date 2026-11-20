// Several Runs of one program (e.g. knowledge K0~K6) → one progress.mjs input on a shared clock.
// Usage: node merge.mjs --out all.json --title "<title>" [--dag <url>] [--notes notes.json] K0=run_a/waterfall-progress.json K1=…
// Each source is a progress input; its task titles get the "<stage> · " prefix (progress.mjs still sees "<stage> · ✋…" as a user wait).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

export function merge(parts, { title, dag, notes } = {}) {
  if (!title || !parts.length) throw new Error('title and at least one STAGE=file required');
  const tasks = parts.flatMap(({ stage, data }) => {
    if (!Array.isArray(data.tasks) || !data.tasks.length) throw new Error(`${stage}: no tasks`);
    return data.tasks.map((t) => ({ ...t, title: `${stage} · ${t.title}` }));
  });
  return { title, ...(dag ? { dag } : {}), tasks, notes: notes ?? [] };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), opt = {}, parts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
    else { const [stage, file] = args[i].split('='); parts.push({ stage, data: read(file) }); }
  }
  if (!opt.out) throw new Error('--out required');
  fs.writeFileSync(opt.out, JSON.stringify(merge(parts, { title: opt.title, dag: opt.dag, notes: opt.notes && read(opt.notes) }), null, 2));
  console.log(opt.out);
}
