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

/** Interactive info tooltip component */
export function FieldInfo({ hint }: { hint?: string }) {
  if (!hint) return null;
  return (
    <span className="wg-field-tooltip" title={hint} tabIndex={0} aria-label={hint}>
      ℹ
      <span className="wg-field-tooltip-popover">{hint}</span>
    </span>
  );
}

/** A number input that treats an empty box as "not recorded", not as zero. */
function NumberField({
  label,
  value,
  onChange,
  unit,
  step,
  tooltip,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  unit?: string;
  step?: number;
  tooltip?: string;
}) {
  return (
    <label className="wg-field">
      <span>
        {label}
        {unit ? <em> {unit}</em> : null}
        {tooltip && <FieldInfo hint={tooltip} />}
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
  availableSystems = [],
}: {
  draft: SystemSpec;
  setDraft: (s: SystemSpec) => void;
  availableSystems?: SystemSpec[];
}) {
  const [open, setOpen] = useState<'sensor' | 'weapons' | 'platform' | null>('weapons');
  const patch = (p: Partial<SystemSpec>) => setDraft({ ...draft, ...p });
  const weapons = draft.weapons ?? [];

  // Extract all unique munitions / missiles across all systems
  const existingMunitions = useMemo(() => {
    const map = new Map<string, WeaponFacet>();
    for (const s of availableSystems) {
      for (const w of s.weapons ?? []) {
        if (w.name) {
          const key = (w.id || w.name).toLowerCase();
          if (!map.has(key)) {
            map.set(key, w);
          }
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [availableSystems]);

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
          <span>
            Name
            <FieldInfo hint="System or platform designation, e.g. S-400 Triumf, F-35A Lightning II, Arleigh Burke class." />
          </span>
          <input
            value={draft.name}
            placeholder="e.g. S-400 Triumf"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>

        <label className="wg-field wide">
          <span>
            Unit type — decides the map symbol
            <FieldInfo hint="Core operational classification (fighter, SAM battery, destroyer, submarine) used to draw the tactical symbol." />
          </span>
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
          <span>
            Origin
            <FieldInfo hint="Country of manufacture or operating nation (e.g. United States, China, Russia, Sweden)." />
          </span>
          <input
            value={draft.origin ?? ''}
            placeholder="e.g. Russia"
            onChange={(e) => patch({ origin: e.target.value || undefined })}
          />
        </label>

        <label className="wg-field">
          <span>
            Signature Tier
            <FieldInfo hint="Generic classification fallback. Used dynamically when explicit RCS (m²) is omitted: Low (0.01 m²), Medium (5.0 m²), High (1000.0 m²)." />
          </span>
          <select
            value={draft.signature ?? ''}
            onChange={(e) =>
              patch({ signature: (e.target.value || undefined) as SystemSpec['signature'] })
            }
          >
            <option value="">Default (Medium — 5.0 m²)</option>
            <option value="low">Low — stealthy (VLO / 0.01 m²)</option>
            <option value="medium">Medium — standard (5.0 m²)</option>
            <option value="high">High — conventional (1,000.0 m²)</option>
          </select>
        </label>

        <label className="wg-field">
          <span>
            RCS (m²)
            <FieldInfo hint="Explicit physical Radar Cross-Section in square meters. Scaled against 5.0 m² baseline. e.g. 0.0001 (F-22), 0.001 (F-35), 0.01 (Visby), 1.0 (MQ-9), 5.0 (Su-35), 100.0 (FREMM), 5000.0 (Type 055)." />
          </span>
          <input
            type="number"
            step="any"
            min="0.00001"
            placeholder={draft.signature === 'low' ? '0.01' : draft.signature === 'high' ? '1000.0' : '5.0'}
            value={draft.rcs !== undefined && draft.rcs !== null ? draft.rcs : ''}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              patch({ rcs: isNaN(val) || val <= 0 ? undefined : val });
            }}
          />
        </label>

        <label className="wg-field wide">
          <span>
            Note — variant, service dates, anything that qualifies the figures
            <FieldInfo hint="Historical context, block variants (e.g. Block IIA), or specific sensor/loadout assumptions." />
          </span>
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

              {/* Quick Preset Selector for Existing Missiles */}
              {existingMunitions.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <label className="wg-field">
                    <span>
                      Autofill from Existing Missile / Weapon
                      <FieldInfo hint="Select an existing missile from the arsenal catalogue to instantly autofill range, Pk, salvo, mass, and targets." />
                    </span>
                    <select
                      className="wg-inline-select"
                      value={w.id ?? ''}
                      onChange={(e) => {
                        const sel = e.target.value;
                        const matched = existingMunitions.find(
                          (m) => (m.id || m.name?.toLowerCase()) === sel
                        );
                        if (matched) {
                          setWeapon(i, {
                            id: matched.id,
                            name: matched.name,
                            rangeKm: matched.rangeKm,
                            minRangeKm: matched.minRangeKm,
                            massKg: matched.massKg,
                            salvo: matched.salvo ?? 2,
                            pk: matched.pk ?? 0.8,
                            reactionSec: matched.reactionSec ?? 5,
                            engages: matched.engages ? [...matched.engages] : undefined,
                            magazine: w.magazine ?? matched.magazine ?? 8,
                          });
                        }
                      }}
                    >
                      <option value="">-- Custom Weapon / Choose Preset Missile --</option>
                      {existingMunitions.map((m, mIdx) => (
                        <option key={mIdx} value={m.id || m.name?.toLowerCase()}>
                          {m.name} ({m.rangeKm ? `${m.rangeKm} km` : 'Direct'}{m.pk ? `, Pk ${m.pk}` : ''})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="wg-fields">
                <label className="wg-field">
                  <span>
                    Munition id<em> shared</em>
                    <FieldInfo hint="Shared identifier (e.g. sm-6, atacms-m39). Allows the same round to be carried on multiple platforms and swapped in custom loadouts." />
                  </span>
                  <input
                    value={w.id ?? ''}
                    placeholder={w.name ? nextSystemId(w.name).replace(/-[a-z0-9]{8,}$/, '') : 'sm-6'}
                    onChange={(e) => setWeapon(i, { id: e.target.value || undefined })}
                  />
                </label>
                <NumberField
                  label="Range"
                  unit="km"
                  value={w.rangeKm}
                  onChange={(v) => setWeapon(i, { rangeKm: v ?? 0 })}
                  tooltip="Maximum aerodynamic or ballistic engagement reach under standard profile."
                />
                <NumberField
                  label="Min range"
                  unit="km"
                  value={w.minRangeKm}
                  onChange={(v) => setWeapon(i, { minRangeKm: v })}
                  tooltip="Minimum engagement distance inside of which the booster or seeker cannot lock."
                />
                <NumberField
                  label="Launch mass"
                  unit="kg"
                  value={w.massKg}
                  onChange={(v) => setWeapon(i, { massKg: v })}
                  tooltip="All-up mass of single round in kilograms for payload capacity calculations."
                />
                <NumberField
                  label="Ready rounds"
                  value={w.magazine}
                  onChange={(v) => setWeapon(i, { magazine: v })}
                  tooltip="Total ready-to-fire ammunition capacity (rails, VLS cells, or internal magazine) before reloading."
                />
                <NumberField
                  label="Salvo"
                  value={w.salvo}
                  onChange={(v) => setWeapon(i, { salvo: v })}
                  tooltip="Number of rounds fired concurrently per target (e.g. 2 for standard shoot-look-shoot SAM doctrine)."
                />
                <NumberField
                  label="Kill prob."
                  step={0.05}
                  value={w.pk}
                  onChange={(v) => setWeapon(i, { pk: v })}
                  tooltip="Single-shot probability of kill (0.00 to 1.00) against an unjammed standard target."
                />
                <NumberField
                  label="Reaction"
                  unit="s"
                  value={w.reactionSec}
                  onChange={(v) => setWeapon(i, { reactionSec: v })}
                  tooltip="Reaction time in seconds from lock to weapon release. Fast targets traversing the envelope quicker than this cannot be engaged."
                />
                <NumberField
                  label="Speed"
                  unit={w.engages?.includes('subsurface') ? 'kts' : 'Mach'}
                  step={w.engages?.includes('subsurface') ? 1 : 0.1}
                  value={
                    w.engages?.includes('subsurface')
                      ? (w.speedKnots ?? (w.speedMach ? Math.round(w.speedMach * 666) : undefined))
                      : (w.speedMach ?? (w.speedKnots ? Number((w.speedKnots / 666).toFixed(2)) : undefined))
                  }
                  onChange={(v) => {
                    if (w.engages?.includes('subsurface')) {
                      setWeapon(i, { speedKnots: v, speedMach: undefined });
                    } else {
                      setWeapon(i, { speedMach: v, speedKnots: undefined });
                    }
                  }}
                  tooltip={
                    w.engages?.includes('subsurface')
                      ? 'Underwater torpedo speed in Knots (e.g. 55 kts for heavyweight torpedo, 45 kts for lightweight).'
                      : 'Flight speed in Mach (e.g. 0.88 for Tomahawk/Kalibr, 2.8 for BrahMos/Onyx, 6.0 for Hypersonic).'
                  }
                />
              </div>
              <span className="wg-field-label">
                Engages
                <FieldInfo hint="Target classifications this weapon is capable of intercepting." />
              </span>
              <TargetPicker value={w.engages} onChange={(v) => setWeapon(i, { engages: v })} />
            </div>
          ))}
          <p className="wg-note">
            The munition id is what lets the same round be recognised on another platform, and what
            the loadout editor offers when you swap armament on a deployed unit. Give the same
            munition the same id everywhere.
          </p>
          <div className="wg-row" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="wg-btn" type="button" onClick={() => patch({ weapons: [...weapons, { rangeKm: 0 }] })}>
              + Add Custom Weapon
            </button>
            {existingMunitions.length > 0 && (
              <select
                className="wg-btn"
                style={{
                  background: 'rgba(77, 208, 225, 0.12)',
                  borderColor: 'rgba(77, 208, 225, 0.35)',
                  color: '#4DD0E1',
                  cursor: 'pointer',
                  maxWidth: '280px',
                }}
                value=""
                onChange={(e) => {
                  const sel = e.target.value;
                  const matched = existingMunitions.find(
                    (m) => (m.id || m.name?.toLowerCase()) === sel
                  );
                  if (matched) {
                    patch({
                      weapons: [
                        ...weapons,
                        {
                          id: matched.id,
                          name: matched.name,
                          rangeKm: matched.rangeKm,
                          minRangeKm: matched.minRangeKm,
                          massKg: matched.massKg,
                          speedMach: (matched as any).speedMach,
                          speedKnots: (matched as any).speedKnots,
                          salvo: matched.salvo ?? 2,
                          pk: matched.pk ?? 0.8,
                          reactionSec: matched.reactionSec ?? 5,
                          engages: matched.engages ? [...matched.engages] : undefined,
                          magazine: matched.magazine ?? 8,
                        },
                      ],
                    });
                  }
                }}
              >
                <option value="">+ Add Existing Missile / Munition...</option>
                {existingMunitions.map((m, mIdx) => (
                  <option key={mIdx} value={m.id || m.name?.toLowerCase()}>
                    {m.name} ({m.rangeKm ? `${m.rangeKm} km` : 'Direct'})
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {section(
        'sensor',
        'Sensor & Sonar Suite',
        <>
          <div className="wg-fields">
            <NumberField
              label="Radar Detection"
              unit="km"
              value={draft.sensor?.detectionKm}
              onChange={(v) =>
                patch({ sensor: v === undefined ? undefined : { ...draft.sensor, detectionKm: v } })
              }
              tooltip="Maximum instrumented search / track acquisition range against a standard 3m² RCS target."
            />
            <NumberField
              label="Radar Tracks"
              value={draft.sensor?.tracks}
              onChange={(v) => sensor({ tracks: v })}
              tooltip="Maximum simultaneous radar track files the fire control computer can maintain."
            />
            <NumberField
              label="Fire channels"
              value={draft.sensor?.engagements}
              onChange={(v) => sensor({ engagements: v })}
              tooltip="Maximum concurrent target engagements and missile guidance uplinks this system can conduct."
            />
            <NumberField
              label="Antenna height"
              unit="m"
              value={draft.sensor?.antennaM}
              onChange={(v) => sensor({ antennaM: v })}
              tooltip="Radar antenna elevation in meters above terrain/sea level, used for radar horizon curvature calculations."
            />
          </div>
          <label className="wg-check">
            <input
              type="checkbox"
              checked={Boolean(draft.sensor?.horizonLimited)}
              onChange={(e) => sensor({ horizonLimited: e.target.checked })}
            />
            Limited by the radar horizon
            <FieldInfo hint="Applies Earth curvature limits against sea-skimming missiles or low-flying aircraft." />
          </label>
          <p className="wg-note">
            Tick that for anything on the ground or at sea. Its detection range will then be cut to
            what the earth’s curve actually allows against the altitude you are asking about — the
            antenna height above decides how much is left.
          </p>
          <span className="wg-field-label">
            Sees
            <FieldInfo hint="Target classifications detectable by this sensor array." />
          </span>
          <TargetPicker value={draft.sensor?.sees} onChange={(v) => sensor({ sees: v })} />

          {/* Subsurface Sonar Suite */}
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#4DD0E1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              🌊 Subsurface Sonar Suite (ASW & Submarine Warfare)
            </span>
            <div className="wg-fields" style={{ marginTop: '8px' }}>
              <label className="wg-field">
                <span>
                  Sonar Architecture
                  <FieldInfo hint="Acoustic transducer array type and deployment method." />
                </span>
                <select
                  className="wg-inline-select"
                  value={draft.sensor?.sonar?.type ?? 'hull_mounted'}
                  onChange={(e) =>
                    sensor({
                      sonar: {
                        ...(draft.sensor?.sonar ?? {}),
                        type: e.target.value as any,
                      },
                    })
                  }
                >
                  <option value="hull_mounted">Hull-Mounted High-Frequency Sonar</option>
                  <option value="towed_vds">Variable Depth Towed Sonar (VDS / CAPTAS-4)</option>
                  <option value="passive">Bow Conformal / Passive Sonar (Submarine)</option>
                  <option value="active">Spherical Active / Passive Bow Sonar</option>
                  <option value="dipping">Low-Frequency Dipping Sonar (Helicopter)</option>
                  <option value="sonobuoy_field">Multi-Static Sonobuoy Barrier Field (MPA)</option>
                  <option value="flank_array">Flank Array Sonar (Submarine)</option>
                </select>
              </label>
              <NumberField
                label="Submarine Detection"
                unit="km"
                value={draft.sensor?.sonar?.detectionKm}
                onChange={(v) =>
                  sensor({
                    sonar: {
                      ...(draft.sensor?.sonar ?? {}),
                      detectionKm: v,
                    },
                  })
                }
                tooltip="Acoustic detection and track convergence range against submerged submarine threats."
              />
              <NumberField
                label="Torpedo Warning"
                unit="km"
                value={draft.sensor?.sonar?.torpedoWarningKm}
                onChange={(v) =>
                  sensor({
                    sonar: {
                      ...(draft.sensor?.sonar ?? {}),
                      torpedoWarningKm: v,
                    },
                  })
                }
                tooltip="High-frequency acoustic intercept range to detect incoming torpedoes and deploy acoustic countermeasures (Nixie/ADC)."
              />
              <NumberField
                label="Acoustic Tracks"
                value={draft.sensor?.sonar?.tracks}
                onChange={(v) =>
                  sensor({
                    sonar: {
                      ...(draft.sensor?.sonar ?? {}),
                      tracks: v,
                    },
                  })
                }
                tooltip="Simultaneous underwater acoustic track files the combat system can maintain."
              />
            </div>
          </div>
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
            tooltip="Operational combat radius with weapon payload and unrefuelled return to base."
          />
          <NumberField
            label="Refuelled radius"
            unit="km"
            value={draft.platform?.refuelledRadiusKm}
            onChange={(v) => patch({ platform: { ...draft.platform, refuelledRadiusKm: v } })}
            tooltip="Extended radius achievable with one aerial tanker refuelling cycle."
          />
          <NumberField
            label="Ferry range"
            unit="km"
            value={draft.platform?.ferryRangeKm}
            onChange={(v) => patch({ platform: { ...draft.platform, ferryRangeKm: v } })}
            tooltip="Maximum one-way transit range with auxiliary fuel tanks and zero ordnance."
          />
          <NumberField
            label="Speed"
            unit="km/h"
            value={draft.platform?.speedKmh}
            onChange={(v) => patch({ platform: { ...draft.platform, speedKmh: v } })}
            tooltip="Maximum sustained combat speed in km/h (1225 km/h ≈ Mach 1.0)."
          />
          <NumberField
            label="Payload"
            unit="kg"
            value={draft.platform?.payloadKg}
            onChange={(v) => patch({ platform: { ...draft.platform, payloadKg: v } })}
            tooltip="Maximum external and internal weapon ordnance carriage capacity in kilograms."
          />
          <NumberField
            label="VLS cells"
            value={draft.platform?.vls}
            onChange={(v) => patch({ platform: { ...draft.platform, vls: v } })}
            tooltip="Total vertical launch system (VLS) cells for SAMs, cruise missiles, and ASW rockets."
          />
          <NumberField
            label="Aircraft"
            value={draft.platform?.aircraft}
            onChange={(v) => patch({ platform: { ...draft.platform, aircraft: v } })}
            tooltip="Embarked air wing capacity (fixed-wing and rotary) for carriers and amphibious ships."
          />
          <NumberField
            label="Displacement"
            unit="t"
            value={draft.platform?.displacementT}
            onChange={(v) => patch({ platform: { ...draft.platform, displacementT: v } })}
            tooltip="Full load naval displacement in metric tons."
          />
          <NumberField
            label="Endurance"
            unit="days"
            value={draft.platform?.enduranceDays}
            onChange={(v) => patch({ platform: { ...draft.platform, enduranceDays: v } })}
            tooltip="Autonomous mission duration at sea before requiring replenishment."
          />
          <NumberField
            label="Crew"
            value={draft.platform?.crew}
            onChange={(v) => patch({ platform: { ...draft.platform, crew: v } })}
            tooltip="Operating personnel complement required for full readiness."
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
          <SystemForm draft={draft} setDraft={setDraft} availableSystems={wg.systems} />
        </Modal>
      )}
    </>
  );
}
