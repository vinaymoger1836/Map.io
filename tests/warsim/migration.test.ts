import { describe, expect, it } from 'vitest';
import pacific from './fixtures/v1/pacific-csg-defense.wargames.json';
import { readBundle, buildBundle, mergeImported } from '../../lib/scenarios';
import { reviveBoard } from '../../lib/warGames';
import { reviveScenarios } from '../../lib/scenarios';
import { parseAndValidateScenarioJson, exportScenarioPackage } from '../../lib/scenarioIO';
import { createFixture } from './fixtures/v1/scenarios';

describe('existing export formats: immutable migration references', () => {
  it('preserves copied Pacific board unit identities/counts and coordinates', () => {
    const read = readBundle(JSON.stringify(pacific));
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.error);
    expect(read.bundle.board.units.map((u) => ({ id: u.id, count: u.kind === 'unit' ? u.count : undefined, lngLat: u.lngLat })))
      .toEqual(pacific.board.units.map((u) => ({ id: u.id, count: u.count, lngLat: u.lngLat })));
    const roundTrip = readBundle(JSON.stringify(buildBundle(read.bundle)));
    expect(roundTrip.ok && roundTrip.bundle.board).toEqual(read.bundle.board);
  });

  it('revives a saved board and scenario selection without inventing extra units', () => {
    const board = reviveBoard(pacific.board);
    const scenarios = reviveScenarios({ active: 'reference', items: [{ id: 'reference', name: 'Reference', savedAt: '2026-09-25T00:00:00Z', board }] });
    expect(scenarios.active).toBe('reference');
    expect(scenarios.items[0].board).toEqual(board);
    expect(reviveScenarios({ ...scenarios, active: 'missing' }).active).toBeNull();
  });

  it('round-trips the separate 1.2.0 theater package format', () => {
    const board = reviveBoard(pacific.board);
    const exported = exportScenarioPackage('Reference', 'Fixture', board.units, board.formations, board.nations, [[1, 2]]);
    const imported = parseAndValidateScenarioJson(JSON.stringify(exported));
    expect(imported?.schemaVersion).toBe('1.2.0');
    expect(imported?.board.units).toEqual(board.units);
    expect(imported?.savedWaypoints).toEqual([[1, 2]]);
  });

  it('rejects an invalid JSON bundle and a newer unsupported bundle version', () => {
    expect(readBundle('not-json').ok).toBe(false);
    expect(readBundle(JSON.stringify({ ...pacific, version: 999 })).ok).toBe(false);
  });

  it('imports custom equipment and holdings without replacing an existing authored definition', () => {
    const incoming = createFixture('engagement').systems.find((system) => system.id === 'fixture-ship')!;
    const forces = { '840': [{ typeId: incoming.typeId, systemId: incoming.id, count: 3 }] };
    const read = readBundle(JSON.stringify({ format: 'mapio-arsenal-package', version: 1,
      systems: [incoming], forces }));
    if (!read.ok) throw new Error(read.error);
    expect(read.bundle.board.units).toEqual([]);
    expect(read.bundle.forces).toEqual(forces);
    expect(read.bundle.systems[0]).toMatchObject({ ...incoming, custom: true });
    const existing = { ...incoming, name: 'My edited fixture ship' };
    const merged = mergeImported([existing], read.bundle.systems, (system) => system.id);
    expect(merged).toEqual({ merged: [existing], added: 0, kept: 1 });
  });
});
