import type { WarSimSession } from '../../warSimTypes';
import { syncPhysical } from './model';
/** Authored fictional encounter. Creating it never reads or edits the user's board. */
export function createPhysicalReference(): WarSimSession {
  const personnel = { army: 0, navy: 200, airForce: 0, strategicForces: 0, specialOps: 0, total: 200 };
  const s: WarSimSession = {
    id: `coastal-${Date.now()}`, name: 'Glasswater / Coastal encounter', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'paused', simTimeSec: 0, timeMultiplier: 1, playerIso: '840', enemyIso: '156', playerColor: '#61d8ed', enemyColor: '#ff826e',
    activeFaction: 'player', personnel: { player: { ...personnel }, enemy: { ...personnel } }, quotas: { player: {}, enemy: {} },
    bases: [], entities: [], activeMissiles: [], eventLog: [], fogOfWarContacts: { playerContacts: [], enemyContacts: [] },
    physical: { version: 1, model: 'coastal-pointmass-v1', origin: [-150, 20, 0], sequence: 0, rounds: [], events: [], actors: [
      { id: 'blue-frigate', iso: '840', position: [0, 0, 0], velocity: [0, 8, 0], heading: 0, course: 0, speed: 8, desiredSpeed: 8, fuel: 100, health: 100, rounds: 8, interceptors: 4, cooldown: 0 },
      { id: 'red-frigate', iso: '156', position: [3000, 1800, 0], velocity: [0, -6, 0], heading: 180, course: 180, speed: 6, desiredSpeed: 6, fuel: 100, health: 100, rounds: 8, interceptors: 2, cooldown: 0 },
    ] },
  };
  s.entities = s.physical!.actors.map(a => ({ id: a.id, systemId: 'reference-frigate', iso: a.iso, name: a.iso === '840' ? 'FS Resolute' : 'FS Meridian',
    typeId: 'destroyer', count: 1, lngLat: [-150, 20], altitudeM: 0, headingDeg: a.heading, speedKmh: a.speed * 3.6,
    currentFuelPct: 100, status: 'on_station', damage: 'intact', turnaroundTimerSec: 0, repairTimerSec: 0, personnel: 100, magazines: { 0: 8, 1: a.interceptors }, rcs: 100 }));
  syncPhysical(s); return s;
}
