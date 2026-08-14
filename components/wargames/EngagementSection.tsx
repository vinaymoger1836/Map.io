'use client';

/**
 * Enhanced Raid & Engagement Console.
 *
 * Multiplies capabilities across the great-circle penetration path:
 * 1. Stealth RCS scaling (VLO 5th-gen delay and bypass)
 * 2. Stand-off weapon release (aircraft ingress to release range, munitions fly terminal)
 * 3. Composite Strike Packages & Escorts (EW jamming & SEAD anti-radiation suppression)
 * 4. Radar horizon curvature and detection network cueing
 */

import { useMemo } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { attrition, verdict, type Assessment, type SilentReason } from '@/lib/engagement';
import { distanceKm } from '@/lib/geo';
import { standoffWeapons, TARGET_LABEL } from '@/lib/specs';
import { unitLabel, type DeployedUnit } from '@/lib/warGames';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;
const n1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

const SILENT: Record<SilentReason, string> = {
  'too-fast': 'through before it can fire',
  dry: 'out of ready rounds',
  'nothing-left': 'nothing left to engage',
  blind: 'in range, never detected',
  'stealth-bypassed': 'stealth: bypassed undetected',
  'standoff-out-of-range': 'standoff: out of reach',
};

const ALTITUDES: [number, string, string][] = [
  [100, 'Low', 'Under the horizon of most ground radars — the reason to fly it'],
  [3_000, 'Medium', 'Seen by most things well before they can shoot'],
  [10_000, 'High', 'Seen by everything, at close to brochure range'],
];

function Picker({
  label,
  hint,
  units,
  value,
  onChange,
  wg,
  emptyText,
}: {
  label: string;
  hint: string;
  units: DeployedUnit[];
  value: string | null;
  onChange: (id: string | null) => void;
  wg: WarGames;
  emptyText: string;
}) {
  return (
    <label className="wg-field wide">
      <span>
        {label} <em>{hint}</em>
      </span>
      {units.length ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {wg.board.nations[u.iso]?.name ?? u.iso} — {unitLabel(u, wg.formations, wg.systems)}
            </option>
          ))}
        </select>
      ) : (
        <p className="wg-empty">{emptyText}</p>
      )}
    </label>
  );
}

function Result({ a }: { a: Assessment }) {
  const share = attrition(a);
  const isStandoff = Boolean(a.raid.standoff?.enabled);

  return (
    <>
      <p className={`wg-verdict${share > 0.6 && !isStandoff ? ' hot' : ''}`}>{verdict(a)}</p>

      {!a.blocked && (
        <div className="wg-tactical-card" style={{ marginTop: '10px' }}>
          {isStandoff ? (
            <>
              <div className="wg-tactical-title">
                <span>Stand-Off Strike Assessment</span>
                <span className="wg-tag standoff">Stand-off</span>
              </div>
              <div className="wg-tactical-body">
                <p style={{ margin: '4px 0' }}>
                  <strong>{n1(a.aircraftSurviving.stated)}</strong> of {a.raid.count} launch aircraft
                  egress safely{' '}
                  {a.aircraftLost.stated > 0 && (
                    <span style={{ color: '#E4572E' }}>
                      ({n1(a.aircraftLost.stated)} lost during {km(a.releaseKm ?? 0)} ingress)
                    </span>
                  )}
                  .
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong>{n1(a.leakers.low)}</strong>
                  {a.leakers.high - a.leakers.low > 0.05 && (
                    <> – <strong>{n1(a.leakers.high)}</strong></>
                  )}{' '}
                  of {a.standoffLaunched ?? 0} <em>{a.raid.standoff?.weaponName}</em> stand-off munitions
                  impact target.
                </p>
                <span className="wg-leakers-sub">
                  Released at {km(a.distanceKm - (a.releaseKm ?? 0))} stand-off range · {km(a.distanceKm)} total run ·{' '}
                  Munitions engaged as <em>{TARGET_LABEL[a.threat] ?? a.threat}</em>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="wg-tactical-title">
                <span>Direct Penetration Assessment</span>
                {a.raid.signature && (
                  <span
                    className={`wg-tag ${
                      a.raid.signature === 'low'
                        ? 'stealth'
                        : a.raid.signature === 'medium'
                          ? 'sead'
                          : ''
                    }`}
                  >
                    {a.raid.signature.toUpperCase()} RCS
                  </span>
                )}
              </div>
              <p className="wg-leakers">
                <strong>{n1(a.leakers.low)}</strong>
                {a.leakers.high - a.leakers.low > 0.05 && (
                  <> – <strong>{n1(a.leakers.high)}</strong></>
                )}{' '}
                of {a.raid.count} arrive
                <span className="wg-leakers-sub">
                  {n1(a.leakers.stated)} at stated figures · {Math.round(share * 100)}% attrition ·{' '}
                  {km(a.distanceKm)} run · engaged as <em>{TARGET_LABEL[a.threat] ?? a.threat}</em>
                </span>
              </p>
            </>
          )}

          {/* Tactical Advantage Summaries */}
          {a.stealthAdvantage && (
            <p className="wg-note" style={{ color: '#3FB0A0', marginTop: '6px' }}>
              ✦ {a.stealthAdvantage}
            </p>
          )}
          {a.ewSummary && (
            <p className="wg-note" style={{ color: '#9AA7B4', marginTop: '4px' }}>
              ✦ {a.ewSummary}
            </p>
          )}
          {a.seadSummary && (
            <p className="wg-note" style={{ color: '#E8833A', marginTop: '4px' }}>
              ✦ {a.seadSummary}
            </p>
          )}
        </div>
      )}

      {a.engagements.length > 0 && (
        <>
          <h4 className="wg-sub">Layers, in the order the raid meets them</h4>
          <table className="wg-table wg-layers">
            <thead>
              <tr>
                <th>At</th>
                <th>Firing</th>
                <th className="num">Facing</th>
                <th className="num">Rounds</th>
                <th className="num">Lost</th>
              </tr>
            </thead>
            <tbody>
              {a.engagements.map((e, i) => (
                <tr key={`${e.unitId}-${i}`} className={e.silent ? 'wg-silent' : undefined}>
                  <td>
                    {km(e.entryKm)}
                    <span className="wg-layer-sub">{Math.round(e.exposureSec)} s exposed</span>
                  </td>
                  <td>
                    {e.unitLabel}
                    {e.phase === 'munition-flight' && <span className="wg-tag standoff">munition</span>}
                    {e.phase === 'aircraft-ingress' && <span className="wg-tag">ingress</span>}
                    {e.cued && <span className="wg-tag">cued</span>}
                    {e.jammed && <span className="wg-tag jammed">jammed</span>}
                    {e.seadSuppressed && <span className="wg-tag sead">SEAD</span>}
                    {e.stealthDelayed && <span className="wg-tag stealth">stealth delayed</span>}
                    {e.stealthBypassed && <span className="wg-tag bypassed">bypassed</span>}
                    <span className="wg-layer-sub">
                      {e.weaponName} · {km(e.rangeKm)}
                      {e.heldFireKm !== undefined && ` · held fire ${km(e.heldFireKm)}`}
                      {e.assumedEngages && ' · target class not stated'}
                      {e.seadSuppressed && ' · channels halved'}
                      {e.jammed && ' · -25% Pk'}
                    </span>
                  </td>
                  <td className="num">{n1(e.facing)}</td>
                  <td className="num">{e.silent ? '—' : n1(e.rounds)}</td>
                  <td className="num">{e.silent ? SILENT[e.silent] : n1(e.killed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {a.unmodelled.length > 0 && (
        <>
          <h4 className="wg-sub">Cannot be modelled</h4>
          <ul className="wg-unmodelled">
            {a.unmodelled.map((u, i) => (
              <li key={i}>
                {u.weaponName} <em>on {u.unitLabel}</em>
              </li>
            ))}
          </ul>
          <p className="wg-note wg-warn">
            These weapons are in range and can engage this raid, but record no kill probability, so
            nothing above counts them. A missing figure is not a zero — the defence is stronger than
            the number says, by an amount nobody can state.
          </p>
        </>
      )}
    </>
  );
}

export function EngagementSection({ wg }: { wg: WarGames }) {
  const {
    board,
    raidFromId,
    raidToId,
    assessment,
    standoffEnabled,
    setStandoffEnabled,
    selectedWeaponIndex,
    setSelectedWeaponIndex,
    selectedEwEscortId,
    setSelectedEwEscortId,
    selectedSeadEscortId,
    setSelectedSeadEscortId,
  } = wg;

  const attacker = board.units.find((u) => u.id === raidFromId) ?? null;

  const targets = useMemo(() => {
    if (!attacker) return [];
    return board.units
      .filter((u) => u.iso !== attacker.iso)
      .sort((a, b) => distanceKm(attacker.lngLat, a.lngLat) - distanceKm(attacker.lngLat, b.lngLat));
  }, [board.units, attacker]);

  const target = board.units.find((u) => u.id === raidToId) ?? null;
  const runKm = attacker && target ? distanceKm(attacker.lngLat, target.lngLat) : null;

  // Friendly units for escort selection
  const friendlyUnits = useMemo(() => {
    if (!attacker) return [];
    return board.units.filter((u) => u.iso === attacker.iso && u.id !== attacker.id);
  }, [board.units, attacker]);

  const ewOptions = useMemo(
    () => friendlyUnits.filter((u) => u.kind === 'unit' && (u.typeId === 'ew' || u.typeId === 'jammer')),
    [friendlyUnits]
  );

  const seadOptions = useMemo(
    () =>
      friendlyUnits.filter(
        (u) => u.kind === 'unit' && (u.typeId === 'fighter' || u.typeId === 'strike' || u.typeId === 'special-forces')
      ),
    [friendlyUnits]
  );

  // Available standoff weapons on attacker
  const attackerSpec = attacker
    ? wg.systems.find((s) => s.id === (attacker.kind === 'unit' ? attacker.systemId : undefined))
    : undefined;

  const availableStandoff = attackerSpec ? standoffWeapons(attackerSpec) : [];

  const reach = attackerSpec?.platform;
  const radius = reach?.combatRadiusKm;
  const refuelled = reach?.refuelledRadiusKm;

  return (
    <>
      <section className="wg-block">
        <h3 className="wg-h">
          Raid
          {assessment && !assessment.blocked && (
            <span className="wg-h-note">
              {assessment.engagements.length} {assessment.engagements.length === 1 ? 'layer' : 'layers'}
            </span>
          )}
        </h3>

        <Picker
          label="Flown by"
          hint="a unit or strike package"
          units={wg.raidCandidates}
          value={raidFromId}
          onChange={wg.setRaidFrom}
          wg={wg}
          emptyText="Nothing on the board can fly a raid. Deploy a strike aircraft, fighter, or strike package with recorded speed."
        />

        {/* Formation Package Info */}
        {assessment?.raid.isComposite && assessment.raid.packageDetails && (
          <div className="wg-tactical-card">
            <div className="wg-tactical-title">
              <span>Strike Package Composition</span>
              <span className="wg-tag">Package</span>
            </div>
            <div className="wg-package-pills">
              <span className="wg-package-pill">
                <strong>{assessment.raid.packageDetails.strikeCount}</strong>
                <em>{assessment.raid.packageDetails.strikePlatformName ?? 'Strike'}</em>
              </span>
              {assessment.raid.packageDetails.seadCount > 0 && (
                <span className="wg-package-pill" style={{ color: '#E8833A' }}>
                  <strong>{assessment.raid.packageDetails.seadCount}</strong>
                  <em>SEAD Escort</em>
                </span>
              )}
              {assessment.raid.packageDetails.ewCount > 0 && (
                <span className="wg-package-pill" style={{ color: '#9AA7B4' }}>
                  <strong>{assessment.raid.packageDetails.ewCount}</strong>
                  <em>EW Jammer</em>
                </span>
              )}
              {assessment.raid.packageDetails.awacsCount > 0 && (
                <span className="wg-package-pill">
                  <strong>{assessment.raid.packageDetails.awacsCount}</strong>
                  <em>AEW&C</em>
                </span>
              )}
              {assessment.raid.packageDetails.tankerCount > 0 && (
                <span className="wg-package-pill">
                  <strong>{assessment.raid.packageDetails.tankerCount}</strong>
                  <em>Tanker</em>
                </span>
              )}
            </div>
          </div>
        )}

        {/* RCS Signature Indicator */}
        {attackerSpec?.signature && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--paper-dim)' }}>
            <span>Radar Signature: </span>
            <span
              className={`wg-tag ${
                attackerSpec.signature === 'low'
                  ? 'stealth'
                  : attackerSpec.signature === 'medium'
                    ? 'sead'
                    : ''
              }`}
            >
              {attackerSpec.signature === 'low'
                ? '5th-Gen VLO Stealth (-75% radar reach)'
                : attackerSpec.signature === 'medium'
                  ? '4.5-Gen Reduced RCS (-35% radar reach)'
                  : 'Standard 4th-Gen RCS'}
            </span>
          </div>
        )}

        <Picker
          label="Against"
          hint="anything not its own"
          units={targets}
          value={raidToId}
          onChange={wg.setRaidTo}
          wg={wg}
          emptyText={
            attacker ? 'Nothing belonging to another nation is on the board.' : 'Pick a raider first.'
          }
        />

        {/* Stand-Off Weapon Controls */}
        {availableStandoff.length > 0 && (
          <div className="wg-tactical-card">
            <div className="wg-tactical-title">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={standoffEnabled}
                  onChange={(e) => setStandoffEnabled(e.target.checked)}
                />
                <span>Stand-Off Weapon Release</span>
              </label>
              {standoffEnabled && <span className="wg-tag standoff">Active</span>}
            </div>

            {standoffEnabled && (
              <div style={{ marginTop: '6px' }}>
                <select
                  value={selectedWeaponIndex}
                  onChange={(e) => setSelectedWeaponIndex(Number(e.target.value))}
                  style={{ width: '100%', fontSize: '11px' }}
                >
                  {availableStandoff.map(({ weapon }, idx) => (
                    <option key={idx} value={idx}>
                      {weapon.name ?? 'Munition'} ({km(weapon.rangeKm)} reach)
                    </option>
                  ))}
                </select>
                <p className="wg-note" style={{ marginTop: '4px' }}>
                  Aircraft ingresses to release range, launches stand-off munitions, and egresses safely.
                  Inner SAM belts engage the munitions.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Single-Unit Escort Selection */}
        {attacker && attacker.kind === 'unit' && (ewOptions.length > 0 || seadOptions.length > 0) && (
          <div className="wg-tactical-card">
            <div className="wg-tactical-title">
              <span>Attached Escorts & Support</span>
              <span className="wg-tag">Optional</span>
            </div>
            <div className="wg-tactical-grid">
              {ewOptions.length > 0 && (
                <label className="wg-field">
                  <span>
                    EW Jammer <em>(-40% radar)</em>
                  </span>
                  <select
                    value={selectedEwEscortId ?? ''}
                    onChange={(e) => setSelectedEwEscortId(e.target.value || null)}
                    style={{ fontSize: '11px' }}
                  >
                    <option value="">None</option>
                    {ewOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {unitLabel(u, wg.formations, wg.systems)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {seadOptions.length > 0 && (
                <label className="wg-field">
                  <span>
                    SEAD Flight <em>(suppress SAMs)</em>
                  </span>
                  <select
                    value={selectedSeadEscortId ?? ''}
                    onChange={(e) => setSelectedSeadEscortId(e.target.value || null)}
                    style={{ fontSize: '11px' }}
                  >
                    <option value="">None</option>
                    {seadOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {unitLabel(u, wg.formations, wg.systems)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        <div className="wg-field-label" style={{ marginTop: '10px' }}>
          Flown at
        </div>
        <div className="wg-kinds">
          {ALTITUDES.map(([metres, label, hint]) => (
            <button
              key={metres}
              className={`wg-kind${wg.coverage.targetAltM === metres ? ' on' : ''}`}
              onClick={() => wg.setTargetAltitude(metres)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="wg-note">
          Detection rings reflect this altitude: fly low and ground radars hold fire until the raid
          clears the horizon; fly high and batteries engage at nominal brochure reach.
        </p>

        {runKm !== null && radius !== undefined && (
          <p className={`wg-hint${runKm > (refuelled ?? radius) ? ' wg-warn' : ''}`}>
            {km(runKm)} out.{' '}
            {runKm <= radius
              ? `Inside its ${km(radius)} combat radius.`
              : refuelled && runKm <= refuelled
                ? `Beyond its ${km(radius)} combat radius — needs tanker support to reach ${km(refuelled)}.`
                : `Beyond even its refuelled radius of ${km(refuelled ?? radius)}.`}
          </p>
        )}
      </section>

      {assessment && (
        <section className="wg-block">
          <h3 className="wg-h">Assessment</h3>
          <Result a={assessment} />

          {assessment.engagements.some((e) => e.cued) && (
            <p className="wg-note">
              A <em>cued</em> layer cannot see the raid itself and is firing on a friendly sensor&rsquo;s
              shared picture.
            </p>
          )}

          <p className="wg-note">
            The enhanced model integrates radar curvature horizons, RCS stealth scaling, EW jamming
            degradation, SEAD anti-radiation suppression, and stand-off munition release phases.
          </p>
        </section>
      )}
    </>
  );
}
