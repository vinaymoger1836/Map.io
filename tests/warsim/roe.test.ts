import { describe, expect, it } from 'vitest';
import { resolveAirspaceLocation } from '../../lib/airspaceSovereignty';
import { tickWarSim } from '../../lib/warSimEngine';
import { SimulationRuntime } from '../../lib/warsim/runtime';
import type { SimulationCommand } from '../../lib/warsim/contracts';
import type { SystemThreatLevel } from '../../lib/warSimTypes';
import { createFixture } from './fixtures/v1/scenarios';

function borderScenario(level: SystemThreatLevel, defender: 'player' | 'enemy' = 'player',
  inside = true, pk = 1) {
  const fixture = createFixture('sensor-contact');
  const { session, systems } = fixture;
  const location: [number, number] = defender === 'player'
    ? inside ? [-100, 40] : [-150, 0]
    : [110, 35];
  const sam = session.entities[0];
  const aircraft = session.entities[1];
  sam.id = 'sam';
  sam.name = 'SAM battery';
  sam.systemId = 'fixture-sam';
  sam.typeId = 'sam-launcher';
  sam.iso = defender === 'player' ? '840' : '156';
  sam.lngLat = [location[0] - 0.1, location[1]];
  sam.altitudeM = 0;
  sam.threatLevel = level;
  sam.magazines = {};
  aircraft.id = 'intruder';
  aircraft.name = 'Intruding aircraft';
  aircraft.systemId = 'fixture-aircraft';
  aircraft.typeId = 'fighter';
  aircraft.iso = defender === 'player' ? '156' : '840';
  aircraft.lngLat = location;
  aircraft.altitudeM = 6000;
  aircraft.currentAirspace = { countryIso: 'INT', countryName: 'International Airspace',
    classification: 'international' };
  session.airspaceRoeDoctrine = 'weapons_free';
  systems.push({ id: 'fixture-sam', name: 'Synthetic SAM', typeId: 'sam-launcher',
    sensor: { detectionKm: 100, antennaM: 20, tracks: 10, sees: ['air'] },
    weapons: [{ id: 'fixture-interceptor', name: 'Synthetic interceptor', rangeKm: 100,
      speedMach: 3, magazine: 1, salvo: 1, pk, engages: ['air'] }] });
  return { session, systems };
}

describe('legacy automatic ROE', () => {
  it('recognizes numeric country IDs and records an enemy crossing into friendly airspace', () => {
    expect(resolveAirspaceLocation([-100, 40], '840', '156').classification).toBe('friendly');
    expect(resolveAirspaceLocation([110, 35], '840', '156').classification).toBe('hostile');
    const { session, systems } = borderScenario('defcon_2');
    const next = tickWarSim(session, 0.1, systems);
    expect(next.borderIncursions?.[0]).toMatchObject({ entityId: 'intruder',
      faction: 'enemy', incursionType: 'hostile_breach' });
  });

  it('locks without firing at DEFCON 3, and fires on a crossing at DEFCON 2', () => {
    const shadow = borderScenario('defcon_3');
    const held = tickWarSim(shadow.session, 0.1, shadow.systems);
    expect(held.entities.find((entity) => entity.id === 'sam')?.isTargetLocked).toBe(true);
    expect(held.activeMissiles).toHaveLength(0);
    held.entities.find((entity) => entity.id === 'intruder')!.lngLat = [-150, 0];
    expect(tickWarSim(held, 0.1, shadow.systems).entities.find((entity) => entity.id === 'sam')?.isTargetLocked)
      .toBe(false);

    const defense = borderScenario('defcon_2');
    const fired = tickWarSim(defense.session, 0.1, defense.systems);
    expect(fired.activeMissiles).toHaveLength(1);
    expect(fired.activeMissiles[0]).toMatchObject({ attackerEntityId: 'sam',
      targetEntityId: 'intruder', weaponCategory: 'sam' });
    expect(fired.entities.find((entity) => entity.id === 'sam')?.magazines[0]).toBe(0);
    const next = tickWarSim(fired, 0.1, defense.systems);
    expect(next.activeMissiles).toHaveLength(1);
  });

  it('fires in international airspace at DEFCON 1 but holds at DEFCON 2', () => {
    const outside = borderScenario('defcon_2', 'player', false);
    expect(tickWarSim(outside.session, 0.1, outside.systems).activeMissiles).toHaveLength(0);
    outside.session.entities[0].threatLevel = 'defcon_1';
    expect(tickWarSim(outside.session, 0.1, outside.systems).activeMissiles).toHaveLength(1);
  });

  it('respects theater restrictions even when a system is at DEFCON 1', () => {
    const outside = borderScenario('defcon_1', 'player', false);
    outside.session.airspaceRoeDoctrine = 'adiz_border_defense';
    expect(tickWarSim(outside.session, 0.1, outside.systems).activeMissiles).toHaveLength(0);

    const neutral = borderScenario('defcon_1');
    neutral.session.entities[0].lngLat = [-1.1, 52];
    neutral.session.entities[1].lngLat = [-1, 52];
    neutral.session.airspaceRoeDoctrine = 'neutral_sanctuary';
    expect(tickWarSim(neutral.session, 0.1, neutral.systems).activeMissiles).toHaveLength(0);
  });

  it('lets red SAMs defend their border while blue is the selected faction', () => {
    const { session, systems } = borderScenario('defcon_2', 'enemy');
    session.airspaceRoeDoctrine = 'adiz_border_defense';
    expect(session.activeFaction).toBe('player');
    const fired = tickWarSim(session, 0.1, systems);
    expect(fired.activeMissiles[0]?.attackerIso).toBe('156');
    expect(fired.borderIncursions?.[0]).toMatchObject({ faction: 'player',
      incursionType: 'hostile_breach' });
  });

  it('holds fire without a ready radar, an explicitly compatible round, or ammunition', () => {
    const noRadar = borderScenario('defcon_2');
    noRadar.session.entities[0].subsystems = { radar: 'destroyed', weapons: 'operational',
      propulsion: 'operational', hullIntegrityPct: 100, flooding: 'none' };
    expect(tickWarSim(noRadar.session, 0.1, noRadar.systems).activeMissiles).toHaveLength(0);

    const noAirRound = borderScenario('defcon_2');
    noAirRound.systems.find((system) => system.id === 'fixture-sam')!.weapons![0].engages = ['surface'];
    expect(tickWarSim(noAirRound.session, 0.1, noAirRound.systems).activeMissiles).toHaveLength(0);

    const empty = borderScenario('defcon_2');
    empty.session.entities[0].magazines[0] = 0;
    expect(tickWarSim(empty.session, 0.1, empty.systems).activeMissiles).toHaveLength(0);
  });

  it('resolves a SAM shot against an aircraft using its stated probability', () => {
    const hit = borderScenario('defcon_2');
    const fired = tickWarSim(hit.session, 0.1, hit.systems);
    fired.activeMissiles[0].progress = 1;
    const impacted = tickWarSim(fired, 0.1, hit.systems);
    expect(impacted.entities.find((entity) => entity.id === 'intruder')?.status).toBe('destroyed');

    const miss = borderScenario('defcon_2', 'player', true, 0);
    const missedShot = tickWarSim(miss.session, 0.1, miss.systems);
    missedShot.activeMissiles[0].progress = 1;
    const missed = tickWarSim(missedShot, 0.1, miss.systems);
    expect(missed.entities.find((entity) => entity.id === 'intruder')?.status).not.toBe('destroyed');
    expect(missed.eventLog.some((event) => event.title.includes('Interceptor Missed'))).toBe(true);
  });

  it('rejects unsupported ROE commands before they change the session', () => {
    const fixture = createFixture('sensor-contact');
    const host = new SimulationRuntime(fixture.session, fixture.systems, fixture.seed);
    const submit = (command: SimulationCommand) => host.submit({ version: 1,
      sequence: host.checkpoint().runtime!.nextSequence, executeAtTick: host.tick,
      scope: { faction: 'player', commandGroupId: 'player:hq' }, command });
    submit({ type: 'setAirspaceRoe', args: ['unsupported'] } as unknown as SimulationCommand);
    submit({ type: 'setEntityThreatLevel', args: ['blue-scout', 'defcon_0'] } as unknown as SimulationCommand);
    expect(host.takeReceipts().map((receipt) => receipt.status)).toEqual(['rejected', 'rejected']);
    expect(host.checkpoint().airspaceRoeDoctrine).toBe('neutral_sanctuary');
    expect(host.checkpoint().entities[0].threatLevel).toBe('defcon_3');
  });

  it('applies a fleet DEFCON order only to the selected faction', () => {
    const fixture = createFixture('sensor-contact');
    const host = new SimulationRuntime(fixture.session, fixture.systems, fixture.seed);
    host.submit({ version: 1, sequence: host.checkpoint().runtime!.nextSequence,
      executeAtTick: host.tick, scope: { faction: 'player', commandGroupId: 'player:hq' },
      command: { type: 'switchActiveFaction', args: [] } });
    host.submit({ version: 1, sequence: host.checkpoint().runtime!.nextSequence,
      executeAtTick: host.tick, scope: { faction: 'enemy', commandGroupId: 'enemy:hq' },
      command: { type: 'setGlobalThreatLevel', args: ['156', 'defcon_2', 'all'] } });
    expect(host.takeReceipts().map((receipt) => receipt.status)).toEqual(['accepted', 'accepted']);
    expect(host.checkpoint().entities.find((entity) => entity.iso === '156')?.threatLevel).toBe('defcon_2');
    expect(host.checkpoint().entities.find((entity) => entity.iso === '840')?.threatLevel).toBe('defcon_3');
  });
});
