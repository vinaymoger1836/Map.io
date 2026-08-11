'use client';

/**
 * What one deployed unit is carrying, and how many of each.
 *
 * The change is local to the unit: swapping a flight of Su-30s onto anti-ship
 * missiles changes that flight's reach and nothing else — not the system, not
 * the library, not the other Su-30s on the board. The rings redraw from the new
 * figures because everything downstream reads the effective spec rather than
 * the stored one.
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import type { DeployedGeneric, LoadoutItem } from '@/lib/warGames';
import {
  capacityOf,
  compatibleMunitions,
  isRearmed,
  stockLoadout,
  totalRounds,
} from '@/lib/munitions';
import { describeTargets, systemById } from '@/lib/specs';

export function LoadoutEditor({ wg, unit }: { wg: WarGames; unit: DeployedGeneric }) {
  const [query, setQuery] = useState('');
  const spec = systemById(wg.systems, unit.systemId);

  const stock = useMemo(() => stockLoadout(spec), [spec]);
  const carried = unit.loadout ?? stock;
  const rearmed = isRearmed(spec, unit.loadout);
  const capacity = capacityOf(spec);
  const total = totalRounds(carried);

  const available = useMemo(() => {
    const all = compatibleMunitions(wg.munitions, spec);
    const q = query.trim().toLowerCase();
    return q ? all.filter((m) => m.name.toLowerCase().includes(q)) : all;
  }, [wg.munitions, spec, query]);

  if (!spec) {
    return (
      <p className="wg-note">
        A generic unit has no armament to change. Give it a system first and its weapons become
        editable.
      </p>
    );
  }

  const set = (next: LoadoutItem[]) => {
    // Back to undefined when it matches the standard fit, so a unit that was
    // re-armed and then restored stops claiming to be modified.
    wg.setUnitLoadout(unit.id, isRearmed(spec, next) ? next : undefined);
  };

  const add = (id: string) => {
    if (carried.some((i) => i.id === id)) {
      set(carried.filter((i) => i.id !== id));
      return;
    }
    // A round added by hand starts at whatever the library says this platform
    // carries, and at nothing when the library does not say.
    const fromStock = stock.find((i) => i.id === id);
    set([...carried, { id, count: fromStock?.count }]);
  };

  const setCount = (id: string, count: number | undefined) =>
    set(carried.map((i) => (i.id === id ? { ...i, count } : i)));

  /** Steps from "not recorded" to a real number without pretending it was one. */
  const bump = (item: LoadoutItem, by: number) => {
    const from = item.count ?? 0;
    const next = Math.max(0, from + by);
    setCount(item.id, next);
  };

  return (
    <div className="wg-loadout">
      <div className="wg-loadout-head">
        <span className="wg-field-label">
          Carrying
          {total > 0 && <b> · {total.toLocaleString()} rounds</b>}
        </span>
        {rearmed && (
          <button className="wg-mini" onClick={() => wg.setUnitLoadout(unit.id, undefined)}>
            Restore standard fit
          </button>
        )}
      </div>

      {carried.length ? (
        <ul className="wg-carried">
          {carried.map((item) => {
            const m = wg.munitions.get(item.id);
            return (
              <li key={item.id}>
                <span className="wg-carried-name">
                  {m?.name ?? item.id}
                  <em>{m ? `${m.weapon.rangeKm} km` : 'unknown round'}</em>
                </span>
                <div className="wg-stepper wg-stepper-sm">
                  <button onClick={() => bump(item, -1)} aria-label={`One fewer ${m?.name ?? item.id}`}>
                    −
                  </button>
                  {/* Blank rather than a dash: an em dash beside the minus
                      button reads as a second minus. Empty already says
                      "no number recorded", and 0 still shows as 0. */}
                  <input
                    type="number"
                    min={0}
                    value={item.count ?? ''}
                    title="How many carried. Leave blank if the number is not recorded."
                    onChange={(e) =>
                      setCount(item.id, e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))
                    }
                    aria-label={`How many ${m?.name ?? item.id}`}
                  />
                  <button onClick={() => bump(item, 1)} aria-label={`One more ${m?.name ?? item.id}`}>
                    +
                  </button>
                </div>
                <button
                  className="wg-comp-del"
                  onClick={() => set(carried.filter((i) => i.id !== item.id))}
                  aria-label={`Remove ${m?.name ?? item.id}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wg-note">Clean — carrying nothing, so it draws no engagement ring.</p>
      )}

      {capacity && (
        <p className={`wg-capacity${total > capacity.cells ? ' over' : ''}`}>
          {total.toLocaleString()} of {capacity.cells.toLocaleString()} launch cells
          {total > capacity.cells && ' — more than the hull holds'}
          <em>{capacity.note}</em>
        </p>
      )}

      {!capacity && carried.length > 0 && (
        <p className="wg-note">
          {spec.name} records no magazine capacity, so nothing here is capped — the count is yours to
          set and the engagement model will use it.
        </p>
      )}

      <input
        className="wg-search"
        type="search"
        value={query}
        placeholder={`Search ${available.length} compatible munitions…`}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search munitions"
      />

      <div className="wg-munitions">
        {available.map((m) => {
          const on = carried.some((i) => i.id === m.id);
          const isStock = stock.some((i) => i.id === m.id);
          return (
            <button
              key={m.id}
              className={`wg-munition${on ? ' on' : ''}`}
              onClick={() => add(m.id)}
              title={`${m.weapon.rangeKm} km · vs ${describeTargets(m.weapon.engages)}${
                isStock ? ' · standard fit' : ''
              }`}
            >
              <span className="wg-munition-name">
                {m.name}
                {isStock && <em> standard</em>}
              </span>
              <span className="wg-munition-range">{m.weapon.rangeKm} km</span>
            </button>
          );
        })}
        {!available.length && (
          <p className="wg-empty">
            {query ? 'Nothing by that name.' : 'No compatible munitions in the library yet.'}
          </p>
        )}
      </div>

      <p className="wg-note">
        {spec.compatible?.length ? (
          <>{spec.name} declares what it can carry, so this list is exact.</>
        ) : (
          <>
            Offered because other {domainWord(spec.typeId)} in the library carry them. {spec.name}{' '}
            declares no compatibility list, so this is right at the domain level but not per
            airframe — add a <code>compatible</code> list to the system to make it exact.
          </>
        )}
      </p>
    </div>
  );
}

/** Just enough English for the sentence above. */
function domainWord(typeId: string): string {
  if (/fighter|strike|bomber|awacs|tanker|airlift|uav|heli|mpa/.test(typeId)) return 'aircraft';
  if (/destroyer|cruiser|frigate|corvette|carrier|amphib|logistics/.test(typeId)) return 'ships';
  if (/submarine|ssbn/.test(typeId)) return 'submarines';
  return 'systems of this kind';
}
