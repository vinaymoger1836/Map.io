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
  type PatrolOrder,
} from './warSimTypes';
import {
  canStationAtBase,
  defaultBaseCapacity,
  calculateFuelBurnPct,
  calculateBingoFuelThreshold,
} from './warSimRules';
import {
  type SystemSpec,
  domainOf,
  radarHorizonKm,
  defaultSonarFor,
} from './specs';

/* ------------------------------------------------------------------ */
/* 1. Time-Step Clock & Master Engine Loop                            */
/* ------------------------------------------------------------------ */

export function formatSimTime(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  return `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

    // B. Base Turnaround / Refueling Countdown
    if (entity.status === 'turnaround') {
      const nextTimer = Math.max(0, entity.turnaroundTimerSec - dtSimSec);
      if (nextTimer === 0) {
        return {
          ...entity,
          status: 'docked',
          turnaroundTimerSec: 0,
          currentFuelPct: 100,
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

      if (distToTarget <= Math.max(8, stepDistanceKm)) {
        // Arrived at patrol station
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'rtb',
          `On Station: ${entity.name}`,
          `${entity.name} established patrol orbit at designated coordinates.`,
          targetPos
        );
        return {
          ...entity,
          lngLat: targetPos,
          status: 'on_station',
          currentFuelPct: nextFuel,
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
        currentFuelPct: nextFuel,
      };
    }

    // E. On Station Loitering Orbit
    if (entity.status === 'on_station' && entity.patrolOrder) {
      const { centerLngLat, patrolRadiusKm, orbitAngleDeg } = entity.patrolOrder;
      
      // Calculate angular step around orbit
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
          `${entity.name} touched down at ${homeBase?.name ?? 'Base'} for ${isDamaged ? 'repairs' : 'refueling'}.`,
          homeLngLat
        );

        return {
          ...entity,
          lngLat: homeLngLat,
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

    return entity;
  });

  // -------------------------------------------------------------
  // 4. Update Active Missiles & Resolve Impacts
  // -------------------------------------------------------------
  const updatedMissiles: MissileFlyoutTrack[] = [];

  for (const m of session.activeMissiles) {
    if (m.isIntercepted) continue;

    const totalDist = distanceKm(m.originLngLat, m.targetLngLat);
    const speedKmh = Math.max(600, m.speedKmh);
    const stepDist = (speedKmh / 3600) * dtSimSec;
    const nextProgress = m.progress + (stepDist / Math.max(1, totalDist));

    if (nextProgress >= 1.0) {
      // Missile Impacted Target
      const targetEntity = updatedEntities.find((e) => e.id === m.targetEntityId);
      const targetBase = updatedBases.find((b) => b.id === m.targetEntityId);

      if (targetEntity && targetEntity.status !== 'destroyed') {
        const catastrophic = Math.random() < 0.65;
        if (catastrophic) {
          targetEntity.status = 'destroyed';
          targetEntity.damage = 'destroyed';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `Target Destroyed: ${targetEntity.name}`,
            `${m.weaponName} scored direct impact. ${targetEntity.name} destroyed.`,
            targetEntity.lngLat
          );
        } else {
          targetEntity.damage = 'damaged';
          targetEntity.status = 'damaged_rtb';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `Target Damaged: ${targetEntity.name}`,
            `${m.weaponName} caused heavy battle damage to ${targetEntity.name}. Emergency RTB.`,
            targetEntity.lngLat
          );
        }
      } else if (targetBase) {
        targetBase.runwayStatus = 'damaged';
        targetBase.repairCountdownSec = 30 * 60; // 30 min runway repair
        logEvent(
          m.attackerIso === session.playerIso ? 'player' : 'enemy',
          'impact',
          `Base Struck: ${targetBase.name}`,
          `${m.weaponName} cratered runways at ${targetBase.name}. Operations halted for repairs.`,
          targetBase.lngLat
        );
      }
    } else {
      const nextLngLat = interpolate(m.originLngLat, m.targetLngLat, nextProgress);
      updatedMissiles.push({
        ...m,
        currentLngLat: nextLngLat,
        progress: nextProgress,
      });
    }
  }

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
      (e) => e.iso === scanningIso && e.status !== 'destroyed' && e.status !== 'docked'
    );

    const opposingEntities = updatedEntities.filter(
      (e) => e.iso === targetIso && e.status !== 'destroyed' && e.status !== 'docked'
    );

    for (const target of opposingEntities) {
      const targetSpec = systemsLibrary.find((s) => s.id === target.systemId);
      const targetDomain = targetSpec ? domainOf(targetSpec) : 'air';

      let bestTier: 1 | 2 | 0 = 0;

      for (const scanner of scanners) {
        const scanSpec = systemsLibrary.find((s) => s.id === scanner.systemId);
        const dist = distanceKm(scanner.lngLat, target.lngLat);
        
        // Sensor detection envelope
        let maxRadarKm = scanSpec?.sensor?.detectionKm ?? (scanner.typeId === 'awacs' ? 450 : 220);
        if (scanner.patrolOrder?.emcon === 'passive') {
          maxRadarKm = 0; // Passive silent running
        }

        // Radar Horizon modeling against altitude
        if (scanSpec?.sensor?.horizonLimited) {
          const antennaM = scanSpec.sensor.antennaM ?? 25;
          const targetAltM = target.altitudeM ?? 3000;
          const horizonKm = radarHorizonKm(antennaM, targetAltM);
          maxRadarKm = Math.min(maxRadarKm, horizonKm);
        }

        // Subsurface acoustic check
        if (targetDomain === 'sub') {
          const sonar = scanSpec?.sensor?.sonar ?? defaultSonarFor(scanSpec, scanner.typeId);
          const maxSonarKm = sonar.detectionKm ?? 35;
          if (dist <= maxSonarKm) {
            bestTier = Math.max(bestTier, 1) as 1 | 2;
          }
        } else if (dist <= maxRadarKm) {
          // Detected on Radar (Tier 1)
          bestTier = Math.max(bestTier, 1) as 1 | 2;

          // If Recon Drone or SOF team or within visual range (<= 30 km), upgrade to PID (Tier 2)
          if (
            scanner.typeId === 'uav' ||
            scanner.typeId === 'recon' ||
            scanner.typeId === 'special-forces' ||
            dist <= 35
          ) {
            bestTier = 2;
          }
        }
      }

      if (bestTier > 0) {
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
          decayTimerSec: 120, // Contact holds for 2 sim minutes
          knownName: tier === 2 ? target.name : undefined,
          knownCount: tier === 2 ? target.count : undefined,
          knownPersonnel: tier === 2 ? target.personnel : undefined,
          knownDamage: tier === 2 ? target.damage : undefined,
        });
      }
    }

    return contacts;
  };

  const updatedPlayerContacts = performSensorSweeps('player', session.playerIso, session.enemyIso);
  const updatedEnemyContacts = performSensorSweeps('enemy', session.enemyIso, session.playerIso);

  return {
    ...session,
    simTimeSec: newSimTimeSec,
    bases: updatedBases,
    entities: updatedEntities,
    activeMissiles: updatedMissiles,
    fogOfWarContacts: {
      playerContacts: updatedPlayerContacts,
      enemyContacts: updatedEnemyContacts,
    },
    eventLog: newEvents.slice(-200), // Keep recent 200 events
  };
}

/* ------------------------------------------------------------------ */
/* 2. Commands & User Interaction Functions                           */
/* ------------------------------------------------------------------ */

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

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso: base.iso,
    name: `${count} × ${spec?.name ?? typeId}`,
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
  systemsLibrary: SystemSpec[]
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

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso,
    name: `${count} × ${spec?.name ?? typeId}`,
    typeId,
    systemId,
    count,
    lngLat,
    altitudeM: 0,
    headingDeg: 0,
    speedKmh: 0,
    currentFuelPct: 100,
    status: 'on_station',
    damage: 'intact',
    turnaroundTimerSec: 0,
    repairTimerSec: 0,
    personnel: (spec?.platform?.crew ?? 4) * count,
    magazines: {},
    patrolOrder: {
      centerLngLat: lngLat,
      patrolRadiusKm: 0,
      altitudeM: 0,
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
      detail: `${newEntity.name} deployed to coordinates and initialized active radar/defense network.`,
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
  patrolRadiusKm: number = 80,
  altitudeM: number = 7000,
  emcon: 'active' | 'passive' = 'active',
  sortieCount?: number
): WarSimSession {
  const targetEntity = session.entities.find((e) => e.id === entityId);
  if (!targetEntity || targetEntity.status === 'destroyed' || targetEntity.status === 'in_repair') {
    return session;
  }

  const effectiveCount = Math.max(1, Math.min(targetEntity.count, sortieCount ?? targetEntity.count));
  const isPartialSplit = effectiveCount < targetEntity.count && targetEntity.status === 'docked';

  const patrolOrder: PatrolOrder = {
    centerLngLat,
    patrolRadiusKm,
    altitudeM,
    orbitAngleDeg: 0,
    emcon,
  };

  const faction: 'player' | 'enemy' = targetEntity.iso === session.playerIso ? 'player' : 'enemy';

  if (isPartialSplit) {
    const remainingCount = targetEntity.count - effectiveCount;
    const personnelPerUnit = Math.max(1, Math.round(targetEntity.personnel / targetEntity.count));

    const updatedDockedEntity: SimEntity = {
      ...targetEntity,
      count: remainingCount,
      personnel: remainingCount * personnelPerUnit,
    };

    const sortieEntity: SimEntity = {
      ...targetEntity,
      id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      count: effectiveCount,
      personnel: effectiveCount * personnelPerUnit,
      status: 'takeoff_ingress',
      patrolOrder,
      altitudeM,
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
        title: `Sortie Launched: ${effectiveCount} × ${targetEntity.name}`,
        detail: `Detached ${effectiveCount} × ${targetEntity.name} (${remainingCount} remaining at base) on designated patrol mission.`,
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
    const updatedEntities = session.entities.map((e) => {
      if (e.id !== entityId) return e;
      return {
        ...e,
        status: 'takeoff_ingress' as const,
        patrolOrder,
        altitudeM,
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
        title: `Sortie Launched: ${targetEntity.count > 1 ? `${targetEntity.count} × ` : ''}${targetEntity.name}`,
        detail: `${targetEntity.name} (${targetEntity.count}x) departed base and is en route to designated patrol coordinates.`,
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
