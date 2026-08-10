'use client';

/** Whose side this is, and what colour they fly. */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { NATION_COLORS } from '@/lib/warGames';

export function NationBlock({ wg }: { wg: WarGames }) {
  const [query, setQuery] = useState('');
  const { board, countries, activeIso, activeNation, color } = wg;
  const activeColor = activeNation?.color ?? color;

  /* Painted nations first, then the rest — the board you are building is the
     list you keep coming back to. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? countries.filter((c) => c.name.toLowerCase().includes(q))
      : countries.filter((c) => board.nations[c.iso]);
    return matched.slice(0, 60);
  }, [countries, query, board.nations]);

  return (
    <section className="wg-block">
      <h3 className="wg-h">
        Nation
        {activeNation && (
          <span className="wg-h-note">
            <span className="wg-chip" style={{ background: activeNation.color }} />
            {activeNation.name}
          </span>
        )}
      </h3>

      <input
        className="wg-search"
        type="search"
        value={query}
        placeholder={countries.length ? 'Search countries…' : 'Loading world roster…'}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search countries"
      />

      <div className="wg-country-list">
        {visible.map((c) => {
          const nation = board.nations[c.iso];
          return (
            <button
              key={c.iso}
              className={`wg-country${activeIso === c.iso ? ' on' : ''}`}
              onClick={() => wg.chooseNation(c.iso)}
              title={`${c.name} · ${c.continent}`}
            >
              <span
                className="wg-chip"
                style={{
                  background: nation?.color ?? 'transparent',
                  borderColor: nation?.color ?? undefined,
                }}
              />
              <span className="wg-country-name">{c.name}</span>
            </button>
          );
        })}
        {!visible.length && (
          <p className="wg-empty">
            {query ? 'No country by that name.' : 'Search for a country, or click one on the map with Paint.'}
          </p>
        )}
      </div>

      <div className="wg-colors">
        {NATION_COLORS.map((c) => (
          <button
            key={c}
            className={`wg-color${activeColor === c ? ' on' : ''}`}
            style={{ background: c }}
            aria-label={`Use colour ${c}`}
            onClick={() => {
              wg.setColor(c);
              if (activeIso) wg.applyColor(activeIso, c);
            }}
          />
        ))}
        <label className="wg-color wg-color-custom" title="Custom colour">
          <input
            type="color"
            value={activeColor}
            onChange={(e) => {
              wg.setColor(e.target.value);
              if (activeIso) wg.applyColor(activeIso, e.target.value);
            }}
          />
        </label>
      </div>
    </section>
  );
}
