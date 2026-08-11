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
