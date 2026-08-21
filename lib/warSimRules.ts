/**
 * War Simulation Operational Rules, Base Stationing & Kinematic Formulas
 *
 * Implements the core logical constraints for base anchoring, entity stationing,
 * fuel consumption, and transit time calculations.
 */

import { type Domain, UNIT_BY_ID } from './warGames';
import { type BaseType, type SimBase, type SimEntity } from './warSimTypes';
import { type SystemSpec, domainOf } from './specs';

/* ------------------------------------------------------------------ */
/* 1. Base Stationing & Compatibility Rules                           */
/* ------------------------------------------------------------------ */

export interface StationingCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks whether a given military platform type or domain is compatible
 * to be stationed at a specific base installation.
 */
export function canStationAtBase(
  baseType: BaseType,
  systemOrType: { domain: Domain; typeId: string }
): StationingCheckResult {
  const { domain, typeId } = systemOrType;

  switch (baseType) {
    case 'airbase':
      if (domain === 'air') {
        return { allowed: true };
      }
      if (typeId === 'sam-launcher' || typeId === 'radar' || typeId === 'command') {
        return { allowed: true }; // Base air defense & radar
      }
      if (domain === 'sea' || domain === 'sub') {
        return { allowed: false, reason: 'Airbases cannot host naval warships or submarines.' };
      }
      if (domain === 'ground' && typeId !== 'special-forces') {
        return { allowed: false, reason: 'Ground combat formations must be stationed at an Army Base or HQ.' };
      }
      return { allowed: true };

    case 'naval_base':
      if (domain === 'sea' || domain === 'sub') {
        return { allowed: true };
      }
      if (typeId === 'attack-heli' || typeId === 'transport-heli' || typeId === 'mpa') {
        return { allowed: true }; // Naval aviation
      }
      if (typeId === 'coastal-missile' || typeId === 'sam-launcher' || typeId === 'radar') {
        return { allowed: true }; // Port defense
      }
      return { allowed: false, reason: 'Naval ports are restricted to maritime vessels and port air defense.' };

    case 'carrier_group':
      if (typeId === 'fighter' || typeId === 'strike' || typeId === 'awacs' || typeId === 'attack-heli' || typeId === 'transport-heli') {
        return { allowed: true }; // Carrier air wing
      }
      return { allowed: false, reason: 'Only carrier-capable combat aircraft and helicopters can embark on a Carrier Group.' };

    case 'army_base':
      if (domain === 'ground') {
        return { allowed: true };
      }
      if (typeId === 'attack-heli' || typeId === 'transport-heli' || typeId === 'uav') {
        return { allowed: true }; // Army aviation & tactical drones
      }
      if (typeId === 'sam-launcher' || typeId === 'radar' || typeId === 'command') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Army bases cannot host fixed-wing fighter/bomber squadrons or naval ships.' };

    case 'silo_complex':
      if (typeId === 'silo' || typeId === 'missile' || typeId === 'radar' || typeId === 'command') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Silo complexes are reserved for strategic missile forces.' };

    default:
      return { allowed: true };
  }
}

/**
 * Returns default maximum platform holding capacity for each base type.
 */
export function defaultBaseCapacity(type: BaseType): number {
  switch (type) {
    case 'airbase':
      return 36; // 3 squadrons (12 each)
    case 'naval_base':
      return 8;  // 8 warships / submarines
    case 'carrier_group':
      return 48; // Carrier Air Wing (CVW)
    case 'army_base':
      return 24; // 24 battalions / batteries
    case 'silo_complex':
      return 12; // 12 ICBM silos / TELs
  }
}

/* ------------------------------------------------------------------ */
/* 2. Fuel, Range & Kinematics Calculations                           */
/* ------------------------------------------------------------------ */

/**
 * Calculates physical transit duration in seconds along a given geodesic distance.
 */
export function calculateTransitDurationSec(distanceKm: number, speedKmh: number): number {
  const safeSpeed = Math.max(50, speedKmh);
  const hours = distanceKm / safeSpeed;
  return Math.round(hours * 3600);
}

/**
 * Calculates fuel burn percentage for a given distance based on platform combat radius.
 * (Combat radius represents maximum one-way distance with 50% fuel burn for return).
 */
export function calculateFuelBurnPct(
  distanceKm: number,
  combatRadiusKm: number,
  isLoiteringSec: number = 0,
  speedKmh: number = 800
): number {
  if (combatRadiusKm <= 0) return 0;
  // Total round-trip range is ~2x combat radius
  const totalRangeKm = combatRadiusKm * 2;
  
  // Transit fuel cost
  const transitPct = (distanceKm / totalRangeKm) * 100;

  // Loiter fuel cost (loitering burns fuel at cruise rate)
  const loiterDistanceEquivalentKm = (isLoiteringSec / 3600) * (speedKmh * 0.7);
  const loiterPct = (loiterDistanceEquivalentKm / totalRangeKm) * 100;

  return Math.min(100, Math.max(0, transitPct + loiterPct));
}

/**
 * Returns the Bingo Fuel threshold percentage required to safely return home from
 * the current distance back to base.
 */
export function calculateBingoFuelThreshold(distanceToBaseKm: number, combatRadiusKm: number): number {
  if (combatRadiusKm <= 0) return 15; // 15% emergency reserve
  const totalRangeKm = combatRadiusKm * 2;
  const returnCostPct = (distanceToBaseKm / totalRangeKm) * 100;
  const safetyReservePct = 10; // 10% reserve for holding/divert
  return Math.min(95, returnCostPct + safetyReservePct);
}
