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
import { DOMAINS, UNIT_BY_ID, unitsInDomain, type Domain } from '@/lib/warGames';
import {
  TARGET_CLASSES,
  domainOf,
  nextSystemId,
  summarise,
  type SystemSpec,
  type TargetClass,
  type WeaponFacet,
} from '@/lib/specs';
import { unitPreview } from './icons';
import { Modal } from './Modal';
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
          title={t.hint}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The whole schema, in a dialog.
 *
 * Every field is optional except the name and the unit type, because a system
 * you know three things about is more useful than one you cannot save until you
 * know thirty. Blank means "not recorded" throughout — never zero.
 */
export function SystemForm({
  draft,
  setDraft,
}: {
  draft: SystemSpec;
  setDraft: (s: SystemSpec) => void;
}) {
  const [open, setOpen] = useState<'sensor' | 'weapons' | 'platform' | null>('weapons');
  const patch = (p: Partial<SystemSpec>) => setDraft({ ...draft, ...p });
  const weapons = draft.weapons ?? [];

  const setWeapon = (i: number, p: Partial<WeaponFacet>) =>
    patch({ weapons: weapons.map((w, idx) => (idx === i ? { ...w, ...p } : w)) });

  /** Sensor edits must not resurrect a facet the user emptied out. */
  const sensor = (p: Partial<NonNullable<SystemSpec['sensor']>>) =>
    patch({ sensor: { ...(draft.sensor ?? { detectionKm: 0 }), ...p } });

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
    <div className="wg-form">
      <div className="wg-form-top">
        <label className="wg-field wide">
          <span>Name</span>
          <input
            value={draft.name}
            placeholder="e.g. S-400 Triumf"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>

        <label className="wg-field wide">
          <span>Unit type — decides the map symbol</span>
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

        <label className="wg-field">
          <span>Origin</span>
          <input
            value={draft.origin ?? ''}
            placeholder="e.g. Russia"
            onChange={(e) => patch({ origin: e.target.value || undefined })}
          />
        </label>

        <label className="wg-field">
          <span>Signature</span>
          <select
            value={draft.signature ?? ''}
            onChange={(e) =>
              patch({ signature: (e.target.value || undefined) as SystemSpec['signature'] })
            }
          >
            <option value="">Not recorded</option>
            <option value="low">Low — stealthy</option>
            <option value="medium">Medium</option>
            <option value="high">High — conventional</option>
          </select>
        </label>

        <label className="wg-field wide">
          <span>Note — variant, service dates, anything that qualifies the figures</span>
          <textarea
            rows={2}
            value={draft.note ?? ''}
            onChange={(e) => patch({ note: e.target.value || undefined })}
          />
        </label>
      </div>

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
                  placeholder="Weapon name, e.g. SM-6"
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
                <label className="wg-field">
                  <span>
                    Munition id<em> shared</em>
                  </span>
                  <input
                    value={w.id ?? ''}
                    placeholder={w.name ? nextSystemId(w.name).replace(/-[a-z0-9]{8,}$/, '') : 'sm-6'}
                    onChange={(e) => setWeapon(i, { id: e.target.value || undefined })}
                  />
                </label>
                <NumberField label="Range" unit="km" value={w.rangeKm} onChange={(v) => setWeapon(i, { rangeKm: v ?? 0 })} />
                <NumberField label="Min range" unit="km" value={w.minRangeKm} onChange={(v) => setWeapon(i, { minRangeKm: v })} />
                <NumberField label="Launch mass" unit="kg" value={w.massKg} onChange={(v) => setWeapon(i, { massKg: v })} />
                <NumberField label="Ready rounds" value={w.magazine} onChange={(v) => setWeapon(i, { magazine: v })} />
                <NumberField label="Salvo" value={w.salvo} onChange={(v) => setWeapon(i, { salvo: v })} />
                <NumberField label="Kill prob." step={0.05} value={w.pk} onChange={(v) => setWeapon(i, { pk: v })} />
                <NumberField label="Reaction" unit="s" value={w.reactionSec} onChange={(v) => setWeapon(i, { reactionSec: v })} />
              </div>
              <span className="wg-field-label">Engages</span>
              <TargetPicker value={w.engages} onChange={(v) => setWeapon(i, { engages: v })} />
            </div>
          ))}
          <p className="wg-note">
            The munition id is what lets the same round be recognised on another platform, and what
            the loadout editor offers when you swap armament on a deployed unit. Give the same
            munition the same id everywhere.
          </p>
          <button className="wg-btn" onClick={() => patch({ weapons: [...weapons, { rangeKm: 0 }] })}>
            Add weapon
          </button>
        </>
      )}

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
            <NumberField label="Tracks held" value={draft.sensor?.tracks} onChange={(v) => sensor({ tracks: v })} />
            <NumberField label="Fire channels" value={draft.sensor?.engagements} onChange={(v) => sensor({ engagements: v })} />
            <NumberField label="Antenna height" unit="m" value={draft.sensor?.antennaM} onChange={(v) => sensor({ antennaM: v })} />
          </div>
          <label className="wg-check">
            <input
              type="checkbox"
              checked={Boolean(draft.sensor?.horizonLimited)}
              onChange={(e) => sensor({ horizonLimited: e.target.checked })}
            />
            Limited by the radar horizon
          </label>
          <p className="wg-note">
            Tick that for anything on the ground or at sea. Its detection range will then be cut to
            what the earth’s curve actually allows against the altitude you are asking about — the
            antenna height above decides how much is left.
          </p>
          <span className="wg-field-label">Sees</span>
          <TargetPicker value={draft.sensor?.sees} onChange={(v) => sensor({ sees: v })} />
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
            label="Ferry range"
            unit="km"
            value={draft.platform?.ferryRangeKm}
            onChange={(v) => patch({ platform: { ...draft.platform, ferryRangeKm: v } })}
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
            label="Endurance"
            unit="days"
            value={draft.platform?.enduranceDays}
            onChange={(v) => patch({ platform: { ...draft.platform, enduranceDays: v } })}
          />
          <NumberField
            label="Crew"
            value={draft.platform?.crew}
            onChange={(v) => patch({ platform: { ...draft.platform, crew: v } })}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const ALL: Domain | 'all' = 'all';

export function ArmamentsSection({ wg, color }: { wg: WarGames; color: string }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<Domain | 'all'>(ALL);
  const [draft, setDraft] = useState<SystemSpec | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return wg.systems.filter((s) => {
      if (domain !== ALL && domainOf(s) !== domain) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (UNIT_BY_ID.get(s.typeId)?.label ?? '').toLowerCase().includes(q) ||
        (s.origin ?? '').toLowerCase().includes(q) ||
        (s.weapons ?? []).some((w) => (w.name ?? '').toLowerCase().includes(q))
      );
    });
  }, [wg.systems, query, domain]);

  const shown = visible.slice(0, 60);

  return (
    <>
      <section className="wg-block">
        <h3 className="wg-h">
          Armaments
          <span className="wg-h-note">{wg.systems.length} systems</span>
        </h3>

        <p className="wg-hint wg-hint-top">
          A system is what a unit <i>is</i>: an S-400 rather than a launcher. Library entries are
          read-only — duplicate one to disagree with a figure, and your copy replaces it everywhere.
        </p>

        <input
          className="wg-search"
          type="search"
          value={query}
          placeholder="Search by name, type, origin or weapon…"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search systems"
        />

        <div className="wg-domains">
          <button className={`wg-domain${domain === ALL ? ' on' : ''}`} onClick={() => setDomain(ALL)}>
            All
          </button>
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

        <div className="wg-row">
          <button className="wg-btn accent" onClick={() => setDraft({ ...BLANK })}>
            New system
          </button>
        </div>
      </section>

      <section className="wg-block">
        <div className="wg-systems">
          {shown.map((spec) => {
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
                    {spec.note && <p className="wg-note">{spec.note}</p>}
                    <SpecSheet spec={spec} compact />
                    <div className="wg-row">
                      <button
                        className="wg-btn"
                        onClick={() =>
                          setDraft(
                            spec.custom
                              ? { ...spec }
                              : { ...spec, id: '', name: `${spec.name} (mine)`, custom: true }
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

          {!shown.length && (
            <p className="wg-empty">
              {wg.systems.length ? 'Nothing matches that.' : 'No systems loaded.'}
            </p>
          )}
        </div>

        {visible.length > shown.length && (
          <p className="wg-note">
            Showing {shown.length} of {visible.length}. Narrow the search to see the rest.
          </p>
        )}
      </section>

      {draft && (
        <Modal
          title={draft.id ? `Edit ${draft.name || 'system'}` : 'New system'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <span className="wg-modal-hint">
                Every field but the name is optional. Blank means <i>not recorded</i>, never zero.
              </span>
              <div className="wg-row">
                <button className="wg-btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button
                  className="wg-btn accent"
                  disabled={!draft.name.trim()}
                  onClick={() => {
                    wg.saveSystem({ ...draft, id: draft.id || nextSystemId(draft.name) });
                    setDraft(null);
                  }}
                >
                  Save
                </button>
              </div>
            </>
          }
        >
          <SystemForm draft={draft} setDraft={setDraft} />
        </Modal>
      )}
    </>
  );
}
