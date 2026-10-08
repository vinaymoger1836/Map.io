import { describe, expect, it } from 'vitest';
import { createPhysicalReference } from '../../lib/warsim/physics/reference';
import { damageActor, cancelPhysicalRepair, condition, startPhysicalRepair } from '../../lib/warsim/physics/readiness';
import { launchPhysical, stepPhysical, validatePhysical } from '../../lib/warsim/physics/model';
import { observedContacts, hq, reservePhysicalMission, cancelPhysicalMission } from '../../lib/warsim/intelligence';
import { SimulationRuntime } from '../../lib/warsim/runtime';

function advance(s: ReturnType<typeof createPhysicalReference>, ticks: number) {
  for (let n = 0; n < ticks; n++) { stepPhysical(s, .1); s.simTimeSec = Math.round((s.simTimeSec + .1) * 10) / 10; }
}

describe('Phase 4 coastal readiness', () => {
  it('keeps damage in the affected capability and blocks its action', () => {
    const s = createPhysicalReference();
    const shooter = s.physical!.actors[0], scout = s.physical!.actors[2];
    damageActor(shooter, 55, 'strikeLauncher');
    expect(condition(shooter, 'strikeLauncher')).toBeLessThan(30);
    expect(condition(shooter, 'pointDefense')).toBe(100);
    expect(() => launchPhysical(s, shooter.id, observedContacts(s, hq(s.playerIso), 0)[0].contactId)).toThrow(/damaged/);
    damageActor(scout, 55, 'sensor');
    advance(s, 12);
    expect(s.physical!.intel!.observations.some(o => o.sourceId === scout.id)).toBe(false);
  });

  it('conserves repair kits, keeps partial work on cancellation, and restores the job exactly', () => {
    const s = createPhysicalReference(), actor = s.physical!.actors[0];
    actor.speed = actor.desiredSpeed = 0; actor.velocity = [0, 0, 0];
    damageActor(actor, 40, 'sensor');
    const initial = condition(actor, 'sensor'), kits = actor.repairKits!;
    startPhysicalRepair(s, actor.id, 'sensor');
    expect(actor.repairKits).toBe(kits - 1);
    expect(() => startPhysicalRepair(s, actor.id, 'sensor')).toThrow(/progress/);
    advance(s, 40);
    expect(condition(actor, 'sensor')).toBeGreaterThan(initial);
    expect(actor.repairJob!.remainingSec).toBeCloseTo(26);
    s.status = 'running';
    const first = new SimulationRuntime(s, [], 123);
    const restored = new SimulationRuntime(first.checkpoint(), []);
    for (let tick = 0; tick < 80; tick++) { first.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(first.checkpoint());
    const saved = first.checkpoint(), repaired = saved.physical!.actors[0];
    const progress = condition(repaired, 'sensor');
    cancelPhysicalRepair(saved, repaired.id);
    expect(repaired.repairJob).toBeUndefined();
    expect(condition(repaired, 'sensor')).toBe(progress);
    expect(repaired.repairKits).toBe(kits - 1);
  });

  it('holds a delayed mission, releases both commitments on cancellation, and rejects an overcommitted save', () => {
    const s = createPhysicalReference(); advance(s, 14);
    const intel = s.physical!.intel!, track = observedContacts(s, hq(s.playerIso), 14)[0];
    reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-scout', track.revision!, 'hold', 14, 5);
    advance(s, 20);
    expect(intel.missions[0].status).toBe('ready');
    expect(s.physical!.rounds).toHaveLength(0);
    expect(intel.reservations).toHaveLength(2);
    cancelPhysicalMission(s, intel.missions[0].id);
    expect(intel.reservations).toEqual([]);
    reservePhysicalMission(s, 'blue-frigate', observedContacts(s, hq(s.playerIso), 34)[0].contactId,
      'blue-scout', observedContacts(s, hq(s.playerIso), 34)[0].revision!, 'hold', 34);
    s.physical!.actors[0].rounds = 0;
    expect(() => validatePhysical(s.physical!, s)).toThrow(/overcommitted/);
  });
});
