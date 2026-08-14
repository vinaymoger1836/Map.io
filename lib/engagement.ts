/**
 * Enhanced Engagement Model — What a defence does to a raid.
 *
 * Every other number in this app describes a thing standing still. This is the
 * one place that multiplies them together, and it exists because the library has
 * been carrying `pk`, `salvo`, `reactionSec`, `signature` and `magazine` from
 * the beginning for exactly this — figures nobody publishes, collected so that
 * a model would have something to multiply.
 *
 * ## Enhanced Capabilities
 *
 * 1. **Stealth & RCS Dynamics**:
 *    Sensor detection ranges are scaled according to the Radar Range Equation
 *    (reach proportional to RCS^0.25). A `low` signature (5th-gen VLO: F-35,
 *    F-22, B-21, Su-57) compresses defender radar detection reach by 75%,
 *    drastically delaying SAM open-fire points or bypassing batteries entirely.
 *    `medium` signature (4.5-gen reduced RCS: Rafale, Typhoon, Super Hornet)
 *    compresses detection by 35%.
 *
 * 2. **Stand-Off Weapon Release**:
 *    Strike aircraft carrying stand-off munitions (e.g. JASSM-ER, Storm Shadow,
 *    Kalibr, glide bombs) ingress to weapon release range (D - R_standoff),
 *    launch their munitions, and egress safely. Inner SAM belts defend against
 *    incoming cruise missiles / glide bombs (as 'air' targets) rather than the
 *    launch aircraft.
 *
 * 3. **Composite Strike Packages & Escorts (SEAD & EW Jamming)**:
 *    - **EW Jamming**: Escort jammers degrade defender radar detection reach
 *      by 40%, add reaction delay (+5 s), and degrade missile Pk by 25% via
 *      active guidance jamming.
 *    - **SEAD Escorts**: Dedicated suppression flights employ anti-radiation
 *      strikes against active defending radars, cutting battery fire channels
 *      in half and causing defensive radar shutdowns.
 *    - **Formations as Raiders**: Air Strike Packages and custom formations
 *      automatically decompose into strike assets, EW escorts, SEAD elements,
 *      and supporting C2/tankers.
 *
 * 4. **Detection Sharing & Horizon Gates**:
 *    Detection is shared across defenders of a nation (radar cueing). Detection
 *    remains bounded by antenna height and target altitude curvature.
 */

import { distanceKm, interpolate } from './geo';
import { effectiveSpec, type MunitionCatalogue } from './munitions';
import {
  domainOf,
  effectiveDetectionKm,
  radarHorizonKm,
  signatureRangeMultiplier,
  standoffWeapons,
  systemById,
  type Confidence,
  type SystemSpec,
  type TargetClass,
  type WeaponFacet,
} from './specs';
import {
  deriveAbbr,
  totalStrength,
  unitLabel,
  type Component,
  type DeployedUnit,
  type Domain,
  type Formation,
  UNIT_BY_ID,
} from './warGames';

/* ------------------------------------------------------------------ */
/* What a raid is, as a target                                         */
/* ------------------------------------------------------------------ */

const CLASS_BY_DOMAIN: Record<Domain, TargetClass> = {
  air: 'air',
  sea: 'surface',
  sub: 'subsurface',
  ground: 'ground',
  site: 'ground',
};

/**
 * Ballistic tiers by the reach of the missile, since a raid of them is engaged
 * by whatever answers that tier.
 */
function ballisticTier(rangeKm: number): TargetClass {
  if (rangeKm < 1_000) return 'ballistic-short';
  if (rangeKm < 3_000) return 'ballistic-medium';
  return 'ballistic-imrbm';
}

/** What this raid is to a defender — the inverse of a weapon's `engages`. */
export function threatClassOf(spec: SystemSpec): TargetClass {
  if (spec.typeId === 'missile' || spec.typeId === 'silo' || spec.typeId === 'ssbn') {
    const longest = Math.max(0, ...(spec.weapons ?? []).map((w) => w.rangeKm || 0));
    if (longest > 0) return ballisticTier(longest);
  }
  return CLASS_BY_DOMAIN[domainOf(spec)] ?? 'ground';
}

/* ------------------------------------------------------------------ */
/* Confidence, and how wide to draw the bracket                        */
/* ------------------------------------------------------------------ */

const SPREAD: Record<Confidence, number> = { high: 0.1, medium: 0.25, low: 0.4 };

function confidenceOf(spec: SystemSpec, weaponIndex: number, field: string): Confidence | undefined {
  const entry = spec.provenance?.[`weapons.${weaponIndex}.${field}`];
  return entry?.confidence;
}

export type Bracket = 'low' | 'stated' | 'high';

function bracketPk(pk: number, confidence: Confidence | undefined, bracket: Bracket): number {
  if (bracket === 'stated') return pk;
  const spread = SPREAD[confidence ?? 'low'];
  const moved = bracket === 'low' ? pk * (1 - spread) : pk * (1 + spread);
  return Math.max(0, Math.min(0.98, moved));
}

/* ------------------------------------------------------------------ */
/* Standoff and Escort Configuration                                   */
/* ------------------------------------------------------------------ */

export interface StandoffConfig {
  enabled: boolean;
  weaponIndex: number;
  weaponName?: string;
  rangeKm: number;
  munitionCount: number;
  munitionSignature: 'low' | 'medium' | 'high';
  munitionSpeedKmh: number;
}

export interface EscortConfig {
  ewUnitId?: string | null;
  ewUnitLabel?: string;
  ewCount?: number;
  seadUnitId?: string | null;
  seadUnitLabel?: string;
  seadCount?: number;
}

export interface PackageDetails {
  strikeCount: number;
  strikePlatformName?: string;
  ewCount: number;
  seadCount: number;
  awacsCount: number;
  tankerCount: number;
}

export interface Raid {
  unitId: string;
  label: string;
  spec: SystemSpec;
  count: number;
  from: [number, number];
  to: [number, number];
  altitudeM: number;
  signature?: 'low' | 'medium' | 'high';
  standoff?: StandoffConfig;
  escorts?: EscortConfig;
  isComposite?: boolean;
  packageDetails?: PackageDetails;
}

export interface Defender {
  unitId: string;
  unitLabel: string;
  iso: string;
  spec: SystemSpec;
  count: number;
  at: [number, number];
}

export interface Engagement {
  unitId: string;
  unitLabel: string;
  systemName: string;
  weaponName: string;
  rangeKm: number;
  entryKm: number;
  exitKm: number;
  exposureSec: number;
  facing: number;
  rounds: number;
  killed: number;
  silent?: SilentReason;
  assumedEngages?: boolean;
  cued?: boolean;
  heldFireKm?: number;

  /* Enhanced indicators */
  phase: 'aircraft-ingress' | 'munition-flight' | 'direct';
  targetType: 'aircraft' | 'standoff-munition';
  stealthDelayed?: boolean;
  stealthBypassed?: boolean;
  jammed?: boolean;
  seadSuppressed?: boolean;
}

export type SilentReason =
  | 'too-fast'
  | 'dry'
  | 'nothing-left'
  | 'blind'
  | 'stealth-bypassed'
  | 'standoff-out-of-range';

export interface Assessment {
  raid: Raid;
  distanceKm: number;
  threat: TargetClass;
  speedKmh: number | null;
  engagements: Engagement[];
  leakers: { low: number; stated: number; high: number };
  unmodelled: { unitLabel: string; weaponName: string }[];
  blocked?: 'no-speed' | 'no-distance' | 'no-strike-assets';

  /* Enhanced assessment breakdown */
  aircraftSurviving: { low: number; stated: number; high: number };
  aircraftLost: { low: number; stated: number; high: number };
  standoffLaunched?: number;
  munitionsArriving?: { low: number; stated: number; high: number };
  releaseKm?: number;
  releaseLngLat?: [number, number];
  stealthAdvantage?: string;
  ewSummary?: string;
  seadSummary?: string;
}

const speedOf = (spec: SystemSpec): number | null => spec.platform?.speedKmh ?? null;

/** Where the path enters and leaves one envelope along totalKm. */
function crossing(
  from: [number, number],
  to: [number, number],
  at: [number, number],
  radiusKm: number,
  totalKm: number
): { entryKm: number; exitKm: number } | null {
  const steps = Math.min(2_000, Math.max(64, Math.ceil(totalKm / 5)));
  let entry: number | null = null;
  let exit: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const inside = distanceKm(interpolate(from, to, fraction), at) <= radiusKm;
    if (inside && entry === null) entry = fraction * totalKm;
    if (!inside && entry !== null) {
      exit = fraction * totalKm;
      break;
    }
  }
  if (entry === null) return null;
  return { entryKm: entry, exitKm: exit ?? totalKm };
}

/** Point where a sensor first holds the target with horizon, stealth, and jamming. */
function onsetFor(
  spec: SystemSpec,
  at: [number, number],
  from: [number, number],
  to: [number, number],
  altitudeM: number,
  signature: 'low' | 'medium' | 'high' | undefined,
  isJammed: boolean,
  totalKm: number
): number | null {
  const reach = effectiveDetectionKm(spec, altitudeM, signature, isJammed);
  if (!reach || reach <= 0) return null;
  return crossing(from, to, at, reach, totalKm)?.entryKm ?? null;
}

function engagesThreat(weapon: WeaponFacet, threat: TargetClass): boolean {
  return !weapon.engages?.length || weapon.engages.includes(threat);
}

/** Losses from one battery firing salvo at each raider it can hold. */
function lossesFrom(
  weapon: WeaponFacet,
  spec: SystemSpec,
  pk: number,
  facing: number,
  roundsLeft: number,
  count: number,
  isSuppressed = false,
  isJammed = false
): { killed: number; rounds: number } {
  const salvo = Math.max(1, Math.round(weapon.salvo ?? 1));
  let channels =
    spec.sensor?.engagements === undefined ? facing : spec.sensor.engagements * count;
  if (isSuppressed) {
    channels = Math.max(1, Math.floor(channels / 2));
  }
  const wanted = Math.min(facing, Math.max(1, channels));
  const affordable = Math.floor(roundsLeft / salvo);
  const engaged = Math.min(wanted, affordable);
  if (engaged <= 0) return { killed: 0, rounds: 0 };

  const effectivePk = isJammed ? pk * 0.75 : pk;
  const perTarget = 1 - (1 - effectivePk) ** salvo;
  return { killed: Math.min(facing, engaged * perTarget), rounds: engaged * salvo };
}

/* ------------------------------------------------------------------ */
/* Core Assessment Engine                                              */
/* ------------------------------------------------------------------ */

export function assess(raid: Raid, defenders: Defender[]): Assessment {
  const threat = threatClassOf(raid.spec);
  const totalKm = distanceKm(raid.from, raid.to);
  const speedKmh = speedOf(raid.spec);

  const base: Assessment = {
    raid,
    distanceKm: totalKm,
    threat,
    speedKmh,
    engagements: [],
    leakers: { low: raid.count, stated: raid.count, high: raid.count },
    aircraftSurviving: { low: raid.count, stated: raid.count, high: raid.count },
    aircraftLost: { low: 0, stated: 0, high: 0 },
    unmodelled: [],
  };

  if (totalKm < 1e-6) return { ...base, blocked: 'no-distance' };
  if (!speedKmh) return { ...base, blocked: 'no-speed' };

  const isStandoff = Boolean(raid.standoff?.enabled && raid.standoff.rangeKm > 0);
  const standoffRange = isStandoff ? raid.standoff!.rangeKm : 0;
  const releaseKm = isStandoff ? Math.max(0, totalKm - standoffRange) : totalKm;
  const releaseFraction = totalKm > 0 ? releaseKm / totalKm : 0;
  const releaseLngLat = isStandoff ? interpolate(raid.from, raid.to, releaseFraction) : undefined;

  const hasEwJammer = (raid.escorts?.ewCount ?? 0) > 0;
  const seadSquadrons = raid.escorts?.seadCount ?? 0;
  let seadSuppressionsAvailable = seadSquadrons * 2;

  /* ---------------- Layer building ---------------- */

  type Layer = {
    defender: Defender;
    weapon: WeaponFacet;
    index: number;
    phase: 'aircraft-ingress' | 'munition-flight' | 'direct';
    targetType: 'aircraft' | 'standoff-munition';
    entryKm: number;
    exitKm: number;
    cued?: boolean;
    heldFireKm?: number;
    blind?: boolean;
    stealthDelayed?: boolean;
    stealthBypassed?: boolean;
    jammed?: boolean;
    seadSuppressed?: boolean;
    nominalEntryKm: number;
  };

  const layers: Layer[] = [];
  const unmodelled: Assessment['unmodelled'] = [];

  // 1. Ingress Phase (0 to releaseKm) — Aircraft facing defenders
  if (releaseKm > 0.1 || !isStandoff) {
    const ingressLimitKm = isStandoff ? releaseKm : totalKm;
    const ownOnset = new Map<string, number | null>();
    let networkOnset: number | null = null;

    for (const def of defenders) {
      const onset = def.spec.sensor
        ? onsetFor(
            def.spec,
            def.at,
            raid.from,
            raid.to,
            raid.altitudeM,
            raid.signature,
            hasEwJammer,
            totalKm
          )
        : null;
      ownOnset.set(def.unitId, onset);
      if (onset !== null && (networkOnset === null || onset < networkOnset)) {
        networkOnset = onset;
      }
    }

    for (const defender of defenders) {
      const weapons = defender.spec.weapons ?? [];
      for (let index = 0; index < weapons.length; index++) {
        const weapon = weapons[index];
        if (!weapon.rangeKm || !engagesThreat(weapon, threat)) continue;
        const cross = crossing(raid.from, raid.to, defender.at, weapon.rangeKm, totalKm);
        if (!cross) continue;

        // Clip pass to ingress segment
        if (cross.entryKm >= ingressLimitKm) continue;
        const passExit = Math.min(cross.exitKm, ingressLimitKm);
        if (passExit <= cross.entryKm) continue;

        if (weapon.pk === undefined) {
          unmodelled.push({
            unitLabel: defender.unitLabel,
            weaponName: weapon.name ?? defender.spec.name,
          });
          continue;
        }

        const mine = ownOnset.get(defender.unitId) ?? null;
        const seenFrom = defender.spec.sensor ? networkOnset : cross.entryKm;

        if (seenFrom === null) {
          layers.push({
            defender,
            weapon,
            index,
            phase: isStandoff ? 'aircraft-ingress' : 'direct',
            targetType: 'aircraft',
            entryKm: cross.entryKm,
            exitKm: passExit,
            nominalEntryKm: cross.entryKm,
            blind: true,
            stealthBypassed: raid.signature === 'low' || raid.signature === 'medium',
          });
          continue;
        }

        const opensAt = Math.max(cross.entryKm, seenFrom);
        const stealthDelayed =
          (raid.signature === 'low' || raid.signature === 'medium') && opensAt > cross.entryKm;
        const stealthBypassed = opensAt >= passExit;

        // Apply SEAD suppression if defender has active emitter
        let seadSuppressed = false;
        if (defender.spec.sensor && seadSuppressionsAvailable > 0 && !stealthBypassed) {
          seadSuppressed = true;
          seadSuppressionsAvailable -= 1;
        }

        layers.push({
          defender,
          weapon,
          index,
          phase: isStandoff ? 'aircraft-ingress' : 'direct',
          targetType: 'aircraft',
          entryKm: opensAt,
          exitKm: passExit,
          nominalEntryKm: cross.entryKm,
          cued: defender.spec.sensor ? mine === null || seenFrom < mine : false,
          heldFireKm: opensAt > cross.entryKm ? opensAt - cross.entryKm : undefined,
          blind: stealthBypassed,
          stealthDelayed,
          stealthBypassed,
          jammed: hasEwJammer,
          seadSuppressed,
        });
      }
    }
  }

  // 2. Munition Flight Phase (releaseKm to totalKm) — Standoff munitions traversing SAM belts
  if (isStandoff && releaseKm < totalKm) {
    const munitionSig = raid.standoff!.munitionSignature;
    const munitionThreat: TargetClass = 'air'; // Cruise missiles / glide bombs engaged as air targets
    const ownOnsetMunition = new Map<string, number | null>();
    let networkOnsetMunition: number | null = null;

    for (const def of defenders) {
      const onset = def.spec.sensor
        ? onsetFor(
            def.spec,
            def.at,
            raid.from,
            raid.to,
            raid.altitudeM,
            munitionSig,
            false,
            totalKm
          )
        : null;
      ownOnsetMunition.set(def.unitId, onset);
      if (onset !== null && (networkOnsetMunition === null || onset < networkOnsetMunition)) {
        networkOnsetMunition = onset;
      }
    }

    for (const defender of defenders) {
      const weapons = defender.spec.weapons ?? [];
      for (let index = 0; index < weapons.length; index++) {
        const weapon = weapons[index];
        if (!weapon.rangeKm || !engagesThreat(weapon, munitionThreat)) continue;
        const cross = crossing(raid.from, raid.to, defender.at, weapon.rangeKm, totalKm);
        if (!cross) continue;

        // Clip pass to munition flight segment
        if (cross.exitKm <= releaseKm) continue;
        const passEntry = Math.max(cross.entryKm, releaseKm);
        const passExit = cross.exitKm;

        if (weapon.pk === undefined) {
          unmodelled.push({
            unitLabel: defender.unitLabel,
            weaponName: weapon.name ?? defender.spec.name,
          });
          continue;
        }

        const mine = ownOnsetMunition.get(defender.unitId) ?? null;
        const seenFrom = defender.spec.sensor ? networkOnsetMunition : passEntry;

        if (seenFrom === null) {
          layers.push({
            defender,
            weapon,
            index,
            phase: 'munition-flight',
            targetType: 'standoff-munition',
            entryKm: passEntry,
            exitKm: passExit,
            nominalEntryKm: passEntry,
            blind: true,
            stealthBypassed: munitionSig === 'low',
          });
          continue;
        }

        const opensAt = Math.max(passEntry, seenFrom);
        const stealthDelayed = munitionSig === 'low' && opensAt > passEntry;
        const stealthBypassed = opensAt >= passExit;

        layers.push({
          defender,
          weapon,
          index,
          phase: 'munition-flight',
          targetType: 'standoff-munition',
          entryKm: opensAt,
          exitKm: passExit,
          nominalEntryKm: passEntry,
          cued: defender.spec.sensor ? mine === null || seenFrom < mine : false,
          heldFireKm: opensAt > passEntry ? opensAt - passEntry : undefined,
          blind: stealthBypassed,
          stealthDelayed,
          stealthBypassed,
          jammed: false,
          seadSuppressed: false,
        });
      }
    }
  }

  // Sort outermost first by entryKm
  layers.sort((a, b) => a.entryKm - b.entryKm);

  /* ---------------- Walk Simulation ---------------- */

  const run = (
    bracket: Bracket,
    record: boolean
  ): {
    aircraftSurvivors: number;
    standoffLaunched: number;
    munitionsArriving: number;
    finalLeakers: number;
  } => {
    let aircraftAlive = raid.count;
    let munitionsAlive = 0;
    let launched = false;

    const magazines = new Map<string, number>();

    for (const layer of layers) {
      const { defender, weapon, index, phase } = layer;
      const key = `${defender.unitId}:${index}`;
      const stock =
        magazines.get(key) ??
        (weapon.magazine === undefined ? Infinity : weapon.magazine * defender.count);

      // Check transition to munition flight phase
      if (isStandoff && phase === 'munition-flight' && !launched) {
        launched = true;
        const countPerAircraft = Math.max(1, Math.round(raid.standoff?.munitionCount ?? 1));
        munitionsAlive = aircraftAlive * countPerAircraft;
      }

      const activeSpeed =
        phase === 'munition-flight'
          ? (raid.standoff?.munitionSpeedKmh ?? 900)
          : speedKmh;

      const exposureSec = ((layer.exitKm - layer.entryKm) / activeSpeed) * 3_600;
      const facing = phase === 'munition-flight' ? Math.max(0, munitionsAlive) : Math.max(0, aircraftAlive);

      let killed = 0;
      let rounds = 0;
      let silent: SilentReason | undefined;

      const reactionTime = (weapon.reactionSec ?? 5) + (layer.seadSuppressed ? 5 : 0) + (layer.jammed ? 5 : 0);

      if (layer.blind) {
        silent = layer.stealthBypassed ? 'stealth-bypassed' : 'blind';
      } else if (facing <= 0) {
        silent = 'nothing-left';
      } else if (exposureSec < reactionTime) {
        silent = 'too-fast';
      } else if (stock <= 0) {
        silent = 'dry';
      } else {
        const pk = bracketPk(weapon.pk as number, confidenceOf(defender.spec, index, 'pk'), bracket);
        const result = lossesFrom(
          weapon,
          defender.spec,
          pk,
          facing,
          stock,
          defender.count,
          layer.seadSuppressed,
          layer.jammed
        );
        killed = result.killed;
        rounds = result.rounds;
        magazines.set(key, stock - rounds);
      }

      if (phase === 'munition-flight') {
        munitionsAlive = Math.max(0, munitionsAlive - killed);
      } else {
        aircraftAlive = Math.max(0, aircraftAlive - killed);
      }

      if (record) {
        base.engagements.push({
          unitId: defender.unitId,
          unitLabel: defender.unitLabel,
          systemName: defender.spec.name,
          weaponName: weapon.name ?? defender.spec.name,
          rangeKm: weapon.rangeKm,
          entryKm: layer.entryKm,
          exitKm: layer.exitKm,
          exposureSec,
          facing,
          rounds,
          killed,
          silent,
          assumedEngages: !weapon.engages?.length,
          cued: layer.cued,
          heldFireKm: layer.heldFireKm,
          phase: layer.phase,
          targetType: layer.targetType,
          stealthDelayed: layer.stealthDelayed,
          stealthBypassed: layer.stealthBypassed,
          jammed: layer.jammed,
          seadSuppressed: layer.seadSuppressed,
        });
      }
    }

    if (isStandoff && !launched) {
      const countPerAircraft = Math.max(1, Math.round(raid.standoff?.munitionCount ?? 1));
      munitionsAlive = aircraftAlive * countPerAircraft;
    }

    const standoffLaunched = isStandoff
      ? aircraftAlive * Math.max(1, Math.round(raid.standoff?.munitionCount ?? 1))
      : 0;

    return {
      aircraftSurvivors: aircraftAlive,
      standoffLaunched,
      munitionsArriving: isStandoff ? munitionsAlive : 0,
      finalLeakers: isStandoff ? munitionsAlive : aircraftAlive,
    };
  };

  const statedRes = run('stated', true);
  const highRes = run('low', false); // Optimistic for attacker (defenders miss)
  const lowRes = run('high', false); // Pessimistic for attacker (defenders hit)

  const leakers = {
    low: lowRes.finalLeakers,
    stated: statedRes.finalLeakers,
    high: highRes.finalLeakers,
  };

  const aircraftSurviving = {
    low: lowRes.aircraftSurvivors,
    stated: statedRes.aircraftSurvivors,
    high: highRes.aircraftSurvivors,
  };

  const aircraftLost = {
    low: raid.count - highRes.aircraftSurvivors,
    stated: raid.count - statedRes.aircraftSurvivors,
    high: raid.count - lowRes.aircraftSurvivors,
  };

  const munitionsArriving = isStandoff
    ? {
        low: lowRes.munitionsArriving,
        stated: statedRes.munitionsArriving,
        high: highRes.munitionsArriving,
      }
    : undefined;

  let stealthAdvantage: string | undefined;
  if (raid.signature === 'low') {
    stealthAdvantage =
      '5th-Gen VLO Stealth reduces defender radar detection range by 75%, compressing SAM reaction windows.';
  } else if (raid.signature === 'medium') {
    stealthAdvantage =
      'Reduced RCS shaping reduces defender radar detection range by 35%.';
  }

  let ewSummary: string | undefined;
  if (hasEwJammer) {
    ewSummary = `EW Jamming active (${raid.escorts?.ewUnitLabel ?? 'Escort'}): -40% defender radar reach, -25% SAM Pk, +5 s reaction delay.`;
  }

  let seadSummary: string | undefined;
  if (seadSquadrons > 0) {
    seadSummary = `SEAD Escort (${raid.escorts?.seadUnitLabel ?? 'Escort'}): Suppressed active radar SAM batteries with anti-radiation strikes.`;
  }

  return {
    ...base,
    engagements: base.engagements,
    unmodelled,
    leakers,
    aircraftSurviving,
    aircraftLost,
    standoffLaunched: isStandoff ? statedRes.standoffLaunched : undefined,
    munitionsArriving,
    releaseKm: isStandoff ? releaseKm : undefined,
    releaseLngLat,
    stealthAdvantage,
    ewSummary,
    seadSummary,
  };
}

/* ------------------------------------------------------------------ */
/* From the board to the model                                         */
/* ------------------------------------------------------------------ */

export interface BoardContext {
  systems: SystemSpec[];
  munitions: MunitionCatalogue;
  formations: Formation[];
}

const specOf = (unit: DeployedUnit, ctx: BoardContext): SystemSpec | undefined =>
  unit.kind === 'unit'
    ? effectiveSpec(systemById(ctx.systems, unit.systemId), unit.loadout, ctx.munitions)
    : undefined;

const isStrikeType = (typeId: string): boolean =>
  ['strike', 'bomber', 'fighter', 'uav', 'attack-heli', 'missile', 'silo'].includes(typeId);

/**
 * Whether this deployment can fly or lead a raid.
 * Supports single units with speed, and formations with strike components!
 */
export function canRaid(unit: DeployedUnit, ctx: BoardContext): boolean {
  if (unit.kind === 'unit') {
    return Boolean(specOf(unit, ctx)?.platform?.speedKmh);
  }
  if (unit.kind === 'formation') {
    return unit.composition.some((p) => {
      if (p.count <= 0) return false;
      const spec = systemById(ctx.systems, p.systemId);
      return (spec?.platform?.speedKmh && spec.platform.speedKmh > 0) || isStrikeType(p.typeId);
    });
  }
  return false;
}

export interface RaidOptions {
  standoffEnabled?: boolean;
  weaponIndex?: number;
  ewUnitId?: string | null;
  seadUnitId?: string | null;
}

export function raidFrom(
  unit: DeployedUnit,
  to: [number, number],
  altitudeM: number,
  ctx: BoardContext,
  allUnits: DeployedUnit[] = [],
  options: RaidOptions = {}
): Raid | null {
  if (!canRaid(unit, ctx)) return null;

  let spec: SystemSpec | undefined;
  let count = 1;
  let isComposite = false;
  let packageDetails: PackageDetails | undefined;
  let escorts: EscortConfig | undefined;

  if (unit.kind === 'formation') {
    isComposite = true;
    // Find primary strike component
    let strikePart = unit.composition.find((p) => p.count > 0 && isStrikeType(p.typeId));
    if (!strikePart) strikePart = unit.composition.find((p) => p.count > 0);
    if (!strikePart) return null;

    spec =
      systemById(ctx.systems, strikePart.systemId) ??
      ({
        id: `formation-${unit.id}`,
        name: strikePart.typeId,
        typeId: strikePart.typeId,
        platform: { speedKmh: 950 },
      } as SystemSpec);

    count = strikePart.count;

    const ewCount = unit.composition
      .filter((p) => p.typeId === 'ew' || p.typeId === 'jammer')
      .reduce((s, p) => s + p.count, 0);

    const seadCount = unit.composition
      .filter((p) => p.typeId === 'fighter' && p.typeId !== strikePart?.typeId)
      .reduce((s, p) => s + p.count, 0);

    const awacsCount = unit.composition
      .filter((p) => p.typeId === 'awacs')
      .reduce((s, p) => s + p.count, 0);

    const tankerCount = unit.composition
      .filter((p) => p.typeId === 'tanker')
      .reduce((s, p) => s + p.count, 0);

    packageDetails = {
      strikeCount: count,
      strikePlatformName: spec.name,
      ewCount,
      seadCount,
      awacsCount,
      tankerCount,
    };

    escorts = {
      ewCount,
      ewUnitLabel: ewCount > 0 ? 'Integrated EW Escort' : undefined,
      seadCount,
      seadUnitLabel: seadCount > 0 ? 'Integrated SEAD Escort' : undefined,
    };
  } else {
    spec = specOf(unit, ctx);
    if (!spec) return null;
    count = unit.count;

    // Resolve attached friendly escorts if selected
    if (options.ewUnitId) {
      const ewUnit = allUnits.find((u) => u.id === options.ewUnitId);
      if (ewUnit) {
        const ewCount = ewUnit.kind === 'unit' ? ewUnit.count : totalStrength(ewUnit.composition);
        escorts = {
          ...escorts,
          ewUnitId: ewUnit.id,
          ewUnitLabel: unitLabel(ewUnit, ctx.formations, ctx.systems),
          ewCount,
        };
      }
    }

    if (options.seadUnitId) {
      const seadUnit = allUnits.find((u) => u.id === options.seadUnitId);
      if (seadUnit) {
        const seadCount = seadUnit.kind === 'unit' ? seadUnit.count : totalStrength(seadUnit.composition);
        escorts = {
          ...escorts,
          seadUnitId: seadUnit.id,
          seadUnitLabel: unitLabel(seadUnit, ctx.formations, ctx.systems),
          seadCount,
        };
      }
    }
  }

  // Setup stand-off configuration
  let standoff: StandoffConfig | undefined;
  const availableStandoff = standoffWeapons(spec);
  if (availableStandoff.length > 0) {
    const selectedIdx =
      options.weaponIndex !== undefined && options.weaponIndex < availableStandoff.length
        ? options.weaponIndex
        : 0;
    const chosen = availableStandoff[selectedIdx];
    if (chosen) {
      const w = chosen.weapon;
      const isEnabled = options.standoffEnabled !== false && w.rangeKm > 0;
      standoff = {
        enabled: isEnabled,
        weaponIndex: chosen.index,
        weaponName: w.name ?? 'Stand-off munition',
        rangeKm: w.rangeKm,
        munitionCount: Math.max(1, w.salvo ?? (w.magazine ? Math.min(w.magazine, 4) : 2)),
        munitionSignature: (w.rangeKm > 300 ? 'low' : 'medium') as 'low' | 'medium' | 'high',
        munitionSpeedKmh: 950,
      };
    }
  }

  return {
    unitId: unit.id,
    label: unitLabel(unit, ctx.formations, ctx.systems),
    spec,
    count,
    from: unit.lngLat,
    to,
    altitudeM,
    signature: spec.signature,
    standoff,
    escorts,
    isComposite,
    packageDetails,
  };
}

export function defendersFrom(
  units: DeployedUnit[],
  attackerIso: string,
  ctx: BoardContext
): Defender[] {
  const out: Defender[] = [];
  for (const unit of units) {
    if (unit.iso === attackerIso) continue;
    const label = unitLabel(unit, ctx.formations, ctx.systems);

    if (unit.kind === 'formation') {
      for (const part of unit.composition) {
        if (part.count <= 0) continue;
        const spec = systemById(ctx.systems, part.systemId);
        if (!spec || (!spec.weapons?.length && !spec.sensor)) continue;
        out.push({
          unitId: `${unit.id}:${part.typeId}:${part.systemId ?? ''}`,
          unitLabel: `${label} — ${spec.name}`,
          iso: unit.iso,
          spec,
          count: part.count,
          at: unit.lngLat,
        });
      }
      continue;
    }

    const spec = specOf(unit, ctx);
    if (!spec || (!spec.weapons?.length && !spec.sensor)) continue;
    out.push({
      unitId: unit.id,
      unitLabel: label,
      iso: unit.iso,
      spec,
      count: unit.count,
      at: unit.lngLat,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Verdict and Summary Formatters                                      */
/* ------------------------------------------------------------------ */

export const attrition = (a: Assessment): number => {
  if (a.raid.standoff?.enabled && a.standoffLaunched && a.standoffLaunched > 0) {
    return 1 - a.leakers.stated / a.standoffLaunched;
  }
  return a.raid.count > 0 ? 1 - a.leakers.stated / a.raid.count : 0;
};

export function verdict(a: Assessment): string {
  if (a.blocked === 'no-speed') return 'No speed recorded for this system — cannot be assessed.';
  if (a.blocked === 'no-distance') return 'The raid has nowhere to go.';
  if (!a.engagements.length) return 'Effectively unopposed — nothing on the board engages this raid.';

  if (a.raid.standoff?.enabled) {
    const planeLoss = a.aircraftLost.stated;
    const planeMsg = planeLoss === 0 ? 'Launch aircraft egress safely' : `${planeLoss.toFixed(1)} aircraft lost on ingress`;
    const munitionShare = a.standoffLaunched ? a.leakers.stated / a.standoffLaunched : 0;
    if (munitionShare > 0.8) return `${planeMsg}; stand-off strike heavily saturates target.`;
    if (munitionShare > 0.4) return `${planeMsg}; stand-off munitions hit target through defences.`;
    if (munitionShare > 0.05) return `${planeMsg}; high munition attrition, some leakers impact.`;
    return `${planeMsg}; stand-off salvos intercepted by point defences.`;
  }

  const share = attrition(a);
  if (share < 0.05) return 'Effectively unopposed.';
  if (share < 0.25) return 'Gets through, with minor losses.';
  if (share < 0.6) return 'Contested — a substantial part of the raid is lost.';
  if (share < 0.95) return 'Heavily attrited by defending SAM envelopes.';
  return 'Stopped — raid destroyed before reaching target.';
}
