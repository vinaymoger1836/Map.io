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
import type { NavalFleetAssessment, NavalAswAssessment, NavalAssessment } from '@/lib/navalEngagement';
import type { BallisticDefenseAssessment } from '@/lib/ballisticEngagement';

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

function NavalFleetDefenseView({ nav }: { nav: NavalFleetAssessment }) {
  return (
    <div className="wg-tactical-card" style={{ marginTop: '10px', background: 'rgba(12, 22, 34, 0.85)', borderColor: '#4DD0E1' }}>
      <div className="wg-tactical-title">
        <span style={{ color: '#4DD0E1', fontWeight: 700 }}>⚓ Layered Fleet Air Defense (CSG Screen)</span>
        <span className="wg-tag" style={{ background: '#4DD0E1', color: '#000000' }}>
          4 Concentric Tiers
        </span>
      </div>

      <div className="wg-tactical-body">
        <p style={{ margin: '4px 0', fontSize: '11px' }}>
          Defending Flagship: <strong>{nav.flagshipLabel}</strong> ({nav.flagshipType.toUpperCase()})
        </p>

        {/* Fleet Network Badges */}
        <div className="wg-package-pills" style={{ marginTop: '4px', marginBottom: '8px' }}>
          <span className={`wg-package-pill ${nav.hasAewCoverage ? 'on' : ''}`} style={{ color: nav.hasAewCoverage ? '#4DD0E1' : 'var(--paper-dim)' }}>
            {nav.hasAewCoverage ? '✓ E-2D Hawkeye AEW Active' : '✕ No AEW Early Warning'}
          </span>
          <span className={`wg-package-pill ${nav.hasCecEnabled ? 'on' : ''}`} style={{ color: nav.hasCecEnabled ? '#3FB0A0' : 'var(--paper-dim)' }}>
            {nav.hasCecEnabled ? '✓ Cooperative Engagement (CEC)' : '✕ Autonomous Radar'}
          </span>
          <span className={`wg-package-pill ${nav.hasSoftKillEw ? 'on' : ''}`} style={{ color: nav.hasSoftKillEw ? '#BA68C8' : 'var(--paper-dim)' }}>
            {nav.hasSoftKillEw ? '✓ Nulka Active Decoys / SEWIP' : '✕ No Soft-Kill Decoys'}
          </span>
        </div>

        {/* 4 Concentric Defense Tiers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
          {nav.tierReports.map((t) => (
            <div key={t.tierNumber} className="wg-tactical-card" style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <span style={{ fontWeight: 700, color: t.tierNumber === 1 ? '#4DD0E1' : t.tierNumber === 2 ? '#4FC3F7' : t.tierNumber === 3 ? '#E8833A' : '#BA68C8' }}>
                  Tier {t.tierNumber}: {t.tierName}
                </span>
                <span className="wg-tag" style={{ fontSize: '9px' }}>
                  {km(t.rangeKm)} reach
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', marginTop: '3px', color: 'var(--paper-dim)' }}>
                <span>Weapon: <strong>{t.weaponName}</strong></span>
                <span>
                  {t.missilesIntercepted > 0 && <strong style={{ color: '#4FA85F' }}>{t.missilesIntercepted} Intercepted </strong>}
                  {t.missilesDecoyed > 0 && <strong style={{ color: '#BA68C8' }}>{t.missilesDecoyed} Decoyed </strong>}
                  ({t.missilesLeaking} Leaking)
                </span>
              </div>

              <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
                {t.details}
              </p>
            </div>
          ))}
        </div>

        {/* Flagship Survivability & Damage Banner */}
        <div style={{ marginTop: '8px', padding: '6px 8px', borderRadius: '4px', background: nav.flagshipDamage === 'intact' ? 'rgba(79, 168, 95, 0.15)' : 'rgba(217, 83, 79, 0.18)', border: `1px solid ${nav.flagshipDamage === 'intact' ? '#4FA85F' : '#D9534F'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: nav.flagshipDamage === 'intact' ? '#4FA85F' : '#D9534F' }}>
              Flagship Hull Status: {nav.flagshipDamage.replace('_', ' ').toUpperCase()}
            </span>
            <span className="wg-tag" style={{ background: nav.flagshipDamage === 'intact' ? '#4FA85F' : '#D9534F', color: '#000000' }}>
              {nav.totalImpacts === 0 ? '0 Hits (Shield Held)' : `${nav.totalImpacts} Warhead Impacts`}
            </span>
          </div>
          <p style={{ margin: '3px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
            {nav.verdict}
          </p>
        </div>
      </div>
    </div>
  );
}

function NavalAswDefenseView({ asw }: { asw: NavalAswAssessment }) {
  const { sonarProfile, torpedoReport } = asw;
  const isIntact = asw.targetCasualty === 'intact';
  const isDamaged = asw.targetCasualty === 'flooding_controlled' || asw.targetCasualty === 'sonar_dome_damaged';
  const casualtyColor = isIntact ? '#4FA85F' : isDamaged ? '#E8833A' : '#D9534F';

  return (
    <div className="wg-tactical-card" style={{ marginTop: '10px', background: 'rgba(10, 24, 38, 0.9)', borderColor: '#00BCD4' }}>
      <div className="wg-tactical-title">
        <span style={{ color: '#00BCD4', fontWeight: 700 }}>🌊 Subsurface Anti-Submarine Warfare (ASW) Console</span>
        <span className="wg-tag" style={{ background: '#00BCD4', color: '#000000' }}>
          Acoustic & Torpedo
        </span>
      </div>

      <div className="wg-tactical-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
          <span>ASW Hunter: <strong>{asw.hunterLabel}</strong></span>
          <span>Target Sub: <strong style={{ color: '#FFB020' }}>{asw.targetLabel}</strong></span>
        </div>

        {/* Acoustic Bathymetry & Sensor Cross-Section */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(0, 188, 212, 0.08) 0%, rgba(2, 35, 60, 0.4) 40%, rgba(1, 15, 30, 0.9) 100%)',
            border: '1px solid rgba(0, 188, 212, 0.25)',
            borderRadius: '4px',
            padding: '8px',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#4DD0E1' }}>
              📡 Ocean Acoustic Profile & Thermocline
            </span>
            <span
              className="wg-tag"
              style={{
                fontSize: '9px',
                background: sonarProfile.acousticDetectionConfidencePct >= 70 ? 'rgba(79, 168, 95, 0.25)' : 'rgba(232, 131, 58, 0.25)',
                color: sonarProfile.acousticDetectionConfidencePct >= 70 ? '#4FA85F' : '#E8833A',
              }}
            >
              {sonarProfile.acousticDetectionConfidencePct}% Track Confidence
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '10px', color: 'var(--paper-dim)' }}>
            <div>Active Sensor: <strong style={{ color: 'var(--paper)' }}>{sonarProfile.hunterSensorLabel}</strong></div>
            <div>Acoustic State: <strong style={{ color: 'var(--paper)' }}>{sonarProfile.targetAcousticLabel}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Thermocline Gradient: <strong>{sonarProfile.thermoclineDepthM}m Depth</strong></span>
              <span>Sub Depth: <strong style={{ color: '#00BCD4' }}>{sonarProfile.targetSubmarineDepthM}m</strong> ({sonarProfile.isTargetBelowLayer ? 'Below Layer' : 'Surface Duct'})</span>
            </div>
          </div>

          {sonarProfile.layerShadowAdvantage && (
            <div style={{ marginTop: '5px', padding: '3px 6px', background: 'rgba(186, 104, 200, 0.15)', border: '1px solid #BA68C8', borderRadius: '3px', fontSize: '9.5px', color: '#BA68C8' }}>
              ⚠️ Thermal Shadow Zone: Sound rays deflected upward by temperature gradient.
            </div>
          )}
        </div>

        {/* Torpedo Defense & Countermeasures Report */}
        <div className="wg-tactical-card" style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
            <span style={{ fontWeight: 700, color: '#FFB020' }}>
              🎯 {torpedoReport.torpedoName}
            </span>
            <span className="wg-tag" style={{ fontSize: '9px' }}>
              {torpedoReport.torpedoSpeedKnots} kts speed
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', marginTop: '4px', color: 'var(--paper-dim)' }}>
            <span>Salvo: <strong>{torpedoReport.torpedoesLaunched} Torpedoes</strong></span>
            <span>
              {torpedoReport.torpedoesDecoyed > 0 && <strong style={{ color: '#BA68C8' }}>{torpedoReport.torpedoesDecoyed} Decoyed </strong>}
              {torpedoReport.thermalLayerEvasions > 0 && <strong style={{ color: '#4DD0E1' }}>{torpedoReport.thermalLayerEvasions} Evaded </strong>}
              <strong style={{ color: casualtyColor }}>({torpedoReport.torpedoImpacts} Impacts)</strong>
            </span>
          </div>

          <p style={{ margin: '3px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
            {torpedoReport.details}
          </p>
        </div>

        {/* Submarine Damage Status Banner */}
        <div style={{ padding: '6px 8px', borderRadius: '4px', background: isIntact ? 'rgba(79, 168, 95, 0.15)' : isDamaged ? 'rgba(232, 131, 58, 0.18)' : 'rgba(217, 83, 79, 0.22)', border: `1px solid ${casualtyColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: casualtyColor }}>
              Subsurface Pressure Hull: {asw.targetCasualty.replace(/_/g, ' ').toUpperCase()}
            </span>
            <span className="wg-tag" style={{ background: casualtyColor, color: '#000000', fontWeight: 700 }}>
              {torpedoReport.torpedoImpacts === 0 ? '0 Hits (Evaded)' : `${torpedoReport.torpedoImpacts} Hydrostatic Hits`}
            </span>
          </div>
          <p style={{ margin: '3px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
            {asw.verdict}
          </p>
        </div>
      </div>
    </div>
  );
}

function BallisticDefenseView({ bmd }: { bmd: BallisticDefenseAssessment }) {
  const { trajectory, tierReports } = bmd;
  const isIntact = bmd.targetDamageStatus === 'intact';
  const isSuperficial = bmd.targetDamageStatus === 'superficial_damage';
  const statusColor = isIntact ? '#4FA85F' : isSuperficial ? '#FFB020' : '#D9534F';

  return (
    <div className="wg-tactical-card" style={{ marginTop: '10px', background: 'rgba(24, 16, 32, 0.9)', borderColor: '#BA68C8' }}>
      <div className="wg-tactical-title">
        <span style={{ color: '#BA68C8', fontWeight: 700 }}>🚀 Multi-Tier Ballistic Missile Defense (BMD) HUD</span>
        <span className="wg-tag" style={{ background: '#BA68C8', color: '#000000', fontWeight: 700 }}>
          {trajectory.kind.toUpperCase()} Space & Endo
        </span>
      </div>

      <div className="wg-tactical-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
          <span>Attacker: <strong>{bmd.attackerLabel}</strong></span>
          <span>Target: <strong>{bmd.targetLabel}</strong></span>
        </div>

        {/* Trajectory Cross-Section Profile */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(186, 104, 200, 0.12) 0%, rgba(30, 15, 45, 0.5) 50%, rgba(10, 5, 20, 0.9) 100%)',
            border: '1px solid rgba(186, 104, 200, 0.3)',
            borderRadius: '4px',
            padding: '8px',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#E1BEE7' }}>
              🌌 Aerothermal Trajectory & Apogee Profile
            </span>
            <span className="wg-tag" style={{ fontSize: '9px', background: 'rgba(186, 104, 200, 0.25)', color: '#BA68C8' }}>
              Mach {trajectory.burnoutMach.toFixed(1)} Boost · Mach {trajectory.reentryMach.toFixed(1)} Re-entry
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '10px', color: 'var(--paper-dim)' }}>
            <div>Threat Class: <strong style={{ color: 'var(--paper)' }}>{trajectory.kindLabel}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Peak Apogee: <strong style={{ color: '#BA68C8' }}>{trajectory.apogeeAltitudeKm} km</strong> ({trajectory.isExoAtmospheric ? 'Exo-Atmospheric Space' : 'Endo Glide'})</span>
              <span>Flight Time: <strong>{Math.round(trajectory.flightDurationSec / 60)}m {trajectory.flightDurationSec % 60}s</strong></span>
            </div>
            <div>
              Early Warning: <strong style={{ color: bmd.hasBmdEarlyWarningRadar ? '#4FA85F' : 'var(--paper-dim)' }}>
                {bmd.hasBmdEarlyWarningRadar ? '✓ X-Band Radar (AN/TPY-2 / SPY-6) Locked' : '✕ No Forward BMD Radar Cueing'}
              </strong>
            </div>
          </div>

          {trajectory.hasHypersonicSkipping && (
            <div style={{ marginTop: '5px', padding: '3px 6px', background: 'rgba(255, 176, 32, 0.15)', border: '1px solid #FFB020', borderRadius: '3px', fontSize: '9.5px', color: '#FFB020' }}>
              ⚡ Hypersonic Skipping Active: Skipping at 35–55 km altitude beneath exo-atmospheric kill vehicles.
            </div>
          )}
        </div>

        {/* 3 Concentric BMD Tiers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
          {tierReports.map((t) => (
            <div key={t.tierNumber} className="wg-tactical-card" style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <span style={{ fontWeight: 700, color: t.tierNumber === 1 ? '#BA68C8' : t.tierNumber === 2 ? '#4DD0E1' : '#E8833A' }}>
                  Tier {t.tierNumber}: {t.tierName}
                </span>
                <span className="wg-tag" style={{ fontSize: '9px' }}>
                  {t.altitudeZone}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', marginTop: '3px', color: 'var(--paper-dim)' }}>
                <span>Interceptor: <strong>{t.weaponName}</strong></span>
                <span>
                  {t.missilesIntercepted > 0 && <strong style={{ color: '#4FA85F' }}>{t.missilesIntercepted} Intercepted </strong>}
                  ({t.missilesLeaking} Leaking)
                </span>
              </div>

              <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
                {t.details}
              </p>
            </div>
          ))}
        </div>

        {/* BMD Shield Damage Banner */}
        <div style={{ padding: '6px 8px', borderRadius: '4px', background: isIntact ? 'rgba(79, 168, 95, 0.15)' : isSuperficial ? 'rgba(255, 176, 32, 0.18)' : 'rgba(217, 83, 79, 0.22)', border: `1px solid ${statusColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: statusColor }}>
              Target Facility Status: {bmd.targetDamageStatus.replace(/_/g, ' ').toUpperCase()}
            </span>
            <span className="wg-tag" style={{ background: statusColor, color: '#000000', fontWeight: 700 }}>
              {bmd.totalImpacts === 0 ? '0 Hits (Shield Held)' : `${bmd.totalImpacts} Warhead Impacts`}
            </span>
          </div>
          <p style={{ margin: '3px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
            {bmd.verdict}
          </p>
        </div>
      </div>
    </div>
  );
}

function Result({ a, wg }: { a: Assessment; wg: WarGames }) {
  const [showLayers, setShowLayers] = useState(false);
  const share = attrition(a);
  const isStandoff = Boolean(a.raid.standoff?.enabled);
  const outcome = a.battleOutcome;

  return (
    <>
      {/* Layered Fleet Air Defense (ASuW) or Subsurface (ASW) View */}
      {wg.navalAssessment && (
        wg.navalAssessment.kind === 'asuw' ? (
          <NavalFleetDefenseView nav={wg.navalAssessment} />
        ) : (
          <NavalAswDefenseView asw={wg.navalAssessment} />
        )
      )}

      {/* Multi-Tier Ballistic Missile Defense (BMD) & Hypersonic HUD */}
      {wg.bmdAssessment && (
        <BallisticDefenseView bmd={wg.bmdAssessment} />
      )}

      {/* Prominent After-Action Report (AAR) Banner */}
      <div className={`wg-outcome-banner ${outcome.winner}`} style={{ marginTop: (wg.navalAssessment || wg.bmdAssessment) ? '10px' : '0' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 className="wg-sub" style={{ margin: 0 }}>
              Chronological Battle Sequence
            </h4>
            <span className="wg-tag">{a.battleLog.length} events</span>
          </div>

          <button
            className="wg-btn"
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: '11px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: wg.playbackActive ? 'var(--amber-dim, #E8833A)' : 'var(--surface-hover)',
              color: wg.playbackActive ? '#000000' : 'var(--paper)',
              marginBottom: '10px',
            }}
            onClick={() => {
              if (wg.playbackActive) wg.stopPlayback();
              else wg.startPlayback();
            }}
          >
            {wg.playbackActive ? '⏹ Stop Battle Playback' : '🎬 Launch 4D Battle Playback / Timeline'}
          </button>

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

        {/* Multi-Waypoint Flight Corridor & Radar Avoidance Planner */}
        {attacker && target && (
          <div className="wg-tactical-card" style={{ marginTop: '10px' }}>
            <div className="wg-tactical-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#4DD0E1' }}>
                📍 Flight Route & Radar Avoidance
              </span>
              {wg.raidWaypoints.length > 0 && (
                <span className="wg-tag" style={{ background: 'rgba(77, 208, 225, 0.2)', color: '#4DD0E1' }}>
                  {wg.raidWaypoints.length} {wg.raidWaypoints.length === 1 ? 'Waypoint' : 'Waypoints'} (Dogleg)
                </span>
              )}
            </div>

            <div className="wg-tactical-body" style={{ marginTop: '6px' }}>
              <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: 'var(--paper-dim)' }}>
                Route strike packages around hostile SAM & radar rings to penetrate via blind spots.
              </p>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <button
                  type="button"
                  className="wg-btn"
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: '11px',
                    background: 'rgba(77, 208, 225, 0.15)',
                    borderColor: 'rgba(77, 208, 225, 0.4)',
                    color: '#4DD0E1',
                    fontWeight: 600,
                  }}
                  onClick={() => wg.autoAvoidanceWaypoints()}
                  title="Detects SAM/radar threats intersecting direct line and computes optimal lateral standoff doglegs"
                >
                  ⚡ Auto Radar Avoidance
                </button>

                <button
                  type="button"
                  className={`wg-btn ${wg.waypointPlacingActive ? 'accent' : ''}`}
                  style={{ padding: '5px 10px', fontSize: '11px' }}
                  onClick={() => wg.setWaypointPlacingActive(!wg.waypointPlacingActive)}
                >
                  {wg.waypointPlacingActive ? '✓ Click Map to Drop WP' : '+ Click Map to Add WP'}
                </button>

                {wg.raidWaypoints.length > 0 && (
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ padding: '5px 8px', fontSize: '11px', color: '#D9534F' }}
                    onClick={() => wg.clearRaidWaypoints()}
                    title="Reset to straight direct flight corridor"
                  >
                    ↺ Reset Direct
                  </button>
                )}
              </div>

              {/* Waypoint List Sequence */}
              {wg.raidWaypoints.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.25)', padding: '6px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#4FA85F', fontWeight: 700 }}>● Origin:</span> {attacker.lngLat[1].toFixed(2)}°N, {attacker.lngLat[0].toFixed(2)}°E
                  </div>

                  {wg.raidWaypoints.map((wp, wpIdx) => (
                    <div
                      key={wpIdx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                        padding: '3px 6px',
                        background: 'rgba(77, 208, 225, 0.08)',
                        border: '1px solid rgba(77, 208, 225, 0.2)',
                        borderRadius: '3px',
                      }}
                    >
                      <span style={{ color: '#4DD0E1', fontWeight: 600 }}>
                        WP {wpIdx + 1}: {wp[1].toFixed(2)}°N, {wp[0].toFixed(2)}°E
                      </span>
                      <button
                        type="button"
                        className="wg-comp-del"
                        style={{ width: '16px', height: '16px', fontSize: '12px' }}
                        onClick={() => wg.removeRaidWaypoint(wpIdx)}
                        title="Remove waypoint"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#D9534F', fontWeight: 700 }}>● Target:</span> {target.lngLat[1].toFixed(2)}°N, {target.lngLat[0].toFixed(2)}°E
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
          <Result a={assessment} wg={wg} />

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
