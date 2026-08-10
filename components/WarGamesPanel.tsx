'use client';

/**
 * The War Games console.
 *
 * Four decisions, top to bottom, in the order a player makes them: whose side
 * is this, what colour do they fly, what are you putting on the board, and —
 * for a special unit — what is inside it. The order of battle at the bottom is
 * the read-back: what you have actually committed, per nation.
 */

import { useMemo, useState } from 'react';

import { iconDataUrl } from '@/lib/unitIcons';
import type { WarGames } from '@/lib/useWarGames';
import {
  DOMAINS,
  ECHELON_BY_ID,
  NATION_COLORS,
  UNIT_BY_ID,
  deriveAbbr,
  describeComposition,
  echelonsFor,
  findFormation,
  formationLook,
  totalStrength,
  unitLabel,
  unitsInDomain,
  type Component,
  type DeployedUnit,
  type Domain,
  type EchelonMark,
  type Formation,
} from '@/lib/warGames';

const NEUTRAL = '#9AA7B4';

/** Icon rasterising is not free; the same symbol is drawn once per colour. */
const iconCache = new Map<string, string>();
function icon(key: string, domain: Domain, glyph: string, mark: EchelonMark, color: string): string {
  const cacheKey = `${key}|${JSON.stringify(mark)}|${color}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;
  const url = iconDataUrl({ typeId: key, glyph, domain, color, mark });
  iconCache.set(cacheKey, url);
  return url;
}

function unitPreview(typeId: string, color: string, echelonId?: string): string {
  const type = UNIT_BY_ID.get(typeId);
  if (!type) return '';
  const mark = echelonId ? (ECHELON_BY_ID.get(echelonId)?.mark ?? { kind: 'none' }) : { kind: 'none' };
  return icon(typeId, type.domain, type.glyph, mark as EchelonMark, color);
}

function formationPreview(formation: Formation, color: string): string {
  const look = formationLook(formation);
  return icon(`f:${formation.id}`, look.domain, look.glyph, { kind: 'text', text: formation.abbr }, color);
}

function deployedPreview(u: DeployedUnit, custom: Formation[], color: string): string {
  if (u.kind === 'formation') {
    const formation = findFormation(u.formationId, custom);
    return formation ? formationPreview(formation, color) : '';
  }
  return unitPreview(u.typeId, color, u.echelonId);
}

/* ------------------------------------------------------------------ */
/* Composition editor                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one place a composition is edited — used before deploying a special
 * unit, when inventing one, and when changing what a deployed one contains.
 */
function CompositionEditor({
  value,
  onChange,
  color,
}: {
  value: Component[];
  onChange: (next: Component[]) => void;
  color: string;
}) {
  const setCount = (typeId: string, count: number) =>
    onChange(
      value.map((part) => (part.typeId === typeId ? { ...part, count: Math.max(0, count) } : part))
    );

  const remove = (typeId: string) => onChange(value.filter((part) => part.typeId !== typeId));

  const add = (typeId: string) => {
    if (!typeId) return;
    if (value.some((part) => part.typeId === typeId)) {
      setCount(typeId, (value.find((p) => p.typeId === typeId)?.count ?? 0) + 1);
      return;
    }
    onChange([...value, { typeId, count: 1 }]);
  };

  return (
    <div className="wg-comp">
      {value.map((part) => {
        const type = UNIT_BY_ID.get(part.typeId);
        if (!type) return null;
        return (
          <div className="wg-comp-row" key={part.typeId}>
            <img src={unitPreview(part.typeId, color)} alt="" />
            <span className="wg-comp-name">{type.label}</span>
            <div className="wg-stepper">
              <button onClick={() => setCount(part.typeId, part.count - 1)} aria-label={`One fewer ${type.label}`}>
                −
              </button>
              <input
                type="number"
                min={0}
                value={part.count}
                onChange={(e) => setCount(part.typeId, Number(e.target.value))}
                aria-label={`${type.label} count`}
              />
              <button onClick={() => setCount(part.typeId, part.count + 1)} aria-label={`One more ${type.label}`}>
                +
              </button>
            </div>
            <button className="wg-comp-del" onClick={() => remove(part.typeId)} aria-label={`Remove ${type.label}`}>
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

/** A composition read out plainly, before anyone is invited to change it. */
function CompositionList({ composition, color }: { composition: Component[]; color: string }) {
  if (!composition.length) return <p className="wg-empty">Empty.</p>;
  return (
    <ul className="wg-comp-list">
      {composition.map((part) => {
        const type = UNIT_BY_ID.get(part.typeId);
        if (!type) return null;
        return (
          <li key={part.typeId}>
            <img src={unitPreview(part.typeId, color)} alt="" />
            <b>{part.count}</b>
            <span>{type.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export default function WarGamesPanel(wg: WarGames) {
  const [catalogue, setCatalogue] = useState<'unit' | 'formation'>('unit');
  const [domain, setDomain] = useState<Domain>('ground');
  const [query, setQuery] = useState('');
  const [obOpen, setObOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftComposition, setDraftComposition] = useState<Component[]>([]);
  const [editingSelection, setEditingSelection] = useState(false);

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
    pick,
    chooseUnit,
    chooseFormation,
    echelonId,
    setEchelonId,
    pendingComposition,
    setPendingComposition,
    formations,
    selectedUnit,
  } = wg;

  const activeColor = activeNation?.color ?? color;
  const paintColor = activeIso ? activeColor : NEUTRAL;

  const pickedType = pick.kind === 'unit' ? UNIT_BY_ID.get(pick.typeId) : undefined;
  const pickedFormation =
    pick.kind === 'formation' ? findFormation(pick.formationId, board.formations) : undefined;

  const pendingLabel = pickedFormation
    ? `${pickedFormation.label} (${totalStrength(pendingComposition)} units)`
    : pickedType
      ? unitLabel({ kind: 'unit', id: '', typeId: pickedType.id, echelonId, iso: '', lngLat: [0, 0] })
      : '';

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
              ? `Click the map to deploy ${pendingLabel}. Esc to stop.`
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
              src={deployedPreview(
                selectedUnit,
                board.formations,
                board.nations[selectedUnit.iso]?.color ?? NEUTRAL
              )}
              alt=""
            />
            <div>
              <b>{unitLabel(selectedUnit, board.formations)}</b>
              <span>
                {board.nations[selectedUnit.iso]?.name ?? 'Unassigned'}
                {selectedUnit.kind === 'formation'
                  ? ` · ${totalStrength(selectedUnit.composition)} units`
                  : ` · ${ECHELON_BY_ID.get(selectedUnit.echelonId)?.label ?? ''}`}
              </span>
            </div>
          </div>

          {selectedUnit.kind === 'formation' && (
            <>
              <h4 className="wg-sub">Composition</h4>
              <CompositionList
                composition={selectedUnit.composition}
                color={board.nations[selectedUnit.iso]?.color ?? NEUTRAL}
              />
            </>
          )}

          <button
            className="wg-disclose"
            aria-expanded={editingSelection}
            onClick={() => setEditingSelection((v) => !v)}
          >
            <span className={`chevron${editingSelection ? '' : ' closed'}`} aria-hidden />
            Edit
          </button>

          {editingSelection && (
            <div className="wg-edit">
              <input
                className="wg-search"
                value={selectedUnit.name ?? ''}
                placeholder={unitLabel(selectedUnit, board.formations)}
                onChange={(e) => wg.renameUnit(selectedUnit.id, e.target.value || undefined)}
                aria-label="Unit name"
              />

              {selectedUnit.kind === 'formation' ? (
                <CompositionEditor
                  value={selectedUnit.composition}
                  onChange={(next) => wg.setUnitComposition(selectedUnit.id, next)}
                  color={board.nations[selectedUnit.iso]?.color ?? NEUTRAL}
                />
              ) : (
                <div className="wg-echelons">
                  {echelonsFor(UNIT_BY_ID.get(selectedUnit.typeId)!).map((e) => (
                    <button
                      key={e.id}
                      className={`wg-echelon${selectedUnit.echelonId === e.id ? ' on' : ''}`}
                      onClick={() => wg.setUnitEchelon(selectedUnit.id, e.id)}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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

      {/* ---------- palette ---------- */}
      <section className="wg-block">
        <div className="wg-tabs">
          <button
            className={`wg-tab${catalogue === 'unit' ? ' on' : ''}`}
            onClick={() => setCatalogue('unit')}
          >
            Units
          </button>
          <button
            className={`wg-tab${catalogue === 'formation' ? ' on' : ''}`}
            onClick={() => setCatalogue('formation')}
          >
            Special units
          </button>
        </div>

        {catalogue === 'unit' ? (
          <>
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
                  className={`wg-unit${pick.kind === 'unit' && pick.typeId === u.id ? ' on' : ''}`}
                  onClick={() => {
                    chooseUnit(u.id);
                    setTool('deploy');
                  }}
                  title={u.label}
                >
                  <img src={unitPreview(u.id, paintColor, u.defaultEchelon)} alt="" draggable={false} />
                  <span>{u.label}</span>
                </button>
              ))}
            </div>

            {pickedType && (
              <>
                <h4 className="wg-sub">Quantity</h4>
                <div className="wg-echelons">
                  {echelonsFor(pickedType).map((e) => (
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
          </>
        ) : (
          <>
            <p className="wg-hint wg-hint-top">
              A special unit is a formation of units. Pick one, set what is in it, then deploy.
            </p>

            <div className="wg-units">
              {formations.map((f) => (
                <button
                  key={f.id}
                  className={`wg-unit${pick.kind === 'formation' && pick.formationId === f.id ? ' on' : ''}`}
                  onClick={() => {
                    chooseFormation(f.id);
                    setTool('deploy');
                  }}
                  title={`${f.label} — ${describeComposition(f.composition)}`}
                >
                  <img src={formationPreview(f, paintColor)} alt="" draggable={false} />
                  <span>{f.label}</span>
                  {f.custom && (
                    <span
                      className="wg-unit-del"
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete ${f.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        wg.deleteFormation(f.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          wg.deleteFormation(f.id);
                        }
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
            </div>

            {pickedFormation && (
              <>
                <h4 className="wg-sub">
                  Composition · {totalStrength(pendingComposition)} units
                </h4>
                <CompositionEditor
                  value={pendingComposition}
                  onChange={setPendingComposition}
                  color={paintColor}
                />
                <p className="wg-note">
                  These counts apply to the next one you deploy. Already-placed units keep the
                  composition they were deployed with.
                </p>
              </>
            )}

            {creating ? (
              <div className="wg-creator">
                <h4 className="wg-sub">New special unit</h4>
                <input
                  className="wg-search"
                  value={draftName}
                  placeholder="Name, e.g. Air strike package"
                  onChange={(e) => setDraftName(e.target.value)}
                  aria-label="Special unit name"
                />
                <CompositionEditor
                  value={draftComposition}
                  onChange={setDraftComposition}
                  color={paintColor}
                />
                <p className="wg-note">
                  Marked <b>{deriveAbbr(draftName || 'Special unit')}</b> on the map, drawn as
                  whatever it has most of.
                </p>
                <div className="wg-row">
                  <button
                    className="wg-btn"
                    disabled={!draftName.trim() || !totalStrength(draftComposition)}
                    onClick={() => {
                      wg.createFormation(draftName, draftComposition);
                      setDraftName('');
                      setDraftComposition([]);
                      setCreating(false);
                      setTool('deploy');
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="wg-btn"
                    onClick={() => {
                      setCreating(false);
                      setDraftName('');
                      setDraftComposition([]);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="wg-row">
                <button className="wg-btn" onClick={() => setCreating(true)}>
                  New special unit
                </button>
                {pickedFormation && (
                  <button
                    className="wg-btn"
                    title="Keep these counts as a special unit of your own"
                    onClick={() => {
                      setCreating(true);
                      setDraftName(`${pickedFormation.label} (mine)`);
                      setDraftComposition(pendingComposition.map((p) => ({ ...p })));
                    }}
                  >
                    Save these counts
                  </button>
                )}
              </div>
            )}
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
                          src={deployedPreview(u, board.formations, board.nations[u.iso]?.color ?? NEUTRAL)}
                          alt=""
                        />
                        <span>{unitLabel(u, board.formations)}</span>
                        {u.kind === 'formation' && (
                          <span className="wg-ob-size">{totalStrength(u.composition)}</span>
                        )}
                      </button>
                      <button
                        className="wg-ob-del"
                        onClick={() => wg.removeUnit(u.id)}
                        aria-label={`Remove ${unitLabel(u, board.formations)}`}
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
