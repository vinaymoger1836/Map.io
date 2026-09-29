import { describe, expect, it } from 'vitest';
import { createLittoralReference } from '../../lib/warsim/physics/reference';
import { hq } from '../../lib/warsim/intelligence';
import { projectObserver } from '../../lib/warsim/projection';
import { decideOpponent } from '../../lib/warsim/opposition';
import { SimulationRuntime } from '../../lib/warsim/runtime';

const redView = (s: ReturnType<typeof createLittoralReference>) =>
  projectObserver({ ...s, activeFaction: 'enemy', observerScope: hq(s.enemyIso) });

describe('Phase 6 scoped opposition', () => {
  it('makes the same decision when hidden blue truth changes but red reports do not', () => {
    const s = createLittoralReference(), view = redView(s);
    expect(view.physical!.actors.every(a => a.iso === s.enemyIso)).toBe(true);
    const first = decideOpponent(view);
    const changed = structuredClone(s);
    changed.physical!.actors.find(a => a.id === 'blue-frigate')!.position = [9000, -7000, 0];
    changed.physical!.actors.find(a => a.id === 'blue-frigate')!.health = 1;
    expect(decideOpponent(redView(changed))).toEqual(first);
    expect(first.priority).toBe('collection');
    expect(JSON.stringify(first)).not.toContain('blue-frigate');
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
  });

  it('finishes the benchmark without red user orders and never overdraws ammunition', () => {
    const s = createLittoralReference(); s.status = 'running';
    const runtime = new SimulationRuntime(s, [], 19);
    for (let n = 0; n < 901 && runtime.running; n++) runtime.step();
    const saved = runtime.checkpoint(), red = saved.physical!.actors.find(a => a.id === 'red-frigate')!;
    expect(saved.physical!.objectives!.status).not.toBe('ongoing');
    expect(saved.status).toBe('concluded');
    expect(red.rounds).toBeGreaterThanOrEqual(0);
    expect(saved.physical!.intel!.reservations.filter(r => r.assetId === red.id && r.resource === 'strike-round').length)
      .toBeLessThanOrEqual(red.rounds);
    expect(saved.physical!.opposition!.decisions.some(d => d.priority === 'coordinated-strike')).toBe(true);
  });
});
