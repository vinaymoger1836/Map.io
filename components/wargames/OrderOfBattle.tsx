'use client';

/**
 * The read-back: what has actually been committed, per nation. Counts are what
 * matter here, so a nation's line adds up its deployments rather than counting
 * pins — twelve aircraft at one airfield is twelve aircraft.
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { totalStrength, unitLabel, type DeployedUnit } from '@/lib/warGames';
import { NEUTRAL, deployedPreview } from './icons';

const strengthOf = (u: DeployedUnit) => (u.kind === 'formation' ? totalStrength(u.composition) : u.count);

export function OrderOfBattle({ wg }: { wg: WarGames }) {
  const [open, setOpen] = useState(true);
  const { board, systems } = wg;

  const byNation = useMemo(() => {
    const map = new Map<string, DeployedUnit[]>();
    for (const u of board.units) {
      const list = map.get(u.iso);
      if (list) list.push(u);
      else map.set(u.iso, [u]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [board.units]);

  const total = board.units.reduce((sum, u) => sum + strengthOf(u), 0);

  return (
    <section className="wg-block">
      <button className="wg-h wg-h-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chevron${open ? '' : ' closed'}`} aria-hidden />
        Order of battle
        <span className="wg-count">{total}</span>
      </button>

      {open &&
        (byNation.length ? (
          <div className="wg-ob">
            {byNation.map(([iso, units]) => (
              <div className="wg-ob-nation" key={iso}>
                <div className="wg-ob-head">
                  <span className="wg-chip" style={{ background: board.nations[iso]?.color ?? NEUTRAL }} />
                  {board.nations[iso]?.name ?? iso}
                  <span className="wg-count">{units.reduce((s, u) => s + strengthOf(u), 0)}</span>
                </div>
                {units.map((u) => (
                  <div className="wg-ob-row" key={u.id}>
                    <button
                      className="wg-ob-jump"
                      onClick={() => {
                        wg.selectUnit(u.id);
                        wg.flyToUnit(u.id);
                      }}
                    >
                      <img
                        src={deployedPreview(u, board.formations, board.nations[u.iso]?.color ?? NEUTRAL)}
                        alt=""
                      />
                      <span>{unitLabel(u, board.formations, systems)}</span>
                      {strengthOf(u) > 1 && <span className="wg-ob-size">{strengthOf(u)}</span>}
                    </button>
                    <button
                      className="wg-ob-del"
                      onClick={() => wg.removeUnit(u.id)}
                      aria-label={`Remove ${unitLabel(u, board.formations, systems)}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="wg-empty">Nothing deployed yet.</p>
        ))}
    </section>
  );
}
