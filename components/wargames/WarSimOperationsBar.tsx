'use client';

/**
 * War Simulation Operations Bar & Command Deck
 *
 * Provides real-time tactical controls:
 * 1. Time controls: Pause/Play, Speed Multipliers (1x, 3x, 5x, 10x, 30x), Elapsed Clock.
 * 2. Hot-Seat Faction Switcher: Toggle between Player (Blue) and Enemy (Red).
 * 3. Base Stationing & Quota Deployment Drawer.
 * 4. Patrol Tasking & EMCON Radar mode toggles.
 * 5. Real-Time Event Log Ticker.
 */

import React, { useState } from 'react';
import { formatSimTime } from '@/lib/warSimEngine';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type DetectedContact,
} from '@/lib/warSimTypes';
import { type SystemSpec } from '@/lib/specs';

export interface WarSimOperationsBarProps {
  session: WarSimSession;
  isPlaying: boolean;
  onTogglePlay: () => void;
  speedMultiplier: number;
  onSetSpeed: (n: number) => void;
  onSwitchFaction: () => void;
  friendlyBases: SimBase[];
  friendlyEntities: SimEntity[];
  visibleContacts: DetectedContact[];
  selectedEntity: SimEntity | null;
  onSelectEntity: (id: string | null) => void;
  selectedContact: DetectedContact | null;
  onSelectContact: (id: string | null) => void;
  onDeployUnit: (baseId: string, systemId: string, count: number) => void;
  onDispatchPatrol: (entityId: string, centerLngLat: [number, number], radiusKm?: number) => void;
  patrolDesignateMode: boolean;
  onTogglePatrolDesignate: () => void;
  onOpenAar: () => void;
  onExitSim: () => void;
  systemsLibrary: SystemSpec[];
}

export function WarSimOperationsBar({
  session,
  isPlaying,
  onTogglePlay,
  speedMultiplier,
  onSetSpeed,
  onSwitchFaction,
  friendlyBases,
  friendlyEntities,
  visibleContacts,
  selectedEntity,
  onSelectEntity,
  selectedContact,
  onSelectContact,
  onDeployUnit,
  onDispatchPatrol,
  patrolDesignateMode,
  onTogglePatrolDesignate,
  onOpenAar,
  onExitSim,
  systemsLibrary,
}: WarSimOperationsBarProps) {
  const [deployDrawerOpen, setDeployDrawerOpen] = useState(false);
  const [selectedBaseForDeploy, setSelectedBaseForDeploy] = useState<string>(friendlyBases[0]?.id || '');
  const [selectedSystemForDeploy, setSelectedSystemForDeploy] = useState<string>('');
  const [deployCount, setDeployCount] = useState<number>(12);

  const activeFaction = session.activeFaction;
  const isPlayer = activeFaction === 'player';
  const factionName = isPlayer ? session.playerIso : session.enemyIso;
  const factionColor = isPlayer ? session.playerColor : session.enemyColor;
  const quotaLedger = session.quotas[activeFaction] || {};

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(7, 12, 20, 0.95)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid var(--border)',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.5)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        color: 'var(--paper)',
      }}
    >
      {/* Top Controls Ribbon */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {/* Left: Clock & Time Accelerators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="wg-btn"
            style={{
              background: isPlaying ? '#D9534F' : '#4FA85F',
              color: '#070C14',
              borderColor: isPlaying ? '#D9534F' : '#4FA85F',
              fontWeight: 700,
              padding: '4px 10px',
            }}
            onClick={onTogglePlay}
          >
            {isPlaying ? '⏸ PAUSE' : '▶ RESUME'}
          </button>

          <div
            style={{
              padding: '4px 8px',
              background: '#0E1724',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              fontFamily: 'monospace',
              fontSize: '13px',
              fontWeight: 700,
              color: '#4FC3F7',
            }}
          >
            ⏱ {formatSimTime(session.simTimeSec)}
          </div>

          <div style={{ display: 'flex', gap: '2px', background: '#0E1724', borderRadius: '4px', padding: '2px' }}>
            {[1, 3, 5, 10, 30].map((spd) => (
              <button
                key={spd}
                style={{
                  background: speedMultiplier === spd ? '#4F9FD6' : 'transparent',
                  color: speedMultiplier === spd ? '#070C14' : 'var(--paper-dim)',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onClick={() => onSetSpeed(spd)}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Center: Hot-Seat Faction Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className="wg-btn"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderColor: factionColor,
              color: factionColor,
              fontWeight: 700,
              fontSize: '12px',
              padding: '4px 12px',
            }}
            onClick={onSwitchFaction}
            title="Switch Command between Blue and Red forces"
          >
            🔄 Command: {factionName} ({isPlayer ? 'BLUE' : 'RED'})
          </button>

          <button
            className="wg-btn"
            style={{
              background: deployDrawerOpen ? 'rgba(79, 168, 95, 0.2)' : '#0E1724',
              borderColor: deployDrawerOpen ? '#4FA85F' : 'var(--border)',
              color: deployDrawerOpen ? '#4FA85F' : 'var(--paper)',
              fontSize: '11px',
            }}
            onClick={() => setDeployDrawerOpen(!deployDrawerOpen)}
          >
            🛡️ Deploy Forces (+ Quota)
          </button>
        </div>

        {/* Right: Intel & Debrief Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
            🛰️ Contacts: <strong style={{ color: '#FFB020' }}>{visibleContacts.length}</strong>
          </span>
          <button className="wg-btn" style={{ fontSize: '11px', borderColor: '#4FC3F7', color: '#4FC3F7' }} onClick={onOpenAar}>
            📋 Live AAR
          </button>
          <button className="wg-btn" style={{ fontSize: '11px', color: '#D9534F' }} onClick={onExitSim}>
            ✕ Exit Sim
          </button>
        </div>
      </div>

      {/* Deployment Drawer (when opened) */}
      {deployDrawerOpen && (
        <div
          style={{
            padding: '12px 16px',
            background: '#09101B',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
              Select Sovereign Base:
            </label>
            <select
              value={selectedBaseForDeploy}
              onChange={(e) => setSelectedBaseForDeploy(e.target.value)}
              style={{ background: '#0E1724', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 8px', borderRadius: '3px', fontSize: '11px' }}
            >
              {friendlyBases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
              Select System from Stock Quota:
            </label>
            <select
              value={selectedSystemForDeploy}
              onChange={(e) => setSelectedSystemForDeploy(e.target.value)}
              style={{ background: '#0E1724', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 8px', borderRadius: '3px', fontSize: '11px' }}
            >
              <option value="">-- Choose system --</option>
              {Object.entries(quotaLedger).map(([sysId, q]) => {
                const remaining = q.count - q.deployed;
                return (
                  <option key={sysId} value={sysId} disabled={remaining <= 0}>
                    {q.customName ?? sysId} ({remaining} remaining / {q.count} stock)
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
              Count to Deploy:
            </label>
            <input
              type="number"
              min="1"
              max={selectedSystemForDeploy ? (quotaLedger[selectedSystemForDeploy]?.count || 1) - (quotaLedger[selectedSystemForDeploy]?.deployed || 0) : 24}
              value={deployCount}
              onChange={(e) => setDeployCount(Math.max(1, Number(e.target.value)))}
              style={{ width: '70px', background: '#0E1724', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', fontSize: '11px' }}
            />
          </div>

          <button
            className="wg-btn"
            style={{ background: '#4FA85F', color: '#070C14', borderColor: '#4FA85F', fontWeight: 600, fontSize: '11px', alignSelf: 'flex-end' }}
            disabled={!selectedSystemForDeploy || !selectedBaseForDeploy}
            onClick={() => {
              onDeployUnit(selectedBaseForDeploy, selectedSystemForDeploy, deployCount);
            }}
          >
            + Deploy to Base
          </button>
        </div>
      )}

      {/* Selected Entity Inspector & Patrol Order Bar */}
      {selectedEntity && (
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(79, 159, 214, 0.08)',
            borderTop: '1px solid rgba(79, 159, 214, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 700, color: '#4FC3F7', fontSize: '12px' }}>
              ✈️ {selectedEntity.name}
            </span>
            <span>
              Status: <strong style={{ color: selectedEntity.status === 'on_station' ? '#4FA85F' : '#FFB020' }}>{selectedEntity.status.replace('_', ' ').toUpperCase()}</strong>
            </span>
            <span>
              Fuel: <strong style={{ color: selectedEntity.currentFuelPct < 25 ? '#D9534F' : '#4FA85F' }}>{selectedEntity.currentFuelPct.toFixed(0)}%</strong>
            </span>
            <span>
              Speed: <strong>{selectedEntity.speedKmh} km/h</strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="wg-btn"
              style={{
                background: patrolDesignateMode ? '#E8833A' : '#0E1724',
                borderColor: patrolDesignateMode ? '#E8833A' : 'var(--border)',
                color: patrolDesignateMode ? '#070C14' : 'var(--paper)',
                fontWeight: 600,
                fontSize: '11px',
              }}
              onClick={onTogglePatrolDesignate}
            >
              {patrolDesignateMode ? '📍 Click Map to Set Patrol Orbit' : '📍 Set Patrol Station'}
            </button>
            <button className="wg-btn" style={{ fontSize: '11px' }} onClick={() => onSelectEntity(null)}>
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* Selected Contact Inspector (Fog of War) */}
      {selectedContact && !selectedEntity && (
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(255, 176, 32, 0.08)',
            borderTop: '1px solid rgba(255, 176, 32, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 700, color: '#FFB020', fontSize: '12px' }}>
              🎯 {selectedContact.intelTier === 2 ? selectedContact.knownName : `UNKNOWN ${selectedContact.domain.toUpperCase()} CONTACT [?]`}
            </span>
            <span>
              Intel Tier: <strong>{selectedContact.intelTier === 2 ? '✅ Positively Identified (PID)' : '⚠️ Sensor Track (Count Unknown)'}</strong>
            </span>
            {selectedContact.knownCount && (
              <span>Strength: <strong>{selectedContact.knownCount} units ({selectedContact.knownPersonnel} troops)</strong></span>
            )}
          </div>
          <button className="wg-btn" style={{ fontSize: '11px' }} onClick={() => onSelectContact(null)}>
            Clear Contact
          </button>
        </div>
      )}
    </div>
  );
}
