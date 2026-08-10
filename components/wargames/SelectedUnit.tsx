'use client';

/**
 * What is selected, what it is made of, and what it can do — read first, edited
 * second. The card sits high in the console so selecting something on the map
 * never sends you hunting down a scroll for the controls that act on it.
 */

import { useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import {
  ECHELON_BY_ID,
  UNIT_BY_ID,
  echelonsFor,
  totalStrength,
  unitLabel,
  type DeployedUnit,
} from '@/lib/warGames';
import { systemById, systemsForType } from '@/lib/specs';
import { CompositionEditor, CompositionList } from './CompositionEditor';
import { SpecSheet } from './SpecSheet';
import { NEUTRAL, deployedPreview } from './icons';

export function SelectedUnit({ wg, unit }: { wg: WarGames; unit: DeployedUnit }) {
  const [editing, setEditing] = useState(false);
  const { board, systems } = wg;
  const color = board.nations[unit.iso]?.color ?? NEUTRAL;
  const spec = unit.kind === 'unit' ? systemById(systems, unit.systemId) : undefined;
  const type = unit.kind === 'unit' ? UNIT_BY_ID.get(unit.typeId) : undefined;

  return (
    <section className="wg-block wg-selected">
      <h3 className="wg-h">Selected</h3>

      <div className="wg-selected-head">
        <img src={deployedPreview(unit, board.formations, color)} alt="" />
        <div>
          <b>{unitLabel(unit, board.formations, systems)}</b>
          <span>
            {board.nations[unit.iso]?.name ?? 'Unassigned'}
            {unit.kind === 'formation'
              ? ` · ${totalStrength(unit.composition)} units`
              : ` · ${ECHELON_BY_ID.get(unit.echelonId)?.label ?? ''}`}
          </span>
        </div>
      </div>

      {unit.kind === 'formation' ? (
        <>
          <h4 className="wg-sub">Composition</h4>
          <CompositionList composition={unit.composition} color={color} systems={systems} />
        </>
      ) : (
        spec && (
          <>
            <h4 className="wg-sub">{spec.name}</h4>
            <SpecSheet spec={spec} compact />
          </>
        )
      )}

      <button className="wg-disclose" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
        <span className={`chevron${editing ? '' : ' closed'}`} aria-hidden />
        Edit
      </button>

      {editing && (
        <div className="wg-edit">
          <input
            className="wg-search"
            value={unit.name ?? ''}
            placeholder={unitLabel(unit, board.formations, systems)}
            onChange={(e) => wg.renameUnit(unit.id, e.target.value || undefined)}
            aria-label="Unit name"
          />

          {unit.kind === 'formation' ? (
            <CompositionEditor
              value={unit.composition}
              onChange={(next) => wg.setUnitComposition(unit.id, next)}
              color={color}
              systems={systems}
            />
          ) : (
            <>
              {type && (
                <>
                  <select
                    className="wg-add"
                    value={unit.systemId ?? ''}
                    onChange={(e) => wg.setUnitSystem(unit.id, e.target.value || undefined)}
                    aria-label="System"
                  >
                    <option value="">Generic {type.label.toLowerCase()} — no specifications</option>
                    {systemsForType(systems, type.id).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>

                  <div className="wg-count-row">
                    <div className="wg-stepper">
                      <button onClick={() => wg.setUnitCount(unit.id, unit.count - 1)} aria-label="One fewer">
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={unit.count}
                        onChange={(e) => wg.setUnitCount(unit.id, Number(e.target.value))}
                        aria-label="How many"
                      />
                      <button onClick={() => wg.setUnitCount(unit.id, unit.count + 1)} aria-label="One more">
                        +
                      </button>
                    </div>
                    <span className="wg-note">deployed here</span>
                  </div>

                  <div className="wg-echelons">
                    {echelonsFor(type).map((e) => (
                      <button
                        key={e.id}
                        className={`wg-echelon${unit.echelonId === e.id ? ' on' : ''}`}
                        onClick={() => wg.setUnitEchelon(unit.id, e.id)}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="wg-row">
        <button className="wg-btn" onClick={() => wg.flyToUnit(unit.id)}>
          Centre
        </button>
        <button className="wg-btn danger" onClick={() => wg.removeUnit(unit.id)}>
          Remove
        </button>
      </div>
    </section>
  );
}
