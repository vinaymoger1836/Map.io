/**
 * Space Layer: Low Earth Orbit (LEO) Reconnaissance & Direct-Ascent ASAT Warfare
 *
 * Simulates:
 * 1. Low Earth Orbit (LEO) orbital mechanics and real-time Keplerian ground-tracks.
 * 2. Multi-spectrum Space ISR (Optical EO/IR, Synthetic Aperture Radar, and ELINT).
 * 3. Space-to-ground sensor swaths dynamically unmasking Fog of War (elevating to Tier 2 PID).
 * 4. Direct-Ascent Anti-Satellite (ASAT) kinetic interceptor launches and orbital hit-to-kill collisions.
 * 5. After-action Space Operations & ASAT combat reporting.
 */

import { distanceKm, destination, bearingDeg, interpolate } from './geo';
import {
  type SimSatellite,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type WarSimSession,
  type SimBattleEvent,
  type MissileFlyoutTrack,
  type CombatReport,
} from './warSimTypes';
import { defaultSatelliteSpecsFor, type SystemSpec } from './specs';

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const EARTH_ROTATION_DEG_PER_SEC = 360 / 86400; // ~0.0041667 deg/sec

/* ------------------------------------------------------------------ */
/* 1. Orbital Mechanics & Sub-Satellite Coordinate Calculations       */
/* ------------------------------------------------------------------ */

/**
 * Computes sub-satellite geographic coordinates [lng, lat] at a given simulation timestamp.
 */
export function calculateSatellitePosition(
  satellite: SimSatellite,
  simTimeSec: number
): [number, number] {
  const periodSec = Math.max(60, satellite.periodMin * 60);
  const meanMotionDegPerSec = 360 / periodSec;

  // Orbital phase angle (Argument of Latitude)
  const totalPhaseSec = simTimeSec + satellite.orbitPhaseOffsetSec;
  const uDeg = (meanMotionDegPerSec * totalPhaseSec) % 360;
  const uRad = toRad(uDeg);
  const incRad = toRad(satellite.inclinationDeg);

  // Spherical orbital geometry to Latitude
  const sinLat = Math.sin(incRad) * Math.sin(uRad);
  const lat = toDeg(Math.asin(Math.max(-1, Math.min(1, sinLat))));

  // Longitude with Earth rotation drift
  const y = Math.cos(incRad) * Math.sin(uRad);
  const x = Math.cos(uRad);
  const alphaDeg = toDeg(Math.atan2(y, x));

  const earthDriftDeg = EARTH_ROTATION_DEG_PER_SEC * simTimeSec;
  let lng = (alphaDeg - earthDriftDeg + (satellite.orbitPhaseOffsetSec * 0.1)) % 360;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;

  return [Number(lng.toFixed(4)), Number(lat.toFixed(4))];
}

/**
 * Pre-calculates an orbital ground-track curve over one full orbital period.
 */
export function generateOrbitalGroundTrack(
  satellite: SimSatellite,
  centerSimTimeSec: number,
  samples = 60
): [number, number][] {
  const periodSec = Math.max(60, satellite.periodMin * 60);
  const halfPeriod = periodSec / 2;
  const dt = periodSec / samples;

  const points: [number, number][] = [];
  for (let s = 0; s <= samples; s++) {
    const t = centerSimTimeSec - halfPeriod + s * dt;
    points.push(calculateSatellitePosition(satellite, t));
  }
  return points;
}

/**
 * Generates the 4-corner ground swath polygon projected by the satellite sensor.
 */
export function generateSwathFootprint(
  subSatLngLat: [number, number],
  headingDeg: number,
  swathWidthKm: number,
  swathLengthKm = 200
): [number, number][] {
  const halfWidth = swathWidthKm / 2;
  const halfLength = swathLengthKm / 2;

  const p1 = destination(subSatLngLat, halfWidth, (headingDeg + 90) % 360);
  const p2 = destination(subSatLngLat, halfWidth, (headingDeg + 270) % 360);

  const forwardCenter = destination(subSatLngLat, halfLength, headingDeg);
  const rearCenter = destination(subSatLngLat, halfLength, (headingDeg + 180) % 360);

  const corner1 = destination(rearCenter, halfWidth, (headingDeg + 270) % 360);
  const corner2 = destination(forwardCenter, halfWidth, (headingDeg + 270) % 360);
  const corner3 = destination(forwardCenter, halfWidth, (headingDeg + 90) % 360);
  const corner4 = destination(rearCenter, halfWidth, (headingDeg + 90) % 360);

  return [corner1, corner2, corner3, corner4, corner1];
}

/* ------------------------------------------------------------------ */
/* 2. Default Military Satellite Constellations Initializer           */
/* ------------------------------------------------------------------ */

export function createDefaultSatellites(
  playerIso: string,
  enemyIso: string,
  systemsLibrary: SystemSpec[] = []
): SimSatellite[] {
  const isBlue = (iso: string) => ['US', 'UA', 'IL', 'GB', 'DE', 'FR', 'PL', 'TW', 'JP'].includes(iso);

  const playerIsBlue = isBlue(playerIso);

  const blueSats: Omit<SimSatellite, 'faction'>[] = [
    {
      id: `sat-usa-kh11-${Date.now()}`,
      systemId: 'kh-11-keyhole',
      name: 'USA KH-11 Block IV Keyhole',
      iso: 'US',
      altitudeKm: 460,
      inclinationDeg: 97.4,
      periodMin: 94.2,
      sensorType: 'optical',
      swathWidthKm: 140,
      resolutionM: 0.1,
      currentLngLat: [25.0, 50.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 0,
    },
    {
      id: `sat-usa-topaz-${Date.now() + 1}`,
      systemId: 'topaz-sar',
      name: 'USA Topaz SAR-5 (FIA Radar)',
      iso: 'US',
      altitudeKm: 520,
      inclinationDeg: 97.8,
      periodMin: 95.1,
      sensorType: 'sar',
      swathWidthKm: 260,
      resolutionM: 0.5,
      currentLngLat: [35.0, 45.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 2800,
    },
    {
      id: `sat-usa-orion-${Date.now() + 2}`,
      systemId: 'orion-elint',
      name: 'USA Mentor/Orion Space SIGINT',
      iso: 'US',
      altitudeKm: 650,
      inclinationDeg: 63.4,
      periodMin: 98.0,
      sensorType: 'elint',
      swathWidthKm: 850,
      resolutionM: 5.0,
      currentLngLat: [45.0, 32.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 4200,
    },
  ];

  const redSats: Omit<SimSatellite, 'faction'>[] = [
    {
      id: `sat-ru-persona-${Date.now() + 3}`,
      systemId: 'persona-recon',
      name: 'Persona-3 Optical Recon',
      iso: 'RU',
      altitudeKm: 470,
      inclinationDeg: 97.4,
      periodMin: 94.4,
      sensorType: 'optical',
      swathWidthKm: 140,
      resolutionM: 0.2,
      currentLngLat: [30.0, 55.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 1500,
    },
    {
      id: `sat-ru-cosmos-${Date.now() + 4}`,
      systemId: 'cosmos-sar',
      name: 'Cosmos-2544 Spaceborne SAR',
      iso: 'RU',
      altitudeKm: 510,
      inclinationDeg: 97.6,
      periodMin: 95.0,
      sensorType: 'sar',
      swathWidthKm: 250,
      resolutionM: 0.6,
      currentLngLat: [40.0, 48.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 3600,
    },
    {
      id: `sat-cn-yaogan-${Date.now() + 5}`,
      systemId: 'yaogan-optical',
      name: 'Yaogan-33 SAR/Optical Constellation',
      iso: 'CN',
      altitudeKm: 500,
      inclinationDeg: 97.5,
      periodMin: 94.8,
      sensorType: 'sar',
      swathWidthKm: 280,
      resolutionM: 0.5,
      currentLngLat: [110.0, 30.0],
      groundTrack: [],
      groundSwathPolygon: [],
      status: 'operational',
      contactsDiscoveredCount: 0,
      orbitPhaseOffsetSec: 5000,
    },
  ];

  const assignedBlue: SimSatellite[] = blueSats.map((s) => ({
    ...s,
    faction: playerIsBlue ? 'player' : 'enemy',
  }));

  const assignedRed: SimSatellite[] = redSats.map((s) => ({
    ...s,
    faction: playerIsBlue ? 'enemy' : 'player',
  }));

  const combined = [...assignedBlue, ...assignedRed];

  // Initialize ground-tracks and current positions
  return combined.map((sat) => {
    const pos = calculateSatellitePosition(sat, 0);
    const nextPos = calculateSatellitePosition(sat, 15);
    const hdg = bearingDeg(pos, nextPos);
    return {
      ...sat,
      currentLngLat: pos,
      groundTrack: generateOrbitalGroundTrack(sat, 0, 40),
      groundSwathPolygon: generateSwathFootprint(pos, hdg, sat.swathWidthKm),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 3. Space Reconnaissance Sweep & Fog of War Ingestion Engine        */
/* ------------------------------------------------------------------ */

export function stepSpaceLayer(
  session: WarSimSession,
  dtSimSec: number,
  systemsLibrary: SystemSpec[] = []
): {
  updatedSatellites: SimSatellite[];
  spaceEvents: SimBattleEvent[];
} {
  const satellites = session.satellites || [];
  if (satellites.length === 0) {
    return { updatedSatellites: [], spaceEvents: [] };
  }

  const spaceEvents: SimBattleEvent[] = [];
  const simTime = session.simTimeSec;

  const updatedSatellites = satellites.map((sat) => {
    if (sat.status === 'destroyed') return sat;

    // 1. Advance Orbital Kinematics
    const currentPos = calculateSatellitePosition(sat, simTime);
    const nextPos = calculateSatellitePosition(sat, simTime + 20);
    const heading = bearingDeg(currentPos, nextPos);

    const swathPolygon = generateSwathFootprint(currentPos, heading, sat.swathWidthKm);
    const groundTrack = generateOrbitalGroundTrack(sat, simTime, 30);

    // 2. Perform Space-to-Ground Sensor Sweep
    const opposingFaction: 'player' | 'enemy' = sat.faction === 'player' ? 'enemy' : 'player';
    const targetsToScan = session.entities.filter(
      (e) => (sat.faction === 'player' ? e.iso !== session.playerIso : e.iso === session.playerIso) && e.status !== 'destroyed'
    );
    const basesToScan = session.bases.filter(
      (b) => (sat.faction === 'player' ? b.iso !== session.playerIso : b.iso === session.playerIso)
    );

    let newlyDiscoveredCount = sat.contactsDiscoveredCount;

    // Optical & SAR Ground Scanning
    for (const target of targetsToScan) {
      const distToSubSat = distanceKm(currentPos, target.lngLat);
      const isWithinSwathReach = distToSubSat <= sat.swathWidthKm / 2;

      // ELINT Cone reaches much wider (up to 800 km) for radiating active SAM emitters
      const isElintDetected = sat.sensorType === 'elint' && distToSubSat <= 800 && target.patrolOrder?.emcon === 'active';

      if (isWithinSwathReach || isElintDetected) {
        // Upgrade target contact in Fog of War to Tier 2 (PID)
        const contactList = sat.faction === 'player'
          ? session.fogOfWarContacts.playerContacts
          : session.fogOfWarContacts.enemyContacts;

        let contact = contactList.find((c) => c.targetEntityId === target.id);
        const wasPreviouslyUnidentified = !contact || contact.intelTier < 2;

        if (wasPreviouslyUnidentified) {
          newlyDiscoveredCount++;
          spaceEvents.push({
            id: `evt-sat-${Date.now()}-${sat.id.slice(-4)}-${target.id.slice(-4)}`,
            simTimeSec: simTime,
            timeFormatted: `${Math.floor(simTime / 60)}m`,
            faction: sat.faction,
            type: 'intel_pid',
            title: `🛰️ Space ISR Pass: ${sat.name}`,
            detail: `${sat.name} (${sat.sensorType.toUpperCase()} Orbit ${sat.altitudeKm}km) passed overhead and positively identified ${target.name} (${target.count} units) at ${target.lngLat[1].toFixed(2)}°N, ${target.lngLat[0].toFixed(2)}°E.`,
            lngLat: target.lngLat,
          });
        }
      }
    }

    return {
      ...sat,
      currentLngLat: currentPos,
      groundTrack,
      groundSwathPolygon: swathPolygon,
      contactsDiscoveredCount: newlyDiscoveredCount,
      lastScanSimTimeSec: simTime,
    };
  });

  return {
    updatedSatellites,
    spaceEvents,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Direct-Ascent Anti-Satellite (ASAT) Kinetic Interceptor Strike  */
/* ------------------------------------------------------------------ */

/**
 * Orders an exo-atmospheric Direct-Ascent ASAT missile strike against an orbiting satellite.
 */
export function orderAsatStrike(
  session: WarSimSession,
  launcherEntityId: string,
  targetSatelliteId: string
): {
  session: WarSimSession;
  status: 'launched' | 'failed';
  summary: string;
} {
  const launcher = session.entities.find((e) => e.id === launcherEntityId);
  const targetSat = (session.satellites || []).find((s) => s.id === targetSatelliteId);

  if (!launcher || launcher.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Launcher platform unavailable or destroyed' };
  }
  if (!targetSat || targetSat.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Target satellite is already destroyed or inactive' };
  }

  const distKm = distanceKm(launcher.lngLat, targetSat.currentLngLat);
  const maxAsatRangeKm = 1400; // SM-3 Block IIA / PL-19 Nudol maximum exo-atmospheric reach

  if (distKm > maxAsatRangeKm) {
    return {
      session,
      status: 'failed',
      summary: `Target satellite is out of ASAT engagement range (${distKm.toFixed(0)} km > max ${maxAsatRangeKm} km)`,
    };
  }

  const asatSpeedKmh = 18500; // ~Mach 15 hypersonic exo-atmospheric kinetic kill vehicle
  const tFlySec = Math.max(30, Math.round((Math.sqrt(distKm ** 2 + targetSat.altitudeKm ** 2) / asatSpeedKmh) * 3600));

  const asatMissile: MissileFlyoutTrack = {
    id: `asat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    originLngLat: launcher.lngLat,
    targetLngLat: targetSat.currentLngLat,
    currentLngLat: launcher.lngLat,
    attackerEntityId: launcher.id,
    targetEntityId: launcher.id,
    targetSatelliteId: targetSat.id,
    attackerIso: launcher.iso,
    targetIso: targetSat.iso,
    weaponName: 'Exo-Atmospheric ASAT Kinetic Interceptor',
    weaponCategory: 'asat',
    speedKmh: asatSpeedKmh,
    startSimTimeSec: session.simTimeSec,
    etaSimTimeSec: session.simTimeSec + tFlySec,
    isIntercepted: false,
    progress: 0.0,
    interceptorPk: 0.88,
  };

  const isPlayer = launcher.iso === session.playerIso;
  const newEvents: SimBattleEvent[] = [
    ...session.eventLog,
    {
      id: `evt-asat-launch-${Date.now()}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: `${Math.floor(session.simTimeSec / 60)}m`,
      faction: isPlayer ? 'player' : 'enemy',
      type: 'strike',
      title: `🚀 ASAT Missile Launch: ${launcher.name}`,
      detail: `${launcher.name} launched Direct-Ascent Anti-Satellite Interceptor at hostile ${targetSat.name} in ${targetSat.altitudeKm}km Low Earth Orbit. ETA to orbital impact: ${tFlySec}s.`,
      lngLat: launcher.lngLat,
    },
  ];

  return {
    session: {
      ...session,
      activeMissiles: [...session.activeMissiles, asatMissile],
      eventLog: newEvents.slice(-200),
    },
    status: 'launched',
    summary: `ASAT missile launched successfully toward ${targetSat.name}`,
  };
}

/* ------------------------------------------------------------------ */
/* 5. After-Action Space Operations Reporting Generator               */
/* ------------------------------------------------------------------ */

export function createSpaceCombatReport(
  session: WarSimSession
): NonNullable<CombatReport['spaceDetails']> {
  const satellites = session.satellites || [];
  const operational = satellites.filter((s) => s.status === 'operational').length;
  const destroyed = satellites.filter((s) => s.status === 'destroyed').length;
  const totalDiscovered = satellites.reduce((sum, s) => sum + s.contactsDiscoveredCount, 0);

  let spaceAssessment = 'Orbital reconnaissance constellations maintained uninterrupted Low Earth Orbit surveillance.';
  if (destroyed > 0) {
    spaceAssessment = `Severe space conflict: ${destroyed} reconnaissance satellites neutralized via direct-ascent kinetic ASAT strikes, creating critical blind spots in theater space ISR.`;
  } else if (totalDiscovered > 0) {
    spaceAssessment = `Space ISR dominance established: Satellite constellations positively unmasked ${totalDiscovered} tactical formations and bases across the theater.`;
  }

  return {
    totalPasses: Math.floor(session.simTimeSec / (94 * 60)) + satellites.length,
    operationalSatellites: operational,
    destroyedSatellites: destroyed,
    targetsDiscoveredCount: totalDiscovered,
    asatInterceptsCount: destroyed,
    spaceAssessment,
    satelliteEvents: satellites.map((s) => ({
      satelliteName: s.name,
      sensorType: s.sensorType,
      event: s.status === 'destroyed' ? '💥 Neutralized by Direct-Ascent ASAT' : `✓ Operational in ${s.altitudeKm}km LEO (${s.contactsDiscoveredCount} contacts acquired)`,
      simTimeSec: s.lastScanSimTimeSec || session.simTimeSec,
    })),
  };
}
