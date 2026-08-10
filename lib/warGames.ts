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
  { id: 'strike-group', label: 'Strike group', abbr: 'CSG', mark: { kind: 'text', text: 'CSG' }, strength: 'Carrier + escorts' },
  { id: 'task-force', label: 'Task force', abbr: 'TF', mark: { kind: 'text', text: 'TF' }, strength: 'Mixed group' },

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
const SHIP_ECHELONS = ['ship', 'pair', 'flotilla', 'squadron-nav', 'task-force'];
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
  unit('carrier', 'Carrier strike group', 'sea', 'carrier', ['strike-group', 'ship', 'task-force'], 'strike-group'),
  unit('amphibious', 'Amphibious ready group', 'sea', 'amphib', ['task-force', 'ship', 'flotilla'], 'task-force'),
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
  unit('sam', 'Air defence site', 'site', 'sam', SITE_ECHELONS, 'battalion'),
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

export interface DeployedUnit {
  id: string;
  typeId: string;
  echelonId: string;
  /** Owner, keyed by the same country id the map paints with. */
  iso: string;
  lngLat: [number, number];
  /** Optional name — falls back to the type label. */
  name?: string;
}

export interface Nation {
  iso: string;
  name: string;
  color: string;
}

export interface BoardState {
  nations: Record<string, Nation>;
  units: DeployedUnit[];
}

export const EMPTY_BOARD: BoardState = { nations: {}, units: [] };

const STORAGE_KEY = 'mapio.wargames.v1';

/** A board survives a reload — losing an hour of pin-placing to F5 is not a game. */
export function loadBoard(): BoardState {
  if (typeof window === 'undefined') return EMPTY_BOARD;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_BOARD;
    const parsed = JSON.parse(raw) as Partial<BoardState>;
    const units = Array.isArray(parsed.units)
      ? parsed.units.filter(
          (u): u is DeployedUnit =>
            !!u &&
            typeof u.id === 'string' &&
            UNIT_BY_ID.has(u.typeId) &&
            Array.isArray(u.lngLat) &&
            u.lngLat.length === 2
        )
      : [];
    return { nations: parsed.nations ?? {}, units };
  } catch (err) {
    console.error('[wargames] saved board could not be read — starting empty.', err);
    return EMPTY_BOARD;
  }
}

export function saveBoard(board: BoardState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch (err) {
    console.error('[wargames] board could not be saved.', err);
  }
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

export function unitLabel(u: DeployedUnit): string {
  if (u.name) return u.name;
  const type = UNIT_BY_ID.get(u.typeId);
  const ech = ECHELON_BY_ID.get(u.echelonId);
  const name = type?.label ?? '';
  if (!ech) return name;
  // "CSG Carrier strike group" says it twice. Where the type already names its
  // own size, the prefix is noise.
  if (name.toLowerCase().includes(ech.label.toLowerCase())) return name;
  return `${ech.abbr} ${name}`.trim();
}
