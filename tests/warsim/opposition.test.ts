import { describe, expect, it } from 'vitest';
import { createLittoralReference } from '../../lib/warsim/physics/reference';
import { hq } from '../../lib/warsim/intelligence';
import { projectObserver } from '../../lib/warsim/projection';
import { decideOpponent } from '../../lib/warsim/opposition';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import { fromENU } from '../../lib/warsim/physics/coordinates';

const redView = (s: ReturnType<typeof createLittoralReference>) =>
  projectObserver({ ...s, activeFaction: 'enemy', observerScope: hq(s.enemyIso) });

describe('Phase 6 scoped opposition', () => {
  it('makes the same decision at every difficulty when hidden blue truth changes but red reports do not', () => {
    const s = createLittoralReference(), view = redView(s);
    expect(view.physical!.actors.every(a => a.iso === s.enemyIso)).toBe(true);
    const changed = structuredClone(s);
    changed.physical!.actors.find(a => a.id === 'blue-frigate')!.position = [9000, -7000, 0];
    changed.physical!.actors.find(a => a.id === 'blue-frigate')!.health = 1;
    for (const difficulty of ['cadet', 'standard', 'veteran'] as const) {
      s.physical!.opposition!.difficulty = difficulty;
      changed.physical!.opposition!.difficulty = difficulty;
      const first = decideOpponent(redView(s));
      expect(decideOpponent(redView(changed))).toEqual(first);
      if (difficulty === 'standard') expect(first.priority).toBe('collection');
      expect(JSON.stringify(first)).not.toContain('blue-frigate');
    }
  });

  it('uses readiness and the shared course command for formation, and waits when ammunition is empty', () => {
    const s = createLittoralReference(), sub = s.physical!.actors.find(a => a.id === 'red-sub')!;
    sub.condition!.sensor = 0;
    sub.position = [7000, 7000, -40];
    const formation = decideOpponent(redView(s));
    expect(formation.priority).toBe('formation');
    expect(formation.command?.type).toBe('setPhysicalCourse');
    const advancing = structuredClone(s); advancing.status = 'running';
    const runtime = new SimulationRuntime(advancing, [], 11);
    runtime.step();
    expect(runtime.checkpoint().physical!.opposition!.decisions[0].result).toBe('accepted');
    expect(runtime.checkpoint().physical!.actors.find(a => a.id === 'red-sub')!.desiredSpeed).toBe(6);
    s.physical!.actors.find(a => a.id === 'red-frigate')!.rounds = 0;
    const noMagazine = decideOpponent(redView(s));
    expect(noMagazine.priority).toBe('wait');
    expect(noMagazine.command).toBeUndefined();
  });

  it('keeps the briefed objective contact ahead of a higher confidence escort report', () => {
    const s = createLittoralReference(), view = redView(s);
    const first = decideOpponent(view);
    const escort = fromENU([-1400, 2700, 0], s.physical!.origin);
    view.fogOfWarContacts.enemyContacts.push({ ...view.fogOfWarContacts.enemyContacts[0],
      contactId: 'escort-report', confidence: .99, sourceIds: ['red-frigate'],
      lastKnownLngLat: [escort[0], escort[1]] });
    expect(decideOpponent(view)).toEqual(first);
    expect(first.priority).toBe('collection');
    expect(projectObserver(s).physical!.objectives!.redTargetContactId).toBeUndefined();
  });

  it('accepts pre-start doctrine settings and saves the same autonomous sequence through restore', () => {
    const s = createLittoralReference(), runtime = new SimulationRuntime(s, [], 7);
    runtime.submit({ version: 1, sequence: 1, executeAtTick: 0,
      scope: { faction: 'player', commandGroupId: hq(s.playerIso) },
      command: { type: 'configureOpponent', args: ['aggressive', 'veteran', true] } });
    expect(runtime.takeReceipts()[0].status).toBe('accepted');
    expect(runtime.checkpoint().physical!.opposition!.difficulty).toBe('veteran');
    const started = runtime.checkpoint(); started.status = 'running';
    const first = new SimulationRuntime(started, [], 7);
    for (let n = 0; n < 42; n++) first.step();
    const restored = new SimulationRuntime(first.checkpoint(), []);
    for (let n = 0; n < 80; n++) { first.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(first.checkpoint());
    const decisions = first.checkpoint().physical!.opposition!.decisions;
    expect(decisions.some(d => d.priority === 'collection' && d.result === 'accepted')).toBe(true);
    expect(decisions.some(d => d.priority === 'coordinated-strike' && d.result === 'accepted')).toBe(true);
    expect(first.observer().physical!.opposition!.decisions).toEqual([]);
    expect(first.observer().physical!.opposition!.nextDecisionTick).toBe(0);
    const damaged = first.checkpoint();
    damaged.physical!.opposition!.decisions[0].utility = Number.NaN;
    expect(() => new SimulationRuntime(damaged, [])).toThrow('Invalid opposition or objective checkpoint');
  });

  it('finishes the benchmark without red user orders and never overdraws ammunition', () => {
    const s = createLittoralReference(); s.status = 'running';
    const runtime = new SimulationRuntime(s, [], 19);
    for (let n = 0; n < 901 && runtime.running; n++) runtime.step();
    const saved = runtime.checkpoint(), red = saved.physical!.actors.find(a => a.id === 'red-frigate')!;
    expect(saved.physical!.objectives!.status).toBe('red-victory');
    expect(saved.status).toBe('concluded');
    expect(saved.physical!.actors.find(a => a.id === 'blue-frigate')!.health).toBe(0);
    expect(red.rounds).toBeGreaterThanOrEqual(0);
    expect(saved.physical!.intel!.reservations.filter(r => r.assetId === red.id && r.resource === 'strike-round').length)
      .toBeLessThanOrEqual(red.rounds);
    expect(saved.physical!.opposition!.decisions.some(d => d.priority === 'coordinated-strike')).toBe(true);
    runtime.submit({ version: 1, sequence: saved.runtime!.nextSequence, executeAtTick: runtime.tick,
      scope: { faction: saved.activeFaction, commandGroupId: saved.observerScope! }, command: { type: 'togglePlay', args: [] } });
    expect(runtime.takeReceipts()[0].status).toBe('rejected');
    expect(runtime.checkpoint().status).toBe('concluded');
  });

  it('lets cautious red complete supported strikes after report delivery and acknowledgement', () => {
    const s = createLittoralReference(); s.status = 'running'; s.physical!.opposition!.doctrine = 'cautious';
    const runtime = new SimulationRuntime(s, [], 7);
    for (let n = 0; n < 901 && runtime.running; n++) runtime.step();
    const saved = runtime.checkpoint();
    expect(saved.physical!.objectives!.status).toBe('red-victory');
    expect(saved.physical!.actors.find(a => a.id === 'red-frigate')!.rounds).toBeLessThan(8);
    expect(saved.physical!.opposition!.decisions.some(d => d.priority === 'coordinated-strike' && d.result === 'accepted')).toBe(true);
    expect(saved.physical!.opposition!.decisions.some(d => d.priority === 'local-strike')).toBe(false);
  });
});
