'use client';

/**
 * The War Games console.
 *
 * Three decisions, top to bottom, in the order a player makes them: whose side
 * is this, what colour do they fly, and what are you putting on the board. The
 * order of battle at the bottom is the read-back — what you have actually
 * committed, per nation, so the board can be audited without hunting for pins.
 */

import { useMemo, useState } from 'react';

import { iconDataUrl } from '@/lib/unitIcons';
import type { WarGames } from '@/lib/useWarGames';
import {
  DOMAINS,
  ECHELON_BY_ID,
  NATION_COLORS,
  UNIT_BY_ID,
  echelonsFor,
  unitLabel,
  unitsInDomain,
  type Domain,
  type DeployedUnit,
} from '@/lib/warGames';

/** Icon rasterising is not free; the same (type, colour) pair is drawn once. */
const iconCache = new Map<string, string>();
function previewIcon(typeId: string, color: string, echelonId: string): string {
  const key = `${typeId}|${color}|${echelonId}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const type = UNIT_BY_ID.get(typeId);
  if (!type) return '';
  const url = iconDataUrl({
    typeId,
    glyph: type.glyph,
    domain: type.domain,
    color,
    mark: ECHELON_BY_ID.get(echelonId)?.mark ?? { kind: 'none' },
  });
  iconCache.set(key, url);
  return url;
}

const NEUTRAL = '#9AA7B4';

export default function WarGamesPanel(wg: WarGames) {
  const [domain, setDomain] = useState<Domain>('ground');
  const [query, setQuery] = useState('');
  const [obOpen, setObOpen] = useState(true);

  const {
    board,
    countries,
    tool,
    setTool,
    activeIso,
    activeNation,
    chooseNation,
    color,
    setColor,
    applyColor,
    typeId,
    setTypeId,
    echelonId,
    setEchelonId,
    selectedUnit,
  } = wg;

  const activeColor = activeNation?.color ?? color;
  const type = UNIT_BY_ID.get(typeId);
  /** What the Deploy tool would place right now, named the way the map names it. */
  const pendingLabel = unitLabel({ id: '', typeId, echelonId, iso: activeIso ?? '', lngLat: [0, 0] });

  /* Painted nations first, then the rest — the board you are building is the
     list you keep coming back to. */
  const visibleCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? countries.filter((c) => c.name.toLowerCase().includes(q))
      : countries.filter((c) => board.nations[c.iso]);
    return matched.slice(0, 60);
  }, [countries, query, board.nations]);

  const unitCounts = useMemo(() => {
    const byNation = new Map<string, DeployedUnit[]>();
    for (const u of board.units) {
      const list = byNation.get(u.iso);
      if (list) list.push(u);
      else byNation.set(u.iso, [u]);
    }
    return [...byNation.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [board.units]);

  const canDeploy = Boolean(activeIso);

  return (
    <div className="wg">
      {/* ---------- nation ---------- */}
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
          {visibleCountries.map((c) => {
            const nation = board.nations[c.iso];
            return (
              <button
                key={c.iso}
                className={`wg-country${activeIso === c.iso ? ' on' : ''}`}
                onClick={() => chooseNation(c.iso)}
                title={`${c.name} · ${c.continent}`}
              >
                <span
                  className="wg-chip"
                  style={{ background: nation?.color ?? 'transparent', borderColor: nation?.color ?? undefined }}
                />
                <span className="wg-country-name">{c.name}</span>
              </button>
            );
          })}
          {!visibleCountries.length && (
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
                setColor(c);
                if (activeIso) applyColor(activeIso, c);
              }}
            />
          ))}
          <label className="wg-color wg-color-custom" title="Custom colour">
            <input
              type="color"
              value={activeColor}
              onChange={(e) => {
                setColor(e.target.value);
                if (activeIso) applyColor(activeIso, e.target.value);
              }}
            />
          </label>
        </div>
      </section>

      {/* ---------- tools ---------- */}
      <section className="wg-block">
        <h3 className="wg-h">Tool</h3>
        <div className="wg-tools">
          {(
            [
              ['select', 'Select', 'Click a unit to select, drag to move'],
              ['paint', 'Paint', 'Click a country to give it the active colour'],
              ['deploy', 'Deploy', 'Click the map to place the chosen unit'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              className={`wg-tool${tool === id ? ' on' : ''}`}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="wg-hint">
          {tool === 'deploy'
            ? canDeploy
              ? `Click the map to deploy ${pendingLabel.toLowerCase()}. Esc to stop.`
              : 'Pick a nation first — units fly their nation’s colour.'
            : tool === 'paint'
              ? 'Click a country to colour it. That colour becomes its units’ colour too.'
              : 'Click a unit to select it, drag to reposition, Delete to remove.'}
        </p>
      </section>

      {/* ---------- selection ---------- */}
      {/* Sits high in the console: selecting a unit on the map should not send
          you hunting down a scroll for the controls that act on it. */}
      {selectedUnit && (
        <section className="wg-block wg-selected">
          <h3 className="wg-h">Selected</h3>
          <div className="wg-selected-head">
            <img
              src={previewIcon(
                selectedUnit.typeId,
                board.nations[selectedUnit.iso]?.color ?? NEUTRAL,
                selectedUnit.echelonId
              )}
              alt=""
            />
            <div>
              <b>{unitLabel(selectedUnit)}</b>
              <span>{board.nations[selectedUnit.iso]?.name ?? 'Unassigned'}</span>
            </div>
          </div>

          <input
            className="wg-search"
            value={selectedUnit.name ?? ''}
            placeholder={unitLabel(selectedUnit)}
            onChange={(e) => wg.updateUnit(selectedUnit.id, { name: e.target.value || undefined })}
            aria-label="Unit name"
          />

          <div className="wg-echelons">
            {echelonsFor(UNIT_BY_ID.get(selectedUnit.typeId)!).map((e) => (
              <button
                key={e.id}
                className={`wg-echelon${selectedUnit.echelonId === e.id ? ' on' : ''}`}
                onClick={() => wg.updateUnit(selectedUnit.id, { echelonId: e.id })}
              >
                {e.label}
              </button>
            ))}
          </div>

          <div className="wg-row">
            <button className="wg-btn" onClick={() => wg.flyToUnit(selectedUnit.id)}>
              Centre
            </button>
            <button className="wg-btn danger" onClick={() => wg.removeUnit(selectedUnit.id)}>
              Remove
            </button>
          </div>
        </section>
      )}

      {/* ---------- units ---------- */}
      <section className="wg-block">
        <h3 className="wg-h">Units</h3>
        <div className="wg-domains">
          {DOMAINS.map((d) => (
            <button
              key={d.id}
              className={`wg-domain${domain === d.id ? ' on' : ''}`}
              onClick={() => setDomain(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="wg-units">
          {unitsInDomain(domain).map((u) => (
            <button
              key={u.id}
              className={`wg-unit${typeId === u.id ? ' on' : ''}`}
              onClick={() => {
                setTypeId(u.id);
                setTool('deploy');
              }}
              title={u.label}
            >
              <img
                src={previewIcon(u.id, activeIso ? activeColor : NEUTRAL, u.defaultEchelon)}
                alt=""
                draggable={false}
              />
              <span>{u.label}</span>
            </button>
          ))}
        </div>

        {type && (
          <>
            <h4 className="wg-sub">Quantity</h4>
            <div className="wg-echelons">
              {echelonsFor(type).map((e) => (
                <button
                  key={e.id}
                  className={`wg-echelon${echelonId === e.id ? ' on' : ''}`}
                  onClick={() => setEchelonId(e.id)}
                  title={e.strength}
                >
                  {e.label}
                  <span className="wg-echelon-strength">{e.strength}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---------- order of battle ---------- */}
      <section className="wg-block">
        <button className="wg-h wg-h-button" onClick={() => setObOpen((o) => !o)} aria-expanded={obOpen}>
          <span className={`chevron${obOpen ? '' : ' closed'}`} aria-hidden />
          Order of battle
          <span className="wg-count">{board.units.length}</span>
        </button>

        {obOpen &&
          (unitCounts.length ? (
            <div className="wg-ob">
              {unitCounts.map(([iso, units]) => (
                <div className="wg-ob-nation" key={iso}>
                  <div className="wg-ob-head">
                    <span className="wg-chip" style={{ background: board.nations[iso]?.color ?? NEUTRAL }} />
                    {board.nations[iso]?.name ?? iso}
                    <span className="wg-count">{units.length}</span>
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
                          src={previewIcon(u.typeId, board.nations[u.iso]?.color ?? NEUTRAL, u.echelonId)}
                          alt=""
                        />
                        <span>{unitLabel(u)}</span>
                      </button>
                      <button
                        className="wg-ob-del"
                        onClick={() => wg.removeUnit(u.id)}
                        aria-label={`Remove ${unitLabel(u)}`}
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

      <div className="wg-row wg-footer">
        <button className="wg-btn" onClick={wg.clearUnits} disabled={!board.units.length}>
          Clear units
        </button>
        <button className="wg-btn" onClick={wg.clearNations} disabled={!Object.keys(board.nations).length}>
          Clear colours
        </button>
      </div>

      {wg.error && <p className="wg-error">{wg.error}</p>}
    </div>
  );
}
