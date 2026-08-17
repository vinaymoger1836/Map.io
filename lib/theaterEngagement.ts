/**
 * Operational Theater-Level Raid & Multi-Phase Strike Engine
 *
 * Coordinates operational-level Air Tasking Orders against defended
 * target complexes (e.g. Airbases, Naval Fleets, Command Bunkers).
 *
 * Features:
 * 1. Defensive Umbrella Auto-Discovery (SAM batteries, CAP interceptors, sensors covering the target).
 * 2. Attacker Reach Discovery (warships, strike wings, drone swarms within reach of target or defenders).
 * 3. Simultaneous & Sequential Strike Sequencing (e.g. OCA Fighter Sweep + SEAD in Phase 1 -> Main Strike in Phase 2).
 * 4. State & Magazine Persistence across phases (expended missiles & destroyed radars persist across phases).
 * 5. Multi-Vector Map Pathing & Chronological Theater Battle Debrief.
 */

import { distanceKm, interpolate, greatCirclePath, crossing } from './geo';
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
  phaseNumber: number; // 1, 2, 3...
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

export interface PhaseInterceptionRecord {
  defenderUnitId: string;
  defenderLabel: string;
  defenderLngLat: [number, number];
  interceptLngLat: [number, number];
  entryFraction: number;
  roundsFired: number;
  kills: number;
}

export interface PhaseReport {
  task: StrikePhaseTask;
  phaseNumber: number;
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
  interceptions?: PhaseInterceptionRecord[];
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

const isStrikeType = (typeId: string): boolean =>
  ['strike', 'bomber', 'fighter', 'uav', 'attack-heli', 'missile', 'silo', 'destroyer', 'cruiser', 'corvette', 'submarine'].includes(typeId);

export const specOf = (unit: DeployedUnit, ctx: BoardContext): SystemSpec | undefined => {
  if (unit.kind === 'unit') {
    const raw = systemById(ctx.systems, unit.systemId);
    return raw ? effectiveSpec(raw, unit.loadout, ctx.munitions) : undefined;
  }
  if (unit.kind === 'formation') {
    let strikePart = unit.composition.find((p) => p.count > 0 && isStrikeType(p.typeId));
    if (!strikePart) strikePart = unit.composition.find((p) => p.count > 0);
    if (!strikePart) return undefined;
    const baseSpec = systemById(ctx.systems, strikePart.systemId);
    if (baseSpec) return baseSpec;

    return {
      id: `formation-${unit.id}`,
      name: strikePart.typeId,
      typeId: strikePart.typeId,
      platform: { speedKmh: 950, combatRadiusKm: 1200 },
      weapons: [{ name: 'Strike Munitions', rangeKm: 300, salvo: 4, magazine: 16 }],
    } as SystemSpec;
  }
  return undefined;
};

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

    if (maxSamRange >= distKm || distKm <= 250) {
      samDefenders.push({ unit: u, spec, rangeKm: maxSamRange, coverageDistanceKm: distKm });
    }

    // CAP Fighters covering the target
    const combatRadius = spec.platform?.combatRadiusKm ?? 0;
    if (spec.typeId === 'fighter' || spec.typeId === 'interceptor' || u.kind === 'formation') {
      if (combatRadius >= distKm || distKm <= 600) {
        capDefenders.push({ unit: u, spec, combatRadiusKm: combatRadius || 800 });
      }
    }

    // Early Warning / AEW&C Sensors
    const detection = spec.sensor?.detectionKm ?? 0;
    if (detection >= distKm || spec.typeId === 'awacs' || spec.typeId === 'radar') {
      sensorDefenders.push({ unit: u, spec, detectionKm: detection || 400 });
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
    const unitCount = unit.kind === 'unit' ? unit.count : totalStrength(unit.composition);

    let weapons = standoffWeapons(spec).map(({ weapon, index }) => {
      const loadoutCount = unit.kind === 'unit' ? unit.loadout?.find((l) => l.id === weapon.id)?.count : undefined;
      const maxMag = maxMunitionCapacity(spec, weapon, unitCount, loadoutCount);
      return { weapon, index, maxMagazine: maxMag };
    });

    if (weapons.length === 0) {
      weapons = [
        {
          weapon: { name: 'Precision Air Munitions', rangeKm: 120, salvo: 2, magazine: 8 },
          index: 0,
          maxMagazine: 8 * unitCount,
        },
      ];
    }

    const combatRadius = spec.platform?.combatRadiusKm ?? 800;
    const refuelledRadius = spec.platform?.refuelledRadiusKm ?? combatRadius;
    const maxWeaponRange = weapons.length > 0 ? Math.max(...weapons.map((w) => w.weapon.rangeKm)) : 0;
    const totalReach = Math.max(combatRadius + maxWeaponRange, refuelledRadius + maxWeaponRange, maxWeaponRange);

    const canReachTarget = totalReach >= distToTarget;
    const canReachUmbrella = defenderPositions.some((pos) => totalReach >= distanceKm(unit.lngLat, pos));

    out.push({
      unit,
      spec,
      distanceToTargetKm: distToTarget,
      availableWeapons: weapons,
      canReachTarget,
      canReachUmbrella,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Theater Simulation Engine with Persistent Munition Tracking        */
/* ------------------------------------------------------------------ */

const PHASE_COLORS = ['#4DD0E1', '#FF8A65', '#FFD54F', '#BA68C8', '#4FC3F7', '#81C784', '#FF80AB', '#FFB74D', '#AED581'];

export function assessTheaterRaid(
  targetUnitId: string,
  attackerIso: string,
  phases: StrikePhaseTask[],
  allUnits: DeployedUnit[],
  ctx: BoardContext
): TheaterAssessment | null {
  const target = allUnits.find((u) => u.id === targetUnitId);
  if (!target) return null;

  const targetLabel = unitLabel(target, ctx.formations, ctx.systems);

  // Initialize persistent unit states
  const unitStates = new Map<string, UnitPersistentState>();

  for (const u of allUnits) {
    const spec = specOf(u, ctx);
    if (!spec) continue;
    const count = u.kind === 'unit' ? u.count : Math.max(1, totalStrength(u.composition));
    const magazines = new Map<number, number>();

    const weaponsList = spec.weapons && spec.weapons.length > 0
      ? spec.weapons
      : [{ name: 'Standard Munition', rangeKm: 80, salvo: 2, magazine: 8 }];

    weaponsList.forEach((w, idx) => {
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

  // Group tasks by phaseNumber to support simultaneous operations within the same wave
  const phaseNumbers = Array.from(new Set(phases.map((p) => p.phaseNumber))).sort((a, b) => a - b);

  let taskGlobalIdx = 0;

  for (const pNum of phaseNumbers) {
    const tasksInPhase = phases.filter((p) => p.phaseNumber === pNum);

    // Sort tasks in this phase so Offensive Counter-Air (OCA) resolves first, then SEAD, then Main Strikes
    const sortedTasks = [...tasksInPhase].sort((a, b) => {
      const order = { oca: 1, sead: 2, standoff: 3, strike: 4 };
      return (order[a.category] ?? 3) - (order[b.category] ?? 3);
    });

    // Check if CAP fighters were pinned/neutralized during OCA in this phase
    let capFightersPinnedInThisPhase = false;

    for (const task of sortedTasks) {
      taskGlobalIdx++;
      const attackerUnit = allUnits.find((u) => u.id === task.attackerUnitId);
      const targetUnit = allUnits.find((u) => u.id === task.targetUnitId);
      if (!attackerUnit || !targetUnit) continue;

      let attackerState = unitStates.get(attackerUnit.id);
      let targetState = unitStates.get(targetUnit.id);

      if (!attackerState) {
        attackerState = {
          unitId: attackerUnit.id,
          initialCount: 1,
          aliveCount: 1,
          destroyedCount: 0,
          status: 'intact',
          magazines: new Map([[0, 24]]),
        };
        unitStates.set(attackerUnit.id, attackerState);
      }

      if (!targetState) {
        targetState = {
          unitId: targetUnit.id,
          initialCount: 1,
          aliveCount: 1,
          destroyedCount: 0,
          status: 'intact',
          magazines: new Map([[0, 24]]),
        };
        unitStates.set(targetUnit.id, targetState);
      }

      const attackerSpec = specOf(attackerUnit, ctx) ?? ({
        id: attackerUnit.id,
        name: attackerUnit.kind === 'unit' ? attackerUnit.typeId : 'Strike Force',
        typeId: 'strike',
        platform: { speedKmh: 950 },
        weapons: [{ name: 'Standoff Cruise Missile', rangeKm: 600, salvo: 4, magazine: 24 }],
      } as SystemSpec);

      const attackerLabel = unitLabel(attackerUnit, ctx.formations, ctx.systems);
      const phaseTargetLabel = unitLabel(targetUnit, ctx.formations, ctx.systems);

      const weapon = attackerSpec.weapons?.[task.weaponIndex] ?? { rangeKm: 50, name: 'Standard Strike Munition' };
      const weaponName = weapon.name ?? 'Strike Munition';

      const battleLog: PhaseBattleLogEvent[] = [];
      let evtId = 0;
      const nextEvt = () => `p${pNum}-t${taskGlobalIdx}-evt-${++evtId}`;

      // Check attacker availability
      if (attackerState.status === 'destroyed' || attackerState.aliveCount <= 0) {
        phaseReports.push({
          task,
          phaseNumber: pNum,
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
          targetDamageSummary: 'Task Aborted: Attacking platform destroyed in an earlier phase.',
          battleLog: [
            {
              id: nextEvt(),
              timeFormatted: 'T+00m',
              title: 'Task Aborted',
              detail: `${attackerLabel} was destroyed in an earlier strike wave and cannot launch.`,
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
          phaseNumber: pNum,
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
          targetDamageSummary: 'Target already destroyed in a prior wave.',
          battleLog: [
            {
              id: nextEvt(),
              timeFormatted: 'T+00m',
              title: 'Target Already Neutralized',
              detail: `${phaseTargetLabel} was already destroyed in an earlier wave. Munitions conserved.`,
              badge: { text: 'Neutralized', variant: 'neutral' },
            },
          ],
        });
        continue;
      }

      // Check available magazine for attacker
      const curAttackerMag = attackerState.magazines.get(task.weaponIndex) ?? 24;
      const actualSalvo = Math.min(curAttackerMag, Math.max(1, task.salvoSize));

      // Deduct from attacker magazine
      attackerState.magazines.set(task.weaponIndex, Math.max(0, curAttackerMag - actualSalvo));

      const totalDistKm = distanceKm(attackerUnit.lngLat, targetUnit.lngLat);
      const isStandoff = (weapon.rangeKm ?? 0) > 0;
      const standoffDistKm = isStandoff ? Math.min(weapon.rangeKm, totalDistKm) : 0;
      const releaseDistKm = isStandoff ? Math.max(0, totalDistKm - standoffDistKm) : totalDistKm;
      const releaseLngLat =
        isStandoff && totalDistKm > 0 ? interpolate(attackerUnit.lngLat, targetUnit.lngLat, releaseDistKm / totalDistKm) : undefined;

      // Log Launch
      battleLog.push({
        id: nextEvt(),
        timeFormatted: 'T+00m',
        title: `Phase ${pNum}: ${task.title}`,
        detail: `${attackerLabel} launched salvo of ${actualSalvo} × ${weaponName} at ${phaseTargetLabel} (Remaining Magazine: ${attackerState.magazines.get(task.weaponIndex)}).`,
        badge: { text: `${actualSalvo} Committed`, variant: 'standoff' },
      });

      if (capFightersPinnedInThisPhase && task.category !== 'oca') {
        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+05m',
          title: 'Defending CAP Pinned by Friendly Sweeps',
          detail: `Simultaneous fighter sweep occupied defending CAP interceptors. Strike ingress proceeds without enemy aircraft interference.`,
          badge: { text: 'Air Cover Neutralized', variant: 'success' },
        });
      }

      // SAM and CAP Interception Walk along this phase corridor
      let munitionsSurviving = actualSalvo;
      let attackerLost = 0;
      let totalIntercepted = 0;
      const phaseInterceptions: PhaseInterceptionRecord[] = [];

      // Flight corridor geometry for this specific task
      const flightOrigin = releaseLngLat ?? attackerUnit.lngLat;
      const flightTarget = targetUnit.lngLat;
      const corridorDistKm = distanceKm(flightOrigin, flightTarget);

      // Find defenders covering this route
      const defenders = allUnits.filter((u) => u.iso === targetUnit.iso);

      type DefEngagementCandidate = {
        def: DeployedUnit;
        defState: UnitPersistentState;
        defSpec: SystemSpec;
        defWeapon: WeaponFacet;
        wIdx: number;
        entryKm: number;
        exitKm: number;
        entryFraction: number;
        interceptLngLat: [number, number];
      };

      const candidates: DefEngagementCandidate[] = [];

      for (const def of defenders) {
        const defState = unitStates.get(def.id);
        if (!defState || defState.status === 'destroyed' || defState.aliveCount <= 0) continue;

        const defSpec = specOf(def, ctx);
        if (!defSpec) continue;

        // If defending CAP was neutralized/pinned and this unit is a fighter, skip
        if (capFightersPinnedInThisPhase && (defSpec.typeId === 'fighter' || defSpec.typeId === 'interceptor')) {
          continue;
        }

        const defWeapons = defSpec.weapons ?? [];
        for (let wIdx = 0; wIdx < defWeapons.length; wIdx++) {
          const defWeapon = defWeapons[wIdx];
          if (!defWeapon.rangeKm || defWeapon.rangeKm <= 0) continue;
          if (defWeapon.engages && !defWeapon.engages.includes('air')) continue;

          // Check great-circle crossing of this defender's envelope along the flight path
          const cross = crossing(flightOrigin, flightTarget, def.lngLat, defWeapon.rangeKm, corridorDistKm);
          if (!cross) continue;

          const interceptKm = Math.max(0, Math.min(corridorDistKm, (cross.entryKm + cross.exitKm) / 2));
          const entryFraction = corridorDistKm > 0 ? interceptKm / corridorDistKm : 0.5;
          const interceptLngLat = interpolate(flightOrigin, flightTarget, entryFraction);

          candidates.push({
            def,
            defState,
            defSpec,
            defWeapon,
            wIdx,
            entryKm: cross.entryKm,
            exitKm: cross.exitKm,
            entryFraction,
            interceptLngLat,
          });
        }
      }

      // Sort candidate defense engagements by corridor entry distance (outer layer engages first)
      candidates.sort((a, b) => a.entryKm - b.entryKm);

      for (const cand of candidates) {
        if (munitionsSurviving <= 0) break;

        const { def, defState, defSpec, defWeapon, wIdx, entryFraction, interceptLngLat } = cand;
        const isSuppressed = defState.status === 'suppressed';

        // Check defender remaining magazine
        const readyRounds = defState.magazines.get(wIdx) ?? 0;
        if (readyRounds <= 0) {
          battleLog.push({
            id: nextEvt(),
            timeFormatted: 'T+12m',
            title: `${unitLabel(def, ctx.formations, ctx.systems)} Magazine Dry`,
            detail: `Defending battery in range, but ready magazine was depleted in prior waves (0 ready interceptors).`,
            badge: { text: 'Magazine Dry', variant: 'neutral' },
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
        const effectivePk = isSuppressed ? basePk * 0.65 : basePk;
        const targetsEngaged = Math.floor(roundsFired / (defWeapon.salvo ?? 2));
        const kills = Math.min(munitionsSurviving, Math.round(targetsEngaged * effectivePk));

        if (roundsFired > 0) {
          totalIntercepted += kills;
          munitionsSurviving = Math.max(0, munitionsSurviving - kills);

          const defLabel = unitLabel(def, ctx.formations, ctx.systems);
          phaseInterceptions.push({
            defenderUnitId: def.id,
            defenderLabel: defLabel,
            defenderLngLat: def.lngLat,
            interceptLngLat,
            entryFraction,
            roundsFired,
            kills,
          });
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
              title: `${defLabel} Salvo Missed`,
              detail: `${defLabel} fired ${roundsFired} × ${defWeapon.name ?? 'SAM'} interceptors, but high-velocity strike salvo penetrated without sustaining hits. 0 hits.`,
              badge: { text: 'Evaded / Missed', variant: 'success' },
            });
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
            ? 'Radar Emitters Destroyed — Battery completely offline for all subsequent waves.'
            : 'Battery SEAD Suppressed — Fire channels halved for subsequent waves.';

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
          capFightersPinnedInThisPhase = true;
          damageSummary = 'Enemy Fighter Flight Shot Down — Local air superiority achieved.';

          battleLog.push({
            id: nextEvt(),
            timeFormatted: 'T+25m',
            title: `Fighter Sweep Victory — ${phaseTargetLabel}`,
            detail: `${hits} missiles splashed defending aircraft. Combat air patrol neutralized.`,
            badge: { text: 'CAP Splashed', variant: 'success' },
          });
        } else {
          // Main Strike on Objective
          targetState.status = hits >= 3 ? 'destroyed' : 'damaged';
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
      const phaseColor = PHASE_COLORS[(pNum - 1) % PHASE_COLORS.length];
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
        phaseNumber: pNum,
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
        interceptions: phaseInterceptions,
      });
    }
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
