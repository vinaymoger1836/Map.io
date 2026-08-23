/**
 * War Simulation Game — Core Types and Schemas
 *
 * Defines the complete data model for the real-time, base-anchored,
 * multi-domain war simulation engine in Map.io.
 */

import { type Domain } from './warGames';
import { type SystemSpec } from './specs';

/* ------------------------------------------------------------------ */
/* 1. Branch Personnel & Allocation                                   */
/* ------------------------------------------------------------------ */

export interface BranchPersonnel {
  army: number;
  navy: number;
  airForce: number;
  strategicForces: number;
  specialOps: number;
  total: number;
}

export interface QuotaAllocation {
  systemId: string;
  typeId: string;
  customName?: string;
  count: number;
  deployed: number;
  destroyed: number;
  inRepair: number;
}

export type FactionQuotaLedger = Record<string, QuotaAllocation>; // Keyed by systemId or typeId

/* ------------------------------------------------------------------ */
/* 2. Base Anchoring & Station Logistics                              */
/* ------------------------------------------------------------------ */

export type BaseType = 'airbase' | 'naval_base' | 'army_base' | 'silo_complex' | 'carrier_group';

export interface SimBase {
  id: string;
  name: string;
  iso: string;
  type: BaseType;
  lngLat: [number, number];
  maxCapacity: number; // Max airframes, ships, or ground battalions
  stationedEntityIds: string[];
  runwayStatus: 'operational' | 'damaged' | 'destroyed';
  repairCountdownSec: number;
  supplies: {
    fuelPct: number;
    ammoPct: number;
  };
}

/* ------------------------------------------------------------------ */
/* 3. Fog of War & Intel Gathering                                    */
/* ------------------------------------------------------------------ */

/**
 * 3-Tier Intel & Detection Model:
 * - Tier 0: Undetected (hidden under fog of war)
 * - Tier 1: Sensor Track (radar/sonar blip, bearing, domain known, composition unknown '???')
 * - Tier 2: Positively Identified (PID via drone/SOF recon, full vehicle & troop counts revealed)
 */
export type IntelTier = 0 | 1 | 2;

export interface DetectedContact {
  contactId: string;
  targetEntityId: string;
  targetIso: string;
  discoveredByFaction: 'player' | 'enemy';
  intelTier: 1 | 2;
  domain: Domain;
  lastKnownLngLat: [number, number];
  headingDeg: number;
  speedKmh: number;
  lastDetectedSimTimeSec: number;
  decayTimerSec: number; // Fades out if not re-swept within time window
  knownName?: string;
  knownCount?: number;
  knownPersonnel?: number;
  knownDamage?: 'intact' | 'damaged' | 'suppressed' | 'destroyed';
}

/* ------------------------------------------------------------------ */
/* 4. Entity State, Kinematics & Lifecycle                            */
/* ------------------------------------------------------------------ */

export type DamageState = 'intact' | 'damaged' | 'destroyed';

export type EntityStatus =
  | 'docked'             // Inside base, ready to sortie
  | 'turnaround'         // Refueling, rearming, or post-mission maintenance
  | 'in_repair'          // Base repair crew repairing combat damage
  | 'takeoff_ingress'    // En route from base to assigned patrol station
  | 'on_station'         // Orbiting patrol station with active sensors
  | 'engaging'           // Maneuvering to release ordnance
  | 'bingo_rtb'          // Low fuel: returning to home base
  | 'damaged_rtb'        // Battle damage: emergency RTB for repairs
  | 'destroyed';         // Permanently lost / removed from map

export interface PatrolOrder {
  centerLngLat: [number, number];
  patrolRadiusKm: number;
  altitudeM: number;
  orbitAngleDeg: number; // Current orbital progress angle around patrol center
  emcon: 'active' | 'passive'; // Active radar search vs silent passive standby
  routeType?: 'orbit' | 'waypoints'; // 'orbit': circular loiter, 'waypoints': multi-point corridor
  waypoints?: [number, number][]; // [WP1, WP2, WP3, ...]
  currentWaypointIdx?: number; // Target waypoint index
  patrolDirection?: 1 | -1; // 1: forward (WP1 -> WPN), -1: reverse (WPN -> WP1)
}

export type PostStrikeAction =
  | 'rtb'                  // Return to base for turnaround/re-arming
  | 'return_to_patrol'     // Return to previous patrol orbit/corridor
  | 'loiter_target'        // Loiter/orbit over target area for BDA
  | 'designated_waypoint'; // Fly to a designated recovery waypoint

export interface WeaponSalvoItem {
  weaponIndex: number;
  weaponName: string;
  weaponRangeKm: number;
  salvoCount: number;
}

export interface StrikePlan {
  targetEntityId: string;
  targetLngLat: [number, number];
  weaponIndex: number;
  weaponName: string;
  weaponRangeKm: number;
  salvoCount: number;
  postStrikeAction: PostStrikeAction;
  returnPatrolOrder?: PatrolOrder;
  customPostLngLat?: [number, number];
  weaponsToFire?: WeaponSalvoItem[];
  attackWaypoints?: [number, number][];
  currentWaypointIdx?: number;
}

export interface SimEntity {
  id: string;
  iso: string;
  name: string;
  typeId: string;
  systemId?: string;
  count: number;
  homeBaseId?: string;
  lngLat: [number, number];
  altitudeM: number;
  headingDeg: number;
  speedKmh: number;
  currentFuelPct: number; // 0 - 100%
  status: EntityStatus;
  damage: DamageState;
  patrolOrder?: PatrolOrder;
  assignedMission?: 'patrol' | 'strike' | 'recon' | 'refuel_tanker' | 'cap';
  assignedTargetEntityId?: string;
  strikePlan?: StrikePlan;
  turnaroundTimerSec: number;
  repairTimerSec: number;
  personnel: number;
  /** Explicit physical Radar Cross-Section (RCS in m²) */
  rcs?: number;
  /** Weapon index -> remaining ready rounds in magazine */
  magazines: Record<number, number>;
  /** Custom equipped weapon facets configured during pre-mission sortie tasking */
  customWeapons?: import('./specs').WeaponFacet[];
}

/* ------------------------------------------------------------------ */
/* 5. Live Munitions, Missile Flyouts & Point Defense                 */
/* ------------------------------------------------------------------ */

export interface MissileFlyoutTrack {
  id: string;
  originLngLat: [number, number];
  targetLngLat: [number, number];
  currentLngLat: [number, number];
  attackerEntityId: string;
  targetEntityId: string;
  attackerIso: string;
  targetIso: string;
  weaponName: string;
  weaponCategory: 'cruise' | 'ballistic' | 'sam' | 'torpedo' | 'air_to_air' | 'bomb' | 'artillery';
  speedKmh: number;
  startSimTimeSec: number;
  etaSimTimeSec: number;
  isIntercepted: boolean;
  progress: number; // 0.0 to 1.0
  interceptorEntityId?: string;
  engagedByDefenderIds?: string[];
  /** Target threat missile ID being intercepted (for SAM / interceptor tracks) */
  targetMissileId?: string;
  /** Probability of kill committed by this interceptor (0.0 to 1.0) */
  interceptorPk?: number;
  /** Timestamp when this threat was first acquired by defender radar (for reaction time delay) */
  defenderDetectionTimes?: Record<string, number>;
  /** Salvo tracking ID for grouped strike mission reports */
  salvoId?: string;
}

export interface InterceptionBreakdownEntry {
  defenderEntityId?: string;
  defenderName: string;
  interceptorWeapon: string;
  interceptType: 'sam' | 'ciws';
  countDestroyed: number;
  roundsFired: number;
  threatWeaponName?: string;
}

export interface StrikeSalvoTracker {
  salvoId: string;
  attackerEntityId: string;
  attackerName: string;
  attackerIso: string;
  targetEntityId: string;
  targetName: string;
  targetIso: string;
  weaponNames: string[];
  totalLaunched: number;
  interceptedBySam: number;
  interceptedByCiws: number;
  directHits: number;
  defendingSamSystems: string[];
  defendingCiwsSystems: string[];
  interceptionBreakdowns?: InterceptionBreakdownEntry[];
  startSimTimeSec: number;
  concludedSimTimeSec?: number;
  targetInitialDamage: string;
  targetFinalDamage?: string;
  targetPersonnelLosses?: number;
  targetPlatformsDestroyed?: number;
  standoffDistanceKm: number;
  weaponSpeedMach?: number;
  weaponRangeKm?: number;
  targetLngLat: [number, number];
  attackerLngLat: [number, number];
  isConcluded: boolean;
}

/* ------------------------------------------------------------------ */
/* 6. Battle Logging, Reports & After-Action Analytics                */
/* ------------------------------------------------------------------ */

export interface SimBattleEvent {
  id: string;
  simTimeSec: number;
  timeFormatted: string;
  faction: 'player' | 'enemy' | 'neutral';
  type:
    | 'detection'
    | 'intel_pid'
    | 'launch'
    | 'strike'
    | 'deployment'
    | 'intercept'
    | 'impact'
    | 'loss'
    | 'rtb'
    | 'repair'
    | 'alert';
  title: string;
  detail: string;
  lngLat?: [number, number];
}

export type WarReportCategory =
  | 'under_attack'      // Incoming attack / defensive engagement / damage sustained
  | 'offensive_strike'  // Strike executed against hostile forces
  | 'recon_intel';      // Positive identification (PID) & reconnaissance gathered

export interface CombatReport {
  id: string;
  simTimeSec: number;
  timeFormatted: string;
  category: WarReportCategory;
  title: string;
  summary: string;
  lngLat?: [number, number];
  countryIso: string;
  faction: 'player' | 'enemy';

  // Primary Platform / Actor
  primaryEntity: {
    id: string;
    name: string;
    typeId: string;
    domain: string;
    iso: string;
    isFriendly: boolean;
    isPID: boolean;
    count?: number;
    baseName?: string;
    rcsM2?: number;
  };

  // Opposing Platform / Target (if applicable)
  opposingEntity?: {
    id?: string;
    name: string;
    typeId?: string;
    domain: string;
    iso: string;
    isFriendly: boolean;
    isPID: boolean;
    count?: number;
    rcsM2?: number;
  };

  // Munitions / Attack telemetry (if applicable)
  munitionsDetails?: {
    weaponName: string;
    salvoCount: number;
    rangeKm?: number;
    speedMach?: number;
    launchedBy: string;
    standoffDistanceKm?: number;
  };

  // Interception / Air Defense response telemetry (if applicable)
  interceptionTelemetry?: {
    defenseSystemName?: string;
    interceptorType?: string;
    interceptorsLaunched: number;
    missilesIntercepted: number;
    missilesPenetrated: number;
    ciwsEngaged?: boolean;
    successRatePct: number;
    responseDetail: string;
    breakdown?: InterceptionBreakdownEntry[];
  };

  // Damage / BDA Assessment
  damageAssessment?: {
    targetInitialState?: DamageState | string;
    targetResultState: DamageState | string;
    damageInflicted: 'none' | 'light' | 'moderate' | 'heavy' | 'destroyed';
    personnelLosses?: number;
    platformsDestroyed?: number;
    bdaSummary: string;
  };

  // Intel Gathering details (if recon report)
  intelDetails?: {
    discoveredDomain: string;
    confidenceTier: 1 | 2;
    sensorUsed: string;
    coordinatesText: string;
    estimatedComposition?: string;
    personnel?: number;
    rcsM2?: number;
    nominalRangeKm?: number;
    effectiveRangeKm?: number;
    radarHorizonKm?: number;
    scannerAltitudeM?: number;
    distanceKm?: number;
    rcsMultiplier?: number;
    detectionBottleneck?: string;
    physicsExplanation?: string;
  };
}

/* ------------------------------------------------------------------ */
/* 7. Master War Simulation Session State                             */
/* ------------------------------------------------------------------ */

export interface WarSimSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'setup' | 'running' | 'paused' | 'concluded';
  simTimeSec: number;
  timeMultiplier: number; // 1, 3 (default), 5, 10, 30
  playerIso: string;
  playerColor: string;
  enemyIso: string;
  enemyColor: string;
  activeFaction: 'player' | 'enemy'; // Hotseat control switch
  personnel: {
    player: BranchPersonnel;
    enemy: BranchPersonnel;
  };
  quotas: {
    player: FactionQuotaLedger;
    enemy: FactionQuotaLedger;
  };
  bases: SimBase[];
  entities: SimEntity[];
  activeMissiles: MissileFlyoutTrack[];
  fogOfWarContacts: {
    playerContacts: DetectedContact[];
    enemyContacts: DetectedContact[];
  };
  eventLog: SimBattleEvent[];
  reports?: CombatReport[];
  salvoTrackers?: StrikeSalvoTracker[];
  selectedEntityId?: string;
  selectedTargetId?: string;
  waypointPlacingMode?: 'patrol_center' | 'strike_target' | 'base_location';
}

/* ------------------------------------------------------------------ */
/* 8. Pre-Flight Validation Reporting                                 */
/* ------------------------------------------------------------------ */

export interface MissingSpecField {
  field: string;
  label: string;
  reason: string;
}

export interface SystemValidationReport {
  systemId: string;
  systemName: string;
  typeId: string;
  domain: Domain;
  valid: boolean;
  missingFields: MissingSpecField[];
}

export interface OrbatValidationResult {
  valid: boolean;
  failedCount: number;
  passedCount: number;
  reports: SystemValidationReport[];
}
