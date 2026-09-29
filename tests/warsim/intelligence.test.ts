import { describe, expect, it } from 'vitest';
import { createPhysicalReference } from '../../lib/warsim/physics/reference';
import { stepPhysical, launchPhysical } from '../../lib/warsim/physics/model';
import { forwardPhysicalReport, hq, local, observedContacts, requestPhysicalCollection,
  reservePhysicalMission, setPhysicalEmission, setPhysicalLink, setCoalitionSharing } from '../../lib/warsim/intelligence';
import { projectObserver } from '../../lib/warsim/projection';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import type { WarSimSession } from '../../lib/warSimTypes';

function advance(s: WarSimSession, ticks: number) {
  for (let n = 0; n < ticks; n++) { stepPhysical(s, .1); s.simTimeSec = Math.round((s.simTimeSec + .1) * 10) / 10; }
}
const intel = (s: WarSimSession) => s.physical!.intel!;

describe('physical reference / intelligence and coordination', () => {
  it('collects locally, processes evidence, then delivers to HQ and faction on separate ticks', () => {
    const s = createPhysicalReference(), initial = observedContacts(s, hq(s.playerIso), 0)[0];
    expect(observedContacts(s, local('blue-scout'), 0)).toHaveLength(0);
    advance(s, 4);
    expect(observedContacts(s, local('blue-scout'), 4)[0].evidenceIds).toHaveLength(1);
    expect(observedContacts(s, hq(s.playerIso), 4)[0].evidenceIds).toEqual(initial.evidenceIds);
    expect(observedContacts(s, `${s.playerIso}:faction`, 4)).toHaveLength(0);
    advance(s, 10);
    expect(observedContacts(s, hq(s.playerIso), 14)[0].evidenceIds?.length).toBeGreaterThan(1);
    expect(observedContacts(s, `${s.playerIso}:faction`, 14)).toHaveLength(0);
    advance(s, 5);
    expect(observedContacts(s, `${s.playerIso}:faction`, 19)).toHaveLength(1);
    expect(intel(s).messages.some(m => m.from === local('blue-scout') && m.status === 'delivered')).toBe(true);
  });

  it('keeps undiscovered truth and enemy resources out of every player projection', () => {
    const s = createPhysicalReference(), red = s.physical!.actors.find(a => a.id === 'red-frigate')!;
    intel(s).tracks = []; intel(s).observations = []; intel(s).contacts = {};
    red.position = [20000, 0, 0];
    for (const sensor of intel(s).sensors) if (sensor.actorId.startsWith('blue-')) sensor.mode = 'passive';
    advance(s, 2);
    for (const scope of [hq(s.playerIso), `${s.playerIso}:faction`, `${s.playerIso}:coalition`, local('blue-frigate')]) {
      s.observerScope = scope;
      const view = projectObserver(s);
      expect(view.physical!.actors.every(a => a.iso === s.playerIso)).toBe(true);
      expect(view.entities.every(a => a.iso === s.playerIso)).toBe(true);
      expect(view.fogOfWarContacts.playerContacts).toEqual([]);
      expect(JSON.stringify(view)).not.toContain('red-frigate');
      expect(view.physical!.intel).toBeUndefined();
    }
    expect(() => launchPhysical(s, 'blue-frigate', 'red-frigate')).toThrow(/contact/);
    s.observerScope = hq(s.enemyIso);
    expect(projectObserver(s).observerScope).toBe(hq(s.playerIso));
    expect(() => new SimulationRuntime(s, [])).toThrow(/observer scope/);
  });

  it('records negative area coverage after sensor processing and reporting delay', () => {
    const s = createPhysicalReference();
    requestPhysicalCollection(s, 'blue-scout', [-1400, 2700, 0], 100, 0);
    advance(s, 4);
    expect(intel(s).tasks[0].status).toBe('disseminating');
    expect(projectObserver(s).intelView!.coverage).toEqual([]);
    advance(s, 10);
    expect(intel(s).tasks[0].status).toBe('complete');
    expect(projectObserver(s).intelView!.coverage.at(-1)?.result).toBe('no-contact');
    expect(intel(s).sensors.find(x => x.actorId === 'blue-scout')!.sensorTime).toBeLessThan(100);
  });

  it('reports positive collection and interrupts an undelivered report when its link fails', () => {
    const s = createPhysicalReference();
    requestPhysicalCollection(s, 'blue-scout', [3000, 1800, 0], 500, 0);
    advance(s, 4);
    expect(intel(s).tasks[0].evidenceIds.length).toBeGreaterThan(0);
    expect(intel(s).tasks[0].status).toBe('disseminating');
    setPhysicalLink(s, 'blue-scout', false);
    advance(s, 10);
    expect(intel(s).tasks[0].status).toBe('interrupted');
    expect(intel(s).messages.some(m => m.observationId === intel(s).tasks[0].evidenceIds[0] && m.status === 'expired')).toBe(true);
    expect(projectObserver(s).intelView!.coverage).toEqual([]);
    const connected = createPhysicalReference();
    requestPhysicalCollection(connected, 'blue-scout', [3000, 1800, 0], 500, 0);
    advance(connected, 14);
    expect(intel(connected).tasks[0].status).toBe('complete');
    expect(projectObserver(connected).intelView!.coverage.at(-1)?.result).toBe('contact');
  });

  it('ages contacts without following hidden truth and removes lost tracks', () => {
    const s = createPhysicalReference(); advance(s, 24);
    const first = observedContacts(s, hq(s.playerIso), 24)[0];
    setPhysicalEmission(s, 'blue-scout', 'passive');
    setPhysicalEmission(s, 'blue-frigate', 'passive');
    s.physical!.actors.find(a => a.id === 'red-frigate')!.position = [20000, 0, 0];
    advance(s, 20);
    const stale = observedContacts(s, hq(s.playerIso), 44)[0];
    expect(stale.trackState).toBe('stale');
    expect(stale.confidence).toBeLessThan(first.confidence!);
    expect(Math.abs(stale.lastKnownLngLat[0] - first.lastKnownLngLat[0])).toBeLessThan(.01);
    advance(s, 40);
    expect(observedContacts(s, hq(s.playerIso), 84)).toEqual([]);
  });

  it('keeps a guided round on its last estimate until its seeker can acquire a plausible contact', () => {
    const s = createPhysicalReference(), track = s.fogOfWarContacts.playerContacts[0];
    launchPhysical(s, 'blue-frigate', track.contactId);
    const round = s.physical!.rounds[0], firstAim = [...round.aimPosition!];
    s.physical!.actors.find(a => a.id === 'red-frigate')!.position = [8000, 0, 0];
    setPhysicalEmission(s, 'blue-scout', 'passive'); setPhysicalEmission(s, 'blue-frigate', 'passive');
    advance(s, 4);
    expect(round.seekerLocked).toBeUndefined();
    expect(round.aimPosition).toEqual(firstAim);
    expect(intel(s).tracks.filter(t => t.scopeId === local(round.id))).toEqual([]);
  });

  it('interrupts sharing and holds a reserved strike when the support link is lost', () => {
    const s = createPhysicalReference(); advance(s, 14);
    s.physical!.actors[0].rounds = 1;
    const track = observedContacts(s, hq(s.playerIso), 14)[0];
    reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14);
    expect(intel(s).reservations).toHaveLength(2);
    expect(() => reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14)).toThrow(/committed/);
    expect(() => launchPhysical(s, 'blue-frigate', track.contactId, track.revision)).toThrow(/magazine/);
    setPhysicalLink(s, 'blue-scout', false);
    advance(s, 1);
    expect(intel(s).missions[0].status).toBe('held');
    expect(s.physical!.rounds).toHaveLength(0);
    setPhysicalLink(s, 'blue-scout', true);
    advance(s, 10);
    expect(intel(s).missions[0].status).toBe('executed');
    expect(intel(s).reservations).toHaveLength(0);
    expect(s.physical!.actors[0].rounds).toBe(0);
  });
  it('rejects a strike reservation backed only by stale local support', () => {
    const s = createPhysicalReference(); advance(s, 14);
    const track = observedContacts(s, hq(s.playerIso), 14)[0];
    const localTrack = intel(s).tracks.find(t => t.scopeId === local('blue-scout') && t.targetRef === 'red-frigate')!;
    localTrack.observedTick = -100;
    expect(() => reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14))
      .toThrow(/fresh local observation/);
  });

  it('aborts on lost support or continues only when the shooter has its own current track', () => {
    const abort = createPhysicalReference(); advance(abort, 14);
    const aTrack = observedContacts(abort, hq(abort.playerIso), 14)[0];
    reservePhysicalMission(abort, 'blue-frigate', aTrack.contactId, 'blue-scout', aTrack.revision!, 'abort', 14);
    setPhysicalLink(abort, 'blue-scout', false); advance(abort, 1);
    expect(intel(abort).missions[0].status).toBe('aborted');
    expect(intel(abort).reservations).toEqual([]);
    expect(abort.physical!.rounds).toEqual([]);

    const localShooter = createPhysicalReference();
    intel(localShooter).sensors.find(x => x.actorId === 'blue-frigate')!.rangeM = 9000;
    advance(localShooter, 14);
    const lTrack = observedContacts(localShooter, hq(localShooter.playerIso), 14)[0];
    reservePhysicalMission(localShooter, 'blue-frigate', lTrack.contactId, 'blue-scout', lTrack.revision!, 'continue-local', 14);
    setPhysicalLink(localShooter, 'blue-scout', false); advance(localShooter, 1);
    expect(intel(localShooter).missions[0].status).toBe('executed');
    expect(intel(localShooter).missions[0].reason).toMatch(/local track/);
    expect(localShooter.physical!.actors[0].rounds).toBe(7);
  });

  it('does not treat forwarding the same evidence twice as independent confirmation', () => {
    const s = createPhysicalReference(); advance(s, 19);
    const i = intel(s), evidenceId = i.tracks.find(t => t.scopeId === `${s.playerIso}:faction`)!.evidenceIds[0];
    setPhysicalEmission(s, 'blue-scout', 'passive');
    setCoalitionSharing(s, true);
    forwardPhysicalReport(s, evidenceId, 'coalition', 19);
    forwardPhysicalReport(s, evidenceId, 'coalition', 19);
    expect(i.messages.filter(m => m.observationId === evidenceId && m.to === `${s.playerIso}:coalition`)).toHaveLength(1);
    advance(s, 21);
    const track = i.tracks.find(t => t.scopeId === `${s.playerIso}:coalition`)!, confidence = track.confidence;
    forwardPhysicalReport(s, evidenceId, 'coalition', 40);
    expect(i.messages.filter(m => m.observationId === evidenceId && m.to === `${s.playerIso}:coalition`)).toHaveLength(1);
    expect(track.evidenceIds.filter(id => id === evidenceId)).toHaveLength(1);
    expect(track.confidence).toBe(confidence);
  });

  it('replays a pending intelligence mission and delayed messages exactly across a save', () => {
    const s = createPhysicalReference(); advance(s, 14);
    const track = observedContacts(s, hq(s.playerIso), 14)[0];
    reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14);
    setPhysicalLink(s, 'blue-scout', false); s.status = 'running';
    const first = new SimulationRuntime(s, [], 7);
    for (let tick = 0; tick < 8; tick++) first.step();
    const restored = new SimulationRuntime(first.checkpoint(), []);
    for (let tick = 0; tick < 50; tick++) { first.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(first.checkpoint());
    expect(first.observer().intelView!.missions[0].status).toBe('held');
  });

  it('delays locally observed weapon effects until the command link delivers them', () => {
    const s = createPhysicalReference();
    s.physical!.actors.find(a => a.id === 'blue-frigate')!.interceptors = 0;
    s.activeFaction = 'enemy'; s.observerScope = hq(s.enemyIso);
    launchPhysical(s, 'red-frigate', observedContacts(s, hq(s.enemyIso), 0)[0].contactId);
    s.activeFaction = 'player'; s.observerScope = hq(s.playerIso);
    let impact = s.physical!.events.find(e => e.kind === 'impact');
    for (let tick = 0; tick < 350 && !impact; tick++) { advance(s, 1); impact = s.physical!.events.find(e => e.kind === 'impact'); }
    expect(impact).toBeDefined();
    expect(impact!.visibleTo).toContain(local('blue-frigate'));
    expect(projectObserver(s).physical!.events.some(e => e.id === impact!.id)).toBe(false);
    advance(s, 11);
    expect(projectObserver(s).physical!.events.some(e => e.id === impact!.id)).toBe(true);
    expect(projectObserver(s).eventLog.some(e => e.type === 'impact')).toBe(true);
  });

  it('imports old physical contacts from reported positions without creating hidden contacts', () => {
    const s = createPhysicalReference();
    const reported = s.fogOfWarContacts.playerContacts[0].lastKnownLngLat;
    s.fogOfWarContacts.playerContacts[0].targetEntityId = 'red-frigate';
    s.simTimeSec = 5; delete s.physical!.intel;
    s.fogOfWarContacts.enemyContacts = [];
    const runtime = new SimulationRuntime(s, []);
    const restored = runtime.observer();
    expect(restored.fogOfWarContacts.playerContacts).toHaveLength(1);
    expect(restored.fogOfWarContacts.playerContacts[0].lastKnownLngLat[0]).toBeCloseTo(reported[0], 5);
    expect(runtime.checkpoint().physical!.intel!.observations[0].sourceId).toBe('legacy-contact-import');
    const enemy = runtime.checkpoint(); enemy.activeFaction = 'enemy'; enemy.observerScope = hq(enemy.enemyIso);
    expect(projectObserver(enemy).fogOfWarContacts.enemyContacts).toEqual([]);
  });
});
