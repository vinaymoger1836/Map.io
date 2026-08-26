'use client';

/**
 * Theater Battle Operations (Battle Ops) Planner & Synchronizer
 *
 * Coordinates multi-phase theater-level operational campaigns in real-time War Sim:
 * 1. Multi-Phase Timing Sequencer (T+00:00 Phase 1, T+00:15 Phase 2, T+00:30 Phase 3...).
 * 2. Multi-Domain Task Allocation (Kinetic Standoff Strikes, SEAD Suppression, ISR/CAP Patrols).
 * 3. Live Simulation Clock Synchronization & Automated Task Execution.
 * 4. Master Consolidated After-Action Theater Report Generation.
 */

import React, { useState } from 'react';
import {
  type WarSimSession,
  type BattleOpsPlan,
  type BattleOpsPhase,
  type BattleOpsTask,
  type BattleOpsTaskType,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type PostStrikeAction,
} from '@/lib/warSimTypes';
import { type SystemSpec, domainOf } from '@/lib/specs';
import { formatSimTime } from '@/lib/warSimEngine';
import { getSimUnitIcon } from '@/lib/warSimLayers';
import { isNavalCombatant } from '@/lib/navalEngagement';
import { isGroundCombatUnit } from '@/lib/warSimRules';
import { distanceKm } from '@/lib/geo';

export interface BattleOpsPlannerProps {
  session: WarSimSession;
  plan: BattleOpsPlan;
  onUpdatePlan: (updates: Partial<BattleOpsPlan>) => void;
  onAddPhase: (name?: string, triggerDelaySec?: number) => void;
  onRemovePhase: (phaseId: string) => void;
  onUpdatePhase: (phaseId: string, updates: Partial<BattleOpsPhase>) => void;
  onAddTask: (phaseId: string, task: Omit<BattleOpsTask, 'id' | 'status'>) => void;
  onRemoveTask: (phaseId: string, taskId: string) => void;
  onStartExecution: () => void;
  onResetPlan: () => void;
  friendlyEntities: SimEntity[];
  friendlyBases: SimBase[];
  visibleContacts: DetectedContact[];
  systemsLibrary: SystemSpec[];
  onOpenReport?: (reportId?: string) => void;
  onSelectEntity?: (entityId: string | null) => void;
}

export function BattleOpsPlanner({
  session,
  plan,
  onUpdatePlan,
  onAddPhase,
  onRemovePhase,
  onUpdatePhase,
  onAddTask,
  onRemoveTask,
  onStartExecution,
  onResetPlan,
  friendlyEntities,
  friendlyBases,
  visibleContacts,
  systemsLibrary,
  onOpenReport,
  onSelectEntity,
}: BattleOpsPlannerProps) {
  const isPlayer = session.activeFaction === 'player';
  const factionColor = isPlayer ? session.playerColor : session.enemyColor;
  const isExecuting = plan.status === 'executing';
  const isCompleted = plan.status === 'completed';
  const isDraft = plan.status === 'draft' || !plan.status;

  // Elapsed Operation Clock
  const startedAt = plan.startedAtSimTimeSec ?? session.simTimeSec;
  const elapsedSec = isExecuting || isCompleted
    ? Math.max(0, session.simTimeSec - startedAt)
    : 0;
  const elapsedMinutes = Math.floor(elapsedSec / 60);
  const elapsedSeconds = Math.floor(elapsedSec % 60);
  const elapsedFormatted = `T+${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSeconds).padStart(2, '0')}`;

  // Task Creation Drawer State
  const [activeAddingPhaseId, setActiveAddingPhaseId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<BattleOpsTaskType>('strike');
  const [selectedAttackerId, setSelectedAttackerId] = useState<string>('');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);
  const [salvoCount, setSalvoCount] = useState<number>(2);
  const [postStrikeAction, setPostStrikeAction] = useState<PostStrikeAction>('rtb');
  const [patrolRadiusKm, setPatrolRadiusKm] = useState<number>(80);
  const [patrolAltitudeM, setPatrolAltitudeM] = useState<number>(8000);
  const [emconMode, setEmconMode] = useState<'active' | 'passive'>('active');

  const selectedAttacker = friendlyEntities.find((e) => e.id === selectedAttackerId);
  const attackerSpec = selectedAttacker ? systemsLibrary.find((s) => s.id === selectedAttacker.systemId) : undefined;
  const availableWeapons = selectedAttacker?.customWeapons && selectedAttacker.customWeapons.length > 0
    ? selectedAttacker.customWeapons
    : (attackerSpec?.weapons || []);

  const totalAssignedTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);

  const handleOpenAddTaskModal = (phaseId: string) => {
    setActiveAddingPhaseId(phaseId);
    if (!selectedAttackerId && friendlyEntities.length > 0) {
      setSelectedAttackerId(friendlyEntities[0].id);
    }
    if (!selectedTargetId && visibleContacts.length > 0) {
      setSelectedTargetId(visibleContacts[0].targetEntityId);
    }
  };

  const handleConfirmAddTask = () => {
    if (!activeAddingPhaseId || !selectedAttacker) return;

    if (taskType === 'strike' || taskType === 'sead') {
      const targetContact = visibleContacts.find((c) => c.targetEntityId === selectedTargetId);
      const targetBase = session.bases.find((b) => b.id === selectedTargetId);
      const targetEntity = session.entities.find((e) => e.id === selectedTargetId);

      const targetPos: [number, number] = targetContact?.lastKnownLngLat || targetBase?.lngLat || targetEntity?.lngLat || [0, 0];
      const targetDisplayName = targetContact?.knownName || targetBase?.name || targetEntity?.name || 'Designated Target Complex';
      const chosenWeapon = availableWeapons[selectedWeaponIdx];
      const weaponName = chosenWeapon?.name || 'Standoff Missile';

      onAddTask(activeAddingPhaseId, {
        name: `${selectedAttacker.name}: ${taskType === 'sead' ? 'SEAD Suppression' : 'Strike'} on ${targetDisplayName}`,
        type: taskType,
        attackerEntityId: selectedAttacker.id,
        attackerName: selectedAttacker.name,
        targetEntityId: selectedTargetId,
        targetLngLat: targetPos,
        targetName: targetDisplayName,
        weaponIndex: selectedWeaponIdx,
        weaponName,
        salvoCount,
        postStrikeAction,
      });
    } else if (taskType === 'patrol') {
      const targetContact = visibleContacts.find((c) => c.targetEntityId === selectedTargetId);
      const patrolCenter: [number, number] = targetContact?.lastKnownLngLat || selectedAttacker.lngLat;

      onAddTask(activeAddingPhaseId, {
        name: `${selectedAttacker.name}: ISR / CAP Patrol Station`,
        type: 'patrol',
        attackerEntityId: selectedAttacker.id,
        attackerName: selectedAttacker.name,
        patrolCenterLngLat: patrolCenter,
        patrolRadiusKm,
        patrolAltitudeM,
        emcon: emconMode,
      });
    }

    setActiveAddingPhaseId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
      {/* 1. Operation Master Control Card */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <strong style={{ fontSize: '13px', color: factionColor }}>{plan.title}</strong>
              </div>
              <span style={{ fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                {plan.phases.length} Synchronized Phases · {totalAssignedTasks} Platform Tasks
              </span>
            </div>
          </div>

          {/* Status Badge */}
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '4px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              background: isExecuting
                ? 'rgba(255, 176, 32, 0.2)'
                : isCompleted
                  ? 'rgba(0, 230, 118, 0.2)'
                  : 'rgba(255, 255, 255, 0.08)',
              color: isExecuting ? '#FFB020' : isCompleted ? '#00E676' : 'var(--paper-dim)',
              border: `1px solid ${isExecuting ? '#FFB020' : isCompleted ? '#00E676' : 'transparent'}`,
            }}
          >
            {isExecuting ? `⚡ EXECUTING (${elapsedFormatted})` : isCompleted ? '🏆 COMPLETED' : '📝 DRAFT PLAN'}
          </span>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
          {isDraft && (
            <>
              <button
                type="button"
                className="wg-btn accent"
                style={{
                  fontSize: '11px',
                  padding: '6px 12px',
                  fontWeight: 700,
                  background: totalAssignedTasks > 0 ? '#00E676' : 'rgba(255, 255, 255, 0.08)',
                  color: totalAssignedTasks > 0 ? '#070C14' : 'var(--paper-dim)',
                  borderColor: totalAssignedTasks > 0 ? '#00E676' : 'transparent',
                  cursor: totalAssignedTasks > 0 ? 'pointer' : 'not-allowed',
                }}
                disabled={totalAssignedTasks === 0}
                onClick={onStartExecution}
              >
                ▶️ Execute Battle Plan ({totalAssignedTasks} Tasks)
              </button>

              <button
                type="button"
                className="wg-btn"
                style={{ fontSize: '11px', padding: '5px 10px' }}
                onClick={() => onAddPhase()}
              >
                + Add Phase
              </button>

              <button
                type="button"
                className="wg-btn"
                style={{ fontSize: '11px', padding: '5px 8px', color: 'var(--paper-dim)' }}
                onClick={onResetPlan}
              >
                🔄 Reset
              </button>
            </>
          )}

          {isExecuting && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 10px',
                background: 'rgba(255, 176, 32, 0.1)',
                border: '1px solid rgba(255, 176, 32, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#FFB020',
              }}
            >
              <span>⚡ Coordinated operation in flight... Simulation clock advancing automatically.</span>
            </div>
          )}

          {isCompleted && (
            <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
              <button
                type="button"
                className="wg-btn accent"
                style={{
                  fontSize: '11px',
                  padding: '6px 12px',
                  background: '#4FC3F7',
                  color: '#070C14',
                  borderColor: '#4FC3F7',
                  fontWeight: 700,
                  flex: 1,
                }}
                onClick={() => onOpenReport?.(plan.consolidatedReportId)}
              >
                📋 View Consolidated Operation Report
              </button>

              <button
                type="button"
                className="wg-btn"
                style={{ fontSize: '11px', padding: '5px 10px' }}
                onClick={onResetPlan}
              >
                🔄 Plan New Operation
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Phase Sequencer List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, paddingRight: '2px' }}>
        {plan.phases.map((phase) => {
          const isPhaseActive = phase.status === 'in_progress';
          const isPhaseDone = phase.status === 'completed';
          const triggerMinutes = Math.floor(phase.triggerDelaySec / 60);

          return (
            <div
              key={phase.id}
              style={{
                background: isPhaseActive
                  ? 'rgba(255, 176, 32, 0.05)'
                  : isPhaseDone
                    ? 'rgba(0, 230, 118, 0.04)'
                    : 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${
                  isPhaseActive
                    ? '#FFB020'
                    : isPhaseDone
                      ? 'rgba(0, 230, 118, 0.4)'
                      : 'var(--border)'
                }`,
                borderRadius: '8px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {/* Phase Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'var(--paper)',
                    }}
                  >
                    T+{triggerMinutes}m
                  </span>
                  <strong style={{ fontSize: '12px', color: 'var(--paper)' }}>{phase.name}</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      fontSize: '9.5px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontWeight: 600,
                      background: isPhaseActive
                        ? 'rgba(255, 176, 32, 0.2)'
                        : isPhaseDone
                          ? 'rgba(0, 230, 118, 0.2)'
                          : 'rgba(255, 255, 255, 0.08)',
                      color: isPhaseActive ? '#FFB020' : isPhaseDone ? '#00E676' : 'var(--paper-dim)',
                    }}
                  >
                    {phase.status.toUpperCase().replace('_', ' ')}
                  </span>

                  {isDraft && plan.phases.length > 1 && (
                    <button
                      type="button"
                      className="wg-btn"
                      style={{ fontSize: '9px', padding: '1px 4px', color: '#D9534F' }}
                      onClick={() => onRemovePhase(phase.id)}
                      title="Remove Phase"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Timing Offset Adjuster (Draft mode only) */}
              {isDraft && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10.5px' }}>
                  <span style={{ color: 'var(--paper-dim)' }}>Trigger Offset:</span>
                  <select
                    value={phase.triggerDelaySec}
                    onChange={(e) => onUpdatePhase(phase.id, { triggerDelaySec: Number(e.target.value) })}
                    style={{
                      background: 'rgba(0, 0, 0, 0.5)',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      borderRadius: '4px',
                      fontSize: '10.5px',
                      padding: '2px 6px',
                    }}
                  >
                    <option value={0}>T+00:00 (Immediate Ingress)</option>
                    <option value={300}>T+00:05 (5 min delay)</option>
                    <option value={600}>T+00:10 (10 min delay)</option>
                    <option value={900}>T+00:15 (15 min delay)</option>
                    <option value={1200}>T+00:20 (20 min delay)</option>
                    <option value={1800}>T+00:30 (30 min delay)</option>
                    <option value={2700}>T+00:45 (45 min delay)</option>
                    <option value={3600}>T+01:00 (60 min delay)</option>
                  </select>
                </div>
              )}

              {/* Tasks List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {phase.tasks.length === 0 ? (
                  <div
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--paper-dim)',
                      fontStyle: 'italic',
                      padding: '6px 8px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: '4px',
                      border: '1px dashed var(--border)',
                    }}
                  >
                    No tasks assigned to this phase yet. Add a strike, defense suppression, or ISR sortie.
                  </div>
                ) : (
                  phase.tasks.map((task) => {
                    const isTaskActive = task.status === 'executing';
                    const isTaskDone = task.status === 'completed';
                    const isTaskFailed = task.status === 'failed';

                    return (
                      <div
                        key={task.id}
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${
                            isTaskActive
                              ? '#FFB020'
                              : isTaskDone
                                ? 'rgba(0, 230, 118, 0.4)'
                                : isTaskFailed
                                  ? '#D9534F'
                                  : 'var(--border)'
                          }`,
                          borderRadius: '6px',
                          padding: '7px 9px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>
                              {task.type === 'strike' ? '🎯' : task.type === 'sead' ? '🛡️' : '📡'}
                            </span>
                            <strong style={{ fontSize: '11px', color: 'var(--paper)' }}>{task.name}</strong>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span
                              style={{
                                fontSize: '9px',
                                padding: '1px 4px',
                                borderRadius: '2px',
                                fontWeight: 700,
                                background: isTaskActive
                                  ? 'rgba(255, 176, 32, 0.2)'
                                  : isTaskDone
                                    ? 'rgba(0, 230, 118, 0.2)'
                                    : isTaskFailed
                                      ? 'rgba(217, 83, 79, 0.2)'
                                      : 'rgba(255, 255, 255, 0.08)',
                                color: isTaskActive ? '#FFB020' : isTaskDone ? '#00E676' : isTaskFailed ? '#D9534F' : 'var(--paper-dim)',
                              }}
                            >
                              {task.status.toUpperCase()}
                            </span>

                            {isDraft && (
                              <button
                                type="button"
                                className="wg-btn"
                                style={{ fontSize: '9px', padding: '1px 4px', color: '#D9534F' }}
                                onClick={() => onRemoveTask(phase.id, task.id)}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Task Telemetry / Result */}
                        <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                          {task.type === 'strike' || task.type === 'sead' ? (
                            <span>
                              Attacker: <strong>{task.attackerName}</strong> · Salvo: <strong>{task.salvoCount} × {task.weaponName}</strong> · Protocol: <strong>{task.postStrikeAction?.toUpperCase()}</strong>
                            </span>
                          ) : (
                            <span>
                              Unit: <strong>{task.attackerName}</strong> · Envelope: <strong>{task.patrolRadiusKm} km radius</strong> · Alt: <strong>{task.patrolAltitudeM}m</strong> · EMCON: <strong>{task.emcon?.toUpperCase()}</strong>
                            </span>
                          )}
                        </div>

                        {task.resultSummary && (
                          <div
                            style={{
                              fontSize: '9.5px',
                              color: isTaskDone ? '#00E676' : isTaskActive ? '#FFB020' : '#D9534F',
                              fontStyle: 'italic',
                            }}
                          >
                            {task.resultSummary}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add Task Button */}
              {isDraft && (
                <button
                  type="button"
                  className="wg-btn"
                  style={{
                    fontSize: '10px',
                    padding: '4px 8px',
                    alignSelf: 'flex-start',
                    borderColor: 'var(--border)',
                  }}
                  onClick={() => handleOpenAddTaskModal(phase.id)}
                >
                  + Add Mission Task to Phase {phase.phaseNumber}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Task Creation Drawer / Modal */}
      {activeAddingPhaseId && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            right: '10px',
            background: 'rgba(7, 12, 20, 0.98)',
            border: '1px solid #4FC3F7',
            borderRadius: '8px',
            padding: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
            zIndex: 600,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '12px', color: '#4FC3F7' }}>
              + Schedule Mission Task
            </strong>
            <button
              type="button"
              className="wg-btn"
              style={{ fontSize: '10px', padding: '2px 6px' }}
              onClick={() => setActiveAddingPhaseId(null)}
            >
              ✕ Cancel
            </button>
          </div>

          {/* Task Type Switcher */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className={`wg-btn ${taskType === 'strike' ? 'accent' : ''}`}
              style={{ fontSize: '10px', padding: '3px 8px', flex: 1 }}
              onClick={() => setTaskType('strike')}
            >
              🎯 Kinetic Strike
            </button>
            <button
              type="button"
              className={`wg-btn ${taskType === 'sead' ? 'accent' : ''}`}
              style={{ fontSize: '10px', padding: '3px 8px', flex: 1 }}
              onClick={() => setTaskType('sead')}
            >
              🛡️ SEAD Suppression
            </button>
            <button
              type="button"
              className={`wg-btn ${taskType === 'patrol' ? 'accent' : ''}`}
              style={{ fontSize: '10px', padding: '3px 8px', flex: 1 }}
              onClick={() => setTaskType('patrol')}
            >
              📡 ISR & Patrol
            </button>
          </div>

          {/* Attacker Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Executing Platform / Wing:</span>
            <select
              value={selectedAttackerId}
              onChange={(e) => {
                setSelectedAttackerId(e.target.value);
                setSelectedWeaponIdx(0);
              }}
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid var(--border)',
                color: 'var(--paper)',
                borderRadius: '4px',
                fontSize: '11px',
                padding: '4px',
              }}
            >
              {friendlyEntities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.status === 'docked' ? 'Docked at Base' : 'Deployed in Field'})
                </option>
              ))}
            </select>
          </div>

          {/* Strike / SEAD Specific Options */}
          {(taskType === 'strike' || taskType === 'sead') && (
            <>
              {/* Target Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Target Objective:</span>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid var(--border)',
                    color: 'var(--paper)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '4px',
                  }}
                >
                  {visibleContacts.map((c) => (
                    <option key={c.contactId} value={c.targetEntityId}>
                      Hostile Contact: {c.knownName || `Tier ${c.intelTier} Radar Track`} ({c.domain.toUpperCase()})
                    </option>
                  ))}
                  {session.bases
                    .filter((b) => b.iso === session.enemyIso)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        Hostile Base: {b.name} ({b.type.toUpperCase()})
                      </option>
                    ))}
                </select>
              </div>

              {/* Weapon Selection */}
              {availableWeapons.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Munition Package:</span>
                  <select
                    value={selectedWeaponIdx}
                    onChange={(e) => setSelectedWeaponIdx(Number(e.target.value))}
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      padding: '4px',
                    }}
                  >
                    {availableWeapons.map((w, idx) => (
                      <option key={idx} value={idx}>
                        {w.name} (Range: {w.rangeKm} km · Mag: {w.magazine ?? 2})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Salvo Size & Post-Strike Protocol */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Salvo Count:</span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={salvoCount}
                    onChange={(e) => setSalvoCount(Math.max(1, Number(e.target.value)))}
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      padding: '4px',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Post-Strike Protocol:</span>
                  <select
                    value={postStrikeAction}
                    onChange={(e) => setPostStrikeAction(e.target.value as PostStrikeAction)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      padding: '4px',
                    }}
                  >
                    <option value="rtb">Return to Base (RTB)</option>
                    <option value="return_to_patrol">Return to Patrol Orbit</option>
                    <option value="loiter_target">Loiter Target for BDA</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Patrol Specific Options */}
          {taskType === 'patrol' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Patrol Radius:</span>
                <select
                  value={patrolRadiusKm}
                  onChange={(e) => setPatrolRadiusKm(Number(e.target.value))}
                  style={{
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid var(--border)',
                    color: 'var(--paper)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '4px',
                  }}
                >
                  <option value={40}>40 km (Tight CAP)</option>
                  <option value={80}>80 km (Standard Sector)</option>
                  <option value={150}>150 km (Wide Area AEW)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>EMCON Mode:</span>
                <select
                  value={emconMode}
                  onChange={(e) => setEmconMode(e.target.value as 'active' | 'passive')}
                  style={{
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid var(--border)',
                    color: 'var(--paper)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '4px',
                  }}
                >
                  <option value="active">Active Radar Search</option>
                  <option value="passive">Passive Radio Silence</option>
                </select>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="button"
            className="wg-btn accent"
            style={{
              marginTop: '4px',
              fontSize: '11px',
              padding: '6px',
              fontWeight: 700,
              background: '#00E676',
              color: '#070C14',
              borderColor: '#00E676',
            }}
            onClick={handleConfirmAddTask}
          >
            ✓ Confirm & Assign to Phase
          </button>
        </div>
      )}
    </div>
  );
}
