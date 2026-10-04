import { simNow, simRandom } from './warsim/context';
/**
 * Per-System Threat Level (DEFCON ROE) & Automated Intelligent Firing Solution Engine
 *
 * Simulates:
 * 1. Per-System Operational Threat Levels / ROE States:
 *    - DEFCON 3 (Level 1: Shadow & Radar Lock): Track and illuminate intruder on sovereign breach; hold fire unless intruder fires first.
 *    - DEFCON 2 (Level 2: Sovereign Defense): Immediate weapons-free engagement on any sovereign border incursion.
 *    - DEFCON 1 (Level 3: Total Offensive): Weapons-free offensive engagement anywhere across the map (neutral, enemy, international).
 * 2. Automated Hostile Trigger: Marks any entity that launches weapons or attacks friendlies as having fired hostile.
 * 3. Intelligent Coordinated Retaliation & Ammo Deconfliction:
 *    - Prioritizes Area SAMs first, then nearby CAP fighters with BVR missiles, avoiding duplicate missile expenditures.
 */

import { distanceKm } from './geo';
import {
  type SimEntity,
  type MissileFlyoutTrack,
  type WarSimSession,
  type SimBattleEvent,
  type SystemThreatLevel,
  type AirspaceLocation,
} from './warSimTypes';
import { type SystemSpec, type WeaponFacet, domainOf, defaultTerrainSensorFor } from './specs';
import { isGroundCombatUnit, isStaticAirDefense } from './warSimRules';
import { isNavalCombatant } from './navalEngagement';
import { canEngageUnderAirspaceRoe, resolveAirspaceLocation } from './airspaceSovereignty';
import { calculateTerrainLineOfSight } from './terrainLOS';

/* ------------------------------------------------------------------ */
/* 1. Threat Level Evaluation Logic                                   */
/* ------------------------------------------------------------------ */

export interface SystemRoeEvaluation {
  canFire: boolean;
  shouldLockOnly: boolean;
  reason: string;
}

/**
 * Evaluates whether a deployed defender entity is authorized to engage or lock onto a target
 * based on its assigned Threat Level (DEFCON ROE), target territory, and intruder hostility.
 */
export function canSystemEngageTarget(
  defender: SimEntity,
  target: SimEntity,
  targetAirspace: AirspaceLocation,
  session: WarSimSession
): SystemRoeEvaluation {
  const level: SystemThreatLevel = defender.threatLevel || 'defcon_2';
  const isFriendlyTerritory = targetAirspace.classification === 'friendly';
  const isNeutralTerritory = targetAirspace.classification === 'neutral';
  const hasIntruderFired = Boolean(target.hasFiredHostile);

  // LEVEL 1: DEFCON 3 (Shadow & Radar Lock / Warning)
  if (level === 'defcon_3') {
    if (isFriendlyTerritory) {
      if (hasIntruderFired) {
        return {
          canFire: true,
          shouldLockOnly: false,
          reason: `DEFCON 3: Intruder fired hostile weapons in sovereign territory — Automated Retaliation Authorized!`,
        };
      }
      return {
        canFire: false,
        shouldLockOnly: true,
        reason: `DEFCON 3: Radar locked on intruder in sovereign airspace — Holding fire pending hostile action.`,
      };
    }

    if (hasIntruderFired) {
      return {
        canFire: true,
        shouldLockOnly: false,
        reason: `DEFCON 3: Target has fired hostile weapons — Self-defense retaliation authorized.`,
      };
    }

    return {
      canFire: false,
      shouldLockOnly: false,
      reason: `DEFCON 3: Target in international/neutral territory — Passive tracking only.`,
    };
  }

  // LEVEL 2: DEFCON 2 (Sovereign Defense / Weapons Free on Border Breach)
  if (level === 'defcon_2') {
    if (isFriendlyTerritory) {
      return {
        canFire: true,
        shouldLockOnly: false,
        reason: `DEFCON 2: Sovereign Border Violation — Immediate Weapons Free Engagement!`,
      };
    }

    if (hasIntruderFired) {
      return {
        canFire: true,
        shouldLockOnly: false,
        reason: `DEFCON 2: Hostile intruder engaged friendlies — Retaliatory fire authorized.`,
      };
    }

    return {
      canFire: false,
      shouldLockOnly: false,
      reason: `DEFCON 2: Target is outside sovereign territory (${targetAirspace.countryName}) — Holding fire.`,
    };
  }

  // LEVEL 3: DEFCON 1 (Total War / Global Engagement)
  if (level === 'defcon_1') {
    return {
      canFire: true,
      shouldLockOnly: false,
      reason: `DEFCON 1: System authorization granted; theater ROE still applies.`,
    };
  }

  return { canFire: false, shouldLockOnly: false, reason: 'Hold Fire' };
}

/* ------------------------------------------------------------------ */
/* 2. Automated Intelligent Firing Solution & Deconfliction Engine     */
/* ------------------------------------------------------------------ */

export function stepThreatLevelEngagements(
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): {
  updatedEntities: SimEntity[];
  newMissiles: MissileFlyoutTrack[];
  engagementEvents: SimBattleEvent[];
} {
  const newMissiles: MissileFlyoutTrack[] = [];
  const engagementEvents: SimBattleEvent[] = [];
  const simTime = session.simTimeSec;

  // 1. Tag any entity that launched weapons in this session as hasFiredHostile
  const firingAttackerIds = new Set(session.activeMissiles.map((m) => m.attackerEntityId));

  let workingEntities = session.entities.map((e) => {
    if (firingAttackerIds.has(e.id) && !e.hasFiredHostile) {
      return { ...e, hasFiredHostile: true };
    }
    return e;
  });

  // Release a stale DEFCON 3 lock when the target, radar, or authority is gone.
  workingEntities = workingEntities.map((defender) => {
    if (!defender.isTargetLocked) return defender;
    const target = workingEntities.find((entity) => entity.id === defender.lockedTargetEntityId);
    const spec = systemsLibrary.find((item) => item.id === defender.systemId);
    const rangeKm = defender.isRadarJammed && defender.jammedDetectionRangeKm !== undefined
      ? defender.jammedDetectionRangeKm
      : spec?.sensor?.detectionKm ?? (isGroundCombatUnit(defender.typeId) ? 35 : 240);
    const opposingIso = defender.iso === session.playerIso ? session.enemyIso : session.playerIso;
    const stillAuthorized = target && target.iso === opposingIso
      && !['destroyed', 'docked', 'turnaround', 'in_repair'].includes(target.status)
      && defender.subsystems?.radar !== 'destroyed'
      && distanceKm(defender.lngLat, target.lngLat) <= rangeKm
      && canSystemEngageTarget(defender, target,
        resolveAirspaceLocation(target.lngLat, defender.iso, opposingIso), session).shouldLockOnly;
    return stillAuthorized ? defender : { ...defender, isTargetLocked: false, lockedTargetEntityId: undefined };
  });

  // 3. Track active intercepts to avoid spamming missiles on a single target
  const alreadyTargetedEntityIds = new Set(
    session.activeMissiles
      .filter((m) => !m.isIntercepted && m.progress < 0.90)
      .map((m) => m.targetEntityId)
  );

  // 4. Each faction defends its own territory using the same ROE and command path.
  for (const { defenderIso, opposingIso, faction } of [
    { defenderIso: session.playerIso, opposingIso: session.enemyIso, faction: 'player' as const },
    { defenderIso: session.enemyIso, opposingIso: session.playerIso, faction: 'enemy' as const },
  ]) {
  const deployedHostiles = workingEntities.filter((entity) => entity.iso === opposingIso
    && !['destroyed', 'docked', 'turnaround', 'in_repair'].includes(entity.status));
  for (const hostile of deployedHostiles) {
    const targetAirspace = resolveAirspaceLocation(hostile.lngLat, defenderIso, opposingIso);
    const hostileSpec = systemsLibrary.find((s) => s.id === hostile.systemId);
    const isHostileNaval = isNavalCombatant(hostile.typeId) || (hostileSpec ? domainOf(hostileSpec) === 'sea' : false);
    const isHostileAir = hostileSpec ? domainOf(hostileSpec) === 'air'
      : ['fighter', 'strike', 'bomber', 'uav', 'recon', 'awacs', 'tanker', 'helicopter', 'attack-heli', 'transport-heli'].includes(hostile.typeId);
    const targetClass: import('./specs').TargetClass = isHostileNaval ? 'surface' : isHostileAir ? 'air' : 'ground';

    // Check all friendly defenders in range
    const eligibleDefenders: {
      defender: SimEntity;
      spec?: SystemSpec;
      distKm: number;
      bestWeapon: WeaponFacet;
      bestWeaponIdx: number;
      priority: number; // 1 = Area SAM, 2 = CAP Fighter BVR, 3 = Point Defense
      roeEval: SystemRoeEvaluation;
    }[] = [];

    for (const friendly of workingEntities.filter((entity) => entity.iso === defenderIso
      && !['destroyed', 'docked', 'turnaround', 'in_repair'].includes(entity.status))) {
      if (friendly.subsystems?.radar === 'destroyed'
        || friendly.subsystems?.weapons === 'offline') continue;
      const friendlySpec = systemsLibrary.find((s) => s.id === friendly.systemId);
      const dist = distanceKm(friendly.lngLat, hostile.lngLat);

      // Radar sensor check
      let radarRangeKm = friendly.isRadarJammed && friendly.jammedDetectionRangeKm !== undefined
        ? friendly.jammedDetectionRangeKm
        : (friendlySpec?.sensor?.detectionKm ?? (isGroundCombatUnit(friendly.typeId) ? 35 : 240));

      if (dist > radarRangeKm) continue;

      // Topographic mountain masking check
      const scannerEquip = defaultTerrainSensorFor(friendlySpec, friendly.typeId);
      const los = calculateTerrainLineOfSight({
        scannerLngLat: friendly.lngLat,
        scannerAltitudeM: friendly.altitudeM || (friendlySpec?.sensor?.antennaM ?? 25),
        targetLngLat: hostile.lngLat,
        targetAltitudeM: hostile.altitudeM || (isHostileAir ? 7000 : 20),
        sensorEquipment: scannerEquip,
        isGroundTarget: targetClass === 'ground',
      });

      if (los.isMasked) continue;

      // Evaluate ROE Threat Level
      const roe = canSystemEngageTarget(friendly, hostile, targetAirspace, session);
      const theaterRoe = canEngageUnderAirspaceRoe(targetAirspace,
        session.airspaceRoeDoctrine ?? 'weapons_free', faction);

      // Update radar lock state if Level 1 lock-only
      if (roe.shouldLockOnly) {
        if (!friendly.isTargetLocked || friendly.lockedTargetEntityId !== hostile.id) {
          workingEntities = workingEntities.map((e) =>
            e.id === friendly.id ? { ...e, isTargetLocked: true, lockedTargetEntityId: hostile.id } : e
          );

          engagementEvents.push({
            id: `evt-lock-${simNow()}-${friendly.id.slice(-4)}-${hostile.id.slice(-4)}`,
            simTimeSec: simTime,
            timeFormatted: `${Math.floor(simTime / 60)}m`,
            faction,
            type: 'alert',
            title: `🎯 DEFCON 3 Radar Lock: ${friendly.name}`,
            detail: `${friendly.name} has illuminated and locked fire-control radar on ${hostile.name} inside sovereign airspace. Weapons on standby, holding fire pending hostile act.`,
            lngLat: friendly.lngLat,
          });
        }
      }

      if (!roe.canFire || !theaterRoe.canFire) continue;

      // Find best compatible weapon
      const weapons = (friendly.customWeapons && friendly.customWeapons.length > 0)
        ? friendly.customWeapons
        : (friendlySpec?.weapons || []);

      let bestW: WeaponFacet | null = null;
      let bestWIdx = -1;

      for (let wIdx = 0; wIdx < weapons.length; wIdx++) {
        const w = weapons[wIdx];
        const mag = friendly.magazines?.[wIdx] ?? w.magazine ?? 0;
        if (mag <= 0) continue;
        if (w.rangeKm < dist) continue;

        const canEngage = w.engages?.includes(targetClass) ?? false;
        if (canEngage) {
          if (!bestW || w.rangeKm > bestW.rangeKm) {
            bestW = w;
            bestWIdx = wIdx;
          }
        }
      }

      if (bestW && bestWIdx >= 0) {
        // Assign Priority Score:
        // 1 = Ground/Naval Area Air Defense SAM (Patriot, S-400, SM-6)
        // 2 = Airborne Fighter with BVR AAM (AIM-120D, Meteor)
        // 3 = Point-Defense / SHORAD
        let priority = 3;
        const isAreaSam = isStaticAirDefense(friendly.typeId) || bestW.rangeKm >= 75;
        const isFighter = friendly.typeId === 'fighter' || friendly.typeId === 'attack-heli';

        if (isAreaSam) {
          priority = 1;
        } else if (isFighter) {
          priority = 2;
        }

        eligibleDefenders.push({
          defender: friendly,
          spec: friendlySpec,
          distKm: dist,
          bestWeapon: bestW,
          bestWeaponIdx: bestWIdx,
          priority,
          roeEval: roe,
        });
      }
    }

    // 5. Intelligent Deconfliction: Pick ONLY the single best defender to engage
    if (eligibleDefenders.length > 0) {
      // If target is already under active missile intercept and has <= 1 threat level, don't double fire
      if (alreadyTargetedEntityIds.has(hostile.id)) {
        continue;
      }

      // Sort by priority (1 before 2 before 3), then by distance
      eligibleDefenders.sort((a, b) => a.priority - b.priority || a.distKm - b.distKm);
      const chosen = eligibleDefenders[0];

      const { defender, bestWeapon, bestWeaponIdx, distKm, roeEval } = chosen;
      const curMag = defender.magazines?.[bestWeaponIdx] ?? bestWeapon.magazine ?? 0;
      const salvoCommit = Math.min(curMag, bestWeapon.salvo ?? 1, 1);

      // Deduct magazine
      workingEntities = workingEntities.map((e) => {
        if (e.id !== defender.id) return e;
        const nextCustom = e.customWeapons ? [...e.customWeapons] : undefined;
        if (nextCustom && nextCustom[bestWeaponIdx]) {
          nextCustom[bestWeaponIdx] = {
            ...nextCustom[bestWeaponIdx],
            magazine: Math.max(0, curMag - salvoCommit),
          };
        }
        const nextMags: Record<number, number> = { ...(e.magazines || {}) };
        nextMags[bestWeaponIdx] = Math.max(0, curMag - salvoCommit);
        return {
          ...e,
          customWeapons: nextCustom,
          magazines: nextMags,
          isTargetLocked: false,
          lockedTargetEntityId: undefined,
        };
      });

      // Spawn Interceptor Flyout
      const flyoutSpeedKmh = Math.max(3200, (bestWeapon.speedMach ?? 3.5) * 1225);
      const tFlySec = Math.max(8, Math.round((distKm / flyoutSpeedKmh) * 3600));

      const missileCategory = isHostileAir ? 'sam' : isHostileNaval ? 'cruise' : 'bomb';

      const newMissile: MissileFlyoutTrack = {
        id: `msl-roe-${simNow()}-${simRandom('identifiers').toString(36).slice(2, 6)}`,
        originLngLat: defender.lngLat,
        targetLngLat: hostile.lngLat,
        currentLngLat: defender.lngLat,
        attackerEntityId: defender.id,
        targetEntityId: hostile.id,
        attackerIso: defender.iso,
        targetIso: hostile.iso,
        weaponName: bestWeapon.name || 'Guided Interceptor Missile',
        weaponCategory: missileCategory,
        speedKmh: flyoutSpeedKmh,
        startSimTimeSec: simTime,
        etaSimTimeSec: simTime + tFlySec,
        isIntercepted: false,
        progress: 0.0,
        interceptorPk: bestWeapon.pk ?? 0.85,
        threatSpeedMach: (hostile.speedKmh || 850) / 1225,
        threatRcsM2: hostile.rcs ?? 2.0,
        threatAltitudeM: hostile.altitudeM ?? (isHostileAir ? 7000 : 20),
      };

      newMissiles.push(newMissile);
      alreadyTargetedEntityIds.add(hostile.id);

      const levelLabel = (defender.threatLevel || 'defcon_2').toUpperCase().replace('_', ' ');

      engagementEvents.push({
        id: `evt-fire-roe-${simNow()}-${defender.id.slice(-4)}`,
        simTimeSec: simTime,
        timeFormatted: `${Math.floor(simTime / 60)}m`,
        faction,
        type: 'strike',
        title: `⚔️ Automated Engagement [${levelLabel}]: ${defender.name}`,
        detail: `${defender.name} committed ${bestWeapon.name || 'Interceptor'} against ${hostile.name} at ${distKm.toFixed(0)} km standoff. Firing Solution: ${roeEval.reason}. Deconfliction active.`,
        lngLat: defender.lngLat,
      });
    }
  }
  }

  return {
    updatedEntities: workingEntities,
    newMissiles,
    engagementEvents,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Helper Functions to Update Threat Levels                        */
/* ------------------------------------------------------------------ */

export function setSystemThreatLevel(
  session: WarSimSession,
  entityId: string,
  threatLevel: SystemThreatLevel
): WarSimSession {
  const updatedEntities = session.entities.map((e) => {
    if (e.id !== entityId) return e;
    return { ...e, threatLevel };
  });

  return {
    ...session,
    entities: updatedEntities,
  };
}

export function setGlobalThreatLevel(
  session: WarSimSession,
  factionIso: string,
  threatLevel: SystemThreatLevel,
  typeCategory?: 'all' | 'air' | 'sam' | 'naval' | 'ground'
): WarSimSession {
  const updatedEntities = session.entities.map((e) => {
    if (e.iso !== factionIso) return e;

    if (typeCategory === 'sam' && !isStaticAirDefense(e.typeId)) return e;
    if (typeCategory === 'air' && !(e.typeId === 'fighter' || e.typeId === 'bomber' || e.typeId === 'uav')) return e;
    if (typeCategory === 'naval' && !isNavalCombatant(e.typeId)) return e;
    if (typeCategory === 'ground' && !isGroundCombatUnit(e.typeId)) return e;

    return { ...e, threatLevel };
  });

  return {
    ...session,
    entities: updatedEntities,
  };
}
