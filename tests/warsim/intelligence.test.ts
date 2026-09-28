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
    expect(observedContacts(s, hq(s.playerIso), 14)[0].evidenceIds.length).toBeGreaterThan(1);
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

  it('interrupts sharing and holds a reserved strike when the support link is lost', () => {
    const s = createPhysicalReference(); advance(s, 14);
    s.physical!.actors[0].rounds = 1;
    const track = observedContacts(s, hq(s.playerIso), 14)[0];
    reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14);
    expect(intel(s).reservations).toHaveLength(2);
    expect(() => launchPhysical(s, 'blue-frigate', track.contactId, track.revision)).toThrow(/magazine/);
    setPhysicalLink(s, 'blue-scout', false);
    advance(s, 1);
    expect(intel(s).missions[0].status).toBe('held');
    expect(s.physical!.rounds).toHaveLength(0);
    setPhysicalLink(s, 'blue-scout', true);
    advance(s, 4);
    expect(intel(s).missions[0].status).toBe('executed');
    expect(intel(s).reservations).toHaveLength(0);
    expect(s.physical!.actors[0].rounds).toBe(0);
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
});
