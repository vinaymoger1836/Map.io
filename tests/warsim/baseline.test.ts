import { describe, expect, it } from 'vitest';
import { distanceKm } from '../../lib/geo';
import { tickWarSim, launchSimStrikeSalvoDirectly } from '../../lib/warSimEngine';
import { createFixture, FIXTURE_IDS } from './fixtures/v1/scenarios';
import { withLegacyRuntime } from './helpers/legacyRuntime';

describe('versioned, isolated scenario inputs', () => {
  it.each(FIXTURE_IDS)('%s survives JSON round-trip and is fresh per run', (id) => {
    const first = createFixture(id);
    const saved = JSON.stringify(first);
    first.session.entities[0].currentFuelPct = 1;
    first.systems[0].name = 'Changed by test';
    expect(JSON.stringify(createFixture(id))).toBe(saved);
    expect(JSON.parse(saved).schemaVersion).toBe(1);
    const systems = new Set(first.systems.map((s) => s.id));
    expect(first.session.entities.every((e) => systems.has(e.systemId!))).toBe(true);
  });
});

describe('legacy movement and contact behavior', () => {
  it('does not advance a paused session', () => {
    const f = createFixture('transit');
    f.session.status = 'paused';
    const before = JSON.stringify(f.session);
    const after = tickWarSim(f.session, 60, f.systems);
    expect(after).toBe(f.session);
    expect(JSON.stringify(after)).toBe(before);
  });

  it('travels the expected distance and burns fuel at 1x and 3x', () => {
    for (const rate of [1, 3]) {
      const f = createFixture('transit');
      f.session.timeMultiplier = rate;
      const origin = [...f.session.entities[0].lngLat] as [number, number];
      const result = withLegacyRuntime(f.seed, () => tickWarSim(f.session, 10, f.systems));
      expect(result.simTimeSec).toBe(10 * rate);
      expect(distanceKm(origin, result.entities[0].lngLat)).toBeCloseTo(720 / 3600 * 10 * rate, 4);
      expect(result.entities[0].currentFuelPct).toBeLessThan(100);
      expect(result.entities[0].currentFuelPct).toBeGreaterThan(0);
    }
  });

  it('acquires an asymmetric contact and expires its last known position after losing the sensor', () => {
    const f = createFixture('sensor-contact');
    withLegacyRuntime(f.seed, () => {
      let state = tickWarSim(f.session, 1, f.systems);
      const contact = state.fogOfWarContacts.playerContacts.find((c) => c.targetEntityId === 'red-target');
      expect(contact).toBeDefined();
      expect(state.fogOfWarContacts.enemyContacts).toHaveLength(0);
      const lastPosition = [...contact!.lastKnownLngLat];
      state.entities.find((e) => e.id === 'blue-scout')!.status = 'destroyed';
      state.entities.find((e) => e.id === 'red-target')!.lngLat = [-140, 0];
      state = tickWarSim(state, 1, f.systems);
      expect(state.fogOfWarContacts.playerContacts[0].lastKnownLngLat).toEqual(lastPosition);
      expect(state.fogOfWarContacts.playerContacts[0].decayTimerSec).toBeLessThan(180);
      state = tickWarSim(state, 180, f.systems);
      expect(state.fogOfWarContacts.playerContacts).toHaveLength(0);
    });
  });
});

describe('legacy single-platform engagement', () => {
  it('caps the salvo at available rounds and rejects a second launch from an empty magazine', () => {
    const f = createFixture('engagement');
    withLegacyRuntime(f.seed, () => {
      const launch = launchSimStrikeSalvoDirectly(f.session, 'blue-shooter', 'red-target', [-149.85, 0], 0, 20, 'loiter_target', f.systems);
      expect(launch.status).toBe('executing');
      expect(launch.launchedCount).toBe(8);
      expect(launch.session.activeMissiles).toHaveLength(8);
      expect(new Set(launch.session.activeMissiles.map((m) => m.id)).size).toBe(8);
      const retry = launchSimStrikeSalvoDirectly(launch.session, 'blue-shooter', 'red-target', [-149.85, 0], 0, 1, 'loiter_target', f.systems);
      expect(retry.status).toBe('failed');
      expect(retry.launchedCount).toBe(0);
      expect(retry.session.activeMissiles).toHaveLength(8);
      expect(f.systems.find((s) => s.id === 'fixture-ship')!.weapons![0].magazine).toBe(8);
    });
  });

  it('advances a launched round and eventually produces a concluded salvo report', () => {
    const f = createFixture('engagement');
    withLegacyRuntime(f.seed, () => {
      let state = launchSimStrikeSalvoDirectly(f.session, 'blue-shooter', 'red-target', [-149.85, 0], 0, 1, 'loiter_target', f.systems).session;
      state = tickWarSim(state, 1, f.systems);
      expect(state.activeMissiles[0].progress).toBeGreaterThan(0);
      for (let i = 0; i < 100; i++) state = tickWarSim(state, 1, f.systems);
      expect(state.salvoTrackers?.[0].isConcluded).toBe(true);
      expect(state.activeMissiles.filter((m) => !m.isIntercepted)).toHaveLength(0);
      expect(state.reports?.some((r) => r.category === 'offensive_strike')).toBe(true);
    });
  });
});

describe('joint operations migration contract', () => {
  it('declares the collection/share/interruption sequence separately from unsupported legacy behavior', () => {
    const f = createFixture('joint-operations');
    expect(f.collectionScript?.map((s) => s.action)).toEqual(['request-collection', 'observe', 'deliver-report', 'interrupt-support']);
    expect(f.collectionScript?.filter((s) => s.support === 'planned')).toHaveLength(3);
    const state = withLegacyRuntime(f.seed, () => tickWarSim(f.session, 1, f.systems));
    expect(state.fogOfWarContacts.playerContacts.some((c) => c.targetEntityId === 'red-target')).toBe(true);
    expect(state.fogOfWarContacts.enemyContacts).toHaveLength(0);
  });

  it.todo('Phase 3: hold collected evidence locally until the report delivery tick');
  it.todo('Phase 3: interrupted datalink prevents new sharing and degrades dependent missions');
  it.todo('Phase 3: duplicate evidence cannot increase confidence as independent confirmation');
});

describe('harness isolation', () => {
  it('restores globals even if a legacy run throws', () => {
    const random = Math.random;
    const now = Date.now;
    expect(() => withLegacyRuntime(1, () => { throw new Error('intentional'); })).toThrow('intentional');
    expect(Math.random).toBe(random);
    expect(Date.now).toBe(now);
  });
});
