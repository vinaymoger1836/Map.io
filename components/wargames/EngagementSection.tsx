'use client';

/**
 * Enhanced Raid & Engagement Console with Chronological Battle Log & Salvo Sizing.
 *
 * Provides:
 * 1. User-configurable strike salvo sizing bounded by platform magazine capacity
 * 2. Whole-integer casualty counting (no fractions of aircraft/missiles)
 * 3. After-Action Report (AAR) identifying victor, damage, and losses
 * 4. Step-by-step chronological Battle Log timeline
 * 5. Stealth RCS dynamics, stand-off weapon release, and EW/SEAD escorts
 */

import { useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import {
  attrition,
  type Assessment,
  type BattleLogEntry,
  type SilentReason,
} from '@/lib/engagement';
import { distanceKm } from '@/lib/geo';
import { maxMunitionCapacity, standoffWeapons, TARGET_LABEL } from '@/lib/specs';
import { unitLabel, type DeployedUnit } from '@/lib/warGames';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

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

function BattleLogTimeline({ log }: { log: BattleLogEntry[] }) {
  return (
    <ol className="wg-battlelog">
      {log.map((entry) => {
        const dotVariant = entry.badge?.variant ?? 'neutral';
        return (
          <li key={entry.id} className="wg-battlelog-item">
            <span className={`wg-battlelog-dot ${dotVariant}`} />
            <div className="wg-battlelog-card">
              <div className="wg-battlelog-header">
                <div className="wg-battlelog-meta">
                  <span className="wg-battlelog-time">{entry.timeFormatted}</span>
                  <span className="wg-battlelog-title">{entry.title}</span>
                </div>
                {entry.badge && (
                  <span className={`wg-tag ${entry.badge.variant === 'neutral' ? '' : entry.badge.variant}`}>
                    {entry.badge.text}
                  </span>
                )}
              </div>
              <p className="wg-battlelog-detail">{entry.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Result({ a }: { a: Assessment }) {
  const [showLayers, setShowLayers] = useState(false);
  const share = attrition(a);
  const isStandoff = Boolean(a.raid.standoff?.enabled);
  const outcome = a.battleOutcome;

  return (
    <>
      {/* Prominent After-Action Report (AAR) Banner */}
      <div className={`wg-outcome-banner ${outcome.winner}`}>
        <div className="wg-outcome-title">{outcome.verdictTitle}</div>
        <div className="wg-outcome-desc">{outcome.verdictDescription}</div>

        {/* Itemized Losses & Damage Grid in Whole Numbers */}
        <div className="wg-aar-grid">
          <div className="wg-aar-col">
            <h5>Attacker Status</h5>
            <ul className="wg-aar-list">
              {outcome.attackerSurvivors.map((s, idx) => (
                <li key={`surv-${idx}`} style={{ color: '#4FA85F' }}>
                  <span>{s.name}</span>
                  <strong>{Math.round(s.count)}</strong>
                </li>
              ))}
              {outcome.attackerLosses.map((l, idx) => (
                <li key={`loss-${idx}`} style={{ color: l.count > 0 ? '#D9534F' : 'var(--paper-dim)' }}>
                  <span>{l.name}</span>
                  <strong>{Math.round(l.count)}</strong>
                </li>
              ))}
            </ul>
          </div>

          <div className="wg-aar-col">
            <h5>Defender Status</h5>
            <ul className="wg-aar-list">
              {outcome.defenderLosses.map((d, idx) => (
                <li
                  key={`def-${idx}`}
                  style={{
                    color:
                      d.status === 'destroyed'
                        ? '#D9534F'
                        : d.status === 'suppressed'
                          ? '#E8833A'
                          : '#4FA85F',
                  }}
                >
                  <span>{d.name}</span>
                  <strong>{d.status.toUpperCase()}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {!a.blocked && (
        <div className="wg-tactical-card" style={{ marginTop: '8px' }}>
          {isStandoff ? (
            <>
              <div className="wg-tactical-title">
                <span>Stand-Off Strike Flight Profile</span>
                <span className="wg-tag standoff">Stand-off</span>
              </div>
              <div className="wg-tactical-body">
                <p style={{ margin: '4px 0' }}>
                  <strong>{Math.round(a.aircraftSurviving.stated)}</strong> of {a.raid.count} launch platforms
                  safe at standoff{' '}
                  {a.aircraftLost.stated > 0 && (
                    <span style={{ color: '#E4572E' }}>
                      ({Math.round(a.aircraftLost.stated)} lost during {km(a.releaseKm ?? 0)} ingress)
                    </span>
                  )}
                  .
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong>{Math.round(a.leakers.stated)}</strong>
                  {Math.round(a.leakers.high) !== Math.round(a.leakers.low) && (
                    <> (est. {Math.round(a.leakers.low)} – {Math.round(a.leakers.high)})</>
                  )}{' '}
                  of {Math.round(a.standoffLaunched ?? 0)} <em>{a.raid.standoff?.weaponName}</em> missiles
                  impact objective.
                </p>
                <span className="wg-leakers-sub">
                  Launched at {km(a.distanceKm - (a.releaseKm ?? 0))} standoff reach · {km(a.distanceKm)} total run ·{' '}
                  Missiles engaged as <em>{TARGET_LABEL[a.threat] ?? a.threat}</em>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="wg-tactical-title">
                <span>Direct Penetration Flight Profile</span>
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
                <strong>{Math.round(a.leakers.stated)}</strong>
                {Math.round(a.leakers.high) !== Math.round(a.leakers.low) && (
                  <> (est. {Math.round(a.leakers.low)} – {Math.round(a.leakers.high)})</>
                )}{' '}
                of {a.raid.count} arrive
                <span className="wg-leakers-sub">
                  {Math.round(share * 100)}% attrition · {km(a.distanceKm)} run · engaged as{' '}
                  <em>{TARGET_LABEL[a.threat] ?? a.threat}</em>
                </span>
              </p>
            </>
          )}

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

      {/* Chronological Battle Log */}
      {a.battleLog.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h4 className="wg-sub" style={{ margin: 0 }}>
              Chronological Battle Sequence
            </h4>
            <span className="wg-tag">{a.battleLog.length} events</span>
          </div>
          <BattleLogTimeline log={a.battleLog} />
        </div>
      )}

      {/* Expandable Technical Layer Breakdown */}
      {a.engagements.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <button
            className="wg-btn"
            style={{ width: '100%', padding: '6px 8px', fontSize: '10px' }}
            onClick={() => setShowLayers(!showLayers)}
          >
            {showLayers ? 'Hide Radar & SAM Envelopes Table' : `View All ${a.engagements.length} Defence Layers`}
          </button>

          {showLayers && (
            <table className="wg-table wg-layers" style={{ marginTop: '8px' }}>
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
                    <td className="num">{Math.round(e.facing)}</td>
                    <td className="num">{e.silent ? '—' : Math.round(e.rounds)}</td>
                    <td className="num">{e.silent ? SILENT[e.silent] : Math.round(e.killed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {a.unmodelled.length > 0 && (
        <>
          <h4 className="wg-sub" style={{ marginTop: '12px' }}>
            Cannot be modelled
          </h4>
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
    salvoSize,
    setSalvoSize,
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

  const attackerSpec = attacker
    ? wg.systems.find((s) => s.id === (attacker.kind === 'unit' ? attacker.systemId : undefined))
    : undefined;

  const availableStandoff = attackerSpec ? standoffWeapons(attackerSpec) : [];

  const activeStandoff = availableStandoff[selectedWeaponIndex] ?? availableStandoff[0];

  const maxSalvo = useMemo(() => {
    if (!attackerSpec || !activeStandoff || !attacker) return 1;
    const unitCount = attacker.kind === 'unit' ? attacker.count : 1;
    const loadoutItem =
      attacker.kind === 'unit'
        ? attacker.loadout?.find((l) => l.id === activeStandoff.weapon.id)
        : undefined;
    return maxMunitionCapacity(attackerSpec, activeStandoff.weapon, unitCount, loadoutItem?.count);
  }, [attackerSpec, activeStandoff, attacker]);

  const currentSalvo = useMemo(() => {
    if (salvoSize !== null) return Math.min(maxSalvo, Math.max(1, salvoSize));
    if (!activeStandoff || !attacker) return 1;
    const unitCount = attacker.kind === 'unit' ? attacker.count : 1;
    const defaultPerUnit =
      activeStandoff.weapon.salvo ??
      (activeStandoff.weapon.magazine ? Math.min(activeStandoff.weapon.magazine, 4) : 4);
    return Math.min(maxSalvo, Math.max(1, defaultPerUnit * unitCount));
  }, [salvoSize, maxSalvo, activeStandoff, attacker]);

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
          hint="a unit, ship, or strike package"
          units={wg.raidCandidates}
          value={raidFromId}
          onChange={(id) => {
            wg.setRaidFrom(id);
            setSalvoSize(null);
          }}
          wg={wg}
          emptyText="Nothing on the board can launch a strike. Deploy a strike aircraft, fighter, warship, or missile launcher."
        />

        {assessment?.raid.isComposite && assessment.raid.packageDetails && (
          <div className="wg-tactical-card">
            <div className="wg-tactical-title">
              <span>Strike Package Composition</span>
              <span className="wg-tag">Package</span>
            </div>
            <div className="wg-package-pills">
              <span className="wg-package-pill">
                <strong>{Math.round(assessment.raid.packageDetails.strikeCount)}</strong>
                <em>{assessment.raid.packageDetails.strikePlatformName ?? 'Strike'}</em>
              </span>
              {assessment.raid.packageDetails.seadCount > 0 && (
                <span className="wg-package-pill" style={{ color: '#E8833A' }}>
                  <strong>{Math.round(assessment.raid.packageDetails.seadCount)}</strong>
                  <em>SEAD Escort</em>
                </span>
              )}
              {assessment.raid.packageDetails.ewCount > 0 && (
                <span className="wg-package-pill" style={{ color: '#9AA7B4' }}>
                  <strong>{Math.round(assessment.raid.packageDetails.ewCount)}</strong>
                  <em>EW Jammer</em>
                </span>
              )}
              {assessment.raid.packageDetails.awacsCount > 0 && (
                <span className="wg-package-pill">
                  <strong>{Math.round(assessment.raid.packageDetails.awacsCount)}</strong>
                  <em>AEW&C</em>
                </span>
              )}
              {assessment.raid.packageDetails.tankerCount > 0 && (
                <span className="wg-package-pill">
                  <strong>{Math.round(assessment.raid.packageDetails.tankerCount)}</strong>
                  <em>Tanker</em>
                </span>
              )}
            </div>
          </div>
        )}

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
            attacker ? 'Nothing belonging to another nation is on the board.' : 'Pick an attacker first.'
          }
        />

        {/* Stand-Off Weapon Controls & Salvo Sizing */}
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
                  onChange={(e) => {
                    setSelectedWeaponIndex(Number(e.target.value));
                    setSalvoSize(null);
                  }}
                  style={{ width: '100%', fontSize: '11px' }}
                >
                  {availableStandoff.map(({ weapon }, idx) => (
                    <option key={idx} value={idx}>
                      {weapon.name ?? 'Munition'} ({km(weapon.rangeKm)} reach)
                    </option>
                  ))}
                </select>

                {/* Salvo Size Stepper & Presets */}
                <div className="wg-salvo-container">
                  <div className="wg-salvo-header">
                    <span>Strike Salvo Size</span>
                    <span>Max Magazine: {maxSalvo}</span>
                  </div>

                  <div className="wg-salvo-stepper">
                    <button
                      className="wg-salvo-btn"
                      disabled={currentSalvo <= 1}
                      onClick={() => setSalvoSize(Math.max(1, currentSalvo - 1))}
                      title="Decrease salvo by 1"
                    >
                      −
                    </button>
                    <div className="wg-salvo-val">{currentSalvo}</div>
                    <button
                      className="wg-salvo-btn"
                      disabled={currentSalvo >= maxSalvo}
                      onClick={() => setSalvoSize(Math.min(maxSalvo, currentSalvo + 1))}
                      title="Increase salvo by 1"
                    >
                      +
                    </button>

                    <div style={{ flex: 1, fontSize: '10px', color: 'var(--paper-dim)', marginLeft: '6px' }}>
                      {currentSalvo === 1 ? 'Single missile' : `${currentSalvo} missiles committed`}
                    </div>
                  </div>

                  {maxSalvo > 1 && (
                    <div className="wg-salvo-presets">
                      <button
                        className={`wg-salvo-preset-btn${currentSalvo === 1 ? ' active' : ''}`}
                        onClick={() => setSalvoSize(1)}
                      >
                        Single (1)
                      </button>
                      {maxSalvo >= 4 && (
                        <button
                          className={`wg-salvo-preset-btn${currentSalvo === 4 ? ' active' : ''}`}
                          onClick={() => setSalvoSize(4)}
                        >
                          Small (4)
                        </button>
                      )}
                      {maxSalvo > 6 && (
                        <button
                          className={`wg-salvo-preset-btn${currentSalvo === Math.floor(maxSalvo / 2) ? ' active' : ''}`}
                          onClick={() => setSalvoSize(Math.floor(maxSalvo / 2))}
                        >
                          Half ({Math.floor(maxSalvo / 2)})
                        </button>
                      )}
                      <button
                        className={`wg-salvo-preset-btn${currentSalvo === maxSalvo ? ' active' : ''}`}
                        onClick={() => setSalvoSize(maxSalvo)}
                      >
                        Full Salvo ({maxSalvo})
                      </button>
                    </div>
                  )}
                </div>

                <p className="wg-note" style={{ marginTop: '6px' }}>
                  Fires {currentSalvo} of {maxSalvo} ready missiles. Defending SAM batteries engage incoming
                  salvos up to their simultaneous fire channel limit.
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
          <h3 className="wg-h">Assessment & Battle Debrief</h3>
          <Result a={assessment} />

          {assessment.engagements.some((e) => e.cued) && (
            <p className="wg-note" style={{ marginTop: '10px' }}>
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
