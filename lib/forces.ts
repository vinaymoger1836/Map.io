/**
 * What each nation owns, against what it has put on the board.
 *
 * This is configuration, not board state: it lives beside the systems library
 * rather than inside a scenario, so switching boards does not make a country
 * forget its army. Nothing here models basing, readiness or transit — it is
 * national bookkeeping, and it stops the map fielding six carriers a country
 * does not have.
 *
 * Opt-in by nation. A country with no holdings recorded deploys without limit,
 * which is what every board did before this existed.
 */

import type { BoardState, DeployedUnit } from './warGames';
import type { SystemSpec } from './specs';

export interface Holding {
  /** The unit type, always — it decides the symbol and the palette slot. */
  typeId: string;
  /** The specific system, when the holding is of one. */
  systemId?: string;
  /** How many the nation owns. */
  count: number;
}

/** Holdings by country id, the same key the map paints by. */
export type Forces = Record<string, Holding[]>;

export const EMPTY_FORCES: Forces = {};

/**
 * Built-in default country pre-assigned systems library templates
 * Used when a country has not yet had custom holdings pre-assigned in configuration.
 */
export const DEFAULT_COUNTRY_SYSTEM_TEMPLATES: Record<string, { systemKeyword: string; defaultCount: number }[]> = {
  US: [
    { systemKeyword: 'f-35', defaultCount: 24 },
    { systemKeyword: 'f-22', defaultCount: 12 },
    { systemKeyword: 'f-15', defaultCount: 18 },
    { systemKeyword: 'f-16', defaultCount: 24 },
    { systemKeyword: 'burke', defaultCount: 4 },
    { systemKeyword: 'patriot', defaultCount: 4 },
    { systemKeyword: 'abrams', defaultCount: 40 },
    { systemKeyword: 'himars', defaultCount: 8 },
    { systemKeyword: 'virginia', defaultCount: 2 },
  ],
  RU: [
    { systemKeyword: 'su-35', defaultCount: 24 },
    { systemKeyword: 'su-57', defaultCount: 8 },
    { systemKeyword: 'su-30', defaultCount: 16 },
    { systemKeyword: 's-400', defaultCount: 4 },
    { systemKeyword: 'gorshkov', defaultCount: 3 },
    { systemKeyword: 't-90', defaultCount: 40 },
    { systemKeyword: 'iskander', defaultCount: 6 },
    { systemKeyword: 'pantsir', defaultCount: 6 },
    { systemKeyword: 'yasen', defaultCount: 2 },
  ],
  CN: [
    { systemKeyword: 'j-20', defaultCount: 24 },
    { systemKeyword: 'j-16', defaultCount: 16 },
    { systemKeyword: 'type-055', defaultCount: 2 },
    { systemKeyword: '052d', defaultCount: 4 },
    { systemKeyword: 'hq-9', defaultCount: 4 },
    { systemKeyword: 'df-21', defaultCount: 6 },
    { systemKeyword: 'type-99', defaultCount: 40 },
  ],
  IN: [
    { systemKeyword: 'su-30', defaultCount: 24 },
    { systemKeyword: 'rafale', defaultCount: 12 },
    { systemKeyword: 'tejas', defaultCount: 18 },
    { systemKeyword: 's-400', defaultCount: 4 },
    { systemKeyword: 'kolkata', defaultCount: 3 },
    { systemKeyword: 'vikrant', defaultCount: 1 },
    { systemKeyword: 'brahmos', defaultCount: 8 },
    { systemKeyword: 't-90', defaultCount: 40 },
  ],
  PK: [
    { systemKeyword: 'jf-17', defaultCount: 24 },
    { systemKeyword: 'f-16', defaultCount: 12 },
    { systemKeyword: 'hq-9', defaultCount: 4 },
    { systemKeyword: 'al-khalid', defaultCount: 40 },
    { systemKeyword: 'babur', defaultCount: 6 },
  ],
  UA: [
    { systemKeyword: 'su-27', defaultCount: 12 },
    { systemKeyword: 'mig-29', defaultCount: 12 },
    { systemKeyword: 'patriot', defaultCount: 2 },
    { systemKeyword: 'himars', defaultCount: 8 },
    { systemKeyword: 'leopard', defaultCount: 20 },
  ],
  IL: [
    { systemKeyword: 'f-35', defaultCount: 24 },
    { systemKeyword: 'f-15', defaultCount: 12 },
    { systemKeyword: 'f-16', defaultCount: 24 },
    { systemKeyword: 'iron-dome', defaultCount: 6 },
    { systemKeyword: 'patriot', defaultCount: 4 },
    { systemKeyword: 'saar', defaultCount: 3 },
    { systemKeyword: 'merkava', defaultCount: 40 },
  ],
  IR: [
    { systemKeyword: 'su-35', defaultCount: 12 },
    { systemKeyword: 'f-14', defaultCount: 12 },
    { systemKeyword: 's-300', defaultCount: 4 },
    { systemKeyword: 'fateh', defaultCount: 12 },
    { systemKeyword: 'karrar', defaultCount: 30 },
  ],
  GB: [
    { systemKeyword: 'typhoon', defaultCount: 24 },
    { systemKeyword: 'f-35', defaultCount: 12 },
    { systemKeyword: 'type-45', defaultCount: 2 },
    { systemKeyword: 'astute', defaultCount: 1 },
    { systemKeyword: 'challenger', defaultCount: 30 },
  ],
  FR: [
    { systemKeyword: 'rafale', defaultCount: 24 },
    { systemKeyword: 'mirage', defaultCount: 12 },
    { systemKeyword: 'fremm', defaultCount: 3 },
    { systemKeyword: 'suffren', defaultCount: 1 },
    { systemKeyword: 'leclerc', defaultCount: 30 },
  ],
  DE: [
    { systemKeyword: 'eurofighter', defaultCount: 24 },
    { systemKeyword: 'f-35', defaultCount: 12 },
    { systemKeyword: 'sachsen', defaultCount: 2 },
    { systemKeyword: 'patriot', defaultCount: 4 },
    { systemKeyword: 'leopard', defaultCount: 40 },
  ],
  TW: [
    { systemKeyword: 'f-16', defaultCount: 24 },
    { systemKeyword: 'mirage', defaultCount: 12 },
    { systemKeyword: 'patriot', defaultCount: 4 },
    { systemKeyword: 'm1a2', defaultCount: 30 },
    { systemKeyword: 'hsiung-feng', defaultCount: 8 },
  ],
  JP: [
    { systemKeyword: 'f-35', defaultCount: 24 },
    { systemKeyword: 'f-15', defaultCount: 24 },
    { systemKeyword: 'maya', defaultCount: 2 },
    { systemKeyword: 'patriot', defaultCount: 4 },
    { systemKeyword: 'type-10', defaultCount: 30 },
  ],
};

/**
 * Returns pre-assigned system quotas (systemId -> count) for a given nation ISO.
 * 1. Checks `forces[iso]` for any user-assigned holdings.
 * 2. If none exist, finds template systems by keywords in the systems library.
 * 3. Falls back to matching systems whose `origin` matches the country.
 */
export function getPreAssignedQuotasForCountry(
  iso: string,
  forces: Forces,
  systemsLibrary: SystemSpec[]
): Record<string, number> {
  const customHoldings = forces[iso] ?? [];
  const validCustom = customHoldings.filter((h) => h.systemId && h.count > 0);

  if (validCustom.length > 0) {
    const quotas: Record<string, number> = {};
    for (const h of validCustom) {
      if (h.systemId) {
        quotas[h.systemId] = h.count;
      }
    }
    return quotas;
  }

  // Check built-in template
  const upperIso = (iso || '').toUpperCase();
  const template = DEFAULT_COUNTRY_SYSTEM_TEMPLATES[upperIso];
  const outQuotas: Record<string, number> = {};

  if (template) {
    for (const item of template) {
      const match = systemsLibrary.find(
        (s) => s.id.toLowerCase().includes(item.systemKeyword.toLowerCase()) ||
               s.name.toLowerCase().includes(item.systemKeyword.toLowerCase())
      );
      if (match && !outQuotas[match.id]) {
        outQuotas[match.id] = item.defaultCount;
      }
    }
  }

  if (Object.keys(outQuotas).length > 0) {
    return outQuotas;
  }

  // Fallback: match by origin in library
  const originMatches = systemsLibrary.filter(
    (s) => s.origin && (s.origin.toLowerCase().includes(iso.toLowerCase()) || iso.toLowerCase().includes(s.origin.toLowerCase()))
  );
  if (originMatches.length > 0) {
    originMatches.slice(0, 6).forEach((s) => {
      const count = s.typeId === 'armour' ? 40 : s.typeId === 'fighter' ? 24 : s.typeId === 'sam-launcher' ? 4 : 2;
      outQuotas[s.id] = count;
    });
    return outQuotas;
  }

  // Generic standard fallback
  const ftr = systemsLibrary.find((s) => s.typeId === 'fighter');
  const sam = systemsLibrary.find((s) => s.typeId === 'sam-launcher');
  const shp = systemsLibrary.find((s) => s.typeId === 'destroyer' || s.typeId === 'frigate');
  const arm = systemsLibrary.find((s) => s.typeId === 'armour');
  if (ftr) outQuotas[ftr.id] = 24;
  if (sam) outQuotas[sam.id] = 4;
  if (shp) outQuotas[shp.id] = 2;
  if (arm) outQuotas[arm.id] = 40;

  return outQuotas;
}

/**
 * What a holding is *of*.
 *
 * A nation may hold 40 Su-30MKI and, separately, 12 unspecified fighters; those
 * are different stock and draw down independently. Keying on the system where
 * there is one, and the bare type otherwise, keeps them apart — and matches
 * exactly what a deployment records about itself.
 */
export const holdingKey = (typeId: string, systemId?: string): string =>
  systemId ? `sys:${systemId}` : `type:${typeId}`;

export const keyOf = (h: Holding): string => holdingKey(h.typeId, h.systemId);

/** Everything a single deployment consumes, flattened. A special unit spends
    its components, not itself. */
export function costOf(unit: DeployedUnit): { key: string; count: number }[] {
  if (unit.kind === 'formation') {
    return unit.composition
      .filter((part) => part.count > 0)
      .map((part) => ({ key: holdingKey(part.typeId, part.systemId), count: part.count }));
  }
  return [{ key: holdingKey(unit.typeId, unit.systemId), count: unit.count }];
}

/** How much of each holding the board has committed, for one nation. */
export function deployedByKey(board: BoardState, iso: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const unit of board.units) {
    if (unit.iso !== iso) continue;
    for (const { key, count } of costOf(unit)) {
      out.set(key, (out.get(key) ?? 0) + count);
    }
  }
  return out;
}

export interface Tally {
  holding: Holding;
  held: number;
  deployed: number;
  left: number;
}

/**
 * Held, deployed and remaining for one nation — including anything on the board
 * that has no holding recorded, which shows as held 0 and a negative remainder.
 * Silently hiding it would let a nation field what it does not own the moment
 * an inventory is written after the fact.
 */
export function tally(forces: Forces, board: BoardState, iso: string): Tally[] {
  const deployed = deployedByKey(board, iso);
  const holdings = forces[iso] ?? [];
  const seen = new Set<string>();

  const rows: Tally[] = holdings.map((holding) => {
    const key = keyOf(holding);
    seen.add(key);
    const out = deployed.get(key) ?? 0;
    return { holding, held: holding.count, deployed: out, left: holding.count - out };
  });

  // On the board but not in the inventory.
  for (const unit of board.units) {
    if (unit.iso !== iso) continue;
    const parts =
      unit.kind === 'formation'
        ? unit.composition.filter((p) => p.count > 0).map((p) => ({ typeId: p.typeId, systemId: p.systemId }))
        : [{ typeId: unit.typeId, systemId: unit.systemId }];
    for (const part of parts) {
      const key = holdingKey(part.typeId, part.systemId);
      if (seen.has(key)) continue;
      seen.add(key);
      const out = deployed.get(key) ?? 0;
      rows.push({ holding: { ...part, count: 0 }, held: 0, deployed: out, left: -out });
    }
  }

  return rows;
}

/**
 * How many of a thing the nation can still deploy.
 *
 * `null` means no limit — either the nation keeps no inventory at all, or it
 * keeps one that says nothing about this particular item. Both are "we are not
 * tracking this", and neither should block anything.
 */
export function remaining(
  forces: Forces,
  board: BoardState,
  iso: string | null,
  typeId: string,
  systemId?: string
): number | null {
  if (!iso) return null;
  const holdings = forces[iso];
  if (!holdings?.length) return null;
  const key = holdingKey(typeId, systemId);
  const holding = holdings.find((h) => keyOf(h) === key);
  if (!holding) return null;
  return holding.count - (deployedByKey(board, iso).get(key) ?? 0);
}

/**
 * Whether a whole deployment fits, and what stopped it if not.
 *
 * A special unit is checked as a basket: every component must fit, because
 * deploying half a carrier group is not a thing the board can represent.
 */
export function canAfford(
  forces: Forces,
  board: BoardState,
  iso: string,
  cost: { key: string; count: number }[]
): { ok: true } | { ok: false; short: string[] } {
  const holdings = forces[iso];
  if (!holdings?.length) return { ok: true };

  const deployed = deployedByKey(board, iso);
  const short: string[] = [];
  for (const { key, count } of cost) {
    const holding = holdings.find((h) => keyOf(h) === key);
    if (!holding) continue; // not tracked, so not limited
    if (holding.count - (deployed.get(key) ?? 0) < count) short.push(key);
  }
  return short.length ? { ok: false, short } : { ok: true };
}

/* ------------------------------------------------------------------ */

/** Brings a stored forces document up to shape, dropping anything malformed. */
export function reviveForces(parsed: unknown): Forces {
  if (!parsed || typeof parsed !== 'object') return EMPTY_FORCES;
  const out: Forces = {};
  for (const [iso, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    const holdings: Holding[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const h = entry as Record<string, unknown>;
      if (typeof h.typeId !== 'string') continue;
      const count = typeof h.count === 'number' && h.count >= 0 ? Math.round(h.count) : 0;
      const systemId = typeof h.systemId === 'string' ? h.systemId : undefined;
      // One line per thing held; a duplicate would make the sums ambiguous.
      const key = holdingKey(h.typeId, systemId);
      if (holdings.some((x) => keyOf(x) === key)) continue;
      holdings.push({ typeId: h.typeId, systemId, count });
    }
    if (holdings.length) out[iso] = holdings;
  }
  return out;
}

export interface ArsenalPackage {
  format: 'mapio-arsenal-package';
  version: 1;
  exportedAt: string;
  description?: string;
  systems: SystemSpec[];
  forces: Forces;
  metadata?: {
    systemsCount: number;
    customSystemsCount: number;
    nationsCount: number;
    totalHoldingsCount: number;
  };
}

/**
 * Merges incoming Forces into existing Forces without losing other countries.
 * For countries present in both, holdings are merged by their holding key.
 */
export function mergeForces(
  existing: Forces,
  incoming: Forces
): { merged: Forces; addedCount: number; nationsCount: number } {
  const merged: Forces = { ...existing };
  let addedCount = 0;
  const affectedNations = new Set<string>();

  for (const [iso, holdings] of Object.entries(incoming)) {
    if (!Array.isArray(holdings) || holdings.length === 0) continue;
    const upperIso = iso.toUpperCase();
    affectedNations.add(upperIso);
    const curr = [...(merged[upperIso] || [])];

    for (const h of holdings) {
      const key = keyOf(h);
      const idx = curr.findIndex((x) => keyOf(x) === key);
      if (idx >= 0) {
        curr[idx] = { ...h };
      } else {
        curr.push({ ...h });
      }
      addedCount++;
    }
    merged[upperIso] = curr;
  }

  return {
    merged,
    addedCount,
    nationsCount: affectedNations.size,
  };
}

/**
 * Builds a portable Arsenal Package containing weapon systems specs and national ORBAT holdings.
 */
export function buildArsenalPackage(
  systems: SystemSpec[],
  forces: Forces,
  options?: {
    customOnly?: boolean;
    iso?: string;
    description?: string;
  }
): ArsenalPackage {
  const targetSystems = options?.customOnly
    ? systems.filter((s) => s.custom)
    : systems;

  let targetForces: Forces = forces;
  if (options?.iso) {
    const upper = options.iso.toUpperCase();
    targetForces = forces[upper] ? { [upper]: forces[upper] } : {};
  }

  const nationsCount = Object.keys(targetForces).length;
  let totalHoldingsCount = 0;
  Object.values(targetForces).forEach((list) => {
    totalHoldingsCount += list.length;
  });

  return {
    format: 'mapio-arsenal-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    description:
      options?.description ||
      'Map.io Tactical Weapon Systems & National Arsenals ORBAT Package',
    systems: targetSystems,
    forces: targetForces,
    metadata: {
      systemsCount: targetSystems.length,
      customSystemsCount: targetSystems.filter((s) => s.custom).length,
      nationsCount,
      totalHoldingsCount,
    },
  };
}

