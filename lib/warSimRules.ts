/**
 * War Simulation Operational Rules, Base Stationing & Kinematic Formulas
 *
 * Implements the core logical constraints for base anchoring, entity stationing,
 * fuel consumption, and transit time calculations.
 */

import { type Domain, UNIT_BY_ID } from './warGames';
import { type BaseType, type SimBase, type SimEntity } from './warSimTypes';
import { type SystemSpec, type WeaponFacet, domainOf } from './specs';

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

/**
 * Returns true if the typeId represents a land-based ground vehicle, armor, artillery, or infantry formation.
 */
export function isGroundCombatUnit(typeId: string): boolean {
  const t = typeId.toLowerCase();
  return (
    t.includes('tank') ||
    t.includes('mbt') ||
    t.includes('armor') ||
    t.includes('armour') ||
    t.includes('ifv') ||
    t.includes('apc') ||
    t.includes('infantry') ||
    t.includes('mech') ||
    t.includes('artillery') ||
    t.includes('mlrs') ||
    t.includes('special-forces') ||
    t.includes('engineer') ||
    t.includes('recon') ||
    t.includes('mobile-ad') ||
    t.includes('hq')
  );
}

/**
 * Returns true if the typeId represents stationary or emplaced surface-to-air missile batteries,
 * radar sites, early-warning stations, or missile silos.
 */
export function isStaticAirDefense(typeId: string): boolean {
  const t = typeId.toLowerCase();
  return (
    t.includes('sam') ||
    t.includes('radar') ||
    t.includes('silo') ||
    t.includes('early-warning') ||
    t.includes('air-defense') ||
    t.includes('patriot') ||
    t.includes('akash') ||
    t.includes('s-400') ||
    t.includes('s-300') ||
    t.includes('hq-9') ||
    t.includes('nasams') ||
    t.includes('iron-dome') ||
    t.includes('aster')
  );
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

/* ------------------------------------------------------------------ */
/* 3. Weapon Compatibility & Combat Engagement Verification           */
/* ------------------------------------------------------------------ */

/**
 * Checks whether a given weapon is capable of engaging a target of the specified domain.
 */
export function canWeaponEngageTarget(weapon: WeaponFacet, targetDomain: string): boolean {
  if (!weapon.engages || weapon.engages.length === 0) return true; // Generic weapon
  const domainLower = targetDomain.toLowerCase();

  if (domainLower === 'air') {
    return weapon.engages.includes('air');
  }
  if (domainLower === 'ground' || domainLower === 'site' || domainLower === 'land') {
    return weapon.engages.includes('ground') || weapon.engages.includes('surface');
  }
  if (domainLower === 'naval' || domainLower === 'surface' || domainLower === 'sea') {
    return weapon.engages.includes('surface') || weapon.engages.includes('ground');
  }
  if (domainLower === 'subsurface' || domainLower === 'sub') {
    return weapon.engages.includes('subsurface');
  }
  return weapon.engages.some((e) => e.toLowerCase() === domainLower);
}

/**
 * Checks whether a friendly unit is equipped with weapons capable of attacking a specific target domain.
 */
export function canEntityEngageTarget(
  entity: SimEntity,
  targetDomain: string,
  spec?: SystemSpec
): {
  canEngage: boolean;
  compatibleWeapons: WeaponFacet[];
  reason?: string;
} {
  if (entity.status === 'destroyed') {
    return { canEngage: false, compatibleWeapons: [], reason: 'Unit is destroyed' };
  }
  if (entity.status === 'in_repair') {
    return { canEngage: false, compatibleWeapons: [], reason: 'Unit is undergoing depot repairs' };
  }
  if (entity.status === 'turnaround') {
    return { canEngage: false, compatibleWeapons: [], reason: 'Unit is in turnaround/rearming' };
  }

  const isDockedAtBase = entity.status === 'docked';
  const weapons = (entity.customWeapons && entity.customWeapons.length > 0)
    ? entity.customWeapons
    : (spec?.weapons || []);

  if (weapons.length === 0 && !isDockedAtBase) {
    return { canEngage: false, compatibleWeapons: [], reason: 'Unit has no equipped armament (e.g. unarmed recon/tanker)' };
  }

  let compatible = weapons.filter((w) => canWeaponEngageTarget(w, targetDomain));

  // If currently docked at base, check if system specification has compatible loadout options
  if (compatible.length === 0 && isDockedAtBase && spec?.weapons) {
    compatible = spec.weapons.filter((w) => canWeaponEngageTarget(w, targetDomain));
  }

  // For multirole/strike/fighter/bomber airframes at base, allow loadout reconfiguration
  if (compatible.length === 0 && isDockedAtBase) {
    const isCombatPlatform = [
      'fighter',
      'strike',
      'multirole',
      'interceptor',
      'bomber',
      'strategic-bomber',
      'uav',
      'drone',
      'attack-heli',
      'destroyer',
      'frigate',
      'corvette',
      'cruiser',
      'submarine',
      'ssn',
      'ssbn',
      'artillery',
      'mlrs',
    ].includes(entity.typeId);

    if (isCombatPlatform) {
      return {
        canEngage: true,
        compatibleWeapons: weapons.length > 0 ? weapons : (spec?.weapons || []),
      };
    }
  }

  if (compatible.length === 0) {
    const isAirOnly = weapons.every((w) => w.engages && w.engages.every((e) => e === 'air'));
    const isGroundOnly = weapons.every((w) => w.engages && w.engages.every((e) => e === 'ground' || e === 'surface'));

    let reason = `No compatible munitions for ${targetDomain.toUpperCase()} targets.`;
    if (isAirOnly) reason = `Air-to-Air loadout only (airborne unit cannot engage ${targetDomain} targets without re-arming at base).`;
    if (isGroundOnly && targetDomain === 'air') reason = `Air-to-Ground loadout only (cannot intercept Air targets while airborne).`;

    return { canEngage: false, compatibleWeapons: [], reason };
  }

  const withAmmo = compatible.filter((w) => w.magazine === undefined || w.magazine > 0);
  if (withAmmo.length === 0 && !isDockedAtBase) {
    return {
      canEngage: false,
      compatibleWeapons: [],
      reason: 'All compatible munitions have been expended. RTB required to replenish armament.',
    };
  }

  return { canEngage: true, compatibleWeapons: withAmmo.length > 0 ? withAmmo : compatible };
}
