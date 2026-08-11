/**
 * Checks a systems file before it goes anywhere near the app.
 *
 *   node scripts/validate-systems.mjs public/data/systems.json
 *   node scripts/validate-systems.mjs ~/Downloads/researched.json
 *
 * Two jobs. The first is structural: ids the app can resolve, unit types that
 * exist, facets spelled the way the code reads them, numbers in range. A typo in
 * `detectionKm` does not crash anything — it silently produces a system with no
 * coverage, which is far worse.
 *
 * The second is honesty. It reports how many figures actually carry a citation,
 * and it rejects a URL attached to a `placeholder` source, because a placeholder
 * with a link is an estimate wearing a reference's clothes. That check is the
 * point of the file.
 *
 * Exits non-zero if anything is wrong, so it can gate a commit.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
/* A fresh batch of research fails in bulk and in patterns, so the default
   truncation hides exactly what you need to see. --all prints the lot. */
const showAll = args.includes('--all');
const target = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'public', 'data', 'systems.json');

/* The unit-type vocabulary is read from the catalogue itself rather than copied,
   so adding a unit type cannot leave this file quietly out of date. */
const catalogue = readFileSync(join(ROOT, 'lib', 'warGames.ts'), 'utf8');
const TYPE_IDS = new Set([...catalogue.matchAll(/unit\('([a-z0-9-]+)'/g)].map((m) => m[1]));

/* Ballistic is tiered: a Patriot at 45 km and an SM-3 at 1,200 km are not
   answering the same question. Plain 'ballistic' is deliberately absent so a
   stale tag fails loudly rather than drawing a ring nobody can interpret. */
const TARGETS = new Set([
  'air',
  'ballistic-short',
  'ballistic-medium',
  'ballistic-imrbm',
  'surface',
  'ground',
  'subsurface',
]);
const KINDS = new Set(['manufacturer', 'government', 'reference', 'press', 'placeholder']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const SIGNATURES = new Set(['low', 'medium', 'high']);

const SENSOR_KEYS = new Set(['detectionKm', 'tracks', 'engagements', 'sees', 'horizonLimited', 'antennaM']);
const WEAPON_KEYS = new Set(['id', 'name', 'rangeKm', 'minRangeKm', 'massKg', 'salvo', 'magazine', 'pk', 'reactionSec', 'engages']);
const PLATFORM_KEYS = new Set([
  'combatRadiusKm', 'refuelledRadiusKm', 'ferryRangeKm', 'speedKmh', 'payloadKg',
  'crew', 'displacementT', 'aircraft', 'vls', 'enduranceDays',
]);
const SYSTEM_KEYS = new Set(['id', 'name', 'typeId', 'origin', 'note', 'sensor', 'weapons', 'platform', 'signature', 'provenance', 'custom']);

const errors = [];
const warnings = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

/** Resolves 'weapons.0.rangeKm' against a system, so provenance cannot point at nothing. */
function pathExists(spec, path) {
  let node = spec;
  for (const step of path.split('.')) {
    if (node === null || node === undefined) return false;
    node = Array.isArray(node) ? node[Number(step)] : node[step];
  }
  return node !== undefined;
}

function checkKeys(where, object, allowed, facet) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(where, `unknown ${facet} field "${key}"`);
  }
}

function checkNumbers(where, object, keys) {
  for (const [key, value] of Object.entries(object)) {
    if (!keys.has(key) || typeof value !== 'number') continue;
    if (!Number.isFinite(value)) fail(where, `${key} is not a finite number`);
    else if (value < 0) fail(where, `${key} is negative (${value})`);
  }
}

let raw;
try {
  raw = JSON.parse(readFileSync(resolve(target), 'utf8'));
} catch (err) {
  console.error(`Could not read ${target}\n  ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(raw)) {
  console.error('The file must be a JSON array of systems.');
  process.exit(1);
}

const seen = new Set();
const stats = { figures: 0, cited: 0, placeholder: 0, legacy: 0, byConfidence: { high: 0, medium: 0, low: 0 } };
/** Every use of a shared munition id, so the same round can be checked platform to platform. */
const munitions = new Map();

/** The same fallback key lib/munitions.ts uses when a weapon declares no id. */
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

for (const [index, spec] of raw.entries()) {
  const where = `#${index} ${spec?.id ?? spec?.name ?? '(unnamed)'}`;

  if (!spec || typeof spec !== 'object') {
    fail(where, 'not an object');
    continue;
  }
  checkKeys(where, spec, SYSTEM_KEYS, 'system');

  if (typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(spec.id)) {
    fail(where, 'id must be lowercase letters, digits and dashes');
  } else if (seen.has(spec.id)) {
    fail(where, `duplicate id "${spec.id}"`);
  } else {
    seen.add(spec.id);
  }

  if (typeof spec.name !== 'string' || !spec.name.trim()) fail(where, 'name is required');
  if (!TYPE_IDS.has(spec.typeId)) fail(where, `unknown typeId "${spec.typeId}"`);
  if (spec.signature && !SIGNATURES.has(spec.signature)) fail(where, `bad signature "${spec.signature}"`);

  if (spec.sensor) {
    checkKeys(where, spec.sensor, SENSOR_KEYS, 'sensor');
    checkNumbers(where, spec.sensor, SENSOR_KEYS);
    if (typeof spec.sensor.detectionKm !== 'number') fail(where, 'sensor without detectionKm');
    for (const t of spec.sensor.sees ?? []) if (!TARGETS.has(t)) fail(where, `sensor sees unknown class "${t}"`);
    if (spec.sensor.horizonLimited && spec.sensor.antennaM === undefined) {
      warn(where, 'horizonLimited sensor has no antennaM — the horizon falls back to 20 m');
    }
  }

  for (const [i, weapon] of (spec.weapons ?? []).entries()) {
    const w = `${where} weapons.${i}`;
    checkKeys(w, weapon, WEAPON_KEYS, 'weapon');
    checkNumbers(w, weapon, WEAPON_KEYS);
    if (typeof weapon.rangeKm !== 'number' || weapon.rangeKm <= 0) fail(w, 'rangeKm is required and must be > 0');
    if (weapon.pk !== undefined && (weapon.pk < 0 || weapon.pk > 1)) fail(w, `pk must be 0–1 (got ${weapon.pk})`);
    for (const t of weapon.engages ?? []) if (!TARGETS.has(t)) fail(w, `engages unknown class "${t}"`);
    if (weapon.id !== undefined && (typeof weapon.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(weapon.id))) {
      fail(w, `weapon id must be lowercase letters, digits and dashes (got "${weapon.id}")`);
    } else {
      // Keyed exactly as lib/munitions.ts keys it, slug fallback included — a
      // catalogue the validator checks differently from the one the app builds
      // is a check of nothing.
      const key = weapon.id ?? (weapon.name ? slug(weapon.name) : undefined);
      if (key) {
        if (!munitions.has(key)) munitions.set(key, []);
        munitions.get(key).push({ system: spec.id, weapon });
      }
      if (weapon.id === undefined) {
        warn(w, `"${weapon.name ?? 'unnamed'}" has no id — matched by name, which is fragile`);
      }
    }
  }

  if (spec.platform) {
    checkKeys(where, spec.platform, PLATFORM_KEYS, 'platform');
    checkNumbers(where, spec.platform, PLATFORM_KEYS);
  }

  const provenance = spec.provenance ?? {};
  for (const [path, entry] of Object.entries(provenance)) {
    const p = `${where} provenance["${path}"]`;
    if (!pathExists(spec, path)) {
      fail(p, 'points at a field this system does not have');
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      fail(p, 'must be an object');
      continue;
    }
    if (!CONFIDENCE.has(entry.confidence)) fail(p, `bad confidence "${entry.confidence}"`);
    else stats.byConfidence[entry.confidence]++;
    stats.figures++;

    const source = entry.source;
    if (typeof source === 'string') {
      stats.legacy++;
      warn(p, `source is a bare label ("${source}") — a category, not a citation`);
    } else if (!source || typeof source !== 'object') {
      fail(p, 'source is missing');
    } else {
      if (!KINDS.has(source.kind)) fail(p, `bad source kind "${source.kind}"`);
      if (typeof source.title !== 'string' || !source.title.trim()) fail(p, 'source has no title');
      if (source.kind === 'placeholder') {
        stats.placeholder++;
        // The check this file exists for.
        if (source.url) fail(p, 'a placeholder source must not carry a URL — it is an estimate, not a reference');
      } else if (!source.url) {
        fail(p, `a ${source.kind} source must carry the URL it came from`);
      } else if (!/^https?:\/\//.test(source.url)) {
        fail(p, `source URL is not a URL ("${source.url}")`);
      } else {
        stats.cited++;
      }
    }
  }

  // A figure with no provenance at all is the thing this whole mechanism exists
  // to prevent, so it is worth naming even though it is not fatal.
  const numericPaths = [];
  if (spec.sensor) for (const k of Object.keys(spec.sensor)) if (typeof spec.sensor[k] === 'number') numericPaths.push(`sensor.${k}`);
  (spec.weapons ?? []).forEach((w, i) => {
    for (const k of Object.keys(w)) if (typeof w[k] === 'number') numericPaths.push(`weapons.${i}.${k}`);
  });
  if (spec.platform) for (const k of Object.keys(spec.platform)) if (typeof spec.platform[k] === 'number') numericPaths.push(`platform.${k}`);
  const unsourced = numericPaths.filter((path) => !provenance[path]);
  if (unsourced.length) warn(where, `${unsourced.length} figures carry no provenance: ${unsourced.slice(0, 4).join(', ')}${unsourced.length > 4 ? '…' : ''}`);
}

/* A munition is one object in the world, so an SM-6 must not reach 240 km from a
   Burke and 370 km from a Ticonderoga. The research is done a family at a time,
   which is exactly the arrangement that lets a round drift between batches. */
/* The catalogue keys on the declared id, falling back to a slug of the name —
   which means an entry that omits its id can hash to a different key and carry
   different figures without the check below ever comparing them. Two keys
   wearing one name is the visible symptom: the re-arming list shows the round
   twice. Either they are the same round (unify the id) or they are not (say so
   in the name). */
const namesToKeys = new Map();
for (const [id, uses] of munitions) {
  for (const { weapon } of uses) {
    if (!weapon.name) continue;
    if (!namesToKeys.has(weapon.name)) namesToKeys.set(weapon.name, new Set());
    namesToKeys.get(weapon.name).add(id);
  }
}
for (const [name, keys] of namesToKeys) {
  if (keys.size > 1) {
    fail(`munition "${name}"`, `appears under ${keys.size} ids (${[...keys].join(', ')}) — it will be listed twice when re-arming`);
  }
}

let shared = 0;
for (const [id, uses] of munitions) {
  if (uses.length < 2) continue;
  shared++;
  for (const field of ['rangeKm', 'massKg', 'minRangeKm']) {
    const values = [...new Set(uses.map((u) => u.weapon[field]).filter((v) => v !== undefined))];
    if (values.length > 1) {
      const spread = uses
        .filter((u) => u.weapon[field] !== undefined)
        .map((u) => `${u.system} ${u.weapon[field]}`)
        .join(', ');
      fail(`munition "${id}"`, `${field} disagrees across platforms — ${spread}`);
    }
  }
}

/* ------------------------------------------------------------------ */

console.log(`${target}`);
console.log(`  ${raw.length} systems, ${stats.figures} figures with provenance`);
console.log(`  ${munitions.size} distinct munitions, ${shared} carried by more than one platform`);
console.log(`  confidence: ${stats.byConfidence.high} high, ${stats.byConfidence.medium} medium, ${stats.byConfidence.low} low`);
console.log(`  ${stats.cited} carry a source URL, ${stats.placeholder} are declared placeholders, ${stats.legacy} are bare labels`);

const WARN_SHOWN = showAll ? Infinity : 25;
const ERROR_SHOWN = showAll ? Infinity : 40;

if (warnings.length) {
  console.log(`\n${warnings.length} warnings`);
  for (const line of warnings.slice(0, WARN_SHOWN)) console.log(`  ! ${line}`);
  if (warnings.length > WARN_SHOWN) console.log(`  … and ${warnings.length - WARN_SHOWN} more (--all shows every one)`);
}

if (errors.length) {
  console.error(`\n${errors.length} errors`);
  for (const line of errors.slice(0, ERROR_SHOWN)) console.error(`  ✗ ${line}`);
  if (errors.length > ERROR_SHOWN) console.error(`  … and ${errors.length - ERROR_SHOWN} more (--all shows every one)`);
  process.exit(1);
}

console.log('\nValid.');
