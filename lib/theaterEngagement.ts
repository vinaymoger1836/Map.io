/**
 * Operational Theater-Level Raid & Multi-Phase Strike Engine
 *
 * Coordinates multi-phase strike operations (Air Tasking Orders) against defended
 * target complexes (e.g. Airbases, Naval Fleets, Command Bunkers).
 *
 * Features:
 * 1. Defensive Umbrella Auto-Discovery (SAM batteries, CAP interceptors, sensors covering the target).
 * 2. Attacker Reach Discovery (warships, strike wings, drone swarms within reach of target or defenders).
 * 3. Multi-Phase Strike Sequencing (e.g. OCA Fighter Sweep -> SEAD SAM Suppression -> Main Saturation).
 * 4. State & Magazine Persistence across phases (expended missiles & destroyed radars persist across phases).
 * 5. Multi-Vector Map Pathing & Chronological Theater Battle Debrief.
 */

import { distanceKm, interpolate, greatCirclePath } from './geo';
import { effectiveSpec, type MunitionCatalogue } from './munitions';
import {
  effectiveDetectionKm,
  maxMunitionCapacity,
  radarHorizonKm,
  signatureRangeMultiplier,
  standoffWeapons,
  systemById,
  type SystemSpec,
  type TargetClass,
  type WeaponFacet,
} from './specs';
import {
  totalStrength,
  unitLabel,
  type DeployedUnit,
  type Formation,
} from './warGames';
import { type RaidPathSpec } from './warLayers';
import { threatClassOf, type SilentReason } from './engagement';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface DefensiveUmbrella {
  target: DeployedUnit;
  targetSpec?: SystemSpec;
  samDefenders: { unit: DeployedUnit; spec: SystemSpec; rangeKm: number; coverageDistanceKm: number }[];
  capDefenders: { unit: DeployedUnit; spec: SystemSpec; combatRadiusKm: number }[];
  sensorDefenders: { unit: DeployedUnit; spec: SystemSpec; detectionKm: number }[];
}

export interface CandidateAttacker {
  unit: DeployedUnit;
  spec: SystemSpec;
  distanceToTargetKm: number;
  availableWeapons: { weapon: WeaponFacet; index: number; maxMagazine: number }[];
  canReachTarget: boolean;
  canReachUmbrella: boolean;
}

export interface StrikePhaseTask {
  id: string;
  order: number;
  title: string;
  category: 'oca' | 'sead' | 'strike' | 'standoff';
  attackerUnitId: string;
  targetUnitId: string;
  weaponIndex: number;
  salvoSize: number;
  altitudeM: number;
}

export interface UnitPersistentState {
  unitId: string;
  initialCount: number;
  aliveCount: number;
  destroyedCount: number;
  status: 'intact' | 'damaged' | 'suppressed' | 'destroyed';
  /** Maps weapon index to current ready rounds remaining in magazine */
  magazines: Map<number, number>;
}

export interface PhaseBattleLogEvent {
  id: string;
  timeFormatted: string;
  title: string;
  detail: string;
  badge?: {
    text: string;
    variant: 'stealth' | 'standoff' | 'sead' | 'jammed' | 'bypassed' | 'loss' | 'success' | 'neutral';
  };
}

export interface PhaseReport {
  task: StrikePhaseTask;
  attackerLabel: string;
  targetLabel: string;
  weaponName: string;
  salvoCommitted: number;
  attackerPlatformsLost: number;
  attackerPlatformsSurviving: number;
  munitionsIntercepted: number;
  munitionsImpacted: number;
  targetDestroyed: boolean;
  targetSuppressed: boolean;
  targetDamageSummary: string;
  battleLog: PhaseBattleLogEvent[];
  pathSpec?: RaidPathSpec;
}

export interface TheaterAssessment {
  mainTargetId: string;
  mainTargetLabel: string;
  attackerIso: string;
  phases: PhaseReport[];
  primaryTargetStatus: 'destroyed' | 'damaged' | 'held';
  overallVerdict: string;
  overallHeadline: string;
  cumulativeAttackerLosses: { name: string; count: number }[];
  cumulativeAttackerSurvivors: { name: string; count: number }[];
  cumulativeDefenderLosses: { name: string; count: number; status: 'destroyed' | 'suppressed' | 'held' }[];
  unitFinalStates: Map<string, UnitPersistentState>;
  pathSpecs: RaidPathSpec[];
}

export interface BoardContext {
  systems: SystemSpec[];
  munitions: MunitionCatalogue;
  formations: Formation[];
}

/* ------------------------------------------------------------------ */
/* Discovery Functions                                                */
/* ------------------------------------------------------------------ */

const specOf = (unit: DeployedUnit, ctx: BoardContext): SystemSpec | undefined =>
  unit.kind === 'unit'
    ? effectiveSpec(systemById(ctx.systems, unit.systemId), unit.loadout, ctx.munitions)
    : undefined;

/**
 * Discovers all friendly defending assets that provide umbrella protection over the target.
 */
export function discoverDefensiveUmbrella(
  target: DeployedUnit,
  allUnits: DeployedUnit[],
  ctx: BoardContext
): DefensiveUmbrella {
  const targetSpec = specOf(target, ctx);
  const sameNationUnits = allUnits.filter((u) => u.iso === target.iso && u.id !== target.id);

  const samDefenders: DefensiveUmbrella['samDefenders'] = [];
  const capDefenders: DefensiveUmbrella['capDefenders'] = [];
  const sensorDefenders: DefensiveUmbrella['sensorDefenders'] = [];

  for (const u of sameNationUnits) {
    const spec = specOf(u, ctx);
    if (!spec) continue;
    const distKm = distanceKm(u.lngLat, target.lngLat);

    // SAM batteries covering the target
    const airWeapons = (spec.weapons ?? []).filter((w) => w.rangeKm && w.rangeKm > 0 && (!w.engages || w.engages.includes('air')));
    const maxSamRange = airWeapons.length > 0 ? Math.max(...airWeapons.map((w) => w.rangeKm)) : 0;

    if (maxSamRange >= distKm || distKm <= 150) {
      samDefenders.push({ unit: u, spec, rangeKm: maxSamRange, coverageDistanceKm: distKm });
    }

    // CAP Fighters covering the target
    const combatRadius = spec.platform?.combatRadiusKm ?? 0;
    if (spec.typeId === 'fighter' || spec.typeId === 'interceptor') {
      if (combatRadius >= distKm || distKm <= 500) {
        capDefenders.push({ unit: u, spec, combatRadiusKm: combatRadius });
      }
    }

    // Early Warning / AEW&C Sensors
    const detection = spec.sensor?.detectionKm ?? 0;
    if (detection >= distKm || spec.typeId === 'awacs' || spec.typeId === 'radar') {
      sensorDefenders.push({ unit: u, spec, detectionKm: detection });
    }
  }

  return {
    target,
    targetSpec,
    samDefenders,
    capDefenders,
    sensorDefenders,
  };
}

/**
 * Discovers all attacking assets that can participate in the theater strike operation.
 */
export function discoverAttackerAssets(
  attackerIso: string,
  target: DeployedUnit,
  umbrella: DefensiveUmbrella,
  allUnits: DeployedUnit[],
  ctx: BoardContext
): CandidateAttacker[] {
  const attackingUnits = allUnits.filter((u) => u.iso === attackerIso);
  const out: CandidateAttacker[] = [];

  const defenderPositions = [
    target.lngLat,
    ...umbrella.samDefenders.map((d) => d.unit.lngLat),
    ...umbrella.capDefenders.map((d) => d.unit.lngLat),
  ];

  for (const unit of attackingUnits) {
    const spec = specOf(unit, ctx);
    if (!spec) continue;
    const distToTarget = distanceKm(unit.lngLat, target.lngLat);
    const unitCount = unit.kind === 'unit' ? unit.count : 1;

    const weapons = standoffWeapons(spec).map(({ weapon, index }) => {
      const loadoutCount = unit.kind === 'unit' ? unit.loadout?.find((l) => l.id === weapon.id)?.count : undefined;
      const maxMag = maxMunitionCapacity(spec, weapon, unitCount, loadoutCount);
      return { weapon, index, maxMagazine: maxMag };
    });

    const combatRadius = spec.platform?.combatRadiusKm ?? 0;
    const refuelledRadius = spec.platform?.refuelledRadiusKm ?? combatRadius;
    const maxWeaponRange = weapons.length > 0 ? Math.max(...weapons.map((w) => w.weapon.rangeKm)) : 0;
    const totalReach = Math.max(combatRadius + maxWeaponRange, refuelledRadius + maxWeaponRange, maxWeaponRange);

    const canReachTarget = totalReach >= distToTarget;
    const canReachUmbrella = defenderPositions.some((pos) => totalReach >= distanceKm(unit.lngLat, pos));

    if (weapons.length > 0 || combatRadius > 0) {
      out.push({
        unit,
        spec,
        distanceToTargetKm: distToTarget,
        availableWeapons: weapons,
        canReachTarget,
        canReachUmbrella,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Theater Simulation Engine with Persistent Munition Tracking        */
/* ------------------------------------------------------------------ */

const PHASE_COLORS = ['#4DD0E1', '#FF8A65', '#FFD54F', '#BA68C8', '#4FC3F7'];

export function assessTheaterRaid(
  targetUnitId: string,
  attackerIso: string,
  phases: StrikePhaseTask[],
  allUnits: DeployedUnit[],
  ctx: BoardContext
): TheaterAssessment | null {
  const target = allUnits.find((u) => u.id === targetUnitId);
  if (!target) return null;

  const targetSpec = specOf(target, ctx);
  const targetLabel = unitLabel(target, ctx.formations, ctx.systems);

  // Initialize persistent unit states
  const unitStates = new Map<string, UnitPersistentState>();

  for (const u of allUnits) {
    const spec = specOf(u, ctx);
    if (!spec) continue;
    const count = u.kind === 'unit' ? u.count : 1;
    const magazines = new Map<number, number>();

    (spec.weapons ?? []).forEach((w, idx) => {
      const loadoutCount = u.kind === 'unit' ? u.loadout?.find((l) => l.id === w.id)?.count : undefined;
      const cap = maxMunitionCapacity(spec, w, count, loadoutCount);
      magazines.set(idx, cap);
    });

    unitStates.set(u.id, {
      unitId: u.id,
      initialCount: count,
      aliveCount: count,
      destroyedCount: 0,
      status: 'intact',
      magazines,
    });
  }

  const phaseReports: PhaseReport[] = [];
  const pathSpecs: RaidPathSpec[] = [];

  for (let pIdx = 0; pIdx < phases.length; pIdx++) {
    const task = phases[pIdx];
    const attackerUnit = allUnits.find((u) => u.id === task.attackerUnitId);
    const targetUnit = allUnits.find((u) => u.id === task.targetUnitId);
    if (!attackerUnit || !targetUnit) continue;

    const attackerState = unitStates.get(attackerUnit.id);
    const targetState = unitStates.get(targetUnit.id);
    if (!attackerState || !targetState) continue;

    const attackerSpec = specOf(attackerUnit, ctx);
    const targetSpecCurr = specOf(targetUnit, ctx);
    if (!attackerSpec || !targetSpecCurr) continue;

    const attackerLabel = unitLabel(attackerUnit, ctx.formations, ctx.systems);
    const phaseTargetLabel = unitLabel(targetUnit, ctx.formations, ctx.systems);

    const weapon = attackerSpec.weapons?.[task.weaponIndex] ?? { rangeKm: 50, name: 'Standard Strike Munition' };
    const weaponName = weapon.name ?? 'Strike Munition';

    const battleLog: PhaseBattleLogEvent[] = [];
    let evtId = 0;
    const nextEvt = () => `p${pIdx}-evt-${++evtId}`;

    // Check attacker availability
    if (attackerState.status === 'destroyed' || attackerState.aliveCount <= 0) {
      phaseReports.push({
        task,
        attackerLabel,
        targetLabel: phaseTargetLabel,
        weaponName,
        salvoCommitted: 0,
        attackerPlatformsLost: 0,
        attackerPlatformsSurviving: 0,
        munitionsIntercepted: 0,
        munitionsImpacted: 0,
        targetDestroyed: targetState.status === 'destroyed',
        targetSuppressed: targetState.status === 'suppressed',
        targetDamageSummary: 'Task Aborted: Attacking platform destroyed in previous phase.',
        battleLog: [
          {
            id: nextEvt(),
            timeFormatted: 'T+00m',
            title: 'Task Aborted',
            detail: `${attackerLabel} was destroyed in an earlier phase and cannot execute this strike.`,
            badge: { text: 'Platform Lost', variant: 'loss' },
          },
        ],
      });
      continue;
    }

    // Check target availability
    if (targetState.status === 'destroyed') {
      phaseReports.push({
        task,
        attackerLabel,
        targetLabel: phaseTargetLabel,
        weaponName,
        salvoCommitted: 0,
        attackerPlatformsLost: 0,
        attackerPlatformsSurviving: attackerState.aliveCount,
        munitionsIntercepted: 0,
        munitionsImpacted: 0,
        targetDestroyed: true,
        targetSuppressed: true,
        targetDamageSummary: 'Target already destroyed in prior phase.',
        battleLog: [
          {
            id: nextEvt(),
            timeFormatted: 'T+00m',
            title: 'Target Already Neutralized',
            detail: `${phaseTargetLabel} has already been destroyed in an earlier strike wave. Zero munitions committed.`,
            badge: { text: 'Neutralized', variant: 'neutral' },
          },
        ],
      });
      continue;
    }

    // Check available magazine for attacker
    const curAttackerMag = attackerState.magazines.get(task.weaponIndex) ?? 0;
    const actualSalvo = Math.min(curAttackerMag, Math.max(1, task.salvoSize));

    // Deduct from attacker magazine
    attackerState.magazines.set(task.weaponIndex, Math.max(0, curAttackerMag - actualSalvo));

    const totalDistKm = distanceKm(attackerUnit.lngLat, targetUnit.lngLat);
    const isStandoff = weapon.rangeKm > 0;
    const standoffDistKm = isStandoff ? Math.min(weapon.rangeKm, totalDistKm) : 0;
    const releaseDistKm = isStandoff ? Math.max(0, totalDistKm - standoffDistKm) : totalDistKm;
    const releaseLngLat =
      isStandoff && totalDistKm > 0 ? interpolate(attackerUnit.lngLat, targetUnit.lngLat, releaseDistKm / totalDistKm) : undefined;

    // Log Launch
    battleLog.push({
      id: nextEvt(),
      timeFormatted: 'T+00m',
      title: `${task.title} Initiated`,
      detail: `${attackerLabel} launched salvo of ${actualSalvo} × ${weaponName} against ${phaseTargetLabel} (Remaining Magazine: ${attackerState.magazines.get(task.weaponIndex)}).`,
      badge: { text: `${actualSalvo} Committed`, variant: 'standoff' },
    });

    // SAM and CAP Interception Walk along this phase corridor
    let munitionsSurviving = actualSalvo;
    let attackerLost = 0;
    let totalIntercepted = 0;

    // Find defenders covering this route
    const defenders = allUnits.filter((u) => u.iso === targetUnit.iso);

    for (const def of defenders) {
      const defState = unitStates.get(def.id);
      if (!defState || defState.status === 'destroyed' || defState.aliveCount <= 0) continue;

      const defSpec = specOf(def, ctx);
      if (!defSpec) continue;

      // Check if SAM is suppressed
      const isSuppressed = defState.status === 'suppressed';

      for (let wIdx = 0; wIdx < (defSpec.weapons ?? []).length; wIdx++) {
        const defWeapon = defSpec.weapons[wIdx];
        if (!defWeapon.rangeKm || defWeapon.rangeKm <= 0) continue;
        if (defWeapon.engages && !defWeapon.engages.includes('air')) continue;

        // Check if SAM envelope intersects phase route
        const distToCorridor = distanceKm(def.lngLat, targetUnit.lngLat);
        if (distToCorridor > defWeapon.rangeKm + 20) continue;

        // Check defender remaining magazine
        const readyRounds = defState.magazines.get(wIdx) ?? 0;
        if (readyRounds <= 0) {
          battleLog.push({
            id: nextEvt(),
            timeFormatted: 'T+12m',
            title: `${unitLabel(def, ctx.formations, ctx.systems)} Magazine Dry`,
            detail: `Defending battery was in range, but has exhausted all ready interceptor rounds in earlier phases.`,
            badge: { text: '0 Ammo', variant: 'neutral' },
          });
          continue;
        }

        // Fire Channels & Interception Math
        let channels = defSpec.sensor?.engagements ?? 4;
        if (isSuppressed) channels = Math.max(1, Math.floor(channels / 2));
        channels = channels * defState.aliveCount;

        const wantedRounds = Math.min(munitionsSurviving, channels) * (defWeapon.salvo ?? 2);
        const roundsFired = Math.min(readyRounds, wantedRounds);

        // Deduct from defender persistent magazine
        defState.magazines.set(wIdx, readyRounds - roundsFired);

        const basePk = defWeapon.pk ?? 0.75;
        const effectivePk = isSuppressed ? basePk * 0.7 : basePk;
        const targetsEngaged = Math.floor(roundsFired / (defWeapon.salvo ?? 2));
        const kills = Math.min(munitionsSurviving, Math.round(targetsEngaged * effectivePk));

        if (roundsFired > 0) {
          totalIntercepted += kills;
          munitionsSurviving = Math.max(0, munitionsSurviving - kills);

          const defLabel = unitLabel(def, ctx.formations, ctx.systems);
          if (kills > 0) {
            battleLog.push({
              id: nextEvt(),
              timeFormatted: 'T+18m',
              title: `${defLabel} Interception`,
              detail: `${defLabel} fired ${roundsFired} × ${defWeapon.name ?? 'SAM'} interceptors (Remaining Magazine: ${defState.magazines.get(wIdx)}). Intercepted ${kills} incoming munitions.`,
              badge: { text: `${kills} Intercepted`, variant: 'loss' },
            });
          } else {
            battleLog.push({
              id: nextEvt(),
              timeFormatted: 'T+18m',
              title: `${defLabel} Salvo Evaded`,
              detail: `${defLabel} fired ${roundsFired} interceptors, but strike salvo used countermeasures to evade. 0 hits.`,
              badge: { text: 'Evaded', variant: 'success' },
            });
          }
        }
      }
    }

    // Target Impact & Damage Resolution
    const hits = munitionsSurviving;
    let targetDestroyed = false;
    let targetSuppressed = false;
    let damageSummary = '';

    if (hits > 0) {
      if (task.category === 'sead') {
        targetState.status = hits >= 2 ? 'destroyed' : 'suppressed';
        targetDestroyed = targetState.status === 'destroyed';
        targetSuppressed = true;
        damageSummary = targetDestroyed
          ? 'Radar Emitters Destroyed — Battery completely knocked offline.'
          : 'Battery SEAD Suppressed — Fire channels halved for subsequent phases.';

        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+25m',
          title: `SEAD Target Neutralized — ${phaseTargetLabel}`,
          detail: `${hits} anti-radiation munitions struck radar transmitters. ${damageSummary}`,
          badge: { text: targetDestroyed ? 'Radar Destroyed' : 'Suppressed', variant: 'sead' },
        });
      } else if (task.category === 'oca') {
        targetState.status = 'destroyed';
        targetState.aliveCount = 0;
        targetState.destroyedCount += targetState.initialCount;
        targetDestroyed = true;
        damageSummary = 'Enemy Fighter Flight Shot Down — Air superiority established.';

        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+25m',
          title: `Fighter Sweep Victory — ${phaseTargetLabel}`,
          detail: `${hits} missiles splashed defending aircraft. Combat air patrol neutralized.`,
          badge: { text: 'CAP Splashed', variant: 'success' },
        });
      } else {
        // Main Strike
        targetState.status = hits >= 4 ? 'destroyed' : 'damaged';
        targetDestroyed = targetState.status === 'destroyed';
        damageSummary = targetDestroyed
          ? `Target Objective Obliterated by ${hits} direct missile impacts.`
          : `Target Objective Heavily Damaged by ${hits} missile impacts.`;

        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+30m',
          title: `Objective Struck — ${phaseTargetLabel}`,
          detail: `${hits} cruise missiles impacted objective. ${damageSummary}`,
          badge: { text: `${hits} Impacts`, variant: 'success' },
        });
      }
    } else {
      damageSummary = 'Strike wave stopped by integrated point defences before target impact.';
      battleLog.push({
        id: nextEvt(),
        timeFormatted: 'T+30m',
        title: `Strike Wave Stopped`,
        detail: `All incoming missiles were intercepted. Target ${phaseTargetLabel} sustained zero damage.`,
        badge: { text: '0 Hits', variant: 'loss' },
      });
    }

    // Path Spec for Map
    const phaseColor = PHASE_COLORS[pIdx % PHASE_COLORS.length];
    let pathSpec: RaidPathSpec | undefined;
    if (releaseLngLat) {
      pathSpec = {
        ingress: greatCirclePath(attackerUnit.lngLat, releaseLngLat, 32),
        munition: greatCirclePath(releaseLngLat, targetUnit.lngLat, 32),
        releasePoint: releaseLngLat,
        targetPoint: targetUnit.lngLat,
        color: phaseColor,
        munitionColor: '#FFB020',
      };
    } else {
      pathSpec = {
        ingress: greatCirclePath(attackerUnit.lngLat, targetUnit.lngLat, 48),
        targetPoint: targetUnit.lngLat,
        color: phaseColor,
      };
    }
    pathSpecs.push(pathSpec);

    phaseReports.push({
      task,
      attackerLabel,
      targetLabel: phaseTargetLabel,
      weaponName,
      salvoCommitted: actualSalvo,
      attackerPlatformsLost: attackerLost,
      attackerPlatformsSurviving: attackerState.aliveCount,
      munitionsIntercepted: totalIntercepted,
      munitionsImpacted: hits,
      targetDestroyed,
      targetSuppressed,
      targetDamageSummary: damageSummary,
      battleLog,
      pathSpec,
    });
  }

  // Master Theater Debrief
  const primaryTargetState = unitStates.get(targetUnitId);
  const primaryTargetStatus =
    primaryTargetState?.status === 'destroyed' ? 'destroyed' : primaryTargetState?.status === 'damaged' ? 'damaged' : 'held';

  const overallHeadline =
    primaryTargetStatus === 'destroyed'
      ? 'THEATER MISSION ACCOMPLISHED — Primary Objective Destroyed'
      : primaryTargetStatus === 'damaged'
        ? 'CONTESTED THEATER STRIKE — Primary Objective Heavily Damaged'
        : 'DEFENDER VICTORY — Primary Objective Protected by Integrated Network';

  const overallVerdict =
    primaryTargetStatus === 'destroyed'
      ? `Coordinated multi-phase strikes successfully suppressed defensive radar umbrellas and delivered decisive saturation against ${targetLabel}.`
      : primaryTargetStatus === 'damaged'
        ? `Strike waves penetrated defensive layers and inflicted substantial structural damage on ${targetLabel}, but some defences held.`
        : `Defending integrated SAM and CAP network intercepted incoming strike salvos and preserved the operational readiness of ${targetLabel}.`;

  const cumulativeAttackerLosses: TheaterAssessment['cumulativeAttackerLosses'] = [];
  const cumulativeAttackerSurvivors: TheaterAssessment['cumulativeAttackerSurvivors'] = [];
  const cumulativeDefenderLosses: TheaterAssessment['cumulativeDefenderLosses'] = [];

  for (const rep of phaseReports) {
    if (rep.munitionsIntercepted > 0) {
      cumulativeAttackerLosses.push({
        name: `${rep.weaponName} (${rep.attackerLabel} - Intercepted)`,
        count: rep.munitionsIntercepted,
      });
    }
    if (rep.munitionsImpacted > 0) {
      cumulativeAttackerSurvivors.push({
        name: `${rep.weaponName} (${rep.attackerLabel} - Target Hits)`,
        count: rep.munitionsImpacted,
      });
    }
  }

  if (cumulativeAttackerLosses.length === 0) {
    cumulativeAttackerLosses.push({ name: 'Zero platforms/munitions lost', count: 0 });
  }

  // List defender casualties
  for (const [uId, uState] of unitStates.entries()) {
    const u = allUnits.find((unit) => unit.id === uId);
    if (!u || u.iso === attackerIso) continue;
    if (uState.status !== 'intact') {
      cumulativeDefenderLosses.push({
        name: unitLabel(u, ctx.formations, ctx.systems),
        count: uState.status === 'destroyed' ? uState.initialCount : 1,
        status: uState.status === 'destroyed' ? 'destroyed' : uState.status === 'suppressed' ? 'suppressed' : 'held',
      });
    }
  }

  return {
    mainTargetId: targetUnitId,
    mainTargetLabel: targetLabel,
    attackerIso,
    phases: phaseReports,
    primaryTargetStatus,
    overallHeadline,
    overallVerdict,
    cumulativeAttackerLosses,
    cumulativeAttackerSurvivors,
    cumulativeDefenderLosses,
    unitFinalStates: unitStates,
    pathSpecs,
  };
}
