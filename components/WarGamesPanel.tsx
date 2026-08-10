'use client';

/**
 * The War Games console.
 *
 * Composition only: the blocks below own their own state and are ordered the
 * way a player works — whose side, which tool, what is selected, what to place,
 * and what has been placed. Each block lives in components/wargames/.
 */

import type { WarGames } from '@/lib/useWarGames';
import { UNIT_BY_ID, findFormation, totalStrength, unitLabel } from '@/lib/warGames';
import { systemById } from '@/lib/specs';

import { Coverage } from './wargames/Coverage';
import { NationBlock } from './wargames/NationBlock';
import { OrderOfBattle } from './wargames/OrderOfBattle';
import { Palette } from './wargames/Palette';
import { SelectedUnit } from './wargames/SelectedUnit';
import { NEUTRAL } from './wargames/icons';

const TOOLS = [
  ['select', 'Select', 'Click a unit to select, drag to move'],
  ['paint', 'Paint', 'Click a country to give it the active colour'],
  ['deploy', 'Deploy', 'Click the map to place the chosen unit'],
] as const;

/** What the Deploy tool would place right now, named the way the map names it. */
function pendingLabel(wg: WarGames): string {
  if (wg.pick.kind === 'formation') {
    const formation = findFormation(wg.pick.formationId, wg.board.formations);
    return formation
      ? `${formation.label} (${totalStrength(wg.pendingComposition)} units)`
      : 'a special unit';
  }
  const spec = systemById(wg.systems, wg.pick.systemId);
  const base = spec?.name ?? UNIT_BY_ID.get(wg.pick.typeId)?.label ?? '';
  return unitLabel({
    kind: 'unit',
    id: '',
    iso: '',
    lngLat: [0, 0],
    typeId: wg.pick.typeId,
    echelonId: wg.echelonId,
    systemId: wg.pick.systemId,
    count: wg.deployCount,
    name: wg.deployCount > 1 ? `${wg.deployCount} × ${base}` : undefined,
  });
}

export default function WarGamesPanel(wg: WarGames) {
  const activeColor = wg.activeNation?.color ?? wg.color;
  const paintColor = wg.activeIso ? activeColor : NEUTRAL;

  return (
    <div className="wg">
      <NationBlock wg={wg} />

      <section className="wg-block">
        <h3 className="wg-h">
          Tool
          <span className="wg-h-note">
            <button className="wg-mini" onClick={wg.undo} disabled={!wg.canUndo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button className="wg-mini" onClick={wg.redo} disabled={!wg.canRedo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
          </span>
        </h3>

        <div className="wg-tools">
          {TOOLS.map(([id, label, hint]) => (
            <button
              key={id}
              className={`wg-tool${wg.tool === id ? ' on' : ''}`}
              aria-pressed={wg.tool === id}
              onClick={() => wg.setTool(id)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="wg-hint">
          {wg.tool === 'deploy'
            ? wg.activeIso
              ? `Click the map to deploy ${pendingLabel(wg)}. Esc to stop.`
              : 'Pick a nation first — units fly their nation’s colour.'
            : wg.tool === 'paint'
              ? 'Click a country to colour it. That colour becomes its units’ colour too.'
              : 'Click a unit to select it. Drag it — or its ring — to reposition. Delete removes it.'}
        </p>
      </section>

      {wg.selectedUnit && <SelectedUnit wg={wg} unit={wg.selectedUnit} />}

      <Palette wg={wg} color={paintColor} />

      <Coverage wg={wg} />

      <OrderOfBattle wg={wg} />

      <div className="wg-row wg-footer">
        <button className="wg-btn" onClick={wg.clearUnits} disabled={!wg.board.units.length}>
          Clear units
        </button>
        <button className="wg-btn" onClick={wg.clearNations} disabled={!Object.keys(wg.board.nations).length}>
          Clear colours
        </button>
      </div>

      <p className="wg-storage">
        {wg.storageKind === 'files'
          ? 'Saved to data/ on this machine.'
          : wg.storageKind === 'browser'
            ? 'Saved in this browser only — the file store is unavailable.'
            : 'Loading…'}
      </p>

      {wg.error && <p className="wg-error">{wg.error}</p>}
    </div>
  );
}
