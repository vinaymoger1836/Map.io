'use client';

/**
 * The systems catalogue: what a thing on the board actually is.
 *
 * Library entries are read-only — duplicating one is how you disagree with a
 * figure, which keeps the shipped numbers honest and your changes yours. A
 * system authored here is available to every scenario, because it is
 * configuration rather than board state.
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { DOMAINS, UNIT_BY_ID, unitsInDomain } from '@/lib/warGames';
import {
  TARGET_CLASSES,
  nextSystemId,
  summarise,
  type SystemSpec,
  type TargetClass,
  type WeaponFacet,
} from '@/lib/specs';
import { unitPreview } from './icons';
import { SpecSheet } from './SpecSheet';

const BLANK: SystemSpec = { id: '', name: '', typeId: 'fighter', custom: true };

/** A number input that treats an empty box as "not recorded", not as zero. */
function NumberField({
  label,
  value,
  onChange,
  unit,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  unit?: string;
  step?: number;
}) {
  return (
    <label className="wg-field">
      <span>
        {label}
        {unit ? <em> {unit}</em> : null}
      </span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

function TargetPicker({
  value,
  onChange,
}: {
  value: TargetClass[] | undefined;
  onChange: (v: TargetClass[] | undefined) => void;
}) {
  const held = value ?? [];
  const toggle = (id: TargetClass) => {
    const next = held.includes(id) ? held.filter((t) => t !== id) : [...held, id];
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="wg-targets">
      {TARGET_CLASSES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`wg-target${held.includes(t.id) ? ' on' : ''}`}
          onClick={() => toggle(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SystemForm({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: SystemSpec;
  setDraft: (s: SystemSpec) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState<'sensor' | 'weapons' | 'platform' | null>('sensor');
  const patch = (p: Partial<SystemSpec>) => setDraft({ ...draft, ...p });
  const weapons = draft.weapons ?? [];

  const setWeapon = (i: number, p: Partial<WeaponFacet>) =>
    patch({ weapons: weapons.map((w, idx) => (idx === i ? { ...w, ...p } : w)) });

  const section = (id: 'sensor' | 'weapons' | 'platform', label: string, body: React.ReactNode) => (
    <div className="wg-facet">
      <button
        type="button"
        className="wg-disclose"
        aria-expanded={open === id}
        onClick={() => setOpen(open === id ? null : id)}
      >
        <span className={`chevron${open === id ? '' : ' closed'}`} aria-hidden />
        {label}
      </button>
      {open === id && <div className="wg-facet-body">{body}</div>}
    </div>
  );

  return (
    <div className="wg-creator">
      <h4 className="wg-sub">{draft.id ? 'Edit system' : 'New system'}</h4>

      <input
        className="wg-search"
        value={draft.name}
        placeholder="Name, e.g. S-400 Triumf"
        onChange={(e) => patch({ name: e.target.value })}
        aria-label="System name"
      />

      <label className="wg-field wide">
        <span>Unit type</span>
        <select value={draft.typeId} onChange={(e) => patch({ typeId: e.target.value })}>
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

      <input
        className="wg-search"
        value={draft.origin ?? ''}
        placeholder="Origin, e.g. Russia"
        onChange={(e) => patch({ origin: e.target.value || undefined })}
        aria-label="Origin"
      />

      {section(
        'sensor',
        'Sensor',
        <>
          <div className="wg-fields">
            <NumberField
              label="Detection"
              unit="km"
              value={draft.sensor?.detectionKm}
              onChange={(v) =>
                patch({ sensor: v === undefined ? undefined : { ...draft.sensor, detectionKm: v } })
              }
            />
            <NumberField
              label="Tracks"
              value={draft.sensor?.tracks}
              onChange={(v) =>
                patch({ sensor: { ...(draft.sensor ?? { detectionKm: 0 }), tracks: v } })
              }
            />
            <NumberField
              label="Fire channels"
              value={draft.sensor?.engagements}
              onChange={(v) =>
                patch({ sensor: { ...(draft.sensor ?? { detectionKm: 0 }), engagements: v } })
              }
            />
          </div>
          <label className="wg-check">
            <input
              type="checkbox"
              checked={Boolean(draft.sensor?.horizonLimited)}
              onChange={(e) =>
                patch({
                  sensor: { ...(draft.sensor ?? { detectionKm: 0 }), horizonLimited: e.target.checked },
                })
              }
            />
            Limited by the radar horizon
          </label>
          <TargetPicker
            value={draft.sensor?.sees}
            onChange={(v) => patch({ sensor: { ...(draft.sensor ?? { detectionKm: 0 }), sees: v } })}
          />
        </>
      )}

      {section(
        'weapons',
        `Weapons${weapons.length ? ` · ${weapons.length}` : ''}`,
        <>
          {weapons.map((w, i) => (
            <div className="wg-weapon" key={i}>
              <div className="wg-weapon-head">
                <input
                  className="wg-search"
                  value={w.name ?? ''}
                  placeholder="Weapon name"
                  onChange={(e) => setWeapon(i, { name: e.target.value || undefined })}
                  aria-label="Weapon name"
                />
                <button
                  className="wg-comp-del"
                  onClick={() => patch({ weapons: weapons.filter((_, idx) => idx !== i) })}
                  aria-label="Remove weapon"
                >
                  ×
                </button>
              </div>
              <div className="wg-fields">
                <NumberField label="Range" unit="km" value={w.rangeKm} onChange={(v) => setWeapon(i, { rangeKm: v ?? 0 })} />
                <NumberField label="Ready rounds" value={w.magazine} onChange={(v) => setWeapon(i, { magazine: v })} />
                <NumberField label="Salvo" value={w.salvo} onChange={(v) => setWeapon(i, { salvo: v })} />
                <NumberField label="Kill prob." step={0.05} value={w.pk} onChange={(v) => setWeapon(i, { pk: v })} />
                <NumberField label="Reaction" unit="s" value={w.reactionSec} onChange={(v) => setWeapon(i, { reactionSec: v })} />
              </div>
              <TargetPicker value={w.engages} onChange={(v) => setWeapon(i, { engages: v })} />
            </div>
          ))}
          <button
            className="wg-btn"
            onClick={() => patch({ weapons: [...weapons, { rangeKm: 0 }] })}
          >
            Add weapon
          </button>
        </>
      )}

      {section(
        'platform',
        'Platform',
        <div className="wg-fields">
          <NumberField
            label="Combat radius"
            unit="km"
            value={draft.platform?.combatRadiusKm}
            onChange={(v) => patch({ platform: { ...draft.platform, combatRadiusKm: v } })}
          />
          <NumberField
            label="Refuelled radius"
            unit="km"
            value={draft.platform?.refuelledRadiusKm}
            onChange={(v) => patch({ platform: { ...draft.platform, refuelledRadiusKm: v } })}
          />
          <NumberField
            label="Speed"
            unit="km/h"
            value={draft.platform?.speedKmh}
            onChange={(v) => patch({ platform: { ...draft.platform, speedKmh: v } })}
          />
          <NumberField
            label="Payload"
            unit="kg"
            value={draft.platform?.payloadKg}
            onChange={(v) => patch({ platform: { ...draft.platform, payloadKg: v } })}
          />
          <NumberField
            label="VLS cells"
            value={draft.platform?.vls}
            onChange={(v) => patch({ platform: { ...draft.platform, vls: v } })}
          />
          <NumberField
            label="Aircraft"
            value={draft.platform?.aircraft}
            onChange={(v) => patch({ platform: { ...draft.platform, aircraft: v } })}
          />
          <NumberField
            label="Displacement"
            unit="t"
            value={draft.platform?.displacementT}
            onChange={(v) => patch({ platform: { ...draft.platform, displacementT: v } })}
          />
          <NumberField
            label="Crew"
            value={draft.platform?.crew}
            onChange={(v) => patch({ platform: { ...draft.platform, crew: v } })}
          />
        </div>
      )}

      <div className="wg-row">
        <button className="wg-btn" disabled={!draft.name.trim()} onClick={onSave}>
          Save
        </button>
        <button className="wg-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SystemsEditor({ wg, color }: { wg: WarGames; color: string }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<SystemSpec | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wg.systems.slice(0, 40);
    return wg.systems
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (UNIT_BY_ID.get(s.typeId)?.label ?? '').toLowerCase().includes(q) ||
          (s.origin ?? '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [wg.systems, query]);

  return (
    <>
      <p className="wg-hint wg-hint-top">
        A system is what a unit is: an S-400 rather than a launcher. Library entries are read-only —
        duplicate one to change its figures.
      </p>

      <input
        className="wg-search"
        type="search"
        value={query}
        placeholder={`Search ${wg.systems.length} systems…`}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search systems"
      />

      <div className="wg-systems">
        {visible.map((spec) => {
          const type = UNIT_BY_ID.get(spec.typeId);
          const isOpen = expanded === spec.id;
          return (
            <div className={`wg-system${isOpen ? ' on' : ''}`} key={spec.id}>
              <button className="wg-system-head" onClick={() => setExpanded(isOpen ? null : spec.id)}>
                <img src={unitPreview(spec.typeId, color)} alt="" />
                <span className="wg-system-name">
                  <b>{spec.name}</b>
                  <em>
                    {type?.label ?? spec.typeId}
                    {spec.origin ? ` · ${spec.origin}` : ''}
                    {spec.custom ? ' · yours' : ''}
                  </em>
                </span>
                <span className="wg-system-sum">{summarise(spec)}</span>
              </button>

              {isOpen && (
                <div className="wg-system-body">
                  <SpecSheet spec={spec} compact />
                  <div className="wg-row">
                    <button
                      className="wg-btn"
                      onClick={() =>
                        setDraft(
                          spec.custom
                            ? { ...spec }
                            : {
                                ...spec,
                                id: '',
                                name: `${spec.name} (mine)`,
                                custom: true,
                              }
                        )
                      }
                    >
                      {spec.custom ? 'Edit' : 'Duplicate'}
                    </button>
                    {spec.custom && (
                      <button className="wg-btn danger" onClick={() => wg.deleteSystem(spec.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!visible.length && (
          <p className="wg-empty">
            {wg.systems.length ? 'Nothing by that name.' : 'No systems yet — add one below.'}
          </p>
        )}
      </div>

      {draft ? (
        <SystemForm
          draft={draft}
          setDraft={setDraft}
          onSave={() => {
            wg.saveSystem({ ...draft, id: draft.id || nextSystemId(draft.name) });
            setDraft(null);
          }}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <div className="wg-row">
          <button className="wg-btn" onClick={() => setDraft({ ...BLANK })}>
            New system
          </button>
        </div>
      )}
    </>
  );
}
