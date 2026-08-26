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

import React, { useState, useMemo } from 'react';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type BaseType,
  type QuotaAllocation,
  type CombatReport,
  type WarReportCategory,
} from '@/lib/warSimTypes';
import { type SystemSpec, domainOf, radarHorizonKm, getSystemRcs } from '@/lib/specs';
import { formatSimTime, isEntityDeployed } from '@/lib/warSimEngine';
import { DeploySystemModal } from './DeploySystemModal';
import { BaseInspectorModal } from './BaseInspectorModal';
import { SortieTaskingModal } from './SortieTaskingModal';
import { StrikeTaskingModal, type StrikeTargetInfo } from './StrikeTaskingModal';
import { CombatReportDetailModal } from './CombatReportDetailModal';
import { BattleOpsPlanner } from './BattleOpsPlanner';
import { getSimUnitIcon } from '@/lib/warSimLayers';
import { isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';
import { isNavalCombatant } from '@/lib/navalEngagement';

export type WarSimTab = 'systems' | 'bases' | 'intel' | 'network' | 'battle_ops' | 'reports' | 'log';

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
      rcs?: number;
    }
  ) => void;
  onUpdateEntityRcs?: (entityId: string, rcs: number) => void;
  onOrderRtb: (entityId: string) => void;
  onStartBasePlacement: (baseType: BaseType, baseName?: string) => void;
  onRenameBase?: (baseId: string, newName: string) => void;
  onCreateNetwork?: (name: string, doctrine: import('@/lib/warSimTypes').NetworkDoctrine) => void;
  onAssignEntityToNetwork?: (entityId: string, networkId: string) => void;
  onRemoveEntityFromNetwork?: (entityId: string) => void;
  onSetNetworkDoctrine?: (networkId: string, doctrine: import('@/lib/warSimTypes').NetworkDoctrine) => void;
  onToggleNetworkOth?: (networkId: string) => void;
  battleOpsPlan?: import('@/lib/warSimTypes').BattleOpsPlan;
  onUpdateBattleOpsPlan?: (updates: Partial<import('@/lib/warSimTypes').BattleOpsPlan>) => void;
  onAddBattleOpsPhase?: (name?: string, triggerDelaySec?: number) => void;
  onRemoveBattleOpsPhase?: (phaseId: string) => void;
  onUpdateBattleOpsPhase?: (phaseId: string, updates: Partial<import('@/lib/warSimTypes').BattleOpsPhase>) => void;
  onAddBattleOpsTask?: (phaseId: string, task: Omit<import('@/lib/warSimTypes').BattleOpsTask, 'id' | 'status'>) => void;
  onRemoveBattleOpsTask?: (phaseId: string, taskId: string) => void;
  onStartBattleOpsExecution?: () => void;
  onResetBattleOpsPlan?: () => void;
  activeWeaponIndex?: number | null;
  onToggleWeapon?: (idx: number) => void;
  showAllEnvelopes?: boolean;
  onToggleShowAllEnvelopes?: () => void;
  targetPicking: {
    mode: 'sortie' | 'place_autonomous' | 'place_base' | 'strike_route';
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
    salvoCount: number;
    postStrikeAction: import('@/lib/warSimTypes').PostStrikeAction;
    customPostLngLat?: [number, number];
    sortieCount?: number;
    customWeapons?: import('@/lib/specs').WeaponFacet[];
    weaponsToFire?: import('@/lib/warSimTypes').WeaponSalvoItem[];
    attackWaypoints?: [number, number][];
  }) => void;
  onStartStrikeRoutePlanning?: (params: {
    attackerEntityId: string;
    targetEntityId: string;
    targetLngLat: [number, number];
    weaponIndex: number;
    salvoCount: number;
    postStrikeAction: import('@/lib/warSimTypes').PostStrikeAction;
    customPostLngLat?: [number, number];
    sortieCount?: number;
    customWeapons?: import('@/lib/specs').WeaponFacet[];
    weaponsToFire?: import('@/lib/warSimTypes').WeaponSalvoItem[];
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
  onStartStrikeRoutePlanning,
  onDeployUnitToBase,
  onDeployAutonomous,
  onStartSortie,
  onUpdateEntityRcs,
  onOrderRtb,
  onStartBasePlacement,
  onRenameBase,
  onCreateNetwork,
  onAssignEntityToNetwork,
  onRemoveEntityFromNetwork,
  onSetNetworkDoctrine,
  onToggleNetworkOth,
  battleOpsPlan,
  onUpdateBattleOpsPlan,
  onAddBattleOpsPhase,
  onRemoveBattleOpsPhase,
  onUpdateBattleOpsPhase,
  onAddBattleOpsTask,
  onRemoveBattleOpsTask,
  onStartBattleOpsExecution,
  onResetBattleOpsPlan,
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
  countries = [],
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
  const [selectedReport, setSelectedReport] = useState<CombatReport | null>(null);
  const [reportCategoryFilter, setReportCategoryFilter] = useState<'all' | WarReportCategory>('all');
  const [editingRcs, setEditingRcs] = useState<boolean>(false);
  const [rcsInputDraft, setRcsInputDraft] = useState<string>('');
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [newNetworkName, setNewNetworkName] = useState<string>('');
  const [showCreateNetwork, setShowCreateNetwork] = useState<boolean>(false);

  const activeFaction = session.activeFaction;
  const isPlayer = activeFaction === 'player';
  const playerCountryName = countries?.find((c) => c.iso === session.playerIso)?.name || session.playerIso;
  const enemyCountryName = countries?.find((c) => c.iso === session.enemyIso)?.name || session.enemyIso;
  const activeCountryName = isPlayer ? playerCountryName : enemyCountryName;
  const activeCountryIso = isPlayer ? session.playerIso : session.enemyIso;
  const otherCountryIso = isPlayer ? session.enemyIso : session.playerIso;
  const activeColor = isPlayer ? session.playerColor : session.enemyColor;
  const otherColor = isPlayer ? session.enemyColor : session.playerColor;

  const factionNetworks = useMemo(() => {
    return (session.networks || []).filter((n) => n.faction === activeFaction || n.iso === activeCountryIso);
  }, [session.networks, activeFaction, activeCountryIso]);

  const currentNetwork = useMemo(() => {
    return factionNetworks.find((n) => n.id === selectedNetworkId) || factionNetworks[0] || null;
  }, [factionNetworks, selectedNetworkId]);

  const quotaLedger = session.quotas[activeFaction] || {};

  const activeFactionReports = useMemo(() => {
    const list = session.reports || [];
    return list.filter((r) => r.faction === activeFaction || r.countryIso === activeCountryIso);
  }, [session.reports, activeFaction, activeCountryIso]);

  const filteredReports = useMemo(() => {
    const factionFiltered = activeFactionReports.filter((r) => {
      if (reportCategoryFilter !== 'all' && r.category !== reportCategoryFilter) return false;
      return true;
    });
    return factionFiltered.slice().reverse();
  }, [activeFactionReports, reportCategoryFilter]);

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
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(7, 12, 20, 0.95)',
            border: `1px solid ${targetPicking.mode === 'strike_route' ? '#FF9800' : targetPicking.routeType === 'waypoints' ? '#4FC3F7' : 'rgba(255, 255, 255, 0.15)'}`,
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
              {targetPicking.mode === 'strike_route' ? '🎯' : targetPicking.routeType === 'waypoints' ? '🗺️' : '📍'}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: targetPicking.mode === 'strike_route' ? '#FF9800' : targetPicking.routeType === 'waypoints' ? '#4FC3F7' : '#E8833A' }}>
                {targetPicking.mode === 'strike_route'
                  ? `Attack Route Planning: ${targetPicking.pickedWaypoints?.length || 0} Ingress Waypoints Plotted`
                  : targetPicking.routeType === 'waypoints'
                    ? `Custom Route Planning: ${targetPicking.pickedWaypoints?.length || 0} Waypoints Plotted`
                    : 'Target Designation Active'}
              </span>
              <span style={{ fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                {targetPicking.label}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {(targetPicking.routeType === 'waypoints' || targetPicking.mode === 'strike_route') && (
              <>
                <button
                  type="button"
                  className="wg-btn accent"
                  style={{
                    background: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? (targetPicking.mode === 'strike_route' ? '#FF9800' : '#4FA85F') : 'rgba(255, 255, 255, 0.08)',
                    color: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? '#070C14' : 'var(--paper-dim)',
                    borderColor: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? (targetPicking.mode === 'strike_route' ? '#FF9800' : '#4FA85F') : 'transparent',
                    fontWeight: 700,
                    fontSize: '11px',
                    padding: '4px 10px',
                    cursor: (targetPicking.pickedWaypoints?.length || 0) >= 1 ? 'pointer' : 'not-allowed',
                  }}
                  disabled={(targetPicking.pickedWaypoints?.length || 0) < 1}
                  onClick={onConfirmCustomRoute}
                >
                  {targetPicking.mode === 'strike_route'
                    ? `✓ Launch Attack Route (${(targetPicking.pickedWaypoints?.length || 0)} WPs)`
                    : `✓ Launch Route (${(targetPicking.pickedWaypoints?.length || 0)} WPs)`}
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
            <div style={{ display: 'flex', gap: '3px', flex: 1, overflowX: 'auto' }}>
              <button
                className={`wg-btn ${activeTab === 'systems' ? 'accent' : ''}`}
                style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                onClick={() => setActiveTab('systems')}
              >
                🎯 Systems
              </button>
              <button
                className={`wg-btn ${activeTab === 'bases' ? 'accent' : ''}`}
                style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                onClick={() => setActiveTab('bases')}
              >
                🏰 Bases ({friendlyBases.length})
              </button>
              <button
                className={`wg-btn ${activeTab === 'intel' ? 'accent' : ''}`}
                style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                onClick={() => setActiveTab('intel')}
              >
                🛰️ Intel ({visibleContacts.length})
              </button>
              <button
                className={`wg-btn ${activeTab === 'network' ? 'accent' : ''}`}
                style={{
                  fontSize: '10px',
                  padding: '4px 6px',
                  flex: 1,
                  background: activeTab === 'network' ? undefined : 'rgba(0, 230, 118, 0.08)',
                  borderColor: activeTab === 'network' ? undefined : 'rgba(0, 230, 118, 0.3)',
                  color: activeTab === 'network' ? undefined : '#00E676',
                }}
                onClick={() => setActiveTab('network')}
              >
                🌐 Network
              </button>
              <button
                className={`wg-btn ${activeTab === 'battle_ops' ? 'accent' : ''}`}
                style={{
                  fontSize: '10px',
                  padding: '4px 6px',
                  flex: 1,
                  background: activeTab === 'battle_ops' ? undefined : (session.battleOpsPlan?.status === 'executing' ? 'rgba(255, 176, 32, 0.15)' : 'rgba(255, 152, 0, 0.08)'),
                  borderColor: activeTab === 'battle_ops' ? undefined : (session.battleOpsPlan?.status === 'executing' ? '#FFB020' : 'rgba(255, 152, 0, 0.3)'),
                  color: activeTab === 'battle_ops' ? undefined : (session.battleOpsPlan?.status === 'executing' ? '#FFB020' : '#FF9800'),
                  fontWeight: session.battleOpsPlan?.status === 'executing' ? 700 : undefined,
                }}
                onClick={() => setActiveTab('battle_ops')}
              >
                ⚡ Ops {session.battleOpsPlan?.status === 'executing' ? '🔥' : ''}
              </button>
              <button
                className={`wg-btn ${activeTab === 'reports' ? 'accent' : ''}`}
                style={{
                  fontSize: '10px',
                  padding: '4px 6px',
                  flex: 1,
                  background: activeTab === 'reports' ? undefined : (session.reports && session.reports.length > 0 ? 'rgba(79, 195, 247, 0.08)' : undefined),
                  borderColor: activeTab === 'reports' ? undefined : (session.reports && session.reports.length > 0 ? 'rgba(79, 195, 247, 0.3)' : undefined),
                  color: activeTab === 'reports' ? undefined : (session.reports && session.reports.length > 0 ? '#4FC3F7' : undefined),
                }}
                onClick={() => setActiveTab('reports')}
              >
                📊 Reports ({activeFactionReports.length})
              </button>
              <button
                className={`wg-btn ${activeTab === 'log' ? 'accent' : ''}`}
                style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
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
              <button onClick={() => { setSidebarOpen(true); setActiveTab('network'); }} title="Battlefield Network" style={{ background: 'none', border: 'none', color: '#00E676', cursor: 'pointer', fontSize: '16px' }}>🌐</button>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('battle_ops'); }} title="Battle Ops Planner" style={{ background: 'none', border: 'none', color: '#FF9800', cursor: 'pointer', fontSize: '16px' }}>⚡</button>
              <button onClick={() => { setSidebarOpen(true); setActiveTab('reports'); }} title="Reports" style={{ background: 'none', border: 'none', color: '#4FC3F7', cursor: 'pointer', fontSize: '16px' }}>📊</button>
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
            {/* TAB: BATTLEFIELD NETWORK & COOPERATIVE ENGAGEMENT (CEC)   */}
            {/* ========================================================= */}
            {activeTab === 'network' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Header & Network Selector */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '14px' }}>🌐</span>
                    <span style={{ fontSize: '11px', color: '#00E676', textTransform: 'uppercase', fontWeight: 700 }}>
                      Battlefield Datalink Network
                    </span>
                  </div>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ fontSize: '9.5px', padding: '2px 6px', color: '#00E676', borderColor: '#00E676' }}
                    onClick={() => setShowCreateNetwork(!showCreateNetwork)}
                  >
                    {showCreateNetwork ? '✕ Cancel' : '+ New Network'}
                  </button>
                </div>

                {/* Create Network Panel */}
                {showCreateNetwork && (
                  <div
                    style={{
                      background: 'rgba(0, 230, 118, 0.05)',
                      border: '1px solid rgba(0, 230, 118, 0.3)',
                      borderRadius: '6px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="text"
                      placeholder="e.g. Strike Group Datalink Alpha"
                      value={newNetworkName}
                      onChange={(e) => setNewNetworkName(e.target.value)}
                      style={{
                        background: '#070C14',
                        border: '1px solid var(--border)',
                        color: 'var(--paper)',
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '4px',
                      }}
                    />
                    <button
                      type="button"
                      className="wg-btn accent"
                      style={{ fontSize: '10px', padding: '4px', background: '#00E676', color: '#070C14', fontWeight: 700 }}
                      onClick={() => {
                        if (newNetworkName.trim() && onCreateNetwork) {
                          onCreateNetwork(newNetworkName.trim(), 'layered_optimal');
                          setNewNetworkName('');
                          setShowCreateNetwork(false);
                        }
                      }}
                    >
                      ✓ Create Tactical Network
                    </button>
                  </div>
                )}

                {/* Network Switcher & Active Status */}
                {factionNetworks.length > 0 ? (
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(0, 230, 118, 0.25)',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <select
                        value={currentNetwork?.id || ''}
                        onChange={(e) => setSelectedNetworkId(e.target.value)}
                        style={{
                          background: '#070C14',
                          border: '1px solid rgba(0, 230, 118, 0.4)',
                          color: '#00E676',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '4px 6px',
                          borderRadius: '4px',
                          flex: 1,
                          marginRight: '6px',
                        }}
                      >
                        {factionNetworks.map((net) => (
                          <option key={net.id} value={net.id}>
                            {net.name} ({net.nodes.length} nodes)
                          </option>
                        ))}
                      </select>
                      <span
                        style={{
                          fontSize: '9.5px',
                          color: '#00E676',
                          background: 'rgba(0, 230, 118, 0.15)',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 700,
                        }}
                      >
                        🟢 ONLINE
                      </span>
                    </div>

                    {currentNetwork && (
                      <>
                        {/* Cooperative Doctrine Selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--paper-dim)', fontWeight: 600 }}>
                            Cooperative Defense Doctrine:
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => onSetNetworkDoctrine?.(currentNetwork.id, 'layered_optimal')}
                              style={{
                                flex: 1,
                                padding: '4px 2px',
                                fontSize: '9px',
                                borderRadius: '4px',
                                border: `1px solid ${currentNetwork.doctrine === 'layered_optimal' ? '#00E676' : 'var(--border)'}`,
                                background: currentNetwork.doctrine === 'layered_optimal' ? 'rgba(0, 230, 118, 0.2)' : '#070C14',
                                color: currentNetwork.doctrine === 'layered_optimal' ? '#00E676' : 'var(--paper-dim)',
                                cursor: 'pointer',
                                fontWeight: 700,
                              }}
                            >
                              🛡️ Layered Optimal
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetNetworkDoctrine?.(currentNetwork.id, 'saturation_fire')}
                              style={{
                                flex: 1,
                                padding: '4px 2px',
                                fontSize: '9px',
                                borderRadius: '4px',
                                border: `1px solid ${currentNetwork.doctrine === 'saturation_fire' ? '#FF9800' : 'var(--border)'}`,
                                background: currentNetwork.doctrine === 'saturation_fire' ? 'rgba(255, 152, 0, 0.2)' : '#070C14',
                                color: currentNetwork.doctrine === 'saturation_fire' ? '#FF9800' : 'var(--paper-dim)',
                                cursor: 'pointer',
                                fontWeight: 700,
                              }}
                            >
                              🚀 Max Volley
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetNetworkDoctrine?.(currentNetwork.id, 'conserve_ammo')}
                              style={{
                                flex: 1,
                                padding: '4px 2px',
                                fontSize: '9px',
                                borderRadius: '4px',
                                border: `1px solid ${currentNetwork.doctrine === 'conserve_ammo' ? '#4FC3F7' : 'var(--border)'}`,
                                background: currentNetwork.doctrine === 'conserve_ammo' ? 'rgba(79, 195, 247, 0.2)' : '#070C14',
                                color: currentNetwork.doctrine === 'conserve_ammo' ? '#4FC3F7' : 'var(--paper-dim)',
                                cursor: 'pointer',
                                fontWeight: 700,
                              }}
                            >
                              ⚡ Conserve
                            </button>
                          </div>
                        </div>

                        {/* OTH Sensor Fusion Toggle */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(0, 0, 0, 0.3)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                          }}
                        >
                          <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                            Over-the-Horizon (OTH) Targeting:
                          </span>
                          <button
                            type="button"
                            onClick={() => onToggleNetworkOth?.(currentNetwork.id)}
                            style={{
                              padding: '2px 6px',
                              fontSize: '9.5px',
                              borderRadius: '3px',
                              border: 'none',
                              background: currentNetwork.othTargetingEnabled ? '#00E676' : '#555',
                              color: currentNetwork.othTargetingEnabled ? '#070C14' : '#CCC',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {currentNetwork.othTargetingEnabled ? '✓ ENABLED' : 'OFF'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--paper-dim)', textAlign: 'center', padding: '12px' }}>
                    No tactical networks initialized. Click '+ New Network' to initialize a Datalink Grid.
                  </div>
                )}

                {/* Theater Air Defense Tiers & Capacity Diagnostic */}
                {currentNetwork && (
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                      Layered Defense Grid Coverage:
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#4FA85F' }}>🚀 Tier 1 (Outer SAM, 60–120 km):</span>
                        <span style={{ fontWeight: 600 }}>Active (Aster-30 / Long-Range)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#E8833A' }}>🚀 Tier 2 (Medium SAM, 20–45 km):</span>
                        <span style={{ fontWeight: 600 }}>Active (Aster-15 / Point SAM)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#D9534F' }}>💥 Tier 3 (Point CIWS, &lt;15 km):</span>
                        <span style={{ fontWeight: 600 }}>Max 2 Leakers / Salvo Cycle</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Linked Member Nodes Section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Active Deployed Platforms ({friendlyEntities.filter((e) => e.networkId === currentNetwork?.id && isEntityDeployed(e)).length})
                    </span>
                  </div>

                  {friendlyEntities.filter((e) => e.networkId === currentNetwork?.id && isEntityDeployed(e)).length === 0 ? (
                    <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', fontStyle: 'italic', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px dashed var(--border)' }}>
                      No deployed units active in this datalink grid. Scramble aircraft or deploy naval/ground combatants into the theater to link them into the tactical network.
                    </div>
                  ) : (
                    friendlyEntities
                      .filter((e) => e.networkId === currentNetwork?.id && isEntityDeployed(e))
                      .map((entity) => {
                        const spec = systemsLibrary.find((s) => s.id === entity.systemId);
                        const isScout = entity.typeId === 'uav' || entity.typeId === 'awacs' || entity.typeId === 'recon';
                        const isAD = entity.typeId === 'sam-launcher' || entity.typeId === 'destroyer' || entity.typeId === 'frigate';
                        const roleLabel = isScout ? '📡 Sensor Scout' : isAD ? '🛡️ Area Air Defense' : '⚔️ Shooter';

                        const radarStatus = entity.subsystems?.radar ?? 'operational';
                        const weaponsStatus = entity.subsystems?.weapons ?? 'operational';
                        const floodingStatus = entity.subsystems?.flooding ?? 'none';

                        return (
                          <div
                            key={entity.id}
                            style={{
                              background: 'rgba(255, 255, 255, 0.03)',
                              border: `1px solid ${selectedEntity?.id === entity.id ? '#00E676' : 'var(--border)'}`,
                              borderRadius: '6px',
                              padding: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '5px',
                              cursor: 'pointer',
                            }}
                            onClick={() => onSelectEntity(entity.id)}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{getSimUnitIcon(entity.typeId)}</span>
                                <strong style={{ fontSize: '11.5px', color: activeColor }}>{entity.name}</strong>
                              </div>
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  color: 'var(--paper-dim)',
                                }}
                              >
                                {roleLabel}
                              </span>
                            </div>

                            {/* Subsystem Health Profile */}
                            <div style={{ display: 'flex', gap: '4px', fontSize: '9.5px', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  padding: '1px 4px',
                                  borderRadius: '2px',
                                  background: radarStatus === 'destroyed' ? 'rgba(255, 82, 82, 0.2)' : radarStatus === 'degraded' ? 'rgba(255, 176, 32, 0.2)' : 'rgba(0, 230, 118, 0.15)',
                                  color: radarStatus === 'destroyed' ? '#FF5252' : radarStatus === 'degraded' ? '#FFB020' : '#00E676',
                                  fontWeight: 600,
                                }}
                              >
                                Radar: {radarStatus.toUpperCase()}
                              </span>
                              <span
                                style={{
                                  padding: '1px 4px',
                                  borderRadius: '2px',
                                  background: weaponsStatus === 'offline' ? 'rgba(255, 82, 82, 0.2)' : 'rgba(0, 230, 118, 0.15)',
                                  color: weaponsStatus === 'offline' ? '#FF5252' : '#00E676',
                                  fontWeight: 600,
                                }}
                              >
                                Weapons: {weaponsStatus.toUpperCase()}
                              </span>
                              {floodingStatus !== 'none' && (
                                <span
                                  style={{
                                    padding: '1px 4px',
                                    borderRadius: '2px',
                                    background: 'rgba(255, 82, 82, 0.25)',
                                    color: '#FF5252',
                                    fontWeight: 700,
                                  }}
                                >
                                  ⚠️ SINKING / FLOODING
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                              <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                                Channels: <strong>4/4 Active</strong> · Speed: <strong>{entity.speedKmh} km/h</strong>
                              </span>
                              <button
                                type="button"
                                className="wg-btn"
                                style={{ fontSize: '9px', padding: '2px 5px', color: '#D9534F', borderColor: '#D9534F' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveEntityFromNetwork?.(entity.id);
                                }}
                              >
                                Unlink
                              </button>
                            </div>
                          </div>
                        );
                      })
                  )}

                  {/* Unassigned Deployed Units to Link */}
                  {friendlyEntities.some((e) => e.networkId !== currentNetwork?.id && isEntityDeployed(e)) && (
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--paper-dim)', fontWeight: 600 }}>
                        + Add Available Deployed Units to Datalink:
                      </span>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {friendlyEntities
                          .filter((e) => e.networkId !== currentNetwork?.id && isEntityDeployed(e))
                          .map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              className="wg-btn"
                              style={{ fontSize: '9.5px', padding: '3px 6px', borderColor: 'var(--border)' }}
                              onClick={() => {
                                if (currentNetwork) onAssignEntityToNetwork?.(e.id, currentNetwork.id);
                              }}
                            >
                              + {e.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)', fontStyle: 'italic', marginTop: '2px' }}>
                    ℹ️ Units stationed inside bases (docked / turnaround / in repair) do not join the datalink until scrambled/deployed on a mission.
                  </div>
                </div>

                {/* Shared Sensor Fusion Feed */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#4FC3F7', textTransform: 'uppercase', fontWeight: 700 }}>
                    📡 Shared Sensor Fusion Picture ({visibleContacts.length} tracks)
                  </span>
                  {visibleContacts.length === 0 ? (
                    <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', fontStyle: 'italic', padding: '6px 0' }}>
                      No hostile contacts actively tracked. Deploy UAV or AWACS forward pickets to scan theater.
                    </div>
                  ) : (
                    visibleContacts.map((c) => (
                      <div
                        key={c.contactId}
                        style={{
                          background: 'rgba(79, 195, 247, 0.05)',
                          border: '1px solid rgba(79, 195, 247, 0.25)',
                          borderRadius: '5px',
                          padding: '6px 8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <strong style={{ fontSize: '11px', color: '#4FC3F7' }}>
                            {c.knownName || `Hostile ${c.domain.toUpperCase()} Track`}
                          </strong>
                          <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                            Speed: {c.speedKmh} km/h · Heading: {c.headingDeg.toFixed(0)}° · Tier {c.intelTier}
                          </span>
                        </div>

                        {onOrderStrike && friendlyEntities.some((e) => e.networkId === currentNetwork?.id && (isNavalCombatant(e.typeId) || e.typeId === 'fighter' || e.typeId === 'strike' || e.typeId === 'bomber' || e.typeId === 'sam-launcher')) && (
                          <button
                            type="button"
                            className="wg-btn accent"
                            style={{
                              fontSize: '9.5px',
                              padding: '3px 8px',
                              background: '#4FC3F7',
                              color: '#070C14',
                              fontWeight: 700,
                            }}
                            onClick={() => {
                              const shooter = friendlyEntities.find(
                                (e) => e.networkId === currentNetwork?.id && (isNavalCombatant(e.typeId) || e.typeId === 'fighter' || e.typeId === 'strike' || e.typeId === 'bomber' || e.typeId === 'sam-launcher')
                              );
                              if (shooter) {
                                setStrikeModalTarget({
                                  targetId: c.targetEntityId,
                                  name: c.knownName || `Hostile ${c.domain.toUpperCase()} Track`,
                                  count: c.knownCount || 1,
                                  domain: c.domain,
                                  iso: c.targetIso,
                                  lngLat: c.lastKnownLngLat,
                                  intelTier: c.intelTier,
                                  damage: c.knownDamage,
                                  speedKmh: c.speedKmh,
                                });
                              }
                            }}
                          >
                            🎯 Strike via Net
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB: THEATER BATTLE OPERATIONS (BATTLE OPS PLANNER)        */}
            {/* ========================================================= */}
            {activeTab === 'battle_ops' && (
              <BattleOpsPlanner
                session={session}
                plan={battleOpsPlan || session.battleOpsPlan || {
                  id: `bop-${Date.now().toString(36)}`,
                  title: `Operation ${activeCountryIso} Thunder: Multi-Phase Theater Strike`,
                  status: 'draft',
                  activePhaseIndex: 0,
                  phases: [
                    {
                      id: `phase-1-${Date.now()}`,
                      phaseNumber: 1,
                      name: 'Phase 1: SEAD & Air Defense Suppression',
                      triggerDelaySec: 0,
                      status: 'pending',
                      tasks: [],
                    },
                    {
                      id: `phase-2-${Date.now() + 1}`,
                      phaseNumber: 2,
                      name: 'Phase 2: Deep ISR Ingress & Escort Sorties',
                      triggerDelaySec: 900,
                      status: 'pending',
                      tasks: [],
                    },
                    {
                      id: `phase-3-${Date.now() + 2}`,
                      phaseNumber: 3,
                      name: 'Phase 3: Main Strategic Strike Package',
                      triggerDelaySec: 1800,
                      status: 'pending',
                      tasks: [],
                    },
                  ],
                }}
                onUpdatePlan={(updates) => onUpdateBattleOpsPlan?.(updates)}
                onAddPhase={(name, delay) => onAddBattleOpsPhase?.(name, delay)}
                onRemovePhase={(phaseId) => onRemoveBattleOpsPhase?.(phaseId)}
                onUpdatePhase={(phaseId, updates) => onUpdateBattleOpsPhase?.(phaseId, updates)}
                onAddTask={(phaseId, task) => onAddBattleOpsTask?.(phaseId, task)}
                onRemoveTask={(phaseId, taskId) => onRemoveBattleOpsTask?.(phaseId, taskId)}
                onStartExecution={() => onStartBattleOpsExecution?.()}
                onResetPlan={() => onResetBattleOpsPlan?.()}
                friendlyEntities={friendlyEntities}
                friendlyBases={friendlyBases}
                visibleContacts={visibleContacts}
                systemsLibrary={systemsLibrary}
                onOpenReport={(reportId) => {
                  if (reportId) {
                    const rpt = session.reports?.find((r) => r.id === reportId);
                    if (rpt) {
                      setSelectedReport(rpt);
                      return;
                    }
                  }
                  setActiveTab('reports');
                }}
                onSelectEntity={(id) => onSelectEntity(id)}
              />
            )}

            {/* ========================================================= */}
            {/* TAB 4: COMBAT & INTELLIGENCE REPORTS                      */}
            {/* ========================================================= */}
            {activeTab === 'reports' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase', fontWeight: 700 }}>
                    {activeCountryName} After-Action Reports ({filteredReports.length})
                  </span>
                  <span style={{ fontSize: '9.5px', color: '#4FC3F7' }}>
                    Click report for analysis
                  </span>
                </div>

                {/* Report Category Filters */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setReportCategoryFilter('all')}
                    style={{
                      padding: '3px 7px',
                      fontSize: '9.5px',
                      borderRadius: '4px',
                      border: `1px solid ${reportCategoryFilter === 'all' ? '#4FC3F7' : 'var(--border)'}`,
                      background: reportCategoryFilter === 'all' ? 'rgba(79, 195, 247, 0.18)' : '#070C14',
                      color: reportCategoryFilter === 'all' ? '#4FC3F7' : 'var(--paper-dim)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    All ({activeFactionReports.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportCategoryFilter('under_attack')}
                    style={{
                      padding: '3px 7px',
                      fontSize: '9.5px',
                      borderRadius: '4px',
                      border: `1px solid ${reportCategoryFilter === 'under_attack' ? '#FF5252' : 'var(--border)'}`,
                      background: reportCategoryFilter === 'under_attack' ? 'rgba(255, 82, 82, 0.18)' : '#070C14',
                      color: reportCategoryFilter === 'under_attack' ? '#FF5252' : 'var(--paper-dim)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🛡️ Under Attack ({activeFactionReports.filter((r) => r.category === 'under_attack').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportCategoryFilter('offensive_strike')}
                    style={{
                      padding: '3px 7px',
                      fontSize: '9.5px',
                      borderRadius: '4px',
                      border: `1px solid ${reportCategoryFilter === 'offensive_strike' ? '#FF9800' : 'var(--border)'}`,
                      background: reportCategoryFilter === 'offensive_strike' ? 'rgba(255, 152, 0, 0.18)' : '#070C14',
                      color: reportCategoryFilter === 'offensive_strike' ? '#FF9800' : 'var(--paper-dim)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🚀 Strikes ({activeFactionReports.filter((r) => r.category === 'offensive_strike').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportCategoryFilter('recon_intel')}
                    style={{
                      padding: '3px 7px',
                      fontSize: '9.5px',
                      borderRadius: '4px',
                      border: `1px solid ${reportCategoryFilter === 'recon_intel' ? '#4FC3F7' : 'var(--border)'}`,
                      background: reportCategoryFilter === 'recon_intel' ? 'rgba(79, 195, 247, 0.18)' : '#070C14',
                      color: reportCategoryFilter === 'recon_intel' ? '#4FC3F7' : 'var(--paper-dim)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    📡 Intel / PID ({activeFactionReports.filter((r) => r.category === 'recon_intel').length})
                  </button>
                </div>

                {filteredReports.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      color: 'var(--paper-dim)',
                      fontSize: '11px',
                      background: '#070C14',
                      borderRadius: '6px',
                      border: '1px dashed var(--border)',
                    }}
                  >
                    <span>📊 No tactical reports logged under this filter.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {filteredReports.map((rep) => {
                      const isDef = rep.category === 'under_attack';
                      const isOff = rep.category === 'offensive_strike';
                      const repColor = isDef ? '#FF5252' : isOff ? '#FF9800' : '#4FC3F7';

                      return (
                        <div
                          key={rep.id}
                          onClick={() => setSelectedReport(rep)}
                          style={{
                            padding: '8px 10px',
                            background: '#09101B',
                            border: '1px solid var(--border)',
                            borderLeft: `3px solid ${repColor}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = repColor;
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.borderLeftColor = repColor;
                            e.currentTarget.style.background = '#09101B';
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 800,
                                color: repColor,
                                background: `${repColor}18`,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                textTransform: 'uppercase',
                              }}
                            >
                              {isDef ? '🛡️ Under Attack' : isOff ? '🚀 Strike' : '📡 Intel PID'}
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--paper-dim)' }}>
                              {rep.timeFormatted}
                            </span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '11.5px', color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {rep.title}
                            </strong>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                              {rep.primaryEntity?.rcsM2 !== undefined && (
                                <span
                                  style={{
                                    fontSize: '8.5px',
                                    color: '#4FC3F7',
                                    background: 'rgba(79, 195, 247, 0.15)',
                                    padding: '1px 4px',
                                    borderRadius: '2px',
                                    fontWeight: 700,
                                  }}
                                  title={`Primary System RCS: ${rep.primaryEntity.rcsM2} m²`}
                                >
                                  RCS: {rep.primaryEntity.rcsM2 >= 1 ? rep.primaryEntity.rcsM2.toFixed(1) : rep.primaryEntity.rcsM2}m²
                                </span>
                              )}
                              {rep.opposingEntity && (
                                <span
                                  style={{
                                    fontSize: '8.5px',
                                    color: rep.opposingEntity.isPID ? '#4FA85F' : '#FF9800',
                                    background: rep.opposingEntity.isPID ? 'rgba(79, 168, 95, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                                    padding: '1px 4px',
                                    borderRadius: '2px',
                                    fontWeight: 700,
                                  }}
                                >
                                  {rep.opposingEntity.isPID ? 'PID ✓' : 'UNPID ⚠️'}
                                </span>
                              )}
                            </div>
                          </div>

                          <p style={{ margin: 0, fontSize: '10.5px', color: 'var(--paper-dim)', lineHeight: 1.35 }}>
                            {rep.summary}
                          </p>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', fontSize: '9.5px', color: '#4FC3F7' }}>
                            <span>Details & Interception Analysis ➔</span>
                            {rep.damageAssessment && (
                              <span style={{ color: rep.damageAssessment.damageInflicted === 'destroyed' ? '#FF5252' : rep.damageAssessment.damageInflicted === 'heavy' ? '#FF9800' : '#4FA85F', fontWeight: 600 }}>
                                {rep.damageAssessment.targetResultState.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ========================================================= */}
            {/* TAB 5: BATTLE LOG TICKER                                  */}
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
        const isNaval = (isNavalCombatant(selectedEntity.typeId) || (spec ? domainOf(spec) === 'sea' : false)) && selectedEntity.typeId !== 'submarine';
        const detectionKm = (selectedEntity.typeId === 'uav' || selectedEntity.typeId === 'recon')
          ? Math.max(spec?.sensor?.detectionKm ?? 40, 180)
          : (spec?.sensor?.detectionKm ?? (
              isGround ? 8 : selectedEntity.typeId === 'awacs' ? 450 : selectedEntity.typeId === 'radar' ? 400 : 250
            ));
        const surfaceHorizonKm = isNaval ? Math.round(radarHorizonKm(spec?.sensor?.antennaM ?? 25, 25)) : 0;
        const statusLabel =
          isStaticAD
            ? 'AIR DEFENSE (ON WATCH)'
            : selectedEntity.status === 'on_station'
              ? (isGround ? 'ENTRENCHED' : isNaval ? 'MARITIME PATROL' : 'AIR PATROL')
              : selectedEntity.status === 'takeoff_ingress'
                ? (isGround ? 'ROAD MARCH' : isNaval ? 'TRANSIT INGRESS' : 'TAKEOFF INGRESS')
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

              {(() => {
                const entityDomain = spec ? domainOf(spec) : isGround ? 'ground' : isNaval ? 'sea' : 'air';
                const rcsVal = selectedEntity.rcs ?? (spec ? getSystemRcs(spec, entityDomain) : 5.0);
                const rcsText = rcsVal >= 1 ? `${rcsVal.toFixed(1)} m²` : `${rcsVal} m²`;

                return (
                  <>
                    {!isStaticAD ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                        <span>Speed: <strong>{selectedEntity.speedKmh} km/h</strong></span>
                        <span>Alt: <strong>{isGround ? '0 m' : `${(selectedEntity.altitudeM / 1000).toFixed(1)} km`}</strong></span>
                        <span>Hdg: <strong>{selectedEntity.headingDeg.toFixed(0)}°</strong></span>
                        <span
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          title="Click to customize platform RCS footprint (e.g. for external weapons/pylons)"
                          onClick={() => {
                            setRcsInputDraft(rcsVal.toString());
                            setEditingRcs((prev) => !prev);
                          }}
                        >
                          RCS: <strong style={{ color: '#4FC3F7', textDecoration: 'underline dotted' }}>{rcsText}</strong> ✏️
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Site: <strong>Fixed Position</strong></span>
                        <span>Altitude: <strong>0 m</strong></span>
                        <span
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          title="Click to customize platform RCS footprint"
                          onClick={() => {
                            setRcsInputDraft(rcsVal.toString());
                            setEditingRcs((prev) => !prev);
                          }}
                        >
                          RCS: <strong style={{ color: '#4FC3F7', textDecoration: 'underline dotted' }}>{rcsText}</strong> ✏️
                        </span>
                        <span>Posture: <strong style={{ color: '#4FA85F' }}>Active Watch</strong></span>
                      </div>
                    )}

                    {editingRcs && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '6px 8px',
                          background: 'rgba(7, 12, 20, 0.95)',
                          border: '1px solid rgba(79, 195, 247, 0.4)',
                          borderRadius: '5px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '10.5px',
                        }}
                      >
                        <span style={{ color: 'var(--paper-dim)' }}>Set RCS:</span>
                        <input
                          type="number"
                          step="any"
                          min="0.00001"
                          style={{
                            width: '70px',
                            fontSize: '11px',
                            padding: '2px 4px',
                            background: '#0E1724',
                            color: '#4FC3F7',
                            border: '1px solid var(--border)',
                            borderRadius: '3px',
                            fontWeight: 700,
                          }}
                          value={rcsInputDraft}
                          onChange={(e) => setRcsInputDraft(e.target.value)}
                          autoFocus
                        />
                        <span style={{ color: '#90A4AE' }}>m²</span>
                        <button
                          type="button"
                          className="wg-btn"
                          style={{ fontSize: '9.5px', padding: '2px 6px', background: 'rgba(79, 195, 247, 0.25)', color: '#4FC3F7' }}
                          onClick={() => {
                            const val = parseFloat(rcsInputDraft);
                            if (!isNaN(val) && val > 0) {
                              onUpdateEntityRcs?.(selectedEntity.id, val);
                            }
                            setEditingRcs(false);
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="wg-btn"
                          style={{ fontSize: '9.5px', padding: '2px 6px' }}
                          onClick={() => setEditingRcs(false)}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Sensor / Sight Horizon Envelopes */}
              {isNaval ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                  {/* Air Search Radar Envelope */}
                  <div
                    style={{
                      padding: '5px 9px',
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
                      <span>📡</span>
                      <span>Air Search Radar (Full 3D):</span>
                    </span>
                    <strong style={{ color: '#4FC3F7' }}>{detectionKm} km</strong>
                  </div>

                  {/* Surface Search / Clipped Horizon Envelope */}
                  <div
                    style={{
                      padding: '5px 9px',
                      background: 'rgba(0, 229, 255, 0.08)',
                      borderRadius: '5px',
                      border: '1px solid rgba(0, 229, 255, 0.25)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '11px',
                    }}
                  >
                    <span style={{ color: '#00E5FF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🌊</span>
                      <span>Surface Search (Clipped Horizon):</span>
                    </span>
                    <strong style={{ color: '#00E5FF' }}>{surfaceHorizonKm} km</strong>
                  </div>
                </div>
              ) : (
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
              )}

              {/* Equipped Weapons Arsenal & Interactive Range Toggles */}
              {(() => {
                const weapons = (selectedEntity.customWeapons && selectedEntity.customWeapons.length > 0)
                  ? selectedEntity.customWeapons
                  : (spec?.weapons || []);
                if (weapons.length === 0) return null;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '9.5px', textTransform: 'uppercase', color: 'var(--paper-dim)', fontWeight: 600, letterSpacing: '0.4px' }}>
                        Equipped Weapons (Click to toggle reach):
                      </span>
                      <span style={{ fontSize: '9px', color: '#4FC3F7', background: 'rgba(79, 195, 247, 0.1)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(79, 195, 247, 0.25)' }}>
                        🔒 Deployed (Fixed)
                      </span>
                    </div>

                    {weapons.map((w, idx) => {
                      const isActive = activeWeaponIndex === idx;
                      const isDepleted = w.magazine !== undefined && w.magazine <= 0;
                      const totalInFormation = selectedEntity.count * (w.magazine ?? 1);

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
                            border: `1px solid ${isActive ? '#FF9800' : isDepleted ? 'rgba(217, 83, 79, 0.4)' : 'var(--border)'}`,
                            background: isActive
                              ? 'rgba(255, 152, 0, 0.16)'
                              : isDepleted
                                ? 'rgba(217, 83, 79, 0.08)'
                                : '#070C14',
                            color: isActive ? '#FF9800' : isDepleted ? '#FF5252' : 'var(--paper)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '13px' }}>{isDepleted ? '⚠️' : isActive ? '🎯' : '🚀'}</span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <strong style={{ fontSize: '11px', color: isActive ? '#FF9800' : isDepleted ? '#FF5252' : '#FFFFFF' }}>
                                {isDepleted ? `0 × ${w.name} (DEPLETED)` : `${w.magazine ? `${w.magazine} × ` : ''}${w.name || `Weapon #${idx + 1}`}`}
                              </strong>
                              <span style={{ fontSize: '8.5px', color: isDepleted ? '#FF5252' : 'var(--paper-dim)' }}>
                                {isDepleted ? 'RTB required to replenish' : `${totalInFormation} Total Rounds in Formation`}
                                {w.engages && w.engages.length > 0 ? ` · Targets: ${w.engages.join(', ')}` : ''}
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                            <strong style={{ color: isDepleted ? '#FF5252' : '#FF9800', fontSize: '11px' }}>{w.rangeKm} km</strong>
                            <span
                              style={{
                                fontSize: '8px',
                                padding: '1px 4px',
                                borderRadius: '2px',
                                fontWeight: 600,
                                background: isActive ? '#FF9800' : isDepleted ? 'rgba(217, 83, 79, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                color: isActive ? '#070C14' : isDepleted ? '#FF5252' : 'var(--paper-dim)',
                              }}
                            >
                              {isActive ? '✓ ON MAP' : isDepleted ? 'DEPLETED' : 'CLICK TO SHOW'}
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
          onStartStrikeRoutePlanning={(params) => {
            setStrikeModalTarget(null);
            onSelectContact?.(null);
            onSelectEntity(null);
            onStartStrikeRoutePlanning?.(params);
          }}
        />
      )}

      {/* 7. Combat After-Action Report (AAR) & Tactical Analysis Modal */}
      {selectedReport && (
        <CombatReportDetailModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onFlyToLocation={onFlyToBase}
          playerCountryName={playerCountryName}
          enemyCountryName={enemyCountryName}
        />
      )}
    </>
  );
}
