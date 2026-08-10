/**
 * Assembles researched batches into one systems file.
 *
 *   node scripts/merge-systems.mjs                     # merge research/ -> research/systems.merged.json
 *   node scripts/merge-systems.mjs --write             # ... and install it as the library
 *   node scripts/merge-systems.mjs path/to/dir --write
 *
 * The research is done a family at a time, so it arrives as a pile of files.
 * This concatenates them, keeps the last definition of any id, and — the useful
 * part — reports what is still missing against the current roster, so you can
 * see how far through you are without diffing anything by hand.
 *
 * It tolerates a response that arrived wrapped in a markdown fence, because a
 * model told not to do that will occasionally do it anyway, and losing an hour
 * of research to three backticks would be a poor joke.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const inputDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'research'));
const LIBRARY = join(ROOT, 'public', 'data', 'systems.json');

if (!existsSync(inputDir)) {
  mkdirSync(inputDir, { recursive: true });
  console.log(`Created ${inputDir}`);
  console.log('Save each batch the researcher returns into it as a .json file, then run this again.');
  process.exit(0);
}

/** Strips a markdown fence and any stray prose around the JSON. */
function parseLoosely(text, file) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found');
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  const parsed = JSON.parse(body.slice(start, end + 1));
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (fenced) console.log(`  (${file} was fenced — unwrapped it)`);
  return list;
}

const files = readdirSync(inputDir).filter((f) => f.endsWith('.json') && !f.includes('merged')).sort();
if (!files.length) {
  console.log(`No .json files in ${inputDir}. Save each batch there first.`);
  process.exit(0);
}

const byId = new Map();
const origin = new Map();

for (const file of files) {
  let list;
  try {
    list = parseLoosely(readFileSync(join(inputDir, file), 'utf8'), file);
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  for (const spec of list) {
    if (!spec?.id) {
      console.error(`✗ ${file}: an entry has no id`);
      process.exitCode = 1;
      continue;
    }
    if (byId.has(spec.id)) console.log(`  ${spec.id}: ${file} replaces ${origin.get(spec.id)}`);
    byId.set(spec.id, spec);
    origin.set(spec.id, file);
  }
  console.log(`${file}: ${list.length} systems`);
}

const merged = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

/* How far through the roster the research has got. */
let missing = [];
if (existsSync(LIBRARY)) {
  const roster = JSON.parse(readFileSync(LIBRARY, 'utf8'));
  const have = new Set(merged.map((s) => s.id));
  missing = roster.filter((s) => !have.has(s.id));
  const extra = merged.filter((s) => !roster.some((r) => r.id === s.id));
  if (extra.length) console.log(`\n${extra.length} systems are new to the roster: ${extra.map((s) => s.id).join(', ')}`);
}

const out = write ? LIBRARY : join(inputDir, 'systems.merged.json');
writeFileSync(out, `${JSON.stringify(merged, null, 1)}\n`);

console.log(`\n${merged.length} systems -> ${out}`);
if (missing.length) {
  const byType = missing.reduce((acc, s) => ({ ...acc, [s.typeId]: (acc[s.typeId] ?? 0) + 1 }), {});
  console.log(`${missing.length} still to research: ${Object.entries(byType).map(([t, n]) => `${t} (${n})`).join(', ')}`);
}
console.log(`\nNow check it:  node scripts/validate-systems.mjs ${out}`);
if (!write) console.log('Then re-run with --write to install it as the library.');
