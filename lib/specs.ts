/**
 * What a system actually is.
 *
 * A unit type says what symbol to draw; a *system* says what the thing can do —
 * an S-400 battalion, an F-16C, an Arleigh Burke. Specs hang off systems, and a
 * deployed unit points at one.
 *
 * The shape is deliberately facet-based rather than one schema per class. Every
 * system has the same optional capability slots and fills the ones that apply:
 * an S-400 fills sensor and weapons, a fighter fills platform and weapons, a
 * destroyer fills all of them, a supply truck fills none. Everything downstream
 * — coverage rings, inventory, engagement maths — reads facets, so a system
 * invented tomorrow gets all of it without a line of new code. The alternative,
 * bespoke fields per class, would make every feature a switch over fifty cases.
 *
 * Figures are approximate by nature: open sources disagree about the same
 * system, and some numbers are estimates of things nobody publishes. Every
 * field can therefore carry its source and a confidence, and the interface
 * shows them rather than presenting a guess as a fact.
 */

import { UNIT_BY_ID, type Domain } from './warGames';

/**
 * What a sensor can see or a weapon can shoot at.
 *
 * `air` is everything that flies aerodynamically — aircraft, but also cruise
 * missiles and drones, which is most of what an air-defence system would
 * actually be shooting at. Ballistic is separate because it is a different
 * engagement problem entirely: boosted, then coasting on an unpowered arc, and
 * re-entering steeply at Mach 5 and up.
 *
 * Ballistic is split by the class of threat, because a Patriot PAC-3 at 45 km
 * and an SM-3 at 1,200 km are not answering the same question and a single
 * `ballistic` tag made the map claim they were.
 */
export type TargetClass =
  | 'air'
  | 'ballistic-short'
  | 'ballistic-medium'
  | 'ballistic-imrbm'
  | 'surface'
  | 'ground'
  | 'subsurface';

export const TARGET_CLASSES: { id: TargetClass; label: string; hint: string }[] = [
  { id: 'air', label: 'Air', hint: 'Aircraft, cruise missiles and drones — anything that flies on wings' },
  { id: 'ballistic-short', label: 'SRBM', hint: 'Battlefield rockets and short-range ballistic missiles' },
  { id: 'ballistic-medium', label: 'MRBM', hint: 'Medium-range, theatre ballistic missiles' },
  { id: 'ballistic-imrbm', label: 'IRBM+', hint: 'Intermediate-range and above, engaged outside the atmosphere' },
  { id: 'surface', label: 'Ships', hint: 'Surface vessels' },
  { id: 'ground', label: 'Ground', hint: 'Land targets — fixed sites, formations, infrastructure' },
  { id: 'subsurface', label: 'Submarines', hint: 'Submerged contacts' },
];

/** The ballistic tiers, in ascending order of threat — grouped in the UI. */
export const BALLISTIC_CLASSES = [
  'ballistic-short',
  'ballistic-medium',
  'ballistic-imrbm',
] as const satisfies readonly TargetClass[];

export const isBallistic = (t: TargetClass): boolean =>
  (BALLISTIC_CLASSES as readonly string[]).includes(t);

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Where a figure came from.
 *
 * `placeholder` is the important one: a kill probability nobody publishes is not
 * a weak source, it is an absent one, and the interface should say so rather
 * than dressing an estimate up as a reference.
 */
export interface SourceRef {
  kind: 'manufacturer' | 'government' | 'reference' | 'press' | 'placeholder';
  title: string;
  url?: string;
  /** What the figure assumes, or how much sources disagree. */
  note?: string;
}

export interface Provenance {
  /** A bare string is a legacy entry: a category, not a citation. */
  source: string | SourceRef;
  confidence: Confidence;
}

export const sourceRef = (p: Provenance): SourceRef =>
  typeof p.source === 'string'
    ? { kind: 'placeholder', title: p.source }
    : p.source;

/** True when the figure can actually be traced back to something. */
export const isCited = (p: Provenance): boolean =>
  typeof p.source !== 'string' && Boolean(p.source.url);

/** Subsurface acoustic sensor suite for Anti-Submarine Warfare (ASW) and submarine duels. */
export interface SonarFacet {
  /** Sonar technology and transducer placement */
  type?: 'passive' | 'active' | 'towed_vds' | 'dipping' | 'flank_array' | 'hull_mounted' | 'sonobuoy_field';
  /** Acoustic search / track acquisition range against submerged submarine threats (km) */
  detectionKm?: number;
  /** High-frequency acoustic torpedo warning detection envelope (km) */
  torpedoWarningKm?: number;
  /** Maximum simultaneous underwater acoustic tracks */
  tracks?: number;
}

/** Anything that looks — a radar, a sonar, an AEW&C aircraft. */
export interface SensorFacet {
  /** Instrumented detection range against its primary target class. */
  detectionKm: number;
  /** Targets held at once. */
  tracks?: number;
  /** Fire channels — how many engagements can run simultaneously. */
  engagements?: number;
  sees?: TargetClass[];
  /** True for surface-based radars, whose reach against low flyers is cut by the earth's curve. */
  horizonLimited?: boolean;
  /** Height of the antenna, for that horizon calculation. */
  antennaM?: number;
  /** Dedicated subsurface sonar suite */
  sonar?: SonarFacet;
}

/** Anything that shoots. A destroyer has several; a fighter carries a loadout. */
export interface WeaponFacet {
  /**
   * Slug of the munition itself, shared across every platform carrying it:
   * an SM-6 is `sm-6` on a Burke and on a Ticonderoga. This is what will let
   * armament be swapped from a catalogue rather than retyped per system.
   */
  id?: string;
  name?: string;
  rangeKm: number;
  minRangeKm?: number;
  /** Launch mass of one round. */
  massKg?: number;
  /** Flight speed of the munition in Mach (e.g. 0.88 subsonic, 2.8 supersonic, 6.0 hypersonic). */
  speedMach?: number;
  /** Underwater speed of torpedoes in Knots (e.g. 50–70 kts). */
  speedKnots?: number;
  /** Rounds committed per engagement. */
  salvo?: number;
  /** Ready rounds before reloading — VLS cells, launcher rails, hardpoints. */
  magazine?: number;
  /** Single-shot kill probability, 0–1. The most arguable number in the file. */
  pk?: number;
  /** Detection to launch, in seconds. */
  reactionSec?: number;
  engages?: TargetClass[];
}

/**
 * Fallback researched military sonar characteristics when a platform does not have
 * explicit sonar values configured in its SystemSpec.
 */
export function defaultSonarFor(spec: SystemSpec | undefined, typeId: string): SonarFacet {
  if (spec?.sensor?.sonar?.detectionKm) {
    return spec.sensor.sonar;
  }

  const tid = typeId.toLowerCase();
  const name = (spec?.name ?? '').toLowerCase();

  // Nuclear Attack Submarines (SSN / SSGN)
  if (tid === 'submarine' && (name.includes('nuclear') || name.includes('ssn') || name.includes('ssgn') || name.includes('virginia') || name.includes('astute') || name.includes('yasen') || name.includes('seawolf') || name.includes('los angeles'))) {
    return {
      type: 'towed_vds',
      detectionKm: 65,
      torpedoWarningKm: 12,
      tracks: 16,
    };
  }

  // Ballistic Missile Submarines (SSBN)
  if (tid === 'ssbn' || name.includes('ssbn') || name.includes('ohio') || name.includes('borei') || name.includes('vanguard') || name.includes('triomphant')) {
    return {
      type: 'passive',
      detectionKm: 70,
      torpedoWarningKm: 14,
      tracks: 16,
    };
  }

  // Conventional Diesel-Electric / AIP Submarines (SSK)
  if (tid === 'submarine' || tid === 'midget-sub' || name.includes('aip') || name.includes('gotland') || name.includes('type 212') || name.includes('kilo') || name.includes('scorpene')) {
    return {
      type: 'passive',
      detectionKm: 45,
      torpedoWarningKm: 10,
      tracks: 12,
    };
  }

  // Maritime Patrol Aircraft (P-8, Tu-142, Atlantique)
  if (tid === 'mpa' || name.includes('poseidon') || name.includes('p-8') || name.includes('tu-142')) {
    return {
      type: 'sonobuoy_field',
      detectionKm: 60,
      torpedoWarningKm: 6,
      tracks: 32,
    };
  }

  // ASW Helicopters (MH-60R, Merlin, Ka-27)
  if (tid === 'helicopter' || tid === 'attack-heli' || tid === 'transport-heli' || name.includes('mh-60r') || name.includes('seahawk') || name.includes('merlin') || name.includes('ka-27')) {
    return {
      type: 'dipping',
      detectionKm: 30,
      torpedoWarningKm: 6,
      tracks: 4,
    };
  }

  // Modern ASW Frigates & Destroyers (with Towed VDS)
  if (tid === 'destroyer' || tid === 'frigate' || tid === 'cruiser') {
    const isDedicatedAsw = name.includes('fremm') || name.includes('type 26') || name.includes('type 23') || name.includes('constellation') || name.includes('burke') || name.includes('akizuki');
    return {
      type: isDedicatedAsw ? 'towed_vds' : 'hull_mounted',
      detectionKm: isDedicatedAsw ? 50 : 20,
      torpedoWarningKm: isDedicatedAsw ? 8 : 4,
      tracks: isDedicatedAsw ? 8 : 4,
    };
  }

  // Default Generic Sonar
  return {
    type: 'hull_mounted',
    detectionKm: 15,
    torpedoWarningKm: 4,
    tracks: 2,
  };
}

/** The thing that carries the sensors and weapons around. */
export interface PlatformFacet {
  /** Out and back with a useful load, unrefuelled. */
  combatRadiusKm?: number;
  /** The same with tanker support. */
  refuelledRadiusKm?: number;
  /** One way, clean. */
  ferryRangeKm?: number;
  speedKmh?: number;
  payloadKg?: number;
  crew?: number;
  displacementT?: number;
  /** Embarked aircraft, for carriers and assault ships. */
  aircraft?: number;
  vls?: number;
  enduranceDays?: number;
}

export interface SystemSpec {
  id: string;
  name: string;
  /** An existing unit type id — this is what decides the map symbol. */
  typeId: string;
  origin?: string;
  /** Free text: variant, service dates, whatever matters. */
  note?: string;
  sensor?: SensorFacet;
  weapons?: WeaponFacet[];
  platform?: PlatformFacet;
  signature?: 'low' | 'medium' | 'high';
  /**
   * Munition ids this system can be armed with, where the exact answer is known.
   * Omitted, compatibility is inferred from what other systems in the same
   * domain carry — right at the domain level, and free. Declare this on the
   * airframes where that is not good enough.
   */
  compatible?: string[];
  /** Keyed by dotted field path: 'sensor.detectionKm', 'weapons.0.rangeKm'. */
  provenance?: Record<string, Provenance>;
  /** Authored by the player. Overrides a library entry of the same id. */
  custom?: boolean;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/**
 * The library shipped with the app, merged with the player's own systems. A
 * custom system with the same id as a library one replaces it, which is how you
 * correct a figure you disagree with without editing the repo.
 */
export function mergeSystems(library: SystemSpec[], custom: SystemSpec[]): SystemSpec[] {
  const byId = new Map<string, SystemSpec>();
  for (const spec of library) byId.set(spec.id, reviveSpec(spec));
  for (const spec of custom) byId.set(spec.id, { ...reviveSpec(spec), custom: true });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Target classes that no longer exist, and what they became.
 *
 * `ballistic` was one bucket holding a Patriot at 45 km and an SM-3 at 1,200 km.
 * A saved system still carrying it would draw a ring that no filter matches, so
 * it is mapped to the narrowest tier — claiming less than the author may have
 * meant is the right direction to be wrong in.
 */
const LEGACY_TARGETS: Record<string, TargetClass[]> = {
  ballistic: ['ballistic-short'],
};

/** Returns the same array when there is nothing to migrate, so `reviveSpec` can
    hand back the identical object and callers keep their memoisation. */
const reviveTargets = (classes: TargetClass[] | undefined): TargetClass[] | undefined => {
  if (!classes?.length || !classes.some((c) => LEGACY_TARGETS[c])) return classes;
  return [...new Set(classes.flatMap((c) => LEGACY_TARGETS[c] ?? [c]))];
};

/**
 * Brings a stored system up to the current vocabulary. Read-time and idempotent:
 * a system saved before the ballistic split still loads, and still draws.
 */
export function reviveSpec(spec: SystemSpec): SystemSpec {
  const sees = reviveTargets(spec.sensor?.sees);
  const weapons = spec.weapons?.map((w) => {
    const engages = reviveTargets(w.engages);
    return engages === w.engages ? w : { ...w, engages };
  });
  const sensorChanged = spec.sensor && sees !== spec.sensor.sees;
  const weaponsChanged = weapons?.some((w, i) => w !== spec.weapons?.[i]);
  if (!sensorChanged && !weaponsChanged) return spec;
  return {
    ...spec,
    ...(spec.sensor && sensorChanged ? { sensor: { ...spec.sensor, sees } } : {}),
    ...(weaponsChanged ? { weapons } : {}),
  };
}

export function systemsForType(systems: SystemSpec[], typeId: string): SystemSpec[] {
  return systems.filter((s) => s.typeId === typeId);
}

export function systemById(systems: SystemSpec[], id: string | undefined): SystemSpec | undefined {
  return id ? systems.find((s) => s.id === id) : undefined;
}

export function domainOf(spec: SystemSpec): Domain {
  return UNIT_BY_ID.get(spec.typeId)?.domain ?? 'ground';
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

/**
 * A reach, in kilometres from where the unit stands. Phase 2 draws these on the
 * map; the panel already uses them to summarise a system in one line.
 */
export type EnvelopeKind = 'detection' | 'engagement' | 'strike' | 'strike-refuelled';

export interface Envelope {
  kind: EnvelopeKind;
  radiusKm: number;
  label: string;
  /** The munition this reach belongs to, where one does. */
  weapon?: string;
  /** Which target classes this reach applies to, where the spec says. */
  engages?: TargetClass[];
}

/**
 * How a class reads in a sentence, in a tooltip.
 *
 * 'air' says more than 'aircraft' on purpose: the class covers cruise missiles
 * and drones too, and a ring labelled 'vs aircraft' understated what an S-400
 * is actually pointed at.
 */
export const TARGET_LABEL: Record<TargetClass, string> = {
  air: 'aircraft & cruise missiles',
  'ballistic-short': 'short-range ballistic',
  'ballistic-medium': 'medium-range ballistic',
  'ballistic-imrbm': 'intermediate-range ballistic',
  surface: 'ships',
  ground: 'ground',
  subsurface: 'submarines',
};

/** Short form of a ballistic tier, for when several are listed together. */
const BALLISTIC_SHORT_LABEL: Record<string, string> = {
  'ballistic-short': 'SRBM',
  'ballistic-medium': 'MRBM',
  'ballistic-imrbm': 'IRBM+',
};

/**
 * 'aircraft & cruise missiles, ballistic (SRBM, MRBM)' — for a tooltip.
 *
 * The tiers collapse into one phrase rather than spelling each out, because
 * 'short-range ballistic, medium-range ballistic' is the same word twice and
 * pushes the useful part off the end of the card.
 */
export const describeTargets = (classes: TargetClass[] | undefined): string => {
  if (!classes?.length) return 'unspecified targets';
  const tiers = BALLISTIC_CLASSES.filter((t) => classes.includes(t));
  const rest = classes.filter((c) => !isBallistic(c)).map((c) => TARGET_LABEL[c]);
  if (!tiers.length) return rest.join(', ');
  const ballistic =
    tiers.length === BALLISTIC_CLASSES.length
      ? 'ballistic missiles'
      : `ballistic (${tiers.map((t) => BALLISTIC_SHORT_LABEL[t]).join(', ')})`;
  return [...rest, ballistic].join(', ');
};

export const ENVELOPE_LABELS: Record<EnvelopeKind, string> = {
  detection: 'Detection',
  engagement: 'Engagement',
  strike: 'Combat radius',
  'strike-refuelled': 'Combat radius, refuelled',
};

/**
 * Every reach a single system has.
 *
 * Engagement is split by what the weapon can shoot at, because one ring per
 * system is actively misleading: an Arleigh Burke's longest weapon is a
 * land-attack Tomahawk at 1,600 km, and drawing that as *the* envelope implies
 * an air-defence reach seven times what it has. One ring per target class,
 * taking the longest weapon that engages that class, and weapons that cover
 * several classes produce one ring rather than three identical ones.
 */
export function envelopesFor(spec: SystemSpec | undefined): Envelope[] {
  if (!spec) return [];
  const out: Envelope[] = [];

  if (spec.sensor?.detectionKm) {
    out.push({
      kind: 'detection',
      radiusKm: spec.sensor.detectionKm,
      label: `${ENVELOPE_LABELS.detection} · ${spec.sensor.detectionKm} km`,
      engages: spec.sensor.sees,
    });
  }

  const weapons = spec.weapons ?? [];
  const longestFor = new Map<TargetClass, WeaponFacet>();
  const unclassed: WeaponFacet[] = [];

  for (const weapon of weapons) {
    if (!weapon.engages?.length) {
      unclassed.push(weapon);
      continue;
    }
    for (const target of weapon.engages) {
      const held = longestFor.get(target);
      if (!held || weapon.rangeKm > held.rangeKm) longestFor.set(target, weapon);
    }
  }

  // Several classes often resolve to the same weapon — an SM-6 answers both
  // aircraft and ballistic — and that is one envelope, not two.
  const grouped = new Map<WeaponFacet, TargetClass[]>();
  for (const [target, weapon] of longestFor) {
    const classes = grouped.get(weapon) ?? [];
    classes.push(target);
    grouped.set(weapon, classes);
  }

  // A weapon that never says what it shoots at still deserves a ring, once.
  if (unclassed.length) {
    const longest = unclassed.reduce((best, w) => (w.rangeKm > best.rangeKm ? w : best));
    if (!grouped.has(longest)) grouped.set(longest, []);
  }

  for (const [weapon, classes] of grouped) {
    out.push({
      kind: 'engagement',
      radiusKm: weapon.rangeKm,
      weapon: weapon.name,
      label: `${weapon.name ?? ENVELOPE_LABELS.engagement} · ${weapon.rangeKm} km`,
      engages: classes.length ? classes : undefined,
    });
  }

  if (spec.platform?.combatRadiusKm) {
    out.push({
      kind: 'strike',
      radiusKm: spec.platform.combatRadiusKm,
      label: `${ENVELOPE_LABELS.strike} · ${spec.platform.combatRadiusKm} km`,
    });
  }
  if (spec.platform?.refuelledRadiusKm) {
    out.push({
      kind: 'strike-refuelled',
      radiusKm: spec.platform.refuelledRadiusKm,
      label: `${ENVELOPE_LABELS['strike-refuelled']} · ${spec.platform.refuelledRadiusKm} km`,
    });
  }

  return out;
}

/**
 * The widest reach of each kind across several systems — how a formation gets
 * its envelopes from what is inside it. A carrier group's air-defence umbrella
 * is its escorts' umbrella; nobody types it in.
 */
export function combineEnvelopes(specs: (SystemSpec | undefined)[]): Envelope[] {
  const widest = new Map<string, Envelope>();
  for (const spec of specs) {
    for (const env of envelopesFor(spec)) {
      // Keyed by what the reach is *for*, so an escort's air-defence umbrella
      // does not get overwritten by a longer land-attack missile.
      const key = `${env.kind}|${[...(env.engages ?? [])].sort().join(',')}`;
      const held = widest.get(key);
      if (!held || env.radiusKm > held.radiusKm) widest.set(key, env);
    }
  }
  return [...widest.values()];
}

/**
 * How far a surface radar can see something flying at `targetAltM`, given the
 * earth curves away underneath. Nothing sees a sea-skimmer at 400 km, whatever
 * the brochure says.
 */
export function radarHorizonKm(antennaM: number, targetAltM: number): number {
  return 4.12 * (Math.sqrt(Math.max(0, antennaM)) + Math.sqrt(Math.max(0, targetAltM)));
}

/**
 * Radar detection range multiplier derived from the Radar Range Equation:
 * Range proportional to RCS^(1/4).
 * - 'low' (5th-gen VLO stealth, e.g. F-35, F-22, B-21, Su-57; RCS ~ 0.001 m²): ~0.25x radar detection reach
 * - 'medium' (4.5-gen reduced RCS, e.g. Rafale, Typhoon, Super Hornet; RCS ~ 0.75 m²): ~0.65x radar detection reach
 * - 'high' / undefined (4th-gen baseline; RCS ~ 4 m²): 1.0x radar detection reach
 */
export function signatureRangeMultiplier(sig?: 'low' | 'medium' | 'high'): number {
  if (sig === 'low') return 0.25;
  if (sig === 'medium') return 0.65;
  return 1.0;
}

/**
 * The reach actually available, once the horizon, target stealth signature, and
 * active jamming are taken into account.
 */
export function effectiveDetectionKm(
  spec: SystemSpec,
  targetAltM = 10_000,
  targetSignature?: 'low' | 'medium' | 'high',
  isJammed = false
): number | null {
  const sensor = spec.sensor;
  if (!sensor?.detectionKm) return null;
  const sigMult = signatureRangeMultiplier(targetSignature);
  const jamMult = isJammed ? 0.6 : 1.0;
  const rawReach = sensor.detectionKm * sigMult * jamMult;
  if (!sensor.horizonLimited) return rawReach;
  const horizon = radarHorizonKm(sensor.antennaM ?? 20, targetAltM);
  return Math.min(rawReach, horizon);
}

/** Weapons on a system with stand-off reach (rangeKm > 0) that can engage surface or ground targets. */
export function standoffWeapons(spec: SystemSpec): { weapon: WeaponFacet; index: number }[] {
  const weapons = spec.weapons ?? [];
  const out: { weapon: WeaponFacet; index: number }[] = [];
  weapons.forEach((w, index) => {
    if (w.rangeKm && w.rangeKm > 0) {
      out.push({ weapon: w, index });
    }
  });
  return out;
}

/**
 * Calculates the maximum available magazine capacity for a given weapon on a platform,
 * taking into account custom loadouts, ready magazine cells, VLS cells, and unit count.
 */
export function maxMunitionCapacity(
  spec: SystemSpec,
  weapon: WeaponFacet,
  unitCount = 1,
  loadoutItemCount?: number
): number {
  if (loadoutItemCount !== undefined && loadoutItemCount > 0) {
    return loadoutItemCount * unitCount;
  }
  if (weapon.magazine !== undefined && weapon.magazine > 0) {
    return weapon.magazine * unitCount;
  }
  if (spec.platform?.vls !== undefined && spec.platform.vls > 0) {
    return spec.platform.vls * unitCount;
  }
  const domain = domainOf(spec);
  if (domain === 'sea' || domain === 'sub' || domain === 'site') {
    return 16 * unitCount;
  }
  return Math.max(1, (weapon.salvo ?? 2) * 2) * unitCount;
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export interface SpecLine {
  /** Dotted path, so provenance can be looked up. */
  path: string;
  label: string;
  value: string;
}

const km = (n: number) => `${n.toLocaleString()} km`;

/** Every figure a system carries, flattened for display. */
export function specLines(spec: SystemSpec): SpecLine[] {
  const lines: SpecLine[] = [];
  const push = (path: string, label: string, value: string | number | undefined, unit = '') => {
    if (value === undefined || value === null || value === '') return;
    lines.push({ path, label, value: typeof value === 'number' ? `${value.toLocaleString()}${unit}` : value });
  };

  if (spec.sensor) {
    push('sensor.detectionKm', 'Detection', km(spec.sensor.detectionKm));
    push('sensor.tracks', 'Tracks held', spec.sensor.tracks);
    push('sensor.engagements', 'Fire channels', spec.sensor.engagements);
    if (spec.sensor.sees?.length) push('sensor.sees', 'Sees', describeTargets(spec.sensor.sees));
  }

  (spec.weapons ?? []).forEach((w, i) => {
    const prefix = `weapons.${i}`;
    push(`${prefix}.rangeKm`, w.name ?? `Weapon ${i + 1}`, km(w.rangeKm));
    // What it is for, which is the difference between a Tomahawk and an SM-6.
    if (w.engages?.length) push(`${prefix}.engages`, 'Engages', describeTargets(w.engages));
    push(`${prefix}.magazine`, 'Ready rounds', w.magazine);
    push(`${prefix}.salvo`, 'Salvo', w.salvo);
    push(`${prefix}.pk`, 'Kill probability', w.pk === undefined ? undefined : w.pk.toFixed(2));
    push(`${prefix}.reactionSec`, 'Reaction', w.reactionSec, ' s');
  });

  const p = spec.platform;
  if (p) {
    push('platform.combatRadiusKm', 'Combat radius', p.combatRadiusKm ? km(p.combatRadiusKm) : undefined);
    push(
      'platform.refuelledRadiusKm',
      'Refuelled radius',
      p.refuelledRadiusKm ? km(p.refuelledRadiusKm) : undefined
    );
    push('platform.ferryRangeKm', 'Ferry range', p.ferryRangeKm ? km(p.ferryRangeKm) : undefined);
    push('platform.speedKmh', 'Speed', p.speedKmh, ' km/h');
    push('platform.payloadKg', 'Payload', p.payloadKg, ' kg');
    push('platform.vls', 'VLS cells', p.vls);
    push('platform.aircraft', 'Aircraft', p.aircraft);
    push('platform.displacementT', 'Displacement', p.displacementT, ' t');
    push('platform.crew', 'Crew', p.crew);
    push('platform.enduranceDays', 'Endurance', p.enduranceDays, ' days');
  }

  if (spec.signature) push('signature', 'Signature', spec.signature);
  return lines;
}

/** One line for a palette tooltip or an order-of-battle row. */
export function summarise(spec: SystemSpec): string {
  const bits: string[] = [];
  const engagement = envelopesFor(spec).find((e) => e.kind === 'engagement');
  if (engagement) bits.push(`${engagement.radiusKm} km reach`);
  if (spec.sensor?.detectionKm) bits.push(`${spec.sensor.detectionKm} km detection`);
  if (spec.platform?.combatRadiusKm) bits.push(`${spec.platform.combatRadiusKm} km radius`);
  if (spec.platform?.vls) bits.push(`${spec.platform.vls} VLS`);
  if (spec.platform?.aircraft) bits.push(`${spec.platform.aircraft} aircraft`);
  return bits.join(' · ');
}

let counter = 0;
export function nextSystemId(name: string): string {
  counter += 1;
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${slug || 'system'}-${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Drops empty facets so a hand-edited system does not keep hollow objects. */
export function tidySpec(spec: SystemSpec): SystemSpec {
  const out: SystemSpec = { ...spec };
  if (out.sensor && !out.sensor.detectionKm) delete out.sensor;
  if (out.weapons) {
    out.weapons = out.weapons.filter((w) => w && w.rangeKm > 0);
    if (!out.weapons.length) delete out.weapons;
  }
  if (out.platform && !Object.values(out.platform).some((v) => typeof v === 'number' && v > 0)) {
    delete out.platform;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* War Simulation Pre-Flight Validation Engine                        */
/* ------------------------------------------------------------------ */

export interface MissingSpecField {
  field: string;
  label: string;
  reason: string;
}

export interface SystemValidationReport {
  systemId: string;
  systemName: string;
  typeId: string;
  domain: Domain;
  valid: boolean;
  missingFields: MissingSpecField[];
}

export interface OrbatValidationResult {
  valid: boolean;
  failedCount: number;
  passedCount: number;
  reports: SystemValidationReport[];
}

/**
 * Rigorously validates whether a military system possesses all critical
 * physical, sensor, and kinematic fields required to participate in the
 * live War Simulation engine.
 */
export function validateSimSystem(spec: SystemSpec): SystemValidationReport {
  const domain = domainOf(spec);
  const missing: MissingSpecField[] = [];
  const typeId = spec.typeId || 'fighter';

  // 1. Platform Kinematics & Fuel Constraints
  const isPlatform = domain === 'air' || domain === 'sea' || domain === 'sub' || domain === 'ground';
  if (isPlatform) {
    const hasCombatRadius = (spec.platform?.combatRadiusKm ?? 0) > 0 || (spec.platform?.ferryRangeKm ?? 0) > 0;
    if (domain === 'air' && !hasCombatRadius) {
      missing.push({
        field: 'platform.combatRadiusKm',
        label: 'Combat Radius / Range',
        reason: 'Required for calculating sortie reach, patrol orbit distance, and fuel burn.',
      });
    }

    const hasSpeed = (spec.platform?.speedKmh ?? 0) > 0;
    if ((domain === 'air' || domain === 'sea' || domain === 'ground') && !hasSpeed) {
      missing.push({
        field: 'platform.speedKmh',
        label: 'Speed (km/h)',
        reason: 'Required for physical transit velocity and kinematic interception timing.',
      });
    }
  }

  // 2. Sensor & Radar Horizon Checks
  const isDedicatedSensor = typeId === 'radar' || typeId === 'awacs' || typeId === 'ew' || typeId === 'jammer';
  const isCombatPlatform = typeId === 'fighter' || typeId === 'destroyer' || typeId === 'cruiser' || typeId === 'frigate' || typeId === 'sam-launcher';

  if (isDedicatedSensor || isCombatPlatform) {
    const hasSensor = (spec.sensor?.detectionKm ?? 0) > 0;
    const hasSonar = (spec.sensor?.sonar?.detectionKm ?? defaultSonarFor(spec, typeId).detectionKm ?? 0) > 0;
    
    if (domain === 'sub') {
      if (!hasSonar && !hasSensor) {
        missing.push({
          field: 'sensor.sonar.detectionKm',
          label: 'Sonar Detection Range',
          reason: 'Required for underwater acoustic detection and torpedo defense.',
        });
      }
    } else if (!hasSensor && isDedicatedSensor) {
      missing.push({
        field: 'sensor.detectionKm',
        label: 'Radar Detection Range',
        reason: 'Required for early warning radar sweeps and aerial contact detection.',
      });
    }

    if (spec.sensor && spec.sensor.horizonLimited && (spec.sensor.antennaM ?? 0) <= 0) {
      missing.push({
        field: 'sensor.antennaM',
        label: 'Antenna Height (m)',
        reason: 'Required for calculating earth-curvature radar horizon against low-altitude targets.',
      });
    }
  }

  // 3. Weapon Envelopes & Kill Probabilities
  const isCombatUnit = typeId === 'fighter' || typeId === 'strike' || typeId === 'bomber' || 
                       typeId === 'destroyer' || typeId === 'cruiser' || typeId === 'frigate' || 
                       typeId === 'sam-launcher' || typeId === 'missile' || typeId === 'artillery' || 
                       typeId === 'rocket' || typeId === 'armour';

  if (isCombatUnit) {
    const weapons = spec.weapons || [];
    if (weapons.length === 0 && typeId !== 'armour') {
      missing.push({
        field: 'weapons',
        label: 'Weapon Envelopes',
        reason: 'Combat units must have at least one defined weapon system with range and munitions.',
      });
    } else {
      weapons.forEach((w, idx) => {
        const prefix = `weapons[${idx}]`;
        const wName = w.name || `Weapon #${idx + 1}`;
        if (!w.rangeKm || w.rangeKm <= 0) {
          missing.push({
            field: `${prefix}.rangeKm`,
            label: `${wName} Range`,
            reason: 'Weapon must have a valid maximum effective range in kilometres.',
          });
        }
        if (w.pk === undefined || w.pk <= 0) {
          missing.push({
            field: `${prefix}.pk`,
            label: `${wName} Kill Probability (Pk)`,
            reason: 'Required for simulated hit/kill probability resolution.',
          });
        }
      });
    }
  }

  return {
    systemId: spec.id,
    systemName: spec.name || spec.id,
    typeId: spec.typeId || 'unknown',
    domain,
    valid: missing.length === 0,
    missingFields: missing,
  };
}

/**
 * Validates an entire allocated national ORBAT against the systems library.
 * Returns a comprehensive report highlighting pass/fail metrics.
 */
export function validateOrbatRoster(
  allocatedSystemIds: string[],
  systemsLibrary: SystemSpec[]
): OrbatValidationResult {
  const reports: SystemValidationReport[] = [];
  let passedCount = 0;
  let failedCount = 0;

  const uniqueIds = Array.from(new Set(allocatedSystemIds.filter(Boolean)));

  for (const sysId of uniqueIds) {
    const spec = systemsLibrary.find((s) => s.id === sysId);
    if (!spec) {
      reports.push({
        systemId: sysId,
        systemName: sysId,
        typeId: 'unknown',
        domain: 'ground',
        valid: false,
        missingFields: [
          {
            field: 'spec',
            label: 'System Definition Missing',
            reason: 'System was not found in the technical specifications library.',
          },
        ],
      });
      failedCount++;
    } else {
      const report = validateSimSystem(spec);
      reports.push(report);
      if (report.valid) {
        passedCount++;
      } else {
        failedCount++;
      }
    }
  }

  return {
    valid: failedCount === 0,
    failedCount,
    passedCount,
    reports,
  };
}

