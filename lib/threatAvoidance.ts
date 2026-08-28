/**
 * Tactical Threat Avoidance & Visual Flight Corridor Routing Engine.
 *
 * Implements:
 * 1. Gathering hostile SAM & early-warning radar threat envelopes from known intelligence.
 * 2. Multi-leg flight corridor evaluation with distance, ETE/TOT, and threat penetration checks.
 * 3. Autonomous optimal threat-avoidance dogleg route generation around hostile air-defense bubbles.
 */

import { distanceKm, interpolate, bearingDeg } from './geo';
import { type WarSimSession, type SimEntity, type SimBase } from './warSimTypes';
import { type SystemSpec, domainOf } from './specs';
import { isNavalCombatant } from './navalEngagement';
import { isGroundCombatUnit } from './warSimRules';

export interface SAMThreatZone {
  id: string;
  name: string;
  iso: string;
  lngLat: [number, number];
  samRangeKm: number;
  radarRangeKm: number;
  type: 'area_sam' | 'point_defense' | 'early_warning';
  threatSeverity: 'high' | 'medium' | 'low';
  color: string;
}

export interface FlightLegDetail {
  legIndex: number;
  from: [number, number];
  to: [number, number];
  distanceKm: number;
  flightSec: number;
  threatLevel: 'safe' | 'caution' | 'danger';
  penetratingThreats: string[];
}

export interface FlightCorridorEvaluation {
  totalDistanceKm: number;
  estimatedFlightSec: number;
  threatLevel: 'safe' | 'caution' | 'danger';
  legs: FlightLegDetail[];
  threatSummary: string;
  interceptRiskPct: number;
}

/**
 * Extracts all known/detected hostile air defense batteries, combatants, and bases
 * that project surface-to-air missile (SAM) or radar search envelopes.
 */
export function getKnownHostileThreatZones(
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): SAMThreatZone[] {
  const isPlayer = session.activeFaction === 'player';
  const friendlyIso = isPlayer ? session.playerIso : session.enemyIso;
  const hostileIso = isPlayer ? session.enemyIso : session.playerIso;

  const threatZones: SAMThreatZone[] = [];

  // 1. Hostile Deployed Entities (From Fog of War Contacts or direct state)
  session.entities.forEach((entity) => {
    if (entity.iso !== hostileIso || entity.status === 'destroyed' || entity.status === 'docked') return;

    const spec = systemsLibrary.find((s) => s.id === entity.systemId);
    const weapons = (entity.customWeapons && entity.customWeapons.length > 0)
      ? entity.customWeapons
      : (spec?.weapons || []);

    // Find max air-defense SAM engagement range
    const samWeapons = weapons.filter((w) => w.engages?.includes('air') && w.rangeKm > 0);
    const maxSamRangeKm = samWeapons.reduce((max, w) => Math.max(max, w.rangeKm), 0);
    const radarRangeKm = spec?.sensor?.detectionKm ?? (isGroundCombatUnit(entity.typeId) ? 25 : 200);

    if (maxSamRangeKm > 0 || radarRangeKm > 60) {
      const isAreaSam = maxSamRangeKm >= 50;
      const isPointDefense = maxSamRangeKm > 0 && maxSamRangeKm < 50;

      threatZones.push({
        id: entity.id,
        name: entity.name,
        iso: entity.iso,
        lngLat: entity.lngLat,
        samRangeKm: maxSamRangeKm,
        radarRangeKm,
        type: isAreaSam ? 'area_sam' : isPointDefense ? 'point_defense' : 'early_warning',
        threatSeverity: isAreaSam ? 'high' : isPointDefense ? 'medium' : 'low',
        color: isAreaSam ? '#D9534F' : isPointDefense ? '#FF9800' : '#FFD54F',
      });
    }
  });

  // 2. Hostile Bases (Airbases, Silos, Naval installations with organic SAM coverage)
  session.bases.forEach((base) => {
    if (base.iso !== hostileIso) return;

    const baseSamRange = base.type === 'airbase' ? 60 : base.type === 'silo_complex' ? 120 : base.type === 'naval_base' ? 45 : 20;
    const baseRadarRange = base.type === 'airbase' ? 220 : base.type === 'silo_complex' ? 300 : 140;

    threatZones.push({
      id: base.id,
      name: base.name,
      iso: base.iso,
      lngLat: base.lngLat,
      samRangeKm: baseSamRange,
      radarRangeKm: baseRadarRange,
      type: baseSamRange >= 50 ? 'area_sam' : 'point_defense',
      threatSeverity: baseSamRange >= 50 ? 'high' : 'medium',
      color: baseSamRange >= 50 ? '#D9534F' : '#FF9800',
    });
  });

  return threatZones;
}

/**
 * Checks whether a line segment [from, to] intersects a circular threat bubble.
 */
export function lineIntersectsCircle(
  from: [number, number],
  to: [number, number],
  center: [number, number],
  radiusKm: number
): { intersects: boolean; minDistanceKm: number } {
  const totalLegDist = distanceKm(from, to);
  if (totalLegDist === 0) {
    const d = distanceKm(from, center);
    return { intersects: d <= radiusKm, minDistanceKm: d };
  }

  // Sample points along leg
  const steps = Math.min(25, Math.max(8, Math.round(totalLegDist / 15)));
  let minDist = Infinity;

  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const p = interpolate(from, to, fraction);
    const d = distanceKm(p, center);
    if (d < minDist) {
      minDist = d;
    }
  }

  return {
    intersects: minDist <= radiusKm,
    minDistanceKm: minDist,
  };
}

/**
 * Evaluates the full flight corridor across all waypoints against hostile threat envelopes.
 */
export function evaluateFlightCorridor(
  waypoints: [number, number][],
  threatZones: SAMThreatZone[],
  speedKmh: number = 900
): FlightCorridorEvaluation {
  if (waypoints.length < 2) {
    return {
      totalDistanceKm: 0,
      estimatedFlightSec: 0,
      threatLevel: 'safe',
      legs: [],
      threatSummary: 'No flight corridor specified',
      interceptRiskPct: 0,
    };
  }

  let totalDistanceKm = 0;
  const legs: FlightLegDetail[] = [];
  let worstLevel: 'safe' | 'caution' | 'danger' = 'safe';
  let totalThreatPenetrations = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const legDist = distanceKm(from, to);
    totalDistanceKm += legDist;
    const legFlightSec = Math.round((legDist / speedKmh) * 3600);

    let legThreatLevel: 'safe' | 'caution' | 'danger' = 'safe';
    const penetratingThreats: string[] = [];

    for (const zone of threatZones) {
      // 1. Check Lethal SAM Engagement Range
      if (zone.samRangeKm > 0) {
        const check = lineIntersectsCircle(from, to, zone.lngLat, zone.samRangeKm);
        if (check.intersects) {
          legThreatLevel = 'danger';
          penetratingThreats.push(`${zone.name} (Lethal SAM: ${zone.samRangeKm}km)`);
          totalThreatPenetrations += 2;
        }
      }

      // 2. Check Early Warning Radar Detection Range (if not already in lethal danger)
      if (legThreatLevel !== 'danger' && zone.radarRangeKm > 0) {
        const check = lineIntersectsCircle(from, to, zone.lngLat, zone.radarRangeKm);
        if (check.intersects) {
          legThreatLevel = 'caution';
          penetratingThreats.push(`${zone.name} (Radar Sweep: ${zone.radarRangeKm}km)`);
          totalThreatPenetrations += 1;
        }
      }
    }

    if (legThreatLevel === 'danger') worstLevel = 'danger';
    else if (legThreatLevel === 'caution' && worstLevel !== 'danger') worstLevel = 'caution';

    legs.push({
      legIndex: i + 1,
      from,
      to,
      distanceKm: legDist,
      flightSec: legFlightSec,
      threatLevel: legThreatLevel,
      penetratingThreats,
    });
  }

  const estimatedFlightSec = Math.round((totalDistanceKm / speedKmh) * 3600);
  const interceptRiskPct = worstLevel === 'danger'
    ? Math.min(85, 45 + totalThreatPenetrations * 12)
    : worstLevel === 'caution'
      ? Math.min(30, 10 + totalThreatPenetrations * 5)
      : 5;

  let threatSummary = '';
  if (worstLevel === 'safe') {
    threatSummary = '🟢 Safe Corridor: Flight path avoids all known hostile SAM and radar bubbles.';
  } else if (worstLevel === 'caution') {
    threatSummary = `🟡 Caution (Radar Illuminated): Flight path intersects ${totalThreatPenetrations} early warning radar sweeps. Hostiles may detect ingress.`;
  } else {
    threatSummary = `🔴 High Risk (Lethal SAM Zone): Flight path penetrates ${totalThreatPenetrations} active SAM engagement envelopes. Interception probability: ${interceptRiskPct}%.`;
  }

  return {
    totalDistanceKm,
    estimatedFlightSec,
    threatLevel: worstLevel,
    legs,
    threatSummary,
    interceptRiskPct,
  };
}

/**
 * Autonomous Optimal Dogleg Route Generator:
 * Takes an origin and target coordinate, identifies intersecting SAM threat envelopes,
 * and generates waypoint doglegs to route around them with a safe 20 km standoff buffer.
 */
export function generateOptimalThreatAvoidanceRoute(
  origin: [number, number],
  target: [number, number],
  threatZones: SAMThreatZone[],
  platformSpeedKmh: number = 900
): [number, number][] {
  const directDist = distanceKm(origin, target);
  if (directDist < 10) return [origin, target];

  // Find all SAM threat zones that intersect the direct path
  const blockingZones = threatZones.filter((zone) => {
    if (zone.samRangeKm <= 0) return false;
    const { intersects } = lineIntersectsCircle(origin, target, zone.lngLat, zone.samRangeKm);
    return intersects;
  });

  if (blockingZones.length === 0) {
    // Direct path is already clear!
    return [origin, target];
  }

  // Sort blocking zones by distance from origin
  blockingZones.sort((a, b) => distanceKm(origin, a.lngLat) - distanceKm(origin, b.lngLat));

  const route: [number, number][] = [origin];

  for (const zone of blockingZones) {
    const standoffRadiusKm = zone.samRangeKm + 20; // 20 km safety buffer outside lethal SAM ring
    const centerBearing = bearingDeg(origin, zone.lngLat);
    const directBearing = bearingDeg(origin, target);

    // Compute two flanking dogleg waypoint candidates (Left flank vs Right flank)
    const angleOffsetDeg = 55; // Tangential avoidance offset angle
    const leftBearing = (centerBearing - angleOffsetDeg + 360) % 360;
    const rightBearing = (centerBearing + angleOffsetDeg) % 360;

    // Helper: calculate destination point given origin, distance, and bearing
    const leftWp = getDestinationPoint(zone.lngLat, standoffRadiusKm, leftBearing);
    const rightWp = getDestinationPoint(zone.lngLat, standoffRadiusKm, rightBearing);

    // Pick candidate with shorter total dogleg distance to target
    const lastPoint = route[route.length - 1];
    const leftTotalDist = distanceKm(lastPoint, leftWp) + distanceKm(leftWp, target);
    const rightTotalDist = distanceKm(lastPoint, rightWp) + distanceKm(rightWp, target);

    const chosenWp = leftTotalDist <= rightTotalDist ? leftWp : rightWp;
    route.push(chosenWp);
  }

  route.push(target);
  return route;
}

/**
 * Calculates geographic coordinates given a start point, distance (km), and bearing (deg).
 */
function getDestinationPoint(
  startLngLat: [number, number],
  distanceKmVal: number,
  bearingDegVal: number
): [number, number] {
  const [startLng, startLat] = startLngLat;
  const R = 6371; // Earth radius in km
  const d = distanceKmVal / R;
  const brng = (bearingDegVal * Math.PI) / 180;
  const lat1 = (startLat * Math.PI) / 180;
  const lon1 = (startLng * Math.PI) / 180;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return [((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI];
}
