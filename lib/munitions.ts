/**
 * The munitions catalogue, derived rather than authored.
 *
 * Nobody types this list. Every weapon on every system is a row in it, keyed by
 * the munition's own id — which is why the research prompt insists the same
 * round gets the same id everywhere, and why the validator fails a file where an
 * SM-6 reaches 240 km from one hull and 370 km from another.
 *
 * What it buys: a deployed unit can be re-armed from the list of rounds that
 * something like it actually carries, and its rings redraw from the new figures.
 */

import { domainOf, type SystemSpec, type WeaponFacet } from './specs';
import type { Domain } from './warGames';

export interface Munition {
  id: string;
  name: string;
  /** Canonical figures — identical across platforms, which is enforced. */
  weapon: WeaponFacet;
  /** System ids known to carry it, for "who else has this". */
  carriedBy: string[];
  /** Domains those systems belong to. */
  domains: Domain[];
}

/**
 * A munition's key. Prefers the declared id; falls back to a slug of the name,
 * so the rounds researched before the id field existed still take part instead
 * of silently vanishing from the catalogue.
 */
export function munitionId(weapon: WeaponFacet): string | undefined {
  if (weapon.id) return weapon.id;
  if (!weapon.name) return undefined;
  return weapon.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export type MunitionCatalogue = Map<string, Munition>;

export function buildMunitions(systems: SystemSpec[]): MunitionCatalogue {
  const out: MunitionCatalogue = new Map();
  for (const spec of systems) {
    const domain = domainOf(spec);
    for (const weapon of spec.weapons ?? []) {
      const id = munitionId(weapon);
      if (!id) continue;
      const held = out.get(id);
      if (held) {
        if (!held.carriedBy.includes(spec.id)) held.carriedBy.push(spec.id);
        if (!held.domains.includes(domain)) held.domains.push(domain);
      } else {
        out.set(id, {
          id,
          name: weapon.name ?? id,
          weapon,
          carriedBy: [spec.id],
          domains: [domain],
        });
      }
    }
  }
  return out;
}

/**
 * What a system may be armed with.
 *
 * Two rules, in order. If the system declares `compatible`, that is the answer —
 * exact, and worth filling in for the airframes you care about. Otherwise it is
 * inferred: any round carried by something in the same domain. That is right at
 * the domain level and free, which is the trade — it will not put a Tomahawk on
 * a MiG or a Meteor in a VLS cell, but it will offer a Rafale an R-37M it cannot
 * actually carry. Declaring `compatible` on that airframe is how you fix it.
 */
export function compatibleMunitions(catalogue: MunitionCatalogue, spec: SystemSpec | undefined): Munition[] {
  if (!spec) return [];
  const byName = (a: Munition, b: Munition) => a.name.localeCompare(b.name);

  if (spec.compatible?.length) {
    return spec.compatible
      .map((id) => catalogue.get(id))
      .filter((m): m is Munition => Boolean(m))
      .sort(byName);
  }

  const domain = domainOf(spec);
  return [...catalogue.values()].filter((m) => m.domains.includes(domain)).sort(byName);
}

/** True when the deployed unit is carrying something other than its system's own fit. */
export function isRearmed(spec: SystemSpec | undefined, loadout: string[] | undefined): boolean {
  if (!loadout) return false;
  const stock = (spec?.weapons ?? []).map(munitionId).filter(Boolean) as string[];
  if (stock.length !== loadout.length) return true;
  return [...stock].sort().join('|') !== [...loadout].sort().join('|');
}

/** The munition ids a system carries as standard. */
export function stockLoadout(spec: SystemSpec | undefined): string[] {
  return ((spec?.weapons ?? []).map(munitionId).filter(Boolean) as string[]);
}

/**
 * The system as this particular deployment is armed.
 *
 * Local to the unit: re-arming one Su-30 does not touch the system, the library,
 * or the other eleven Su-30s on the board. Everything downstream — rings,
 * tooltips, the spec sheet — reads the effective spec, so a swapped weapon
 * changes what the map draws without any of them knowing about loadouts.
 */
export function effectiveSpec(
  spec: SystemSpec | undefined,
  loadout: string[] | undefined,
  catalogue: MunitionCatalogue
): SystemSpec | undefined {
  if (!spec || !loadout) return spec;
  const weapons = loadout
    .map((id) => catalogue.get(id)?.weapon)
    .filter((w): w is WeaponFacet => Boolean(w));
  // An empty loadout is a real state — a fighter flying clean — and must not be
  // mistaken for "no loadout recorded, use the system's own".
  return { ...spec, weapons };
}
