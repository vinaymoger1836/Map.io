import { describe, expect, it } from 'vitest';
import { createLittoralReference } from '../../lib/warsim/physics/reference';
import { factionReplay } from '../../lib/warsim/replay';
import { SimulationRuntime } from '../../lib/warsim/runtime';

describe('Phase 7 recorded replay', () => {
  it('keeps faction frames scoped and preserves the recorded sequence through restore', () => {
    const s = createLittoralReference(); s.status = 'running';
    const runtime = new SimulationRuntime(s, [], 29);
    for (let n = 0; n < 130; n++) runtime.step();
    const saved = runtime.checkpoint(), archive = saved.runtime!.replay!;
    expect(archive.frames.map(f => f.tick)).toEqual(Array.from({ length: 14 }, (_, n) => n * 10));
    expect(archive.records.some(r => r.kind === 'decision' && r.faction === 'enemy')).toBe(true);
    const blue = factionReplay(archive, 'player'), red = factionReplay(archive, 'enemy');
    expect(blue.frames.every(f => f.session.physical!.actors.every(a => a.iso === s.playerIso))).toBe(true);
    expect(red.frames.every(f => f.session.physical!.actors.every(a => a.iso === s.enemyIso))).toBe(true);
    expect(blue.records.some(r => r.kind === 'decision')).toBe(false);
    expect(red.records.some(r => r.kind === 'decision')).toBe(true);
    const restored = new SimulationRuntime(saved, []);
    expect(restored.checkpoint().runtime!.replay).toEqual(archive);
    runtime.step(); restored.step();
    expect(restored.checkpoint()).toEqual(runtime.checkpoint());
  });

  it('retains delivered events after the live log is trimmed and reads old recorded models', () => {
    const s = createLittoralReference();
    s.eventLog.push(...Array.from({ length: 520 }, (_, n) => ({
      id: `replay-test-${n}`, simTimeSec: 0, timeFormatted: 'T+0.0', faction: 'player' as const,
      type: 'alert' as const, title: `Report ${n}`, detail: `Delivered report ${n}`,
    })));
    const runtime = new SimulationRuntime(s, [], 3);
    const saved = runtime.checkpoint();
    saved.eventLog = saved.eventLog.slice(-12);
    const archive = new SimulationRuntime(saved, []).checkpoint().runtime!.replay!;
    const blue = factionReplay(archive, 'player');
    expect(blue.records.filter(r => r.kind === 'event' && r.title.startsWith('Report '))).toHaveLength(520);
    expect(blue.frames[0].session.eventLog.length).toBeLessThanOrEqual(12);
    const old = structuredClone(archive); old.modelVersion = 'retired-model-v0';
    expect(factionReplay(old, 'player').frames[0].tick).toBe(0);
  });

  it('does not misdate buffered events when upgrading an older checkpoint', () => {
    const s = createLittoralReference(); s.status = 'running';
    const runtime = new SimulationRuntime(s, [], 5);
    for (let n = 0; n < 20; n++) runtime.step();
    const old = runtime.checkpoint();
    delete old.runtime!.replay;
    old.eventLog.push({ id: 'older-report', simTimeSec: 1, timeFormatted: 'T+1.0',
      faction: 'player', type: 'alert', title: 'Older report', detail: 'Before recording began.' });
    const upgraded = new SimulationRuntime(old, []).checkpoint();
    expect(upgraded.runtime!.replay!.records.some(r => r.title === 'Older report')).toBe(false);
    expect(new SimulationRuntime(upgraded, []).checkpoint().runtime!.replay!.records
      .some(r => r.title === 'Older report')).toBe(false);
  });
});
