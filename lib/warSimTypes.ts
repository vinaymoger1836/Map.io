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
  turnaroundTimerSec: number;
  repairTimerSec: number;
  personnel: number;
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
}

/* ------------------------------------------------------------------ */
/* 6. Battle Logging & Real-Time Events                               */
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
