import type { WarSimSession } from '../warSimTypes';
import { length, sub } from './physics/coordinates';
import { PROFILE } from './physics/model';

/** Phase 1 data boundary. Contact estimates retain legacy fidelity until Phase 3. */
export function projectObserver(world: WarSimSession): WarSimSession {
  const view = structuredClone(world);
  delete view.runtime;
  const faction = world.activeFaction;
  const other = faction === 'player' ? 'enemy' : 'player';
  const iso = faction === 'player' ? world.playerIso : world.enemyIso;
  if (view.physical) {
    const own = view.physical.actors.filter(a => a.iso === iso);
    view.physical.actors = own;
    view.physical.rounds = view.physical.rounds.filter(r => r.iso === iso || own.some(a => a.health > 0 && length(sub(a.position, r.position)) <= PROFILE.sensorRange));
    // Hostile weapon identities/intent are not part of the observed kinematics.
    view.physical.rounds = view.physical.rounds.map(r => r.iso === iso ? r : { ...r, shooterId: '', targetId: '' });
    view.physical.events = view.physical.events.filter(e => e.visibleTo.includes(iso)).map(e => ({ ...e, visibleTo: [iso] }));
    view.physical.sequence = 0;
  }
  view.entities = view.entities.filter(e => e.iso === iso);
  view.bases = view.bases.filter(b => b.iso === iso);
  view.networks = view.networks?.filter(n => n.faction === faction);
  view.satellites = view.satellites?.filter(s => s.faction === faction);
  view.activeMissiles = view.activeMissiles.filter(m => m.attackerIso === iso);
  view.fogOfWarContacts = {
    playerContacts: faction === 'player' ? view.fogOfWarContacts.playerContacts : [],
    enemyContacts: faction === 'enemy' ? view.fogOfWarContacts.enemyContacts : [],
  };
  view.eventLog = view.eventLog.filter(e => e.faction === faction);
  view.reports = view.reports?.filter(r => r.countryIso === iso);
  view.salvoTrackers = undefined;
  view.borderIncursions = undefined;
  view.quotas[other] = {};
  view.personnel[other] = { army: 0, navy: 0, airForce: 0, strategicForces: 0, specialOps: 0, total: 0 };
  if (view.battleOpsPlan) {
    const ownIds = new Set(view.entities.map(e => e.id));
    view.battleOpsPlan.phases = view.battleOpsPlan.phases.map(p => ({ ...p,
      tasks: p.tasks.filter(t => ownIds.has(t.attackerEntityId)) }));
  }
  return view;
}
