/**
 * Immutable inputs for the legacy engine baseline. All figures are synthetic
 * test parameters, not estimates of real equipment. Never load data/*.json here.
 */
import type { SystemSpec } from '../../../../lib/specs';
import type { SimEntity, WarSimSession, BattlefieldNetwork } from '../../../../lib/warSimTypes';

export const FIXTURE_VERSION = 1;
export const FIXTURE_EPOCH_MS = Date.UTC(2026, 8, 25);
export const FIXTURE_SEED = 240925;
export const FIXTURE_IDS = ['transit', 'sensor-contact', 'engagement', 'fleet', 'joint-operations'] as const;
export type FixtureId = typeof FIXTURE_IDS[number];

const systems: SystemSpec[] = [
  {
    id: 'fixture-aircraft', name: 'Fixture patrol aircraft', typeId: 'fighter', rcs: 5,
    platform: { speedKmh: 720, combatRadiusKm: 3000, crew: 2 },
    sensor: { detectionKm: 160, antennaM: 2, tracks: 40, horizonLimited: false, sees: ['air', 'surface'] },
    weapons: [],
  },
  {
    id: 'fixture-scout', name: 'Fixture scout', typeId: 'awacs', rcs: 5,
    platform: { speedKmh: 600, combatRadiusKm: 3000, crew: 6 },
    sensor: { detectionKm: 250, antennaM: 2, tracks: 80, horizonLimited: false, sees: ['air', 'surface'] },
    weapons: [],
  },
  {
    id: 'fixture-ship', name: 'Fixture surface ship', typeId: 'destroyer', rcs: 100,
    platform: { speedKmh: 36, combatRadiusKm: 10000, crew: 100, displacementT: 3000 },
    sensor: { detectionKm: 100, antennaM: 25, tracks: 40, horizonLimited: true, sees: ['air', 'surface'] },
    weapons: [{ id: 'fixture-round', name: 'Fixture surface round', rangeKm: 120,
      speedMach: 1, magazine: 8, salvo: 1, pk: 0.5, reactionSec: 2, engages: ['surface'] }],
  },
  {
    id: 'fixture-target', name: 'Fixture unarmed vessel', typeId: 'logistics-ship', rcs: 100,
    platform: { speedKmh: 18, combatRadiusKm: 10000, crew: 12, displacementT: 500 },
    sensor: { detectionKm: 0, antennaM: 10, horizonLimited: true, sees: ['surface'] },
    weapons: [],
  },
  {
    id: 'fixture-radar', name: 'Fixture ground sensor', typeId: 'radar', rcs: 10,
    sensor: { detectionKm: 180, antennaM: 20, tracks: 40, horizonLimited: true, sees: ['air'] },
    weapons: [],
  },
];

function entity(id: string, systemId: string, iso: string, position: [number, number], overrides: Partial<SimEntity> = {}): SimEntity {
  const spec = systems.find((item) => item.id === systemId)!;
  const air = ['fighter', 'awacs'].includes(spec.typeId);
  return {
    id, systemId, iso, name: id, typeId: spec.typeId, count: 1,
    lngLat: [...position], altitudeM: air ? 6000 : 0, headingDeg: 90,
    speedKmh: spec.platform?.speedKmh ?? 0, currentFuelPct: 100,
    status: 'on_station', damage: 'intact', turnaroundTimerSec: 0,
    repairTimerSec: 0, personnel: spec.platform?.crew ?? 4,
    magazines: { 0: spec.weapons?.[0]?.magazine ?? 0 }, rcs: spec.rcs,
    threatLevel: 'defcon_3',
    ...overrides,
  };
}

function session(id: FixtureId): WarSimSession {
  const personnel = { army: 100, navy: 100, airForce: 100, strategicForces: 0, specialOps: 0, total: 300 };
  return {
    id: `phase0-v1-${id}`, name: `Phase 0 / ${id}`,
    createdAt: new Date(FIXTURE_EPOCH_MS).toISOString(), updatedAt: new Date(FIXTURE_EPOCH_MS).toISOString(),
    status: 'running', simTimeSec: 0, timeMultiplier: 1,
    playerIso: '840', playerColor: '#4F9FD6', enemyIso: '156', enemyColor: '#D9534F',
    activeFaction: 'player', personnel: { player: { ...personnel }, enemy: { ...personnel } },
    quotas: { player: {}, enemy: {} }, bases: [], entities: [], activeMissiles: [],
    fogOfWarContacts: { playerContacts: [], enemyContacts: [] }, eventLog: [], reports: [],
    salvoTrackers: [], networks: [], airspaceRoeDoctrine: 'neutral_sanctuary',
    // The legacy engine replaces [] with real-world default satellites. A
    // destroyed synthetic entry disables that unrelated default in these cases.
    satellites: [{ id: 'fixture-disabled-orbiter', systemId: 'fixture-orbiter', name: 'Disabled fixture orbiter', faction: 'player',
      iso: '840', altitudeKm: 500, inclinationDeg: 0, periodMin: 90, orbitPhaseOffsetSec: 0,
      sensorType: 'optical', swathWidthKm: 0, status: 'destroyed', currentLngLat: [0, 0],
      resolutionM: 10, groundTrack: [], groundSwathPolygon: [],
      lastScanSimTimeSec: 0, contactsDiscoveredCount: 0 }],
  };
}

export interface JointCollectionStep {
  atSimSec: number;
  action: 'request-collection' | 'observe' | 'deliver-report' | 'interrupt-support';
  assetId: string;
  recipient: 'blue-task-group' | 'red-task-group';
  expected: string;
  support: 'legacy-observation' | 'planned';
}

export interface BaselineFixture {
  schemaVersion: 1;
  id: FixtureId;
  seed: number;
  purpose: string;
  systems: SystemSpec[];
  session: WarSimSession;
  collectionScript?: JointCollectionStep[];
}

/** Fresh object graph on every call: engine mutations cannot poison another test. */
export function createFixture(id: FixtureId): BaselineFixture {
  const world = session(id);
  let purpose = '';
  let collectionScript: JointCollectionStep[] | undefined;
  if (id === 'transit') {
    purpose = 'One aircraft in oceanic transit, with no combat or automatic satellite sensing.';
    world.entities = [entity('blue-transit', 'fixture-aircraft', '840', [-150, 0], {
      status: 'takeoff_ingress', patrolOrder: { centerLngLat: [-147, 0], patrolRadiusKm: 10,
        altitudeM: 6000, orbitAngleDeg: 0, emcon: 'passive' },
    })];
  } else if (id === 'sensor-contact') {
    purpose = 'Asymmetric sensor acquisition, loss, and last-known-position expiry.';
    world.entities = [
      entity('blue-scout', 'fixture-scout', '840', [-150, 0]),
      entity('red-target', 'fixture-target', '156', [-149.5, 0]),
    ];
  } else if (id === 'engagement') {
    purpose = 'Single-platform salvo accounting and weapon flyout against an unarmed target.';
    world.entities = [
      entity('blue-shooter', 'fixture-ship', '840', [-150, 0]),
      entity('red-target', 'fixture-target', '156', [-149.85, 0]),
    ];
  } else if (id === 'fleet') {
    purpose = '100-platform workload with opposing fleets, airborne sensors, moving tracks, and 50 projectiles.';
    for (let i = 0; i < 100; i++) {
      const blue = i < 50;
      const position: [number, number] = [-150 + (i % 10) * 0.04 + (blue ? 0 : 0.5), Math.floor((i % 50) / 10) * 0.04];
      world.entities.push(entity(`fleet-${i}`, i % 5 === 0 ? 'fixture-aircraft' : 'fixture-ship', blue ? '840' : '156', position, {
        patrolOrder: { centerLngLat: [position[0] + 1, position[1]], patrolRadiusKm: 10,
          altitudeM: i % 5 === 0 ? 6000 : 0, orbitAngleDeg: 0, emcon: 'active',
          routeType: 'waypoints', waypoints: [position, [position[0] + 1, position[1]]], currentWaypointIdx: 1 },
      }));
    }
    for (let i = 0; i < 50; i++) {
      world.activeMissiles.push({ id: `fixture-projectile-${i}`, originLngLat: [-155, -10],
        currentLngLat: [-155, -10], targetLngLat: [-145, -10], attackerEntityId: 'fleet-0',
        targetEntityId: 'fleet-50', attackerIso: '840', targetIso: '156', weaponName: 'Fixture transit round',
        weaponCategory: 'cruise', speedKmh: 900, startSimTimeSec: 0, etaSimTimeSec: 4400,
        isIntercepted: false, progress: 0 });
    }
  } else {
    purpose = 'Air/sea/ground collection and coordination migration fixture. Delayed dissemination is a declared future requirement, not simulated legacy behavior.';
    world.entities = [entity('blue-scout', 'fixture-scout', '840', [-150, 0]),
      entity('blue-shooter', 'fixture-ship', '840', [-150.8, 0]),
      entity('blue-ground-sensor', 'fixture-radar', '840', [-151, 0]),
      entity('red-target', 'fixture-target', '156', [-149.5, 0])];
    const network: BattlefieldNetwork = { id: 'fixture-blue-network', name: 'Fixture blue task group',
      faction: 'player', iso: '840', doctrine: 'layered_optimal', othTargetingEnabled: true, sharedContactIds: [],
      nodes: world.entities.filter((e) => e.iso === '840').map((e) => ({ entityId: e.id,
        role: e.id === 'blue-shooter' ? 'shooter' : 'sensor', datalinkStatus: 'active', channelCapacity: 4, activeChannelsUsed: 0 })) };
    world.networks = [network];
    world.entities.filter((e) => e.iso === '840').forEach((e) => { e.networkId = network.id; });
    collectionScript = [
      { atSimSec: 0, action: 'request-collection', assetId: 'blue-scout', recipient: 'blue-task-group', support: 'planned', expected: 'Collection task reserves available sensor time.' },
      { atSimSec: 1, action: 'observe', assetId: 'blue-scout', recipient: 'blue-task-group', support: 'legacy-observation', expected: 'Blue acquires a contact; unarmed red has no reciprocal contact.' },
      { atSimSec: 5, action: 'deliver-report', assetId: 'blue-scout', recipient: 'blue-task-group', support: 'planned', expected: 'The observation remains local until simulated delivery.' },
      { atSimSec: 10, action: 'interrupt-support', assetId: 'blue-scout', recipient: 'blue-task-group', support: 'planned', expected: 'Link loss prevents further sharing and changes dependent mission state.' },
    ];
  }
  return structuredClone({ schemaVersion: FIXTURE_VERSION, id, seed: FIXTURE_SEED, purpose, systems, session: world, collectionScript });
}
