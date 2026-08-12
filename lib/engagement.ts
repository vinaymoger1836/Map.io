/**
 * What a defence does to a raid.
 *
 * Every other number in this app describes a thing standing still. This is the
 * one place that multiplies them together, and it exists because the library has
 * been carrying `pk`, `salvo`, `reactionSec` and `magazine` from the beginning
 * for exactly this — figures nobody publishes, collected so that a model would
 * have something to multiply, and inert until now.
 *
 * ## What it is, and is not
 *
 * It answers one question: **a raid flies from here to there; how much of it
 * arrives?** It walks the path, finds every hostile envelope it crosses, and
 * takes attrition off the raid layer by layer.
 *
 * It does not model the attack itself. Nothing is destroyed at the far end, no
 * one shoots back, nothing moves on the board, and there is no time step. This
 * is still a board you arrange — the model reads it and reports, and putting a
 * number on the screen changes nothing about what is on the map.
 *
 * ## The assumptions, and which way each one is wrong
 *
 * The model is built out of published figures and four conventions. Each is
 * stated here because a leakage number with hidden assumptions is worse than no
 * number: it is a guess wearing arithmetic.
 *
 * 1. **One engagement per battery per raid.** A battery fires `salvo` rounds at
 *    each raider it can hold, once. It does not re-engage, because *re-fire
 *    interval is not a figure this library has* — and inventing one would let a
 *    single battery with a deep magazine destroy an arbitrarily large raid.
 *    → Understates the defence.
 *
 *    A consequence worth stating plainly, because it limits what detection
 *    below can buy: exposure time is only a gate, not a quantity. A layer that
 *    opens fire late does the same damage as one that opens on time, provided
 *    it gets any shot at all. Scaling shots with exposure was tried and backed
 *    out — it needed an invented re-fire cadence and an arbitrary cap, and
 *    measured against the library it moved almost no outcome, because the
 *    binding constraint is nearly always the magazine or the `pk`, not the
 *    clock.
 * 2. **An unpublished magazine is not a limit.** Only 51 of 128 weapons record
 *    ready rounds. Where none is recorded the battery is not capped, because
 *    guessing a number would silently invent the moment it runs dry.
 *    → Overstates the defence, and by more than it first appears: an S-400's
 *    48N6 records no magazine, so on paper that one round stops any raid that
 *    enters its envelope, whatever else is or is not true. When an assessment
 *    comes back *Stopped* regardless of what you change, this is usually why.
 * 3. **A weapon with no `pk` cannot be modelled at all**, and is reported as
 *    such rather than treated as harmless. A missing figure is not a zero. This
 *    is the difference between "this belt is porous" and "we do not know what
 *    this belt does", and the interface must never show the first when it means
 *    the second.
 * 4. **Exposure is a straight run at the recorded speed.** No evasion, no
 *    terrain masking, no stand-off launch: the raid flies through the middle of
 *    everything, and the speed used is the one the library records — which for
 *    most aircraft is a maximum rather than a cruise, so the run is quicker than
 *    a real one. → Overstates the defence via the straight line, understates it
 *    via the speed. The straight line is much the larger of the two.
 * 5. **Nothing fires at what it cannot see.** A weapon engages only from the
 *    point the raid is detected, so a battery whose radar horizon is shorter
 *    than its missiles opens fire late, or not at all. Three consequences worth
 *    knowing, because they pull in different directions:
 *    - **Detection is shared within a nation.** A battery blind at 61 km still
 *      fires if a friendly AEW&C or early-warning radar holds the raid, and the
 *      layer is reported as *cued*. That is how an integrated air defence
 *      works, and it is what makes a radar worth deploying — but it assumes a
 *      data link that may not exist. → Overstates the defence.
 *    - **Once held, always held.** Detection begins at the first point any
 *      friendly sensor sees the raid and does not lapse. → Overstates.
 *    - **A system with no sensor recorded is not blind, it is unrecorded**, and
 *      so is not limited at all — 48 of the 89 armed systems in the library are
 *      in that position. Treating a missing figure as a zero would silently
 *      disarm half the board, which is the same error this file refuses to make
 *      with `pk`. → Overstates, and this is the largest of the three.
 *
 * The two that overstate are stronger than the one that understates, so a raid
 * that gets through here would get through in life. Read the number as a floor
 * on what arrives, not as a prediction.
 */

import { distanceKm, interpolate } from './geo';
import { effectiveSpec, type MunitionCatalogue } from './munitions';
import {
  domainOf,
  effectiveDetectionKm,
  systemById,
  type Confidence,
  type SystemSpec,
  type TargetClass,
  type WeaponFacet,
} from './specs';
import { unitLabel, type DeployedUnit, type Domain, type Formation } from './warGames';

/* ------------------------------------------------------------------ */
/* What a raid is, as a target                                         */
/* ------------------------------------------------------------------ */

const CLASS_BY_DOMAIN: Record<Domain, TargetClass> = {
  air: 'air',
  sea: 'surface',
  sub: 'subsurface',
  ground: 'ground',
  // A fixed site is engaged by whatever engages ground: it is a thing on the
  // land, and no defence distinguishes a bunker from a battalion by class.
  site: 'ground',
};

/**
 * Ballistic tiers by the reach of the missile, since a raid of them is engaged
 * by whatever answers that tier.
 *
 * **A convention, not a citation** — like the tier tags in
 * `scripts/retag-ballistic.mjs`, and argued with in the same way. The cuts are
 * the conventional SRBM / MRBM / IRBM boundaries.
 */
function ballisticTier(rangeKm: number): TargetClass {
  if (rangeKm < 1_000) return 'ballistic-short';
  if (rangeKm < 3_000) return 'ballistic-medium';
  return 'ballistic-imrbm';
}

/**
 * What this raid *is* to a defender — the inverse of a weapon's `engages`.
 *
 * A ballistic missile unit is its missiles, not the truck they arrived on: it
 * is a ballistic threat rather than a ground one, which is the whole reason the
 * ballistic tiers exist.
 */
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

/**
 * How far a figure might be out, by the confidence recorded against it.
 *
 * This is where the provenance system finally earns its keep. A `pk` the
 * library marks `low` — which is nearly all of them — is bracketed far wider
 * than a `high` one, so the answer's spread reflects the quality of what went
 * in rather than a flat guess applied to everything. The widths themselves are
 * a convention of this file, not a published figure.
 */
const SPREAD: Record<Confidence, number> = { high: 0.1, medium: 0.25, low: 0.4 };

/** The confidence recorded for one field of one weapon, if any was. */
function confidenceOf(spec: SystemSpec, weaponIndex: number, field: string): Confidence | undefined {
  const entry = spec.provenance?.[`weapons.${weaponIndex}.${field}`];
  return entry?.confidence;
}

export type Bracket = 'low' | 'stated' | 'high';

/** A pk moved to the pessimistic or optimistic end of its own uncertainty. */
function bracketPk(pk: number, confidence: Confidence | undefined, bracket: Bracket): number {
  if (bracket === 'stated') return pk;
  // No recorded confidence is treated as the worst of the three. A figure that
  // never said how good it was does not get the benefit of the doubt.
  const spread = SPREAD[confidence ?? 'low'];
  const moved = bracket === 'low' ? pk * (1 - spread) : pk * (1 + spread);
  // Never 1: a defence that cannot miss is not a defence, it is an assertion.
  return Math.max(0, Math.min(0.98, moved));
}

/* ------------------------------------------------------------------ */
/* The raid, the defence, and the walk between them                    */
/* ------------------------------------------------------------------ */

export interface Raid {
  /** The unit flying it, for labelling the result. */
  unitId: string;
  label: string;
  /** As armed — the effective spec, so a re-armed flight is assessed as re-armed. */
  spec: SystemSpec;
  /** How many are in the air. */
  count: number;
  from: [number, number];
  to: [number, number];
  /**
   * How high it flies, in metres. This is the same quantity the coverage panel
   * calls target altitude — a defender's detection ring *is* drawn against the
   * altitude of the thing it is looking for — so the two share one value and the
   * rings on the map are the rings the raid actually flies through.
   */
  altitudeM: number;
}

/** One hostile weapon, positioned — everything the walk needs about a defender. */
export interface Defender {
  unitId: string;
  unitLabel: string;
  iso: string;
  spec: SystemSpec;
  /** How many of this system are at this pin, each with its own magazine. */
  count: number;
  at: [number, number];
}

/** What one defending weapon did to the raid as it went past. */
export interface Engagement {
  unitId: string;
  unitLabel: string;
  systemName: string;
  weaponName: string;
  rangeKm: number;
  /** Distance along the path where the raid enters and leaves the envelope. */
  entryKm: number;
  exitKm: number;
  exposureSec: number;
  /** Raiders alive when this layer opened fire. */
  facing: number;
  /** Rounds this layer actually expends. */
  rounds: number;
  /** Expected losses here, at the stated figures. */
  killed: number;
  /** Why nothing was fired, when nothing was. */
  silent?: SilentReason;
  /** True when the spec never said what this weapon engages. */
  assumedEngages?: boolean;
  /**
   * This layer is firing on somebody else's picture: its own radar cannot see
   * the raid here, and a friendly sensor can. Worth surfacing, because these are
   * the engagements that disappear the moment the data link does.
   */
  cued?: boolean;
  /**
   * How much of the weapon's reach detection cost it. Set when the raid was
   * inside the envelope before anything could see it.
   */
  heldFireKm?: number;
}

export type SilentReason =
  /** Through the envelope in less time than the system needs to shoot. */
  | 'too-fast'
  /** Ready rounds exhausted earlier in this same raid. */
  | 'dry'
  /** The raid was already destroyed before it reached this layer. */
  | 'nothing-left'
  /** In range for the whole pass, and never detected. */
  | 'blind';

export interface Assessment {
  raid: Raid;
  distanceKm: number;
  /** The raid's own class, which decides who can shoot at it. */
  threat: TargetClass;
  speedKmh: number | null;
  /** Layers in the order the raid meets them, outermost first. */
  engagements: Engagement[];
  /** Expected arrivals at the stated figures, and at each end of the bracket. */
  leakers: { low: number; stated: number; high: number };
  /**
   * Defending weapons that could have engaged but carry no `pk`. Reported, never
   * folded in as zeroes — this is the difference between a porous defence and an
   * undocumented one.
   */
  unmodelled: { unitLabel: string; weaponName: string }[];
  /** Set when the raid cannot be assessed at all, and why. */
  blocked?: 'no-speed' | 'no-distance';
}

/** Cruise speed, which sets how long the raid is under fire. */
const speedOf = (spec: SystemSpec): number | null => spec.platform?.speedKmh ?? null;

/**
 * Where the path enters and leaves one envelope, in km from the start.
 *
 * Found by walking rather than solved analytically. The path is a great circle
 * and the envelope is a geodesic circle, so the intersection has a closed form
 * only if you are willing to write spherical trigonometry that nobody will ever
 * check. Walking is a few hundred distance calls, obviously correct, and steps
 * finely enough that the smallest battery in the library is not stepped over.
 *
 * Returns null when the path never enters. Only the first continuous pass is
 * reported: a path that clips a ring, leaves and re-enters is one engagement in
 * this model, not two.
 */
function crossing(
  from: [number, number],
  to: [number, number],
  at: [number, number],
  radiusKm: number,
  totalKm: number
): { entryKm: number; exitKm: number } | null {
  // Fine enough that a 40 km ring — the shortest engagement range in the
  // library — still gets several samples inside it, and capped so a
  // transcontinental path does not walk forever.
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
  // Still inside at the target: the raid arrives under fire, which is exactly
  // what happens when you strike something inside a defended area.
  return { entryKm: entry, exitKm: exit ?? totalKm };
}

/**
 * The point along the path at which a sensor first holds the raid, or null if it
 * never does.
 *
 * Detection is judged against the altitude the raid is flying at, so the earth's
 * curve does the work it was recorded for: a battery whose radar sits 5 m up on
 * a trailer sees a 100 m target 50 km away and a 10,000 m one 430 km away, and
 * its missiles wait accordingly.
 */
function onsetFor(
  spec: SystemSpec,
  at: [number, number],
  raid: Raid,
  totalKm: number
): number | null {
  const reach = effectiveDetectionKm(spec, raid.altitudeM);
  if (!reach) return null;
  return crossing(raid.from, raid.to, at, reach, totalKm)?.entryKm ?? null;
}

/** Whether this weapon can be pointed at this raid at all. */
function engagesThreat(weapon: WeaponFacet, threat: TargetClass): boolean {
  // A weapon whose spec never said what it is for is allowed to take part, and
  // flagged. Excluding it would quietly understate the defence on the strength
  // of a missing field, which is the same error as treating a missing pk as a
  // zero — just in the other direction.
  return !weapon.engages?.length || weapon.engages.includes(threat);
}

/**
 * Losses from one battery firing one salvo at each raider it can hold.
 *
 * `1 - (1 - pk)^salvo` is the chance a salvo kills its target; multiplied by how
 * many targets are engaged at once, it is the expected loss. Fire channels cap
 * simultaneity where the spec records them — 10 of 104 systems do — and the
 * magazine caps the rounds.
 */
function lossesFrom(
  weapon: WeaponFacet,
  spec: SystemSpec,
  pk: number,
  facing: number,
  roundsLeft: number,
  /** How many of this system stand at the pin — each brings its own channels. */
  count: number
): { killed: number; rounds: number } {
  const salvo = Math.max(1, Math.round(weapon.salvo ?? 1));
  // Unrecorded fire channels are not a limit, for the same reason an unrecorded
  // magazine is not: 94 of 104 systems say nothing, and a guess here would
  // decide the answer.
  const channels =
    spec.sensor?.engagements === undefined ? facing : spec.sensor.engagements * count;
  const wanted = Math.min(facing, Math.max(1, channels));
  const affordable = Math.floor(roundsLeft / salvo);
  const engaged = Math.min(wanted, affordable);
  if (engaged <= 0) return { killed: 0, rounds: 0 };

  const perTarget = 1 - (1 - pk) ** salvo;
  return { killed: Math.min(facing, engaged * perTarget), rounds: engaged * salvo };
}

/**
 * Walks one raid through one defence.
 *
 * Runs three times over the same geometry — pessimistic, stated, optimistic —
 * so the answer arrives as a spread whose width comes from the confidence
 * recorded against each `pk`. The reported layers are the stated pass; the
 * other two exist only to bound it.
 */
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
    unmodelled: [],
  };

  if (totalKm < 1e-6) return { ...base, blocked: 'no-distance' };
  if (!speedKmh) return { ...base, blocked: 'no-speed' };

  /* Find every layer the path crosses, in the order it meets them. */
  type Layer = {
    defender: Defender;
    weapon: WeaponFacet;
    index: number;
    /** Where fire opens — inside the envelope, and not before detection. */
    entryKm: number;
    exitKm: number;
    cued?: boolean;
    heldFireKm?: number;
    /** In range throughout and never seen. */
    blind?: boolean;
  };

  const layers: Layer[] = [];
  const unmodelled: Assessment['unmodelled'] = [];

  /* Who can see the raid, and from where.
     Every sensor on the defending side is asked, armed or not: an early-warning
     radar and an AEW&C carry no weapon at all, and holding the picture for the
     batteries is the entire reason they are on the board. */
  const ownOnset = new Map<string, number | null>();
  let networkOnset: number | null = null;
  for (const defender of defenders) {
    const onset = defender.spec.sensor ? onsetFor(defender.spec, defender.at, raid, totalKm) : null;
    ownOnset.set(defender.unitId, onset);
    if (onset !== null && (networkOnset === null || onset < networkOnset)) networkOnset = onset;
  }

  for (const defender of defenders) {
    const weapons = defender.spec.weapons ?? [];
    for (let index = 0; index < weapons.length; index++) {
      const weapon = weapons[index];
      if (!weapon.rangeKm || !engagesThreat(weapon, threat)) continue;
      const cross = crossing(raid.from, raid.to, defender.at, weapon.rangeKm, totalKm);
      if (!cross) continue;

      if (weapon.pk === undefined) {
        unmodelled.push({
          unitLabel: defender.unitLabel,
          weaponName: weapon.name ?? defender.spec.name,
        });
        continue;
      }

      // A system that records no sensor is unrecorded, not blind, so nothing
      // holds its fire. One that records one waits until somebody sees the raid.
      const mine = ownOnset.get(defender.unitId) ?? null;
      const seenFrom = defender.spec.sensor ? networkOnset : cross.entryKm;

      if (seenFrom === null) {
        layers.push({ ...cross, defender, weapon, index, blind: true });
        continue;
      }

      const opensAt = Math.max(cross.entryKm, seenFrom);
      layers.push({
        defender,
        weapon,
        index,
        entryKm: opensAt,
        exitKm: cross.exitKm,
        // Firing on somebody else's picture: its own radar cannot hold the raid
        // this early, and a friendly one can.
        cued: defender.spec.sensor ? mine === null || seenFrom < mine : false,
        heldFireKm: opensAt > cross.entryKm ? opensAt - cross.entryKm : undefined,
        blind: opensAt >= cross.exitKm,
      });
    }
  }

  // Outermost first: the raid meets the belt that opens fire earliest, and the
  // order is what makes a layered defence read as layered.
  layers.sort((a, b) => a.entryKm - b.entryKm);

  /* Walk the raid through them, once per bracket. */
  const run = (bracket: Bracket, record: boolean): number => {
    let alive = raid.count;
    // Ready rounds are per pin, and are spent across the whole raid rather than
    // renewed at each layer — one battery, one magazine.
    const magazines = new Map<string, number>();

    for (const layer of layers) {
      const { defender, weapon, index } = layer;
      const key = `${defender.unitId}:${index}`;
      const stock =
        magazines.get(key) ??
        (weapon.magazine === undefined ? Infinity : weapon.magazine * defender.count);

      const exposureSec = ((layer.exitKm - layer.entryKm) / speedKmh) * 3_600;
      const facing = Math.max(0, alive);

      let killed = 0;
      let rounds = 0;
      let silent: SilentReason | undefined;

      if (layer.blind) {
        silent = 'blind';
      } else if (facing <= 0) {
        silent = 'nothing-left';
      } else if (weapon.reactionSec !== undefined && exposureSec < weapon.reactionSec) {
        silent = 'too-fast';
      } else if (stock <= 0) {
        silent = 'dry';
      } else {
        const pk = bracketPk(weapon.pk as number, confidenceOf(defender.spec, index, 'pk'), bracket);
        const result = lossesFrom(weapon, defender.spec, pk, facing, stock, defender.count);
        killed = result.killed;
        rounds = result.rounds;
        magazines.set(key, stock - rounds);
      }

      alive = Math.max(0, alive - killed);

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
        });
      }
    }
    return alive;
  };

  // The optimistic pass for the *attacker* is the one where every pk is at its
  // low end, which is why the names cross over here.
  const stated = run('stated', true);
  const high = run('low', false);
  const low = run('high', false);

  return { ...base, engagements: base.engagements, unmodelled, leakers: { low, stated, high } };
}

/* ------------------------------------------------------------------ */
/* From the board to the model                                         */
/* ------------------------------------------------------------------ */

export interface BoardContext {
  systems: SystemSpec[];
  munitions: MunitionCatalogue;
  formations: Formation[];
}

/** The system a plain deployment is actually flying, loadout applied. */
const specOf = (unit: DeployedUnit, ctx: BoardContext): SystemSpec | undefined =>
  unit.kind === 'unit'
    ? effectiveSpec(systemById(ctx.systems, unit.systemId), unit.loadout, ctx.munitions)
    : undefined;

/**
 * Whether this deployment can fly a raid.
 *
 * Two things disqualify one. A **formation** cannot: an air strike package is
 * strike aircraft, fighters, an AEW&C and a tanker, and the tanker does not fly
 * into the missile belt. Assessing it as one object would put the whole package
 * through the envelope at one speed, which is not a simplification of what
 * happens — it is a different thing happening. A composition raid wants its own
 * model, and refusing is better than inventing one.
 *
 * And a system with **no recorded speed** cannot: exposure time is the hinge the
 * whole calculation turns on, and there is no defensible default for it.
 */
export function canRaid(unit: DeployedUnit, ctx: BoardContext): boolean {
  if (unit.kind !== 'unit') return false;
  return Boolean(specOf(unit, ctx)?.platform?.speedKmh);
}

export function raidFrom(
  unit: DeployedUnit,
  to: [number, number],
  altitudeM: number,
  ctx: BoardContext
): Raid | null {
  if (unit.kind !== 'unit') return null;
  const spec = specOf(unit, ctx);
  if (!spec) return null;
  return {
    unitId: unit.id,
    label: unitLabel(unit, ctx.formations, ctx.systems),
    spec,
    count: unit.count,
    from: unit.lngLat,
    to,
    altitudeM,
  };
}

/**
 * Everything on the board that might shoot at a raid by a given nation.
 *
 * A formation contributes **one defender per system inside it**, not one for the
 * formation: a carrier group's umbrella is its escorts' umbrella, and folding
 * three destroyers into a single notional launcher would lose both their
 * separate magazines and the fact that there are three of them. This is the same
 * rule coverage already draws by.
 */
export function defendersFrom(
  units: DeployedUnit[],
  attackerIso: string,
  ctx: BoardContext
): Defender[] {
  const out: Defender[] = [];
  for (const unit of units) {
    // Everyone who is not the attacker. The board records no alliances, so it
    // cannot know that two nations are on the same side — saying "hostile to the
    // raid" means "not the raid's own", and the panel says as much.
    if (unit.iso === attackerIso) continue;
    const label = unitLabel(unit, ctx.formations, ctx.systems);

    if (unit.kind === 'formation') {
      for (const part of unit.composition) {
        if (part.count <= 0) continue;
        const spec = systemById(ctx.systems, part.systemId);
        // A sensor with no weapon still belongs here: the radar inside an air
        // defence system is what lets its launchers shoot.
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
    // Armed, or able to see for something that is armed.
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
/* Reading the result                                                  */
/* ------------------------------------------------------------------ */

/** Losses as a share of the raid, which is the figure people argue about. */
export const attrition = (a: Assessment): number =>
  a.raid.count > 0 ? 1 - a.leakers.stated / a.raid.count : 0;

/**
 * A one-line verdict.
 *
 * Deliberately coarse. The inputs do not support "63% attrition" as a sentence,
 * and a band says what the model actually knows.
 */
export function verdict(a: Assessment): string {
  if (a.blocked === 'no-speed') return 'No speed recorded for this system — cannot be assessed.';
  if (a.blocked === 'no-distance') return 'The raid has nowhere to go.';
  if (!a.engagements.length) return 'Nothing on the board engages this raid.';

  const share = attrition(a);
  if (share < 0.05) return 'Effectively unopposed.';
  if (share < 0.25) return 'Gets through, with losses.';
  if (share < 0.6) return 'Contested — a substantial part of the raid is lost.';
  if (share < 0.95) return 'Heavily attrited.';
  return 'Stopped.';
}
