// Compares your local env files with the committed examples: variable NAMES only, never values.
//
//   npm run env:check            report what is missing or unknown
//   npm run env:check -- --fix   also append missing variables with the example's default
//                                (existing lines are never changed or removed)
//   npm run env:check -- --sync  rewrite each file in the example's order and comments, keeping
//                                YOUR value for every variable you have; variables the example
//                                lacks are kept at the end. The old file is saved first as
//                                <file>.backup-<date>.
//
// Files: backend/.env ← backend/.env.example, web/.env.local ← web/.env.example,
//        mobile/.env ← mobile/.env.example
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sync = process.argv.includes('--sync');
const fix = sync || process.argv.includes('--fix');
const apps = [
  { name: 'API', file: 'backend/.env', example: 'backend/.env.example' },
  { name: 'Web', file: 'web/.env.local', example: 'web/.env.example' },
  { name: 'Mobile', file: 'mobile/.env', example: 'mobile/.env.example' },
];

/** Variables in a file: active ones, plus (for examples) commented-out optional ones. */
function parse(text) {
  const active = new Map();
  const optional = new Set();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const on = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (on) {
      // The comment lines just above a variable explain it.
      const notes = [];
      for (let j = i - 1; j >= 0 && /^\s*#/.test(lines[j]) && !/^\s*#\s*[A-Z][A-Z0-9_]*\s*=/.test(lines[j]); j--) notes.unshift(lines[j]);
      active.set(on[1], { line, notes });
      return;
    }
    const off = line.match(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (off) optional.add(off[1]);
  });
  return { active, optional };
}

/** Example layout, with the user's own value substituted for every variable they already set. */
function syncFile(filePath, exampleText, mine) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const backup = `${filePath}.backup-${stamp}`;
  copyFileSync(filePath, backup);
  const used = new Set();
  const out = exampleText.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*#?\s*)([A-Z][A-Z0-9_]*)(\s*=)/);
    if (!m || !mine.active.has(m[2])) return line;
    used.add(m[2]);
    return mine.active.get(m[2]).line; // your line, uncommented, exactly as you had it
  });
  const extra = [...mine.active.keys()].filter((k) => !used.has(k));
  if (extra.length) out.push('', '# ---- kept from your previous file (not in the example) ----', ...extra.map((k) => mine.active.get(k).line));
  writeFileSync(filePath, `${out.join('\n').replace(/\n+$/, '')}\n`);
  const fromExample = [...parse(exampleText).active.keys()].filter((k) => !mine.active.has(k));
  console.log(`  rewritten in the example's order. Your values kept: ${used.size}; example defaults added: ${fromExample.length}${fromExample.length ? ` (${fromExample.join(', ')})` : ''}; extra kept at the end: ${extra.length}.`);
  console.log(`  previous file saved as ${backup.slice(root.length + 1)}`);
}

let problems = 0;
for (const app of apps) {
  const examplePath = join(root, app.example);
  const filePath = join(root, app.file);
  if (!existsSync(examplePath)) continue;
  const example = parse(readFileSync(examplePath, 'utf8'));
  console.log(`\n${app.name}: ${app.file}`);
  if (!existsSync(filePath)) {
    problems++;
    if (fix) {
      writeFileSync(filePath, readFileSync(examplePath, 'utf8'));
      console.log(`  created from ${app.example}. Fill in the secrets it asks for.`);
    } else {
      console.log(`  missing. Copy ${app.example} to ${app.file} (or run with --fix).`);
    }
    continue;
  }
  const mine = parse(readFileSync(filePath, 'utf8'));
  if (sync) {
    syncFile(filePath, readFileSync(examplePath, 'utf8'), mine);
    continue;
  }
  const missing = [...example.active.keys()].filter((k) => !mine.active.has(k) && !mine.optional.has(k));
  const unknown = [...mine.active.keys()].filter((k) => !example.active.has(k) && !example.optional.has(k));
  if (!missing.length && !unknown.length) {
    console.log('  matches the example.');
    continue;
  }
  if (missing.length) {
    problems++;
    console.log(`  missing (${missing.length}): ${missing.join(', ')}`);
    if (fix) {
      const block = missing.map((k) => [...example.active.get(k).notes, example.active.get(k).line].join('\n')).join('\n');
      const text = readFileSync(filePath, 'utf8');
      appendFileSync(filePath, `${text.endsWith('\n') ? '' : '\n'}\n# ---- added by env:check ${new Date().toISOString().slice(0, 10)} (example defaults; review them) ----\n${block}\n`);
      console.log('  appended them with the example defaults.');
    }
  }
  if (unknown.length) console.log(`  not used by this version (safe to delete): ${unknown.join(', ')}`);
}

console.log(problems && !fix ? '\nRun `npm run env:check -- --fix` to add what is missing.' : '\nDone.');
process.exitCode = problems && !fix ? 1 : 0;
