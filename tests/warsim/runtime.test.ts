import { describe, expect, it } from 'vitest';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import { FixedStepScheduler } from '../../lib/warsim/scheduler';
import { simNow, simRandom, withSimulationContext } from '../../lib/warsim/context';
import type { CommandEnvelope, SimulationCommand } from '../../lib/warsim/contracts';
import { createFixture, type FixtureId } from './fixtures/v1/scenarios';

function runtime(id: FixtureId = 'engagement', speed = 1) {
  const fixture = createFixture(id);
  fixture.session.timeMultiplier = speed;
  return new SimulationRuntime(fixture.session, fixture.systems, fixture.seed);
}
function command(host: SimulationRuntime, value: SimulationCommand, executeAtTick = host.tick): CommandEnvelope {
  const saved = host.checkpoint();
  return { version: 1, sequence: saved.runtime!.nextSequence, executeAtTick,
    scope: { faction: saved.activeFaction, commandGroupId: `${saved.activeFaction}:hq` }, command: value };
}
function runTo(host: SimulationRuntime, tick: number) { while (host.tick < tick) { if (!host.step()) throw new Error('Unexpected pause'); } }

describe('authoritative fixed-step runtime', () => {
  it('repeats seeded command outcomes and IDs without modifying the input fixture', () => {
    const a = runtime(), b = runtime();
    for (const host of [a, b]) {
      host.submit(command(host, { type: 'createNetwork', args: ['Test group'] }));
      host.submit(command(host, { type: 'orderStrike', args: ['blue-shooter', 'red-target', [-149.85, 0], 0, 2, 'loiter_target'] }));
      runTo(host, 200);
    }
    expect(a.checkpoint()).toEqual(b.checkpoint());
    expect(a.checkpoint().runtime!.acceptedCommands).toHaveLength(2);
    expect(createFixture('engagement').session.simTimeSec).toBe(0);
  });

  it('produces the same model state at a fixed tick for 1x and 30x pacing', () => {
    const a = runtime('sensor-contact', 1), b = runtime('sensor-contact', 30);
    for (const host of [a, b]) {
      const scheduler = new FixedStepScheduler();
      for (let now = 0; host.tick < 30; now += 16) {
        if (scheduler.advance(now, host.speed, host.running, true)) host.step();
      }
    }
    expect({ ...a.checkpoint(), timeMultiplier: 1 }).toEqual({ ...b.checkpoint(), timeMultiplier: 1 });
    expect(a.checkpoint().simTimeSec).toBe(3);
  });

  it('restores RNG, pending commands, frozen equipment, messages and reservations', () => {
    const host = runtime();
    host.submit(command(host, { type: 'createNetwork', args: ['Delayed group'] }, 20));
    runTo(host, 10);
    const saved = JSON.parse(JSON.stringify(host.checkpoint()));
    saved.runtime.coordination.messages.push({ id: 'report-1', from: { faction: 'player', commandGroupId: 'scout' },
      to: { faction: 'player', commandGroupId: 'player:hq' }, evidenceIds: ['obs-1'], sentAtTick: 9,
      deliverAtTick: 50, linkId: 'link-1', status: 'queued' });
    saved.runtime.coordination.reservations.push({ id: 'reservation-1', missionId: 'mission-1', assetId: 'blue-shooter',
      resourceId: 'fixture-round', quantity: 2, reservedAtTick: 9, expiresAtTick: 50 });
    const resumed = new SimulationRuntime(saved, []);
    expect(resumed.checkpoint().runtime!.coordination).toEqual(saved.runtime.coordination);
    expect(resumed.checkpoint().runtime!.definitions.length).toBeGreaterThan(0);
    runTo(resumed, 40);
    runTo(host, 40);
    const expected = host.checkpoint();
    expected.runtime!.coordination = saved.runtime.coordination;
    expect(resumed.checkpoint()).toEqual(expected);
    expect(resumed.checkpoint().runtime!.pendingCommands).toHaveLength(0);
    expect(resumed.checkpoint().runtime!.acceptedCommands[0].appliedAtTick).toBe(20);
  });

  it('rejects duplicate sequences, wrong-faction commands and invalid values without spending inventory/RNG', () => {
    const host = runtime();
    const original = host.checkpoint();
    const first = command(host, { type: 'setEntityRcs', args: ['red-target', 10] });
    host.submit(first);
    host.submit(first);
    host.submit(command(host, { type: 'setSpeedMultiplier', args: [NaN] }));
    expect(host.takeReceipts().map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(host.checkpoint().entities).toEqual(original.entities);
    expect(host.checkpoint().runtime!.random).toEqual(original.runtime!.random);
    expect(host.checkpoint().runtime!.acceptedCommands).toHaveLength(0);
  });

  it('orders same-tick commands by sequence and preserves a paused simulation exactly', () => {
    const host = runtime('transit');
    host.submit(command(host, { type: 'setEntityRcs', args: ['blue-transit', 7] }, 5));
    host.submit(command(host, { type: 'setEntityRcs', args: ['blue-transit', 9] }, 5));
    runTo(host, 5);
    expect(host.checkpoint().entities[0].rcs).toBe(9);
    host.submit(command(host, { type: 'setPlayback', args: ['paused'] }));
    const paused = host.checkpoint();
    for (let i = 0; i < 10; i++) expect(host.step()).toBe(false);
    expect(host.checkpoint()).toEqual(paused);
  });

  it('projects one faction without enemy entities or the other observer’s cached contacts', () => {
    const host = runtime('sensor-contact');
    host.step();
    const blue = host.observer();
    expect(blue.entities.map(e => e.id)).toEqual(['blue-scout']);
    expect(blue.fogOfWarContacts.playerContacts).toHaveLength(1);
    expect(blue.runtime).toBeUndefined();
    host.submit(command(host, { type: 'switchActiveFaction', args: [] }));
    const red = host.observer();
    expect(red.entities.map(e => e.id)).toEqual(['red-target']);
    expect(red.fogOfWarContacts.playerContacts).toEqual([]);
    expect(red.fogOfWarContacts.enemyContacts).toEqual([]);
    expect(host.checkpoint().entities).toHaveLength(2);
    blue.entities[0].currentFuelPct = 0;
    expect(host.checkpoint().entities[0].currentFuelPct).not.toBe(0);
  });

  it('rejects future checkpoints and malformed legacy saves without mutating them', () => {
    const saved = runtime().checkpoint();
    const original = structuredClone(saved);
    expect(() => new SimulationRuntime({ ...saved, runtime: { ...saved.runtime!, schemaVersion: 999 as 1 } }, [])).toThrow(/checkpoint/);
    expect(saved).toEqual(original);
    expect(() => new SimulationRuntime({ ...saved, entities: [{ ...saved.entities[0], lngLat: [0, NaN] }] }, [])).toThrow();
  });
});

describe('scheduler and context isolation', () => {
  it('does not catch up hidden wall time or skip model ticks during overload', () => {
    const s = new FixedStepScheduler();
    expect(s.advance(0, 1, true, true)).toBe(false);
    expect(s.advance(100, 1, true, true)).toBe(true);
    expect(s.advance(200, 1, true, false)).toBe(false);
    expect(s.advance(600_000, 1, true, true)).toBe(false);
    expect(s.advance(600_100, 1, true, true)).toBe(true);
    expect(s.advance(900_000, 30, true, true)).toBe(true);
    expect(s.droppedWallMs).toBeGreaterThan(200_000);
    s.advance(900_001, 30, false, true);
    expect(s.advance(1_000_000, 1, true, true)).toBe(false);
  });

  it('keeps deterministic context local and restores it after a thrown operation', () => {
    const globalRandom = Math.random, globalNow = Date.now;
    const state = { combat: 1, identifiers: 2, idCounter: 0, epochMs: 1000 };
    expect(() => withSimulationContext(state, () => { simRandom(); expect(simNow()).toBe(1016); throw new Error('test'); })).toThrow('test');
    expect(Math.random).toBe(globalRandom);
    expect(Date.now).toBe(globalNow);
    expect(simNow()).toBeGreaterThan(1000);
    const second = { ...state };
    expect(withSimulationContext(state, () => simRandom())).toBe(withSimulationContext(second, () => simRandom()));
  });
});
