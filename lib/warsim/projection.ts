import type { WarSimSession } from '../warSimTypes';

/** Phase 1 data boundary. Contact estimates retain legacy fidelity until Phase 3. */
export function projectObserver(world: WarSimSession): WarSimSession {
  const view = structuredClone(world);
  delete view.runtime;
  const faction = world.activeFaction;
  const other = faction === 'player' ? 'enemy' : 'player';
  const iso = faction === 'player' ? world.playerIso : world.enemyIso;
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
