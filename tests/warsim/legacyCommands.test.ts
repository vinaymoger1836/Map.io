import { describe, expect, it } from 'vitest';
import { deployAutonomousEntity, deployEntityToBase, orderEntityRtb, orderPatrol, orderStrikeMission, tickWarSim } from '../../lib/warSimEngine';
import type { SimBase } from '../../lib/warSimTypes';
import { createFixture } from './fixtures/v1/scenarios';

function base(id: string, lngLat: [number, number], maxCapacity = 4): SimBase {
  return { id, name: id, iso: '840', type: 'airbase', lngLat, maxCapacity,
    stationedEntityIds: [], runwayStatus: 'operational', repairCountdownSec: 0,
    supplies: { fuelPct: 100, ammoPct: 100 } };
}

describe('legacy War Sim commands', () => {
  it('enforces platform capacity and keeps the base roster in sync', () => {
    const { session, systems } = createFixture('transit');
    session.entities = [];
    session.bases = [base('airbase', [-150, 0], 4)];
    session.quotas.player['fixture-aircraft'] = { systemId: 'fixture-aircraft', typeId: 'fighter',
      count: 10, deployed: 0, destroyed: 0, inRepair: 0 };

    const first = deployEntityToBase(session, 'airbase', 'fixture-aircraft', 3, systems);
    expect(first.entities).toHaveLength(1);
    expect(first.bases[0].stationedEntityIds).toEqual([first.entities[0].id]);
    expect(deployEntityToBase(first, 'airbase', 'fixture-aircraft', 2, systems)).toBe(first);

    const second = deployEntityToBase(first, 'airbase', 'fixture-aircraft', 1, systems);
    expect(second.entities.map((entity) => entity.count)).toEqual([3, 1]);
    expect(second.bases[0].stationedEntityIds).toEqual(second.entities.map((entity) => entity.id));
    expect(second.quotas.player['fixture-aircraft'].deployed).toBe(4);
    expect(deployEntityToBase(second, 'airbase', 'fixture-aircraft', 1, systems)).toBe(second);
  });

  it('rejects invalid quantities and missing equipment definitions before changing quota', () => {
    const { session, systems } = createFixture('transit');
    session.entities = [];
    session.bases = [base('airbase', [-150, 0])];
    session.quotas.player['fixture-aircraft'] = { systemId: 'fixture-aircraft', typeId: 'fighter',
      count: 10, deployed: 0, destroyed: 0, inRepair: 0 };
    session.quotas.player.missing = { systemId: 'missing', typeId: 'fighter',
      count: 10, deployed: 0, destroyed: 0, inRepair: 0 };

    for (const count of [0, -1, 1.5]) {
      expect(deployEntityToBase(session, 'airbase', 'fixture-aircraft', count, systems)).toBe(session);
      expect(deployAutonomousEntity(session, 'fixture-aircraft', count, [-150, 0], systems)).toBe(session);
    }
    expect(deployEntityToBase(session, 'airbase', 'missing', 1, systems)).toBe(session);
    expect(deployAutonomousEntity(session, 'missing', 1, [-150, 0], systems)).toBe(session);
    expect(deployAutonomousEntity(session, 'fixture-aircraft', 1, [-150, 0], systems)).toBe(session);
    session.quotas.player['fixture-radar'] = { systemId: 'fixture-radar', typeId: 'radar',
      count: 1, deployed: 0, destroyed: 0, inRepair: 0 };
    expect(deployAutonomousEntity(session, 'fixture-radar', 1, [-150, 0], systems).entities[0].typeId)
      .toBe('radar');
  });

  it('assigns a missing home base to the nearest friendly base before return flight', () => {
    const { session, systems } = createFixture('transit');
    session.bases = [base('far', [-155, 0]), base('near', [-149.9, 0])];
    session.entities[0].homeBaseId = 'removed-base';
    session.entities[0].lngLat = [-150, 0];

    const ordered = orderEntityRtb(session, 'blue-transit');
    expect(ordered.entities[0].homeBaseId).toBe('near');
    expect(ordered.entities[0].status).toBe('bingo_rtb');
    expect(ordered.eventLog.at(-1)?.detail).toContain('near');
    const advanced = tickWarSim(ordered, 1, systems);
    expect(advanced.entities[0].lngLat[0]).toBeGreaterThan(-150);

    session.entities[0].status = 'docked';
    expect(orderEntityRtb(session, 'blue-transit')).toBe(session);
  });

  it('conserves personnel when a patrol or strike splits a formation', () => {
    const patrol = createFixture('transit').session;
    patrol.entities[0].count = 3;
    patrol.entities[0].personnel = 5;
    const patrolling = orderPatrol(patrol, 'blue-transit', [-149, 0], 15, 7000, 'active', 2);
    expect(patrolling.entities.map((entity) => entity.count)).toEqual([1, 2]);
    expect(patrolling.entities.reduce((total, entity) => total + entity.personnel, 0)).toBe(5);

    const { session, systems } = createFixture('engagement');
    session.entities[0].count = 3;
    session.entities[0].personnel = 5;
    const striking = orderStrikeMission(session, 'blue-shooter', 'red-target', [-149.85, 0],
      0, 1, 'rtb', undefined, systems, 2);
    expect(striking.entities.filter((entity) => entity.iso === '840').map((entity) => entity.count)).toEqual([1, 2]);
    expect(striking.entities.filter((entity) => entity.iso === '840')
      .reduce((total, entity) => total + entity.personnel, 0)).toBe(5);
  });

  it('records a combat loss once in the national quota ledger', () => {
    const { session, systems } = createFixture('engagement');
    session.entities[1].damage = 'damaged';
    session.entities[1].homeBaseId = 'redport';
    session.bases = [{ ...base('redport', [-149.85, 0]), iso: '156', type: 'naval_base',
      stationedEntityIds: ['red-target'] }];
    session.quotas.enemy['fixture-target'] = { systemId: 'fixture-target', typeId: 'logistics-ship',
      count: 1, deployed: 1, destroyed: 0, inRepair: 0 };
    session.activeMissiles = [{ id: 'impact', originLngLat: [-150, 0], currentLngLat: [-149.85, 0],
      targetLngLat: [-149.85, 0], attackerEntityId: 'blue-shooter', targetEntityId: 'red-target',
      attackerIso: '840', targetIso: '156', weaponName: 'Fixture round', weaponCategory: 'cruise',
      speedKmh: 900, startSimTimeSec: 0, etaSimTimeSec: 0, isIntercepted: false, progress: 1 }];

    const afterImpact = tickWarSim(session, 0.1, systems);
    expect(afterImpact.entities.find((entity) => entity.id === 'red-target')?.status).toBe('destroyed');
    expect(afterImpact.quotas.enemy['fixture-target'].destroyed).toBe(1);
    expect(afterImpact.quotas.enemy['fixture-target'].deployed).toBe(1);
    expect(afterImpact.bases[0].stationedEntityIds).toEqual([]);
    expect(tickWarSim(afterImpact, 0.1, systems).quotas.enemy['fixture-target'].destroyed).toBe(1);
  });

  it('tracks repair entry and completion in the quota ledger', () => {
    const { session, systems } = createFixture('transit');
    session.bases = [base('airbase', [-150, 0])];
    session.entities[0].homeBaseId = 'airbase';
    session.entities[0].lngLat = [-150, 0];
    session.entities[0].status = 'damaged_rtb';
    session.quotas.player['fixture-aircraft'] = { systemId: 'fixture-aircraft', typeId: 'fighter',
      count: 1, deployed: 1, destroyed: 0, inRepair: 0 };

    const landed = tickWarSim(session, 0.1, systems);
    expect(landed.entities[0].status).toBe('in_repair');
    expect(landed.quotas.player['fixture-aircraft'].inRepair).toBe(1);
    landed.entities[0].repairTimerSec = 0.05;
    const repaired = tickWarSim(landed, 0.1, systems);
    expect(repaired.entities[0].status).toBe('docked');
    expect(repaired.quotas.player['fixture-aircraft'].inRepair).toBe(0);
  });
});
