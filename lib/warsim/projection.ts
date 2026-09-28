import type { WarSimSession } from '../warSimTypes';
import { length, sub } from './physics/coordinates';
import { PROFILE } from './physics/model';
import { ensurePhysicalIntel, observedContacts, projectIntel, scopeTracks, hq, local } from './intelligence';

/** Faction boundary. Physical contacts are scoped estimates; legacy tracks retain their prior fidelity. */
export function projectObserver(world: WarSimSession): WarSimSession {
  const view = structuredClone(world);
  delete view.runtime;
  const faction = world.activeFaction;
  const other = faction === 'player' ? 'enemy' : 'player';
  const iso = faction === 'player' ? world.playerIso : world.enemyIso;
  if (view.physical) {
    const intel = ensurePhysicalIntel(world), scopeId = world.observerScope ?? hq(iso), tick = Math.round(world.simTimeSec * 10);
    view.observerScope = scopeId;
    view.intelView = projectIntel(world, scopeId, tick);
    const scopedContacts = observedContacts(world, scopeId, tick);
    view.fogOfWarContacts = { playerContacts: faction === 'player' ? scopedContacts : [], enemyContacts: faction === 'enemy' ? scopedContacts : [] };
    const own = view.physical.actors.filter(a => a.iso === iso);
    view.physical.actors = own;
    view.physical.rounds = view.physical.rounds.filter(r => r.iso === iso || scopeTracks(intel, scopeId).some(t => t.targetRef === r.id && t.state !== 'lost'));
    // Hostile weapon identities/intent are not part of the observed kinematics.
    view.physical.rounds = view.physical.rounds.map(r => r.iso === iso ? r : { ...r, shooterId: '', targetId: '', launchPosition: [...r.position], age: 0 });
    view.physical.events = view.physical.events.filter(e => e.visibleTo.includes(scopeId)).map(e => ({ ...e, visibleTo: [scopeId] }));
    view.physical.sequence = 0;
    delete view.physical.intel;
    const allowedEvents = new Set(view.physical.events.map(e => e.id));
    view.eventLog = view.eventLog.filter(e => {
      const sequence = /^physical-(\d+)-/.exec(e.id);
      return !sequence || allowedEvents.has(Number(sequence[1]));
    });
  }
  view.entities = view.entities.filter(e => e.iso === iso);
  view.bases = view.bases.filter(b => b.iso === iso);
  view.networks = view.networks?.filter(n => n.faction === faction);
  view.satellites = view.satellites?.filter(s => s.faction === faction);
  view.activeMissiles = view.activeMissiles.filter(m => m.attackerIso === iso);
  if (!view.physical) view.fogOfWarContacts = {
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
