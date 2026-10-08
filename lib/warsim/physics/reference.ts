import type { WarSimSession } from '../../warSimTypes';
import { syncPhysical } from './model';
import { createPhysicalIntel } from '../intelligence';
import { referenceEnvironment } from './environment';
import { createObjectives, createOpposition } from '../opposition';
/** Authored fictional encounter. Creating it never reads or edits the user's board. */
export function createPhysicalReference(): WarSimSession {
  const personnel = { army: 0, navy: 200, airForce: 0, strategicForces: 0, specialOps: 0, total: 200 };
  const s: WarSimSession = {
    id: `coastal-${Date.now()}`, name: 'Glasswater / Coastal encounter', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'paused', simTimeSec: 0, timeMultiplier: 1, playerIso: '840', enemyIso: '156', playerColor: '#61d8ed', enemyColor: '#ff826e',
    activeFaction: 'player', personnel: { player: { ...personnel }, enemy: { ...personnel } }, quotas: { player: {}, enemy: {} },
    bases: [], entities: [], activeMissiles: [], eventLog: [], fogOfWarContacts: { playerContacts: [], enemyContacts: [] },
    physical: { version: 1, model: 'coastal-pointmass-v2', origin: [-150, 20, 0], sequence: 0, rounds: [], events: [], environment: referenceEnvironment(), actors: [
      { id: 'blue-frigate', iso: '840', domain: 'sea', position: [0, 0, 0], velocity: [0, 8, 0], heading: 0, course: 0, speed: 8, desiredSpeed: 8, fuel: 100, health: 100, rounds: 8, interceptors: 4, cooldown: 0 },
      { id: 'red-frigate', iso: '156', domain: 'sea', position: [3000, 1800, 0], velocity: [0, -6, 0], heading: 180, course: 180, speed: 6, desiredSpeed: 6, fuel: 100, health: 100, rounds: 8, interceptors: 2, cooldown: 0 },
      { id: 'blue-scout', iso: '840', domain: 'sea', position: [-1400, 2700, 0], velocity: [0, 4, 0], heading: 0, course: 0, speed: 4, desiredSpeed: 4, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0 },
    ] },
  };
  s.entities = s.physical!.actors.map(a => ({ id: a.id, systemId: 'reference-frigate', iso: a.iso, name: a.id === 'blue-scout' ? 'FS Surveyor' : a.iso === '840' ? 'FS Resolute' : 'FS Meridian',
    typeId: 'destroyer', count: 1, lngLat: [-150, 20], altitudeM: 0, headingDeg: a.heading, speedKmh: a.speed * 3.6,
    currentFuelPct: 100, status: 'on_station', damage: 'intact', turnaroundTimerSec: 0, repairTimerSec: 0, personnel: 100, magazines: { 0: a.rounds, 1: a.interceptors }, rcs: 100 }));
  for (const actor of s.physical!.actors) {
    actor.condition = { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 };
    actor.repairKits = actor.id === 'blue-scout' ? 1 : 2;
  }
  s.physical!.intel = createPhysicalIntel(s);
  syncPhysical(s); return s;
}

/** Five-domain observation probe sharing the coastal clock, knowledge scopes and reservations. */
export function createLittoralReference(): WarSimSession {
  const s = createPhysicalReference(), p = s.physical!;
  s.id = `littoral-${Date.now()}`; s.name = 'Glasswater / Joint probe';
  p.actors.push({ id: 'blue-ground-radar', iso: s.playerIso, domain: 'land', position: [7000, 0, 60], velocity: [0, 0, 0],
    heading: 270, course: 270, speed: 0, desiredSpeed: 0, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 1 });
  p.actors.push({ id: 'blue-ground-patrol', iso: s.playerIso, domain: 'land', groundMobility: 'tracked',
    position: [7000, -2000, 32], velocity: [-6, 0, 0], heading: 270, course: 270, speed: 6, desiredSpeed: 6,
    fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 1 });
  p.actors.push({ id: 'blue-air-recon', iso: s.playerIso, domain: 'air', position: [-3500, -1200, 1200], velocity: [80, 0, 0],
    heading: 90, course: 90, speed: 80, desiredSpeed: 80, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 0 });
  p.actors.push({ id: 'blue-sonar', iso: s.playerIso, domain: 'subsurface', position: [500, 1000, -40], velocity: [2, 0, 0],
    heading: 90, course: 90, speed: 2, desiredSpeed: 2, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 1 });
  p.actors.push({ id: 'red-sub', iso: s.enemyIso, domain: 'subsurface', position: [2200, 800, -40], velocity: [0, -2, 0],
    heading: 180, course: 180, speed: 2, desiredSpeed: 2, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 1 });
  p.actors.push({ id: 'blue-orbital', iso: s.playerIso, domain: 'space', position: [0, 0, 80000], velocity: [0, 0, 0],
    heading: 0, course: 0, speed: 0, desiredSpeed: 0, fuel: 100, health: 100, rounds: 0, interceptors: 0, cooldown: 0,
    condition: { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 }, repairKits: 0 });
  const template = s.entities[0];
  s.entities.push({ ...template, id: 'blue-ground-radar', name: 'Cape Glass radar', systemId: 'reference-radar', typeId: 'radar',
    personnel: 20, speedKmh: 0, magazines: {} });
  s.entities.push({ ...template, id: 'blue-ground-patrol', name: 'Cape Glass patrol', systemId: 'reference-recon', typeId: 'recon',
    personnel: 6, speedKmh: 21.6, magazines: {} });
  s.entities.push({ ...template, id: 'blue-air-recon', name: 'Kite reconnaissance UAV', systemId: 'reference-uav', typeId: 'uav',
    personnel: 2, speedKmh: 288, magazines: {} });
  s.entities.push({ ...template, id: 'blue-sonar', name: 'FS Deepwatch', systemId: 'reference-sub', typeId: 'submarine',
    personnel: 30, speedKmh: 7.2, magazines: {} });
  s.entities.push({ ...template, id: 'red-sub', iso: s.enemyIso, name: 'RS Undertow', systemId: 'reference-sub', typeId: 'submarine',
    personnel: 30, speedKmh: 7.2, magazines: {} });
  s.entities.push({ ...template, id: 'blue-orbital', name: 'Glint orbital collector', systemId: 'reference-orbital', typeId: 'satellite',
    personnel: 0, speedKmh: 0, magazines: {} });
  p.intel = createPhysicalIntel(s);
  p.opposition = createOpposition();
  p.objectives = createObjectives(p.intel.contacts['blue-frigate']);
  syncPhysical(s);
  return s;
}
