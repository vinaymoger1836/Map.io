import type { WarSimSession } from '../warSimTypes';
import { ensurePhysicalIntel, observedContacts, projectIntel, scopeTracks, hq } from './intelligence';

/** Faction boundary. Physical contacts are scoped estimates; legacy tracks retain their prior fidelity. */
export function projectObserver(world: WarSimSession): WarSimSession {
  const view = structuredClone(world);
  delete view.runtime;
  const faction = world.activeFaction;
  const other = faction === 'player' ? 'enemy' : 'player';
  const iso = faction === 'player' ? world.playerIso : world.enemyIso;
  if (view.physical) {
    const intel = ensurePhysicalIntel(world);
    const requested = world.observerScope ?? hq(iso);
    const scopeId = [hq(iso), `${iso}:faction`, `${iso}:coalition`, ...view.physical.actors.filter(a => a.iso === iso).map(a => `${a.id}:local`)].includes(requested)
      ? requested : hq(iso);
    const tick = Math.round(world.simTimeSec * 10);
    view.observerScope = scopeId;
    view.intelView = projectIntel(world, scopeId, tick);
    const scopedContacts = observedContacts(world, scopeId, tick);
    view.fogOfWarContacts = { playerContacts: faction === 'player' ? scopedContacts : [], enemyContacts: faction === 'enemy' ? scopedContacts : [] };
    const own = view.physical.actors.filter(a => a.iso === iso);
    view.physical.actors = own;
    view.physical.rounds = view.physical.rounds.filter(r => r.iso === iso || scopeTracks(intel, scopeId).some(t => t.targetRef === r.id && t.state !== 'lost'));
    // Hostile weapon identities/intent are not part of the observed kinematics.
    view.physical.rounds = view.physical.rounds.map(r => ({ ...r,
      shooterId: r.iso === iso ? r.shooterId : '', targetId: r.iso === iso ? intel.contacts[r.targetId] ?? '' : '',
      launchPosition: r.iso === iso ? r.launchPosition : [...r.position], age: r.iso === iso ? r.age : 0,
      aimPosition: undefined, aimVelocity: undefined, aimObservedTick: undefined, trackRevision: undefined, sourceScope: undefined, seekerLocked: undefined }));
    view.physical.events = view.physical.events.filter(e => e.visibleTo.includes(scopeId)).map(e => ({ ...e, visibleTo: [scopeId], deliveries: undefined }));
    view.physical.sequence = 0;
    delete view.physical.intel;
    if (view.physical.opposition && faction === 'player') {
      view.physical.opposition.decisions = [];
      view.physical.opposition.nextDecisionTick = 0;
      view.physical.opposition.sequence = 0;
    }
    const allowedEvents = new Set(view.physical.events.map(e => e.id));
    view.eventLog = view.eventLog.filter(e => {
      const sequence = /^physical-(\d+)-/.exec(e.id);
      return !sequence || allowedEvents.has(Number(sequence[1]));
    });
    const visibleRounds = new Set(view.physical.rounds.map(r => r.id));
    view.activeMissiles = view.activeMissiles.filter(m => visibleRounds.has(m.id)).map(m => {
      const contactId = intel.contacts[m.targetEntityId] ?? '';
      const estimate = scopedContacts.find(c => c.contactId === contactId);
      return { ...m, targetEntityId: contactId, targetIso: 'unknown', targetLngLat: estimate?.lastKnownLngLat ?? m.currentLngLat };
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
