import { describe, expect, it } from 'vitest';
import { referenceEnvironment, sampleElevation, terrainSight, validateEnvironment } from '../../lib/warsim/physics/environment';
import { createLittoralReference } from '../../lib/warsim/physics/reference';
import { stepPhysical } from '../../lib/warsim/physics/model';
import { hq, local, observedContacts, reservePhysicalMission, setPhysicalLink } from '../../lib/warsim/intelligence';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import { launchPhysical } from '../../lib/warsim/physics/model';

function advance(s: ReturnType<typeof createLittoralReference>, ticks: number) {
  for (let n = 0; n < ticks; n++) { stepPhysical(s, .1); s.simTimeSec = Math.round((s.simTimeSec + .1) * 10) / 10; }
}
function groundOnly(s: ReturnType<typeof createLittoralReference>) {
  for (const sensor of s.physical!.intel!.sensors) if (sensor.actorId !== 'blue-ground-radar') sensor.mode = 'passive';
}

describe('Phase 5 environment and littoral probe', () => {
  it('samples a bounded authored grid and reports missing terrain explicitly', () => {
    const env = referenceEnvironment(); validateEnvironment(env);
    expect(sampleElevation(env, 7000, 0)).toEqual({ status: 'known', elevationM: 30 });
    expect(sampleElevation(env, 30000, 0)).toEqual({ status: 'unavailable' });
    expect(terrainSight(env, [7000, 0, 60], [3000, 1800, 0])).toBe('clear');
    const ridge = structuredClone(env); ridge.terrain.heightsM[5 * 11 + 5] = 200;
    expect(terrainSight(ridge, [-1000, 0, 50], [1000, 0, 50])).toBe('blocked');
    expect(terrainSight(env, [9000, 0, 50], [30000, 0, 0])).toBe('unavailable');
    ridge.terrain.heightsM = new Array(5000).fill(0);
    expect(() => validateEnvironment(ridge)).toThrow(/environment/);
  });

  it('ground radar evidence reaches HQ and supports a sea strike only while its link is available', () => {
    const s = createLittoralReference(); groundOnly(s); advance(s, 34);
    const intel = s.physical!.intel!, groundTrack = intel.tracks.find(t => t.scopeId === local('blue-ground-radar') && t.targetRef === 'red-frigate');
    expect(groundTrack).toBeDefined();
    const track = observedContacts(s, hq(s.playerIso), 34).find(c => c.contactId === groundTrack!.id)!;
    expect(track.sourceIds).toContain('blue-ground-radar');
    reservePhysicalMission(s, 'blue-frigate', track.contactId, 'blue-ground-radar', track.revision!, 'hold', 34);
    expect(intel.reservations).toHaveLength(2);
    setPhysicalLink(s, 'blue-ground-radar', false);
    advance(s, 1);
    expect(intel.missions[0].status).toBe('held');
    expect(s.physical!.rounds).toHaveLength(0);
  });

  it('weather limits ground collection and changes sea/air motion from the saved snapshot', () => {
    const clear = createLittoralReference(), poor = createLittoralReference();
    groundOnly(clear); groundOnly(poor);
    poor.physical!.environment!.weather.visibilityKm = 1;
    advance(clear, 14); advance(poor, 14);
    expect(clear.physical!.intel!.observations.some(o => o.sourceId === 'blue-ground-radar')).toBe(true);
    expect(poor.physical!.intel!.observations.some(o => o.sourceId === 'blue-ground-radar')).toBe(false);
    poor.physical!.environment!.weather.seaState = 6;
    poor.physical!.environment!.weather.windEastMps = 10;
    const seaClear = clear.physical!.actors[0], seaPoor = poor.physical!.actors[0];
    seaClear.desiredSpeed = seaPoor.desiredSpeed = 16;
    const airClear = clear.physical!.actors.find(a => a.id === 'blue-air-recon')!;
    const airPoor = poor.physical!.actors.find(a => a.id === 'blue-air-recon')!;
    const initialGap = airPoor.position[0] - airClear.position[0];
    advance(clear, 100); advance(poor, 100);
    expect(seaClear.speed).toBeGreaterThan(seaPoor.speed);
    expect(airPoor.position[0] - airClear.position[0]).toBeGreaterThan(initialGap + 90);
    poor.status = 'running';
    const runtime = new SimulationRuntime(poor, [], 17), restored = new SimulationRuntime(runtime.checkpoint(), []);
    for (let n = 0; n < 10; n++) { runtime.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(runtime.checkpoint());
  });

  it('sonar detects a submerged contact while radar cannot and surface weapons reject it', () => {
    const s = createLittoralReference();
    for (const sensor of s.physical!.intel!.sensors) if (sensor.actorId !== 'blue-sonar') sensor.mode = 'passive';
    advance(s, 14);
    const sonar = s.physical!.intel!.observations.find(o => o.sourceId === 'blue-sonar' && o.targetRef === 'red-sub');
    expect(sonar?.modality).toBe('sonar');
    expect(s.physical!.intel!.observations.some(o => o.sourceId === 'blue-frigate' && o.targetRef === 'red-sub')).toBe(false);
    const track = observedContacts(s, hq(s.playerIso), 14).find(c => c.domain === 'sub')!;
    expect(track).toBeDefined();
    expect(() => launchPhysical(s, 'blue-frigate', track.contactId)).toThrow(/submerged/);
  });

  it('orbital observations respect a processing window and delayed downlink', () => {
    const s = createLittoralReference();
    for (const sensor of s.physical!.intel!.sensors) if (sensor.actorId !== 'blue-orbital') sensor.mode = 'passive';
    advance(s, 9);
    const intel = s.physical!.intel!;
    const orbital = intel.observations.find(o => o.sourceId === 'blue-orbital' && o.targetRef === 'red-frigate');
    expect(orbital?.modality).toBe('orbital');
    expect(intel.tracks.some(t => t.scopeId === hq(s.playerIso) && t.evidenceIds.includes(orbital!.id))).toBe(false);
    advance(s, 12);
    expect(intel.tracks.some(t => t.scopeId === local('blue-orbital') && t.evidenceIds.includes(orbital!.id))).toBe(true);
    setPhysicalLink(s, 'blue-orbital', false);
    advance(s, 15);
    expect(intel.tracks.some(t => t.scopeId === hq(s.playerIso) && t.evidenceIds.includes(orbital!.id))).toBe(false);
    expect(intel.messages.some(m => m.observationId === orbital!.id && m.status === 'expired')).toBe(true);
    const connected = createLittoralReference();
    for (const sensor of connected.physical!.intel!.sensors) if (sensor.actorId !== 'blue-orbital') sensor.mode = 'passive';
    advance(connected, 32);
    expect(connected.physical!.intel!.tracks.some(t => t.scopeId === hq(connected.playerIso)
      && t.evidenceIds.some(id => connected.physical!.intel!.observations.some(o => o.id === id && o.modality === 'orbital')))).toBe(true);
  });
});
