'use client';

/**
 * A composition, read and written.
 *
 * One editor serves three jobs — setting what a special unit will contain
 * before deploying, inventing one, and changing what a deployed one holds — so
 * those three can never drift apart.
 */

import { DOMAINS, UNIT_BY_ID, unitsInDomain, type Component } from '@/lib/warGames';
import { systemById, type SystemSpec } from '@/lib/specs';
import { unitPreview } from './icons';

function partName(part: Component, systems: SystemSpec[]): string {
  return systemById(systems, part.systemId)?.name ?? UNIT_BY_ID.get(part.typeId)?.label ?? part.typeId;
}

export function CompositionEditor({
  value,
  onChange,
  color,
  systems,
}: {
  value: Component[];
  onChange: (next: Component[]) => void;
  color: string;
  systems: SystemSpec[];
}) {
  const setCount = (index: number, count: number) =>
    onChange(value.map((part, i) => (i === index ? { ...part, count: Math.max(0, count) } : part)));

  const setSystem = (index: number, systemId: string) =>
    onChange(
      value.map((part, i) => (i === index ? { ...part, systemId: systemId || undefined } : part))
    );

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const add = (typeId: string) => {
    if (!typeId) return;
    // Adding a type already present bumps it rather than making a second row —
    // two rows of Destroyer is a composition nobody meant to write.
    const existing = value.findIndex((part) => part.typeId === typeId && !part.systemId);
    if (existing >= 0) {
      setCount(existing, value[existing].count + 1);
      return;
    }
    onChange([...value, { typeId, count: 1 }]);
  };

  return (
    <div className="wg-comp">
      {value.map((part, index) => {
        const type = UNIT_BY_ID.get(part.typeId);
        if (!type) return null;
        const options = systems.filter((s) => s.typeId === part.typeId);
        return (
          <div className="wg-comp-row" key={`${part.typeId}-${part.systemId ?? 'generic'}-${index}`}>
            <img src={unitPreview(part.typeId, color)} alt="" />
            <div className="wg-comp-id">
              <span className="wg-comp-name">{partName(part, systems)}</span>
              {options.length > 0 && (
                <select
                  className="wg-inline-select"
                  value={part.systemId ?? ''}
                  onChange={(e) => setSystem(index, e.target.value)}
                  aria-label={`System for ${type.label}`}
                >
                  <option value="">{type.label} — generic</option>
                  {options.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="wg-stepper">
              <button onClick={() => setCount(index, part.count - 1)} aria-label={`One fewer ${type.label}`}>
                −
              </button>
              <input
                type="number"
                min={0}
                value={part.count}
                onChange={(e) => setCount(index, Number(e.target.value))}
                aria-label={`${type.label} count`}
              />
              <button onClick={() => setCount(index, part.count + 1)} aria-label={`One more ${type.label}`}>
                +
              </button>
            </div>
            <button className="wg-comp-del" onClick={() => remove(index)} aria-label={`Remove ${type.label}`}>
              ×
            </button>
          </div>
        );
      })}

      {!value.length && <p className="wg-empty">Nothing in it yet — add the units it is made of.</p>}

      <select
        className="wg-add"
        value=""
        onChange={(e) => {
          add(e.target.value);
          e.target.value = '';
        }}
        aria-label="Add a unit to the composition"
      >
        <option value="">Add a unit…</option>
        {DOMAINS.map((d) => (
          <optgroup key={d.id} label={d.label}>
            {unitsInDomain(d.id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** The same composition read out plainly, before anyone is invited to change it. */
export function CompositionList({
  composition,
  color,
  systems,
}: {
  composition: Component[];
  color: string;
  systems: SystemSpec[];
}) {
  if (!composition.length) return <p className="wg-empty">Empty.</p>;
  return (
    <ul className="wg-comp-list">
      {composition.map((part, i) => {
        if (!UNIT_BY_ID.has(part.typeId)) return null;
        return (
          <li key={`${part.typeId}-${i}`}>
            <img src={unitPreview(part.typeId, color)} alt="" />
            <b>{part.count}</b>
            <span>{partName(part, systems)}</span>
          </li>
        );
      })}
    </ul>
  );
}
