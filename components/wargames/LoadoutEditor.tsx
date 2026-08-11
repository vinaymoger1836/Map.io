'use client';

/**
 * What one deployed unit is carrying.
 *
 * The change is local to the unit: swapping a flight of Su-30s onto anti-ship
 * missiles changes that flight's reach and nothing else — not the system, not
 * the library, not the other Su-30s on the board. The rings redraw from the new
 * figures because everything downstream reads the effective spec rather than
 * the stored one.
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import type { DeployedGeneric } from '@/lib/warGames';
import { compatibleMunitions, isRearmed, stockLoadout } from '@/lib/munitions';
import { describeTargets, systemById } from '@/lib/specs';

export function LoadoutEditor({ wg, unit }: { wg: WarGames; unit: DeployedGeneric }) {
  const [query, setQuery] = useState('');
  const spec = systemById(wg.systems, unit.systemId);

  const stock = useMemo(() => stockLoadout(spec), [spec]);
  const carried = unit.loadout ?? stock;
  const rearmed = isRearmed(spec, unit.loadout);

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

  const set = (next: string[]) => {
    // Back to undefined when it matches the standard fit, so a unit that was
    // re-armed and then restored stops claiming to be modified.
    const same = [...next].sort().join('|') === [...stock].sort().join('|');
    wg.setUnitLoadout(unit.id, same ? undefined : next);
  };

  const toggle = (id: string) =>
    set(carried.includes(id) ? carried.filter((m) => m !== id) : [...carried, id]);

  return (
    <div className="wg-loadout">
      <div className="wg-loadout-head">
        <span className="wg-field-label">Carrying</span>
        {rearmed && (
          <button className="wg-mini" onClick={() => wg.setUnitLoadout(unit.id, undefined)}>
            Restore standard fit
          </button>
        )}
      </div>

      {carried.length ? (
        <ul className="wg-carried">
          {carried.map((id) => {
            const m = wg.munitions.get(id);
            return (
              <li key={id}>
                <span className="wg-carried-name">{m?.name ?? id}</span>
                <span className="wg-carried-range">{m ? `${m.weapon.rangeKm} km` : '—'}</span>
                <button className="wg-comp-del" onClick={() => toggle(id)} aria-label={`Remove ${m?.name ?? id}`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wg-note">Clean — carrying nothing, so it draws no engagement ring.</p>
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
          const on = carried.includes(m.id);
          const isStock = stock.includes(m.id);
          return (
            <button
              key={m.id}
              className={`wg-munition${on ? ' on' : ''}`}
              onClick={() => toggle(m.id)}
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
          <>
            {spec.name} declares what it can carry, so this list is exact.
          </>
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
