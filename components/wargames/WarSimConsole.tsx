'use client';

/**
 * War Simulation Tactical Command Console
 *
 * Dedicated full-screen interface featuring:
 * 1. Top status bar with 3x clock, time acceleration, hot-seat perspective switcher, and AAR trigger.
 * 2. Left collapsible operational sidebar with Systems, Bases, Intel Contacts, and Battle Log.
 * 3. Dynamic system quota cards with deploy-to-base and click-to-place autonomous battery workflows.
 * 4. Bases list with live capacity gauges, status indicators, and one-click map focusing.
 */

import React, { useState } from 'react';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type BaseType,
  type QuotaAllocation,
} from '@/lib/warSimTypes';
import { type SystemSpec, domainOf } from '@/lib/specs';
import { formatSimTime } from '@/lib/warSimEngine';
import { DeploySystemModal } from './DeploySystemModal';
import { BaseInspectorModal } from './BaseInspectorModal';
import { SortieTaskingModal } from './SortieTaskingModal';
import { StrikeTaskingModal, type StrikeTargetInfo } from './StrikeTaskingModal';
import { getSimUnitIcon } from '@/lib/warSimLayers';
import { isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';

export type WarSimTab = 'systems' | 'bases' | 'intel' | 'log';

export interface WarSimConsoleProps {
  session: WarSimSession;
  isPlaying: boolean;
  onTogglePlay: () => void;
  speedMultiplier: number;
  onSetSpeed: (n: number) => void;
  onSwitchFaction: () => void;
  friendlyBases: SimBase[];
  friendlyEntities: SimEntity[];
  visibleContacts: DetectedContact[];
  selectedBase: SimBase | null;
  onSelectBase: (baseId: string | null) => void;
  selectedEntity: SimEntity | null;
  onSelectEntity: (id: string | null) => void;
  onDeployUnitToBase: (baseId: string, systemId: string, count: number) => void;
  onDeployAutonomous: (systemId: string, count: number) => void;
  onStartSortie: (
    entity: SimEntity,
    options?: {
      count?: number;
      customWeapons?: import('@/lib/specs').WeaponFacet[];
      patrolRadiusKm?: number;
      altitudeM?: number;
      emcon?: 'active' | 'passive';
      routeType?: 'orbit' | 'waypoints';
    }
  ) => void;
  onOrderRtb: (entityId: string) => void;
  onStartBasePlacement: (baseType: BaseType, baseName?: string) => void;
  onRenameBase?: (baseId: string, newName: string) => void;
  activeWeaponIndex?: number | null;
  onToggleWeapon?: (idx: number) => void;
  showAllEnvelopes?: boolean;
  onToggleShowAllEnvelopes?: () => void;
  targetPicking: {
    mode: 'sortie' | 'place_autonomous' | 'place_base';
    label?: string;
    routeType?: 'orbit' | 'waypoints';
    pickedWaypoints?: [number, number][];
  } | null;
  onCancelTargetPicking: () => void;
  onConfirmCustomRoute?: () => void;
  onUndoLastWaypoint?: () => void;
  selectedContact?: DetectedContact | null;
  onSelectContact?: (id: string | null) => void;
  onOrderStrike?: (params: {
    attackerEntityId: string;
    targetEntityId: string;
    targetLngLat: [number, number];
    weaponIndex: number;
    postStrikeAction: import('@/lib/warSimTypes').PostStrikeAction;
    customPostLngLat?: [number, number];
  }) => void;
  onOpenAar: () => void;
  onExitSim: () => void;
  systemsLibrary: SystemSpec[];
  countries?: { iso: string; name: string }[];
  onFlyToBase?: (lngLat: [number, number]) => void;
}

export function WarSimConsole({
  session,
  isPlaying,
  onTogglePlay,
  speedMultiplier,
  onSetSpeed,
  onSwitchFaction,
  friendlyBases,
  friendlyEntities,
  visibleContacts,
  selectedBase,
  onSelectBase,
  selectedEntity,
  onSelectEntity,
  selectedContact,
  onSelectContact,
  onOrderStrike,
  onDeployUnitToBase,
  onDeployAutonomous,
  onStartSortie,
  onOrderRtb,
  onStartBasePlacement,
  onRenameBase,
  activeWeaponIndex,
  onToggleWeapon,
  showAllEnvelopes = false,
  onToggleShowAllEnvelopes,
  targetPicking,
  onCancelTargetPicking,
  onConfirmCustomRoute,
  onUndoLastWaypoint,
  onOpenAar,
  onExitSim,
  systemsLibrary,
  countries,
  onFlyToBase,
}: WarSimConsoleProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<WarSimTab>('systems');
  const [deployModalSpec, setDeployModalSpec] = useState<{ spec: SystemSpec; quota: QuotaAllocation } | null>(null);
  const [systemDomainFilter, setSystemDomainFilter] = useState<string>('all');
  const [newBaseType, setNewBaseType] = useState<BaseType>('airbase');
  const [customBaseName, setCustomBaseName] = useState<string>('');
  const [hudTaskingEntity, setHudTaskingEntity] = useState<SimEntity | null>(null);
  const [strikeModalTarget, setStrikeModalTarget] = useState<StrikeTargetInfo | null>(null);

  const activeFaction = session.activeFaction;
  const isPlayer = activeFaction === 'player';
  const playerCountryName = countries?.find((c) => c.iso === session.playerIso)?.name || session.playerIso;
  const enemyCountryName = countries?.find((c) => c.iso === session.enemyIso)?.name || session.enemyIso;
  const activeCountryName = isPlayer ? playerCountryName : enemyCountryName;
  const activeCountryIso = isPlayer ? session.playerIso : session.enemyIso;
  const otherCountryIso = isPlayer ? session.enemyIso : session.playerIso;
  const activeColor = isPlayer ? session.playerColor : session.enemyColor;
  const otherColor = isPlayer ? session.enemyColor : session.playerColor;

  const quotaLedger = session.quotas[activeFaction] || {};

  return (
    <>
      {/* 1. TOP COMMAND & CLOCK BAR */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '48px',
          background: 'rgba(7, 12, 20, 0.95)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border)',
          zIndex: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px',
          color: 'var(--paper)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Left: Sim Title & Clock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚔️</span>
            <strong style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              War Sim: {session.name}
            </strong>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#0E1724',
              padding: '3px 8px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
            }}
          >
            <button
              className="wg-btn"
              style={{
                background: isPlaying ? '#D9534F' : '#4FA85F',
                color: '#070C14',
                borderColor: isPlaying ? '#D9534F' : '#4FA85F',
                fontWeight: 700,
                fontSize: '10px',
                padding: '2px 8px',
              }}
              onClick={onTogglePlay}
            >
              {isPlaying ? '⏸ PAUSE' : '▶ RESUME'}
            </button>

            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: '#4FC3F7' }}>
              ⏱ {formatSimTime(session.simTimeSec)}
            </span>

            <div style={{ display: 'flex', gap: '1px', marginLeft: '4px' }}>
              {[1, 3, 5, 10, 30].map((spd) => (
                <button
                  key={spd}
                  style={{
                    background: speedMultiplier === spd ? '#4F9FD6' : 'transparent',
                    color: speedMultiplier === spd ? '#070C14' : 'var(--paper-dim)',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '1px 5px',
                    fontSize: '10px',
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
        </div>

        {/* Right: Country Perspective Switcher & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Country Perspective Pill Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#09101B',
              border: '1px solid var(--border)',
              borderRadius: '20px',
              padding: '2px',
              gap: '2px',
            }}
          >
            <button
              style={{
                background: isPlayer ? activeColor : 'transparent',
                color: isPlayer ? '#070C14' : 'var(--paper-dim)',
                border: 'none',
                borderRadius: '16px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => {
                if (!isPlayer) onSwitchFaction();
              }}
            >
              🔵 {playerCountryName} (Blue)
            </button>

            <button
              style={{
                background: !isPlayer ? otherColor : 'transparent',
                color: !isPlayer ? '#070C14' : 'var(--paper-dim)',
                border: 'none',
                borderRadius: '16px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => {
                if (isPlayer) onSwitchFaction();
              }}
            >
              🔴 {enemyCountryName} (Red)
            </button>
          </div>

          {/* Global / Selected Unit Envelopes Toggle */}
          <button
            className="wg-btn"
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '16px',
              border: `1px solid ${showAllEnvelopes ? '#4FC3F7' : 'var(--border)'}`,
              background: showAllEnvelopes ? 'rgba(79, 195, 247, 0.18)' : '#09101B',
              color: showAllEnvelopes ? '#4FC3F7' : 'var(--paper-dim)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onClick={onToggleShowAllEnvelopes}
            title={
              showAllEnvelopes
                ? 'Radar & sensor envelopes currently visible for ALL deployed units. Click to show for Selected Unit only.'
                : 'Click to show radar & sensor envelopes for ALL deployed units simultaneously.'
            }
          >
            <span>{showAllEnvelopes ? '🌐' : '📡'}</span>
            <span>{showAllEnvelopes ? 'Envelopes: ALL' : 'Envelopes: SELECTED'}</span>
          </button>

          <button
            className="wg-btn"
            style={{ fontSize: '11px', borderColor: '#4FC3F7', color: '#4FC3F7' }}
            onClick={onOpenAar}
          >
            📋 Live AAR
          </button>

          <button
            className="wg-btn"
            style={{ fontSize: '11px', borderColor: '#D9534F', color: '#D9534F' }}
            onClick={onExitSim}
          >
            ✕ Exit Sim
          </button>
        </div>
      </header>

      {/* 2. TARGET PICKING FLOATING BANNER (When designating patrol, base, or multi-waypoint route) */}
      {targetPicking && (
        <div
          style={{
            position: 'absolute',
            top: '56px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(9, 16, 27, 0.96)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${targetPicking.routeType === 'waypoints' ? '#4FC3F7' : 'rgba(232, 131, 58, 0.8)'}`,
            borderRadius: '10px',
            padding: '8px 16px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
            zIndex: 650,
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            color: 'var(--paper)',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>
              {targetPicking.routeType === 'waypoints' ? '🗺️' : '📍'}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: targetPicking.routeType === 'waypoints' ? '#4FC3F7' : '#E8833A' }}>
                {targetPicking.routeType === 'waypoints'
                  ? `Custom Route Planning: ${targetPicking.pickedWaypoints?.length || 0} Waypoints Plotted`
                  : 'Target Designation Active'}
              </span>
              <span style={{ fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                {targetPicking.label}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {targetPicking.routeType === 'waypoints' && (
              <>
                <button
                  type="button"
                  className="wg-btn accent"
                  style={{
                    background: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? '#4FA85F' : 'rgba(255, 255, 255, 0.08)',
                    color: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? '#070C14' : 'var(--paper-dim)',
                    borderColor: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? '#4FA85F' : 'transparent',
                    fontWeight: 700,
                    fontSize: '11px',
                    padding: '4px 10px',
                    cursor: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? 'pointer' : 'not-allowed',
                  }}
                  disabled={(targetPicking.pickedWaypoints?.length || 0) < 1}
                  onClick={onConfirmCustomRoute}
                >
                  ✓ Launch Route ({(targetPicking.pickedWaypoints?.length || 0)} WPs)
                </button>

                <button
                  type="button"
                  className="wg-btn"
                  style={{
                    fontSize: '11px',
                    padding: '4px 8px',
                    cursor: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? 'pointer' : 'not-allowed',
                  }}
                  disabled={(targetPicking.pickedWaypoints?.length || 0) < 1}
                  onClick={onUndoLastWaypoint}
                >
                  ↩ Undo WP
                </button>
              </>
            )}

            <button
              type="button"
              className="wg-btn"
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                borderColor: '#D9534F',
                color: '#D9534F',
                background: 'transparent',
              }}
              onClick={onCancelTargetPicking}
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {/* 3. LEFT COLLAPSIBLE TACTICAL SIDEBAR */}
      <aside
        style={{
          position: 'absolute',
          top: '48px',
          bottom: 0,
          left: 0,
          width: sidebarOpen ? '360px' : '44px',
          background: 'rgba(7, 12, 20, 0.96)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid var(--border)',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '4px 0 20px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          color: 'var(--paper)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        {/* Sidebar Nav Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          {sidebarOpen ? (
            <div style={{ display: 'flex', gap: '4px', flex: 1, overflowX: 'auto' }}>
              <button
                className={`wg-btn ${activeTab === 'systems' ? 'accent' : ''}`}
                style={{ fontSize: '10.5px', padding: '4px 8px', flex: 1 }}
                onClick={() => setActiveTab('systems')}
              >
                🎯 Systems
              </button>
              <button
                className={`wg-btn ${activeTab === 'bases' ? 'accent' : ''}`}
                style={{ fontSize: '10.5px', padding: '4px 8px', flex: 1 }}
                onClick={() => setActiveTab('bases')}
              >
                🏰 Bases ({friendlyBases.length})
              </button>
              <button
                className={`wg-btn ${activeTab === 'intel' ? 'accent' : ''}`}
                style={{ fontSize: '10.5px', padding: '4px 8px', flex: 1 }}
                onClick={() => setActiveTab('intel')}
              >
                🛰️ Intel ({visibleContacts.length})
              </button>
              <button
                className={`wg-btn ${activeTab === 'log' ? 'accent' : ''}`}
                style={{ fontSize: '10.5px', padding: '4px 8px', flex: 1 }}
                onClick={() => setActiveTab('log')}
              >
                📜 Log
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('systems'); }} title="Systems" style={{ background: 'none', border: 'none', color: '#FFF', cursor: 'pointer', fontSize: '16px' }}>🎯</button>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('bases'); }} title="Bases" style={{ background: 'none', border: 'none', color: '#FFF', cursor: 'pointer', fontSize: '16px' }}>🏰</button>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('intel'); }} title="Intel" style={{ background: 'none', border: 'none', color: '#FFF', cursor: 'pointer', fontSize: '16px' }}>🛰️</button>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('log'); }} title="Log" style={{ background: 'none', border: 'none', color: '#FFF', cursor: 'pointer', fontSize: '16px' }}>📜</button>
            </div>
          )}

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-dim)',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '4px',
              marginLeft: '4px',
            }}
            title={sidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Sidebar Content Area */}
        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* ========================================================= */}
            {/* TAB 1: SYSTEMS MENU                                       */}
            {/* ========================================================= */}
            {activeTab === 'systems' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                    {activeCountryIso} Allocated Systems
                  </span>
                  <select
                    value={systemDomainFilter}
                    onChange={(e) => setSystemDomainFilter(e.target.value)}
                    style={{
                      background: '#09101B',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                    }}
                  >
                    <option value="all">All Domains</option>
                    <option value="air">Air Aviation</option>
                    <option value="sea">Maritime / Naval</option>
                    <option value="ground">Ground / Armor</option>
                    <option value="sam">Air Defense (SAM)</option>
                  </select>
                </div>

                {Object.keys(quotaLedger).length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--paper-dim)', fontSize: '12px' }}>
                    No systems allocated for {activeCountryIso}.
                  </div>
                )}

                {Object.entries(quotaLedger).map(([sysId, quota]) => {
                  const spec = systemsLibrary.find((s) => s.id === sysId);
                  const domain = spec ? domainOf(spec) : 'air';

                  if (systemDomainFilter !== 'all') {
                    if (systemDomainFilter === 'sam' && spec?.typeId !== 'sam-launcher') return null;
                    if (systemDomainFilter !== 'sam' && domain !== systemDomainFilter) return null;
                  }

                  const remaining = quota.count - quota.deployed;
                  const isAutonomous = spec?.typeId === 'sam-launcher' || spec?.typeId === 'radar' || spec?.typeId === 'silo';

                  return (
                    <div
                      key={sysId}
                      style={{
                        background: '#09101B',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '12px', color: '#FFFFFF' }}>
                          {quota.customName || spec?.name || sysId}
                        </strong>
                        <span
                          style={{
                            fontSize: '9.5px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            color: '#4FC3F7',
                          }}
                        >
                          {spec?.typeId || 'Platform'}
                        </span>
                      </div>

                      {/* Quota Gauge */}
                      <div style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>
                          Available: <strong style={{ color: remaining > 0 ? '#4FA85F' : '#D9534F' }}>{remaining}</strong> / {quota.count}
                        </span>
                        <span>
                          Deployed: <strong>{quota.deployed}</strong>
                        </span>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                        <button
                          className="wg-btn"
                          style={{
                            flex: 1,
                            fontSize: '10px',
                            padding: '4px',
                            background: '#0E1724',
                            color: remaining > 0 ? '#4FA85F' : 'var(--paper-dim)',
                            borderColor: remaining > 0 ? 'rgba(79, 168, 95, 0.4)' : 'var(--border)',
                          }}
                          disabled={remaining <= 0}
                          onClick={() => {
                            if (spec) {
                              setDeployModalSpec({ spec, quota });
                            }
                          }}
                        >
                          🏰 Deploy to Base
                        </button>

                        {isAutonomous && (
                          <button
                            className="wg-btn"
                            style={{
                              flex: 1,
                              fontSize: '10px',
                              padding: '4px',
                              background: '#0E1724',
                              color: remaining > 0 ? '#E8833A' : 'var(--paper-dim)',
                              borderColor: remaining > 0 ? 'rgba(232, 131, 58, 0.4)' : 'var(--border)',
                            }}
                            disabled={remaining <= 0}
                            onClick={() => onDeployAutonomous(sysId, Math.min(4, remaining))}
                          >
                            📍 Place on Map
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 2: BASES MENU                                         */}
            {/* ========================================================= */}
            {activeTab === 'bases' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Erect New Base Header */}
                <div
                  style={{
                    background: '#09101B',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#4FC3F7', fontWeight: 600 }}>
                    Construct Sovereign Base
                  </span>

                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
                      Base Installation Type:
                    </label>
                    <select
                      value={newBaseType}
                      onChange={(e) => setNewBaseType(e.target.value as BaseType)}
                      style={{
                        width: '100%',
                        background: '#0E1724',
                        border: '1px solid var(--border)',
                        color: 'var(--paper)',
                        fontSize: '11px',
                        padding: '5px 8px',
                        borderRadius: '3px',
                      }}
                    >
                      <option value="airbase">🛫 Airstrip / Airbase (36 aircraft)</option>
                      <option value="naval_base">⚓ Naval Station / Port (8 warships/subs)</option>
                      <option value="army_base">🛡️ Forward Base (FOB) / HQ (24 battalions)</option>
                      <option value="silo_complex">🚀 Silo / SAM Site (Strategic)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
                      Custom Base Name:
                    </label>
                    <input
                      type="text"
                      placeholder={`e.g. ${activeCountryIso} ${newBaseType === 'airbase' ? 'Central Airbase' : newBaseType === 'naval_base' ? 'Fleet Port' : 'Forward HQ'}`}
                      value={customBaseName}
                      onChange={(e) => setCustomBaseName(e.target.value)}
                      style={{
                        width: '100%',
                        background: '#0E1724',
                        border: '1px solid var(--border)',
                        color: 'var(--paper)',
                        fontSize: '11px',
                        padding: '5px 8px',
                        borderRadius: '3px',
                      }}
                    />
                  </div>

                  <button
                    className="wg-btn accent"
                    style={{ fontSize: '11px', padding: '6px', fontWeight: 600, marginTop: '2px' }}
                    onClick={() => {
                      const finalName = customBaseName.trim() || `${activeCountryIso} ${newBaseType.replace('_', ' ').toUpperCase()} #${friendlyBases.length + 1}`;
                      onStartBasePlacement(newBaseType, finalName);
                      setCustomBaseName('');
                    }}
                  >
                    📍 Place Base on Map
                  </button>
                </div>

                <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                  {activeCountryName} Operational Bases ({friendlyBases.length})
                </span>

                {friendlyBases.map((base) => {
                  const stationed = friendlyEntities.filter((e) => e.homeBaseId === base.id);
                  const totalStationed = stationed.reduce((s, e) => s + e.count, 0);

                  return (
                    <div
                      key={base.id}
                      style={{
                        background: '#09101B',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s',
                      }}
                      onClick={() => {
                        onSelectBase(base.id);
                        if (onFlyToBase) onFlyToBase(base.lngLat);
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '12px', color: '#FFFFFF' }}>
                          {base.name}
                        </strong>
                        <span
                          style={{
                            fontSize: '9.5px',
                            color: base.runwayStatus === 'operational' ? '#4FA85F' : '#D9534F',
                            fontWeight: 600,
                          }}
                        >
                          {base.runwayStatus.toUpperCase()}
                        </span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Type: {base.type.replace('_', ' ').toUpperCase()}</span>
                        <span>
                          Capacity: <strong>{totalStationed} / {base.maxCapacity}</strong>
                        </span>
                      </div>

                      <button
                        className="wg-btn"
                        style={{ fontSize: '10px', padding: '3px', marginTop: '2px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBase(base.id);
                        }}
                      >
                        🔍 Inspect Stationed Squadrons & Sorties
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 3: INTEL & CONTACTS MENU                              */}
            {/* ========================================================= */}
            {activeTab === 'intel' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                  Active Sensor Tracks & PID Contacts ({visibleContacts.length})
                </span>

                {visibleContacts.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--paper-dim)', fontSize: '12px' }}>
                    No enemy contacts currently detected. Launch AWACS, radar patrols, or recon drones to illuminate airspace.
                  </div>
                )}

                {visibleContacts.map((c) => (
                  <div
                    key={c.contactId}
                    style={{
                      background: '#09101B',
                      borderLeft: `3px solid ${c.intelTier === 2 ? '#D9534F' : '#FFB020'}`,
                      borderRadius: '4px',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '12px', color: c.intelTier === 2 ? '#D9534F' : '#FFB020' }}>
                        {c.intelTier === 2 ? `🎯 ${c.knownName}` : `⚠️ UNKNOWN ${c.domain.toUpperCase()} [?]`}
                      </strong>
                      <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                        Tier {c.intelTier}
                      </span>
                    </div>

                    <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                      Speed: <strong>{c.speedKmh} km/h</strong> · Heading: <strong>{c.headingDeg.toFixed(0)}°</strong>
                    </div>

                    {c.knownCount && (
                      <div style={{ fontSize: '10.5px', color: '#4FC3F7' }}>
                        Strength: <strong>{c.knownCount} units ({c.knownPersonnel} personnel)</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 4: BATTLE LOG TICKER                                  */}
            {/* ========================================================= */}
            {activeTab === 'log' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                  Operational Battle Log ({session.eventLog.length})
                </span>

                {session.eventLog.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--paper-dim)', fontSize: '12px' }}>
                    No combat events recorded yet.
                  </div>
                )}

                {session.eventLog.slice().reverse().map((e) => (
                  <div
                    key={e.id}
                    style={{
                      background: '#09101B',
                      borderLeft: `3px solid ${e.type === 'impact' ? '#D9534F' : e.type === 'alert' ? '#FFB020' : '#4FA85F'}`,
                      borderRadius: '4px',
                      padding: '6px 8px',
                      fontSize: '10.5px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <strong style={{ color: 'var(--paper)' }}>{e.title}</strong>
                      <span style={{ fontFamily: 'monospace', color: 'var(--paper-dim)' }}>{e.timeFormatted}</span>
                    </div>
                    <p style={{ margin: 0, color: 'var(--paper-dim)' }}>{e.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* 4. MODALS */}
      {deployModalSpec && (
        <DeploySystemModal
          systemSpec={deployModalSpec.spec}
          quota={deployModalSpec.quota}
          session={session}
          bases={friendlyBases}
          onClose={() => setDeployModalSpec(null)}
          onDeploy={(baseId, count) => {
            onDeployUnitToBase(baseId, deployModalSpec.spec.id, count);
          }}
        />
      )}

      {selectedBase && (
        <BaseInspectorModal
          base={selectedBase}
          session={session}
          onClose={() => onSelectBase(null)}
          stationedEntities={friendlyEntities.filter((e) => e.homeBaseId === selectedBase.id)}
          onStartSortie={(entity, options) => {
            onSelectBase(null);
            onStartSortie(entity, options);
          }}
          onOrderRtb={onOrderRtb}
          onDeployToThisBase={(sysId, count) => onDeployUnitToBase(selectedBase.id, sysId, count)}
          systemsLibrary={systemsLibrary}
        />
      )}

      {/* 5. FLOATING ENTITY TACTICAL HUD */}
      {selectedEntity && (() => {
        const isStaticAD = isStaticAirDefense(selectedEntity.typeId);
        const isGround = isGroundCombatUnit(selectedEntity.typeId);
        const spec = systemsLibrary.find((s) => s.id === selectedEntity.systemId);
        const detectionKm = spec?.sensor?.detectionKm ?? (
          isGround ? 8 : selectedEntity.typeId === 'awacs' ? 450 : selectedEntity.typeId === 'radar' ? 400 : 250
        );
        const statusLabel =
          isStaticAD
            ? 'AIR DEFENSE (ON WATCH)'
            : selectedEntity.status === 'on_station'
              ? (isGround ? 'ENTRENCHED' : 'PATROL')
              : selectedEntity.status === 'takeoff_ingress'
                ? (isGround ? 'ROAD MARCH' : 'TAKEOFF INGRESS')
                : selectedEntity.status.replace('_', ' ').toUpperCase();

        return (
          <div
            style={{
              position: 'absolute',
              bottom: '24px',
              right: '24px',
              width: '380px',
              background: 'rgba(9, 16, 27, 0.96)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(79, 195, 247, 0.4)',
              borderRadius: '8px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.8)',
              zIndex: 620,
              overflow: 'hidden',
              fontFamily: 'var(--font-sans, system-ui, sans-serif)',
              color: 'var(--paper)',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(79, 195, 247, 0.08)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>{getSimUnitIcon(selectedEntity.typeId)}</span>
                <div>
                  <strong style={{ fontSize: '13px', color: '#FFFFFF' }}>{selectedEntity.name}</strong>
                  <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                    {countries?.find((c) => c.iso === selectedEntity.iso)?.name || selectedEntity.iso}{' '}
                    {isStaticAD ? 'Air Defense Site' : isGround ? 'Ground Formation' : 'Tactical Formation'} · {selectedEntity.personnel} Personnel
                  </div>
                </div>
              </div>

              <button
                onClick={() => onSelectEntity(null)}
                style={{ background: 'none', border: 'none', color: 'var(--paper-dim)', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            {/* Kinematics & Status */}
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span>
                  Status:{' '}
                  <strong style={{ color: isStaticAD ? '#4FA85F' : selectedEntity.status === 'on_station' ? '#BA68C8' : '#4FA85F' }}>
                    {statusLabel}
                  </strong>
                </span>
                {!isStaticAD && !isGround ? (
                  <span>
                    Fuel:{' '}
                    <strong style={{ color: selectedEntity.currentFuelPct < 25 ? '#D9534F' : '#4FA85F' }}>
                      {selectedEntity.currentFuelPct.toFixed(0)}%
                    </strong>
                  </span>
                ) : (
                  <span>
                    Readiness: <strong style={{ color: '#4FA85F' }}>100% Ready</strong>
                  </span>
                )}
              </div>

              {!isStaticAD ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                  <span>Speed: <strong>{selectedEntity.speedKmh} km/h</strong></span>
                  <span>Altitude: <strong>{isGround ? '0 m (Ground)' : `${(selectedEntity.altitudeM / 1000).toFixed(1)} km`}</strong></span>
                  <span>Heading: <strong>{selectedEntity.headingDeg.toFixed(0)}°</strong></span>
                </div>
              ) : (
                <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Site: <strong>Fixed Firing Position</strong></span>
                  <span>Altitude: <strong>0 m (Ground Level)</strong></span>
                  <span>Posture: <strong style={{ color: '#4FA85F' }}>Active Watch</strong></span>
                </div>
              )}

              {/* Sensor / Sight Horizon */}
              <div
                style={{
                  marginTop: '2px',
                  padding: '6px 10px',
                  background: 'rgba(79, 195, 247, 0.08)',
                  borderRadius: '5px',
                  border: '1px solid rgba(79, 195, 247, 0.25)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                }}
              >
                <span style={{ color: '#4FC3F7', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{isGround ? '🔭' : '📡'}</span>
                  <span>{isGround ? 'Thermal & Optical Sight Horizon:' : 'Radar / Sensor Horizon:'}</span>
                </span>
                <strong style={{ color: '#4FC3F7' }}>
                  {detectionKm} km
                </strong>
              </div>

              {/* Equipped Weapons Arsenal & Interactive Range Toggles */}
              {(() => {
                const weapons = (selectedEntity.customWeapons && selectedEntity.customWeapons.length > 0)
                  ? selectedEntity.customWeapons
                  : (spec?.weapons || []);
                if (weapons.length === 0) return null;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                    <span style={{ fontSize: '9.5px', textTransform: 'uppercase', color: 'var(--paper-dim)', fontWeight: 600, letterSpacing: '0.4px' }}>
                      Equipped Weapons (Click to toggle range envelope):
                    </span>

                    {weapons.map((w, idx) => {
                      const isActive = activeWeaponIndex === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onToggleWeapon?.(idx)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 8px',
                            borderRadius: '5px',
                            border: `1px solid ${isActive ? '#FF9800' : 'var(--border)'}`,
                            background: isActive ? 'rgba(255, 152, 0, 0.16)' : '#070C14',
                            color: isActive ? '#FF9800' : 'var(--paper)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '13px' }}>{isActive ? '🎯' : '🚀'}</span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <strong style={{ fontSize: '11px', color: isActive ? '#FF9800' : '#FFFFFF' }}>
                                {w.magazine ? `${w.magazine} × ` : ''}{w.name || `Weapon #${idx + 1}`}
                              </strong>
                              {w.engages && w.engages.length > 0 && (
                                <span style={{ fontSize: '8.5px', color: 'var(--paper-dim)' }}>
                                  Engages: {w.engages.join(', ')}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                            <strong style={{ color: '#FF9800', fontSize: '11px' }}>{w.rangeKm} km</strong>
                            <span
                              style={{
                                fontSize: '8px',
                                padding: '1px 4px',
                                borderRadius: '2px',
                                fontWeight: 600,
                                background: isActive ? '#FF9800' : 'rgba(255, 255, 255, 0.06)',
                                color: isActive ? '#070C14' : 'var(--paper-dim)',
                              }}
                            >
                              {isActive ? '✓ ON MAP' : 'CLICK TO SHOW'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Quick Tactical Actions */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {!isStaticAD && (selectedEntity.status === 'takeoff_ingress' || selectedEntity.status === 'on_station') && (
                  <button
                    className="wg-btn"
                    style={{ flex: 1, fontSize: '11px', padding: '5px', borderColor: '#FFB020', color: '#FFB020' }}
                    onClick={() => onOrderRtb(selectedEntity.id)}
                  >
                    {isGround ? '🏠 Return to Base' : '🏠 Order RTB'}
                  </button>
                )}

                <button
                  className="wg-btn accent"
                  style={{ flex: 1, fontSize: '11px', padding: '5px', fontWeight: 600 }}
                  onClick={() => setHudTaskingEntity(selectedEntity)}
                >
                  {isStaticAD ? '📍 Relocate Battery' : isGround ? '📍 Relocate Position' : '🎯 Retask Patrol'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 5.1. FLOATING HOSTILE CONTACT / ENEMY TARGET HUD */}
      {selectedContact && (() => {
        const contact = selectedContact;
        const isPid = contact.intelTier === 2;
        const targetDomain = contact.domain;
        const targetTitle = isPid ? (contact.knownName || 'Hostile Platform') : `UNKNOWN ${contact.domain.toUpperCase()} TRACK`;
        const targetCount = contact.knownCount ?? 1;

        return (
          <div
            style={{
              position: 'absolute',
              bottom: '24px',
              right: '24px',
              width: '380px',
              background: 'rgba(9, 16, 27, 0.96)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(217, 83, 79, 0.6)',
              borderRadius: '8px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.85)',
              zIndex: 620,
              overflow: 'hidden',
              fontFamily: 'var(--font-sans, system-ui, sans-serif)',
              color: 'var(--paper)',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(217, 83, 79, 0.15)',
                borderBottom: '1px solid rgba(217, 83, 79, 0.3)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🎯</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '13px', color: '#FF5252', fontWeight: 700 }}>
                    {targetTitle}
                  </h4>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                    Hostile Faction: <strong>{contact.targetIso}</strong> · {targetDomain.toUpperCase()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="wg-btn"
                style={{ padding: '2px 7px', fontSize: '11px' }}
                onClick={() => onSelectContact?.(null)}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--paper-dim)' }}>
                <span>Intel Status:</span>
                <strong style={{ color: isPid ? '#4FA85F' : '#FFB020' }}>
                  {isPid ? '✓ POSITIVE PID (TIER 2)' : '⚠️ SENSOR TRACK (TIER 1)'}
                </strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
                <div style={{ background: '#070C14', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', display: 'block' }}>Strength</span>
                  <strong style={{ color: '#FFFFFF' }}>{isPid ? `${targetCount} Units` : '1+ (Estimated)'}</strong>
                </div>

                <div style={{ background: '#070C14', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', display: 'block' }}>Estimated Speed</span>
                  <strong style={{ color: '#FFFFFF' }}>{contact.speedKmh.toFixed(0)} km/h</strong>
                </div>

                <div style={{ background: '#070C14', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', display: 'block' }}>Heading Vector</span>
                  <strong style={{ color: '#FFFFFF' }}>{contact.headingDeg.toFixed(0)}°</strong>
                </div>

                <div style={{ background: '#070C14', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', display: 'block' }}>Battle Damage</span>
                  <strong style={{ color: contact.knownDamage === 'damaged' ? '#FFB020' : '#4FA85F' }}>
                    {(contact.knownDamage || 'Intact').toUpperCase()}
                  </strong>
                </div>
              </div>

              {/* Coordinates */}
              <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', background: '#070C14', padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                Coordinates: <strong>{contact.lastKnownLngLat[1].toFixed(4)}°N, {contact.lastKnownLngLat[0].toFixed(4)}°E</strong>
              </div>

              {/* Attack Action Button */}
              <button
                className="wg-btn accent"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#FF5252',
                  color: '#FFFFFF',
                  borderColor: '#FF5252',
                  fontWeight: 700,
                  fontSize: '12px',
                  marginTop: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(255, 82, 82, 0.4)',
                }}
                onClick={() => {
                  setStrikeModalTarget({
                    targetId: contact.targetEntityId,
                    name: targetTitle,
                    count: targetCount,
                    domain: targetDomain,
                    iso: contact.targetIso,
                    lngLat: contact.lastKnownLngLat,
                    intelTier: contact.intelTier,
                    damage: contact.knownDamage,
                    speedKmh: contact.speedKmh,
                  });
                }}
              >
                <span>⚔️</span>
                <span>Task Strike / Attack Mission</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Pre-Mission Tasking & Loadout Configurator Modal (When retasking from HUD) */}
      {hudTaskingEntity && (
        <SortieTaskingModal
          entity={hudTaskingEntity}
          initialCount={hudTaskingEntity.count}
          base={friendlyBases.find((b) => b.id === hudTaskingEntity.homeBaseId)}
          session={session}
          systemsLibrary={systemsLibrary}
          onClose={() => setHudTaskingEntity(null)}
          onConfirmTasking={(params) => {
            setHudTaskingEntity(null);
            onSelectEntity(null);
            onStartSortie(hudTaskingEntity, params);
          }}
        />
      )}

      {/* 6. Strike & Attack Mission Tasking Modal */}
      {strikeModalTarget && (
        <StrikeTaskingModal
          target={strikeModalTarget}
          session={session}
          friendlyEntities={friendlyEntities}
          friendlyBases={friendlyBases}
          systemsLibrary={systemsLibrary}
          onClose={() => setStrikeModalTarget(null)}
          onLaunchStrike={(params) => {
            setStrikeModalTarget(null);
            onSelectContact?.(null);
            onSelectEntity(null);
            onOrderStrike?.(params);
          }}
        />
      )}
    </>
  );
}
