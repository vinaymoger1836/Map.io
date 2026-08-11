/**
 * Splits the single `ballistic` target class into three tiers.
 *
 *   node scripts/retag-ballistic.mjs            # report what it would change
 *   node scripts/retag-ballistic.mjs --write    # rewrite research/*.json in place
 *
 * Why this exists as a script rather than a one-off edit: the research files are
 * the source of truth and get re-merged whenever a batch is redelivered, so a
 * hand edit to the merged output would be undone by the next merge. Run this
 * against `research/` after any new batch arrives.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON WHAT THIS IS.
 *
 * Every figure in the library carries provenance because open-source numbers
 * disagree and some are estimates. The tier assignments below are NOT figures
 * and carry no provenance: they are a classification I applied, based on each
 * system's documented role. They are the most arguable thing in the library.
 *
 * The rule I used, stated so it can be disagreed with:
 *   - short  — designed against battlefield rockets and short-range ballistic
 *              missiles, engaged inside the atmosphere on the terminal leg.
 *   - medium — credited by its own operator with engaging theatre/medium-range
 *              ballistic missiles, not merely tactical ones.
 *   - imrbm  — designed to intercept intermediate-range missiles, which in
 *              practice means an exo-atmospheric kill vehicle.
 *
 * A system gets every tier it covers, not just its highest: an S-400 that can
 * engage an MRBM can certainly engage an SRBM, and the map should say so.
 *
 * Where a claim is contested — and Russian and Chinese ballistic-defence claims
 * are heavily contested — I took the narrower reading. Widening one is a one
 * line change here, which is the point of keeping it in a table.
 * ---------------------------------------------------------------------------
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'research');
const write = process.argv.includes('--write');

const SHORT = 'ballistic-short';
const MEDIUM = 'ballistic-medium';
const IMRBM = 'ballistic-imrbm';

/**
 * Keyed by system id, then by weapon id or name. Each entry says which tiers
 * that interceptor covers, and why.
 */
const WEAPONS = {
  'patriot-pac3': {
    'PAC-3 MSE': [[SHORT], 'Terminal-phase hit-to-kill against short-range ballistic missiles and large rockets. Not credited with MRBM intercept.'],
  },
  'barak-8': {
    'Barak 8': [[SHORT], 'Point and local-area defence; the ballistic capability claimed is against tactical rockets and SRBMs.'],
  },
  'buk-m3': {
    '9M317M': [[SHORT], 'Tactical ballistic missile capability at 70 km — battlefield rockets, not theatre missiles.'],
  },
  'fremm': {
    'Aster 30': [[SHORT], 'Aster 30 Block 1 is credited against ballistic missiles of up to roughly 600 km range — the short tier.'],
  },
  'samp-t': {
    'Aster 30': [[SHORT], 'Same interceptor as the naval fit; Block 1NT, which extends this, is not yet the in-service variant recorded here.'],
  },
  'type-45': {
    'Aster 30': [[SHORT], 'As above. Type 45 has no in-service BMD fit beyond the Aster 30 itself.'],
  },
  'hq-9b': {
    'HQ-9B': [[SHORT], 'Chinese claims extend further, but independent assessment credits it against tactical ballistic missiles. Narrower reading taken.'],
  },
  's-300pmu2': {
    '48N6E2': [[SHORT], 'Favorit is credited against tactical ballistic missiles; the wider Russian claims are contested. Narrower reading taken.'],
  },
  's-400': {
    '48N6 series': [[SHORT, MEDIUM], 'The 48N6DM is credited with engaging theatre ballistic missiles, which is the capability the S-400 is built around.'],
  },
  'thaad': {
    'THAAD interceptor': [[SHORT, MEDIUM], 'Purpose-built area defence against short and medium-range ballistic missiles, engaging high in the atmosphere and just outside it.'],
  },
  'arleigh-burke': {
    'SM-6 (RIM-174)': [[SHORT], 'SM-6 provides sea-based terminal defence against ballistic missiles on their final leg — the short tier. The Burke\'s exo-atmospheric capability comes from SM-3, which this hull is not recorded as carrying.'],
  },
  'ticonderoga': {
    'SM-6 (RIM-174)': [[SHORT], 'As above — terminal-phase only for this round.'],
  },
  'maya': {
    'SM-6 (RIM-174)': [[SHORT], 'Terminal-phase sea-based defence.'],
    'SM-3 (RIM-161)': [[MEDIUM, IMRBM], 'Exo-atmospheric kill vehicle, the one system here designed against intermediate-range missiles.'],
  },
};

/**
 * Sensors are tagged with what they can track, which is broader than what any
 * interceptor can reach — a radar sees the missile it cannot shoot.
 */
const SENSORS = {
  'ground-radar': [[SHORT], 'Generic early-warning set; credited no further than tactical missiles.'],
  'an-tpy-2': [[SHORT, MEDIUM, IMRBM], 'X-band BMD radar built for exactly this, and the forward-based element of the US missile-defence architecture.'],
  'nebo-m': [[SHORT, MEDIUM, IMRBM], 'Strategic VHF/L/S-band complex at 1,800 km, explicitly a ballistic-missile early-warning set.'],
  'jy-27a': [[SHORT, MEDIUM], 'VHF long-range surveillance; theatre missile detection.'],
  'thaad': [[SHORT, MEDIUM], 'The AN/TPY-2 in terminal mode, matching what the battery can engage.'],
  's-400': [[SHORT, MEDIUM], 'Matches the 48N6DM engagement tier.'],
  's-350': [[SHORT], 'Medium-range battery; tactical ballistic only.'],
  's-300pmu2': [[SHORT], 'Matches its interceptor.'],
  'patriot-pac3': [[SHORT], 'Matches its interceptor.'],
  'samp-t': [[SHORT], 'Matches its interceptor.'],
  'buk-m3': [[SHORT], 'Matches its interceptor.'],
  'hq-9b': [[SHORT], 'Matches its interceptor.'],
};

/* ------------------------------------------------------------------ */

if (!existsSync(DIR)) {
  console.error(`No research/ directory at ${DIR}`);
  process.exit(1);
}

const changes = [];
const unhandled = [];
let filesTouched = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.includes('merged')).sort()) {
  const path = join(DIR, file);
  const list = JSON.parse(readFileSync(path, 'utf8'));
  let dirty = false;

  for (const spec of Array.isArray(list) ? list : [list]) {
    for (const [i, weapon] of (spec.weapons ?? []).entries()) {
      if (!weapon.engages?.includes('ballistic')) continue;
      const entry = WEAPONS[spec.id]?.[weapon.id ?? weapon.name] ?? WEAPONS[spec.id]?.[weapon.name];
      if (!entry) {
        unhandled.push(`${spec.id} weapons.${i} "${weapon.name}"`);
        continue;
      }
      const [tiers, why] = entry;
      weapon.engages = [...weapon.engages.filter((t) => t !== 'ballistic'), ...tiers];
      changes.push({ what: `${spec.id} · ${weapon.name}`, tiers, why });
      dirty = true;
    }

    if (spec.sensor?.sees?.includes('ballistic')) {
      const entry = SENSORS[spec.id];
      if (!entry) {
        unhandled.push(`${spec.id} sensor`);
      } else {
        const [tiers, why] = entry;
        spec.sensor.sees = [...spec.sensor.sees.filter((t) => t !== 'ballistic'), ...tiers];
        changes.push({ what: `${spec.id} · sensor`, tiers, why });
        dirty = true;
      }
    }
  }

  if (dirty) {
    filesTouched++;
    if (write) writeFileSync(path, `${JSON.stringify(list, null, 1)}\n`);
  }
}

for (const c of changes) {
  console.log(`${c.what}`);
  console.log(`  -> ${c.tiers.join(', ')}`);
  console.log(`     ${c.why}`);
}

console.log(`\n${changes.length} tags re-classified across ${filesTouched} files`);

if (unhandled.length) {
  console.error(`\n${unhandled.length} ballistic tags have no entry in this table:`);
  for (const u of unhandled) console.error(`  ✗ ${u}`);
  console.error('Add them above — a tag left as plain "ballistic" will fail validation.');
  process.exit(1);
}

if (!write) console.log('\nNothing written. Re-run with --write, then re-merge.');
