/**
 * War Games — the sandbox mode.
 *
 * Everything here is *declarative*: what a unit can be, what an echelon means,
 * and which colours a nation may fly. The map code reads this catalogue and the
 * panel renders from the same source, so adding a unit type is a one-line
 * change that shows up in both places.
 *
 * Symbology follows APP-6 loosely rather than exactly: frame shape encodes the
 * domain, the glyph encodes the function, and the mark above the frame encodes
 * size. Strict APP-6 also encodes affiliation in the frame, but here affiliation
 * is the nation's colour — which is the whole point of the mode.
 */

import type { SystemSpec } from './specs';

export type Domain = 'ground' | 'air' | 'sea' | 'sub' | 'site';

export interface DomainSpec {
  id: Domain;
  label: string;
  /** One-line description shown above the unit palette. */
  note: string;
}

export const DOMAINS: DomainSpec[] = [
  { id: 'ground', label: 'Ground', note: 'Manoeuvre, fires and the units that hold terrain' },
  { id: 'air', label: 'Air', note: 'Squadrons and rotary wing' },
  { id: 'sea', label: 'Naval', note: 'Surface combatants and groups' },
  { id: 'sub', label: 'Subsurface', note: 'Submarines' },
  { id: 'site', label: 'Installations', note: 'Fixed sites, sensors and air defence' },
];

/* ------------------------------------------------------------------ */
/* Echelons                                                            */
/* ------------------------------------------------------------------ */

/** How the size mark above the frame is drawn. */
export type EchelonMark =
  | { kind: 'none' }
  | { kind: 'dots'; n: 1 | 2 | 3 }
  | { kind: 'bars'; n: 1 | 2 | 3 }
  | { kind: 'x'; n: 1 | 2 | 3 }
  | { kind: 'text'; text: string };

export interface Echelon {
  id: string;
  label: string;
  /** Short form used in unit labels on the map. */
  abbr: string;
  mark: EchelonMark;
  /** Roughly how many of the thing this echelon is, for the order of battle. */
  strength: string;
}

export const ECHELONS: Echelon[] = [
  { id: 'individual', label: 'Individual', abbr: 'IND', mark: { kind: 'none' }, strength: '1' },
  { id: 'team', label: 'Team', abbr: 'TM', mark: { kind: 'dots', n: 1 }, strength: '4–10' },
  { id: 'squad', label: 'Squad', abbr: 'SQD', mark: { kind: 'dots', n: 2 }, strength: '8–14' },
  { id: 'platoon', label: 'Platoon', abbr: 'PLT', mark: { kind: 'dots', n: 3 }, strength: '20–50' },
  { id: 'company', label: 'Company', abbr: 'COY', mark: { kind: 'bars', n: 1 }, strength: '80–250' },
  { id: 'battery', label: 'Battery', abbr: 'BTY', mark: { kind: 'bars', n: 1 }, strength: '4–8 systems' },
  { id: 'battalion', label: 'Battalion', abbr: 'BN', mark: { kind: 'bars', n: 2 }, strength: '300–1,000' },
  { id: 'regiment', label: 'Regiment', abbr: 'REGT', mark: { kind: 'bars', n: 3 }, strength: '1,000–3,000' },
  { id: 'brigade', label: 'Brigade', abbr: 'BDE', mark: { kind: 'x', n: 1 }, strength: '3,000–5,000' },
  { id: 'division', label: 'Division', abbr: 'DIV', mark: { kind: 'x', n: 2 }, strength: '10,000–20,000' },
  { id: 'corps', label: 'Corps', abbr: 'CORPS', mark: { kind: 'x', n: 3 }, strength: '40,000+' },

  { id: 'aircraft', label: 'Single aircraft', abbr: 'AC', mark: { kind: 'none' }, strength: '1 airframe' },
  { id: 'flight', label: 'Flight', abbr: 'FLT', mark: { kind: 'text', text: '••' }, strength: '2–4 airframes' },
  { id: 'squadron', label: 'Squadron', abbr: 'SQN', mark: { kind: 'text', text: 'SQN' }, strength: '12–24 airframes' },
  { id: 'wing', label: 'Wing', abbr: 'WG', mark: { kind: 'text', text: 'WG' }, strength: '3+ squadrons' },

  { id: 'ship', label: 'Single ship', abbr: 'SHIP', mark: { kind: 'none' }, strength: '1 hull' },
  { id: 'pair', label: 'Pair', abbr: 'PAIR', mark: { kind: 'text', text: '••' }, strength: '2 hulls' },
  { id: 'flotilla', label: 'Flotilla', abbr: 'FLOT', mark: { kind: 'text', text: 'FLOT' }, strength: '4–8 hulls' },
  { id: 'squadron-nav', label: 'Squadron', abbr: 'SQN', mark: { kind: 'text', text: 'SQN' }, strength: '6–12 hulls' },

  { id: 'site', label: 'Site', abbr: 'SITE', mark: { kind: 'none' }, strength: '1 site' },
  { id: 'complex', label: 'Complex', abbr: 'CPLX', mark: { kind: 'text', text: '••' }, strength: 'Several sites' },
];

export const ECHELON_BY_ID = new Map(ECHELONS.map((e) => [e.id, e]));

/* Reusable echelon menus, ordered smallest first. */
const GROUND_ECHELONS = [
  'team',
  'squad',
  'platoon',
  'company',
  'battalion',
  'regiment',
  'brigade',
  'division',
  'corps',
];
const AIR_ECHELONS = ['aircraft', 'flight', 'squadron', 'wing'];
const SHIP_ECHELONS = ['ship', 'pair', 'flotilla', 'squadron-nav'];
const SITE_ECHELONS = ['site', 'battery', 'battalion', 'regiment', 'complex'];

/* ------------------------------------------------------------------ */
/* Unit types                                                          */
/* ------------------------------------------------------------------ */

export interface UnitType {
  id: string;
  label: string;
  domain: Domain;
  /** Which glyph the icon factory draws inside the frame. */
  glyph: string;
  echelons: string[];
  /** Echelon selected when this type is first picked. */
  defaultEchelon: string;
}

const unit = (
  id: string,
  label: string,
  domain: Domain,
  glyph: string,
  echelons: string[],
  defaultEchelon: string
): UnitType => ({ id, label, domain, glyph, echelons, defaultEchelon });

export const UNIT_TYPES: UnitType[] = [
  /* ---- ground ---- */
  unit('infantry', 'Infantry', 'ground', 'infantry', GROUND_ECHELONS, 'battalion'),
  unit('mech-infantry', 'Mechanised infantry', 'ground', 'mech', GROUND_ECHELONS, 'battalion'),
  unit('armour', 'Armour', 'ground', 'armour', GROUND_ECHELONS, 'battalion'),
  unit('recon', 'Reconnaissance', 'ground', 'recon', GROUND_ECHELONS, 'company'),
  unit('airborne', 'Airborne', 'ground', 'airborne', GROUND_ECHELONS, 'brigade'),
  unit('marines', 'Marines / amphibious', 'ground', 'marines', GROUND_ECHELONS, 'brigade'),
  unit('special-forces', 'Special forces', 'ground', 'sf', ['team', 'squad', 'platoon', 'company', 'battalion', 'regiment'], 'team'),
  unit('artillery', 'Artillery', 'ground', 'artillery', GROUND_ECHELONS, 'battalion'),
  unit('rocket', 'Rocket artillery / MLRS', 'ground', 'rocket', GROUND_ECHELONS, 'battalion'),
  unit('missile', 'Ballistic missile', 'ground', 'missile', ['battery', 'battalion', 'regiment', 'brigade'], 'battalion'),
  unit('cruise-missile', 'Cruise missile battery (GLCM)', 'ground', 'missile', ['battery', 'battalion', 'regiment', 'brigade'], 'battery'),
  unit('coastal-missile', 'Coastal anti-ship missile battery', 'site', 'rocket', SITE_ECHELONS, 'battery'),
  unit('mobile-ad', 'Mobile air defence', 'ground', 'airdefence', GROUND_ECHELONS, 'battalion'),
  unit('engineer', 'Engineers', 'ground', 'engineer', GROUND_ECHELONS, 'battalion'),
  unit('ew', 'Electronic warfare', 'ground', 'ew', GROUND_ECHELONS, 'company'),
  unit('logistics', 'Logistics', 'ground', 'logistics', GROUND_ECHELONS, 'battalion'),
  unit('medical', 'Medical', 'ground', 'medical', GROUND_ECHELONS, 'company'),
  unit('hq', 'Headquarters', 'ground', 'hq', GROUND_ECHELONS, 'brigade'),

  /* ---- air ---- */
  unit('fighter', 'Fighter squadron', 'air', 'fighter', AIR_ECHELONS, 'squadron'),
  unit('strike', 'Strike / attack', 'air', 'strike', AIR_ECHELONS, 'squadron'),
  unit('bomber', 'Bomber', 'air', 'bomber', AIR_ECHELONS, 'squadron'),
  unit('awacs', 'AEW&C', 'air', 'awacs', AIR_ECHELONS, 'flight'),
  unit('tanker', 'Air-to-air refuelling', 'air', 'tanker', AIR_ECHELONS, 'flight'),
  unit('airlift', 'Transport / airlift', 'air', 'airlift', AIR_ECHELONS, 'squadron'),
  unit('mpa', 'Maritime patrol', 'air', 'mpa', AIR_ECHELONS, 'flight'),
  unit('uav', 'UAV / drone', 'air', 'uav', AIR_ECHELONS, 'flight'),
  unit('attack-heli', 'Attack helicopters', 'air', 'attackheli', AIR_ECHELONS, 'squadron'),
  unit('transport-heli', 'Transport helicopters', 'air', 'heli', AIR_ECHELONS, 'squadron'),

  /* ---- naval ---- */
  unit('carrier-ship', 'Aircraft carrier', 'sea', 'carrier', SHIP_ECHELONS, 'ship'),
  unit('amphib-ship', 'Amphibious assault ship', 'sea', 'amphib', SHIP_ECHELONS, 'ship'),
  unit('cruiser', 'Cruiser', 'sea', 'cruiser', SHIP_ECHELONS, 'ship'),
  unit('destroyer', 'Destroyer', 'sea', 'destroyer', SHIP_ECHELONS, 'ship'),
  unit('frigate', 'Frigate', 'sea', 'frigate', SHIP_ECHELONS, 'ship'),
  unit('corvette', 'Corvette', 'sea', 'corvette', SHIP_ECHELONS, 'pair'),
  unit('patrol', 'Patrol boat', 'sea', 'patrol', SHIP_ECHELONS, 'flotilla'),
  unit('mine', 'Mine warfare', 'sea', 'mine', SHIP_ECHELONS, 'flotilla'),
  unit('logistics-ship', 'Replenishment / logistics', 'sea', 'oiler', SHIP_ECHELONS, 'ship'),
  unit('support-ship', 'Support / auxiliary', 'sea', 'support', SHIP_ECHELONS, 'ship'),
  unit('intel-ship', 'Intelligence ship', 'sea', 'intel', SHIP_ECHELONS, 'ship'),

  /* ---- subsurface ---- */
  unit('submarine', 'Attack submarine', 'sub', 'sub', SHIP_ECHELONS, 'ship'),
  unit('ssbn', 'Ballistic missile submarine', 'sub', 'ssbn', SHIP_ECHELONS, 'ship'),
  unit('midget-sub', 'Special operations submarine', 'sub', 'midget', SHIP_ECHELONS, 'ship'),

  /* ---- installations ---- */
  unit('radar', 'Radar installation', 'site', 'radar', SITE_ECHELONS, 'site'),
  unit('sam-launcher', 'SAM launcher', 'site', 'sam', SITE_ECHELONS, 'battery'),
  unit('silo', 'Missile silo', 'site', 'silo', SITE_ECHELONS, 'site'),
  unit('airbase', 'Air base', 'site', 'airbase', SITE_ECHELONS, 'site'),
  unit('navalbase', 'Naval base', 'site', 'navalbase', SITE_ECHELONS, 'site'),
  unit('command', 'Command post', 'site', 'command', SITE_ECHELONS, 'site'),
  unit('depot', 'Depot / ammunition', 'site', 'depot', SITE_ECHELONS, 'site'),
  unit('jammer', 'EW / jamming site', 'site', 'ew', SITE_ECHELONS, 'site'),
];

export const UNIT_BY_ID = new Map(UNIT_TYPES.map((u) => [u.id, u]));

export function unitsInDomain(domain: Domain): UnitType[] {
  return UNIT_TYPES.filter((u) => u.domain === domain);
}

export function echelonsFor(type: UnitType): Echelon[] {
  return type.echelons
    .map((id) => ECHELON_BY_ID.get(id))
    .filter((e): e is Echelon => Boolean(e));
}

/* ------------------------------------------------------------------ */
/* Special units                                                       */
/*                                                                     */
/* A unit is one class of thing. A special unit is a formation of      */
/* them: a carrier strike group is a carrier plus the escorts that     */
/* make it a group, and an air defence system is a radar plus the      */
/* launchers it cues and the post that commands them. The catalogue    */
/* below carries a *typical* composition; the player sets the real one */
/* before deploying, because how many destroyers screen a carrier is   */
/* exactly the sort of thing a board is for arguing about.             */
/* ------------------------------------------------------------------ */

export interface Component {
  typeId: string;
  count: number;
  /** Which system these are, when the player has said. Drives specs and stock. */
  systemId?: string;
}

export interface Formation {
  id: string;
  label: string;
  /** Two to five characters, drawn above the icon frame. */
  abbr: string;
  composition: Component[];
  /** Built-ins fix their own look; custom ones derive it from what is in them. */
  domain?: Domain;
  glyph?: string;
  /** Set on formations the player invented, which live on the board. */
  custom?: boolean;
}

const c = (typeId: string, count: number): Component => ({ typeId, count });

export const FORMATIONS: Formation[] = [
  {
    id: 'csg',
    label: 'Carrier strike group',
    abbr: 'CSG',
    domain: 'sea',
    glyph: 'carrier',
    composition: [
      c('carrier-ship', 1),
      c('destroyer', 3),
      c('frigate', 2),
      c('submarine', 1),
      c('logistics-ship', 1),
    ],
  },
  {
    id: 'arg',
    label: 'Amphibious ready group',
    abbr: 'ARG',
    domain: 'sea',
    glyph: 'amphib',
    composition: [c('amphib-ship', 1), c('destroyer', 1), c('frigate', 1), c('marines', 1), c('logistics-ship', 1)],
  },
  {
    id: 'sag',
    label: 'Surface action group',
    abbr: 'SAG',
    domain: 'sea',
    glyph: 'cruiser',
    composition: [c('cruiser', 1), c('destroyer', 2), c('frigate', 1)],
  },
  {
    id: 'hunter-killer',
    label: 'Hunter-killer group',
    abbr: 'HKG',
    domain: 'sub',
    glyph: 'sub',
    composition: [c('submarine', 2), c('mpa', 1), c('frigate', 1)],
  },
  {
    id: 'ads',
    label: 'Air defence system',
    abbr: 'ADS',
    domain: 'site',
    glyph: 'sam',
    composition: [c('radar', 1), c('sam-launcher', 4), c('command', 1)],
  },
  {
    id: 'strike-package',
    label: 'Air strike package',
    abbr: 'PKG',
    domain: 'air',
    glyph: 'strike',
    composition: [c('strike', 4), c('fighter', 2), c('awacs', 1), c('tanker', 1)],
  },
  {
    id: 'battlegroup',
    label: 'Combined arms battlegroup',
    abbr: 'BG',
    domain: 'ground',
    glyph: 'armour',
    composition: [
      c('armour', 2),
      c('mech-infantry', 2),
      c('artillery', 1),
      c('mobile-ad', 1),
      c('engineer', 1),
      c('logistics', 1),
    ],
  },
];

export const FORMATION_BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));

/** Built-ins plus whatever the player has invented. */
export function allFormations(custom: Formation[]): Formation[] {
  return [...FORMATIONS, ...custom];
}

export function findFormation(id: string, custom: Formation[]): Formation | undefined {
  return FORMATION_BY_ID.get(id) ?? custom.find((f) => f.id === id);
}

/**
 * How a formation looks on the map. Built-ins say so outright; a custom one
 * takes the look of whatever it has most of, which is usually the thing the
 * player would have picked anyway — an air strike package of four strike
 * fighters gets a strike fighter in an air frame.
 */
export function formationLook(f: Formation): { domain: Domain; glyph: string } {
  if (f.domain && f.glyph) return { domain: f.domain, glyph: f.glyph };
  let best: UnitType | undefined;
  let bestCount = 0;
  for (const part of f.composition) {
    const type = UNIT_BY_ID.get(part.typeId);
    if (type && part.count > bestCount) {
      best = type;
      bestCount = part.count;
    }
  }
  return { domain: f.domain ?? best?.domain ?? 'ground', glyph: f.glyph ?? best?.glyph ?? 'hq' };
}

/** Initials, for the mark above a custom formation's frame. */
export function deriveAbbr(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'SP';
  const initials = words.map((w) => w[0]).join('').toUpperCase();
  return (initials.length > 1 ? initials : name.toUpperCase()).slice(0, 4);
}

export const totalStrength = (composition: Component[]): number =>
  composition.reduce((sum, part) => sum + Math.max(0, part.count), 0);

/** A one-line composition, for places too small to list it: "3 × Destroyer, …". */
export function describeComposition(composition: Component[], systems: SystemSpec[] = []): string {
  return composition
    .filter((part) => part.count > 0)
    .map(
      (part) =>
        `${part.count} × ${systemName(systems, part.systemId) ?? UNIT_BY_ID.get(part.typeId)?.label ?? part.typeId}`
    )
    .join(', ');
}

/* ------------------------------------------------------------------ */
/* Nation colours                                                      */
/* ------------------------------------------------------------------ */

/**
 * Twelve colours that stay distinct from each other *and* from the map's own
 * palette on a dark basemap. The picker allows anything, but starting from a
 * set that is known to work means most boards look deliberate.
 */
export const NATION_COLORS = [
  '#D9534F',
  '#E8833A',
  '#E4B93C',
  '#8FBF4D',
  '#4FA85F',
  '#3FB0A0',
  '#4F9FD6',
  '#5A6FD6',
  '#8B6FD6',
  '#CE6BB8',
  '#B08968',
  '#9AA7B4',
] as const;

/** Perceived lightness, used to pick a legible glyph colour on any fill. */
export function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Mixes a hex colour towards white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const to = t >= 0 ? 255 : 0;
  const amount = Math.abs(t);
  const channel = (i: number) => {
    const c = parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return Math.round(c + (to - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Colour a unit's glyph so it reads on whatever fill the nation chose. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.42 ? '#0C141D' : '#FFFFFF';
}

/* ------------------------------------------------------------------ */
/* Board state                                                         */
/* ------------------------------------------------------------------ */

/**
 * Something on the board: either one class of unit at a given echelon, or a
 * formation with a composition the player set. The two are a discriminated
 * union rather than one shape with optional fields, so nothing can quietly
 * treat a strike group as if it had an echelon.
 */
interface DeployedBase {
  id: string;
  /** Owner, keyed by the same country id the map paints with. */
  iso: string;
  lngLat: [number, number];
  /** Optional name — falls back to the type or formation label. */
  name?: string;
}

/**
 * One line of a unit's loadout: which round, and how many.
 *
 * `count` is optional because "not recorded" is a real answer — most weapons in
 * the library declare no magazine, and defaulting them to 1 would assert a
 * figure nobody published. Absent means "whatever the spec says", which for most
 * weapons is nothing at all.
 */
export interface LoadoutItem {
  id: string;
  count?: number;
}

export interface DeployedGeneric extends DeployedBase {
  kind: 'unit';
  typeId: string;
  echelonId: string;
  /** The specific system deployed, where one was chosen. */
  systemId?: string;
  /**
   * What this deployment is carrying, and how many of each, when it has been
   * re-armed.
   *
   * Local to the unit on purpose: swapping a Su-30's air-to-air missiles for
   * anti-ship ones changes that one flight's reach and nothing else — not the
   * system, not the library, not the eleven other Su-30s on the board. Absent
   * means it carries whatever its system carries as standard.
   */
  loadout?: LoadoutItem[];
  /** How many. This is the number national stock is drawn down by. */
  count: number;
}

export interface DeployedFormation extends DeployedBase {
  kind: 'formation';
  formationId: string;
  /** This deployment's own composition, not the catalogue's. */
  composition: Component[];
}

export type DeployedUnit = DeployedGeneric | DeployedFormation;

export interface Nation {
  iso: string;
  name: string;
  color: string;
}

export interface BoardState {
  nations: Record<string, Nation>;
  units: DeployedUnit[];
  /** Special units the player invented. Built-ins are in FORMATIONS. */
  formations: Formation[];
}

export const EMPTY_BOARD: BoardState = { nations: {}, units: [], formations: [] };

/** Where boards lived before configuration moved to the document store. */
export const LEGACY_BOARD_KEY = 'mapio.wargames.v1';

/**
 * Boards written before special units existed have no `kind`, and three of
 * their unit types have since become formations. Rather than drop those pins
 * on the floor, they are read as the formation they always meant.
 */
const RETIRED_TYPES: Record<string, string> = {
  carrier: 'csg',
  amphibious: 'arg',
  sam: 'ads',
};

function reviveUnit(raw: unknown, custom: Formation[]): DeployedUnit | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const id = typeof u.id === 'string' ? u.id : null;
  const iso = typeof u.iso === 'string' ? u.iso : null;
  const lngLat = Array.isArray(u.lngLat) && u.lngLat.length === 2 ? (u.lngLat as [number, number]) : null;
  if (!id || !iso || !lngLat) return null;
  const name = typeof u.name === 'string' ? u.name : undefined;

  const formationId =
    typeof u.formationId === 'string'
      ? u.formationId
      : typeof u.typeId === 'string'
        ? RETIRED_TYPES[u.typeId]
        : undefined;

  if (u.kind === 'formation' || formationId) {
    const formation = formationId ? findFormation(formationId, custom) : undefined;
    if (!formation) return null;
    const composition = Array.isArray(u.composition)
      ? (u.composition as Component[])
          .filter((p) => p && UNIT_BY_ID.has(p.typeId))
          .map((p) => ({ typeId: p.typeId, count: p.count, systemId: p.systemId }))
      : formation.composition;
    return { kind: 'formation', id, iso, lngLat, name, formationId: formation.id, composition };
  }

  const typeId = typeof u.typeId === 'string' ? u.typeId : null;
  if (!typeId || !UNIT_BY_ID.has(typeId)) return null;
  const type = UNIT_BY_ID.get(typeId)!;
  const echelonId =
    typeof u.echelonId === 'string' && type.echelons.includes(u.echelonId)
      ? u.echelonId
      : type.defaultEchelon;
  // Boards written before counts existed are one of whatever they were.
  const count = typeof u.count === 'number' && u.count > 0 ? Math.round(u.count) : 1;
  const systemId = typeof u.systemId === 'string' ? u.systemId : undefined;
  // An empty array is a real state — a unit deliberately carrying nothing — and
  // must survive the round trip distinctly from "never re-armed".
  //
  // Loadouts were once a bare list of munition ids, before counts existed. Those
  // still load: a string becomes one line with no count recorded, which is
  // exactly what it meant.
  const loadout = Array.isArray(u.loadout)
    ? u.loadout
        .map((entry): LoadoutItem | null => {
          if (typeof entry === 'string') return { id: entry };
          if (!entry || typeof entry !== 'object') return null;
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== 'string') return null;
          const count =
            typeof item.count === 'number' && item.count >= 0 ? Math.round(item.count) : undefined;
          return { id: item.id, count };
        })
        .filter((m): m is LoadoutItem => m !== null)
    : undefined;
  return { kind: 'unit', id, iso, lngLat, name, typeId, echelonId, systemId, loadout, count };
}

function reviveFormation(raw: unknown): Formation | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || typeof f.label !== 'string') return null;
  const composition = Array.isArray(f.composition)
    ? (f.composition as Component[]).filter((p) => p && UNIT_BY_ID.has(p.typeId) && p.count > 0)
    : [];
  if (!composition.length) return null;
  return {
    id: f.id,
    label: f.label,
    abbr: typeof f.abbr === 'string' ? f.abbr : deriveAbbr(f.label),
    composition,
    custom: true,
  };
}

/**
 * Rebuilds a board from whatever was stored, discarding anything that no longer
 * makes sense. Storage is somebody else's problem — see `lib/store.ts` — so this
 * stays a pure function and can be pointed at a file, a browser or a server.
 */
export function reviveBoard(parsed: unknown): BoardState {
  if (!parsed || typeof parsed !== 'object') return EMPTY_BOARD;
  const raw = parsed as Record<string, unknown>;

  const formations = Array.isArray(raw.formations)
    ? raw.formations.map(reviveFormation).filter((f): f is Formation => Boolean(f))
    : [];
  const units = Array.isArray(raw.units)
    ? raw.units.map((u) => reviveUnit(u, formations)).filter((u): u is DeployedUnit => Boolean(u))
    : [];

  return {
    nations: (raw.nations as BoardState['nations']) ?? {},
    units,
    formations,
  };
}

let counter = 0;
export function nextUnitId(): string {
  counter += 1;
  return `u${Date.now().toString(36)}${counter.toString(36)}`;
}

/** The icon image id for a (type, colour) pair — one image per combination. */
export function iconId(typeId: string, color: string): string {
  return `wg:${typeId}:${color.replace('#', '')}`;
}

const systemName = (systems: SystemSpec[] | undefined, id: string | undefined) =>
  id ? systems?.find((s) => s.id === id)?.name : undefined;

/**
 * What a deployed thing is called. A count leads, because "12 x F-16C" is the
 * fact you want first; without one the echelon leads, as before.
 */
export function unitLabel(
  u: DeployedUnit,
  custom: Formation[] = [],
  systems: SystemSpec[] = [],
  allUnits?: DeployedUnit[]
): string {
  if (u.name) return u.name;
  if (u.kind === 'formation') {
    return findFormation(u.formationId, custom)?.label ?? 'Special unit';
  }

  const base = systemName(systems, u.systemId) ?? UNIT_BY_ID.get(u.typeId)?.label ?? '';
  let label = base;
  if (u.count > 1) {
    label = `${u.count} × ${base}`;
  } else {
    const ech = ECHELON_BY_ID.get(u.echelonId);
    if (ech && !base.toLowerCase().includes(ech.label.toLowerCase())) {
      label = `${ech.abbr} ${base}`.trim();
    }
  }

  if (allUnits && allUnits.length > 1) {
    const sameClassUnits = allUnits.filter(
      (other) =>
        other.kind === 'unit' &&
        other.iso === u.iso &&
        other.typeId === u.typeId &&
        other.systemId === u.systemId &&
        !other.name
    );
    if (sameClassUnits.length > 1) {
      const idx = sameClassUnits.findIndex((x) => x.id === u.id);
      if (idx !== -1) {
        label = `${label}-${idx + 1}`;
      }
    }
  }

  return label;
}

/** The icon a deployed thing draws, whichever kind it is. */
export function unitLook(
  u: DeployedUnit,
  custom: Formation[]
): { key: string; domain: Domain; glyph: string; mark: EchelonMark } | null {
  if (u.kind === 'formation') {
    const formation = findFormation(u.formationId, custom);
    if (!formation) return null;
    const look = formationLook(formation);
    return {
      key: `f:${formation.id}`,
      domain: look.domain,
      glyph: look.glyph,
      mark: { kind: 'text', text: formation.abbr },
    };
  }
  const type = UNIT_BY_ID.get(u.typeId);
  if (!type) return null;
  return {
    key: u.typeId,
    domain: type.domain,
    glyph: type.glyph,
    mark: ECHELON_BY_ID.get(u.echelonId)?.mark ?? { kind: 'none' },
  };
}
