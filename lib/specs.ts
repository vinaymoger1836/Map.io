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

/** What a sensor can see or a weapon can shoot at. */
export type TargetClass = 'air' | 'ballistic' | 'surface' | 'ground' | 'subsurface';

export const TARGET_CLASSES: { id: TargetClass; label: string }[] = [
  { id: 'air', label: 'Aircraft' },
  { id: 'ballistic', label: 'Ballistic' },
  { id: 'surface', label: 'Ships' },
  { id: 'ground', label: 'Ground' },
  { id: 'subsurface', label: 'Submarines' },
];

export type Confidence = 'high' | 'medium' | 'low';

export interface Provenance {
  source: string;
  confidence: Confidence;
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
}

/** Anything that shoots. A destroyer has several; a fighter carries a loadout. */
export interface WeaponFacet {
  name?: string;
  rangeKm: number;
  minRangeKm?: number;
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
  for (const spec of library) byId.set(spec.id, spec);
  for (const spec of custom) byId.set(spec.id, { ...spec, custom: true });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  /** Which target classes this reach applies to, where the spec says. */
  engages?: TargetClass[];
}

export const ENVELOPE_LABELS: Record<EnvelopeKind, string> = {
  detection: 'Detection',
  engagement: 'Engagement',
  strike: 'Combat radius',
  'strike-refuelled': 'Combat radius, refuelled',
};

/**
 * Every reach a single system has. A system with no facets has none, which is
 * the correct answer for a supply truck.
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

  // The longest-reaching weapon defines the envelope. Shorter ones sit inside
  // it and would only add rings nobody can read.
  const longest = (spec.weapons ?? []).reduce<WeaponFacet | null>(
    (best, w) => (!best || w.rangeKm > best.rangeKm ? w : best),
    null
  );
  if (longest) {
    out.push({
      kind: 'engagement',
      radiusKm: longest.rangeKm,
      label: `${longest.name ?? ENVELOPE_LABELS.engagement} · ${longest.rangeKm} km`,
      engages: longest.engages,
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
  const widest = new Map<EnvelopeKind, Envelope>();
  for (const spec of specs) {
    for (const env of envelopesFor(spec)) {
      const held = widest.get(env.kind);
      if (!held || env.radiusKm > held.radiusKm) widest.set(env.kind, env);
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

/** The reach actually available, once the horizon is taken into account. */
export function effectiveDetectionKm(spec: SystemSpec, targetAltM = 10_000): number | null {
  const sensor = spec.sensor;
  if (!sensor?.detectionKm) return null;
  if (!sensor.horizonLimited) return sensor.detectionKm;
  return Math.min(sensor.detectionKm, radarHorizonKm(sensor.antennaM ?? 20, targetAltM));
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
    if (spec.sensor.sees?.length) push('sensor.sees', 'Sees', spec.sensor.sees.join(', '));
  }

  (spec.weapons ?? []).forEach((w, i) => {
    const prefix = `weapons.${i}`;
    push(`${prefix}.rangeKm`, w.name ?? `Weapon ${i + 1}`, km(w.rangeKm));
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
