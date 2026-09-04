/**
 * War Simulation Execution & Kinematics Engine
 *
 * Drives real-time base-anchored simulation updates:
 * 1. Time-step clock with adjustable acceleration (1x, 3x, 5x, 10x, 30x).
 * 2. Physical kinematics (Takeoff -> Ingress -> Loiter Orbit -> Bingo RTB -> Refuel).
 * 3. Base anchoring & quota-constrained deployments.
 * 4. In-flight missile flyouts and point-defense damage resolution.
 * 5. Dynamic sensor sweeps and fog-of-war contact tracking.
 */

import {
  distanceKm,
  destination,
  interpolate,
  bearingDeg,
} from './geo';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type BaseType,
  type DetectedContact,
  type MissileFlyoutTrack,
  type SimBattleEvent,
  type CombatReport,
  type PatrolOrder,
  type PostStrikeAction,
  type StrikePlan,
  type BattlefieldNetwork,
  type BattlefieldNetworkNode,
  type NetworkDoctrine,
  type SubsystemStatus,
  type BattleOpsPlan,
  type BattleOpsPhase,
  type BattleOpsTask,
  type StrikeSalvoTracker,
  type AirspaceRoeDoctrine,
  type BorderIncursionRecord,
  type AirspaceLocation,
  type SystemThreatLevel,
} from './warSimTypes';
import {
  canStationAtBase,
  defaultBaseCapacity,
  calculateFuelBurnPct,
  calculateBingoFuelThreshold,
  isGroundCombatUnit,
  isStaticAirDefense,
  canWeaponEngageTarget,
} from './warSimRules';
import { isNavalCombatant } from './navalEngagement';
import {
  type SystemSpec,
  type WeaponFacet,
  type DetectionRangeResult,
  domainOf,
  radarHorizonKm,
  defaultSonarFor,
  defaultTerrainSensorFor,
  defaultTerrainPlatformFor,
  signatureRangeMultiplier,
  calculateDetectionRange,
  getSystemRcs,
  RCS_BASELINE_M2,
} from './specs';
import {
  getTerrainElevationM,
  calculateTerrainLineOfSight,
  type TerrainLOSResult,
} from './terrainLOS';
import {
  initTankerState,
  evaluateEmergencyBingoRescue,
  stepAerialRefuelingTransfer,
  createAarCombatReport,
  findBestTankerForReceiver,
} from './aerialRefueling';
import {
  resolveAirspaceLocation,
  evaluateBorderIncursion,
  canEngageUnderAirspaceRoe,
  createAirspaceCombatReport,
} from './airspaceSovereignty';
import {
  createDefaultSatellites,
  stepSpaceLayer,
  orderAsatStrike,
  createSpaceCombatReport,
} from './spaceLayer';
import {
  stepElectronicWarfare,
  orderSeadAntiRadiationStrike,
  createEwCombatReport,
} from './electronicWarfare';
import {
  stepThreatLevelEngagements,
  setSystemThreatLevel,
  setGlobalThreatLevel,
} from './threatLevelEngagements';
import {
  syncMovingCarrierBases,
  applyCarrierAirWingLoadout,
  getCarrierStrikeGroupScreen,
  launchCarrierAirStrike,
  createCsgCombatReport,
  CARRIER_LOADOUT_PRESETS,
  isCarrierPlatform,
} from './carrierOps';

/* ------------------------------------------------------------------ */
/* 1. Time-Step Clock & Master Engine Loop                            */
/* ------------------------------------------------------------------ */

export function formatSimTime(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  return `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Dynamic P_k Modifier Pipeline & Missile Interception Math          */
/* ------------------------------------------------------------------ */

export interface PkModifierFactors {
  basePk: number;
  threatSpeedMach: number;
  threatRcsM2: number;
  threatAltitudeM: number;
  saturationPenalty?: number;
  seekerDegraded?: boolean;
}

export function resolveMunitionPhysicalProfile(
  weaponName: string,
  weaponCategory?: string,
  speedKmh?: number
): {
  speedMach: number;
  rcsM2: number;
  altitudeM: number;
} {
  const nameLower = weaponName.toLowerCase();
  const speed = speedKmh && speedKmh > 0 ? speedKmh : 900;
  const speedMach = speed / 1225;

  // Altitude Profile (Sea-skimming vs Standard)
  let altitudeM = 2000;
  const isSeaSkimmer =
    nameLower.includes('anti-ship') ||
    nameLower.includes('asm') ||
    nameLower.includes('ashm') ||
    nameLower.includes('harpoon') ||
    nameLower.includes('exocet') ||
    nameLower.includes('oniks') ||
    nameLower.includes('brahmos') ||
    nameLower.includes('nsm') ||
    nameLower.includes('lrasm') ||
    nameLower.includes('kalibr') ||
    nameLower.includes('tomahawk') ||
    nameLower.includes('c-802') ||
    nameLower.includes('yj-') ||
    nameLower.includes('zircon') ||
    nameLower.includes('neptune') ||
    weaponCategory === 'cruise';

  if (isSeaSkimmer) {
    altitudeM = 25; // Sea-skimming altitude (< 50m)
  }

  // RCS Profile (Very Low, Low, Standard)
  let rcsM2 = 1.0;
  const isVeryLowRcs =
    nameLower.includes('lrasm') ||
    nameLower.includes('jassm') ||
    nameLower.includes('storm shadow') ||
    nameLower.includes('scalp') ||
    nameLower.includes('nsm') ||
    nameLower.includes('som') ||
    nameLower.includes('stealth');

  const isLowRcs =
    nameLower.includes('harpoon') ||
    nameLower.includes('exocet') ||
    nameLower.includes('kalibr') ||
    nameLower.includes('tomahawk') ||
    nameLower.includes('shahed') ||
    nameLower.includes('uav') ||
    nameLower.includes('drone');

  if (isVeryLowRcs) {
    rcsM2 = 0.03; // Very Low RCS (< 0.05 m²)
  } else if (isLowRcs) {
    rcsM2 = 0.30; // Low RCS (0.05 - 1.0 m²)
  } else {
    rcsM2 = 1.5; // Standard Target (>= 1.0 m²)
  }

  return {
    speedMach,
    rcsM2,
    altitudeM,
  };
}

/**
 * Evaluates the Dynamic P_k Modifier Pipeline:
 * Formula: P_k_modified = P_k_base * SpeedMod * RCSMod * AltMod * SaturationPenalty
 */
export function calculateDynamicPk(factors: PkModifierFactors): {
  modifiedPk: number;
  speedMod: number;
  rcsMod: number;
  altMod: number;
  breakdown: string;
} {
  const {
    basePk,
    threatSpeedMach,
    threatRcsM2,
    threatAltitudeM,
    saturationPenalty = 1.0,
    seekerDegraded = false,
  } = factors;

  // 1. SpeedMod
  // - Subsonic (Mach < 0.9): 1.1x
  // - Supersonic (Mach 1.0 - 3.0): 1.0x
  // - High Supersonic (Mach 3.0 - 5.0): 0.7x
  // - Hypersonic (Mach 5.0+): 0.4x
  let speedMod = 1.0;
  if (threatSpeedMach < 0.9) {
    speedMod = 1.1;
  } else if (threatSpeedMach <= 3.0) {
    speedMod = 1.0;
  } else if (threatSpeedMach < 5.0) {
    speedMod = 0.7;
  } else {
    speedMod = 0.4;
  }

  // 2. RCSMod
  // - Very Low RCS Target (< 0.05 m², 6th Gen Jet / stealth missile): 0.50x
  // - Low RCS Target (0.05 - 1.0 m², Visby, Stealth UAV): 0.75x
  // - Standard Target (>= 1.0 m²): 1.0x
  let rcsMod = 1.0;
  if (threatRcsM2 < 0.05) {
    rcsMod = 0.50;
  } else if (threatRcsM2 < 1.0) {
    rcsMod = 0.75;
  } else {
    rcsMod = 1.0;
  }

  // 3. AltMod
  // - Sea-skimming Altitude (< 50m): 0.80x
  // - Standard Altitude (>= 50m): 1.0x
  let altMod = 1.0;
  if (threatAltitudeM > 0 && threatAltitudeM < 50) {
    altMod = 0.80;
  }

  let modifiedPk = basePk * speedMod * rcsMod * altMod * saturationPenalty;
  if (seekerDegraded) {
    modifiedPk *= 0.60;
  }

  modifiedPk = Math.max(0.05, Math.min(0.98, modifiedPk));

  const breakdown = `PkBase ${basePk.toFixed(2)} × Spd(${speedMod}x) × RCS(${rcsMod}x) × Alt(${altMod}x)${saturationPenalty < 1.0 ? ` × Sat(${saturationPenalty.toFixed(2)}x)` : ''} = ${modifiedPk.toFixed(2)}`;

  return {
    modifiedPk,
    speedMod,
    rcsMod,
    altMod,
    breakdown,
  };
}

/**
 * Evaluates Compound Probability Math:
 * Compound P_k = 1 - (1 - P_k_modified)^N
 */
export function calculateCompoundSalvoPk(modifiedSingleShotPk: number, salvoCommit: number): number {
  const count = Math.max(1, salvoCommit);
  return 1 - Math.pow(1 - modifiedSingleShotPk, count);
}

export function ensureDefaultNetworks(session: WarSimSession): BattlefieldNetwork[] {
  const networks: BattlefieldNetwork[] = session.networks ? [...session.networks] : [];

  if (!networks.some((n) => n.faction === 'player')) {
    networks.push({
      id: `net-player-${Date.now().toString(36)}`,
      name: `${session.playerIso} Theater Datalink Grid (CEC)`,
      faction: 'player',
      iso: session.playerIso,
      doctrine: 'layered_optimal',
      nodes: [],
      sharedContactIds: [],
      othTargetingEnabled: true,
    });
  }

  if (!networks.some((n) => n.faction === 'enemy')) {
    networks.push({
      id: `net-enemy-${Date.now().toString(36)}`,
      name: `${session.enemyIso} Integrated Air Defense Net`,
      faction: 'enemy',
      iso: session.enemyIso,
      doctrine: 'layered_optimal',
      nodes: [],
      sharedContactIds: [],
      othTargetingEnabled: true,
    });
  }

  return networks;
}

/**
 * An entity is considered deployed in the operational theater only if it is
 * active in the field (airborne, on patrol station, engaging, or in transit/RTB).
 * Units docked inside bases (hangars, drydocks, repair bays, turnaround) are NOT deployed
 * and cannot join active battlefield networks until scrambled/deployed.
 */
export function isEntityDeployed(e: SimEntity): boolean {
  return e.status !== 'docked' && e.status !== 'turnaround' && e.status !== 'in_repair' && e.status !== 'destroyed';
}

export function syncEntitiesWithNetworks(
  entities: SimEntity[],
  networks: BattlefieldNetwork[],
  playerIso: string,
  enemyIso: string,
  systemsLibrary: SystemSpec[] = []
): { updatedEntities: SimEntity[]; updatedNetworks: BattlefieldNetwork[] } {
  const playerNet = networks.find((n) => n.faction === 'player');
  const enemyNet = networks.find((n) => n.faction === 'enemy');

  const updatedEntities = entities.map((e) => {
    let netId = e.networkId;
    const isDeployed = isEntityDeployed(e);
    if (!netId && isDeployed) {
      netId = e.iso === playerIso ? playerNet?.id : enemyNet?.id;
    } else if (!isDeployed) {
      netId = undefined; // Stationed inside base: not part of active theater network
    }
    const defaultSubsystems: SubsystemStatus = {
      radar: 'operational',
      weapons: 'operational',
      propulsion: 'operational',
      hullIntegrityPct: e.damage === 'destroyed' ? 0 : e.damage === 'damaged' ? 50 : 100,
      flooding: 'none',
    };
    const subsystems: SubsystemStatus = e.subsystems ? { ...defaultSubsystems, ...e.subsystems } : defaultSubsystems;

    return {
      ...e,
      networkId: netId,
      subsystems,
    };
  });

  const updatedNetworks = networks.map((net) => {
    // ONLY deployed units in theater form active nodes in the network
    const netEntities = updatedEntities.filter((e) => e.networkId === net.id && isEntityDeployed(e));
    const nodes: BattlefieldNetworkNode[] = netEntities.map((e) => {
      const spec = systemsLibrary.find((s) => s.id === e.systemId);
      const isScout = e.typeId === 'uav' || e.typeId === 'awacs' || e.typeId === 'recon' || e.typeId === 'drone';
      const isAreaAD = e.typeId === 'sam-launcher' || e.typeId === 'destroyer' || e.typeId === 'frigate';
      const role: BattlefieldNetworkNode['role'] = isScout ? 'sensor' : isAreaAD ? 'coordinator' : 'shooter';
      const channelCapacity = spec?.sensor?.tracks ? Math.min(12, Math.max(4, Math.floor(spec.sensor.tracks / 10))) : 4;

      return {
        entityId: e.id,
        role,
        datalinkStatus: e.subsystems?.radar === 'destroyed' ? 'degraded' : 'active',
        channelCapacity,
        activeChannelsUsed: 0,
      };
    });

    return {
      ...net,
      nodes,
    };
  });

  return { updatedEntities, updatedNetworks };
}

export function getContactPID(
  entityId: string,
  observerFaction: 'player' | 'enemy',
  contacts: { playerContacts: DetectedContact[]; enemyContacts: DetectedContact[] }
): { isPID: boolean; knownName?: string; intelTier: number } {
  const contactList = observerFaction === 'player' ? contacts.playerContacts : contacts.enemyContacts;
  const c = contactList.find((item) => item.targetEntityId === entityId);
  return {
    isPID: c?.intelTier === 2,
    knownName: c?.knownName,
    intelTier: c?.intelTier ?? 0,
  };
}

export function tickWarSim(
  session: WarSimSession,
  dtRealSec: number,
  systemsLibrary: SystemSpec[]
): WarSimSession {
  if (session.status !== 'running') {
    return session;
  }

  // Calculate accelerated simulation time delta
  const dtSimSec = dtRealSec * (session.timeMultiplier || 3);
  const newSimTimeSec = session.simTimeSec + dtSimSec;
  const timeFormatted = formatSimTime(newSimTimeSec);

  const newEvents: SimBattleEvent[] = [...session.eventLog];
  const newReports: CombatReport[] = [...(session.reports || [])];

  const logEvent = (
    faction: 'player' | 'enemy' | 'neutral',
    type: SimBattleEvent['type'],
    title: string,
    detail: string,
    lngLat?: [number, number]
  ) => {
    newEvents.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: newSimTimeSec,
      timeFormatted,
      faction,
      type,
      title,
      detail,
      lngLat,
    });
  };

  const logReport = (report: Omit<CombatReport, 'id' | 'simTimeSec' | 'timeFormatted'>) => {
    newReports.push({
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      simTimeSec: newSimTimeSec,
      timeFormatted,
      ...report,
    });
  };

  // -------------------------------------------------------------
  // 1. Update Bases (Repairs & Status)
  // -------------------------------------------------------------
  const updatedBases: SimBase[] = session.bases.map((base) => {
    if (base.repairCountdownSec > 0) {
      const nextRepair = Math.max(0, base.repairCountdownSec - dtSimSec);
      const nextStatus = nextRepair === 0 ? 'operational' : base.runwayStatus;
      if (nextRepair === 0 && base.runwayStatus !== 'operational') {
        logEvent(
          base.iso === session.playerIso ? 'player' : 'enemy',
          'repair',
          `Base Repaired: ${base.name}`,
          `${base.name} runway and facilities restored to operational status.`,
          base.lngLat
        );
      }
      return {
        ...base,
        repairCountdownSec: nextRepair,
        runwayStatus: nextStatus,
      };
    }
    return base;
  });

  // -------------------------------------------------------------
  // 2. Identify Airborne Tanker Refueling Bubbles
  // -------------------------------------------------------------
  const playerTankers = session.entities.filter(
    (e) => e.iso === session.playerIso && e.status === 'on_station' && e.typeId === 'tanker'
  );
  const enemyTankers = session.entities.filter(
    (e) => e.iso === session.enemyIso && e.status === 'on_station' && e.typeId === 'tanker'
  );

  const hasTankerSupport = (entity: SimEntity): boolean => {
    const tankers = entity.iso === session.playerIso ? playerTankers : enemyTankers;
    return tankers.some((t) => distanceKm(entity.lngLat, t.lngLat) <= 250);
  };

  // -------------------------------------------------------------
  // 3. Update Entities (Kinematics, Orbit, Fuel, Lifecycle)
  // -------------------------------------------------------------
  const updatedEntities: SimEntity[] = session.entities.map((entity) => {
    if (entity.status === 'destroyed') return entity;

    const spec = systemsLibrary.find((s) => s.id === entity.systemId);
    const combatRadiusKm = spec?.platform?.combatRadiusKm ?? (entity.typeId === 'fighter' ? 900 : 1500);
    const speedKmh = entity.speedKmh > 0 ? entity.speedKmh : (spec?.platform?.speedKmh ?? 850);
    const homeBase = updatedBases.find((b) => b.id === entity.homeBaseId);
    let homeLngLat = homeBase?.lngLat;
    if (!homeLngLat) {
      const friendlyBases = updatedBases.filter((b) => b.iso === entity.iso);
      if (friendlyBases.length > 0) {
        let nearestDist = Infinity;
        let nearestCoord = friendlyBases[0].lngLat;
        for (const fb of friendlyBases) {
          const d = distanceKm(entity.lngLat, fb.lngLat);
          if (d < nearestDist) {
            nearestDist = d;
            nearestCoord = fb.lngLat;
          }
        }
        homeLngLat = nearestCoord;
      } else {
        homeLngLat = entity.lngLat;
      }
    }

    // Fuel multiplier (tanker support cuts burn rate in half)
    const fuelRateMult = hasTankerSupport(entity) ? 0.5 : 1.0;

    // A. Base Repairs Countdown
    if (entity.status === 'in_repair') {
      const nextTimer = Math.max(0, entity.repairTimerSec - dtSimSec);
      if (nextTimer === 0) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'repair',
          `Unit Repaired: ${entity.name}`,
          `${entity.name} repairs completed at home base. Ready for sortie.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'docked',
          damage: 'intact',
          repairTimerSec: 0,
          currentFuelPct: 100,
        };
      }
      return { ...entity, repairTimerSec: nextTimer };
    }

    // B. Base Turnaround / Refueling & Re-Arming Countdown
    if (entity.status === 'turnaround') {
      const nextTimer = Math.max(0, entity.turnaroundTimerSec - dtSimSec);
      if (nextTimer === 0) {
        const spec = systemsLibrary.find((s) => s.id === entity.systemId);
        const restoredWeapons = entity.customWeapons && entity.customWeapons.length > 0
          ? entity.customWeapons.map((w, idx) => {
              const specMag = spec?.weapons?.[idx]?.magazine ?? w.magazine ?? 2;
              return { ...w, magazine: specMag };
            })
          : (spec?.weapons ? spec.weapons.map((w) => ({ ...w })) : []);

        // If the platform was on an active patrol mission before bingo RTB, automatically resume patrol!
        if (entity.patrolOrder) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'rtb',
            `Patrol Resumed: ${entity.name}`,
            `${entity.name} completed refueling and re-arming at ${homeBase?.name ?? 'Base'}. Scrambling back to resume assigned patrol route.`,
            homeLngLat
          );

          return {
            ...entity,
            status: 'takeoff_ingress',
            turnaroundTimerSec: 0,
            currentFuelPct: 100,
            customWeapons: restoredWeapons,
            altitudeM: entity.patrolOrder.altitudeM || (isGroundCombatUnit(entity.typeId) ? 0 : 7000),
          };
        }

        return {
          ...entity,
          status: 'docked',
          turnaroundTimerSec: 0,
          currentFuelPct: 100,
          customWeapons: restoredWeapons,
        };
      }
      return { ...entity, turnaroundTimerSec: nextTimer };
    }

    // C. Stationary / Docked at Base
    if (entity.status === 'docked') {
      return { ...entity, lngLat: homeLngLat };
    }

    // D. Takeoff Ingress towards Patrol Center
    if (entity.status === 'takeoff_ingress' && entity.patrolOrder) {
      const targetPos = entity.patrolOrder.centerLngLat;
      const distToTarget = distanceKm(entity.lngLat, targetPos);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      // Fuel burn during ingress
      const fuelBurn = calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel threshold
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        const rescue = evaluateEmergencyBingoRescue(session, entity, homeLngLat, systemsLibrary);
        if (rescue.shouldDivertToTanker && rescue.tanker) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'aar_refuel',
            `🚨 Emergency AAR Divert: ${entity.name}`,
            `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Diverting to friendly tanker ${rescue.tanker.name} (${rescue.distanceToTankerKm.toFixed(0)} km).`,
            entity.lngLat
          );
          return {
            ...entity,
            status: 'aar_rendezvous',
            currentFuelPct: nextFuel,
            refuelingState: {
              tankerEntityId: rescue.tanker.id,
              stage: 'rendezvous',
              targetFuelPct: 100,
              flowRateKgPerSec: 35,
              fuelReceivedKg: 0,
              preRefuelStatus: 'takeoff_ingress',
              preRefuelPatrolOrder: entity.patrolOrder,
              wasBingoRescue: true,
              durationSec: 0,
            },
          };
        }

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Bingo Fuel Triggered: ${entity.name}`,
          `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Returning to Base.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
        };
      }

      const isGround = isGroundCombatUnit(entity.typeId);
      const effectiveAlt = isGround ? 0 : entity.altitudeM;

      if (distToTarget <= Math.max(isGround ? 4 : 8, stepDistanceKm)) {
        // Arrived at destination / station
        const isTankerUnit = entity.typeId === 'tanker' || entity.name.toLowerCase().includes('tanker');
        const initialTankerState = isTankerUnit ? (entity.tankerState || initTankerState(entity, spec)) : undefined;

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'rtb',
          isGround ? `Unit In Position: ${entity.name}` : isTankerUnit ? `⛽ AAR Anchor Established: ${entity.name}` : `On Station: ${entity.name}`,
          isGround
            ? `${entity.name} arrived at destination coordinates and assumed defensive posture.`
            : isTankerUnit
              ? `${entity.name} established Aerial Refueling Anchor Track (${initialTankerState?.offloadRemainingKg.toLocaleString() || 40000} kg transfer fuel available).`
              : `${entity.name} established patrol orbit at designated coordinates.`,
          targetPos
        );
        return {
          ...entity,
          lngLat: targetPos,
          status: 'on_station',
          altitudeM: effectiveAlt,
          currentFuelPct: nextFuel,
          tankerState: initialTankerState,
        };
      }

      // Move along great circle
      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToTarget));
      const nextLngLat = interpolate(entity.lngLat, targetPos, fraction);
      const nextHeading = bearingDeg(entity.lngLat, targetPos);

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        altitudeM: effectiveAlt,
        currentFuelPct: nextFuel,
      };
    }

    // E. On Station / Holding Position / Multi-Waypoint Route Patrol / Tanker Orbit
    if (entity.status === 'on_station' && entity.patrolOrder) {
      const isGround = isGroundCombatUnit(entity.typeId);
      const isStaticAD = isStaticAirDefense(entity.typeId);
      const { centerLngLat, patrolRadiusKm, orbitAngleDeg, routeType, waypoints } = entity.patrolOrder;

      // Ensure tankerState is present if platform is a tanker
      const isTanker = entity.typeId === 'tanker' || entity.name.toLowerCase().includes('tanker');
      const activeTankerState = isTanker ? (entity.tankerState || initTankerState(entity, spec)) : undefined;

      if (isTanker && activeTankerState && activeTankerState.offloadRemainingKg <= 0) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `⚠️ Tanker Fuel Winchester: ${entity.name}`,
          `${entity.name} transfer fuel reservoir is depleted. Returning to base.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          tankerState: activeTankerState,
        };
      }

      // Ground formations & static batteries stay stationary at designated ground position
      if (isGround || isStaticAD) {
        return {
          ...entity,
          lngLat: centerLngLat,
          altitudeM: 0,
        };
      }

      // E.1. Custom Multi-Waypoint Route Navigation (WP1 -> WP2 -> WP3 ... -> WPN -> in reverse)
      if (routeType === 'waypoints' && waypoints && waypoints.length >= 2) {
        const currentIdx = Math.max(0, Math.min(waypoints.length - 1, entity.patrolOrder.currentWaypointIdx ?? 1));
        const direction = entity.patrolOrder.patrolDirection ?? 1;
        const targetWp = waypoints[currentIdx] || waypoints[0];

        const distToWp = distanceKm(entity.lngLat, targetWp);
        const stepDistKm = (speedKmh / 3600) * dtSimSec;

        // Route flight fuel consumption
        const fuelBurn = calculateFuelBurnPct(stepDistKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
        const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

        // Check Bingo Fuel
        const distToBase = distanceKm(entity.lngLat, homeLngLat);
        const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

        if (nextFuel <= bingoThreshold) {
          const rescue = evaluateEmergencyBingoRescue(session, entity, homeLngLat, systemsLibrary);
          if (rescue.shouldDivertToTanker && rescue.tanker) {
            logEvent(
              entity.iso === session.playerIso ? 'player' : 'enemy',
              'aar_refuel',
              `🚨 Emergency AAR Divert: ${entity.name}`,
              `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Diverting to tanker ${rescue.tanker.name} (${rescue.distanceToTankerKm.toFixed(0)} km).`,
              entity.lngLat
            );
            return {
              ...entity,
              status: 'aar_rendezvous',
              currentFuelPct: nextFuel,
              refuelingState: {
                tankerEntityId: rescue.tanker.id,
                stage: 'rendezvous',
                targetFuelPct: 100,
                flowRateKgPerSec: 35,
                fuelReceivedKg: 0,
                preRefuelStatus: 'on_station',
                preRefuelPatrolOrder: entity.patrolOrder,
                wasBingoRescue: true,
                durationSec: 0,
              },
            };
          }

          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `Bingo Fuel: ${entity.name}`,
            `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Aborting route for RTB.`,
            entity.lngLat
          );
          return {
            ...entity,
            status: 'bingo_rtb',
            currentFuelPct: nextFuel,
          };
        }

        // Check if reached current waypoint
        if (distToWp <= Math.max(4, stepDistKm)) {
          let nextIdx = currentIdx + direction;
          let nextDirection: 1 | -1 = direction;

          if (nextIdx >= waypoints.length) {
            // Reached final waypoint -> reverse direction
            nextDirection = -1;
            nextIdx = Math.max(0, waypoints.length - 2);
          } else if (nextIdx < 0) {
            // Reached start waypoint -> forward direction
            nextDirection = 1;
            nextIdx = Math.min(waypoints.length - 1, 1);
          }

          const nextTargetWp = waypoints[nextIdx] || targetWp;
          const nextHeading = bearingDeg(targetWp, nextTargetWp);

          return {
            ...entity,
            lngLat: targetWp,
            headingDeg: nextHeading,
            currentFuelPct: nextFuel,
            tankerState: activeTankerState,
            patrolOrder: {
              ...entity.patrolOrder,
              currentWaypointIdx: nextIdx,
              patrolDirection: nextDirection,
            },
          };
        }

        // Interpolate position towards target waypoint
        const fraction = Math.min(1, stepDistKm / Math.max(1, distToWp));
        const nextLngLat = interpolate(entity.lngLat, targetWp, fraction);
        const nextHeading = bearingDeg(entity.lngLat, targetWp);

        return {
          ...entity,
          lngLat: nextLngLat,
          headingDeg: nextHeading,
          currentFuelPct: nextFuel,
          tankerState: activeTankerState,
          patrolOrder: {
            ...entity.patrolOrder,
            currentWaypointIdx: currentIdx,
            patrolDirection: direction,
          },
        };
      }

      // E.2. Circular Orbit Loiter
      if (patrolRadiusKm <= 0) {
        return {
          ...entity,
          lngLat: centerLngLat,
          tankerState: activeTankerState,
        };
      }
      
      // Calculate angular step around orbit for aircraft / surface ships
      const circumferenceKm = 2 * Math.PI * Math.max(5, patrolRadiusKm);
      const stepDistKm = (speedKmh / 3600) * dtSimSec;
      const angleStepDeg = (stepDistKm / circumferenceKm) * 360;
      const nextAngle = (orbitAngleDeg + angleStepDeg) % 360;

      // Position along orbit circle
      const nextLngLat = destination(centerLngLat, patrolRadiusKm, nextAngle);
      const nextHeading = (nextAngle + 90) % 360;

      // Loiter fuel consumption
      const fuelBurn = calculateFuelBurnPct(0, combatRadiusKm, dtSimSec, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel
      const distToBase = distanceKm(nextLngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        const rescue = evaluateEmergencyBingoRescue(session, entity, homeLngLat, systemsLibrary);
        if (rescue.shouldDivertToTanker && rescue.tanker) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'aar_refuel',
            `🚨 Emergency AAR Divert: ${entity.name}`,
            `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Diverting to tanker ${rescue.tanker.name} (${rescue.distanceToTankerKm.toFixed(0)} km).`,
            nextLngLat
          );
          return {
            ...entity,
            lngLat: nextLngLat,
            status: 'aar_rendezvous',
            currentFuelPct: nextFuel,
            refuelingState: {
              tankerEntityId: rescue.tanker.id,
              stage: 'rendezvous',
              targetFuelPct: 100,
              flowRateKgPerSec: 35,
              fuelReceivedKg: 0,
              preRefuelStatus: 'on_station',
              preRefuelPatrolOrder: entity.patrolOrder,
              wasBingoRescue: true,
              durationSec: 0,
            },
          };
        }

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Bingo Fuel: ${entity.name}`,
          `${entity.name} fuel low (${nextFuel.toFixed(1)}%). Aborting station for RTB.`,
          nextLngLat
        );
        return {
          ...entity,
          lngLat: nextLngLat,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
        };
      }

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
        tankerState: activeTankerState,
        patrolOrder: {
          ...entity.patrolOrder,
          orbitAngleDeg: nextAngle,
        },
      };
    }

    // F. Return to Base (RTB - Bingo or Damaged)
    if (entity.status === 'bingo_rtb' || entity.status === 'damaged_rtb') {
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      if (distToBase <= Math.max(8, stepDistanceKm)) {
        // Landed at home base
        const isDamaged = entity.status === 'damaged_rtb';
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'rtb',
          `Unit Landed: ${entity.name}`,
          `${entity.name} touched down at ${homeBase?.name ?? 'Base'} for ${isDamaged ? 'repairs' : 'refueling & re-arming'}.`,
          homeLngLat
        );

        // Replenish ready magazines & fuel for equipped loadout on return to base
        const replenishedWeapons = entity.customWeapons && entity.customWeapons.length > 0
          ? entity.customWeapons.map((w, idx) => {
              const specMag = spec?.weapons?.[idx]?.magazine ?? w.magazine ?? 2;
              return { ...w, magazine: specMag };
            })
          : (spec?.weapons ? spec.weapons.map((w) => ({ ...w })) : []);

        const isTankerUnit = entity.typeId === 'tanker' || entity.name.toLowerCase().includes('tanker');
        const restoredTankerState = isTankerUnit ? initTankerState(entity, spec) : undefined;

        return {
          ...entity,
          lngLat: homeLngLat,
          currentFuelPct: 100,
          customWeapons: replenishedWeapons,
          tankerState: restoredTankerState,
          status: isDamaged ? 'in_repair' : 'turnaround',
          repairTimerSec: isDamaged ? 45 * 60 : 0, // 45 min repairs
          turnaroundTimerSec: isDamaged ? 0 : 15 * 60, // 15 min turnaround
        };
      }

      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToBase));
      const nextLngLat = interpolate(entity.lngLat, homeLngLat, fraction);
      const nextHeading = bearingDeg(entity.lngLat, homeLngLat);
      const nextFuel = Math.max(0, entity.currentFuelPct - (calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult));

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
      };
    }

    // F.2. In-Flight Aerial Refueling Rendezvous ('aar_rendezvous')
    if (entity.status === 'aar_rendezvous' && entity.refuelingState) {
      const tanker = session.entities.find((e) => e.id === entity.refuelingState?.tankerEntityId);
      if (!tanker || tanker.status === 'destroyed' || tanker.status === 'docked' || (tanker.tankerState?.offloadRemainingKg ?? 0) <= 0) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `AAR Aborted: ${entity.name}`,
          `Target tanker unavailable or depleted. ${entity.name} returning to base.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          refuelingState: undefined,
        };
      }

      const distToTanker = distanceKm(entity.lngLat, tanker.lngLat);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      // Fuel burn during rendezvous flight
      const fuelBurn = calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      if (distToTanker <= Math.max(6, stepDistanceKm)) {
        // Docked & Hooked up to Tanker Boom/Drogue!
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'aar_refuel',
          `⛽ AAR Contact / Hook-Up: ${entity.name}`,
          `${entity.name} made contact with ${tanker.name} at ${tanker.altitudeM || 7500}m altitude. Commencing fuel transfer.`,
          tanker.lngLat
        );

        return {
          ...entity,
          lngLat: tanker.lngLat,
          altitudeM: tanker.altitudeM || 7500,
          headingDeg: tanker.headingDeg,
          status: 'aar_refueling',
          currentFuelPct: nextFuel,
          refuelingState: {
            ...entity.refuelingState,
            stage: 'hooked',
          },
        };
      }

      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToTanker));
      const nextLngLat = interpolate(entity.lngLat, tanker.lngLat, fraction);
      const nextHeading = bearingDeg(entity.lngLat, tanker.lngLat);

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
      };
    }

    // F.3. Active Fuel Transfer on Tanker Boom/Drogue ('aar_refueling')
    if (entity.status === 'aar_refueling' && entity.refuelingState) {
      const tanker = session.entities.find((e) => e.id === entity.refuelingState?.tankerEntityId);
      if (!tanker || tanker.status === 'destroyed' || (tanker.tankerState?.offloadRemainingKg ?? 0) <= 0) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `AAR Disconnect: ${entity.name}`,
          `Tanker disconnected. ${entity.name} resuming mission.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: entity.refuelingState.preRefuelStatus || 'on_station',
          refuelingState: undefined,
        };
      }

      // Step physical fuel transfer
      const transferRes = stepAerialRefuelingTransfer(entity, tanker, dtSimSec, systemsLibrary);

      // Keep positions locked to tanker
      const updatedRec = {
        ...transferRes.updatedReceiver,
        lngLat: tanker.lngLat,
        headingDeg: tanker.headingDeg,
        altitudeM: tanker.altitudeM || 7500,
      };

      if (transferRes.isComplete) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'aar_refuel',
          `✓ Refueling Complete: ${entity.name}`,
          `${entity.name} finished fuel transfer from ${tanker.name} (${transferRes.fuelTransferredKg.toFixed(0)} kg offloaded). Fuel restored to ${updatedRec.currentFuelPct.toFixed(0)}%. Resuming mission.`,
          tanker.lngLat
        );

        // Generate Combat Report for logistics / AAR tracking
        const aarRpt = createAarCombatReport(
          session,
          tanker,
          updatedRec,
          updatedRec.refuelingState?.fuelReceivedKg || transferRes.fuelTransferredKg,
          updatedRec.refuelingState?.durationSec || 60,
          updatedRec.refuelingState?.wasBingoRescue || false,
          entity.currentFuelPct,
          updatedRec.currentFuelPct,
          systemsLibrary
        );
        session.reports = session.reports || [];
        session.reports.unshift(aarRpt);
      }

      return updatedRec;
    }

    // G. Strike Ingress & Weapon Release ('engaging')
    if (entity.status === 'engaging' && entity.strikePlan) {
      const plan = entity.strikePlan;
      const targetEntity = session.entities.find((e) => e.id === plan.targetEntityId);
      const targetPos: [number, number] = targetEntity && targetEntity.status !== 'destroyed'
        ? targetEntity.lngLat
        : plan.targetLngLat;

      const distToTarget = distanceKm(entity.lngLat, targetPos);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      // Fuel consumption during strike ingress
      const fuelBurn = calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel threshold
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        const rescue = evaluateEmergencyBingoRescue(session, entity, homeLngLat, systemsLibrary);
        if (rescue.shouldDivertToTanker && rescue.tanker) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'aar_refuel',
            `🚨 Strike AAR Divert: ${entity.name}`,
            `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Diverting to tanker ${rescue.tanker.name} (${rescue.distanceToTankerKm.toFixed(0)} km).`,
            entity.lngLat
          );
          return {
            ...entity,
            status: 'aar_rendezvous',
            currentFuelPct: nextFuel,
            refuelingState: {
              tankerEntityId: rescue.tanker.id,
              stage: 'rendezvous',
              targetFuelPct: 100,
              flowRateKgPerSec: 35,
              fuelReceivedKg: 0,
              preRefuelStatus: 'engaging',
              preRefuelStrikePlan: entity.strikePlan,
              wasBingoRescue: true,
              durationSec: 0,
            },
          };
        }

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Strike Aborted: ${entity.name}`,
          `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Aborting strike mission for RTB.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
          strikePlan: undefined,
        };
      }

      // Check if custom attack waypoints exist and are pending navigation
      const hasAttackWaypoints = plan.attackWaypoints && plan.attackWaypoints.length > 0;
      const wpIdx = plan.currentWaypointIdx ?? 0;
      const areWaypointsPending = hasAttackWaypoints && wpIdx < plan.attackWaypoints!.length;

      if (areWaypointsPending) {
        const nextWp = plan.attackWaypoints![wpIdx];
        const distToWp = distanceKm(entity.lngLat, nextWp);

        if (distToWp <= Math.max(6, stepDistanceKm)) {
          // Arrived at current attack waypoint! Advance to next waypoint index
          const nextWpIdx = wpIdx + 1;
          const updatedPlan: StrikePlan = {
            ...plan,
            currentWaypointIdx: nextWpIdx,
          };

          return {
            ...entity,
            lngLat: nextWp,
            currentFuelPct: nextFuel,
            strikePlan: updatedPlan,
          };
        }

        // Steer along custom ingress corridor towards current waypoint
        const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToWp));
        const nextLngLat = interpolate(entity.lngLat, nextWp, fraction);
        const nextHeading = bearingDeg(entity.lngLat, nextWp);

        return {
          ...entity,
          lngLat: nextLngLat,
          headingDeg: nextHeading,
          currentFuelPct: nextFuel,
        };
      }

      // All waypoints completed (or direct ingress): Check if within weapon release stand-off envelope
      const effectiveReleaseRange = Math.max(5, plan.weaponRangeKm);
      if (distToTarget <= effectiveReleaseRange) {
        // --- WEAPON RELEASE POINT REACHED ---
        const currentWeapons = (entity.customWeapons && entity.customWeapons.length > 0)
          ? entity.customWeapons
          : (spec?.weapons || []);

        const itemsToFire: import('./warSimTypes').WeaponSalvoItem[] =
          plan.weaponsToFire && plan.weaponsToFire.length > 0
            ? plan.weaponsToFire
            : [
                {
                  weaponIndex: plan.weaponIndex,
                  weaponName: plan.weaponName || 'Ordnance',
                  weaponRangeKm: plan.weaponRangeKm || 100,
                  salvoCount: Math.max(1, plan.salvoCount || 1),
                },
              ];

        let updatedCustomWeapons = [...currentWeapons];
        let globalSalvoOffset = 0;
        const firedSummaries: string[] = [];

        for (const item of itemsToFire) {
          const wIdx = item.weaponIndex;
          const w = updatedCustomWeapons[wIdx] || updatedCustomWeapons[0];
          const wName = w?.name || item.weaponName || 'Ordnance';
          const missileSpeed = w?.speedMach ? w.speedMach * 1225 : ((w?.rangeKm ?? 100) > 100 ? 3200 : 1800);
          const missileCategory: any = w?.engages?.includes('air')
            ? 'air_to_air'
            : w?.engages?.includes('subsurface')
              ? 'torpedo'
              : 'cruise';

          const salvoCount = Math.max(1, item.salvoCount || 1);
          const curMagPerUnit = w?.magazine ?? 1;
          const totalRoundsBefore = entity.count * curMagPerUnit;
          const totalRoundsAfter = Math.max(0, totalRoundsBefore - salvoCount);
          const updatedMagazinePerUnit = Math.floor(totalRoundsAfter / entity.count);

          updatedCustomWeapons = updatedCustomWeapons.map((cw, idx) => {
            if (idx !== wIdx) return cw;
            return {
              ...cw,
              magazine: updatedMagazinePerUnit,
            };
          });

          const salvoId = `salvo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          // Spawn salvoCount missiles in activeMissiles with sequential ripple launch times
          for (let s = 0; s < salvoCount; s++) {
            const launchStaggerSec = globalSalvoOffset * 1.2;
            globalSalvoOffset++;

            const munitionProfile = resolveMunitionPhysicalProfile(wName, missileCategory, missileSpeed);
            const newMissile: MissileFlyoutTrack = {
              id: `msl-${Date.now()}-${wIdx}-${s}-${Math.random().toString(36).slice(2, 6)}`,
              originLngLat: entity.lngLat,
              targetLngLat: targetPos,
              currentLngLat: entity.lngLat,
              attackerEntityId: entity.id,
              targetEntityId: plan.targetEntityId,
              attackerIso: entity.iso,
              targetIso: targetEntity?.iso ?? (entity.iso === session.playerIso ? session.enemyIso : session.playerIso),
              weaponName: wName,
              weaponCategory: missileCategory,
              speedKmh: missileSpeed,
              startSimTimeSec: session.simTimeSec + launchStaggerSec,
              etaSimTimeSec: session.simTimeSec + Math.max(8, Math.round((distToTarget / missileSpeed) * 3600)) + launchStaggerSec,
              isIntercepted: false,
              progress: 0,
              salvoId,
              threatAltitudeM: munitionProfile.altitudeM,
              threatRcsM2: munitionProfile.rcsM2,
              threatSpeedMach: munitionProfile.speedMach,
            };
            session.activeMissiles.push(newMissile);
          }

          firedSummaries.push(`${salvoCount} × ${wName}`);
        }

        const isAttackerPlayer = entity.iso === session.playerIso;
        const attackerFaction: 'player' | 'enemy' = isAttackerPlayer ? 'player' : 'enemy';
        const targetPID = getContactPID(plan.targetEntityId, attackerFaction, session.fogOfWarContacts);
        const targetSpec = targetEntity ? systemsLibrary.find((s) => s.id === targetEntity.systemId) : undefined;
        const targetDomain = targetSpec ? domainOf(targetSpec) : 'ground';
        const targetDisplayName = targetPID.isPID
          ? (targetEntity?.name ?? 'Hostile Entity')
          : `Hostile ${targetDomain.toUpperCase()} Track (Tier 1 Sensor Track)`;

        const totalSalvoSize = itemsToFire.reduce((sum, it) => sum + (it.salvoCount || 1), 0);
        const activeSalvoId = session.activeMissiles[session.activeMissiles.length - 1]?.salvoId ?? `salvo-${Date.now()}`;

        // Register Salvo in Tracker to consolidate into a single comprehensive After-Action Report
        session.salvoTrackers = session.salvoTrackers || [];
        session.salvoTrackers.push({
          salvoId: activeSalvoId,
          attackerEntityId: entity.id,
          attackerName: entity.name,
          attackerIso: entity.iso,
          targetEntityId: plan.targetEntityId,
          targetName: targetDisplayName,
          targetIso: targetEntity?.iso ?? (isAttackerPlayer ? session.enemyIso : session.playerIso),
          weaponNames: firedSummaries,
          totalLaunched: totalSalvoSize,
          interceptedBySam: 0,
          interceptedByCiws: 0,
          directHits: 0,
          defendingSamSystems: [],
          defendingCiwsSystems: [],
          startSimTimeSec: session.simTimeSec,
          targetInitialDamage: targetEntity?.damage ?? 'intact',
          standoffDistanceKm: distToTarget,
          weaponSpeedMach: spec?.weapons?.[plan.weaponIndex]?.speedMach,
          weaponRangeKm: plan.weaponRangeKm,
          targetLngLat: targetPos,
          attackerLngLat: entity.lngLat,
          isConcluded: false,
        });

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'strike',
          `🚀 Ordnance Released: ${entity.name}`,
          `${entity.name} launched mixed salvo (${firedSummaries.join(' + ')}) against target at ${distToTarget.toFixed(0)} km stand-off range. Executing ${plan.postStrikeAction.toUpperCase()} protocol.`,
          entity.lngLat
        );

        // Execute User-Selected Post-Strike Protocol
        if (plan.postStrikeAction === 'rtb') {
          return {
            ...entity,
            status: 'bingo_rtb',
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'return_to_patrol' && plan.returnPatrolOrder) {
          return {
            ...entity,
            status: 'takeoff_ingress',
            patrolOrder: plan.returnPatrolOrder,
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'loiter_target') {
          return {
            ...entity,
            status: 'on_station',
            patrolOrder: {
              centerLngLat: targetPos,
              patrolRadiusKm: 20,
              altitudeM: entity.altitudeM || 7000,
              orbitAngleDeg: 0,
              emcon: 'active',
            },
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'designated_waypoint' && plan.customPostLngLat) {
          return {
            ...entity,
            status: 'takeoff_ingress',
            patrolOrder: {
              centerLngLat: plan.customPostLngLat,
              patrolRadiusKm: 15,
              altitudeM: entity.altitudeM || 7000,
              orbitAngleDeg: 0,
              emcon: 'active',
            },
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        }

        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
          customWeapons: updatedCustomWeapons,
          strikePlan: undefined,
        };
      }

      // Ingress: move towards target
      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToTarget));
      const nextLngLat = interpolate(entity.lngLat, targetPos, fraction);
      const nextHeading = bearingDeg(entity.lngLat, targetPos);

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
      };
    }

    return entity;
  });

  // Track Real-Time Airspace Sovereignty & National Border Incursions
  const updatedBorderIncursions = [...(session.borderIncursions || [])];
  const finalEntitiesWithAirspace = updatedEntities.map((entity) => {
    if (entity.status === 'destroyed' || entity.status === 'docked') {
      return entity;
    }

    const currentLoc = resolveAirspaceLocation(entity.lngLat, session.playerIso, session.enemyIso);
    const incursion = evaluateBorderIncursion(entity, currentLoc, entity.currentAirspace);

    if (incursion) {
      incursion.simTimeSec = session.simTimeSec;
      updatedBorderIncursions.push(incursion);

      const isPlayerFaction = entity.iso === session.playerIso;
      const title =
        incursion.incursionType === 'hostile_breach'
          ? `🚨 Sovereign Airspace Incursion: ${entity.name}`
          : incursion.incursionType === 'neutral_violation'
            ? `⚠️ Neutral Airspace Intrusion: ${entity.name}`
            : `ℹ️ International Airspace: ${entity.name}`;

      const detail =
        incursion.incursionType === 'hostile_breach'
          ? `${entity.name} crossed the international border from ${incursion.fromName} into ${incursion.toName} sovereign airspace!`
          : incursion.incursionType === 'neutral_violation'
            ? `${entity.name} entered airspace over neutral ${incursion.toName} without diplomatic overflight clearance.`
            : `${entity.name} exited ${incursion.fromName} sovereign airspace into international airspace.`;

      logEvent(
        isPlayerFaction ? 'player' : 'enemy',
        'alert',
        title,
        detail,
        entity.lngLat
      );
    }

    return {
      ...entity,
      previousAirspace: entity.currentAirspace,
      currentAirspace: currentLoc,
    };
  });

  // -------------------------------------------------------------
  // 4. Multi-Layered Air Defense, Defensive Interceptions & Impacts
  // -------------------------------------------------------------
  const newDefensiveInterceptors: MissileFlyoutTrack[] = [];

  // Pass 1: Kinematic Stepping & Dynamic Target Guidance
  for (const m of session.activeMissiles) {
    if (m.isIntercepted) continue;

    // If missile has a future launch time (sequential ripple salvo stagger), hold at launcher
    if (session.simTimeSec < m.startSimTimeSec) {
      continue;
    }

    // Dynamic guidance for SAM interceptors tracking active moving threat missiles
    if (m.weaponCategory === 'sam' && m.targetMissileId) {
      const liveThreat = session.activeMissiles.find((t) => t.id === m.targetMissileId && !t.isIntercepted);
      if (liveThreat) {
        m.targetLngLat = liveThreat.currentLngLat;
      }
    }

    // Dynamic guidance for ASAT interceptors tracking orbiting satellites in Low Earth Orbit
    if (m.weaponCategory === 'asat' && m.targetSatelliteId) {
      const liveSat = (session.satellites || []).find((s) => s.id === m.targetSatelliteId && s.status !== 'destroyed');
      if (liveSat) {
        m.targetLngLat = liveSat.currentLngLat;
      }
    }

    const totalDist = distanceKm(m.originLngLat, m.targetLngLat);
    const speedKmh = Math.max(600, m.speedKmh);
    const stepDist = (speedKmh / 3600) * dtSimSec;
    const nextProgress = Math.min(1.0, m.progress + (stepDist / Math.max(1, totalDist)));
    const nextLngLat = interpolate(m.originLngLat, m.targetLngLat, nextProgress);

    m.progress = nextProgress;
    m.currentLngLat = nextLngLat;
  }

  // Pass 2: Mid-Air Kinetic Interceptor & Threat Collisions (with CPA Inflection Point Detection)
  for (const sam of session.activeMissiles) {
    if (sam.isIntercepted || sam.weaponCategory !== 'sam' || !sam.targetMissileId) continue;
    if (session.simTimeSec < sam.startSimTimeSec) continue;

    const threat = session.activeMissiles.find((t) => t.id === sam.targetMissileId && !t.isIntercepted);
    if (threat) {
      const distToThreat = distanceKm(sam.currentLngLat, threat.currentLngLat);
      const combinedStepDist = ((sam.speedKmh + threat.speedKmh) / 3600) * dtSimSec;

      // Section 4: Closest Point of Approach (CPA) Inflection Point Detection
      // The exact frame distance stops shrinking and begins to grow indicates the closest point of approach.
      const isInflection = sam.lastDistanceToTargetKm !== undefined && distToThreat > sam.lastDistanceToTargetKm;
      const isProximityIntercept = distToThreat <= Math.max(3.5, combinedStepDist * 1.3);

      // Direct physical collision criteria (Proximity lethal radius, CPA inflection, or terminal progress)
      if (isProximityIntercept || (isInflection && distToThreat <= 8.0) || sam.progress >= 0.92) {
        // Snap both missiles to the exact intersection collision coordinates
        const collisionLngLat = interpolate(sam.currentLngLat, threat.currentLngLat, 0.5);
        sam.currentLngLat = collisionLngLat;
        threat.currentLngLat = collisionLngLat;

        const effectivePk = sam.interceptorPk ?? 0.82;
        if (Math.random() < effectivePk) {
          // Both missiles collide and are neutralized simultaneously
          threat.isIntercepted = true;
          sam.isIntercepted = true;

          // Track SAM kill in salvoTracker if present
          if (threat.salvoId) {
            const tracker = session.salvoTrackers?.find((t) => t.salvoId === threat.salvoId);
            const defender = updatedEntities.find((e) => e.id === sam.attackerEntityId);
            if (tracker) {
              tracker.interceptedBySam++;
              if (defender && !tracker.defendingSamSystems.includes(defender.name)) {
                tracker.defendingSamSystems.push(defender.name);
              }
              tracker.interceptionBreakdowns = tracker.interceptionBreakdowns || [];
              let entry = tracker.interceptionBreakdowns.find(
                (b) => b.defenderName === (defender?.name ?? sam.attackerEntityId) && b.interceptorWeapon === sam.weaponName
              );
              if (!entry) {
                entry = {
                  defenderEntityId: defender?.id ?? sam.attackerEntityId,
                  defenderName: defender?.name ?? 'Air Defense Battery',
                  interceptorWeapon: sam.weaponName,
                  interceptType: 'sam',
                  countDestroyed: 0,
                  roundsFired: 1,
                  threatWeaponName: threat.weaponName,
                };
                tracker.interceptionBreakdowns.push(entry);
              }
              entry.countDestroyed++;
            }
          }

          logEvent(
            sam.attackerIso === session.playerIso ? 'player' : 'enemy',
            'intercept',
            `💥 Mid-Air Kinetic Interception: ${sam.weaponName}`,
            `${sam.weaponName} scored direct collision kill at CPA (${distToThreat.toFixed(1)} km) against incoming ${threat.weaponName} (Compound Pk: ${Math.round(effectivePk * 100)}%)!`,
            collisionLngLat
          );
        } else {
          // Flyby / near miss: Interceptor expended its kinetic energy; threat continues ingress
          sam.isIntercepted = true;
          logEvent(
            sam.attackerIso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `⚠️ Interceptor Missed: ${threat.weaponName}`,
            `${threat.weaponName} evaded ${sam.weaponName} intercept envelope at CPA (${distToThreat.toFixed(1)} km) and continues terminal ingress!`,
            collisionLngLat
          );
        }
      }

      sam.lastDistanceToTargetKm = distToThreat;
    } else {
      // Threat already destroyed by another interceptor
      if (sam.progress >= 0.95) {
        sam.isIntercepted = true;
      }
    }
  }

  // Pass 2b: ASAT Direct-Ascent Kinetic Interceptor Collisions in Low Earth Orbit
  for (const asat of session.activeMissiles) {
    if (asat.isIntercepted || asat.weaponCategory !== 'asat' || !asat.targetSatelliteId) continue;
    if (session.simTimeSec < asat.startSimTimeSec) continue;

    const targetSat = (session.satellites || []).find((s) => s.id === asat.targetSatelliteId);
    if (targetSat && targetSat.status !== 'destroyed') {
      const distToSat = distanceKm(asat.currentLngLat, targetSat.currentLngLat);
      if (distToSat <= 35 || asat.progress >= 0.95) {
        asat.isIntercepted = true;
        const pk = asat.interceptorPk ?? 0.88;
        if (Math.random() < pk) {
          targetSat.status = 'destroyed';
          logEvent(
            asat.attackerIso === session.playerIso ? 'player' : 'enemy',
            'strike',
            `💥 Orbital Kinetic Kill: ${targetSat.name}`,
            `Direct-Ascent ASAT interceptor scored direct hit-to-kill collision on hostile ${targetSat.name} in ${targetSat.altitudeKm}km Low Earth Orbit! Space reconnaissance in sector blinded.`,
            asat.currentLngLat
          );
        } else {
          logEvent(
            asat.attackerIso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `⚠️ ASAT Missed Target: ${targetSat.name}`,
            `ASAT kinetic kill vehicle failed to achieve orbital hit-to-kill window with ${targetSat.name}. Satellite remains operational.`,
            asat.currentLngLat
          );
        }
      }
    }
  }

  // Pass 3: Cooperative Datalink Area SAM Engagement & Channel Saturation
  // Group active incoming threats by salvo/target to coordinate network fire
  const threatGroups = new Map<string, MissileFlyoutTrack[]>();
  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress >= 1.0) continue;
    if (session.simTimeSec < m.startSimTimeSec) continue;
    const groupKey = m.salvoId || m.targetEntityId;
    const list = threatGroups.get(groupKey) || [];
    list.push(m);
    threatGroups.set(groupKey, list);
  }

  for (const [groupKey, threatsInGroup] of threatGroups.entries()) {
    if (threatsInGroup.length === 0) continue;
    const firstThreat = threatsInGroup[0];
    const defendingIso = firstThreat.targetIso;
    const targetEntity = updatedEntities.find((e) => e.id === firstThreat.targetEntityId);

    // Find all live defenders of the defending nation/network whose radars are operational
    const potentialDefenders = updatedEntities.filter(
      (e) =>
        e.iso === defendingIso &&
        e.status !== 'destroyed' &&
        e.status !== 'docked' &&
        e.status !== 'in_repair' &&
        e.status !== 'turnaround' &&
        e.subsystems?.radar !== 'destroyed'
    );

    if (potentialDefenders.length === 0) continue;

    // Guidance Channel Saturation Calculation:
    // Total simultaneous tracking/guidance channels across all operational radar defenders
    const totalChannels = potentialDefenders.reduce((sum, def) => {
      const spec = systemsLibrary.find((s) => s.id === def.systemId);
      const cap = spec?.sensor?.tracks ? Math.min(12, Math.max(4, Math.floor(spec.sensor.tracks / 10))) : 4;
      return sum + cap;
    }, 0);

    const isSaturated = threatsInGroup.length > totalChannels;
    const saturationPenalty = isSaturated
      ? Math.max(0.60, 1.0 - ((threatsInGroup.length - totalChannels) / threatsInGroup.length) * 0.40)
      : 1.0;

    const tracker = session.salvoTrackers?.find((t) => t.salvoId === firstThreat.salvoId);
    if (isSaturated && tracker && !tracker.saturationPenaltyApplied) {
      tracker.saturationPenaltyApplied = true;
      logEvent(
        defendingIso === session.playerIso ? 'player' : 'enemy',
        'alert',
        `⚠️ Radar Guidance Channels Saturated`,
        `Salvo of ${threatsInGroup.length} simultaneous threats exceeded theater tracking capacity (${totalChannels} guidance channels). Radar guidance degraded by ${Math.round((1 - saturationPenalty) * 100)}%!`,
        targetEntity?.lngLat || firstThreat.currentLngLat
      );
    }

    // Process threats in this salvo with cooperative tiered assignment
    for (const m of threatsInGroup) {
      const alreadyEngaged = m.engagedByDefenderIds ?? [];

      for (const def of potentialDefenders) {
        const defSpec = systemsLibrary.find((s) => s.id === def.systemId);
        const distToMissile = distanceKm(def.lngLat, m.currentLngLat);

        // Sensor reach (with subsystem degradation if degraded)
        let sensorReach = defSpec?.sensor?.detectionKm ?? (isGroundCombatUnit(def.typeId) ? 25 : 240);
        if (def.subsystems?.radar === 'degraded') sensorReach *= 0.60;
        if (distToMissile > sensorReach) continue;

        // Topographic Terrain Line-of-Sight & Mountain Masking check
        const defSensorEquip = defaultTerrainSensorFor(defSpec, def.typeId);
        const mslPlatformEquip = { tercomGuidance: m.threatAltitudeM !== undefined && m.threatAltitudeM <= 60 };
        const samTerrainLos = calculateTerrainLineOfSight({
          scannerLngLat: def.lngLat,
          scannerAltitudeM: def.altitudeM || (defSpec?.sensor?.antennaM ?? (isNavalCombatant(def.typeId) ? 35 : 15)),
          targetLngLat: m.currentLngLat,
          targetAltitudeM: m.threatAltitudeM ?? 30,
          sensorEquipment: defSensorEquip,
          platformEquipment: mslPlatformEquip,
        });

        if (samTerrainLos.isMasked) {
          continue; // Target cruise missile is masked behind mountain ridge! Radar guidance blocked.
        }

        // Airspace Sovereignty & Rules of Engagement (ROE) check
        const targetAirspace = resolveAirspaceLocation(m.currentLngLat, session.playerIso, session.enemyIso);
        const roeDoctrine = session.airspaceRoeDoctrine || 'weapons_free';
        const roeCheck = canEngageUnderAirspaceRoe(targetAirspace, roeDoctrine, def.iso === session.playerIso ? 'player' : 'enemy');
        if (!roeCheck.canFire) {
          continue; // Fire held due to ADIZ / Neutral Sanctuary ROE restriction
        }

        // Threat Detection Record
        const detectionTimes = m.defenderDetectionTimes || {};
        if (!detectionTimes[def.id]) {
          detectionTimes[def.id] = session.simTimeSec;
          m.defenderDetectionTimes = detectionTimes;
        }

        const reactionTimeSec = (defSpec?.sensor?.tracks && defSpec.sensor.tracks > 50) ? 5 : 8;
        const isReactionReady = session.simTimeSec >= (detectionTimes[def.id] + reactionTimeSec);
        if (!isReactionReady || alreadyEngaged.includes(def.id)) continue;

        // Find best Air Defense Interceptor Weapon
        const weapons = (def.customWeapons && def.customWeapons.length > 0)
          ? def.customWeapons
          : (defSpec?.weapons || []);

        let bestWeaponIdx = -1;
        let bestWeapon: WeaponFacet | null = null;

        for (let wIdx = 0; wIdx < weapons.length; wIdx++) {
          const w = weapons[wIdx];
          const hasAmmo = (w.magazine !== undefined ? w.magazine : (def.magazines?.[wIdx] ?? 2)) > 0;
          if (!hasAmmo) continue;
          if (w.rangeKm < distToMissile) continue;

          const isAirWeapon = canWeaponEngageTarget(w, 'air') || w.engages?.includes('air') || w.engages?.includes('ballistic-short') || w.engages?.includes('ballistic-medium');
          if (isAirWeapon) {
            if (!bestWeapon || w.rangeKm > bestWeapon.rangeKm) {
              bestWeapon = w;
              bestWeaponIdx = wIdx;
            }
          }
        }

        if (bestWeapon && bestWeaponIdx >= 0) {
          m.engagedByDefenderIds = [...alreadyEngaged, def.id];

          const curMag = bestWeapon.magazine !== undefined ? bestWeapon.magazine : (def.magazines?.[bestWeaponIdx] ?? 2);
          const salvoCommit = Math.min(curMag, bestWeapon.salvo ?? 2, 2);

          // Deduct from defender's magazine in real-time
          if (def.customWeapons && def.customWeapons[bestWeaponIdx]) {
            def.customWeapons[bestWeaponIdx] = {
              ...def.customWeapons[bestWeaponIdx],
              magazine: Math.max(0, curMag - salvoCommit),
            };
          }
          if (def.magazines) {
            def.magazines[bestWeaponIdx] = Math.max(0, curMag - salvoCommit);
          }

          const interceptorSpeed = Math.max(3600, (bestWeapon.speedMach ?? 4.0) * 1225);
          const tFlySec = (distToMissile / interceptorSpeed) * 3600;

          // Section 2: Dynamic P_k Modifier Pipeline
          // P_k_modified = P_k_base * SpeedMod * RCSMod * AltMod
          const threatProfile = resolveMunitionPhysicalProfile(m.weaponName, m.weaponCategory, m.speedKmh);
          const baseSingleShotPk = bestWeapon.pk ?? 0.82;
          const { modifiedPk, speedMod, rcsMod, altMod, breakdown: pkBreakdown } = calculateDynamicPk({
            basePk: baseSingleShotPk,
            threatSpeedMach: m.threatSpeedMach ?? threatProfile.speedMach,
            threatRcsM2: m.threatRcsM2 ?? threatProfile.rcsM2,
            threatAltitudeM: m.threatAltitudeM ?? threatProfile.altitudeM,
            saturationPenalty,
            seekerDegraded: def.subsystems?.radar === 'degraded',
          });

          // Section 3: Compound Probability Math: Compound P_k = 1 - (1 - P_k_modified)^N
          const compoundPk = calculateCompoundSalvoPk(modifiedPk, salvoCommit);

          // Spawn interceptor directly tracking target threat
          const interceptorTrack: MissileFlyoutTrack = {
            id: `msl-int-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            originLngLat: def.lngLat,
            targetLngLat: m.currentLngLat,
            currentLngLat: def.lngLat,
            attackerEntityId: def.id,
            targetEntityId: def.id,
            attackerIso: def.iso,
            targetIso: m.attackerIso,
            weaponName: bestWeapon.name || 'Defensive SAM',
            weaponCategory: 'sam',
            speedKmh: interceptorSpeed,
            startSimTimeSec: session.simTimeSec,
            etaSimTimeSec: session.simTimeSec + Math.max(2, Math.round(tFlySec)),
            isIntercepted: false,
            progress: 0.0,
            targetMissileId: m.id,
            interceptorPk: compoundPk,
            salvoId: m.salvoId,
            lastDistanceToTargetKm: distToMissile,
            threatAltitudeM: m.threatAltitudeM ?? threatProfile.altitudeM,
            threatRcsM2: m.threatRcsM2 ?? threatProfile.rcsM2,
            threatSpeedMach: m.threatSpeedMach ?? threatProfile.speedMach,
          };
          newDefensiveInterceptors.push(interceptorTrack);

          if (m.salvoId && tracker) {
            tracker.interceptionBreakdowns = tracker.interceptionBreakdowns || [];
            let entry = tracker.interceptionBreakdowns.find(
              (b) => b.defenderName === def.name && b.interceptorWeapon === (bestWeapon.name || 'Defensive SAM')
            );
            if (!entry) {
              entry = {
                defenderEntityId: def.id,
                defenderName: def.name,
                interceptorWeapon: bestWeapon.name || 'Defensive SAM',
                interceptType: 'sam',
                countDestroyed: 0,
                roundsFired: 0,
                threatWeaponName: m.weaponName,
              };
              tracker.interceptionBreakdowns.push(entry);
            }
            entry.roundsFired += salvoCommit;
          }

          const remainingMag = def.customWeapons?.[bestWeaponIdx]?.magazine ?? 0;
          const tierLabel = bestWeapon.rangeKm >= 50 ? 'Tier 1 Long-Range Area SAM' : 'Tier 2 Medium-Range Area SAM';

          logEvent(
            def.iso === session.playerIso ? 'player' : 'enemy',
            'intercept',
            `🚀 ${tierLabel} Intercept: ${def.name}`,
            `${def.name} engaged incoming ${m.weaponName} at ${distToMissile.toFixed(0)} km range (${pkBreakdown}, Compound Pk: ${Math.round(compoundPk * 100)}%). Fired ${salvoCommit} × ${bestWeapon.name} (${remainingMag} ready rounds remaining).`,
            def.lngLat
          );
          break; // One defender assigned per threat per tick
        }
      }
    }
  }

  // Pass 4: Individual Terminal Point Defense (CIWS) at Target Location (<15km / progress >= 0.95)
  // Track CIWS engagements per target per salvo to enforce turret cycle & volume limit
  const ciwsEngagementsPerSalvo = new Map<string, number>();

  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress < 0.95 || m.progress >= 1.0) continue;

    const targetEntity = updatedEntities.find((e) => e.id === m.targetEntityId);
    if (
      targetEntity &&
      targetEntity.status !== 'destroyed' &&
      targetEntity.status !== 'docked' &&
      targetEntity.status !== 'in_repair' &&
      targetEntity.status !== 'turnaround'
    ) {
      // If target's radar is destroyed, CIWS cannot track effectively
      const radarOffline = targetEntity.subsystems?.radar === 'destroyed';
      const weaponsOffline = targetEntity.subsystems?.weapons === 'offline';
      if (weaponsOffline) continue;

      const targetSpec = systemsLibrary.find((s) => s.id === targetEntity.systemId);
      const tWeapons = (targetEntity.customWeapons && targetEntity.customWeapons.length > 0)
        ? targetEntity.customWeapons
        : (targetSpec?.weapons || []);

      const isNaval = isNavalCombatant(targetEntity.typeId) || (targetSpec ? domainOf(targetSpec) === 'sea' : false);
      const isSubmarine = targetEntity.typeId === 'submarine';
      const hasInherentNavalCiws = isNaval && !isSubmarine;

      const ciwsIdx = tWeapons.findIndex(
        (w) => w.rangeKm <= 15 && (canWeaponEngageTarget(w, 'air') || w.engages?.includes('air')) && (w.magazine ?? 2) > 0
      );

      if (ciwsIdx >= 0 || hasInherentNavalCiws) {
        const salvoKey = m.salvoId || targetEntity.id;
        const currentEngagements = ciwsEngagementsPerSalvo.get(salvoKey) || 0;

        // Turret cycle limit: Standard CIWS mount can track and engage at most 2 leakers per salvo window
        if (currentEngagements >= 2) {
          logEvent(
            targetEntity.iso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `⚠️ CIWS Tracking Cycle Overwhelmed: ${targetEntity.name}`,
            `${m.weaponName} penetrated inner defense! High threat volume exceeded ${targetEntity.name} CIWS turret tracking cycle limits.`,
            targetEntity.lngLat
          );
          continue;
        }

        ciwsEngagementsPerSalvo.set(salvoKey, currentEngagements + 1);

        const ciwsWeaponName: string = ciwsIdx >= 0
          ? (tWeapons[ciwsIdx].name || 'CIWS Point Defense')
          : (targetEntity.typeId === 'destroyer' || targetEntity.typeId === 'frigate' ? '76mm / 30mm CIWS Point Defense' : 'Point Defense Countermeasures');

        if (ciwsIdx >= 0 && targetEntity.customWeapons && targetEntity.customWeapons[ciwsIdx]) {
          const curCiwsMag = tWeapons[ciwsIdx].magazine ?? 2;
          targetEntity.customWeapons[ciwsIdx] = {
            ...targetEntity.customWeapons[ciwsIdx],
            magazine: Math.max(0, curCiwsMag - 1),
          };
        }

        // Speed-dependent Pk
        let ciwsPk = 0.45;
        const threatSpeedKmh = m.speedKmh ?? 0;
        const threatMach = threatSpeedKmh > 0 ? threatSpeedKmh / 1225 : 0;

        if (threatSpeedKmh > 0) {
          if (threatMach >= 5.0) {
            ciwsPk = 0.0; // Hypersonic bypass
          } else if (threatMach >= 3.0) {
            ciwsPk = 0.20;
          } else if (threatMach >= 1.0) {
            ciwsPk = 0.45;
          } else {
            ciwsPk = 0.65;
          }
        }

        // Penalty if radar degraded or offline
        if (radarOffline) {
          ciwsPk *= 0.30; // Optical fallback tracking only
        }

        if (ciwsPk > 0 && Math.random() < ciwsPk) {
          m.isIntercepted = true;

          if (m.salvoId) {
            const tracker = session.salvoTrackers?.find((t) => t.salvoId === m.salvoId);
            if (tracker) {
              tracker.interceptedByCiws++;
              if (!tracker.defendingCiwsSystems.includes(targetEntity.name)) {
                tracker.defendingCiwsSystems.push(targetEntity.name);
              }
              tracker.interceptionBreakdowns = tracker.interceptionBreakdowns || [];
              let entry = tracker.interceptionBreakdowns.find(
                (b) => b.defenderName === targetEntity.name && b.interceptorWeapon === ciwsWeaponName
              );
              if (!entry) {
                entry = {
                  defenderEntityId: targetEntity.id,
                  defenderName: targetEntity.name,
                  interceptorWeapon: ciwsWeaponName,
                  interceptType: 'ciws',
                  countDestroyed: 0,
                  roundsFired: 0,
                  threatWeaponName: m.weaponName,
                };
                tracker.interceptionBreakdowns.push(entry);
              }
              entry.roundsFired++;
              entry.countDestroyed++;
            }
          }

          logEvent(
            targetEntity.iso === session.playerIso ? 'player' : 'enemy',
            'intercept',
            `💥 CIWS Point Defense Kill: ${targetEntity.name}`,
            `${targetEntity.name} terminal close-in weapon system (${ciwsWeaponName}) destroyed incoming ${m.weaponName} at point-blank range!`,
            targetEntity.lngLat
          );
        } else if (threatMach >= 5.0) {
          logEvent(
            targetEntity.iso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `⚠️ CIWS Bypassed: ${m.weaponName}`,
            `${m.weaponName} traveling at hypersonic velocity (${threatMach.toFixed(1)} Mach) bypassed ${targetEntity.name} terminal point defense!`,
            targetEntity.lngLat
          );
        }
      }
    }
  }

  // Pass 5: Missile Impact Resolution at Target Coordinates & Realistic Subsystem Degradation BDA
  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress < 1.0) continue;

    const targetEntity = updatedEntities.find((e) => e.id === m.targetEntityId);
    const targetBase = updatedBases.find((b) => b.id === m.targetEntityId);

    if (targetEntity && targetEntity.status !== 'destroyed') {
      const isNaval = isNavalCombatant(targetEntity.typeId);
      const isAir = targetEntity.typeId === 'fighter' || targetEntity.typeId === 'strike' || targetEntity.typeId === 'bomber' || targetEntity.typeId === 'awacs' || targetEntity.typeId === 'tanker';

      // Ensure subsystem record exists
      targetEntity.subsystems = targetEntity.subsystems || {
        radar: 'operational',
        weapons: 'operational',
        propulsion: 'operational',
        hullIntegrityPct: 100,
        flooding: 'none',
      };

      if (isNaval) {
        if (targetEntity.damage === 'intact') {
          // Impact 1: Superstructure & Radar Array destruction
          targetEntity.damage = 'damaged';
          targetEntity.status = 'damaged_rtb';
          targetEntity.subsystems.radar = 'destroyed';
          targetEntity.subsystems.weapons = 'offline';
          targetEntity.subsystems.hullIntegrityPct = 50;

          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Superstructure Hit: ${targetEntity.name}`,
            `${m.weaponName} exploded against the superstructure of ${targetEntity.name}. Radar arrays and fire-control sensors destroyed (-40% sensor range, radar SAM guidance offline). Vessel executing emergency RTB.`,
            targetEntity.lngLat
          );
        } else {
          // Impact 2+: Waterline breach & catastrophic sinking
          targetEntity.status = 'destroyed';
          targetEntity.damage = 'destroyed';
          targetEntity.subsystems.flooding = 'critical_sinking';
          targetEntity.subsystems.propulsion = 'disabled';
          targetEntity.subsystems.hullIntegrityPct = 0;

          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Fatal Waterline Breach: ${targetEntity.name}`,
            `${m.weaponName} scored second direct anti-ship strike on ${targetEntity.name}. Lower hull breached at waterline; critical flooding underway. Vessel sinking.`,
            targetEntity.lngLat
          );
        }
      } else if (isAir) {
        targetEntity.status = 'destroyed';
        targetEntity.damage = 'destroyed';
        targetEntity.subsystems.hullIntegrityPct = 0;
        logEvent(
          m.attackerIso === session.playerIso ? 'player' : 'enemy',
          'impact',
          `💥 Aircraft Destroyed: ${targetEntity.name}`,
          `${m.weaponName} intercepted and destroyed ${targetEntity.name} in mid-air.`,
          targetEntity.lngLat
        );
      } else {
        // Ground Battalion / SAM Battery
        if (targetEntity.damage === 'intact') {
          targetEntity.damage = 'damaged';
          targetEntity.status = 'damaged_rtb';
          targetEntity.subsystems.radar = 'destroyed';
          targetEntity.subsystems.hullIntegrityPct = 40;
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `⚠️ Radar Battery Struck: ${targetEntity.name}`,
            `${m.weaponName} direct hit on ${targetEntity.name}. Radar antenna knocked out; battery withdrawing for repairs.`,
            targetEntity.lngLat
          );
        } else {
          targetEntity.status = 'destroyed';
          targetEntity.damage = 'destroyed';
          targetEntity.subsystems.hullIntegrityPct = 0;
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Battery Destroyed: ${targetEntity.name}`,
            `${m.weaponName} obliterated ${targetEntity.name}. Position neutralized.`,
            targetEntity.lngLat
          );
        }
      }

      if (m.salvoId) {
        const tracker = session.salvoTrackers?.find((t) => t.salvoId === m.salvoId);
        if (tracker) {
          tracker.directHits++;
          tracker.targetFinalDamage = targetEntity.damage;
        }
      }
    } else if (targetBase) {
      targetBase.runwayStatus = 'damaged';
      targetBase.repairCountdownSec = 30 * 60;
      logEvent(
        m.attackerIso === session.playerIso ? 'player' : 'enemy',
        'impact',
        `💥 Base Struck: ${targetBase.name}`,
        `${m.weaponName} cratered runways at ${targetBase.name}. Flight operations halted for repairs.`,
        targetBase.lngLat
      );
      if (m.salvoId) {
        const tracker = session.salvoTrackers?.find((t) => t.salvoId === m.salvoId);
        if (tracker) {
          tracker.directHits++;
        }
      }
    }

    m.isIntercepted = true;
  }

  // Pass 6: Check Concluded Strike Salvos & Emit Exactly ONE Consolidated Report per Strike
  if (session.salvoTrackers && session.salvoTrackers.length > 0) {
    for (const tracker of session.salvoTrackers) {
      if (tracker.isConcluded) continue;

      const remainingInFlight = session.activeMissiles.some(
        (m) => m.salvoId === tracker.salvoId && !m.isIntercepted && m.progress < 1.0
      );

      if (!remainingInFlight) {
        tracker.isConcluded = true;
        tracker.concludedSimTimeSec = session.simTimeSec;

        const totalMissiles = tracker.totalLaunched;
        const samKills = tracker.interceptedBySam;
        const ciwsKills = tracker.interceptedByCiws;
        const totalIntercepted = samKills + ciwsKills;
        const directHits = tracker.directHits;
        const defenseSuccessRate = totalMissiles > 0 ? Math.round((totalIntercepted / totalMissiles) * 100) : 0;

        const targetEntity = updatedEntities.find((e) => e.id === tracker.targetEntityId);
        const attackerEntity = updatedEntities.find((e) => e.id === tracker.attackerEntityId);
        const targetSpec = targetEntity ? systemsLibrary.find((s) => s.id === targetEntity.systemId) : undefined;
        const attackerSpec = attackerEntity ? systemsLibrary.find((s) => s.id === attackerEntity.systemId) : undefined;

        const isNaval = targetEntity ? (isNavalCombatant(targetEntity.typeId) || (targetSpec ? domainOf(targetSpec) === 'sea' : false)) : false;
        const isAir = targetEntity ? (targetEntity.typeId === 'fighter' || targetEntity.typeId === 'bomber' || targetEntity.typeId === 'uav' || targetEntity.typeId === 'recon') : false;
        const targetDomain = targetSpec ? domainOf(targetSpec) : (isNaval ? 'sea' : isAir ? 'air' : 'ground');

        const finalDamageState = targetEntity?.damage ?? (directHits > 0 ? 'damaged' : tracker.targetInitialDamage);
        const isCatastrophic = finalDamageState === 'destroyed';

        const breakdowns = tracker.interceptionBreakdowns || [];
        const activeKills = breakdowns.filter((b) => b.countDestroyed > 0);

        let breakdownNarrativeParts: string[] = [];
        for (const b of activeKills) {
          const threatName = b.threatWeaponName || tracker.weaponNames[0] || 'threat missiles';
          if (b.interceptType === 'sam') {
            breakdownNarrativeParts.push(`${b.defenderName}: Intercepted ${b.countDestroyed} × ${threatName} using ${b.interceptorWeapon} (${b.roundsFired} fired)`);
          } else {
            breakdownNarrativeParts.push(`${b.defenderName}: Intercepted ${b.countDestroyed} × ${threatName} using ${b.interceptorWeapon}`);
          }
        }

        const allDefenseSystems = [...tracker.defendingSamSystems, ...tracker.defendingCiwsSystems];
        const defenseSystemName = allDefenseSystems.length > 0 ? allDefenseSystems.join(', ') : (targetEntity?.name ?? 'Defensive Countermeasures');

        let defenseDetail = '';
        if (totalIntercepted === totalMissiles) {
          defenseDetail = `100% Interception: All ${totalMissiles} incoming missiles neutralized by air defense (${samKills} by SAMs, ${ciwsKills} by CIWS). Target suffered zero damage.`;
        } else if (totalIntercepted > 0) {
          defenseDetail = `Partial Defense (${defenseSuccessRate}%): ${totalIntercepted}/${totalMissiles} missiles intercepted (${samKills} SAM kills, ${ciwsKills} CIWS kills). ${directHits} missiles penetrated defensive envelope scoring direct impacts.`;
        } else {
          defenseDetail = `Defense Penetrated: All ${totalMissiles} missiles bypassed or saturated local air defense networks, scoring ${directHits} direct hits.`;
        }

        if (breakdownNarrativeParts.length > 0) {
          defenseDetail += ` Detailed Interception Breakdown: ` + breakdownNarrativeParts.join('; ') + '.';
        }

        const totalInterceptorsExpended = breakdowns.reduce((sum, b) => sum + b.roundsFired, 0) || (totalIntercepted * 2);
        const uniqueInterceptorTypes = breakdowns.map((b) => b.interceptorWeapon).filter((v, i, a) => a.indexOf(v) === i);
        const interceptorTypeLabel = uniqueInterceptorTypes.length > 0 ? uniqueInterceptorTypes.join(' & ') : 'SAM & CIWS Point Defense';

        const bdaSummary = isCatastrophic
          ? `Catastrophic battle damage: ${tracker.targetName} received ${directHits} direct missile impacts and was completely DESTROYED.`
          : directHits > 0
            ? `Heavy battle damage: ${tracker.targetName} sustained ${directHits} direct missile impacts. Platform severely compromised (${finalDamageState.toUpperCase()}).`
            : `Target intact: Defensive countermeasures intercepted all incoming threats. No damage sustained.`;

        // 1. Log SINGLE Unified Strike Report for Attacker
        const isAttackerPlayer = tracker.attackerIso === session.playerIso;
        const attackerFaction: 'player' | 'enemy' = isAttackerPlayer ? 'player' : 'enemy';
        const targetPID = getContactPID(tracker.targetEntityId, attackerFaction, session.fogOfWarContacts);

        logReport({
          category: 'offensive_strike',
          title: isCatastrophic
            ? `🚀 Strike Mission: ${tracker.targetName} Destroyed`
            : directHits > 0
              ? `🚀 Strike Mission: Direct Hits on ${tracker.targetName}`
              : `🚀 Strike Mission: Salvo Intercepted by ${tracker.targetName}`,
          summary: `${tracker.attackerName} fired salvo of ${totalMissiles} × ${tracker.weaponNames.join('+')} against ${tracker.targetName} at ${tracker.standoffDistanceKm.toFixed(0)} km standoff. ${directHits} scored direct hits, ${totalIntercepted} intercepted (${samKills} SAM, ${ciwsKills} CIWS). Target confirmed ${finalDamageState.toUpperCase()}.`,
          lngLat: tracker.targetLngLat,
          countryIso: tracker.attackerIso,
          faction: attackerFaction,
          primaryEntity: {
            id: tracker.attackerEntityId,
            name: tracker.attackerName,
            typeId: attackerEntity?.typeId ?? 'strike',
            domain: attackerSpec ? domainOf(attackerSpec) : 'air',
            iso: tracker.attackerIso,
            isFriendly: true,
            isPID: true,
            count: attackerEntity?.count,
            rcsM2: tracker.attackerEntityId ? (attackerEntity?.rcs ?? (attackerSpec ? getSystemRcs(attackerSpec, attackerSpec ? domainOf(attackerSpec) : 'air') : 5.0)) : 5.0,
          },
          opposingEntity: {
            id: tracker.targetEntityId,
            name: targetPID.isPID ? (targetEntity?.name ?? tracker.targetName) : tracker.targetName,
            typeId: targetPID.isPID ? targetEntity?.typeId : undefined,
            domain: targetDomain,
            iso: tracker.targetIso,
            isFriendly: false,
            isPID: targetPID.isPID,
            count: targetPID.isPID ? targetEntity?.count : undefined,
            rcsM2: targetPID.isPID && targetEntity ? (targetEntity.rcs ?? (targetSpec ? getSystemRcs(targetSpec, targetDomain) : 5.0)) : undefined,
          },
          munitionsDetails: {
            weaponName: tracker.weaponNames.join(' + '),
            salvoCount: totalMissiles,
            speedMach: tracker.weaponSpeedMach,
            rangeKm: tracker.weaponRangeKm,
            launchedBy: tracker.attackerName,
            standoffDistanceKm: tracker.standoffDistanceKm,
          },
          interceptionTelemetry: {
            defenseSystemName,
            interceptorType: interceptorTypeLabel,
            interceptorsLaunched: totalInterceptorsExpended,
            missilesIntercepted: totalIntercepted,
            missilesPenetrated: directHits,
            ciwsEngaged: ciwsKills > 0,
            successRatePct: defenseSuccessRate,
            responseDetail: defenseDetail,
            breakdown: breakdowns,
          },
          damageAssessment: {
            targetInitialState: tracker.targetInitialDamage,
            targetResultState: finalDamageState,
            damageInflicted: isCatastrophic ? 'destroyed' : directHits > 0 ? 'heavy' : 'none',
            personnelLosses: isCatastrophic ? targetEntity?.personnel : (directHits > 0 ? Math.round((targetEntity?.personnel ?? 100) * 0.35) : 0),
            platformsDestroyed: isCatastrophic ? (targetEntity?.count ?? 1) : 0,
            bdaSummary,
          },
        });

        // 2. Log SINGLE Unified Under Attack Report for Defender
        const targetFaction: 'player' | 'enemy' = isAttackerPlayer ? 'enemy' : 'player';
        const attackerPID = getContactPID(tracker.attackerEntityId, targetFaction, session.fogOfWarContacts);

        logReport({
          category: 'under_attack',
          title: isCatastrophic
            ? `💥 Catastrophic Loss: ${targetEntity?.name ?? tracker.targetName} Destroyed`
            : directHits > 0
              ? `⚠️ Air Defense Penetrated: ${targetEntity?.name ?? tracker.targetName} Damaged`
              : `🛡️ Defense Successful: ${targetEntity?.name ?? tracker.targetName} Neutralized Inbound Salvo`,
          summary: `${targetEntity?.name ?? tracker.targetName} engaged incoming salvo of ${totalMissiles} × ${tracker.weaponNames.join('+')} from ${tracker.attackerName}. Neutralized ${totalIntercepted}/${totalMissiles} threats (${samKills} SAM, ${ciwsKills} CIWS, ${defenseSuccessRate}% success). Target status: ${finalDamageState.toUpperCase()}.`,
          lngLat: tracker.targetLngLat,
          countryIso: tracker.targetIso,
          faction: targetFaction,
          primaryEntity: {
            id: tracker.targetEntityId,
            name: targetEntity?.name ?? tracker.targetName,
            typeId: targetEntity?.typeId ?? 'target',
            domain: targetDomain,
            iso: tracker.targetIso,
            isFriendly: true,
            isPID: true,
            count: targetEntity?.count,
            rcsM2: targetEntity?.rcs ?? (targetSpec ? getSystemRcs(targetSpec, targetDomain) : 100.0),
          },
          opposingEntity: {
            id: tracker.attackerEntityId,
            name: attackerPID.isPID ? tracker.attackerName : 'Hostile Strike Platform (Unverified PID)',
            typeId: attackerPID.isPID ? attackerEntity?.typeId : undefined,
            domain: attackerSpec ? domainOf(attackerSpec) : 'air',
            iso: tracker.attackerIso,
            isFriendly: false,
            isPID: attackerPID.isPID,
            rcsM2: attackerPID.isPID && attackerEntity ? (attackerEntity.rcs ?? (attackerSpec ? getSystemRcs(attackerSpec, attackerSpec ? domainOf(attackerSpec) : 'air') : 5.0)) : undefined,
          },
          munitionsDetails: {
            weaponName: tracker.weaponNames.join(' + '),
            salvoCount: totalMissiles,
            speedMach: tracker.weaponSpeedMach,
            rangeKm: tracker.weaponRangeKm,
            launchedBy: attackerPID.isPID ? tracker.attackerName : 'Hostile Strike Force',
            standoffDistanceKm: tracker.standoffDistanceKm,
          },
          interceptionTelemetry: {
            defenseSystemName,
            interceptorType: interceptorTypeLabel,
            interceptorsLaunched: totalInterceptorsExpended,
            missilesIntercepted: totalIntercepted,
            missilesPenetrated: directHits,
            ciwsEngaged: ciwsKills > 0,
            successRatePct: defenseSuccessRate,
            responseDetail: defenseDetail,
            breakdown: breakdowns,
          },
          damageAssessment: {
            targetInitialState: tracker.targetInitialDamage,
            targetResultState: finalDamageState,
            damageInflicted: isCatastrophic ? 'destroyed' : directHits > 0 ? 'heavy' : 'none',
            personnelLosses: isCatastrophic ? targetEntity?.personnel : (directHits > 0 ? Math.round((targetEntity?.personnel ?? 100) * 0.35) : 0),
            platformsDestroyed: isCatastrophic ? (targetEntity?.count ?? 1) : 0,
            bdaSummary,
          },
        });
      }
    }
  }

  // Pass 7: Assemble Clean Active Missiles List
  const updatedMissiles = [
    ...session.activeMissiles.filter((m) => !m.isIntercepted && (m.progress < 1.0 || session.simTimeSec < m.startSimTimeSec)),
    ...newDefensiveInterceptors,
  ];

  // -------------------------------------------------------------
  // 5. Dynamic Sensor Sweeping & Fog of War Contacts Pipeline
  // -------------------------------------------------------------
  const playerContacts: DetectedContact[] = [];
  const enemyContacts: DetectedContact[] = [];

  // Static Bases are always visible baseline (Satellite Recon)
  // Mobile Entities are evaluated per sensor horizon
  const performSensorSweeps = (
    scanningFaction: 'player' | 'enemy',
    scanningIso: string,
    targetIso: string
  ): DetectedContact[] => {
    const contacts: DetectedContact[] = [];
    const scanners = updatedEntities.filter(
      (e) => e.iso === scanningIso && isEntityDeployed(e)
    );
    const friendlyBases = updatedBases.filter(
      (b) => b.iso === scanningIso && b.runwayStatus !== 'destroyed'
    );

    const opposingEntities = updatedEntities.filter(
      (e) => e.iso === targetIso && isEntityDeployed(e)
    );

    for (const target of opposingEntities) {
      const targetSpec = systemsLibrary.find((s) => s.id === target.systemId);
      const targetDomain = targetSpec ? domainOf(targetSpec) : 'air';

      let bestTier: 1 | 2 | 0 = 0;
      let bestScanner: SimEntity | null = null;
      let bestBase: SimBase | null = null;
      let bestDetectionResult: DetectionRangeResult | null = null;
      let bestTerrainLosResult: TerrainLOSResult | null = null;
      let bestScannerDistKm: number = 0;
      let bestRatedEnvelopeKm: number = 0;
      let bestScannerHeightM: number = 0;

      // Target physical characteristics (altitude/mast height & physical RCS)
      const targetHeightM = targetDomain === 'air'
        ? (target.altitudeM && target.altitudeM > 50 ? target.altitudeM : 10000)
        : (targetDomain === 'sea' ? (targetSpec?.sensor?.antennaM ?? (target.typeId === 'destroyer' ? 38 : 25)) : 3);

      const targetRcsM2 = target.rcs ?? getSystemRcs(targetSpec, targetDomain);
      const targetPlatformEquip = defaultTerrainPlatformFor(targetSpec, target.typeId);

      // 1. Check all active friendly deployed platforms (aircraft, ships, drones, air defense, armor)
      for (const scanner of scanners) {
        const scanSpec = systemsLibrary.find((s) => s.id === scanner.systemId);
        const dist = distanceKm(scanner.lngLat, target.lngLat);
        const isGroundScanner = isGroundCombatUnit(scanner.typeId);

        // Ground combat vehicles (tanks, IFVs, artillery, infantry) have optical/thermal sights (~15 km)
        // and CANNOT detect high-altitude aircraft!
        if (isGroundScanner && scanner.typeId !== 'mobile-ad' && scanner.typeId !== 'sam-launcher') {
          if (targetDomain === 'air' && (target.altitudeM ?? 0) > 300) {
            continue;
          }
        }

        // Subsurface acoustic check
        if (targetDomain === 'sub') {
          const sonar = scanSpec?.sensor?.sonar ?? defaultSonarFor(scanSpec, scanner.typeId);
          const maxSonarKm = sonar.detectionKm ?? 35;
          if (dist <= maxSonarKm) {
            if (bestTier === 0) {
              bestTier = 1;
              bestScanner = scanner;
              bestScannerDistKm = dist;
              bestRatedEnvelopeKm = maxSonarKm;
            }
          }
          continue;
        }

        // Sensor detection envelope
        let ratedEnvelopeKm = scanSpec?.sensor?.detectionKm ?? (
          isGroundScanner ? 15 : scanner.typeId === 'awacs' ? 450 : (scanner.typeId === 'uav' || scanner.typeId === 'recon') ? 180 : 250
        );

        // High-altitude maritime search radar / SAR for UAVs & Recon aircraft against sea combatants
        if ((scanner.typeId === 'uav' || scanner.typeId === 'recon') && targetDomain === 'sea') {
          ratedEnvelopeKm = Math.max(ratedEnvelopeKm, 180);
        }

        // Radar Electronic Warfare Suppression: If radar is jammed by hostile EW cone, compress reach
        if (scanner.isRadarJammed && scanner.jammedDetectionRangeKm !== undefined) {
          ratedEnvelopeKm = Math.min(ratedEnvelopeKm, scanner.jammedDetectionRangeKm);
        }

        if (scanner.patrolOrder?.emcon === 'passive') {
          ratedEnvelopeKm = 0; // Passive silent running
        }

        // Scanner physical height
        const isAirScanner = scanner.typeId === 'fighter' || scanner.typeId === 'bomber' || scanner.typeId === 'awacs' || scanner.typeId === 'uav' || scanner.typeId === 'recon' || scanner.typeId === 'tanker' || scanner.typeId === 'helicopter' || scanner.typeId === 'attack-heli' || scanner.typeId === 'transport-heli';
        const scannerHeightM = isAirScanner
          ? (scanner.altitudeM && scanner.altitudeM > 50 ? scanner.altitudeM : 7000)
          : (scanSpec?.sensor?.antennaM ?? (scanner.typeId === 'destroyer' ? 38 : scanner.typeId === 'frigate' ? 25 : isGroundScanner ? 3 : 25));

        const horizonLimited = targetDomain !== 'air' || Boolean(scanSpec?.sensor?.horizonLimited);

        // Unified Sensor Detection Framework calculation
        const detectionResult = calculateDetectionRange({
          scannerHeightM,
          scannerEnvelopeKm: ratedEnvelopeKm,
          targetHeightM,
          targetRcsM2,
          targetDomain,
          horizonLimited,
        });

        // Topographic Line-of-Sight & Mountain Masking check
        const scanSensorEquip = defaultTerrainSensorFor(scanSpec, scanner.typeId);
        const terrainLos = calculateTerrainLineOfSight({
          scannerLngLat: scanner.lngLat,
          scannerAltitudeM: scannerHeightM,
          targetLngLat: target.lngLat,
          targetAltitudeM: targetHeightM,
          sensorEquipment: scanSensorEquip,
          platformEquipment: targetPlatformEquip,
          isGroundTarget: targetDomain === 'ground',
        });

        // If target is completely masked by mountain crest, radar cannot acquire
        if (terrainLos.isMasked) {
          continue;
        }

        const maxDetectionKm = detectionResult.detectionRangeKm * terrainLos.rangeModifier;

        if (dist <= maxDetectionKm) {
          // PID (Tier 2 Positive Identification) conditions:
          // 1. High-resolution ISAR / NCTR radar imaging (AWACS, Recon UAVs, Maritime Patrol):
          //    Physically requires high SNR: dist <= min(90 km, ratedEnvelopeKm * 0.50)
          // 2. Optical / EO-IR camera zoom identification: dist <= 45 km (or 20 km for special forces)
          // 3. Visual / close-range combat sensors: dist <= 35 km
          // At standoff distances (>90 km), targets remain Tier 1 (Unidentified Kinematic Radar Track)
          const isDedicatedRecon = scanner.typeId === 'uav' || scanner.typeId === 'recon' || scanner.typeId === 'awacs' || scanner.typeId === 'special-forces';
          const isOpticalRange = dist <= (scanner.typeId === 'special-forces' ? 20 : 45);
          const isIsarRadarPidRange = isDedicatedRecon && dist <= Math.min(90, ratedEnvelopeKm * 0.50);
          const isVisualCombatRange = dist <= 35;
          const currentTier: 1 | 2 = (isOpticalRange || isIsarRadarPidRange || isVisualCombatRange) ? 2 : 1;

          if (currentTier > bestTier || (currentTier === bestTier && (!bestScanner || dist < bestScannerDistKm))) {
            bestTier = currentTier;
            bestScanner = scanner;
            bestBase = null;
            bestDetectionResult = detectionResult;
            bestTerrainLosResult = terrainLos;
            bestScannerDistKm = dist;
            bestRatedEnvelopeKm = ratedEnvelopeKm;
            bestScannerHeightM = scannerHeightM;
          }
        }
      }

      // 2. Check friendly military base early-warning and coastal surveillance radars
      for (const base of friendlyBases) {
        const distToBase = distanceKm(base.lngLat, target.lngLat);
        const baseAntennaM = base.type === 'airbase' ? 45 : base.type === 'silo_complex' ? 35 : 30;
        const baseEnvelopeKm = base.type === 'silo_complex' ? 300 : base.type === 'airbase' ? 220 : base.type === 'naval_base' ? 140 : 60;
        const baseSensorEquip = { lookDownShootDown: false, clutterRejectionDb: 35 };

        if (targetDomain === 'air') {
          const baseAirDetection = calculateDetectionRange({
            scannerHeightM: baseAntennaM,
            scannerEnvelopeKm: baseEnvelopeKm,
            targetHeightM,
            targetRcsM2,
            targetDomain: 'air',
            horizonLimited: false,
          });

          const baseTerrainLos = calculateTerrainLineOfSight({
            scannerLngLat: base.lngLat,
            scannerAltitudeM: baseAntennaM,
            targetLngLat: target.lngLat,
            targetAltitudeM: targetHeightM,
            sensorEquipment: baseSensorEquip,
            platformEquipment: targetPlatformEquip,
            isGroundTarget: false,
          });

          if (!baseTerrainLos.isMasked && distToBase <= (baseAirDetection.detectionRangeKm * baseTerrainLos.rangeModifier)) {
            if (bestTier === 0) {
              bestTier = 1;
              bestBase = base;
              bestScanner = null;
              bestDetectionResult = baseAirDetection;
              bestTerrainLosResult = baseTerrainLos;
              bestScannerDistKm = distToBase;
              bestRatedEnvelopeKm = baseEnvelopeKm;
              bestScannerHeightM = baseAntennaM;
            }
          }
        } else if (targetDomain === 'sea' && (base.type === 'naval_base' || base.type === 'carrier_group')) {
          const baseSeaDetection = calculateDetectionRange({
            scannerHeightM: baseAntennaM,
            scannerEnvelopeKm: baseEnvelopeKm,
            targetHeightM,
            targetRcsM2,
            targetDomain: 'sea',
            horizonLimited: true,
          });

          const baseTerrainLos = calculateTerrainLineOfSight({
            scannerLngLat: base.lngLat,
            scannerAltitudeM: baseAntennaM,
            targetLngLat: target.lngLat,
            targetAltitudeM: targetHeightM,
            sensorEquipment: baseSensorEquip,
            platformEquipment: targetPlatformEquip,
            isGroundTarget: false,
          });

          if (!baseTerrainLos.isMasked && distToBase <= (baseSeaDetection.detectionRangeKm * baseTerrainLos.rangeModifier)) {
            if (bestTier === 0) {
              bestTier = 1;
              bestBase = base;
              bestScanner = null;
              bestDetectionResult = baseSeaDetection;
              bestTerrainLosResult = baseTerrainLos;
              bestScannerDistKm = distToBase;
              bestRatedEnvelopeKm = baseEnvelopeKm;
              bestScannerHeightM = baseAntennaM;
            }
          }
        } else if (targetDomain === 'ground') {
          // Base perimeter ground surveillance perimeter (~15 km)
          if (distToBase <= 15) {
            if (bestTier === 0) {
              bestTier = 1;
              bestBase = base;
              bestScanner = null;
              bestScannerDistKm = distToBase;
              bestRatedEnvelopeKm = 15;
              bestScannerHeightM = baseAntennaM;
            }
          }
        }
      }

      // Check if contact was previously positively identified (Tier 2 PID)
      const existingContacts = scanningFaction === 'player'
        ? session.fogOfWarContacts.playerContacts
        : session.fogOfWarContacts.enemyContacts;
      const prevContact = existingContacts.find((c) => c.targetEntityId === target.id);

      if (bestTier > 0) {
        // Once an enemy unit is PID (Tier 2), intel does not degrade as long as it remains within sensor range!
        if (prevContact && prevContact.intelTier === 2) {
          bestTier = 2;
        }

        // 1. Initial Tier 1 Sensor Track Discovery Event
        if (bestTier === 1 && !prevContact) {
          const detectingEntity = bestScanner;
          const detectingBase = bestBase;
          const scanSpec = detectingEntity ? systemsLibrary.find((s) => s.id === detectingEntity.systemId) : undefined;
          const isAirDetecting = detectingEntity ? (detectingEntity.typeId === 'fighter' || detectingEntity.typeId === 'bomber' || detectingEntity.typeId === 'awacs' || detectingEntity.typeId === 'uav' || detectingEntity.typeId === 'recon' || detectingEntity.typeId === 'tanker' || detectingEntity.typeId === 'helicopter' || detectingEntity.typeId === 'attack-heli' || detectingEntity.typeId === 'transport-heli') : false;
          const isNavalDetecting = detectingEntity ? (isNavalCombatant(detectingEntity.typeId) || (scanSpec ? domainOf(scanSpec) === 'sea' : false)) : false;
          const detectingDomain = detectingEntity ? (scanSpec ? domainOf(scanSpec) : (isAirDetecting ? 'air' : isNavalDetecting ? 'sea' : 'ground')) : 'site';

          const nominalRangeKm = bestRatedEnvelopeKm;
          const effectiveRangeKm = bestDetectionResult?.detectionRangeKm ?? nominalRangeKm;
          const radarHorizonKmVal = bestDetectionResult?.horizonLimitKm ?? 0;
          const rcsMultiplier = Math.pow(targetRcsM2 / 5.0, 0.25);
          const detectingName = detectingEntity ? detectingEntity.name : (detectingBase ? detectingBase.name : `${scanningFaction.toUpperCase()} Early Warning Net`);

          logReport({
            category: 'recon_intel',
            title: `📡 Radar Track Established: Hostile ${targetDomain.toUpperCase()} Track`,
            summary: `${detectingName} established radar track on an unidentified ${targetDomain} contact at ${bestScannerDistKm.toFixed(0)} km standoff (estimated RCS: ~${targetRcsM2 >= 1 ? targetRcsM2.toFixed(1) : targetRcsM2} m²). Target identity unconfirmed (Tier 1 Raw Track). Close within 90 km or dispatch recon UAV to achieve Positive Identification (PID).`,
            lngLat: target.lngLat,
            countryIso: scanningIso,
            faction: scanningFaction,
            primaryEntity: {
              id: detectingEntity?.id ?? detectingBase?.id ?? 'sensor-net',
              name: detectingName,
              typeId: detectingEntity?.typeId ?? (detectingBase ? detectingBase.type : 'uav'),
              domain: detectingDomain,
              iso: scanningIso,
              isFriendly: true,
              isPID: true,
              count: detectingEntity?.count,
              rcsM2: detectingEntity?.rcs ?? (scanSpec ? getSystemRcs(scanSpec, detectingDomain) : (isAirDetecting ? 1.0 : 100.0)),
            },
            opposingEntity: {
              id: target.id,
              name: `Hostile ${targetDomain.toUpperCase()} Track (Unidentified)`,
              domain: targetDomain,
              iso: target.iso,
              isFriendly: false,
              isPID: false,
              rcsM2: targetRcsM2,
            },
            intelDetails: {
              discoveredDomain: targetDomain.toUpperCase(),
              confidenceTier: 1,
              sensorUsed: detectingEntity?.typeId === 'uav' ? 'Lynx Multi-Mode Radar (Wide-Area Search Mode)' : detectingEntity?.typeId === 'awacs' ? 'APY-2 3D Surveillance Radar' : isNavalDetecting ? '3D Air & Surface Search Radar' : 'Early Warning & Coastal Surveillance Radar',
              coordinatesText: `${target.lngLat[1].toFixed(3)}°N, ${target.lngLat[0].toFixed(3)}°E`,
              rcsM2: targetRcsM2,
              nominalRangeKm,
              effectiveRangeKm,
              radarHorizonKm: radarHorizonKmVal,
              scannerAltitudeM: bestScannerHeightM,
              distanceKm: bestScannerDistKm,
              rcsMultiplier,
              detectionBottleneck: 'Standoff range beyond optical / ISAR resolution limit (>90 km). Target identity unconfirmed.',
            },
            terrainDetails: bestTerrainLosResult ? {
              terrainMasked: bestTerrainLosResult.isMasked,
              isObstructedByTerrain: bestTerrainLosResult.isObstructedByTerrain,
              terrainElevationM: getTerrainElevationM(target.lngLat),
              blockingMountainName: bestTerrainLosResult.blockingMountainName,
              terrainClutterPenalty: bestTerrainLosResult.terrainClutterPenalty,
              specializedEquipmentUsed: bestTerrainLosResult.specializedEquipmentUsed,
              terrainExplanation: bestTerrainLosResult.maskingExplanation,
            } : undefined,
          });
        }

        // 2. New Positive Identification (Tier 2 PID) Discovery / Upgrade Event
        if (bestTier === 2 && (!prevContact || prevContact.intelTier !== 2)) {
          const detectingEntity = bestScanner;
          const detectingBase = bestBase;
          const scanSpec = detectingEntity ? systemsLibrary.find((s) => s.id === detectingEntity.systemId) : undefined;
          const isAirDetecting = detectingEntity ? (detectingEntity.typeId === 'fighter' || detectingEntity.typeId === 'bomber' || detectingEntity.typeId === 'awacs' || detectingEntity.typeId === 'uav' || detectingEntity.typeId === 'recon' || detectingEntity.typeId === 'tanker' || detectingEntity.typeId === 'helicopter' || detectingEntity.typeId === 'attack-heli' || detectingEntity.typeId === 'transport-heli') : false;
          const isNavalDetecting = detectingEntity ? (isNavalCombatant(detectingEntity.typeId) || (scanSpec ? domainOf(scanSpec) === 'sea' : false)) : false;
          const detectingDomain = detectingEntity ? (scanSpec ? domainOf(scanSpec) : (isAirDetecting ? 'air' : isNavalDetecting ? 'sea' : 'ground')) : 'site';

          const nominalRangeKm = bestRatedEnvelopeKm;
          const effectiveRangeKm = bestDetectionResult?.detectionRangeKm ?? nominalRangeKm;
          const radarHorizonKmVal = bestDetectionResult?.horizonLimitKm ?? 0;
          const rcsMultiplier = Math.pow(targetRcsM2 / 5.0, 0.25);
          const unclippedRadarKm = bestDetectionResult?.radarLimitKm ?? (nominalRangeKm * rcsMultiplier);

          let physicsExplanation = `Standard radar detection baseline is calibrated for a 5.0 m² target. `;
          if (targetRcsM2 > 5.0) {
            physicsExplanation += `Target's large radar cross-section (${targetRcsM2 >= 1 ? targetRcsM2.toFixed(1) : targetRcsM2} m²) amplified radar echo reflectivity by +${((rcsMultiplier - 1) * 100).toFixed(0)}% (unclipped radar reach: ${unclippedRadarKm.toFixed(0)} km). `;
          } else if (targetRcsM2 < 5.0) {
            physicsExplanation += `Target's low radar cross-section (${targetRcsM2} m²) attenuated radar reflectivity by -${((1 - rcsMultiplier) * 100).toFixed(0)}% (unclipped reach: ${unclippedRadarKm.toFixed(0)} km). `;
          }

          if (bestScannerHeightM > 100) {
            physicsExplanation += `High operating altitude (${(bestScannerHeightM / 1000).toFixed(1)} km) extended line-of-sight radar horizon to ${radarHorizonKmVal.toFixed(0)} km, enabling contact tracking at ${bestScannerDistKm.toFixed(0)} km standoff (effective reach: ${effectiveRangeKm.toFixed(0)} km).`;
          } else {
            physicsExplanation += `Surface mast height (${bestScannerHeightM.toFixed(0)} m) resulted in a ${radarHorizonKmVal.toFixed(0)} km Earth-curvature horizon limit (effective reach: ${effectiveRangeKm.toFixed(0)} km).`;
          }

          const detectingName = detectingEntity ? detectingEntity.name : (detectingBase ? detectingBase.name : `${scanningFaction.toUpperCase()} Early Warning Net`);

          logReport({
            category: 'recon_intel',
            title: `📡 Reconnaissance: Positive PID of ${target.name}`,
            summary: `${detectingName} positively identified ${target.name} (${target.count} units, RCS: ${targetRcsM2 >= 1 ? targetRcsM2.toFixed(1) : targetRcsM2} m²) at ${bestScannerDistKm.toFixed(0)} km standoff (reach expanded from nominal ${nominalRangeKm} km to ${effectiveRangeKm.toFixed(0)} km via target RCS scaling & sensor altitude).`,
            lngLat: target.lngLat,
            countryIso: scanningIso,
            faction: scanningFaction,
            primaryEntity: {
              id: detectingEntity?.id ?? detectingBase?.id ?? 'sensor-net',
              name: detectingName,
              typeId: detectingEntity?.typeId ?? (detectingBase ? detectingBase.type : 'uav'),
              domain: detectingDomain,
              iso: scanningIso,
              isFriendly: true,
              isPID: true,
              count: detectingEntity?.count,
              rcsM2: detectingEntity?.rcs ?? (scanSpec ? getSystemRcs(scanSpec, detectingDomain) : (isAirDetecting ? 1.0 : 100.0)),
            },
            opposingEntity: {
              id: target.id,
              name: target.name,
              typeId: target.typeId,
              domain: targetDomain,
              iso: target.iso,
              isFriendly: false,
              isPID: true,
              count: target.count,
              rcsM2: targetRcsM2,
            },
            intelDetails: {
              discoveredDomain: targetDomain.toUpperCase(),
              confidenceTier: 2,
              sensorUsed: detectingEntity?.typeId === 'uav' ? 'Lynx Multi-Mode SAR/GMTI Radar + EO/IR Optical Pod' : detectingEntity?.typeId === 'awacs' ? 'APY-2 3D Air/Maritime Surveillance Radar' : isNavalDetecting ? 'MR-750 Fregat-MA 3D Air & Surface Search Radar' : 'Early Warning & Coastal Surveillance Radar',
              coordinatesText: `${target.lngLat[1].toFixed(3)}°N, ${target.lngLat[0].toFixed(3)}°E`,
              estimatedComposition: `${target.count} × ${target.name} (${target.damage.toUpperCase()})`,
              personnel: target.personnel,
              rcsM2: targetRcsM2,
              nominalRangeKm,
              effectiveRangeKm,
              radarHorizonKm: radarHorizonKmVal,
              scannerAltitudeM: bestScannerHeightM,
              distanceKm: bestScannerDistKm,
              rcsMultiplier,
              detectionBottleneck: `${effectiveRangeKm >= radarHorizonKmVal ? 'Radar line-of-sight horizon limited' : 'Radar power-aperture RCS limited'} (${effectiveRangeKm.toFixed(0)} km reach)`,
              physicsExplanation,
            },
            terrainDetails: bestTerrainLosResult ? {
              terrainMasked: bestTerrainLosResult.isMasked,
              isObstructedByTerrain: bestTerrainLosResult.isObstructedByTerrain,
              terrainElevationM: getTerrainElevationM(target.lngLat),
              blockingMountainName: bestTerrainLosResult.blockingMountainName,
              terrainClutterPenalty: bestTerrainLosResult.terrainClutterPenalty,
              specializedEquipmentUsed: bestTerrainLosResult.specializedEquipmentUsed,
              terrainExplanation: bestTerrainLosResult.maskingExplanation,
            } : undefined,
          });
        }

        const tier: 1 | 2 = bestTier === 2 ? 2 : 1;
        contacts.push({
          contactId: `cnt-${target.id}-${scanningFaction}`,
          targetEntityId: target.id,
          targetIso: target.iso,
          discoveredByFaction: scanningFaction,
          intelTier: tier,
          domain: targetDomain,
          lastKnownLngLat: target.lngLat,
          headingDeg: target.headingDeg,
          speedKmh: target.speedKmh,
          lastDetectedSimTimeSec: newSimTimeSec,
          decayTimerSec: 180, // Contact holds for 3 sim minutes
          knownName: tier === 2 ? target.name : undefined,
          knownCount: tier === 2 ? target.count : undefined,
          knownPersonnel: tier === 2 ? target.personnel : undefined,
          knownDamage: tier === 2 ? target.damage : undefined,
          terrainMasked: Boolean(bestTerrainLosResult?.isMasked),
          terrainElevationM: getTerrainElevationM(target.lngLat),
          blockingMountainRange: bestTerrainLosResult?.blockingMountainName,
        });
      } else if (prevContact && prevContact.decayTimerSec > 0) {
        // Platform is currently outside live sensor sweep, but holds in tactical memory as Last Known Position (LKP)
        const nextDecay = Math.max(0, prevContact.decayTimerSec - dtSimSec);
        if (nextDecay > 0) {
          contacts.push({
            ...prevContact,
            decayTimerSec: nextDecay,
          });
        }
      }
    }

    return contacts;
  };

  const updatedPlayerContacts = performSensorSweeps('player', session.playerIso, session.enemyIso);
  const updatedEnemyContacts = performSensorSweeps('enemy', session.enemyIso, session.playerIso);

  // 5b. Step Space Layer Reconnaissance & Satellite Ground-Tracks
  const effectiveSatellites = (session.satellites && session.satellites.length > 0)
    ? session.satellites
    : createDefaultSatellites(session.playerIso, session.enemyIso, systemsLibrary);

  const { updatedSatellites, spaceEvents } = stepSpaceLayer(
    { ...session, satellites: effectiveSatellites },
    dtSimSec,
    systemsLibrary
  );
  newEvents.push(...spaceEvents);

  // 5c. Step Electronic Warfare (EW), Directional Radar Jamming & GPS Denial
  const {
    updatedEntities: ewEntities,
    updatedMissiles: ewMissiles,
    ewEvents,
  } = stepElectronicWarfare(
    {
      ...session,
      entities: finalEntitiesWithAirspace,
      activeMissiles: updatedMissiles,
    },
    dtSimSec,
    systemsLibrary
  );
  newEvents.push(...ewEvents);

  // 5d. Step Per-System Threat Levels (DEFCON ROE) & Automated Intelligent Retaliation
  const {
    updatedEntities: roeEntities,
    newMissiles: roeMissiles,
    engagementEvents: roeEvents,
  } = stepThreatLevelEngagements(
    {
      ...session,
      entities: ewEntities,
      activeMissiles: ewMissiles,
    },
    systemsLibrary
  );
  newEvents.push(...roeEvents);

  const nextSessionState: WarSimSession = {
    ...session,
    simTimeSec: newSimTimeSec,
    bases: updatedBases,
    entities: roeEntities,
    satellites: updatedSatellites,
    activeMissiles: [...ewMissiles, ...roeMissiles],
    airspaceRoeDoctrine: session.airspaceRoeDoctrine || 'weapons_free',
    borderIncursions: updatedBorderIncursions.slice(-100),
    fogOfWarContacts: {
      playerContacts: updatedPlayerContacts,
      enemyContacts: updatedEnemyContacts,
    },
    eventLog: newEvents.slice(-200), // Keep recent 200 events
    reports: newReports.slice(-150), // Keep recent 150 operational reports
  };

  // 6. Process Battle Ops Multi-Phase Automation
  return processBattleOpsPlanTick(nextSessionState, systemsLibrary);
}

/* ------------------------------------------------------------------ */
/* Battle Ops Multi-Phase Operational Engine & Report Generator       */
/* ------------------------------------------------------------------ */

export function createDefaultBattleOpsPlan(playerIso: string, enemyIso: string): BattleOpsPlan {
  return {
    id: `bop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Operation ${playerIso} Thunder: Multi-Phase Theater Strike`,
    description: `Synchronized multi-axis theater strike and ISR offensive against ${enemyIso} military complexes.`,
    status: 'draft',
    activePhaseIndex: 0,
    phases: [
      {
        id: `phase-1-${Date.now()}`,
        phaseNumber: 1,
        name: 'Phase 1: SEAD & Air Defense Suppression',
        triggerDelaySec: 0, // T+00:00
        status: 'pending',
        tasks: [],
      },
      {
        id: `phase-2-${Date.now() + 1}`,
        phaseNumber: 2,
        name: 'Phase 2: Deep ISR Ingress & Escort Sorties',
        triggerDelaySec: 900, // T+00:15 (15 mins)
        status: 'pending',
        tasks: [],
      },
      {
        id: `phase-3-${Date.now() + 2}`,
        phaseNumber: 3,
        name: 'Phase 3: Main Strategic Strike Package',
        triggerDelaySec: 1800, // T+00:30 (30 mins)
        status: 'pending',
        tasks: [],
      },
    ],
  };
}

export function generateConsolidatedBattleOpsReport(
  session: WarSimSession,
  plan: BattleOpsPlan
): CombatReport {
  const isPlayer = session.activeFaction === 'player';
  const factionIso = isPlayer ? session.playerIso : session.enemyIso;
  const opposingIso = isPlayer ? session.enemyIso : session.playerIso;

  let totalLaunched = 0;
  let totalSamIntercepted = 0;
  let totalCiwsIntercepted = 0;
  let totalHits = 0;
  const targetCasualties: string[] = [];

  const phasesSummary = plan.phases.map((p) => {
    const strikeTasks = p.tasks.filter((t) => t.type === 'strike' || t.type === 'sead');
    const patrolTasks = p.tasks.filter((t) => t.type === 'patrol');

    strikeTasks.forEach((t) => {
      if (t.salvoId) {
        const trk = session.salvoTrackers?.find((st) => st.salvoId === t.salvoId);
        if (trk) {
          totalLaunched += trk.totalLaunched;
          totalSamIntercepted += trk.interceptedBySam;
          totalCiwsIntercepted += trk.interceptedByCiws;
          totalHits += trk.directHits;
          if (trk.targetFinalDamage === 'destroyed') {
            const desc = `${trk.targetName} (DESTROYED)`;
            if (!targetCasualties.includes(desc)) targetCasualties.push(desc);
          } else if (trk.targetFinalDamage === 'damaged') {
            const desc = `${trk.targetName} (DAMAGED)`;
            if (!targetCasualties.includes(desc)) targetCasualties.push(desc);
          }
        } else {
          totalLaunched += t.salvoCount || 1;
        }
      } else {
        totalLaunched += t.salvoCount || 1;
      }
    });

    const strikeDesc = strikeTasks.length > 0 ? `${strikeTasks.length} Strikes` : '';
    const patrolDesc = patrolTasks.length > 0 ? `${patrolTasks.length} Sorties` : '';
    const outcome = p.status === 'completed'
      ? `Completed (${[strikeDesc, patrolDesc].filter(Boolean).join(', ') || 'Finished'})`
      : `${p.status.toUpperCase()}`;

    return {
      phaseNumber: p.phaseNumber,
      name: p.name,
      triggerTimeFormatted: `T+${Math.floor(p.triggerDelaySec / 60)}m`,
      taskCount: p.tasks.length,
      outcome,
    };
  });

  const totalIntercepted = totalSamIntercepted + totalCiwsIntercepted;
  const hitRate = totalLaunched > 0 ? Math.round((totalHits / totalLaunched) * 100) : 0;
  const strategicOutcome =
    totalHits >= 4 || targetCasualties.some((c) => c.includes('DESTROYED'))
      ? 'Decisive Mission Success: Critical Hostile Defenses Neutralized'
      : totalHits > 0
        ? 'Tactical Success: Defense Complexes Degraded'
        : 'Inconclusive / Heavy Defense Interception';

  return {
    id: `rpt-bop-${plan.id}-${Date.now().toString(36)}`,
    simTimeSec: session.simTimeSec,
    timeFormatted: formatSimTime(session.simTimeSec),
    category: 'battle_ops',
    title: `🏆 Consolidated Theater Battle Ops Report: ${plan.title}`,
    summary: `Operational Assessment for ${plan.title}. Executed across ${plan.phases.length} synchronized phases with ${plan.phases.reduce((sum, p) => sum + p.tasks.length, 0)} total assigned tasks. ${totalLaunched} munitions launched, ${totalIntercepted} intercepted (${totalSamIntercepted} Area SAM / ${totalCiwsIntercepted} CIWS), and ${totalHits} direct hits scored (${hitRate}% penetration efficiency). ${strategicOutcome}.`,
    countryIso: factionIso,
    faction: session.activeFaction,
    primaryEntity: {
      id: `hq-${factionIso}`,
      name: `${factionIso} Theater Command HQ`,
      typeId: 'command',
      domain: 'ground',
      iso: factionIso,
      isFriendly: true,
      isPID: true,
    },
    opposingEntity: {
      id: `hostile-theater-${opposingIso}`,
      name: `${opposingIso} Integrated Theater Defenses`,
      typeId: 'defense_complex',
      domain: 'theater',
      iso: opposingIso,
      isFriendly: false,
      isPID: true,
    },
    munitionsDetails: {
      weaponName: `Multi-Phase Strike Package (${totalLaunched} total ordnance)`,
      salvoCount: totalLaunched,
      launchedBy: `${plan.title} Joint Coalition`,
    },
    interceptionTelemetry: {
      defenseSystemName: `${opposingIso} Integrated Air & Missile Defense Network`,
      interceptorsLaunched: totalSamIntercepted * 2 + totalCiwsIntercepted,
      missilesIntercepted: totalIntercepted,
      missilesPenetrated: totalHits,
      successRatePct: totalLaunched > 0 ? Math.round((totalIntercepted / totalLaunched) * 100) : 0,
      responseDetail: `Defense network splashed ${totalSamIntercepted} munitions via Area SAM and ${totalCiwsIntercepted} via point-defense CIWS.`,
    },
    damageAssessment: {
      targetResultState: targetCasualties.length > 0 ? 'heavily_degraded' : 'operational',
      damageInflicted: totalHits >= 4 ? 'heavy' : totalHits > 0 ? 'moderate' : 'light',
      bdaSummary: targetCasualties.length > 0
        ? `Confirmed BDA: ${targetCasualties.join(', ')}. Strategic objectives achieved.`
        : `Hostile defense network sustained minor blast fragmentation; primary sites remain combat-effective.`,
    },
    isConsolidatedBattleOps: true,
    battleOpsDetails: {
      planId: plan.id,
      planTitle: plan.title,
      totalPhases: plan.phases.length,
      phasesSummary,
      totalSalvoLaunched: totalLaunched,
      totalIntercepted,
      directHits: totalHits,
      targetCasualties,
      strategicOutcome,
    },
    spaceDetails: createSpaceCombatReport(session),
    ewDetails: createEwCombatReport(session),
  };
}

/**
 * Direct Standoff Salvo Launcher for Battle Ops and Wargames execution.
 * Allows independent salvos to be launched directly by any deployed or stationed unit,
 * deducting ammunition, spawning distinct MissileFlyoutTracks, registering unique SalvoTrackers,
 * and preventing task overwriting when multiple tasks are scheduled simultaneously for the same entity.
 */
export function launchSimStrikeSalvoDirectly(
  session: WarSimSession,
  attackerEntityId: string,
  targetEntityId: string,
  targetLngLat: [number, number],
  weaponIndex: number,
  salvoCount: number = 1,
  postStrikeAction: PostStrikeAction = 'rtb',
  systemsLibrary: SystemSpec[] = [],
  attackWaypoints?: [number, number][]
): {
  session: WarSimSession;
  salvoId?: string;
  launchedCount: number;
  status: 'executing' | 'failed';
  summary: string;
} {
  const attacker = session.entities.find((e) => e.id === attackerEntityId);
  if (!attacker || attacker.status === 'destroyed' || attacker.status === 'in_repair') {
    return {
      session,
      launchedCount: 0,
      status: 'failed',
      summary: 'Attacker unit unavailable or destroyed',
    };
  }

  const spec = systemsLibrary.find((s) => s.id === attacker.systemId);
  const effectiveWeapons =
    attacker.customWeapons && attacker.customWeapons.length > 0
      ? attacker.customWeapons
      : spec?.weapons || [];

  if (effectiveWeapons.length === 0) {
    return {
      session,
      launchedCount: 0,
      status: 'failed',
      summary: 'No weapon systems equipped on platform',
    };
  }

  const wIdx = Math.max(0, Math.min(weaponIndex, effectiveWeapons.length - 1));
  const weapon = effectiveWeapons[wIdx];
  const weaponName = weapon?.name || 'Standoff Missile';
  const weaponRangeKm = weapon?.rangeKm || 100;
  const curMag = weapon?.magazine ?? 1;

  if (curMag <= 0) {
    return {
      session,
      launchedCount: 0,
      status: 'failed',
      summary: `Ammunition exhausted for ${weaponName} (0 remaining)`,
    };
  }

  const totalAvailableRounds = attacker.count * curMag;
  const requestedSalvo = Math.max(1, salvoCount);
  const actualSalvoToFire = Math.min(requestedSalvo, totalAvailableRounds);

  // Deduct ammunition accurately
  const totalRoundsAfter = Math.max(0, totalAvailableRounds - actualSalvoToFire);
  const newMagPerUnit = Math.floor(totalRoundsAfter / attacker.count);

  const updatedCustomWeapons = effectiveWeapons.map((cw, idx) =>
    idx === wIdx ? { ...cw, magazine: newMagPerUnit } : cw
  );

  const targetEntity = session.entities.find((e) => e.id === targetEntityId);
  const targetBase = session.bases.find((b) => b.id === targetEntityId);
  const targetPos: [number, number] =
    targetEntity && targetEntity.status !== 'destroyed'
      ? targetEntity.lngLat
      : targetBase
        ? targetBase.lngLat
        : targetLngLat;

  const distToTarget = distanceKm(attacker.lngLat, targetPos);
  const missileSpeed = weapon?.speedMach
    ? weapon.speedMach * 1225
    : weaponRangeKm > 100
      ? 3200
      : 1800;
  const missileCategory: any = weapon?.engages?.includes('air')
    ? 'air_to_air'
    : weapon?.engages?.includes('subsurface')
      ? 'torpedo'
      : 'cruise';

  const salvoId = `salvo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const isAttackerPlayer = attacker.iso === session.playerIso;
  const attackerFaction: 'player' | 'enemy' = isAttackerPlayer ? 'player' : 'enemy';
  const targetPID = getContactPID(targetEntityId, attackerFaction, session.fogOfWarContacts);
  const targetDisplayName = targetPID.isPID
    ? (targetEntity?.name ?? targetBase?.name ?? 'Hostile Entity')
    : `Hostile Track (Stand-off Target)`;

  const newMissiles: MissileFlyoutTrack[] = [];
  for (let s = 0; s < actualSalvoToFire; s++) {
    const launchStaggerSec = s * 1.2;
    const munitionProfile = resolveMunitionPhysicalProfile(weaponName, missileCategory, missileSpeed);
    const msl: MissileFlyoutTrack = {
      id: `msl-${Date.now()}-${wIdx}-${s}-${Math.random().toString(36).slice(2, 6)}`,
      originLngLat: attacker.lngLat,
      targetLngLat: targetPos,
      currentLngLat: attacker.lngLat,
      attackerEntityId: attacker.id,
      targetEntityId,
      attackerIso: attacker.iso,
      targetIso:
        targetEntity?.iso ??
        targetBase?.iso ??
        (isAttackerPlayer ? session.enemyIso : session.playerIso),
      weaponName,
      weaponCategory: missileCategory,
      speedKmh: missileSpeed,
      startSimTimeSec: session.simTimeSec + launchStaggerSec,
      etaSimTimeSec:
        session.simTimeSec +
        Math.max(8, Math.round((distToTarget / missileSpeed) * 3600)) +
        launchStaggerSec,
      isIntercepted: false,
      progress: 0,
      salvoId,
      threatAltitudeM: munitionProfile.altitudeM,
      threatRcsM2: munitionProfile.rcsM2,
      threatSpeedMach: munitionProfile.speedMach,
      lastDistanceToTargetKm: distToTarget,
    };
    newMissiles.push(msl);
  }

  // Register Salvo Tracker
  const newSalvoTracker: StrikeSalvoTracker = {
    salvoId,
    attackerEntityId: attacker.id,
    attackerName: attacker.name,
    attackerIso: attacker.iso,
    targetEntityId,
    targetName: targetDisplayName,
    targetIso:
      targetEntity?.iso ??
      targetBase?.iso ??
      (isAttackerPlayer ? session.enemyIso : session.playerIso),
    weaponNames: [`${actualSalvoToFire} × ${weaponName}`],
    totalLaunched: actualSalvoToFire,
    interceptedBySam: 0,
    interceptedByCiws: 0,
    directHits: 0,
    defendingSamSystems: [],
    defendingCiwsSystems: [],
    startSimTimeSec: session.simTimeSec,
    targetInitialDamage: targetEntity?.damage || 'intact',
    standoffDistanceKm: distToTarget,
    weaponSpeedMach: weapon?.speedMach || 2.5,
    weaponRangeKm,
    targetLngLat: targetPos,
    attackerLngLat: attacker.lngLat,
    isConcluded: false,
  };

  const isAirUnit = !isGroundCombatUnit(attacker.typeId) && !isNavalCombatant(attacker.typeId);
  const updatedEntities = session.entities.map((e) => {
    if (e.id !== attacker.id) return e;
    return {
      ...e,
      customWeapons: updatedCustomWeapons,
      status:
        isAirUnit && postStrikeAction === 'rtb'
          ? ('bingo_rtb' as const)
          : isAirUnit && postStrikeAction === 'return_to_patrol' && e.patrolOrder
            ? ('takeoff_ingress' as const)
            : e.status,
    };
  });

  const newEvent: SimBattleEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    simTimeSec: session.simTimeSec,
    timeFormatted: formatSimTime(session.simTimeSec),
    faction: attackerFaction,
    type: 'launch',
    title: `Missile Salvo Launched: ${attacker.name}`,
    detail: `${attacker.name} launched ${actualSalvoToFire} × ${weaponName} against ${targetDisplayName} (${distToTarget.toFixed(0)} km standoff).`,
    lngLat: attacker.lngLat,
  };

  const updatedSession: WarSimSession = {
    ...session,
    entities: updatedEntities,
    activeMissiles: [...session.activeMissiles, ...newMissiles],
    salvoTrackers: [...(session.salvoTrackers || []), newSalvoTracker],
    eventLog: [...session.eventLog, newEvent].slice(-200),
  };

  return {
    session: updatedSession,
    salvoId,
    launchedCount: actualSalvoToFire,
    status: 'executing',
    summary: `Salvo launched: ${actualSalvoToFire} × ${weaponName} in flight to ${targetDisplayName}`,
  };
}

export function processBattleOpsPlanTick(
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): WarSimSession {
  if (!session.battleOpsPlan || session.battleOpsPlan.status !== 'executing') {
    return session;
  }

  let plan = { ...session.battleOpsPlan };
  const startedAt = plan.startedAtSimTimeSec ?? session.simTimeSec;
  if (!plan.startedAtSimTimeSec) {
    plan.startedAtSimTimeSec = startedAt;
  }

  const elapsedOpSec = session.simTimeSec - startedAt;
  let currentSession: WarSimSession = { ...session, battleOpsPlan: plan };
  let planUpdated = false;

  const updatedPhases: BattleOpsPhase[] = plan.phases.map((phase) => {
    let phaseUpdated = false;
    let phaseStatus = phase.status;

    // Trigger pending phase if trigger delay threshold reached
    if (phaseStatus === 'pending' && elapsedOpSec >= phase.triggerDelaySec) {
      phaseStatus = 'in_progress';
      phaseUpdated = true;
      planUpdated = true;

      currentSession.eventLog = [
        ...currentSession.eventLog,
        {
          id: `evt-${Date.now()}-bop-${phase.phaseNumber}`,
          simTimeSec: currentSession.simTimeSec,
          timeFormatted: formatSimTime(currentSession.simTimeSec),
          faction: currentSession.activeFaction,
          type: 'strike' as const,
          title: `⚡ Battle Ops Phase ${phase.phaseNumber} Commenced: ${phase.name}`,
          detail: `Operation "${plan.title}" triggered Phase ${phase.phaseNumber} (${phase.tasks.length} tasks scheduled). Coordinated strikes and sorties executing.`,
        },
      ];
    }

    if (phaseStatus !== 'in_progress') {
      return phase;
    }

    const updatedTasks: BattleOpsTask[] = phase.tasks.map((task) => {
      // 1. Task is pending -> Execute!
      if (task.status === 'pending') {
        const attacker = currentSession.entities.find((e) => e.id === task.attackerEntityId);
        if (!attacker || attacker.status === 'destroyed') {
          return {
            ...task,
            status: 'failed' as const,
            resultSummary: 'Attacker destroyed or unavailable',
          };
        }

        if (task.type === 'strike' || task.type === 'sead') {
          const targetPos = task.targetLngLat || [0, 0];
          const targetEntityId = task.targetEntityId || '';
          const weaponIdx = task.weaponIndex ?? 0;
          const salvoCount = task.salvoCount ?? 1;
          const postAction = task.postStrikeAction ?? 'rtb';

          // Launch strike directly so multiple tasks in the same phase execute independently
          const strikeResult = launchSimStrikeSalvoDirectly(
            currentSession,
            task.attackerEntityId,
            targetEntityId,
            targetPos,
            weaponIdx,
            salvoCount,
            postAction,
            systemsLibrary,
            task.attackWaypoints
          );

          currentSession = strikeResult.session;
          phaseUpdated = true;
          planUpdated = true;

          return {
            ...task,
            status: strikeResult.status,
            executedAtSimTimeSec: currentSession.simTimeSec,
            salvoId: strikeResult.salvoId,
            resultSummary: strikeResult.summary,
          };
        } else if (task.type === 'patrol') {
          const patrolCenter = task.patrolCenterLngLat || attacker.lngLat;
          currentSession = orderPatrol(
            currentSession,
            task.attackerEntityId,
            patrolCenter,
            task.patrolRadiusKm ?? 80,
            task.patrolAltitudeM ?? (isGroundCombatUnit(attacker.typeId) ? 0 : 7000),
            task.emcon ?? 'active',
            task.sortieCount,
            undefined,
            task.patrolRouteType ?? 'orbit',
            task.patrolWaypoints,
            undefined
          );

          phaseUpdated = true;
          planUpdated = true;
          return {
            ...task,
            status: 'completed' as const,
            executedAtSimTimeSec: currentSession.simTimeSec,
            completedAtSimTimeSec: currentSession.simTimeSec,
            resultSummary: 'Patrol sortie established on station',
          };
        } else if (task.type === 'aar') {
          currentSession = orderAerialRefueling(
            currentSession,
            task.attackerEntityId,
            task.tankerEntityId,
            task.fuelTransferTargetPct ?? 100,
            systemsLibrary
          );

          phaseUpdated = true;
          planUpdated = true;
          return {
            ...task,
            status: 'executing' as const,
            executedAtSimTimeSec: currentSession.simTimeSec,
            resultSummary: 'En route to AAR Tanker Rendezvous',
          };
        }
      }

      // 2. Task is executing -> Check completion
      if (task.status === 'executing') {
        if (task.type === 'aar') {
          const receiver = currentSession.entities.find((e) => e.id === task.attackerEntityId);
          if (receiver && receiver.status !== 'aar_rendezvous' && receiver.status !== 'aar_refueling') {
            phaseUpdated = true;
            planUpdated = true;
            return {
              ...task,
              status: 'completed' as const,
              completedAtSimTimeSec: currentSession.simTimeSec,
              resultSummary: `AAR Complete: Fuel topped off to ${receiver.currentFuelPct.toFixed(0)}%`,
            };
          }
        }

        if (task.salvoId) {
          const tracker = currentSession.salvoTrackers?.find((t) => t.salvoId === task.salvoId);
          if (tracker && tracker.isConcluded) {
            phaseUpdated = true;
            planUpdated = true;
            return {
              ...task,
              status: 'completed' as const,
              completedAtSimTimeSec: currentSession.simTimeSec,
              resultSummary: `Direct Hits: ${tracker.directHits} | Intercepted: ${tracker.interceptedBySam + tracker.interceptedByCiws} | BDA: ${tracker.targetFinalDamage || 'Assessed'}`,
            };
          }
        }
      }

      return task;
    });

    const allFinished = updatedTasks.length === 0 || updatedTasks.every((t) => t.status === 'completed' || t.status === 'failed');
    if (allFinished && phaseStatus === 'in_progress') {
      phaseStatus = 'completed';
      phaseUpdated = true;
      planUpdated = true;

      currentSession.eventLog = [
        ...currentSession.eventLog,
        {
          id: `evt-${Date.now()}-bop-done-${phase.phaseNumber}`,
          simTimeSec: currentSession.simTimeSec,
          timeFormatted: formatSimTime(currentSession.simTimeSec),
          faction: currentSession.activeFaction,
          type: 'impact' as const,
          title: `✅ Battle Ops Phase ${phase.phaseNumber} Concluded: ${phase.name}`,
          detail: `All scheduled tasks for Phase ${phase.phaseNumber} have completed execution.`,
        },
      ];
    }

    return {
      ...phase,
      status: phaseStatus,
      tasks: updatedTasks,
    };
  });

  const allPhasesFinished = updatedPhases.every((p) => p.status === 'completed');
  let finalReportGenerated = plan.finalReportGenerated;

  if (allPhasesFinished && plan.status === 'executing') {
    plan.status = 'completed';
    plan.completedAtSimTimeSec = currentSession.simTimeSec;
    planUpdated = true;

    // Generate Master Consolidated Battle Ops Assessment Report
    if (!finalReportGenerated) {
      finalReportGenerated = true;
      const consolidatedReport = generateConsolidatedBattleOpsReport(currentSession, {
        ...plan,
        phases: updatedPhases,
      });

      plan.consolidatedReportId = consolidatedReport.id;
      currentSession.reports = [consolidatedReport, ...(currentSession.reports || [])];

      currentSession.eventLog = [
        ...currentSession.eventLog,
        {
          id: `evt-${Date.now()}-bop-final`,
          simTimeSec: currentSession.simTimeSec,
          timeFormatted: formatSimTime(currentSession.simTimeSec),
          faction: currentSession.activeFaction,
          type: 'impact' as const,
          title: `🏆 Battle Ops Final Report: ${plan.title}`,
          detail: `Operation concluded with ${updatedPhases.length} phases executed. Consolidated theater battle damage assessment report is available in the Reports tab.`,
        },
      ];
    }
  }

  currentSession.battleOpsPlan = {
    ...plan,
    phases: updatedPhases,
    finalReportGenerated,
  };

  return currentSession;
}

/* ------------------------------------------------------------------ */
/* 2. Commands & User Interaction Functions                           */
/* ------------------------------------------------------------------ */

/**
 * Uniquely identifies deployed formations of the same system specification.
 * If multiple units of the same system exist (or are deployed), assigns sequential designators:
 * e.g., "FREMM-class1", "FREMM-class2", "Su-35S-class1", etc.
 */
export function getUniqueSystemEntityName(
  systemName: string,
  systemId: string | undefined,
  iso: string,
  existingEntities: SimEntity[],
  count: number = 1
): string {
  let baseName = systemName.replace(/^\d+\s*[×x]\s*/i, '').trim();
  baseName = baseName.replace(/-class\s*\d+$/i, '').trim();
  baseName = baseName.replace(/\bclass(\s+ship|\s+frigate|\s+destroyer)?\b/gi, '').replace(/\s+/g, ' ').trim();
  baseName = baseName.replace(/[- ]?class$/i, '').trim();

  // Find all existing entities of this systemId for this faction
  const sameSystemEntities = existingEntities.filter(
    (e) => e.iso === iso && ((systemId && e.systemId === systemId) || e.name.toLowerCase().includes(baseName.toLowerCase()))
  );

  // Extract all existing sequence numbers
  const usedSeqs = new Set<number>();
  sameSystemEntities.forEach((e) => {
    const match = e.name.match(/-class\s*(\d+)/i);
    if (match) {
      usedSeqs.add(parseInt(match[1], 10));
    }
  });

  let nextSeq = 1;
  while (usedSeqs.has(nextSeq)) {
    nextSeq++;
  }

  const unitDesignator = `${baseName}-class${nextSeq}`;
  return count > 1 ? `${count} × ${unitDesignator}` : unitDesignator;
}

export function ensureUniqueEntityName(
  candidateName: string,
  systemId: string | undefined,
  iso: string,
  existingEntities: SimEntity[],
  currentEntityId?: string,
  count: number = 1
): string {
  let baseName = candidateName.replace(/^\d+\s*[×x]\s*/i, '').trim();
  baseName = baseName.replace(/-class\s*\d+$/i, '').trim();
  baseName = baseName.replace(/\bclass(\s+ship|\s+frigate|\s+destroyer)?\b/gi, '').replace(/\s+/g, ' ').trim();
  baseName = baseName.replace(/[- ]?class$/i, '').trim();

  const otherEntities = existingEntities.filter(
    (e) => e.id !== currentEntityId && e.iso === iso && ((systemId && e.systemId === systemId) || e.name.toLowerCase().includes(baseName.toLowerCase()))
  );

  const usedSeqs = new Set<number>();
  otherEntities.forEach((e) => {
    const match = e.name.match(/-class\s*(\d+)/i);
    if (match) {
      usedSeqs.add(parseInt(match[1], 10));
    }
  });

  const candidateMatch = candidateName.match(/-class\s*(\d+)/i);
  let chosenSeq = candidateMatch ? parseInt(candidateMatch[1], 10) : 1;

  if (usedSeqs.has(chosenSeq)) {
    chosenSeq = 1;
    while (usedSeqs.has(chosenSeq)) {
      chosenSeq++;
    }
  }

  const unitDesignator = `${baseName}-class${chosenSeq}`;
  return count > 1 ? `${count} × ${unitDesignator}` : unitDesignator;
}

/**
 * Deploys an authorized platform from national stock quota to a designated base.
 */
export function deployEntityToBase(
  session: WarSimSession,
  homeBaseId: string,
  systemId: string,
  count: number,
  systemsLibrary: SystemSpec[]
): WarSimSession {
  const base = session.bases.find((b) => b.id === homeBaseId);
  if (!base) return session;

  const spec = systemsLibrary.find((s) => s.id === systemId);
  const typeId = spec?.typeId || 'fighter';
  const domain = spec ? domainOf(spec) : 'air';

  // Check Base Stationing Rules
  const stationCheck = canStationAtBase(base.type, { domain, typeId });
  if (!stationCheck.allowed) {
    return session;
  }

  // Check Base Capacity Limits
  const currentStationedCount = session.entities.filter((e) => e.homeBaseId === homeBaseId && e.status !== 'destroyed').length;
  if (currentStationedCount >= base.maxCapacity) {
    return session;
  }

  const faction = base.iso === session.playerIso ? 'player' : 'enemy';
  const quotaLedger = { ...session.quotas[faction] };
  const quota = quotaLedger[systemId];

  if (!quota || (quota.deployed + count > quota.count)) {
    return session; // Exceeds authorized quota
  }

  // Update Quota Ledger
  quotaLedger[systemId] = {
    ...quota,
    deployed: quota.deployed + count,
  };

  const rawName = spec?.name ?? typeId;
  const entityName = getUniqueSystemEntityName(rawName, systemId, base.iso, session.entities, count);

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso: base.iso,
    name: entityName,
    typeId,
    systemId,
    count,
    homeBaseId,
    lngLat: base.lngLat,
    altitudeM: domain === 'air' ? 8000 : 0,
    headingDeg: 0,
    speedKmh: spec?.platform?.speedKmh ?? (domain === 'air' ? 850 : 50),
    currentFuelPct: 100,
    status: 'docked',
    damage: 'intact',
    turnaroundTimerSec: 0,
    repairTimerSec: 0,
    personnel: (spec?.platform?.crew ?? 2) * count,
    magazines: {},
    customWeapons: spec?.weapons ? [...spec.weapons] : [],
  };

  return {
    ...session,
    quotas: {
      ...session.quotas,
      [faction]: quotaLedger,
    },
    entities: [...session.entities, newEntity],
  };
}

/**
 * Deploys an autonomous platform directly onto sovereign territory without needing a base
 * (e.g., SAM launcher batteries, early-warning radar arrays, strategic missile silos, field artillery).
 */
export function deployAutonomousEntity(
  session: WarSimSession,
  systemId: string,
  count: number,
  lngLat: [number, number],
  systemsLibrary: SystemSpec[],
  altitudeM: number = 0,
  rcs?: number
): WarSimSession {
  const spec = systemsLibrary.find((s) => s.id === systemId);
  const typeId = spec?.typeId || 'sam-launcher';
  const domain = spec ? domainOf(spec) : 'ground';
  const faction = session.activeFaction;
  const iso = faction === 'player' ? session.playerIso : session.enemyIso;

  const quotaLedger = { ...session.quotas[faction] };
  const quota = quotaLedger[systemId];

  if (!quota || (quota.deployed + count > quota.count)) {
    return session;
  }

  quotaLedger[systemId] = {
    ...quota,
    deployed: quota.deployed + count,
  };

  const rawName = spec?.name ?? typeId;
  const entityName = getUniqueSystemEntityName(rawName, systemId, iso, session.entities, count);

  const effectiveRcs = (rcs !== undefined && rcs > 0)
    ? rcs
    : (spec?.rcs ?? (spec ? getSystemRcs(spec, domain) : 5.0));

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso,
    name: entityName,
    typeId,
    systemId,
    count,
    lngLat,
    altitudeM: altitudeM || 0,
    headingDeg: 0,
    speedKmh: 0,
    currentFuelPct: 100,
    status: 'on_station',
    damage: 'intact',
    turnaroundTimerSec: 0,
    repairTimerSec: 0,
    personnel: (spec?.platform?.crew ?? 4) * count,
    rcs: effectiveRcs,
    magazines: {},
    customWeapons: spec?.weapons ? [...spec.weapons] : [],
    patrolOrder: {
      centerLngLat: lngLat,
      patrolRadiusKm: 0,
      altitudeM: altitudeM || 0,
      orbitAngleDeg: 0,
      emcon: 'active',
    },
  };

  const newEvents = [
    ...session.eventLog,
    {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: formatSimTime(session.simTimeSec),
      faction,
      type: 'strike' as const,
      title: `Battery Erected: ${newEntity.name}`,
      detail: `${newEntity.name} deployed to coordinates (RCS: ${effectiveRcs.toFixed(2)} m²) and initialized active radar/defense network.`,
      lngLat,
    },
  ];

  return {
    ...session,
    quotas: {
      ...session.quotas,
      [faction]: quotaLedger,
    },
    entities: [...session.entities, newEntity],
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Tasks a stationed entity to sortie and establish a patrol orbit.
 * If sortieCount is specified and is less than entity.count, splits the formation:
 * the requested sortieCount takes off on patrol, while the remaining count stays stationed at base.
 */
export function orderPatrol(
  session: WarSimSession,
  entityId: string,
  centerLngLat: [number, number],
  patrolRadiusKm: number = 15,
  altitudeM: number = 7000,
  emcon: 'active' | 'passive' = 'active',
  sortieCount?: number,
  customWeapons?: import('./specs').WeaponFacet[],
  routeType: 'orbit' | 'waypoints' = 'orbit',
  waypoints?: [number, number][],
  rcs?: number
): WarSimSession {
  const targetEntity = session.entities.find((e) => e.id === entityId);
  if (!targetEntity || targetEntity.status === 'destroyed' || targetEntity.status === 'in_repair') {
    return session;
  }

  const isGround = isGroundCombatUnit(targetEntity.typeId);
  const isStaticAD = isStaticAirDefense(targetEntity.typeId);
  const isCustomRoute = routeType === 'waypoints' && waypoints && waypoints.length >= 2;
  const effectiveRadiusKm = isGround || isStaticAD || isCustomRoute ? 0 : patrolRadiusKm;
  const effectiveAltM = isGround || isStaticAD ? 0 : altitudeM;
  const initialCenter = isCustomRoute ? waypoints[0] : centerLngLat;

  const effectiveCount = Math.max(1, Math.min(targetEntity.count, sortieCount ?? targetEntity.count));
  const isPartialSplit = effectiveCount < targetEntity.count;

  const patrolOrder: PatrolOrder = {
    centerLngLat: initialCenter,
    patrolRadiusKm: effectiveRadiusKm,
    altitudeM: effectiveAltM,
    orbitAngleDeg: 0,
    emcon,
    routeType: isCustomRoute ? 'waypoints' : 'orbit',
    waypoints: isCustomRoute ? waypoints : undefined,
    currentWaypointIdx: isCustomRoute ? 1 : undefined,
    patrolDirection: 1,
  };

  const faction: 'player' | 'enemy' = targetEntity.iso === session.playerIso ? 'player' : 'enemy';

  if (isPartialSplit) {
    const remainingCount = targetEntity.count - effectiveCount;
    const personnelPerUnit = Math.max(1, Math.round(targetEntity.personnel / targetEntity.count));
    const sortieEntityId = `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    const sortieName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      session.entities,
      undefined,
      effectiveCount
    );

    const dockedName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      [...session.entities.filter((e) => e.id !== targetEntity.id), { ...targetEntity, id: sortieEntityId, name: sortieName }],
      targetEntity.id,
      remainingCount
    );

    const updatedDockedEntity: SimEntity = {
      ...targetEntity,
      name: dockedName,
      count: remainingCount,
      personnel: remainingCount * personnelPerUnit,
    };

    const sortieEntity: SimEntity = {
      ...targetEntity,
      id: sortieEntityId,
      name: sortieName,
      count: effectiveCount,
      personnel: effectiveCount * personnelPerUnit,
      status: 'takeoff_ingress',
      patrolOrder,
      altitudeM: effectiveAltM,
      rcs: (rcs !== undefined && rcs > 0) ? rcs : targetEntity.rcs,
      customWeapons: customWeapons && customWeapons.length > 0 ? [...customWeapons] : targetEntity.customWeapons,
    };

    const homeBase = session.bases.find((b) => b.id === targetEntity.homeBaseId);
    let updatedBases = session.bases;
    if (homeBase && !homeBase.stationedEntityIds.includes(sortieEntity.id)) {
      updatedBases = session.bases.map((b) =>
        b.id === homeBase.id
          ? { ...b, stationedEntityIds: [...b.stationedEntityIds, sortieEntity.id] }
          : b
      );
    }

    const updatedEntities = session.entities.map((e) => (e.id === targetEntity.id ? updatedDockedEntity : e));
    updatedEntities.push(sortieEntity);

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'rtb' as const,
        title: isStaticAD
          ? `Air Defense Emplaced: ${sortieName}`
          : isGround
            ? `Ground Movement: ${sortieName}`
            : `Sortie Launched: ${sortieName}`,
        detail: isStaticAD
          ? `Emplaced ${sortieName} air defense battery (${remainingCount} in depot) at designated coordinates.`
          : isGround
            ? `Dispatched ${sortieName} (${remainingCount} remaining at base) on road march to designated coordinates.`
            : `Detached ${sortieName} (${remainingCount} remaining at base) on designated patrol mission (RCS: ${sortieEntity.rcs ?? 'default'} m²).`,
        lngLat: centerLngLat,
      },
    ];

    return {
      ...session,
      bases: updatedBases,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
    };
  } else {
    const uniqueName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      session.entities,
      targetEntity.id,
      targetEntity.count
    );

    const isAlreadyDeployed = targetEntity.status !== 'docked';
    const updatedEntities = session.entities.map((e) => {
      if (e.id !== entityId) return e;
      return {
        ...e,
        name: uniqueName,
        status: isAlreadyDeployed && e.status === 'on_station' ? 'on_station' as const : 'takeoff_ingress' as const,
        patrolOrder,
        altitudeM: effectiveAltM,
        rcs: (rcs !== undefined && rcs > 0) ? rcs : e.rcs,
        // Loadout can only be reconfigured at base — keep existing loadout if already deployed
        customWeapons: isAlreadyDeployed
          ? e.customWeapons
          : (customWeapons && customWeapons.length > 0 ? [...customWeapons] : e.customWeapons),
      };
    });

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'rtb' as const,
        title: isAlreadyDeployed
          ? `Patrol Retasked: ${uniqueName}`
          : isGround
            ? `Ground Movement: ${uniqueName}`
            : `Sortie Launched: ${uniqueName}`,
        detail: isAlreadyDeployed
          ? `${uniqueName} retasked to new operational coordinates while preserving equipped weapons.`
          : isGround
            ? `${uniqueName} departed base and is en route to designated defensive position.`
            : `${uniqueName} departed base and is en route to designated patrol coordinates.`,
        lngLat: centerLngLat,
      },
    ];

    return {
      ...session,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
    };
  }
}

/**
 * Manually updates the physical Radar Cross-Section (RCS in m²) of a deployed or stationed entity
 * (e.g. adjusting for external weapon pylons, drop tanks, or stealth coating degradation).
 */
export function updateEntityRcs(
  session: WarSimSession,
  entityId: string,
  rcs: number
): WarSimSession {
  return {
    ...session,
    entities: session.entities.map((e) =>
      e.id === entityId ? { ...e, rcs: rcs > 0 ? rcs : undefined } : e
    ),
  };
}

/**
 * Adds a new sovereign Base / HQ installation on the map.
 */
export function addSimBase(
  session: WarSimSession,
  name: string,
  type: BaseType,
  iso: string,
  lngLat: [number, number]
): WarSimSession {
  const newBase: SimBase = {
    id: `base-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: name || `${iso} ${type.replace('_', ' ').toUpperCase()}`,
    iso,
    type,
    lngLat,
    maxCapacity: defaultBaseCapacity(type),
    stationedEntityIds: [],
    runwayStatus: 'operational',
    repairCountdownSec: 0,
    supplies: { fuelPct: 100, ammoPct: 100 },
  };

  return {
    ...session,
    bases: [...session.bases, newBase],
  };
}

/**
 * Renames an existing sovereign base installation.
 */
export function renameSimBase(
  session: WarSimSession,
  baseId: string,
  newName: string
): WarSimSession {
  const updatedBases = session.bases.map((b) => {
    if (b.id !== baseId) return b;
    return { ...b, name: newName.trim() || b.name };
  });

  return {
    ...session,
    bases: updatedBases,
  };
}

/**
 * Orders a specific in-flight or deployed entity to immediately abort mission and return directly to its home base (or nearest friendly base).
 */
export function orderEntityRtb(session: WarSimSession, entityId: string): WarSimSession {
  let orderedName = '';
  let entityIso = session.playerIso;
  let homeLngLat: [number, number] | null = null;
  let homeBaseName = '';

  const updatedEntities = session.entities.map((e) => {
    if (e.id !== entityId) return e;
    orderedName = e.name;
    entityIso = e.iso;

    // Find its designated home base or fallback to nearest friendly base
    const homeBase = session.bases.find((b) => b.id === e.homeBaseId);
    if (homeBase) {
      homeLngLat = homeBase.lngLat;
      homeBaseName = homeBase.name;
    } else {
      const friendlyBases = session.bases.filter((b) => b.iso === e.iso);
      if (friendlyBases.length > 0) {
        let nearestDist = Infinity;
        let nearestCoord = friendlyBases[0].lngLat;
        for (const fb of friendlyBases) {
          const d = distanceKm(e.lngLat, fb.lngLat);
          if (d < nearestDist) {
            nearestDist = d;
            nearestCoord = fb.lngLat;
          }
        }
        homeLngLat = nearestCoord;
        homeBaseName = friendlyBases[0].name;
      }
    }

    const nextHeading = homeLngLat ? bearingDeg(e.lngLat, homeLngLat) : e.headingDeg;

    return {
      ...e,
      status: 'bingo_rtb' as const,
      headingDeg: nextHeading,
      patrolOrder: undefined, // Clear any orbit/loiter orders so it flies directly home
    };
  });

  const faction: 'player' | 'enemy' = entityIso === session.playerIso ? 'player' : 'enemy';
  const newEvents = orderedName
    ? [
        ...session.eventLog,
        {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          simTimeSec: session.simTimeSec,
          timeFormatted: formatSimTime(session.simTimeSec),
          faction,
          type: 'rtb' as const,
          title: `RTB Ordered: ${orderedName}`,
          detail: `${orderedName} was ordered to RTB immediately towards ${homeBaseName || 'home installation'}.`,
          lngLat: homeLngLat || undefined,
        },
      ]
    : session.eventLog;

  return {
    ...session,
    entities: updatedEntities,
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Tasks an operational unit to conduct a targeted strike or intercept mission against an enemy contact/entity.
 */
export function orderStrikeMission(
  session: WarSimSession,
  attackerEntityId: string,
  targetEntityId: string,
  targetLngLat: [number, number],
  weaponIndex: number,
  salvoCount: number = 1,
  postStrikeAction: PostStrikeAction = 'rtb',
  customPostLngLat?: [number, number],
  systemsLibrary: SystemSpec[] = [],
  sortieCount?: number,
  customWeapons?: import('./specs').WeaponFacet[],
  weaponsToFire?: import('./warSimTypes').WeaponSalvoItem[],
  attackWaypoints?: [number, number][]
): WarSimSession {
  const attacker = session.entities.find((e) => e.id === attackerEntityId);
  if (!attacker || attacker.status === 'destroyed' || attacker.status === 'in_repair' || attacker.status === 'turnaround') {
    return session;
  }

  const spec = systemsLibrary.find((s) => s.id === attacker.systemId);
  const effectiveWeapons = (customWeapons && customWeapons.length > 0)
    ? customWeapons
    : (attacker.customWeapons && attacker.customWeapons.length > 0)
      ? attacker.customWeapons
      : (spec?.weapons || []);

  const weapon = effectiveWeapons[weaponIndex] || effectiveWeapons[0];
  const weaponName = (weaponsToFire && weaponsToFire.length > 0)
    ? weaponsToFire.map((w) => `${w.salvoCount}× ${w.weaponName}`).join(' + ')
    : (weapon?.name || 'Ordnance');
  const weaponRangeKm = (weaponsToFire && weaponsToFire.length > 0)
    ? Math.min(...weaponsToFire.map((w) => w.weaponRangeKm))
    : (weapon?.rangeKm || 100);
  const effectiveSalvo = (weaponsToFire && weaponsToFire.length > 0)
    ? weaponsToFire.reduce((sum, w) => sum + w.salvoCount, 0)
    : Math.max(1, salvoCount);

  const targetEntity = session.entities.find((e) => e.id === targetEntityId);
  const targetName = targetEntity?.name || 'Hostile Target Track';

  const effectiveCount = Math.max(1, Math.min(attacker.count, sortieCount ?? attacker.count));
  const isPartialSplit = effectiveCount < attacker.count;

  const strikePlan: StrikePlan = {
    targetEntityId,
    targetLngLat,
    weaponIndex: (weaponsToFire && weaponsToFire.length > 0) ? weaponsToFire[0].weaponIndex : weaponIndex,
    weaponName,
    weaponRangeKm,
    salvoCount: effectiveSalvo,
    postStrikeAction,
    returnPatrolOrder: attacker.patrolOrder ? { ...attacker.patrolOrder } : undefined,
    customPostLngLat,
    weaponsToFire: (weaponsToFire && weaponsToFire.length > 0) ? weaponsToFire : undefined,
    attackWaypoints: (attackWaypoints && attackWaypoints.length > 0) ? attackWaypoints : undefined,
    currentWaypointIdx: (attackWaypoints && attackWaypoints.length > 0) ? 0 : undefined,
  };

  const isPlayer = attacker.iso === session.playerIso;
  const faction: 'player' | 'enemy' = isPlayer ? 'player' : 'enemy';
  const cleanName = attacker.name.replace(/^\d+\s*[×x]\s*/i, '');

  if (isPartialSplit) {
    const remainingCount = attacker.count - effectiveCount;
    const personnelPerUnit = Math.max(1, Math.round(attacker.personnel / attacker.count));
    const sortieEntityId = `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    const sortieName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      session.entities,
      undefined,
      effectiveCount
    );

    const dockedName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      [...session.entities.filter((e) => e.id !== attacker.id), { ...attacker, id: sortieEntityId, name: sortieName }],
      attacker.id,
      remainingCount
    );

    const updatedDockedEntity: SimEntity = {
      ...attacker,
      name: dockedName,
      count: remainingCount,
      personnel: remainingCount * personnelPerUnit,
    };

    const sortieEntity: SimEntity = {
      ...attacker,
      id: sortieEntityId,
      name: sortieName,
      count: effectiveCount,
      personnel: effectiveCount * personnelPerUnit,
      status: 'engaging',
      assignedMission: 'strike',
      assignedTargetEntityId: targetEntityId,
      strikePlan,
      customWeapons: effectiveWeapons,
    };

    const homeBase = session.bases.find((b) => b.id === attacker.homeBaseId);
    let updatedBases = session.bases;
    if (homeBase && !homeBase.stationedEntityIds.includes(sortieEntity.id)) {
      updatedBases = session.bases.map((b) =>
        b.id === homeBase.id
          ? { ...b, stationedEntityIds: [...b.stationedEntityIds, sortieEntity.id] }
          : b
      );
    }

    const updatedEntities = session.entities.map((e) => (e.id === attacker.id ? updatedDockedEntity : e));
    updatedEntities.push(sortieEntity);

    const targetPID = getContactPID(targetEntityId, faction, session.fogOfWarContacts);
    const targetDisplayName = targetPID.isPID ? targetName : 'Hostile Target Track (Unverified PID)';

    const newReports: CombatReport[] = [
      ...(session.reports || []),
      {
        id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        category: 'offensive_strike',
        title: `🚀 Strike Sortie Tasked: ${sortieName}`,
        summary: `Scrambled ${sortieName} on strike mission against ${targetDisplayName} committing ${salvoCount} × ${weaponName} (Stand-off range: ${weaponRangeKm} km).`,
        lngLat: attacker.lngLat,
        countryIso: attacker.iso,
        faction,
        primaryEntity: {
          id: sortieEntity.id,
          name: sortieName,
          typeId: sortieEntity.typeId,
          domain: spec ? domainOf(spec) : 'air',
          iso: sortieEntity.iso,
          isFriendly: true,
          isPID: true,
          count: effectiveCount,
        },
        opposingEntity: {
          id: targetEntityId,
          name: targetDisplayName,
          typeId: targetPID.isPID ? targetEntity?.typeId : undefined,
          domain: 'surface',
          iso: targetEntity?.iso ?? (isPlayer ? session.enemyIso : session.playerIso),
          isFriendly: false,
          isPID: targetPID.isPID,
        },
        munitionsDetails: {
          weaponName,
          salvoCount: effectiveSalvo,
          rangeKm: weaponRangeKm,
          speedMach: weapon?.speedMach,
          launchedBy: sortieName,
        },
        interceptionTelemetry: {
          defenseSystemName: 'Hostile Air Defense Network',
          interceptorsLaunched: 0,
          missilesIntercepted: 0,
          missilesPenetrated: effectiveSalvo,
          successRatePct: 0,
          responseDetail: 'Sortie in flight — ingress to weapon release envelope',
        },
        damageAssessment: {
          targetResultState: targetEntity?.damage ?? 'intact',
          damageInflicted: 'none',
          bdaSummary: 'Sortie en route to strike waypoint.',
        },
      },
    ];

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'launch' as const,
        title: `Strike Sortie Scrambled: ${sortieName}`,
        detail: `Scrambled ${sortieName} (${remainingCount} remaining at base) on strike mission against ${targetName} committing ${salvoCount} × ${weaponName} (Max Range: ${weaponRangeKm} km). Post-strike protocol: ${postStrikeAction.toUpperCase().replace(/_/g, ' ')}.`,
        lngLat: attacker.lngLat,
      },
    ];

    return {
      ...session,
      bases: updatedBases,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
      reports: newReports.slice(-150),
    };
  } else {
    const uniqueName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      session.entities,
      attacker.id,
      attacker.count
    );

    const updatedEntities = session.entities.map((e) => {
      if (e.id !== attackerEntityId) return e;
      return {
        ...e,
        name: uniqueName,
        status: 'engaging' as const,
        assignedMission: 'strike' as const,
        assignedTargetEntityId: targetEntityId,
        strikePlan,
        customWeapons: effectiveWeapons,
      };
    });

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'launch' as const,
        title: `Strike Mission Tasked: ${uniqueName}`,
        detail: `${uniqueName} tasked on strike mission against ${targetName} committing ${salvoCount} × ${weaponName} (Max Range: ${weaponRangeKm} km). Post-strike protocol: ${postStrikeAction.toUpperCase().replace(/_/g, ' ')}.`,
        lngLat: attacker.lngLat,
      },
    ];

    return {
      ...session,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
    };
  }
}

/**
 * Orders a receiver aircraft to rendezvous with a friendly tanker in theater for in-flight aerial refueling.
 */
export function orderAerialRefueling(
  session: WarSimSession,
  receiverEntityId: string,
  tankerEntityId?: string,
  targetFuelPct = 100,
  systemsLibrary: SystemSpec[] = []
): WarSimSession {
  const receiver = session.entities.find((e) => e.id === receiverEntityId);
  if (!receiver) return session;

  let targetTanker: SimEntity | null = null;

  if (tankerEntityId) {
    targetTanker = session.entities.find((e) => e.id === tankerEntityId) || null;
  } else {
    const best = findBestTankerForReceiver(session, receiver, systemsLibrary);
    targetTanker = best.tanker;
  }

  if (!targetTanker) {
    return session;
  }

  const faction: 'player' | 'enemy' = receiver.iso === session.playerIso ? 'player' : 'enemy';
  const dist = distanceKm(receiver.lngLat, targetTanker.lngLat);

  const updatedEntities = session.entities.map((e) => {
    if (e.id !== receiverEntityId) return e;
    return {
      ...e,
      status: 'aar_rendezvous' as const,
      refuelingState: {
        tankerEntityId: targetTanker!.id,
        stage: 'rendezvous' as const,
        targetFuelPct: Math.min(150, Math.max(80, targetFuelPct)),
        flowRateKgPerSec: 35,
        fuelReceivedKg: 0,
        preRefuelStatus: e.status === 'aar_rendezvous' || e.status === 'aar_refueling' ? 'on_station' : e.status,
        preRefuelPatrolOrder: e.patrolOrder,
        preRefuelStrikePlan: e.strikePlan,
        wasBingoRescue: false,
        durationSec: 0,
      },
    };
  });

  const newEvents = [
    ...session.eventLog,
    {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: formatSimTime(session.simTimeSec),
      faction,
      type: 'aar_refuel' as const,
      title: `⛽ AAR Rendezvous Ordered: ${receiver.name}`,
      detail: `${receiver.name} ordered to rendezvous with tanker ${targetTanker.name} (${dist.toFixed(0)} km away). Target offload: top off to ${targetFuelPct}%.`,
      lngLat: receiver.lngLat,
    },
  ];

  return {
    ...session,
    entities: updatedEntities,
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Updates the active Airspace Rules of Engagement (ROE) Doctrine for the theater.
 */
export function setSessionAirspaceRoe(
  session: WarSimSession,
  doctrine: AirspaceRoeDoctrine
): WarSimSession {
  const doctrineLabels: Record<AirspaceRoeDoctrine, string> = {
    weapons_free: '⚔️ Weapons Free (Kinetic reach across all borders authorized)',
    adiz_border_defense: '🛡️ ADIZ Border Defense (Hold fire until sovereign border incursion)',
    neutral_sanctuary: '🕊️ Neutral Airspace Sanctuary (Strict neutrality protection; firing over neutral airspace prohibited)',
  };

  const newEvents = [
    ...session.eventLog,
    {
      id: `evt-${Date.now()}-roe-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: formatSimTime(session.simTimeSec),
      faction: session.activeFaction,
      type: 'alert' as const,
      title: `Airspace ROE Directive Updated`,
      detail: `Theater Commander set Rules of Engagement to: ${doctrineLabels[doctrine]}.`,
      lngLat: [0, 0] as [number, number],
    },
  ];

  return {
    ...session,
    airspaceRoeDoctrine: doctrine,
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Orders a Direct-Ascent Anti-Satellite (ASAT) kinetic interceptor strike against a tracked hostile satellite in Low Earth Orbit.
 */
export function launchAsatStrike(
  session: WarSimSession,
  launcherEntityId: string,
  targetSatelliteId: string
): {
  session: WarSimSession;
  status: 'launched' | 'failed';
  summary: string;
} {
  return orderAsatStrike(session, launcherEntityId, targetSatelliteId);
}

/**
 * Orders a dedicated SEAD Anti-Radiation Missile strike (e.g. AGM-88 HARM / Kh-31P)
 * homing autonomously on an active hostile radar emitter.
 */
export function launchSeadStrike(
  session: WarSimSession,
  attackerEntityId: string,
  targetRadarEntityId: string
): {
  session: WarSimSession;
  status: 'launched' | 'failed';
  summary: string;
} {
  return orderSeadAntiRadiationStrike(session, attackerEntityId, targetRadarEntityId);
}

/**
 * Updates an entity's Electronic Warfare (EW) mode and directional jamming focus.
 */
export function setEntityEwMode(
  session: WarSimSession,
  entityId: string,
  mode: 'off' | 'standoff_jamming' | 'gps_denial' | 'self_protection',
  jammingTargetLngLat?: [number, number]
): WarSimSession {
  const updatedEntities = session.entities.map((e) => {
    if (e.id !== entityId) return e;
    return {
      ...e,
      ewState: {
        mode,
        jammingTargetLngLat,
      },
    };
  });

  return {
    ...session,
    entities: updatedEntities,
  };
}

/**
 * Updates a specific deployed entity's operational Threat Level (DEFCON ROE).
 */
export function updateEntityThreatLevel(
  session: WarSimSession,
  entityId: string,
  threatLevel: SystemThreatLevel
): WarSimSession {
  return setSystemThreatLevel(session, entityId, threatLevel);
}

/**
 * Updates global / category operational Threat Level (DEFCON ROE) across all deployed assets of a faction.
 */
export function updateGlobalFactionThreatLevel(
  session: WarSimSession,
  factionIso: string,
  threatLevel: SystemThreatLevel,
  typeCategory?: 'all' | 'air' | 'sam' | 'naval' | 'ground'
): WarSimSession {
  return setGlobalThreatLevel(session, factionIso, threatLevel, typeCategory);
}
