import { describe, expect, it } from 'vitest';
import { ecef, geodetic, fromENU, toENU, sweptSphere, length, sub } from '../../lib/warsim/physics/coordinates';
import { integrate, launchPhysical, stepPhysical, syncPhysical, PROFILE } from '../../lib/warsim/physics/model';
import { createLittoralReference, createPhysicalReference } from '../../lib/warsim/physics/reference';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import { projectObserver } from '../../lib/warsim/projection';
import { acquireSeeker } from '../../lib/warsim/intelligence';

describe('physical reference / coordinates and integration', () => {
  it('round-trips WGS84 at equator, date line, altitude and high latitude within a millimetre', () => {
    for (const geo of [[0, 0, 0], [179.99, 72, 1500], [-179.99, -65, 0], [42, 89, 12000]] as [number, number, number][]) {
      expect(length(sub(ecef(geodetic(ecef(geo))), ecef(geo)))).toBeLessThan(.001);
      const local: [number, number, number] = [10000, -8000, 500];
      expect(length(sub(toENU(fromENU(local, geo), geo), local))).toBeLessThan(.001);
    }
    const across = toENU([-179.999, 0, 0], [179.999, 0, 0]);
    expect(across[0]).toBeCloseTo(222.639, 2);
  });
  it('matches an analytic vacuum trajectory within 1e-7 metres after ten seconds', () => {
    let p: [number, number, number] = [0, 0, 1000], v: [number, number, number] = [100, 0, 50];
    for (let i = 0; i < 500; i++) ({ position: p, velocity: v } = integrate(p, v, [0, 0, -9.80665], .02));
    expect(p[0]).toBeCloseTo(1000, 7); expect(p[2]).toBeCloseTo(1000 + 500 - .5 * 9.80665 * 100, 7);
  });
  it('detects fast crossing, moving targets, starting overlap and misses', () => {
    expect(sweptSphere([-100, 0, 0], [100, 0, 0], [0, 0, 0], [0, 0, 0], 1)).toBeCloseTo(.495);
    expect(sweptSphere([-100, 0, 0], [100, 0, 0], [100, 0, 0], [-100, 0, 0], 1)).toBeCloseTo(.4975);
    expect(sweptSphere([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], 1)).toBe(0);
    expect(sweptSphere([-100, 2, 0], [100, 2, 0], [0, 0, 0], [0, 0, 0], 1)).toBeNull();
  });
});
describe('physical reference / authoritative encounter', () => {
  it('delivers a guided impact, consumes exactly one round, and records termination once', () => {
    const s = createPhysicalReference(); s.physical!.actors[1].interceptors = 0;
    launchPhysical(s, 'blue-frigate', s.fogOfWarContacts.playerContacts[0].contactId);
    expect(s.physical!.actors[0].rounds).toBe(7);
    for (let i = 0; i < 450; i++) { stepPhysical(s, .1); s.simTimeSec += .1; }
    expect(s.physical!.actors[1].health).toBe(45);
    expect(s.physical!.rounds).toHaveLength(0);
    expect(s.physical!.events.filter(e => e.kind === 'launch')).toHaveLength(1);
    expect(s.physical!.events.filter(e => e.kind === 'impact')).toHaveLength(1);
  });
  it('can hit the joint-probe surface objective when defenses are disabled', () => {
    const s = createLittoralReference();
    s.activeFaction = 'enemy'; s.observerScope = `${s.enemyIso}:hq`;
    s.physical!.actors.find(a => a.id === 'blue-frigate')!.interceptors = 0;
    launchPhysical(s, 'red-frigate', s.fogOfWarContacts.enemyContacts.find(c => c.domain === 'sea')!.contactId);
    for (let n = 0; n < 450 && s.physical!.rounds.length; n++) { stepPhysical(s, .1); s.simTimeSec += .1; }
    expect(s.physical!.actors.find(a => a.id === 'blue-frigate')!.health).toBeLessThan(100);
  });
  it('keeps surface strike seekers on eligible platforms when an interceptor is nearby', () => {
    const s = createLittoralReference();
    s.activeFaction = 'enemy'; s.observerScope = `${s.enemyIso}:hq`;
    launchPhysical(s, 'red-frigate', s.fogOfWarContacts.enemyContacts.find(c => c.domain === 'sea')!.contactId);
    const strike = s.physical!.rounds[0];
    s.physical!.rounds.push({ ...structuredClone(strike), id: 'defensive-decoy', shooterId: 'blue-frigate',
      iso: s.playerIso, targetId: strike.id, interceptor: true, position: [240, -160, 0] });
    expect(acquireSeeker(s, strike.id, 0)?.targetRef).toBe('blue-frigate');
    expect(strike.targetId).toBe('blue-frigate');
  });
  it('records an unobserved water strike as a splash without damage or HQ truth', () => {
    const s = createPhysicalReference(), p = s.physical!;
    p.rounds.push({ id: 'round-splash', shooterId: 'blue-frigate', iso: s.playerIso, targetId: 'red-frigate',
      interceptor: false, position: [10000, 10000, 1], launchPosition: [10000, 10000, 1],
      velocity: [0, 0, -100], age: 0, sourceScope: `${s.playerIso}:hq` });
    stepPhysical(s, .1);
    expect(p.events.at(-1)?.kind).toBe('splash');
    expect(p.actors.find(a => a.id === 'red-frigate')!.health).toBe(100);
    expect(projectObserver(s).physical!.events.some(e => e.kind === 'splash')).toBe(false);
  });
  it('intercepts an incoming round and never gives a destroyed round a later impact', () => {
    const s = createPhysicalReference(); launchPhysical(s, 'blue-frigate', s.fogOfWarContacts.playerContacts[0].contactId);
    for (let i = 0; i < 450; i++) { stepPhysical(s, .1); s.simTimeSec += .1; }
    expect(s.physical!.events.some(e => e.kind === 'intercept')).toBe(true);
    expect(s.physical!.actors[1].health).toBe(100);
    expect(s.physical!.actors[1].interceptors).toBeLessThan(2);
    const terminated = s.physical!.events.flatMap(e => e.terminatedRoundIds);
    expect(new Set(terminated).size).toBe(terminated.length);
    expect(terminated).toHaveLength(s.physical!.events.filter(e => e.kind === 'launch').length);
    expect(s.physical!.rounds).toHaveLength(0);
  });
  it('enforces turn, acceleration and fuel bounds', () => {
    const s = createPhysicalReference(), a = s.physical!.actors[0]; a.course = 90; a.desiredSpeed = 16;
    stepPhysical(s, .1); expect(a.heading).toBeCloseTo(.2, 8); expect(a.speed).toBeCloseTo(8.04, 8); expect(a.fuel).toBeLessThan(100);
    a.fuel = 0; stepPhysical(s, .1); expect(a.speed).toBeCloseTo(7.96, 8); expect(a.fuel).toBe(0);
  });
  it('replays exactly after a checkpoint in flight, with commands applied atomically', () => {
    const s = createPhysicalReference(); s.status = 'running'; const r = new SimulationRuntime(s, [], 123);
    const command = { version: 1 as const, sequence: 1, executeAtTick: 0, scope: { faction: 'player' as const, commandGroupId: '840:hq' }, command: { type: 'launchPhysical' as const, args: ['blue-frigate', s.fogOfWarContacts.playerContacts[0].contactId] as [string, string] } };
    r.submit(command); expect(r.takeReceipts()[0].status).toBe('accepted');
    r.submit({ ...command, sequence: 2 }); expect(r.takeReceipts()[0].status).toBe('rejected');
    expect(r.checkpoint().physical!.actors[0].rounds).toBe(7);
    for (let i = 0; i < 50; i++) r.step();
    const restored = new SimulationRuntime(r.checkpoint(), []);
    for (let i = 0; i < 200; i++) { r.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(r.checkpoint());
  });
  it('filters hidden physical truth, magazines, intentions, events and contacts', () => {
    const s = createPhysicalReference(); const enemy = s.physical!.actors[1]; enemy.position = [20000, 0, 0];
    s.physical!.intel!.tracks = []; s.physical!.intel!.observations = []; s.physical!.intel!.contacts = {}; syncPhysical(s);
    s.physical!.events.push({ id: 100, kind: 'launch', time: 0, position: enemy.position, roundId: 'hidden', visibleTo: [s.enemyIso], terminatedRoundIds: [] });
    const view = projectObserver(s);
    expect(view.physical!.actors.map(a => a.id)).toEqual(['blue-frigate', 'blue-scout']); expect(view.physical!.events).toEqual([]);
    expect(view.fogOfWarContacts.playerContacts).toEqual([]);
    expect(() => launchPhysical(s, 'blue-frigate', 'red-frigate')).toThrow(/contact/);
    expect(() => launchPhysical(s, 'red-frigate', 'blue-frigate')).toThrow();
  });
  it('rejects unsupported profile versions and corrupt resources on restore', () => {
    const s = createPhysicalReference(); s.physical!.actors[0].rounds = -1;
    expect(() => new SimulationRuntime(s, [])).toThrow(/platform/);
    const p = createPhysicalReference(); (p.physical as any).version = 2;
    expect(() => new SimulationRuntime(p, [])).toThrow(/encounter/);
    expect(PROFILE.substep).toBe(.02);
  });
});
