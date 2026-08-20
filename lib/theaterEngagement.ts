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

import {
  distanceKm,
  interpolate,
  greatCirclePath,
  crossing,
  routeTotalDistanceKm,
  splitRouteAtDistance,
  routeCrossing,
  multiLegGreatCirclePath,
  interpolateRouteDistance,
} from './geo';
import { effectiveSpec, type MunitionCatalogue } from './munitions';
import {
  domainOf,
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
import {
  assessNavalCombat,
  isNavalCombatant,
  isSubsurfaceUnit,
  type NavalAssessment,
} from './navalEngagement';
import {
  assessBallisticMissileDefense,
  type BallisticDefenseAssessment,
} from './ballisticEngagement';

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
  artilleryDefenders: { unit: DeployedUnit; spec: SystemSpec; rangeKm: number; weaponName: string; maxMagazine: number; hasIsrSupport: boolean }[];
  casDefenders: { unit: DeployedUnit; spec: SystemSpec; combatRadiusKm: number; weaponName: string }[];
}

export type GroundTerrainType = 'open' | 'desert' | 'urban' | 'forest' | 'mountain' | 'stronghold';

export interface GroundTerrainModifiers {
  name: string;
  description: string;
  armorMult: number; // Attack power & protection multiplier for tanks and IFVs
  infantryDefenseMult: number; // Defensive multiplier for infantry/special forces
  sofAdvantageMult: number; // Ambush / lethality multiplier for special forces
  fortificationBonus: number; // Extra protection for dug-in/stronghold defenders
  casObstruction: number; // Penalty to unguided airstrikes (0 = clear, 0.4 = high cover)
}

export const GROUND_TERRAIN_CONFIG: Record<GroundTerrainType, GroundTerrainModifiers> = {
  open: {
    name: 'Open Plains',
    description: 'Flat open fields and steppe. Maximum line of sight; armor and mechanized autocannons dominate.',
    armorMult: 1.5,
    infantryDefenseMult: 0.6,
    sofAdvantageMult: 0.9,
    fortificationBonus: 1.0,
    casObstruction: 0.0,
  },
  desert: {
    name: 'Desert Terrain',
    description: 'Arid sandy expanses with zero natural cover. Thermal optics and direct-fire tank guns excel.',
    armorMult: 1.6,
    infantryDefenseMult: 0.5,
    sofAdvantageMult: 0.8,
    fortificationBonus: 1.0,
    casObstruction: 0.0,
  },
  urban: {
    name: 'Urban / Built-up Area',
    description: 'Dense multi-story structures, basements, and narrow chokepoints. Heavy armor vulnerable to roof ATGMs.',
    armorMult: 0.6,
    infantryDefenseMult: 2.5,
    sofAdvantageMult: 2.0,
    fortificationBonus: 2.0,
    casObstruction: 0.4,
  },
  forest: {
    name: 'Dense Forest / Woods',
    description: 'Concealed tree canopies and limited fields of fire. High infantry & special forces ambush effectiveness.',
    armorMult: 0.75,
    infantryDefenseMult: 1.8,
    sofAdvantageMult: 2.2,
    fortificationBonus: 1.4,
    casObstruction: 0.35,
  },
  mountain: {
    name: 'Mountainous / Rugged',
    description: 'Steep terrain and restricted passes. Road-bound vehicles heavily canalized; high-ground advantage.',
    armorMult: 0.5,
    infantryDefenseMult: 2.0,
    sofAdvantageMult: 1.7,
    fortificationBonus: 1.8,
    casObstruction: 0.25,
  },
  stronghold: {
    name: 'Fortified Base / Bunkers',
    description: 'Reinforced concrete bunkers, trench lines, and prepared firing slits. Heavy direct fire or bombardment required.',
    armorMult: 1.0,
    infantryDefenseMult: 3.0,
    sofAdvantageMult: 1.3,
    fortificationBonus: 3.0,
    casObstruction: 0.5,
  },
};

export function getUnitPersonnelHeadcount(
  unit: DeployedUnit,
  spec?: SystemSpec
): { total: number; crewPerUnit: number; dismountsPerUnit: number } {
  const typeId = (unit.kind === 'unit' ? unit.typeId : 'formation').toLowerCase();
  const count = unit.kind === 'unit' ? Math.max(1, unit.count || 1) : Math.max(1, totalStrength(unit.composition));
  const specCrew = spec?.platform?.crew;
  const unitDomain = spec ? domainOf(spec) : undefined;

  if (typeId === 'special-forces' || typeId === 'sof') {
    return { total: count * 12, crewPerUnit: 0, dismountsPerUnit: 12 };
  }
  if (typeId === 'airborne' || typeId === 'paratroopers' || typeId === 'vdv') {
    return { total: count * 80, crewPerUnit: 0, dismountsPerUnit: 80 };
  }
  if (typeId === 'infantry' || typeId === 'motorized' || typeId === 'marines') {
    return { total: count * 100, crewPerUnit: 0, dismountsPerUnit: 100 };
  }
  if (typeId === 'mechanized' || typeId === 'ifv' || typeId === 'apc' || typeId.includes('bmp') || typeId.includes('bradley')) {
    const crew = specCrew ?? 3;
    const dismounts = 7;
    return { total: count * (crew + dismounts), crewPerUnit: crew, dismountsPerUnit: dismounts };
  }
  if (typeId === 'armour' || typeId === 'tank' || typeId === 'mbt' || typeId.includes('t-90') || typeId.includes('leopard') || typeId.includes('abrams')) {
    const crew = specCrew ?? 3;
    return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
  }
  if (typeId === 'artillery' || typeId === 'howitzer' || typeId === 'mlrs' || typeId.includes('caesar') || typeId.includes('paladin') || typeId.includes('smerch') || typeId.includes('himars')) {
    const crew = specCrew ?? 4;
    return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
  }
  if (typeId.includes('sam') || typeId.includes('radar')) {
    const crew = specCrew ?? 4;
    return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
  }
  if (unitDomain === 'sea' || typeId.includes('ship') || typeId === 'frigate' || typeId === 'destroyer') {
    const crew = specCrew ?? 150;
    return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
  }
  if (unitDomain === 'air' || typeId === 'fighter' || typeId === 'strike' || typeId === 'bomber') {
    const crew = specCrew ?? 1;
    return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
  }

  const crew = specCrew ?? 10;
  return { total: count * crew, crewPerUnit: crew, dismountsPerUnit: 0 };
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
  category: 'oca' | 'sead' | 'strike' | 'standoff' | 'asuw' | 'asw' | 'bmd' | 'ground' | 'cas';
  attackerUnitId: string;
  targetUnitId: string;
  weaponIndex: number;
  salvoSize: number;
  altitudeM: number;
  waypoints?: [number, number][];
  terrain?: GroundTerrainType;
}

export interface UnitPersistentState {
  unitId: string;
  initialCount: number;
  aliveCount: number;
  destroyedCount: number;
  status: 'intact' | 'damaged' | 'suppressed' | 'destroyed';
  /** Maps weapon index to current ready rounds remaining in magazine */
  magazines: Map<number, number>;
  initialPersonnel: number;
  alivePersonnel: number;
  kiaPersonnel: number;
  wiaPersonnel: number;
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
  navalAssessment?: NavalAssessment;
  bmdAssessment?: BallisticDefenseAssessment;
}

export interface TheaterAssessment {
  mainTargetId: string;
  mainTargetLabel: string;
  attackerIso: string;
  phases: PhaseReport[];
  primaryTargetStatus: 'destroyed' | 'damaged' | 'held';
  overallVerdict: string;
  overallHeadline: string;
  terrain?: GroundTerrainType;
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
  [
    'strike',
    'bomber',
    'fighter',
    'uav',
    'attack-heli',
    'missile',
    'silo',
    'destroyer',
    'cruiser',
    'frigate',
    'corvette',
    'carrier-ship',
    'carrier',
    'submarine',
    'ssbn',
    'mpa',
  ].includes(typeId);

export const specOf = (unit: DeployedUnit, ctx: BoardContext): SystemSpec | undefined => {
  if (unit.kind === 'unit') {
    const raw = systemById(ctx.systems, unit.systemId);
    if (raw) return effectiveSpec(raw, unit.loadout, ctx.munitions);

    const typeId = unit.typeId.toLowerCase();
    if (typeId === 'special-forces' || typeId === 'sof') {
      return {
        id: unit.systemId || unit.id,
        name: 'Special Forces Detachment',
        typeId: 'special-forces',
        platform: { speedKmh: 40, combatRadiusKm: 150, crew: 0 },
        weapons: [
          { name: 'Direct Action Assault & Carbines (5.56mm)', rangeKm: 3, salvo: 300, magazine: 3600, pk: 0.85, engages: ['ground'] },
          { name: 'Man-Portable ATGM (Javelin / NLAW)', rangeKm: 5, salvo: 2, magazine: 12, pk: 0.85, engages: ['ground'] },
          { name: 'Loitering Recon / Kamikaze FPV Drone', rangeKm: 25, salvo: 2, magazine: 12, pk: 0.90, engages: ['ground'] },
          { name: 'MANPADS Air Defense (Stinger / Igla)', rangeKm: 6, salvo: 2, magazine: 6, pk: 0.80, engages: ['air'] },
        ],
      } as SystemSpec;
    }
    if (typeId === 'airborne' || typeId === 'paratroopers' || typeId === 'vdv') {
      return {
        id: unit.systemId || unit.id,
        name: 'Airborne Paratrooper Company',
        typeId: 'airborne',
        platform: { speedKmh: 30, combatRadiusKm: 100, crew: 0 },
        weapons: [
          { name: 'Assault Rifles & Carbines (5.45mm / 5.56mm)', rangeKm: 3, salvo: 800, magazine: 16800, pk: 0.65, engages: ['ground'] },
          { name: 'Squad Automatic Weapons & MMG (7.62mm)', rangeKm: 3.5, salvo: 400, magazine: 5000, pk: 0.70, engages: ['ground'] },
          { name: 'Shoulder-Fired ATGM & RPG', rangeKm: 4, salvo: 4, magazine: 24, pk: 0.75, engages: ['ground'] },
          { name: 'MANPADS Air Defense (Stinger / Igla)', rangeKm: 6, salvo: 2, magazine: 8, pk: 0.70, engages: ['air'] },
        ],
      } as SystemSpec;
    }
    if (typeId === 'infantry' || typeId === 'motorized' || typeId === 'marines') {
      return {
        id: unit.systemId || unit.id,
        name: 'Infantry Company',
        typeId: 'infantry',
        platform: { speedKmh: 20, combatRadiusKm: 60, crew: 0 },
        weapons: [
          { name: 'Assault Rifles (5.56mm / 5.45mm)', rangeKm: 3, salvo: 1000, magazine: 21000, pk: 0.55, engages: ['ground'] },
          { name: 'Heavy & Medium Machine Guns (12.7mm / 7.62mm)', rangeKm: 3.5, salvo: 500, magazine: 6000, pk: 0.65, engages: ['ground'] },
          { name: 'Anti-Tank Guided Missile (ATGM / RPG-7)', rangeKm: 5, salvo: 4, magazine: 32, pk: 0.70, engages: ['ground'] },
          { name: '81 mm / 120 mm Company Mortar', rangeKm: 8, salvo: 6, magazine: 72, pk: 0.60, engages: ['ground'] },
          { name: 'MANPADS Air Defense (Stinger / Igla)', rangeKm: 6, salvo: 2, magazine: 8, pk: 0.65, engages: ['air'] },
        ],
      } as SystemSpec;
    }
    if (typeId === 'mech-infantry' || typeId === 'mechanized' || typeId === 'ifv' || typeId === 'apc') {
      return {
        id: unit.systemId || unit.id,
        name: 'Mechanised Infantry Company',
        typeId: 'mech-infantry',
        platform: { speedKmh: 70, combatRadiusKm: 400, crew: 3 },
        weapons: [
          { name: '30 mm / 25 mm Autocannon', rangeKm: 4, salvo: 30, magazine: 500, pk: 0.70, engages: ['ground'] },
          { name: 'Heavy Coaxial MG (7.62mm)', rangeKm: 2.5, salvo: 200, magazine: 4000, pk: 0.60, engages: ['ground'] },
          { name: 'Vehicle-Mounted ATGM (Kornet / TOW)', rangeKm: 5.5, salvo: 2, magazine: 16, pk: 0.80, engages: ['ground'] },
          { name: 'Dismounted Rifle Platoon Fire', rangeKm: 3, salvo: 500, magazine: 10500, pk: 0.55, engages: ['ground'] },
        ],
      } as SystemSpec;
    }
    if (typeId === 'armour' || typeId === 'tank' || typeId === 'mbt') {
      return {
        id: unit.systemId || unit.id,
        name: 'Main Battle Tank Platoon',
        typeId: 'armour',
        platform: { speedKmh: 65, combatRadiusKm: 450, crew: 3 },
        weapons: [
          { name: '120 mm / 125 mm Smoothbore Gun', rangeKm: 4, salvo: 4, magazine: 42, pk: 0.75, engages: ['ground'] },
          { name: 'Coaxial Machine Gun (7.62mm)', rangeKm: 2, salvo: 200, magazine: 2000, pk: 0.50, engages: ['ground'] },
          { name: 'Commander Heavy MG (12.7mm)', rangeKm: 2.5, salvo: 100, magazine: 1000, pk: 0.60, engages: ['ground'] },
        ],
      } as SystemSpec;
    }

    return {
      id: unit.systemId || unit.id,
      name: unit.typeId,
      typeId: unit.typeId,
      platform: { speedKmh: 50, combatRadiusKm: 200, crew: 0 },
      weapons: [
        { name: 'Standard Weapons', rangeKm: 10, salvo: 2, magazine: 20, pk: 0.60, engages: ['ground'] },
      ],
    } as SystemSpec;
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
  const artilleryDefenders: DefensiveUmbrella['artilleryDefenders'] = [];
  const casDefenders: DefensiveUmbrella['casDefenders'] = [];

  const hasIsrDroneOrRadar = sameNationUnits.some((u) => {
    const s = specOf(u, ctx);
    if (!s) return false;
    const typeId = (u.kind === 'unit' ? u.typeId : 'formation').toLowerCase();
    const dist = distanceKm(u.lngLat, target.lngLat);
    return (typeId.includes('drone') || typeId.includes('uav') || typeId.includes('radar') || typeId.includes('recon')) && dist <= 120;
  });

  for (const u of sameNationUnits) {
    const spec = specOf(u, ctx);
    if (!spec) continue;
    const distKm = distanceKm(u.lngLat, target.lngLat);
    const typeId = (u.kind === 'unit' ? u.typeId : 'formation').toLowerCase();

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

    // Early Warning / AEW&C Sensors & Drone Recon
    const detection = spec.sensor?.detectionKm ?? (typeId.includes('drone') || typeId.includes('uav') ? 80 : 0);
    if (detection >= distKm || spec.typeId === 'awacs' || spec.typeId === 'radar' || typeId.includes('drone') || typeId.includes('uav')) {
      sensorDefenders.push({ unit: u, spec, detectionKm: detection || 400 });
    }

    // Defending Tube Artillery & MLRS batteries covering the ground approach
    const artyWeapons = (spec.weapons ?? []).filter(
      (w) =>
        w.rangeKm &&
        w.rangeKm >= 5 &&
        (w.name?.toLowerCase().includes('howitzer') ||
          w.name?.toLowerCase().includes('mortar') ||
          w.name?.toLowerCase().includes('caesar') ||
          w.name?.toLowerCase().includes('paladin') ||
          w.name?.toLowerCase().includes('smerch') ||
          w.name?.toLowerCase().includes('grad') ||
          w.name?.toLowerCase().includes('himars') ||
          w.name?.toLowerCase().includes('rocket') ||
          w.name?.toLowerCase().includes('artillery') ||
          typeId.includes('artillery') ||
          typeId.includes('howitzer') ||
          typeId.includes('mlrs'))
    );

    if (artyWeapons.length > 0) {
      const maxArtyRange = Math.max(...artyWeapons.map((w) => w.rangeKm));
      if (maxArtyRange >= distKm || distKm <= 40) {
        const bestWeapon = artyWeapons[0];
        artilleryDefenders.push({
          unit: u,
          spec,
          rangeKm: maxArtyRange,
          weaponName: bestWeapon.name ?? 'Artillery Battery',
          maxMagazine: bestWeapon.magazine ?? 40,
          hasIsrSupport: hasIsrDroneOrRadar,
        });
      }
    }

    // Defending Close Air Support (CAS / Attack Helicopters) covering the position
    if (
      typeId.includes('attack-heli') ||
      typeId.includes('heli') ||
      typeId.includes('ka-52') ||
      typeId.includes('apache') ||
      typeId.includes('su-25') ||
      typeId.includes('a-10') ||
      typeId.includes('cas')
    ) {
      const casRadius = spec.platform?.combatRadiusKm ?? 300;
      if (casRadius >= distKm || distKm <= 350) {
        casDefenders.push({
          unit: u,
          spec,
          combatRadiusKm: casRadius,
          weaponName: spec.weapons?.[0]?.name ?? 'Close Air Support Weapons',
        });
      }
    }
  }

  return {
    target,
    targetSpec,
    samDefenders,
    capDefenders,
    sensorDefenders,
    artilleryDefenders,
    casDefenders,
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

    const manpower = getUnitPersonnelHeadcount(u, spec);

    unitStates.set(u.id, {
      unitId: u.id,
      initialCount: count,
      aliveCount: count,
      destroyedCount: 0,
      status: 'intact',
      magazines,
      initialPersonnel: manpower.total,
      alivePersonnel: manpower.total,
      kiaPersonnel: 0,
      wiaPersonnel: 0,
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
      const order: Record<string, number> = { oca: 1, sead: 2, asw: 3, asuw: 3, standoff: 3, strike: 4 };
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
          initialPersonnel: 10,
          alivePersonnel: 10,
          kiaPersonnel: 0,
          wiaPersonnel: 0,
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
          initialPersonnel: 10,
          alivePersonnel: 10,
          kiaPersonnel: 0,
          wiaPersonnel: 0,
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

      const attackerLabel = unitLabel(attackerUnit, ctx.formations, ctx.systems, allUnits);
      const phaseTargetLabel = unitLabel(targetUnit, ctx.formations, ctx.systems, allUnits);

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

      const isAirAttacker =
        attackerSpec.typeId === 'fighter' ||
        attackerSpec.typeId === 'strike' ||
        attackerSpec.typeId === 'bomber' ||
        attackerSpec.typeId === 'drone' ||
        attackerSpec.typeId === 'ew' ||
        domainOf(attackerSpec) === 'air';

      const waypoints = task.waypoints ?? [];
      const fullRoute: [number, number][] =
        waypoints.length > 0
          ? [attackerUnit.lngLat, ...waypoints, targetUnit.lngLat]
          : [attackerUnit.lngLat, targetUnit.lngLat];

      const totalDistKm = routeTotalDistanceKm(fullRoute);
      const isStandoff = isAirAttacker && (weapon.rangeKm ?? 0) > 0;
      const standoffDistKm = isStandoff ? Math.min(weapon.rangeKm, totalDistKm) : 0;
      const releaseDistKm = isStandoff ? Math.max(0, totalDistKm - standoffDistKm) : totalDistKm;
      const releaseLngLat =
        isStandoff && releaseDistKm > 0 && releaseDistKm < totalDistKm
          ? interpolateRouteDistance(fullRoute, releaseDistKm).coord
          : undefined;

      const { before: ingressRoute, after: munitionRoute } =
        isAirAttacker && releaseLngLat
          ? splitRouteAtDistance(fullRoute, releaseDistKm)
          : { before: fullRoute, after: fullRoute };

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

      // Target Spec and Domain classification
      const targetSpec = specOf(targetUnit, ctx);
      const isTargetNaval = targetSpec ? isNavalCombatant(targetSpec.typeId) : false;
      const isTargetSub = targetSpec ? isSubsurfaceUnit(targetSpec.typeId) : false;

      // Munition Domain & Interceptability Check
      const wNameLower = weaponName.toLowerCase();
      const isGroundDirectFire =
        wNameLower.includes('gun') ||
        wNameLower.includes('smoothbore') ||
        wNameLower.includes('cannon') ||
        wNameLower.includes('autocannon') ||
        wNameLower.includes('120 mm') ||
        wNameLower.includes('125 mm') ||
        wNameLower.includes('105 mm') ||
        wNameLower.includes('76 mm') ||
        wNameLower.includes('tank');

      const isTubeArtilleryOrMortar =
        wNameLower.includes('howitzer') ||
        wNameLower.includes('mortar') ||
        wNameLower.includes('155 mm') ||
        wNameLower.includes('152 mm') ||
        wNameLower.includes('122 mm');

      const isNonAirInterceptableGroundMunition =
        (isGroundDirectFire || isTubeArtilleryOrMortar) &&
        !wNameLower.includes('missile') &&
        !wNameLower.includes('guided') &&
        !wNameLower.includes('rocket');

      // Route to evaluate against defending air defense envelopes
      const activeEvaluationRoute = isAirAttacker && isStandoff ? munitionRoute : fullRoute;
      const corridorDistKm = routeTotalDistanceKm(activeEvaluationRoute);

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

      // Direct-fire tank cannon rounds and tube artillery cannot be intercepted by SAMs, fighters, or naval air-defense
      if (!isNonAirInterceptableGroundMunition) {
        for (const def of defenders) {
          // When engaging a naval combatant, the ship's defense is handled in assessNavalCombat
          if (isTargetNaval && def.id === targetUnit.id) continue;

        const defState = unitStates.get(def.id);
        if (!defState || defState.status === 'destroyed' || defState.aliveCount <= 0) continue;

        const defSpec = specOf(def, ctx);
        if (!defSpec) continue;

        // When target is a ship at sea, mainland ground SAMs far away cannot engage
        if (isTargetNaval) {
          const defDomain = domainOf(defSpec);
          if (defDomain === 'ground') {
            const distKm = routeTotalDistanceKm([def.lngLat, targetUnit.lngLat]);
            if (distKm > 40) continue; // Out of reach of coastal horizon
          }
        }

        // If defending CAP was neutralized/pinned and this unit is a fighter, skip
        if (capFightersPinnedInThisPhase && (defSpec.typeId === 'fighter' || defSpec.typeId === 'interceptor')) {
          continue;
        }

        const defWeapons = defSpec.weapons ?? [];
        for (let wIdx = 0; wIdx < defWeapons.length; wIdx++) {
          const defWeapon = defWeapons[wIdx];
          if (!defWeapon.rangeKm || defWeapon.rangeKm <= 0) continue;
          if (defWeapon.engages && !defWeapon.engages.includes('air')) continue;

          // A SAM battery can only engage targets within its actual radar detection reach (horizon-limited)
          const targetAltM = isStandoff || task.category === 'asuw' ? 25 : 5000;
          const detReach = effectiveDetectionKm(defSpec, targetAltM, 'medium', false);
          const maxEngagementReachKm = Math.min(defWeapon.rangeKm, detReach ?? defWeapon.rangeKm);
          if (maxEngagementReachKm <= 0) continue;

          // Check multi-waypoint geodesic crossing of this defender's envelope along the flight path
          const cross = routeCrossing(activeEvaluationRoute, def.lngLat, maxEngagementReachKm);
          if (!cross) continue;

          const interceptPos = interpolateRouteDistance(activeEvaluationRoute, cross.entryKm);
          const interceptLngLat = interceptPos.coord;
          const entryFraction = corridorDistKm > 0 ? cross.entryKm / corridorDistKm : 0.5;

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
      let navalAss: NavalAssessment | null = null;
      let bmdAss: BallisticDefenseAssessment | null = null;

      if (isTargetNaval || isTargetSub || task.category === 'asuw' || task.category === 'asw') {
        navalAss = assessNavalCombat(
          attackerUnit,
          targetUnit,
          task.weaponIndex,
          actualSalvo,
          allUnits,
          unitStates,
          ctx
        );
      } else {
        const isBallistic =
          task.category === 'bmd' ||
          attackerSpec.typeId === 'silo' ||
          attackerSpec.typeId === 'missile' ||
          weaponName.toLowerCase().includes('ballistic') ||
          weaponName.toLowerCase().includes('iskander') ||
          weaponName.toLowerCase().includes('atacms') ||
          weaponName.toLowerCase().includes('df-') ||
          weaponName.toLowerCase().includes('hgv') ||
          weaponName.toLowerCase().includes('kinzhal') ||
          weaponName.toLowerCase().includes('zircon');

        if (isBallistic) {
          bmdAss = assessBallisticMissileDefense(
            attackerUnit,
            targetUnit,
            task.weaponIndex,
            actualSalvo,
            allUnits,
            ctx
          );
        }
      }

      let hits = munitionsSurviving;
      let targetDestroyed = false;
      let targetSuppressed = false;
      let damageSummary = '';

      if (navalAss) {
        if (navalAss.kind === 'asuw') {
          totalIntercepted = navalAss.totalIntercepted + navalAss.totalDecoyed;
          hits = navalAss.totalImpacts;
          targetDestroyed = navalAss.flagshipDamage === 'sunk';
          targetSuppressed = navalAss.flagshipDamage === 'mission_kill';
          damageSummary = navalAss.verdict;

          for (const tier of navalAss.tierReports) {
            if (tier.missilesIntercepted > 0) {
              const frac =
                tier.tierNumber === 1 ? 0.45 : tier.tierNumber === 2 ? 0.65 : tier.tierNumber === 3 ? 0.82 : 0.94;
              phaseInterceptions.push({
                defenderUnitId: targetUnit.id,
                defenderLabel: `${phaseTargetLabel} (${tier.tierName})`,
                defenderLngLat: targetUnit.lngLat,
                interceptLngLat: interpolate(attackerUnit.lngLat, targetUnit.lngLat, frac),
                entryFraction: frac,
                roundsFired: tier.roundsExpended,
                kills: tier.missilesIntercepted,
              });
            }
          }

          if (navalAss.flagshipDamage === 'sunk') {
            targetState.status = 'destroyed';
            targetState.aliveCount = 0;
          } else if (navalAss.flagshipDamage === 'mission_kill') {
            targetState.status = 'suppressed';
          } else if (navalAss.flagshipDamage === 'superstructure_damaged') {
            targetState.status = 'damaged';
          }
        } else {
          totalIntercepted = navalAss.torpedoReport.torpedoesDecoyed + navalAss.torpedoReport.thermalLayerEvasions;
          hits = navalAss.torpedoReport.torpedoImpacts;
          targetDestroyed =
            navalAss.targetCasualty === 'keel_broken_sunk' ||
            navalAss.targetCasualty === 'pressure_hull_ruptured';
          targetSuppressed = navalAss.targetCasualty === 'flooding_controlled';
          damageSummary = navalAss.verdict;

          if (targetDestroyed) {
            targetState.status = 'destroyed';
            targetState.aliveCount = 0;
          } else if (targetSuppressed) {
            targetState.status = 'damaged';
          }
        }

        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+30m',
          title: navalAss.headline,
          detail: navalAss.verdict,
          badge: {
            text: navalAss.kind === 'asuw' ? (targetDestroyed ? 'Sunk' : hits > 0 ? `${hits} Hits` : 'Shield Held') : (targetDestroyed ? 'Sunk' : 'Torpedo Evaded'),
            variant: targetDestroyed ? 'loss' : hits > 0 ? 'success' : 'neutral',
          },
        });
      } else if (bmdAss) {
        totalIntercepted = bmdAss.totalIntercepted;
        hits = bmdAss.totalImpacts;
        targetDestroyed = bmdAss.targetDamageStatus === 'obliterated';
        targetSuppressed = bmdAss.targetDamageStatus === 'cratered_suppressed';
        damageSummary = bmdAss.verdict;

        for (const tier of bmdAss.tierReports) {
          if (tier.missilesIntercepted > 0) {
            const frac = tier.tierNumber === 1 ? 0.5 : tier.tierNumber === 2 ? 0.75 : 0.92;
            phaseInterceptions.push({
              defenderUnitId: targetUnit.id,
              defenderLabel: `${phaseTargetLabel} (${tier.tierName})`,
              defenderLngLat: targetUnit.lngLat,
              interceptLngLat: interpolate(attackerUnit.lngLat, targetUnit.lngLat, frac),
              entryFraction: frac,
              roundsFired: tier.interceptorsLaunched,
              kills: tier.missilesIntercepted,
            });
          }
        }

        if (targetDestroyed) {
          targetState.status = 'destroyed';
          targetState.aliveCount = 0;
        } else if (targetSuppressed) {
          targetState.status = 'suppressed';
        } else if (bmdAss.targetDamageStatus === 'superficial_damage') {
          targetState.status = 'damaged';
        }

        battleLog.push({
          id: nextEvt(),
          timeFormatted: 'T+30m',
          title: bmdAss.headline,
          detail: damageSummary,
          badge: {
            text: targetDestroyed ? 'Obliterated' : targetSuppressed ? 'Cratered' : hits > 0 ? 'Damaged' : 'BMD Held',
            variant: targetDestroyed ? 'loss' : hits > 0 ? 'loss' : 'success',
          },
        });
      } else if (hits > 0) {
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
          // Combined Arms Ground Assault vs Standoff / Airstrike on Objective
          const isGroundAttacker = domainOf(attackerSpec) === 'ground';
          const isGroundTarget = targetSpec ? domainOf(targetSpec) === 'ground' : false;

          const currentTerrain: GroundTerrainType = task.terrain ?? 'open';
          const terrainCfg = GROUND_TERRAIN_CONFIG[currentTerrain];

          if (isGroundAttacker && isGroundTarget) {
            const attType = (attackerUnit.kind === 'unit' ? attackerUnit.typeId : 'formation').toLowerCase();
            const tgtType = (targetUnit.kind === 'unit' ? targetUnit.typeId : 'formation').toLowerCase();

            const isAttArmor = attType === 'armour' || attType === 'tank' || attType === 'mbt' || attType === 'mechanized' || attType === 'ifv';
            const isTgtArmor = tgtType === 'armour' || tgtType === 'tank' || tgtType === 'mbt' || tgtType === 'mechanized' || tgtType === 'ifv';
            const isAttInfantry = attType === 'infantry' || attType === 'special-forces' || attType === 'airborne';
            const isTgtInfantry = tgtType === 'infantry' || tgtType === 'special-forces' || tgtType === 'airborne';
            const isTgtStronghold = currentTerrain === 'stronghold' || tgtType.includes('bunker') || tgtType.includes('stronghold') || tgtType.includes('base');

            // Ground Defensive Umbrella for the defending objective
            const objUmbrella = discoverDefensiveUmbrella(targetUnit, allUnits, ctx);

            // 1. Defending Artillery Counter-Battery & Retaliatory Barrage
            const activeArtyBatteries = objUmbrella.artilleryDefenders.filter((a) => {
              const st = unitStates.get(a.unit.id);
              return st && st.status !== 'destroyed' && st.aliveCount > 0 && (st.magazines.get(0) ?? 0) > 0;
            });

            const hasDefenderDroneIsr = objUmbrella.sensorDefenders.some((s) => {
              const st = unitStates.get(s.unit.id);
              return st && st.status !== 'destroyed' && st.aliveCount > 0;
            }) || objUmbrella.artilleryDefenders.some((a) => a.hasIsrSupport);

            if (activeArtyBatteries.length > 0) {
              const defendingBattery = activeArtyBatteries[0];
              const batteryState = unitStates.get(defendingBattery.unit.id);
              const batteryMag = batteryState?.magazines.get(0) ?? 12;
              const retSalvo = Math.min(6, batteryMag);
              if (batteryState) {
                batteryState.magazines.set(0, Math.max(0, batteryMag - retSalvo));
              }

              const retPk = hasDefenderDroneIsr ? 0.70 : 0.25;
              const retHits = Math.max(1, Math.round(retSalvo * retPk));
              const retCasualties = Math.min(attackerState.alivePersonnel, retHits * (isAttInfantry ? 8 : 3));
              const retKia = Math.round(retCasualties * 0.65);
              const retWia = Math.max(0, retCasualties - retKia);

              attackerState.kiaPersonnel += retKia;
              attackerState.wiaPersonnel += retWia;
              attackerState.alivePersonnel = Math.max(0, attackerState.alivePersonnel - retCasualties);

              battleLog.push({
                id: nextEvt(),
                timeFormatted: 'T+12m',
                title: `Defending Artillery Retaliation — ${unitLabel(defendingBattery.unit, ctx.formations, ctx.systems)}`,
                detail: `Automated counter-barrage: Fired ${retSalvo} × ${defendingBattery.weaponName} (${hasDefenderDroneIsr ? 'Drone-Guided Spotting' : 'Blind / Unobserved Fire'}). Inflicted ${retKia} KIA / ${retWia} WIA on advancing assault columns.`,
                badge: { text: `${retHits} Arty Impacts`, variant: hasDefenderDroneIsr ? 'sead' : 'neutral' },
              });
            }

            // 2. Defending Emergency Close Air Support (CAS) Scramble
            const activeCasAssets = objUmbrella.casDefenders.filter((c) => {
              const st = unitStates.get(c.unit.id);
              return st && st.status !== 'destroyed' && st.aliveCount > 0;
            });

            if (activeCasAssets.length > 0) {
              const casFlight = activeCasAssets[0];
              const attackerHasManpads = (attackerSpec.weapons ?? []).some(
                (w) =>
                  w.engages?.includes('air') ||
                  w.name?.toLowerCase().includes('manpads') ||
                  w.name?.toLowerCase().includes('stinger') ||
                  w.name?.toLowerCase().includes('igla')
              );

              if (attackerHasManpads) {
                battleLog.push({
                  id: nextEvt(),
                  timeFormatted: 'T+18m',
                  title: `Attacker MANPADS Air Defense — CAS Intercepted`,
                  detail: `Advancing vanguard fired shoulder-launched MANPADS (Stinger/Igla), engaging and driving off defending ${unitLabel(casFlight.unit, ctx.formations, ctx.systems)} before weapons release.`,
                  badge: { text: 'CAS Driven Off', variant: 'success' },
                });
              } else {
                const casAttCasualties = Math.min(attackerState.alivePersonnel, Math.max(4, Math.round(attackerState.alivePersonnel * 0.20)));
                const casKia = Math.round(casAttCasualties * 0.70);
                const casWia = Math.max(0, casAttCasualties - casKia);

                attackerState.kiaPersonnel += casKia;
                attackerState.wiaPersonnel += casWia;
                attackerState.alivePersonnel = Math.max(0, attackerState.alivePersonnel - casAttCasualties);

                battleLog.push({
                  id: nextEvt(),
                  timeFormatted: 'T+18m',
                  title: `Defending Close Air Support — ${unitLabel(casFlight.unit, ctx.formations, ctx.systems)}`,
                  detail: `Defending CAS aircraft conducted unhindered strafing & rocket runs on exposed assault vanguard (${casKia} attacker KIA / ${casWia} WIA).`,
                  badge: { text: 'CAS Strafing Run', variant: 'loss' },
                });
              }
            }

            // 3. Check if prior artillery or CAS suppressed the stronghold in earlier phases
            const priorBombardmentHit = phaseReports.some(
              (p) =>
                p.task.targetUnitId === targetUnit.id &&
                (p.task.category === 'strike' || p.task.category === 'cas' || p.weaponName.toLowerCase().includes('howitzer') || p.weaponName.toLowerCase().includes('rocket')) &&
                p.munitionsImpacted > 0
            );

            let effectiveFortification = isTgtStronghold ? (priorBombardmentHit ? 1.4 : terrainCfg.fortificationBonus) : terrainCfg.fortificationBonus;
            let attArmorBonus = isAttArmor ? terrainCfg.armorMult : 1.0;
            let tgtDefBonus = (isTgtInfantry ? terrainCfg.infantryDefenseMult : (isTgtArmor ? terrainCfg.armorMult : 1.0)) * effectiveFortification;

            // Tactical dynamics
            const isAmbushedInUrban = (currentTerrain === 'urban' || currentTerrain === 'forest') && isAttArmor && isTgtInfantry;
            const isOpenPlainsDominance = (currentTerrain === 'open' || currentTerrain === 'desert') && isAttArmor && isTgtInfantry;

            const basePk = weapon.pk ?? (isAttArmor ? 0.75 : 0.60);
            let effectivePk = basePk * (attArmorBonus / tgtDefBonus);
            if (isAmbushedInUrban) effectivePk *= 0.55;
            if (isOpenPlainsDominance) effectivePk *= 1.4;
            effectivePk = Math.max(0.15, Math.min(0.95, effectivePk));

            hits = Math.min(actualSalvo, Math.max(1, Math.round(actualSalvo * effectivePk)));

            const roundsToKillUnit = isTgtArmor ? 3 : (isTgtStronghold ? 6 : 2);
            const destroyedUnitsCount = Math.min(targetState.aliveCount, Math.floor(hits / roundsToKillUnit));

            if (destroyedUnitsCount >= targetState.aliveCount || hits >= targetState.aliveCount * roundsToKillUnit) {
              targetDestroyed = true;
              targetState.status = 'destroyed';
              targetState.aliveCount = 0;
              targetState.destroyedCount = targetState.initialCount;
            } else if (destroyedUnitsCount > 0) {
              targetState.status = 'damaged';
              targetState.aliveCount = Math.max(1, targetState.aliveCount - destroyedUnitsCount);
              targetState.destroyedCount += destroyedUnitsCount;
            } else if (hits >= 2) {
              targetState.status = 'damaged';
            }

            // Personnel Casualties (KIA / WIA)
            const tgtHeadcount = getUnitPersonnelHeadcount(targetUnit, targetSpec);
            const tgtSoldiersPerUnit = Math.round(tgtHeadcount.total / Math.max(1, targetState.initialCount));

            let defenderSoldiersHit = 0;
            if (targetDestroyed) {
              defenderSoldiersHit = targetState.alivePersonnel;
            } else {
              defenderSoldiersHit = Math.min(
                targetState.alivePersonnel,
                Math.round(destroyedUnitsCount * tgtSoldiersPerUnit + (hits * (isTgtInfantry ? 6 : 2)))
              );
            }

            const defKia = Math.round(defenderSoldiersHit * 0.65);
            const defWia = Math.max(0, defenderSoldiersHit - defKia);
            targetState.kiaPersonnel += defKia;
            targetState.wiaPersonnel += defWia;
            targetState.alivePersonnel = Math.max(0, targetState.alivePersonnel - defenderSoldiersHit);

            let attLossRate = 0;
            if (isAmbushedInUrban) {
              attLossRate = 0.20;
            } else if (isTgtStronghold && !priorBombardmentHit) {
              attLossRate = 0.15;
            } else {
              attLossRate = 0.04;
            }

            const attSoldiersHit = Math.min(
              attackerState.alivePersonnel,
              Math.max(0, Math.round(attackerState.alivePersonnel * attLossRate))
            );
            const attKia = Math.round(attSoldiersHit * 0.60);
            const attWia = Math.max(0, attSoldiersHit - attKia);
            attackerState.kiaPersonnel += attKia;
            attackerState.wiaPersonnel += attWia;
            attackerState.alivePersonnel = Math.max(0, attackerState.alivePersonnel - attSoldiersHit);

            let tacticalNarrative = '';
            if (isAmbushedInUrban) {
              tacticalNarrative = `🏙️ Urban Anti-Tank Ambush: Defending ${tgtType} exploited high-angle vantage points and basements, inflicting ${attKia} KIA on advancing forces before being overwhelmed.`;
            } else if (isOpenPlainsDominance) {
              tacticalNarrative = `🏜️ Open Terrain Thermal Dominance: Attacking heavy direct fire decimated exposed defensive positions across open fields (${defKia} enemy KIA).`;
            } else if (isTgtStronghold) {
              tacticalNarrative = priorBombardmentHit
                ? `🏰 Fortification Breached: Prior artillery preparation suppressed bunker firing ports, allowing assault squads to clear trenches with minimal casualties (${defKia} defender KIA).`
                : `🏰 Fortified Bunker Assault: Assaulting un-softened reinforced strongpoints resulted in heavy close-quarters fighting (${attKia} attacker KIA, ${defKia} defender KIA).`;
            } else {
              tacticalNarrative = `Combined-arms kinetic engagement in ${terrainCfg.name} (${defKia} enemy KIA / ${defWia} WIA).`;
            }

            damageSummary = targetDestroyed
              ? `Target Objective Obliterated & Captured (${defKia} KIA, ${defWia} WIA). ${tacticalNarrative}`
              : `Target Heavily Damaged / Suppressed (${defKia} KIA, ${defWia} WIA). ${tacticalNarrative}`;

            battleLog.push({
              id: nextEvt(),
              timeFormatted: 'T+30m',
              title: `Ground Assault Resolution — ${phaseTargetLabel} (${terrainCfg.name})`,
              detail: damageSummary,
              badge: {
                text: targetDestroyed ? 'Objective Overrun' : 'Contested',
                variant: targetDestroyed ? 'success' : 'neutral',
              },
            });
          } else {
            // Air / Standoff Strike on Ground or Air Objective
            const impactNoun = isGroundDirectFire
              ? 'cannon / sabot impacts'
              : isTubeArtilleryOrMortar
                ? 'artillery shell impacts'
                : weaponName.toLowerCase().includes('rocket')
                  ? 'rocket artillery strikes'
                  : 'direct missile impacts';

            targetState.status = hits >= 3 ? 'destroyed' : 'damaged';
            targetDestroyed = targetState.status === 'destroyed';
            if (targetDestroyed) {
              targetState.aliveCount = 0;
              targetState.destroyedCount = targetState.initialCount;
              targetState.kiaPersonnel += Math.round(targetState.alivePersonnel * 0.75);
              targetState.wiaPersonnel += Math.max(0, targetState.alivePersonnel - Math.round(targetState.alivePersonnel * 0.75));
              targetState.alivePersonnel = 0;
            }
            damageSummary = targetDestroyed
              ? `Target Objective Obliterated by ${hits} ${impactNoun}.`
              : `Target Objective Heavily Damaged by ${hits} ${impactNoun}.`;

            battleLog.push({
              id: nextEvt(),
              timeFormatted: 'T+30m',
              title: `Objective Struck — ${phaseTargetLabel}`,
              detail: `${hits} munitions impacted objective. ${damageSummary}`,
              badge: { text: `${hits} Hits`, variant: 'success' },
            });
          }
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
      if (isAirAttacker && releaseLngLat) {
        pathSpec = {
          ingress: multiLegGreatCirclePath(ingressRoute, 32),
          munition: multiLegGreatCirclePath(munitionRoute, 32),
          releasePoint: releaseLngLat,
          targetPoint: targetUnit.lngLat,
          waypoints,
          color: phaseColor,
          munitionColor: '#FFB020',
        };
      } else {
        pathSpec = {
          ingress: multiLegGreatCirclePath(fullRoute, 32),
          munition: multiLegGreatCirclePath(fullRoute, 32),
          targetPoint: targetUnit.lngLat,
          waypoints,
          color: phaseColor,
          munitionColor: '#FFB020',
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
        navalAssessment: navalAss ?? undefined,
        bmdAssessment: bmdAss ?? undefined,
      });
    }
  }

  // Master Theater Debrief
  const targetIdsInPhases = Array.from(new Set(phases.map((p) => p.targetUnitId)));
  const destroyedTargets: string[] = [];
  const damagedTargets: string[] = [];
  const totalTargetsEngaged = targetIdsInPhases.length;

  for (const tId of targetIdsInPhases) {
    const tState = unitStates.get(tId);
    const tUnit = allUnits.find((u) => u.id === tId);
    const tName = tUnit ? unitLabel(tUnit, ctx.formations, ctx.systems) : 'Target';
    if (tState?.status === 'destroyed' || (tState?.aliveCount === 0 && (tState?.initialCount ?? 0) > 0)) {
      destroyedTargets.push(tName);
    } else if (tState?.status === 'damaged' || tState?.status === 'suppressed') {
      damagedTargets.push(tName);
    }
  }

  const primaryTargetState = unitStates.get(targetUnitId);
  const primaryTargetDestroyed =
    primaryTargetState?.status === 'destroyed' ||
    (primaryTargetState?.aliveCount === 0 && (primaryTargetState?.initialCount ?? 0) > 0);
  const primaryTargetDamaged =
    primaryTargetState?.status === 'damaged' || primaryTargetState?.status === 'suppressed';
  const primaryTargetStatus =
    primaryTargetDestroyed ? 'destroyed' : primaryTargetDamaged ? 'damaged' : 'held';

  let overallHeadline: string;
  let overallVerdict: string;

  if (destroyedTargets.length === totalTargetsEngaged && totalTargetsEngaged > 0) {
    overallHeadline = 'THEATER DECISIVE VICTORY — All Target Objectives Destroyed';
    overallVerdict = `Coordinated multi-phase strikes overwhelmed enemy integrated defenses and annihilated all target objectives (${destroyedTargets.join(', ')}).`;
  } else if (destroyedTargets.length > 0) {
    overallHeadline = `THEATER TACTICAL VICTORY — Strategic Targets Neutralized (${destroyedTargets.join(', ')})`;
    overallVerdict = `Strike forces successfully penetrated enemy air defense umbrellas and destroyed ${destroyedTargets.join(', ')}${damagedTargets.length > 0 ? `, heavily damaging ${damagedTargets.join(', ')}` : ''}.`;
  } else if (damagedTargets.length > 0 || primaryTargetDamaged) {
    overallHeadline = 'CONTESTED THEATER ENGAGEMENT — Targets Sustained Heavy Damage';
    overallVerdict = `Strike salvos penetrated defensive screens and inflicted critical damage on ${damagedTargets.join(', ') || targetLabel}, but defenses prevented complete destruction.`;
  } else {
    overallHeadline = 'DEFENDER VICTORY — Strike Repulsed by Integrated Defenses';
    overallVerdict = `Defending air and fleet defense networks intercepted all incoming strike salvos and preserved the operational readiness of ${targetLabel}.`;
  }

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
