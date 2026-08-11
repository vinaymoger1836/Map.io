'use client';

/**
 * What each nation has, and what it owns.
 *
 * Inventory is opt-in. A country with no holdings recorded deploys without
 * limit, exactly as every board did before this existed — so writing one down
 * is a decision, not a chore imposed on every nation you paint.
 *
 * The deliberate limit: this is national bookkeeping, not logistics. Nothing
 * here models basing, readiness or transit.
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { DOMAINS, UNIT_BY_ID, totalStrength, unitsInDomain, type DeployedUnit } from '@/lib/warGames';
import { systemById, systemsForType } from '@/lib/specs';
import { holdingKey, keyOf, type Tally } from '@/lib/forces';
import { OrderOfBattle } from './OrderOfBattle';

const strengthOf = (u: DeployedUnit) => (u.kind === 'formation' ? totalStrength(u.composition) : u.count);

/** What a holding is called: the system where there is one, the type otherwise. */
function holdingName(wg: WarGames, typeId: string, systemId?: string): string {
  const spec = systemById(wg.systems, systemId);
  if (spec) return spec.name;
  const type = UNIT_BY_ID.get(typeId);
  return type ? `${type.label} (generic)` : typeId;
}

function Inventory({ wg, iso }: { wg: WarGames; iso: string }) {
  const [typeId, setTypeId] = useState('fighter');
  const [systemId, setSystemId] = useState<string>('');

  const rows = wg.nationTally(iso);
  const tracked = Boolean(wg.forces[iso]?.length);
  const alreadyHeld = rows.some((r) => keyOf(r.holding) === holdingKey(typeId, systemId || undefined) && r.held > 0);

  return (
    <>
      {!tracked && (
        <p className="wg-hint wg-hint-top">
          No inventory for this nation, so it can deploy without limit. Add a holding below and it
          starts being counted — everything already on the board counts against it immediately.
        </p>
      )}

      {/* Only once the nation is tracked. Before that, every deployment would
          show as a red shortfall against a holding of zero — which reads as a
          problem when in fact nothing is being counted yet. */}
      {tracked && rows.length > 0 && (
        <table className="wg-table wg-forces">
          <thead>
            <tr>
              <th>Holding</th>
              <th className="num">Held</th>
              <th className="num">Out</th>
              <th className="num">Left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Tally) => {
              const key = keyOf(row.holding);
              const over = row.left < 0;
              return (
                <tr key={key} className={over ? 'over' : undefined}>
                  <td>{holdingName(wg, row.holding.typeId, row.holding.systemId)}</td>
                  <td className="num">
                    <div className="wg-stepper wg-stepper-sm">
                      <button
                        onClick={() => wg.setHolding(iso, { ...row.holding, count: row.held - 1 })}
                        aria-label="One fewer held"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={row.held}
                        onChange={(e) => wg.setHolding(iso, { ...row.holding, count: Number(e.target.value) })}
                        aria-label={`How many ${holdingName(wg, row.holding.typeId, row.holding.systemId)} held`}
                      />
                      <button
                        onClick={() => wg.setHolding(iso, { ...row.holding, count: row.held + 1 })}
                        aria-label="One more held"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="num">{row.deployed}</td>
                  <td className="num">{row.left}</td>
                  <td className="num">
                    <button
                      className="wg-comp-del"
                      onClick={() => wg.removeHolding(iso, key)}
                      aria-label="Remove holding"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tracked && rows.some((r) => r.left < 0) && (
        <p className="wg-note wg-warn">
          More is deployed than held. Nothing is removed from the board — raise the holding, or take
          units off the map until it reconciles.
        </p>
      )}

      <h4 className="wg-sub">Add a holding</h4>
      <label className="wg-field wide">
        <span>Unit type</span>
        <select
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setSystemId('');
          }}
        >
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
      </label>

      <label className="wg-field wide">
        <span>System</span>
        <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
          <option value="">Generic — any {UNIT_BY_ID.get(typeId)?.label.toLowerCase() ?? 'unit'}</option>
          {systemsForType(wg.systems, typeId).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="wg-row">
        <button
          className="wg-btn accent"
          disabled={alreadyHeld}
          onClick={() => wg.setHolding(iso, { typeId, systemId: systemId || undefined, count: 1 })}
        >
          {alreadyHeld ? 'Already held' : 'Add'}
        </button>
      </div>

      <p className="wg-note">
        A generic holding and a specific one are different stock: 12 unspecified fighters do not come
        out of the 40 Su-30MKI. Deployments draw from whichever they were made with.
      </p>
    </>
  );
}

export function ForcesSection({ wg }: { wg: WarGames }) {
  const { board } = wg;
  const [iso, setIso] = useState<string | null>(null);
  const chosen = iso ?? wg.activeIso;

  const summary = useMemo(() => {
    const rows = new Map<string, { units: number; strength: number }>();
    for (const u of board.units) {
      const row = rows.get(u.iso) ?? { units: 0, strength: 0 };
      row.units += 1;
      row.strength += strengthOf(u);
      rows.set(u.iso, row);
    }
    // Nations with an inventory but nothing deployed still belong in the list.
    for (const key of Object.keys(wg.forces)) if (!rows.has(key)) rows.set(key, { units: 0, strength: 0 });
    return [...rows.entries()]
      .map(([key, row]) => ({ iso: key, ...row, nation: board.nations[key], tracked: Boolean(wg.forces[key]?.length) }))
      .sort((a, b) => b.strength - a.strength);
  }, [board.units, board.nations, wg.forces]);

  return (
    <>
      <section className="wg-block">
        <h3 className="wg-h">
          Forces
          <span className="wg-h-note">{board.units.length} deployments</span>
        </h3>

        {summary.length ? (
          <table className="wg-table">
            <thead>
              <tr>
                <th>Nation</th>
                <th className="num">Deployments</th>
                <th className="num">Strength</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr
                  key={row.iso}
                  className={`wg-clickable${chosen === row.iso ? ' on' : ''}`}
                  onClick={() => setIso(row.iso)}
                >
                  <td>
                    <span className="wg-chip" style={{ background: row.nation?.color ?? 'transparent' }} />
                    {row.nation?.name ?? row.iso}
                  </td>
                  <td className="num">{row.units}</td>
                  <td className="num">{row.strength}</td>
                  <td className="num">{row.tracked ? 'tracked' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="wg-empty">Nothing deployed yet. Place a unit from the Map section.</p>
        )}

        <p className="wg-note">
          Strength counts what is actually there — twelve aircraft at one airfield is twelve
          aircraft, not one pin. A special unit adds up everything inside it.
        </p>
      </section>

      <section className="wg-block">
        <h3 className="wg-h">
          Inventory
          {chosen && (
            <span className="wg-h-note">
              <span className="wg-chip" style={{ background: board.nations[chosen]?.color ?? 'transparent' }} />
              {board.nations[chosen]?.name ?? chosen}
            </span>
          )}
        </h3>

        {chosen ? (
          <Inventory wg={wg} iso={chosen} key={chosen} />
        ) : (
          <p className="wg-empty">Pick a nation above, or paint one on the map.</p>
        )}
      </section>

      <OrderOfBattle wg={wg} />
    </>
  );
}
