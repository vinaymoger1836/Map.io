'use client';

/**
 * Theater Strike & Air Tasking Order (ATO) Console.
 *
 * Coordinates operational-level multi-phase strike operations:
 * 1. Target Objective Selection with automated Defensive Umbrella discovery.
 * 2. Attacker Coalition discovery with weapon reach checks.
 * 3. Simultaneous (Time-on-Target) & Sequential Strike Phase Sequencer.
 * 4. State & Magazine Persistence across phases (depleted missiles & suppressed radars persist).
 * 5. Master Theater After-Action Report (AAR) & Chronological Battle Debrief.
 */

import { useEffect, useMemo, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { unitLabel, type DeployedUnit } from '@/lib/warGames';
import {
  type StrikePhaseTask,
  type PhaseReport,
  type DefensiveUmbrella,
} from '@/lib/theaterEngagement';
import { calculateRadarAvoidanceDogleg } from '@/lib/geo';
import { generateTheaterAar } from '@/lib/aarReport';
import { AarModal } from './AarModal';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

function DefensiveUmbrellaView({
  target,
  umbrella,
  wg,
}: {
  target: DeployedUnit;
  umbrella: DefensiveUmbrella;
  wg: WarGames;
}) {
  if (!umbrella) return null;

  const totalDefenders =
    umbrella.samDefenders.length + umbrella.capDefenders.length + umbrella.sensorDefenders.length;

  return (
    <div className="wg-tactical-card" style={{ marginTop: '8px' }}>
      <div className="wg-tactical-title">
        <span>Defensive Umbrella over Objective</span>
        <span className="wg-tag">{totalDefenders} protective nodes</span>
      </div>

      <div className="wg-tactical-body">
        <p style={{ margin: '3px 0' }}>
          Defending <strong>{unitLabel(target, wg.formations, wg.systems)}</strong> ({wg.board.nations[target.iso]?.name ?? target.iso}):
        </p>

        {umbrella.samDefenders.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '10px', color: '#E8833A', fontWeight: 600 }}>Covering SAM Batteries:</span>
            <div className="wg-package-pills" style={{ marginTop: '2px' }}>
              {umbrella.samDefenders.map((s, idx) => (
                <span key={`sam-${idx}`} className="wg-package-pill" style={{ color: '#E8833A' }}>
                  {unitLabel(s.unit, wg.formations, wg.systems)}
                  <em>({km(s.rangeKm)} reach · {km(s.coverageDistanceKm)} out)</em>
                </span>
              ))}
            </div>
          </div>
        )}

        {umbrella.capDefenders.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '10px', color: '#4DD0E1', fontWeight: 600 }}>Combat Air Patrol (CAP):</span>
            <div className="wg-package-pills" style={{ marginTop: '2px' }}>
              {umbrella.capDefenders.map((c, idx) => (
                <span key={`cap-${idx}`} className="wg-package-pill" style={{ color: '#4DD0E1' }}>
                  {unitLabel(c.unit, wg.formations, wg.systems)}
                  <em>({km(c.combatRadiusKm)} radius)</em>
                </span>
              ))}
            </div>
          </div>
        )}

        {umbrella.sensorDefenders.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '10px', color: '#9AA7B4', fontWeight: 600 }}>Early Warning & AEW&C:</span>
            <div className="wg-package-pills" style={{ marginTop: '2px' }}>
              {umbrella.sensorDefenders.map((sn, idx) => (
                <span key={`sensor-${idx}`} className="wg-package-pill">
                  {unitLabel(sn.unit, wg.formations, wg.systems)}
                  <em>({km(sn.detectionKm)} scan)</em>
                </span>
              ))}
            </div>
          </div>
        )}

        {totalDefenders === 0 && (
          <p className="wg-note" style={{ marginTop: '4px' }}>
            No nearby SAM batteries or CAP fighters cover this objective. Target is isolated and vulnerable.
          </p>
        )}
      </div>
    </div>
  );
}

function PhaseCard({
  report,
  order,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  report?: PhaseReport;
  order: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  if (!report) return null;

  const isSuccess = report.targetDestroyed || report.targetSuppressed;

  return (
    <div className="wg-tactical-card" style={{ marginTop: '8px' }}>
      <div className="wg-tactical-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span className="wg-tag" style={{ background: 'var(--ink)' }}>Phase {report.phaseNumber}</span>
          <span style={{ fontWeight: 600 }}>{report.task.title}</span>
          {report.task.waypoints && report.task.waypoints.length > 0 && (
            <span className="wg-tag" style={{ background: 'color-mix(in srgb, #FFB020 30%, transparent)', color: '#FFB020', border: '1px solid #FFB020' }}>
              📍 {report.task.waypoints.length} WP Dogleg
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="wg-salvo-btn"
            style={{ width: '20px', height: '20px', fontSize: '10px' }}
            disabled={isFirst}
            onClick={onMoveUp}
            title="Move phase earlier"
          >
            ▲
          </button>
          <button
            className="wg-salvo-btn"
            style={{ width: '20px', height: '20px', fontSize: '10px' }}
            disabled={isLast}
            onClick={onMoveDown}
            title="Move phase later"
          >
            ▼
          </button>
          <button
            className="wg-salvo-btn"
            style={{ width: '20px', height: '20px', fontSize: '10px', color: '#D9534F' }}
            onClick={onRemove}
            title="Delete this phase"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="wg-tactical-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px' }}>
          <span>
            <strong>{report.attackerLabel}</strong> ──► <strong>{report.targetLabel}</strong>
          </span>
          <span className={`wg-tag ${isSuccess ? 'success' : 'loss'}`}>
            {report.targetDestroyed ? 'Target Destroyed' : report.targetSuppressed ? 'Suppressed' : 'Defended'}
          </span>
        </div>

        <p style={{ margin: '4px 0', fontSize: '11px', color: 'var(--paper-dim)' }}>
          Fired <strong>{report.salvoCommitted} × {report.weaponName}</strong>. {report.munitionsImpacted} impacted objective ({report.munitionsIntercepted} intercepted).
        </p>

        {report.navalAssessment && (
          <div style={{ margin: '4px 0', padding: '4px 6px', background: 'rgba(0, 188, 212, 0.08)', border: '1px solid rgba(0, 188, 212, 0.3)', borderRadius: '3px', fontSize: '10px' }}>
            <span style={{ color: '#00BCD4', fontWeight: 600 }}>
              {report.navalAssessment.kind === 'asuw' ? '⚓ Fleet Air Defense (4 Tiers): ' : '🌊 Subsurface ASW Acoustic Hunt: '}
            </span>
            <span style={{ color: 'var(--paper)' }}>{report.navalAssessment.headline}</span>
          </div>
        )}

        {report.bmdAssessment && (
          <div style={{ margin: '4px 0', padding: '4px 6px', background: 'rgba(186, 104, 200, 0.08)', border: '1px solid rgba(186, 104, 200, 0.3)', borderRadius: '3px', fontSize: '10px' }}>
            <span style={{ color: '#BA68C8', fontWeight: 600 }}>
              🚀 Multi-Tier BMD & Space Shield: 
            </span>
            <span style={{ color: 'var(--paper)' }}>{report.bmdAssessment.headline}</span>
          </div>
        )}

        <p className="wg-note" style={{ color: isSuccess ? '#4FA85F' : '#D9534F', marginTop: '3px' }}>
          ✦ {report.targetDamageSummary}
        </p>

        {/* Expandable Phase Log */}
        <div style={{ marginTop: '6px' }}>
          <button
            className="wg-btn"
            style={{ fontSize: '9px', padding: '2px 6px' }}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide Phase Events' : `View ${report.battleLog.length} Phase Events`}
          </button>

          {expanded && (
            <ol className="wg-battlelog" style={{ marginTop: '8px' }}>
              {report.battleLog.map((evt) => (
                <li key={evt.id} className="wg-battlelog-item">
                  <span className={`wg-battlelog-dot ${evt.badge?.variant ?? 'neutral'}`} />
                  <div className="wg-battlelog-card">
                    <div className="wg-battlelog-header">
                      <div className="wg-battlelog-meta">
                        <span className="wg-battlelog-time">{evt.timeFormatted}</span>
                        <span className="wg-battlelog-title">{evt.title}</span>
                      </div>
                      {evt.badge && (
                        <span className={`wg-tag ${evt.badge.variant === 'neutral' ? '' : evt.badge.variant}`}>
                          {evt.badge.text}
                        </span>
                      )}
                    </div>
                    <p className="wg-battlelog-detail">{evt.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export function TheaterSection({ wg }: { wg: WarGames }) {
  const {
    board,
    theaterTargetId,
    setTheaterTargetId,
    theaterAttackerIso,
    setTheaterAttackerIso,
    theaterPhases,
    addTheaterPhase,
    removeTheaterPhase,
    reorderTheaterPhase,
    theaterTaskWaypoints,
    setTheaterTaskWaypoints,
    removeTheaterTaskWaypoint,
    clearTheaterTaskWaypoints,
    setTheaterDraftingAttackerId,
    setTheaterDraftingTargetId,
    waypointPlacingActive,
    setWaypointPlacingActive,
    theaterUmbrella,
    theaterAttackers,
    theaterAssessment,
  } = wg;

  // New Phase Form State
  const [selectedPhaseNum, setSelectedPhaseNum] = useState<number | 'new'>('new');
  const [newCategory, setNewCategory] = useState<'oca' | 'sead' | 'strike' | 'asuw' | 'asw' | 'bmd'>('sead');
  const [newAttackerId, setNewAttackerId] = useState<string>('');
  const [newTargetId, setNewTargetId] = useState<string>('');
  const [newWeaponIndex, setNewWeaponIndex] = useState<number>(0);
  const [newSalvo, setNewSalvo] = useState<number>(4);
  const [aarModalOpen, setAarModalOpen] = useState(false);

  const theaterAarReport = useMemo(() => {
    if (!theaterAssessment) return null;
    return generateTheaterAar(theaterAssessment, wg.board.units, wg.board.nations, {
      systems: wg.systems,
      munitions: wg.munitions,
      formations: wg.board.formations,
    });
  }, [theaterAssessment, wg.board.units, wg.board.nations, wg.systems, wg.munitions, wg.board.formations]);

  // Sync drafting selections with map preview
  useEffect(() => {
    setTheaterDraftingAttackerId(newAttackerId || null);
  }, [newAttackerId, setTheaterDraftingAttackerId]);

  useEffect(() => {
    setTheaterDraftingTargetId(newTargetId || null);
  }, [newTargetId, setTheaterDraftingTargetId]);

  useEffect(() => {
    if (!newAttackerId && theaterAttackers.length > 0) {
      setNewAttackerId(theaterAttackers[0].unit.id);
    }
  }, [theaterAttackers, newAttackerId]);

  useEffect(() => {
    if (theaterTargetId && !newTargetId) {
      setNewTargetId(theaterTargetId);
    }
  }, [theaterTargetId, newTargetId]);

  // Targets candidates: all units on board
  const targetCandidates = board.units;
  const targetUnit = board.units.find((u) => u.id === theaterTargetId) ?? null;

  // Opposing nations
  const opposingNations = useMemo(() => {
    if (!targetUnit) return [];
    return Object.keys(board.nations).filter((iso) => iso !== targetUnit.iso);
  }, [board.nations, targetUnit]);

  // Existing distinct phase numbers in the task list
  const existingPhaseNumbers = useMemo(() => {
    const set = new Set(theaterPhases.map((p) => p.phaseNumber));
    return Array.from(set).sort((a, b) => a - b);
  }, [theaterPhases]);

  const nextPhaseNumber = existingPhaseNumbers.length > 0 ? Math.max(...existingPhaseNumbers) + 1 : 1;

  // Target options for a phase: Main target + all umbrella SAMs + CAPs
  const phaseTargetOptions = useMemo(() => {
    if (!targetUnit) return [];
    const list: { id: string; label: string; kind: string }[] = [
      { id: targetUnit.id, label: `${unitLabel(targetUnit, wg.formations, wg.systems)} (PRIMARY OBJECTIVE)`, kind: 'objective' },
    ];
    if (theaterUmbrella) {
      for (const sam of theaterUmbrella.samDefenders) {
        list.push({ id: sam.unit.id, label: `${unitLabel(sam.unit, wg.formations, wg.systems)} (SAM Radar)`, kind: 'sam' });
      }
      for (const cap of theaterUmbrella.capDefenders) {
        list.push({ id: cap.unit.id, label: `${unitLabel(cap.unit, wg.formations, wg.systems)} (CAP Fighter Flight)`, kind: 'cap' });
      }
    }
    return list;
  }, [targetUnit, theaterUmbrella, wg.formations, wg.systems]);

  // Available weapons on selected new attacker
  const selectedAttackerCandidate = theaterAttackers.find((a) => a.unit.id === newAttackerId);
  const availableWeapons = selectedAttackerCandidate?.availableWeapons ?? [];
  const activeWeapon = availableWeapons[newWeaponIndex] ?? availableWeapons[0];
  const maxMag = activeWeapon?.maxMagazine ?? 24;

  const handleAutoTaskAvoidance = () => {
    const attacker = board.units.find((u) => u.id === newAttackerId);
    const target = board.units.find((u) => u.id === newTargetId);
    if (!attacker || !target) return;

    const threatZones: { at: [number, number]; radiusKm: number }[] = [];
    if (theaterUmbrella) {
      for (const s of theaterUmbrella.samDefenders) {
        threatZones.push({ at: s.unit.lngLat, radiusKm: Math.min(250, s.rangeKm) });
      }
    }

    const maxReach = activeWeapon?.weapon.rangeKm ?? 600;
    const doglegs = calculateRadarAvoidanceDogleg(attacker.lngLat, target.lngLat, threatZones, maxReach);
    if (doglegs.length > 0) {
      setTheaterTaskWaypoints(doglegs);
    }
  };

  const handleAddPhase = () => {
    if (!newAttackerId || !newTargetId) return;

    let defaultTitle = 'Main Objective Saturation Strike';
    if (newCategory === 'oca') defaultTitle = 'Offensive Counter-Air (CAP Sweep)';
    if (newCategory === 'sead') defaultTitle = 'SEAD Anti-Radiation SAM Strike';
    if (newCategory === 'asuw') defaultTitle = 'Naval Surface Strike (ASuW Fleet Attack)';
    if (newCategory === 'asw') defaultTitle = 'Anti-Submarine Warfare (ASW Torpedo Hunt)';
    if (newCategory === 'bmd') defaultTitle = 'Ballistic / Hypersonic Missile Strike';

    const targetPhaseNumber = selectedPhaseNum === 'new' ? nextPhaseNumber : selectedPhaseNum;

    addTheaterPhase({
      phaseNumber: targetPhaseNumber,
      title: defaultTitle,
      category: newCategory,
      attackerUnitId: newAttackerId,
      targetUnitId: newTargetId,
      weaponIndex: newWeaponIndex,
      salvoSize: Math.min(maxMag, Math.max(1, newSalvo)),
      altitudeM: 3000,
      waypoints: theaterTaskWaypoints.length > 0 ? theaterTaskWaypoints : undefined,
    });
    clearTheaterTaskWaypoints();
    setWaypointPlacingActive(false);
  };

  return (
    <>
      {/* Step 1: Target Objective & Defensive Umbrella */}
      <section className="wg-block">
        <h3 className="wg-h">
          1. Target Objective & Defenses
        </h3>

        <label className="wg-field wide">
          <span>
            Primary Objective <em>target complex</em>
          </span>
          <select
            value={theaterTargetId ?? ''}
            onChange={(e) => {
              setTheaterTargetId(e.target.value || null);
              setNewTargetId(e.target.value || '');
            }}
          >
            <option value="">Choose objective to attack…</option>
            {targetCandidates.map((u) => (
              <option key={u.id} value={u.id}>
                {wg.board.nations[u.iso]?.name ?? u.iso} — {unitLabel(u, wg.formations, wg.systems)}
              </option>
            ))}
          </select>
        </label>

        {targetUnit && theaterUmbrella && (
          <DefensiveUmbrellaView target={targetUnit} umbrella={theaterUmbrella} wg={wg} />
        )}
      </section>

      {/* Step 2: Attacker Coalition & Assets */}
      {targetUnit && (
        <section className="wg-block">
          <h3 className="wg-h">
            2. Attacking Force
          </h3>

          <label className="wg-field wide">
            <span>
              Attacking Nation <em>coalition</em>
            </span>
            <select
              value={theaterAttackerIso ?? ''}
              onChange={(e) => setTheaterAttackerIso(e.target.value || null)}
            >
              <option value="">Choose attacking country…</option>
              {opposingNations.map((iso) => (
                <option key={iso} value={iso}>
                  {wg.board.nations[iso]?.name ?? iso}
                </option>
              ))}
            </select>
          </label>

          {theaterAttackerIso && (
            <div className="wg-tactical-card" style={{ marginTop: '8px' }}>
              <div className="wg-tactical-title">
                <span>Available Strike Platforms in Theater</span>
                <span className="wg-tag">{theaterAttackers.length} ready</span>
              </div>
              <div className="wg-package-pills">
                {theaterAttackers.map((att, idx) => (
                  <span key={idx} className="wg-package-pill">
                    <strong>{unitLabel(att.unit, wg.formations, wg.systems)}</strong>
                    <em>({km(att.distanceToTargetKm)} to target)</em>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Step 3: Air Tasking Order & Strike Phase Sequencer */}
      {targetUnit && theaterAttackerIso && (
        <section className="wg-block">
          <h3 className="wg-h">
            3. Air Tasking Order (Strike Phases)
            <span className="wg-h-note">{theaterPhases.length} tasks scheduled</span>
          </h3>

          {/* Builder Form */}
          <div className="wg-tactical-card" style={{ background: 'color-mix(in srgb, var(--ink) 60%, var(--surface))' }}>
            <div className="wg-tactical-title">
              <span>+ Add Strike Task to Operation</span>
            </div>

            {/* Simultaneous vs Sequential Phase Selector */}
            <div style={{ marginTop: '6px' }}>
              <label className="wg-field wide">
                <span>
                  Schedule As <em>simultaneous vs sequential</em>
                </span>
                <select
                  value={selectedPhaseNum}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedPhaseNum(val === 'new' ? 'new' : Number(val));
                  }}
                  style={{ fontSize: '11px' }}
                >
                  <option value="new">+ Start New Phase {nextPhaseNumber} (Sequential Follow-up Wave)</option>
                  {existingPhaseNumbers.map((pNum) => (
                    <option key={pNum} value={pNum}>
                      Inside Phase {pNum} (Simultaneous Time-on-Target Wave)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="wg-tactical-grid">
              <label className="wg-field">
                <span>Strike Category</span>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  style={{ fontSize: '11px' }}
                >
                  <option value="oca">Fighter Sweep (OCA)</option>
                  <option value="sead">SEAD (SAM Radar Strike)</option>
                  <option value="asuw">Naval Surface Strike (ASuW)</option>
                  <option value="asw">Anti-Submarine Hunt (ASW)</option>
                  <option value="bmd">Ballistic / Hypersonic Strike (BMD)</option>
                  <option value="strike">Main Strike (Saturation)</option>
                </select>
              </label>

              <label className="wg-field">
                <span>Attacking Unit</span>
                <select
                  value={newAttackerId}
                  onChange={(e) => {
                    setNewAttackerId(e.target.value);
                    setNewWeaponIndex(0);
                  }}
                  style={{ fontSize: '11px' }}
                >
                  <option value="">Select attacker…</option>
                  {theaterAttackers.map((a) => (
                    <option key={a.unit.id} value={a.unit.id}>
                      {unitLabel(a.unit, wg.formations, wg.systems)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="wg-tactical-grid">
              <label className="wg-field">
                <span>Phase Target</span>
                <select
                  value={newTargetId}
                  onChange={(e) => setNewTargetId(e.target.value)}
                  style={{ fontSize: '11px' }}
                >
                  <option value="">Select target node…</option>
                  {phaseTargetOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="wg-field">
                <span>Weapon System</span>
                <select
                  value={newWeaponIndex}
                  onChange={(e) => setNewWeaponIndex(Number(e.target.value))}
                  style={{ fontSize: '11px' }}
                >
                  {availableWeapons.map((w, idx) => (
                    <option key={idx} value={idx}>
                      {w.weapon.name ?? 'Munition'} ({km(w.weapon.rangeKm)} reach · {w.maxMagazine} ready)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Salvo Size for new phase */}
            <div className="wg-salvo-container" style={{ marginTop: '8px' }}>
              <div className="wg-salvo-header">
                <span>Salvo Size Committed</span>
                <span>Max Ready: {maxMag}</span>
              </div>
              <div className="wg-salvo-stepper">
                <button
                  className="wg-salvo-btn"
                  disabled={newSalvo <= 1}
                  onClick={() => setNewSalvo(Math.max(1, newSalvo - 1))}
                >
                  −
                </button>
                <div className="wg-salvo-val">{newSalvo}</div>
                <button
                  className="wg-salvo-btn"
                  disabled={newSalvo >= maxMag}
                  onClick={() => setNewSalvo(Math.min(maxMag, newSalvo + 1))}
                >
                  +
                </button>
                <div style={{ flex: 1, fontSize: '10px', color: 'var(--paper-dim)', marginLeft: '6px' }}>
                  {newSalvo} missiles committed for this wave
                </div>
              </div>
            </div>

            {/* Flight Route & Radar Avoidance */}
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                background: 'color-mix(in srgb, var(--ink) 40%, var(--surface))',
                border: '1px solid var(--border)',
                borderRadius: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--paper)' }}>
                  📍 Task Flight Route & Radar Avoidance
                </span>
                <span className="wg-tag" style={{ fontSize: '9px' }}>
                  {theaterTaskWaypoints.length > 0 ? `${theaterTaskWaypoints.length} Doglegs Active` : 'Direct Path'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  className="wg-btn"
                  style={{
                    fontSize: '10px',
                    padding: '4px 8px',
                    background: waypointPlacingActive ? 'var(--amber-dim, #E8833A)' : 'var(--surface-hover)',
                    color: waypointPlacingActive ? '#000000' : 'var(--paper)',
                    fontWeight: waypointPlacingActive ? 600 : 400,
                  }}
                  disabled={!targetUnit}
                  onClick={() => setWaypointPlacingActive(!waypointPlacingActive, 'theater')}
                  title="Click anywhere on the tactical map to drop dogleg waypoints for this task"
                >
                  {waypointPlacingActive ? '📍 Click Map to Drop WP (Active)' : '+ Click Map to Add WP'}
                </button>

                <button
                  className="wg-btn"
                  style={{
                    fontSize: '10px',
                    padding: '4px 8px',
                    background: 'var(--amber-dim, #E8833A)',
                    color: '#000000',
                    fontWeight: 600,
                  }}
                  disabled={!newAttackerId || !newTargetId}
                  onClick={handleAutoTaskAvoidance}
                  title="Compute optimal dogleg to fly around enemy air defense envelopes"
                >
                  ⚡ Auto Radar Avoidance
                </button>

                {theaterTaskWaypoints.length > 0 && (
                  <button
                    className="wg-btn"
                    style={{ fontSize: '10px', padding: '4px 8px', color: '#D9534F' }}
                    onClick={() => {
                      clearTheaterTaskWaypoints();
                      setWaypointPlacingActive(false);
                    }}
                  >
                    ↺ Reset Direct
                  </button>
                )}
              </div>

              {theaterTaskWaypoints.length > 0 && (
                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {theaterTaskWaypoints.map((wp, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      <span style={{ color: '#FFB020' }}>
                        WP {idx + 1}: {wp[1].toFixed(2)}°N, {wp[0].toFixed(2)}°E
                      </span>
                      <button
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#D9534F',
                          cursor: 'pointer',
                          fontSize: '11px',
                          padding: '0 4px',
                        }}
                        onClick={() => removeTheaterTaskWaypoint(idx)}
                        title="Remove waypoint"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              className="wg-btn"
              style={{ width: '100%', marginTop: '8px', padding: '6px 8px', fontSize: '11px' }}
              disabled={!newAttackerId || !newTargetId}
              onClick={handleAddPhase}
            >
              + Add Task to Operation
            </button>
          </div>

          {/* List of configured phases */}
          {theaterAssessment && theaterAssessment.phases.map((rep, idx) => (
            <PhaseCard
              key={rep.task.id}
              report={rep}
              order={idx + 1}
              onRemove={() => removeTheaterPhase(rep.task.id)}
              onMoveUp={() => reorderTheaterPhase(idx, idx - 1)}
              onMoveDown={() => reorderTheaterPhase(idx, idx + 1)}
              isFirst={idx === 0}
              isLast={idx === theaterAssessment.phases.length - 1}
            />
          ))}
        </section>
      )}

      {/* Step 4: Master Theater After-Action Report (AAR) */}
      {theaterAssessment && (
        <section className="wg-block">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 className="wg-h" style={{ margin: 0 }}>
              4. Theater Battle Debrief
            </h3>
          </div>

          <button
            className="wg-btn"
            style={{
              width: '100%',
              padding: '8px 10px',
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
            {wg.playbackActive ? '⏹ Stop Battle Playback' : '🎬 Launch 4D Theater Playback / Timeline'}
          </button>

          <div
            className={`wg-outcome-banner ${
              theaterAssessment.primaryTargetStatus === 'destroyed'
                ? 'attacker'
                : theaterAssessment.primaryTargetStatus === 'damaged'
                  ? 'contested'
                  : 'defender'
            }`}
          >
            <div className="wg-outcome-title">{theaterAssessment.overallHeadline}</div>
            <div className="wg-outcome-desc">{theaterAssessment.overallVerdict}</div>

            <div className="wg-aar-grid">
              <div className="wg-aar-col">
                <h5>Attacker Results</h5>
                <ul className="wg-aar-list">
                  {theaterAssessment.cumulativeAttackerSurvivors.map((s, idx) => (
                    <li key={`att-surv-${idx}`} style={{ color: '#4FA85F' }}>
                      <span>{s.name}</span>
                      <strong>{s.count}</strong>
                    </li>
                  ))}
                  {theaterAssessment.cumulativeAttackerLosses.map((l, idx) => (
                    <li key={`att-loss-${idx}`} style={{ color: l.count > 0 ? '#D9534F' : 'var(--paper-dim)' }}>
                      <span>{l.name}</span>
                      <strong>{l.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="wg-aar-col">
                <h5>Defender Casualties</h5>
                <ul className="wg-aar-list">
                  {theaterAssessment.cumulativeDefenderLosses.map((d, idx) => (
                    <li
                      key={`def-loss-${idx}`}
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

            {/* Master Theater AAR & Scenario Export Button */}
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="wg-btn"
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  background: 'rgba(232, 131, 58, 0.15)',
                  border: '1px solid #E8833A',
                  color: '#E8833A',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => setAarModalOpen(true)}
              >
                📋 Master Theater After-Action Intelligence Report (AAR) & Export
              </button>
            </div>
          </div>

          {aarModalOpen && theaterAarReport && (
            <AarModal
              report={theaterAarReport}
              wg={wg}
              isOpen={aarModalOpen}
              onClose={() => setAarModalOpen(false)}
            />
          )}
        </section>
      )}

      {/* Step 5: Two-Sided Campaign & Retaliatory Exchange */}
      <section className="wg-block">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <h3 className="wg-h" style={{ margin: 0 }}>
            5. Two-Sided Campaign & Counter-Strikes
          </h3>
          <span className="wg-tag" style={{ textTransform: 'capitalize' }}>
            {wg.campaignBalance.escalationLevel} Exchange
          </span>
        </div>

        {/* Live Balance of Power Meter */}
        <div className="wg-tactical-card" style={{ marginTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            <span style={{ color: '#4DD0E1' }}>
              {wg.board.nations[wg.theaterAttackerIso ?? '']?.name ?? wg.theaterAttackerIso ?? 'Attacker'}: {Math.round(wg.campaignBalance.blueRatio * 100)}% ({wg.campaignBalance.blueActivePlatforms} ready)
            </span>
            <span style={{ color: '#FF8A65' }}>
              {targetUnit ? (wg.board.nations[targetUnit.iso]?.name ?? targetUnit.iso) : 'Defender'}: {Math.round(wg.campaignBalance.redRatio * 100)}% ({wg.campaignBalance.redActivePlatforms} ready)
            </span>
          </div>

          <div style={{ width: '100%', height: '8px', borderRadius: '4px', background: '#202632', display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${wg.campaignBalance.blueRatio * 100}%`, background: '#4DD0E1', transition: 'width 0.3s ease' }} />
            <div style={{ width: `${wg.campaignBalance.redRatio * 100}%`, background: '#FF8A65', transition: 'width 0.3s ease' }} />
          </div>
        </div>

        {/* Turn Execution & Auto-Retaliate Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
          <button
            className="wg-btn"
            style={{ width: '100%', padding: '8px 10px', fontSize: '11px', fontWeight: 700, background: '#4DD0E1', color: '#000000' }}
            disabled={!theaterAssessment}
            onClick={wg.executeCampaignTurn}
          >
            ⚔️ Commit Current Strike as Turn {wg.campaignTurns.length + 1}
          </button>

          <button
            className="wg-btn"
            style={{ width: '100%', padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'var(--surface-hover)' }}
            disabled={!theaterAssessment}
            onClick={wg.autoGenerateRetaliationPlan}
          >
            ⚡ Auto-Generate Defender Retaliatory Counter-Strike
          </button>

          {wg.campaignTurns.length > 0 && (
            <button
              className="wg-btn"
              style={{ width: '100%', padding: '5px 8px', fontSize: '10px', color: '#D9534F' }}
              onClick={wg.resetCampaign}
            >
              🔄 Reset Campaign History ({wg.campaignTurns.length} turns recorded)
            </button>
          )}
        </div>

        {/* History of Completed Conflict Turns */}
        {wg.campaignTurns.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <span style={{ fontSize: '10px', color: 'var(--paper-dim)', fontWeight: 600 }}>Recorded Campaign Turns:</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              {wg.campaignTurns.map((turn) => (
                <div key={turn.turnNumber} className="wg-tactical-card" style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                    <strong>{turn.title}</strong>
                    <span className="wg-tag" style={{ background: turn.turnType === 'retaliatory' ? '#FF8A65' : '#4DD0E1', color: '#000000' }}>
                      {turn.turnType.toUpperCase()}
                    </span>
                  </div>
                  <p style={{ margin: '3px 0 0 0', fontSize: '10px', color: 'var(--paper-dim)' }}>
                    Targeted <strong>{turn.targetLabel}</strong>. {turn.assessment?.primaryTargetStatus === 'destroyed' ? '🎯 Objective Destroyed' : turn.assessment?.primaryTargetStatus === 'damaged' ? '⚡ Objective Damaged' : '🛡️ Defended'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
