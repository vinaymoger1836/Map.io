'use client';

/**
 * What you are about to put on the board.
 *
 * Three catalogues behind one set of tabs: single units, formations of them,
 * and the systems that give either one its specifications.
 */

import { useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import {
  DOMAINS,
  UNIT_BY_ID,
  deriveAbbr,
  describeComposition,
  echelonsFor,
  findFormation,
  totalStrength,
  unitsInDomain,
  type Component,
  type Domain,
} from '@/lib/warGames';
import { summarise, systemById, systemsForType } from '@/lib/specs';
import { CompositionEditor } from './CompositionEditor';
import { SystemsEditor } from './SystemsEditor';
import { formationPreview, unitPreview } from './icons';

type Catalogue = 'unit' | 'formation' | 'system';

export function Palette({ wg, color }: { wg: WarGames; color: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue>('unit');
  const [domain, setDomain] = useState<Domain>('ground');
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftComposition, setDraftComposition] = useState<Component[]>([]);

  const { pick, board, systems, echelonId, setEchelonId, deployCount, setDeployCount } = wg;
  const pickedType = pick.kind === 'unit' ? UNIT_BY_ID.get(pick.typeId) : undefined;
  const pickedSystem = pick.kind === 'unit' ? systemById(systems, pick.systemId) : undefined;
  const pickedFormation =
    pick.kind === 'formation' ? findFormation(pick.formationId, board.formations) : undefined;

  return (
    <section className="wg-block">
      <div className="wg-tabs">
        {(
          [
            ['unit', 'Units'],
            ['formation', 'Special units'],
            ['system', 'Systems'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`wg-tab${catalogue === id ? ' on' : ''}`}
            onClick={() => setCatalogue(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {catalogue === 'unit' && (
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
                  wg.chooseUnit(u.id);
                  wg.setTool('deploy');
                }}
                title={u.label}
              >
                <img src={unitPreview(u.id, color, u.defaultEchelon)} alt="" draggable={false} />
                <span>{u.label}</span>
              </button>
            ))}
          </div>

          {pickedType && (
            <>
              {/* The system is what carries the specs; without one the symbol is
                  still a symbol, it just knows nothing about itself. */}
              <h4 className="wg-sub">System</h4>
              <select
                className="wg-add"
                value={pick.kind === 'unit' ? (pick.systemId ?? '') : ''}
                onChange={(e) => wg.chooseSystem(e.target.value || undefined)}
                aria-label="System"
              >
                <option value="">Generic {pickedType.label.toLowerCase()} — no specifications</option>
                {systemsForType(systems, pickedType.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {pickedSystem && <p className="wg-note">{summarise(pickedSystem) || 'No figures recorded yet.'}</p>}

              <h4 className="wg-sub">How many</h4>
              <div className="wg-count-row">
                <div className="wg-stepper">
                  <button onClick={() => setDeployCount(deployCount - 1)} aria-label="One fewer">
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={deployCount}
                    onChange={(e) => setDeployCount(Number(e.target.value))}
                    aria-label="How many to deploy"
                  />
                  <button onClick={() => setDeployCount(deployCount + 1)} aria-label="One more">
                    +
                  </button>
                </div>
                {[1, 2, 4, 12].map((n) => (
                  <button
                    key={n}
                    className={`wg-quick${deployCount === n ? ' on' : ''}`}
                    onClick={() => setDeployCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <h4 className="wg-sub">Echelon</h4>
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
      )}

      {catalogue === 'formation' && (
        <>
          <p className="wg-hint wg-hint-top">
            A special unit is a formation of units. Pick one, set what is in it, then deploy.
          </p>

          <div className="wg-units">
            {wg.formations.map((f) => (
              <button
                key={f.id}
                className={`wg-unit${pick.kind === 'formation' && pick.formationId === f.id ? ' on' : ''}`}
                onClick={() => {
                  wg.chooseFormation(f.id);
                  wg.setTool('deploy');
                }}
                title={`${f.label} — ${describeComposition(f.composition, systems)}`}
              >
                <img src={formationPreview(f, color)} alt="" draggable={false} />
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
              <h4 className="wg-sub">Composition · {totalStrength(wg.pendingComposition)} units</h4>
              <CompositionEditor
                value={wg.pendingComposition}
                onChange={wg.setPendingComposition}
                color={color}
                systems={systems}
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
                color={color}
                systems={systems}
              />
              <p className="wg-note">
                Marked <b>{deriveAbbr(draftName || 'Special unit')}</b> on the map, drawn as whatever
                it has most of.
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
                    wg.setTool('deploy');
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
                    setDraftComposition(wg.pendingComposition.map((p) => ({ ...p })));
                  }}
                >
                  Save these counts
                </button>
              )}
            </div>
          )}
        </>
      )}

      {catalogue === 'system' && <SystemsEditor wg={wg} color={color} />}
    </section>
  );
}
