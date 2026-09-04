/**
 * Electronic Warfare (EW), GPS Denial & Anti-Radiation Missiles (SEAD/DEAD) Engine
 *
 * Simulates:
 * 1. Directional stand-off noise & deception jamming cones (EA-18G Growler, Su-34 EW, Tornado ECR).
 * 2. Radar burn-through physics and detection range compression on hostile SAM & surveillance radars.
 * 3. Wide-area GPS denial bubbles (Krasukha-4, Pole-21) and cumulative Inertial Navigation System (INS) drift.
 * 4. Autonomous Anti-Radiation Missile (ARM) homing on radiating active radar emitters (AGM-88 HARM, Kh-31P).
 * 5. After-action Electronic Warfare & SEAD combat reporting.
 */

import { distanceKm, destination, bearingDeg } from './geo';
import {
  type SimEntity,
  type MissileFlyoutTrack,
  type WarSimSession,
  type SimBattleEvent,
  type CombatReport,
} from './warSimTypes';
import { defaultEwFacetFor, type SystemSpec } from './specs';
import { isStaticAirDefense } from './warSimRules';

/* ------------------------------------------------------------------ */
/* 1. Geometric Jamming Cones & Sector Beam Calculations              */
/* ------------------------------------------------------------------ */

/**
 * Computes the multi-point polygon representing a directional jamming beam sector cone.
 */
export function generateJammingConePolygon(
  originLngLat: [number, number],
  targetLngLat: [number, number],
  rangeKm: number,
  coneAngleDeg = 60,
  arcSamples = 12
): [number, number][] {
  const centerBearing = bearingDeg(originLngLat, targetLngLat);
  const halfAngle = coneAngleDeg / 2;
  const startAngle = (centerBearing - halfAngle + 360) % 360;

  const points: [number, number][] = [originLngLat];

  for (let i = 0; i <= arcSamples; i++) {
    const angle = (startAngle + (i * coneAngleDeg) / arcSamples) % 360;
    points.push(destination(originLngLat, rangeKm, angle));
  }

  points.push(originLngLat);
  return points;
}

/**
 * Checks whether a target point falls within a directional jamming sector cone.
 */
export function isPointInsideJammingCone(
  originLngLat: [number, number],
  targetLngLat: [number, number],
  jamCenterLngLat: [number, number],
  rangeKm: number,
  coneAngleDeg: number
): boolean {
  const dist = distanceKm(originLngLat, targetLngLat);
  if (dist > rangeKm) return false;

  const centerBearing = bearingDeg(originLngLat, jamCenterLngLat);
  const targetBearing = bearingDeg(originLngLat, targetLngLat);

  let diff = Math.abs(targetBearing - centerBearing);
  if (diff > 180) diff = 360 - diff;

  return diff <= coneAngleDeg / 2;
}

/* ------------------------------------------------------------------ */
/* 2. Real-Time EW Stepping: Radar Compression & GPS Denial Bubbles   */
/* ------------------------------------------------------------------ */

export function stepElectronicWarfare(
  session: WarSimSession,
  dtSimSec: number,
  systemsLibrary: SystemSpec[] = []
): {
  updatedEntities: SimEntity[];
  updatedMissiles: MissileFlyoutTrack[];
  ewEvents: SimBattleEvent[];
} {
  const ewEvents: SimBattleEvent[] = [];
  const simTime = session.simTimeSec;

  // 1. Gather all active EW platforms and jammers across both factions
  const activeJammers: {
    entity: SimEntity;
    spec?: SystemSpec;
    rangeKm: number;
    coneAngleDeg: number;
    burnThroughReduction: number;
    gpsRadiusKm: number;
    targetLngLat: [number, number];
  }[] = [];

  for (const entity of session.entities) {
    if (
      entity.status === 'destroyed' ||
      entity.status === 'docked' ||
      entity.status === 'turnaround' ||
      entity.status === 'in_repair'
    ) {
      continue;
    }

    const spec = systemsLibrary.find((s) => s.id === entity.systemId);
    const ewFacet = defaultEwFacetFor(spec, entity.typeId);

    if (ewFacet && (entity.ewState?.mode === 'standoff_jamming' || entity.ewState?.mode === 'gps_denial' || ewFacet.isDedicatedEw)) {
      const rangeKm = ewFacet.jammingRangeKm;
      const coneAngle = ewFacet.coneAngleDeg;
      const reduction = ewFacet.burnThroughReductionFactor ?? 0.70;
      const gpsRadius = ewFacet.gpsJammerRadiusKm ?? 80;

      // Default jamming orientation: aimed at nearest enemy base or designated target zone
      let targetLngLat = entity.ewState?.jammingTargetLngLat;
      if (!targetLngLat) {
        const opposingBases = session.bases.filter(
          (b) => (entity.iso === session.playerIso ? b.iso !== session.playerIso : b.iso === session.playerIso)
        );
        targetLngLat = opposingBases[0]?.lngLat ?? [entity.lngLat[0] + 1.0, entity.lngLat[1]];
      }

      activeJammers.push({
        entity,
        spec,
        rangeKm,
        coneAngleDeg: coneAngle,
        burnThroughReduction: reduction,
        gpsRadiusKm: gpsRadius,
        targetLngLat,
      });
    }
  }

  // 2. Evaluate Jamming Suppression on All Ground & Airborne Radars
  const updatedEntities = session.entities.map((entity) => {
    if (entity.status === 'destroyed') return entity;

    const spec = systemsLibrary.find((s) => s.id === entity.systemId);
    const nominalRadarKm = spec?.sensor?.detectionKm ?? 0;
    const isRadarActive = nominalRadarKm > 30 && entity.patrolOrder?.emcon !== 'passive';

    if (!isRadarActive) {
      return {
        ...entity,
        isRadarJammed: false,
        jammedDetectionRangeKm: nominalRadarKm,
        isGpsDenied: false,
      };
    }

    // Check if any hostile jammer is illuminating this radar in its jamming cone
    const hostileJammers = activeJammers.filter(
      (j) => (entity.iso === session.playerIso ? j.entity.iso !== session.playerIso : j.entity.iso === session.playerIso)
    );

    let maxSuppressionFactor = 0;
    let jammingAuthor: SimEntity | null = null;
    let isInsideGpsBubble = false;

    for (const jammer of hostileJammers) {
      // 2a. Directional Radar Noise Jamming Check
      const inCone = isPointInsideJammingCone(
        jammer.entity.lngLat,
        entity.lngLat,
        jammer.targetLngLat,
        jammer.rangeKm,
        jammer.coneAngleDeg
      );

      if (inCone) {
        if (jammer.burnThroughReduction > maxSuppressionFactor) {
          maxSuppressionFactor = jammer.burnThroughReduction;
          jammingAuthor = jammer.entity;
        }
      }

      // 2b. Omnidirectional GPS Denial Bubble Check
      const distToJammer = distanceKm(jammer.entity.lngLat, entity.lngLat);
      if (distToJammer <= jammer.gpsRadiusKm) {
        isInsideGpsBubble = true;
      }
    }

    const isJammed = maxSuppressionFactor > 0;
    const effectiveRadarKm = isJammed ? Math.max(25, Math.round(nominalRadarKm * (1.0 - maxSuppressionFactor))) : nominalRadarKm;

    // Log significant first-time EW suppression events
    if (isJammed && !entity.isRadarJammed && jammingAuthor) {
      ewEvents.push({
        id: `evt-ew-jam-${Date.now()}-${entity.id.slice(-4)}`,
        simTimeSec: simTime,
        timeFormatted: `${Math.floor(simTime / 60)}m`,
        faction: entity.iso === session.playerIso ? 'enemy' : 'player',
        type: 'alert',
        title: `⚡ Radar Jammed: ${entity.name}`,
        detail: `${entity.name} search radar blinded by ${jammingAuthor.name} directional EW noise jamming. Effective detection range compressed by ${(maxSuppressionFactor * 100).toFixed(0)}% (${nominalRadarKm}km ➔ ${effectiveRadarKm}km).`,
        lngLat: entity.lngLat,
      });
    }

    // Update active EW polygon on the jammer itself
    let updatedEwState = entity.ewState;
    const ownJammerInfo = activeJammers.find((j) => j.entity.id === entity.id);
    if (ownJammerInfo) {
      const conePoly = generateJammingConePolygon(
        entity.lngLat,
        ownJammerInfo.targetLngLat,
        ownJammerInfo.rangeKm,
        ownJammerInfo.coneAngleDeg
      );
      updatedEwState = {
        mode: entity.ewState?.mode || 'standoff_jamming',
        jammingTargetLngLat: ownJammerInfo.targetLngLat,
        jammingSectorCone: conePoly,
        effectiveJammingRangeKm: ownJammerInfo.rangeKm,
        activePowerKw: ownJammerInfo.spec?.ew?.jammerPowerKw || 120,
      };
    }

    return {
      ...entity,
      ewState: updatedEwState,
      isRadarJammed: isJammed,
      jammedDetectionRangeKm: effectiveRadarKm,
      isGpsDenied: isInsideGpsBubble,
    };
  });

  // 3. Step In-Flight Missiles: GPS Drift & Anti-Radiation Homing
  const updatedMissiles = session.activeMissiles.map((m) => {
    if (m.isIntercepted || m.progress >= 1.0) return m;

    const opposingJammers = activeJammers.filter(
      (j) => (m.attackerIso === session.playerIso ? j.entity.iso !== session.playerIso : j.entity.iso === session.playerIso)
    );

    // 3a. GPS Denial & Cumulative INS Navigation Drift
    let inGpsDenialZone = false;
    for (const jammer of opposingJammers) {
      const d = distanceKm(jammer.entity.lngLat, m.currentLngLat);
      if (d <= jammer.gpsRadiusKm) {
        inGpsDenialZone = true;
        break;
      }
    }

    let insDrift = m.insDriftErrorM || 0;
    if (inGpsDenialZone && (m.weaponCategory === 'cruise' || m.weaponCategory === 'bomb')) {
      const stepDistKm = (Math.max(600, m.speedKmh) / 3600) * dtSimSec;
      // INS drifts by ~20 meters per 100 km of uncorrected GPS-denied flight
      insDrift += (stepDistKm / 100) * 20;
    }

    // 3b. Anti-Radiation Missile (ARM) Autonomous Emitter Tracking (SEAD)
    let dynamicTargetLngLat = m.targetLngLat;
    if (m.isAntiRadiation) {
      const targetRadar = session.entities.find((e) => e.id === m.targetEntityId);
      if (targetRadar && targetRadar.status !== 'destroyed') {
        const isRadiating = targetRadar.patrolOrder?.emcon !== 'passive';
        if (isRadiating) {
          // ARM actively tracks live radiating antenna
          dynamicTargetLngLat = targetRadar.lngLat;
        }
      }
    }

    return {
      ...m,
      targetLngLat: dynamicTargetLngLat,
      isGpsDenied: inGpsDenialZone,
      insDriftErrorM: Number(insDrift.toFixed(1)),
    };
  });

  return {
    updatedEntities,
    updatedMissiles,
    ewEvents,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Launch Anti-Radiation Missile (ARM) SEAD Strike                 */
/* ------------------------------------------------------------------ */

export function orderSeadAntiRadiationStrike(
  session: WarSimSession,
  attackerEntityId: string,
  targetRadarEntityId: string
): {
  session: WarSimSession;
  status: 'launched' | 'failed';
  summary: string;
} {
  const attacker = session.entities.find((e) => e.id === attackerEntityId);
  const targetRadar = session.entities.find((e) => e.id === targetRadarEntityId);

  if (!attacker || attacker.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Attacker aircraft unavailable or destroyed' };
  }
  if (!targetRadar || targetRadar.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Target radar battery destroyed' };
  }

  const distKm = distanceKm(attacker.lngLat, targetRadar.lngLat);
  const armRangeKm = 240; // AGM-88G AARGM-ER / Kh-31PD operational reach

  if (distKm > armRangeKm) {
    return {
      session,
      status: 'failed',
      summary: `Target radar out of ARM standoff range (${distKm.toFixed(0)} km > max ${armRangeKm} km)`,
    };
  }

  const isRadiating = targetRadar.patrolOrder?.emcon !== 'passive';
  const armSpeedKmh = 4200; // ~Mach 3.5 supersonic high-speed anti-radiation missile
  const tFlySec = Math.max(15, Math.round((distKm / armSpeedKmh) * 3600));

  const armMissile: MissileFlyoutTrack = {
    id: `arm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    originLngLat: attacker.lngLat,
    targetLngLat: targetRadar.lngLat,
    currentLngLat: attacker.lngLat,
    attackerEntityId: attacker.id,
    targetEntityId: targetRadar.id,
    attackerIso: attacker.iso,
    targetIso: targetRadar.iso,
    weaponName: 'AGM-88G AARGM-ER Anti-Radiation Missile',
    weaponCategory: 'cruise',
    speedKmh: armSpeedKmh,
    startSimTimeSec: session.simTimeSec,
    etaSimTimeSec: session.simTimeSec + tFlySec,
    isIntercepted: false,
    progress: 0.0,
    isAntiRadiation: true,
    interceptorPk: isRadiating ? 0.92 : 0.55,
  };

  const isPlayer = attacker.iso === session.playerIso;
  const newEvents: SimBattleEvent[] = [
    ...session.eventLog,
    {
      id: `evt-arm-launch-${Date.now()}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: `${Math.floor(session.simTimeSec / 60)}m`,
      faction: isPlayer ? 'player' : 'enemy',
      type: 'strike',
      title: `⚡ SEAD Strike Launched: ${attacker.name}`,
      detail: `${attacker.name} fired High-Speed Anti-Radiation Missile (AARGM-ER) targeting ${targetRadar.name} active radar emitter. Standoff distance: ${distKm.toFixed(0)}km.`,
      lngLat: attacker.lngLat,
    },
  ];

  return {
    session: {
      ...session,
      activeMissiles: [...session.activeMissiles, armMissile],
      eventLog: newEvents.slice(-200),
    },
    status: 'launched',
    summary: `SEAD Anti-Radiation missile launched against ${targetRadar.name}`,
  };
}

/* ------------------------------------------------------------------ */
/* 4. After-Action Electronic Warfare & SEAD Combat Reporting         */
/* ------------------------------------------------------------------ */

export function createEwCombatReport(
  session: WarSimSession
): NonNullable<CombatReport['ewDetails']> {
  const entities = session.entities || [];
  const activeJammers = entities.filter((e) => e.ewState && e.ewState.mode !== 'off');
  const jammedRadars = entities.filter((e) => e.isRadarJammed);
  const gpsDeniedMissiles = (session.activeMissiles || []).filter((m) => m.isGpsDenied || (m.insDriftErrorM && m.insDriftErrorM > 0));

  let ewAssessment = 'Electromagnetic spectrum remained uncontested with active radars operating at uninhibited nominal reach.';
  if (activeJammers.length > 0 || jammedRadars.length > 0) {
    ewAssessment = `Heavy Electronic Attack (EA): ${activeJammers.length} dedicated EW aircraft/jammers deployed directional noise jamming, suppressing ${jammedRadars.length} hostile radar installations and forcing precision munitions into GPS-denied INS drift.`;
  }

  const avgDrift = gpsDeniedMissiles.length > 0
    ? gpsDeniedMissiles.reduce((sum, m) => sum + (m.insDriftErrorM || 0), 0) / gpsDeniedMissiles.length
    : 0;

  return {
    radarsJammedCount: jammedRadars.length,
    jammingSortiesCount: activeJammers.length,
    gpsDeniedStrikesCount: gpsDeniedMissiles.length,
    averageInsDriftM: Number(avgDrift.toFixed(1)),
    antiRadiationStrikesCount: (session.activeMissiles || []).filter((m) => m.isAntiRadiation).length,
    antiRadiationHitsCount: (session.activeMissiles || []).filter((m) => m.isAntiRadiation && m.progress >= 0.98).length,
    ewAssessment,
    ewEvents: activeJammers.map((j) => ({
      platformName: j.name,
      ewAction: '⚡ Directional Radar Noise Jamming & GPS Denial',
      targetName: j.ewState?.jammingTargetLngLat ? 'Designated Radar Sector' : 'Air Defense Grid',
      simTimeSec: session.simTimeSec,
    })),
  };
}
