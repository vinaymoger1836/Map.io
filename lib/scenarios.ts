/**
 * Scenarios, and the file a board travels in.
 *
 * Two different problems wearing similar clothes.
 *
 * A **scenario** is a board kept under a name on this machine. The working board
 * is still the one thing the map draws; a scenario is a copy of it you can come
 * back to, so that arguing about a Baltic contingency does not mean dismantling
 * the Pacific one you spent an evening arranging.
 *
 * A **bundle** is a board leaving the machine. That is a harder problem than
 * writing the board out, because a board is mostly references: a deployment
 * names a system, a system names its munitions, a holding names a system. Sent
 * on its own, a board arrives somewhere else as a list of ids that mean nothing.
 * So a bundle carries what the board depends on with it.
 *
 * Storage is somebody else's problem — see `lib/store.ts`. Everything here is a
 * pure function over plain values, including the import path, so the merge rules
 * can be reasoned about without a browser.
 */

import { reviveForces, type Forces } from './forces';
import { reviveSpec, type SystemSpec } from './specs';
import { reviveBoard, totalStrength, UNIT_BY_ID, type BoardState } from './warGames';

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export interface Scenario {
  id: string;
  name: string;
  /** Free text: what this board is meant to show, or what you were testing. */
  note?: string;
  /** ISO 8601, by the clock of whoever last wrote it. */
  savedAt: string;
  board: BoardState;
}

/**
 * The scenarios document.
 *
 * `active` is which scenario the working board came from, and it is stored
 * rather than held in memory because the alternative is that a reload turns
 * **Save** into **Save a second copy** — the working board would go on being
 * the same board while the console forgot what to call it.
 *
 * It is a soft link, not ownership: the working board is free to drift from the
 * scenario it was loaded from, and saying so is the panel's job.
 */
export interface ScenarioDoc {
  active: string | null;
  items: Scenario[];
}

export const EMPTY_SCENARIOS: ScenarioDoc = { active: null, items: [] };

let counter = 0;
export function nextScenarioId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

function reviveScenario(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
  return {
    id: s.id,
    name: s.name,
    note: typeof s.note === 'string' && s.note.trim() ? s.note : undefined,
    // A scenario written by hand may carry no date. Unknown is better than
    // today, which would claim it was saved in a session it was not.
    savedAt: typeof s.savedAt === 'string' ? s.savedAt : '',
    board: reviveBoard(s.board),
  };
}

/** Brings a stored scenarios document up to shape, dropping anything malformed. */
export function reviveScenarios(parsed: unknown): ScenarioDoc {
  if (!parsed || typeof parsed !== 'object') return EMPTY_SCENARIOS;
  const raw = parsed as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items.map(reviveScenario).filter((s): s is Scenario => Boolean(s))
    : [];
  const active = typeof raw.active === 'string' && items.some((s) => s.id === raw.active)
    ? raw.active
    : null;
  return { active, items };
}

export interface BoardSummary {
  nations: number;
  units: number;
  /** What is actually there — twelve aircraft at one airfield is twelve. */
  strength: number;
}

export function summariseBoard(board: BoardState): BoardSummary {
  const nations = new Set(Object.keys(board.nations));
  let strength = 0;
  for (const u of board.units) {
    nations.add(u.iso);
    strength += u.kind === 'formation' ? totalStrength(u.composition) : u.count;
  }
  return { nations: nations.size, units: board.units.length, strength };
}

/** Every country the board mentions — painted, or fielding something, or both. */
export function nationsOnBoard(board: BoardState): Set<string> {
  const out = new Set(Object.keys(board.nations));
  for (const u of board.units) out.add(u.iso);
  return out;
}

/* ------------------------------------------------------------------ */
/* Bundles                                                             */
/* ------------------------------------------------------------------ */

export const BUNDLE_KIND = 'mapio.wargames.bundle';
export const BUNDLE_VERSION = 1;

export interface Bundle {
  kind: typeof BUNDLE_KIND;
  version: number;
  exportedAt: string;
  name: string;
  note?: string;
  board: BoardState;
  /**
   * Every system the receiving machine might not already have.
   *
   * That means all of the authored ones, not the subset this board happens to
   * reference. The tempting optimisation — ship only what the board names — is
   * wrong here, because a deployment's loadout can name a munition defined on a
   * *different* system, and the shipped library is a moving target between
   * versions. Sending the whole authored set is a few kilobytes and cannot lose
   * a reference; computing the closure is clever and can.
   */
  systems: SystemSpec[];
  /**
   * Inventories for the nations on this board only. Forces are configuration
   * rather than board state — a country does not forget its army when you switch
   * boards — but a board with a national inventory means nothing without it, so
   * the countries this board actually involves travel with it and the rest of
   * the world's order of battle stays home.
   */
  forces: Forces;
}

export function buildBundle({
  name,
  note,
  board,
  systems,
  forces,
}: {
  name: string;
  note?: string;
  board: BoardState;
  /** Authored systems only — the shipped library is on both machines already. */
  systems: SystemSpec[];
  forces: Forces;
}): Bundle {
  const involved = nationsOnBoard(board);
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    name,
    note,
    board,
    systems,
    forces: Object.fromEntries(Object.entries(forces).filter(([iso]) => involved.has(iso))),
  };
}

/** A filename that says what is in it and sorts by when it left. */
export function bundleFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
  const day = new Date().toISOString().slice(0, 10);
  return `${slug}-${day}.wargames.json`;
}

/**
 * A minimal gate on a system arriving from a file.
 *
 * Not a schema check — the spec is deliberately a bag of optional facets, and
 * validating all of it here would be a second copy of the editor's rules. It
 * checks the three fields the app would crash without, then hands the rest to
 * the same read-time migration a stored system goes through.
 */
function reviveImportedSpec(raw: unknown): SystemSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
  if (typeof s.typeId !== 'string' || !UNIT_BY_ID.has(s.typeId)) return null;
  return { ...reviveSpec(s as unknown as SystemSpec), custom: true };
}

export type BundleRead = { ok: true; bundle: Bundle } | { ok: false; error: string };

/**
 * Reads a bundle out of whatever text was dropped on us.
 *
 * Everything downstream of this point is trusted, so this is where a file gets
 * to be wrong. It refuses a file that is not one of ours by name rather than
 * guessing: a stray `frontline.geojson` parses perfectly well as JSON and would
 * otherwise import as an empty board over the top of a good one.
 */
export function readBundle(text: string): BundleRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'That file holds no object.' };
  }

  const raw = parsed as Record<string, unknown>;
  if (raw.kind !== BUNDLE_KIND) {
    if (raw.format === 'mapio-arsenal-package' || Array.isArray(raw.systems) || (raw.forces && typeof raw.forces === 'object')) {
      const systems = Array.isArray(raw.systems)
        ? raw.systems.map(reviveImportedSpec).filter((s): s is SystemSpec => Boolean(s))
        : [];
      return {
        ok: true,
        bundle: {
          kind: BUNDLE_KIND,
          version: BUNDLE_VERSION,
          exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
          name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported Arsenal Package',
          note: typeof raw.description === 'string' ? raw.description : undefined,
          board: { units: [], nations: {}, formations: [] },
          systems,
          forces: reviveForces(raw.forces),
        },
      };
    }
    return { ok: false, error: 'That is not a War Games export — it carries no bundle or arsenal package marker.' };
  }
  if (typeof raw.version === 'number' && raw.version > BUNDLE_VERSION) {
    return {
      ok: false,
      error: `That bundle was written by a newer version (v${raw.version}); this one reads v${BUNDLE_VERSION}.`,
    };
  }

  const systems = Array.isArray(raw.systems)
    ? raw.systems.map(reviveImportedSpec).filter((s): s is SystemSpec => Boolean(s))
    : [];

  return {
    ok: true,
    bundle: {
      kind: BUNDLE_KIND,
      version: typeof raw.version === 'number' ? raw.version : BUNDLE_VERSION,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported board',
      note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : undefined,
      board: reviveBoard(raw.board),
      systems,
      forces: reviveForces(raw.forces),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Taking one in                                                       */
/* ------------------------------------------------------------------ */

/**
 * The merge rule, for both systems and forces: **new things are added, and
 * anything you already have is left alone.**
 *
 * A board arriving in a file must not be able to rewrite an S-400 you corrected
 * or an order of battle you spent an hour on. Loading the board itself is
 * undoable, so that one can afford to be destructive; systems and inventories
 * are not in the undo stack, so they are not touched. What was kept is reported
 * rather than swallowed, because a bundle whose systems were all skipped may
 * well draw different rings from the ones its author saw.
 */
export function mergeImported<T>(
  mine: T[],
  incoming: T[],
  idOf: (item: T) => string
): { merged: T[]; added: number; kept: number } {
  const have = new Set(mine.map(idOf));
  const fresh = incoming.filter((item) => !have.has(idOf(item)));
  return {
    merged: fresh.length ? [...mine, ...fresh] : mine,
    added: fresh.length,
    kept: incoming.length - fresh.length,
  };
}

export function mergeImportedForces(
  mine: Forces,
  incoming: Forces
): { merged: Forces; added: number; kept: number } {
  const out: Forces = { ...mine };
  let added = 0;
  let kept = 0;
  for (const [iso, holdings] of Object.entries(incoming)) {
    // A nation already being counted keeps its own numbers. Merging two
    // inventories line by line would invent a third that neither side wrote.
    if (mine[iso]?.length) kept += 1;
    else {
      out[iso] = holdings;
      added += 1;
    }
  }
  return { merged: added ? out : mine, added, kept };
}

/** What an import did, in the terms the panel reports it in. */
export interface ImportReport {
  name: string;
  units: number;
  systemsAdded: number;
  systemsKept: number;
  nationsAdded: number;
  nationsKept: number;
}
