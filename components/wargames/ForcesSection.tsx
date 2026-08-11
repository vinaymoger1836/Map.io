'use client';

/**
 * What each nation has.
 *
 * Today that means what it has *on the board*, which is the order of battle.
 * Phase 3 adds the other half — what it owns but has not deployed — and this is
 * where that lands, so the deployed column and the stock column can be read
 * against each other in one place.
 */

import { useMemo } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { totalStrength, type DeployedUnit } from '@/lib/warGames';
import { OrderOfBattle } from './OrderOfBattle';

const strengthOf = (u: DeployedUnit) => (u.kind === 'formation' ? totalStrength(u.composition) : u.count);

export function ForcesSection({ wg }: { wg: WarGames }) {
  const { board } = wg;

  const summary = useMemo(() => {
    const rows = new Map<string, { units: number; strength: number }>();
    for (const u of board.units) {
      const row = rows.get(u.iso) ?? { units: 0, strength: 0 };
      row.units += 1;
      row.strength += strengthOf(u);
      rows.set(u.iso, row);
    }
    return [...rows.entries()]
      .map(([iso, row]) => ({ iso, ...row, nation: board.nations[iso] }))
      .sort((a, b) => b.strength - a.strength);
  }, [board.units, board.nations]);

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
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.iso}>
                  <td>
                    <span
                      className="wg-chip"
                      style={{ background: row.nation?.color ?? 'transparent' }}
                    />
                    {row.nation?.name ?? row.iso}
                  </td>
                  <td className="num">{row.units}</td>
                  <td className="num">{row.strength}</td>
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

      <OrderOfBattle wg={wg} />

      <section className="wg-block">
        <h3 className="wg-h">National inventory</h3>
        <p className="wg-hint wg-hint-top">
          Not built yet. The plan is a stock per nation — <i>India: 6 × S-400, 40 × Su-30MKI</i> —
          that deploying draws down, so the palette can grey out what a country has run out of and
          the board cannot field more than exists. Until then, deployment is unlimited.
        </p>
      </section>
    </>
  );
}
