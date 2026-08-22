'use client';

/**
 * Full-Screen War Simulation Launcher & ORBAT Staging Suite
 *
 * Provides complete pre-simulation configuration:
 * 1. Session Naming & Faction Assignment (Player vs Enemy Nations & Colors).
 * 2. Branch Personnel Allocation (Army, Navy, Air Force, Strategic Forces).
 * 3. Exact System Quota Assignment (drawing from Technical Systems Library).
 * 4. Pre-Flight Validation Audit Engine with modal alerts for missing fields.
 */

import React, { useState, useMemo, useEffect } from 'react';
import type { WarGames } from '@/lib/useWarGames';
import { NATION_COLORS } from '@/lib/warGames';
import {
  type SystemSpec,
  validateSimSystem,
  validateOrbatRoster,
  type OrbatValidationResult,
} from '@/lib/specs';
import {
  type WarSimSession,
  type BranchPersonnel,
  type FactionQuotaLedger,
} from '@/lib/warSimTypes';
import { PreFlightValidationModal } from './PreFlightValidationModal';

export interface WarSimLauncherProps {
  wg: WarGames;
  isOpen: boolean;
  onClose: () => void;
  onLaunchSimulation: (session: WarSimSession) => void;
  onOpenConfiguration: (systemId?: string) => void;
}

const DEFAULT_PERSONNEL: BranchPersonnel = {
  army: 180000,
  navy: 45000,
  airForce: 65000,
  strategicForces: 12000,
  specialOps: 8000,
  total: 310000,
};

export function WarSimLauncher({
  wg,
  isOpen,
  onClose,
  onLaunchSimulation,
  onOpenConfiguration,
}: WarSimLauncherProps) {
  // Session Configuration State
  const [sessionName, setSessionName] = useState('Operation Strategic Vigilance');
  const [playerIso, setPlayerIso] = useState<string>('US');
  const [playerColor, setPlayerColor] = useState<string>('#4F9FD6');
  const [enemyIso, setEnemyIso] = useState<string>('RU');
  const [enemyColor, setEnemyColor] = useState<string>('#D9534F');

  // Branch Personnel State
  const [playerPersonnel, setPlayerPersonnel] = useState<BranchPersonnel>({ ...DEFAULT_PERSONNEL });
  const [enemyPersonnel, setEnemyPersonnel] = useState<BranchPersonnel>({ ...DEFAULT_PERSONNEL });

  // System Quotas State: Map of systemId -> count
  const [playerQuotas, setPlayerQuotas] = useState<Record<string, number>>({});
  const [enemyQuotas, setEnemyQuotas] = useState<Record<string, number>>({});

  // Active Tab in Launcher: 'factions' | 'player_orbat' | 'enemy_orbat' | 'validation'
  const [activeTab, setActiveTab] = useState<'factions' | 'player_orbat' | 'enemy_orbat'>('factions');

  // New system draft selector state
  const [selectedSysIdToAdd, setSelectedSysIdToAdd] = useState<string>('');
  const [selectedSysCountToAdd, setSelectedSysCountToAdd] = useState<number>(12);

  // Validation Modal State
  const [validationModalOpen, setValidationModalOpen] = useState(false);

  // Available Nations list from world countries
  const availableNations = useMemo(() => {
    const nations = wg.countries || [];
    if (nations.length) return nations;
    return [
      { iso: 'US', name: 'United States' },
      { iso: 'RU', name: 'Russian Federation' },
      { iso: 'CN', name: 'China' },
      { iso: 'GB', name: 'United Kingdom' },
      { iso: 'FR', name: 'France' },
      { iso: 'DE', name: 'Germany' },
      { iso: 'UA', name: 'Ukraine' },
      { iso: 'IN', name: 'India' },
      { iso: 'PK', name: 'Pakistan' },
      { iso: 'TW', name: 'Taiwan' },
      { iso: 'JP', name: 'Japan' },
      { iso: 'IL', name: 'Israel' },
      { iso: 'IR', name: 'Iran' },
    ];
  }, [wg.countries]);

  // Seed default systems if empty on load
  useEffect(() => {
    if (Object.keys(playerQuotas).length === 0 && wg.systems.length > 0) {
      // Find prominent air, sea, ground, and air defense systems
      const f35 = wg.systems.find((s) => s.id.includes('f-35') || s.id.includes('f-16') || s.typeId === 'fighter');
      const burke = wg.systems.find((s) => s.id.includes('burke') || s.typeId === 'destroyer');
      const patriot = wg.systems.find((s) => s.id.includes('patriot') || s.typeId === 'sam-launcher');
      const abrams = wg.systems.find((s) => s.id.includes('abrams') || s.typeId === 'armour');

      const initialPlayer: Record<string, number> = {};
      if (f35) initialPlayer[f35.id] = 24;
      if (burke) initialPlayer[burke.id] = 3;
      if (patriot) initialPlayer[patriot.id] = 4;
      if (abrams) initialPlayer[abrams.id] = 40;
      setPlayerQuotas(initialPlayer);

      const su35 = wg.systems.find((s) => s.id.includes('su-35') || s.id.includes('su-30') || s.typeId === 'fighter');
      const s400 = wg.systems.find((s) => s.id.includes('s-400') || s.typeId === 'sam-launcher');
      const frigate = wg.systems.find((s) => s.id.includes('gorshkov') || s.typeId === 'frigate');
      const t90 = wg.systems.find((s) => s.id.includes('t-90') || s.typeId === 'armour');

      const initialEnemy: Record<string, number> = {};
      if (su35) initialEnemy[su35.id] = 24;
      if (s400) initialEnemy[s400.id] = 4;
      if (frigate) initialEnemy[frigate.id] = 2;
      if (t90) initialEnemy[t90.id] = 40;
      setEnemyQuotas(initialEnemy);
    }
  }, [wg.systems, playerQuotas]);

  // Recalculate personnel totals
  const updatePlayerPersonnel = (field: keyof BranchPersonnel, val: number) => {
    setPlayerPersonnel((prev) => {
      const next = { ...prev, [field]: Math.max(0, val) };
      next.total = next.army + next.navy + next.airForce + next.strategicForces + next.specialOps;
      return next;
    });
  };

  const updateEnemyPersonnel = (field: keyof BranchPersonnel, val: number) => {
    setEnemyPersonnel((prev) => {
      const next = { ...prev, [field]: Math.max(0, val) };
      next.total = next.army + next.navy + next.airForce + next.strategicForces + next.specialOps;
      return next;
    });
  };

  // Add / Remove / Adjust Quotas
  const handleAddQuota = (target: 'player' | 'enemy') => {
    if (!selectedSysIdToAdd) return;
    const setter = target === 'player' ? setPlayerQuotas : setEnemyQuotas;
    setter((prev) => ({
      ...prev,
      [selectedSysIdToAdd]: (prev[selectedSysIdToAdd] || 0) + selectedSysCountToAdd,
    }));
    setSelectedSysIdToAdd('');
  };

  const handleUpdateCount = (target: 'player' | 'enemy', sysId: string, delta: number) => {
    const setter = target === 'player' ? setPlayerQuotas : setEnemyQuotas;
    setter((prev) => {
      const current = prev[sysId] || 0;
      const nextCount = current + delta;
      if (nextCount <= 0) {
        const copy = { ...prev };
        delete copy[sysId];
        return copy;
      }
      return { ...prev, [sysId]: nextCount };
    });
  };

  const handleRemoveQuota = (target: 'player' | 'enemy', sysId: string) => {
    const setter = target === 'player' ? setPlayerQuotas : setEnemyQuotas;
    setter((prev) => {
      const copy = { ...prev };
      delete copy[sysId];
      return copy;
    });
  };

  // Real-time validation computation
  const playerValidation: OrbatValidationResult = useMemo(() => {
    return validateOrbatRoster(Object.keys(playerQuotas), wg.systems);
  }, [playerQuotas, wg.systems]);

  const enemyValidation: OrbatValidationResult = useMemo(() => {
    return validateOrbatRoster(Object.keys(enemyQuotas), wg.systems);
  }, [enemyQuotas, wg.systems]);

  const playerName = availableNations.find((n) => n.iso === playerIso)?.name ?? playerIso;
  const enemyName = availableNations.find((n) => n.iso === enemyIso)?.name ?? enemyIso;

  // Handle Begin Simulation Trigger
  const handleBeginSimulation = () => {
    const allValid = playerValidation.valid && enemyValidation.valid;
    if (!allValid) {
      setValidationModalOpen(true);
      return;
    }

    // Build the master initial WarSimSession
    const playerQuotaLedger: FactionQuotaLedger = {};
    for (const [sysId, count] of Object.entries(playerQuotas)) {
      const spec = wg.systems.find((s) => s.id === sysId);
      playerQuotaLedger[sysId] = {
        systemId: sysId,
        typeId: spec?.typeId || 'fighter',
        customName: spec?.name,
        count,
        deployed: 0,
        destroyed: 0,
        inRepair: 0,
      };
    }

    const enemyQuotaLedger: FactionQuotaLedger = {};
    for (const [sysId, count] of Object.entries(enemyQuotas)) {
      const spec = wg.systems.find((s) => s.id === sysId);
      enemyQuotaLedger[sysId] = {
        systemId: sysId,
        typeId: spec?.typeId || 'fighter',
        customName: spec?.name,
        count,
        deployed: 0,
        destroyed: 0,
        inRepair: 0,
      };
    }

    const session: WarSimSession = {
      id: `warsim-${Date.now().toString(36)}`,
      name: sessionName || 'Tactical War Simulation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      simTimeSec: 0,
      timeMultiplier: 3, // 3x default speed
      playerIso,
      playerColor,
      enemyIso,
      enemyColor,
      activeFaction: 'player',
      personnel: {
        player: playerPersonnel,
        enemy: enemyPersonnel,
      },
      quotas: {
        player: playerQuotaLedger,
        enemy: enemyQuotaLedger,
      },
      bases: [],
      entities: [],
      activeMissiles: [],
      fogOfWarContacts: {
        playerContacts: [],
        enemyContacts: [],
      },
      eventLog: [
        {
          id: `evt-${Date.now()}`,
          simTimeSec: 0,
          timeFormatted: 'T+00:00',
          faction: 'neutral',
          type: 'alert',
          title: 'War Simulation Initialized',
          detail: `Scenario ${sessionName} commenced between ${playerName} (${playerIso}) and ${enemyName} (${enemyIso}). Real-time clock running at 3x.`,
        },
      ],
    };

    onLaunchSimulation(session);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#070C14',
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--paper)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      {/* Top Header Deck */}
      <header
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(14, 23, 36, 0.95)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '24px' }}>⚔️</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              War Simulation Staging Deck
            </h1>
            <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
              Real-time base logistics · 3x kinematics · dynamic fog of war & kill chains
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="wg-btn" onClick={onClose}>
            Back to Map
          </button>
          <button
            className="wg-btn"
            style={{
              background: '#4FA85F',
              color: '#070C14',
              borderColor: '#4FA85F',
              fontWeight: 700,
              fontSize: '13px',
              padding: '6px 18px',
            }}
            onClick={handleBeginSimulation}
          >
            ▶ Begin Simulation
          </button>
        </div>
      </header>

      {/* Sub-Navigation */}
      <nav
        style={{
          display: 'flex',
          gap: '8px',
          padding: '10px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(10, 17, 28, 0.7)',
        }}
      >
        <button
          className={`wg-nav-tab${activeTab === 'factions' ? ' on' : ''}`}
          onClick={() => setActiveTab('factions')}
        >
          1. Faction & Personnel Setup
        </button>
        <button
          className={`wg-nav-tab${activeTab === 'player_orbat' ? ' on' : ''}`}
          onClick={() => setActiveTab('player_orbat')}
        >
          2. {playerName} Force Quota ({Object.keys(playerQuotas).length} Systems)
          {!playerValidation.valid && <span style={{ color: '#D9534F', marginLeft: '6px' }}>⚠️</span>}
        </button>
        <button
          className={`wg-nav-tab${activeTab === 'enemy_orbat' ? ' on' : ''}`}
          onClick={() => setActiveTab('enemy_orbat')}
        >
          3. {enemyName} Force Quota ({Object.keys(enemyQuotas).length} Systems)
          {!enemyValidation.valid && <span style={{ color: '#D9534F', marginLeft: '6px' }}>⚠️</span>}
        </button>
      </nav>

      {/* Main Staging Canvas */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {/* Tab 1: Factions & Personnel */}
        {activeTab === 'factions' && (
          <div style={{ maxWidth: '980px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#0E1724', padding: '16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: 'var(--paper-dim)', marginBottom: '6px' }}>
                Simulation Name / Operation Designation:
              </label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                style={{
                  width: '100%',
                  background: '#070C14',
                  border: '1px solid var(--border)',
                  color: 'var(--paper)',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Player Side Card */}
              <div style={{ background: '#0E1724', padding: '16px', borderRadius: '6px', border: '1px solid var(--border)', borderTop: `4px solid ${playerColor}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: playerColor }}>🔵 PLAYER FACTION (Blue Force)</h3>
                  <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>Primary Command</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                      Country / State:
                    </label>
                    <select
                      value={playerIso}
                      onChange={(e) => setPlayerIso(e.target.value)}
                      style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '6px 8px', borderRadius: '4px' }}
                    >
                      {availableNations.map((n) => (
                        <option key={n.iso} value={n.iso}>
                          {n.name} ({n.iso})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                      Faction Color Swatch:
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {NATION_COLORS.map((c) => (
                        <button
                          key={c}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '3px',
                            background: c,
                            border: playerColor === c ? '2px solid #FFF' : '1px solid transparent',
                            cursor: 'pointer',
                          }}
                          onClick={() => setPlayerColor(c)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Branch Personnel Headcounts */}
                  <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--paper)' }}>Branch Personnel Headcounts</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                      <div>
                        <span>Army Troops:</span>
                        <input
                          type="number"
                          value={playerPersonnel.army}
                          onChange={(e) => updatePlayerPersonnel('army', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Navy Personnel:</span>
                        <input
                          type="number"
                          value={playerPersonnel.navy}
                          onChange={(e) => updatePlayerPersonnel('navy', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Air Force:</span>
                        <input
                          type="number"
                          value={playerPersonnel.airForce}
                          onChange={(e) => updatePlayerPersonnel('airForce', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Special Operations:</span>
                        <input
                          type="number"
                          value={playerPersonnel.specialOps}
                          onChange={(e) => updatePlayerPersonnel('specialOps', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: '8px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#4FA85F' }}>
                      Total Standing Force: {playerPersonnel.total.toLocaleString()} personnel
                    </div>
                  </div>
                </div>
              </div>

              {/* Enemy Side Card */}
              <div style={{ background: '#0E1724', padding: '16px', borderRadius: '6px', border: '1px solid var(--border)', borderTop: `4px solid ${enemyColor}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: enemyColor }}>🔴 ENEMY FACTION (Red Force)</h3>
                  <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>Adversary State</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                      Country / State:
                    </label>
                    <select
                      value={enemyIso}
                      onChange={(e) => setEnemyIso(e.target.value)}
                      style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '6px 8px', borderRadius: '4px' }}
                    >
                      {availableNations.map((n) => (
                        <option key={n.iso} value={n.iso}>
                          {n.name} ({n.iso})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                      Faction Color Swatch:
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {NATION_COLORS.map((c) => (
                        <button
                          key={c}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '3px',
                            background: c,
                            border: enemyColor === c ? '2px solid #FFF' : '1px solid transparent',
                            cursor: 'pointer',
                          }}
                          onClick={() => setEnemyColor(c)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Branch Personnel Headcounts */}
                  <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--paper)' }}>Branch Personnel Headcounts</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                      <div>
                        <span>Army Troops:</span>
                        <input
                          type="number"
                          value={enemyPersonnel.army}
                          onChange={(e) => updateEnemyPersonnel('army', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Navy Personnel:</span>
                        <input
                          type="number"
                          value={enemyPersonnel.navy}
                          onChange={(e) => updateEnemyPersonnel('navy', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Air Force:</span>
                        <input
                          type="number"
                          value={enemyPersonnel.airForce}
                          onChange={(e) => updateEnemyPersonnel('airForce', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                      <div>
                        <span>Special Operations:</span>
                        <input
                          type="number"
                          value={enemyPersonnel.specialOps}
                          onChange={(e) => updateEnemyPersonnel('specialOps', Number(e.target.value))}
                          style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '4px 6px', borderRadius: '3px', marginTop: '2px' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: '8px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#D9534F' }}>
                      Total Standing Force: {enemyPersonnel.total.toLocaleString()} personnel
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2 & 3: Force Quotas & ORBAT Assignment */}
        {(activeTab === 'player_orbat' || activeTab === 'enemy_orbat') && (
          <div style={{ maxWidth: '980px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(() => {
              const isPlayer = activeTab === 'player_orbat';
              const target = isPlayer ? 'player' : 'enemy';
              const currentQuotas = isPlayer ? playerQuotas : enemyQuotas;
              const currentValidation = isPlayer ? playerValidation : enemyValidation;
              const nationName = isPlayer ? playerName : enemyName;
              const color = isPlayer ? playerColor : enemyColor;

              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '16px', color }}>
                        {nationName} — Authorised Force Inventory Quotas
                      </h2>
                      <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
                        In simulation, this country can deploy only up to these designated stock counts.
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span className={`wg-tag ${currentValidation.valid ? 'success' : 'loss'}`}>
                        {currentValidation.valid ? '✅ All Systems Valid' : `⚠️ ${currentValidation.failedCount} Incomplete Specs`}
                      </span>
                    </div>
                  </div>

                  {/* Add System Box */}
                  <div style={{ background: '#0E1724', padding: '14px', borderRadius: '6px', border: '1px solid var(--border)', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                        Select System from Arsenal Library:
                      </label>
                      <select
                        value={selectedSysIdToAdd}
                        onChange={(e) => setSelectedSysIdToAdd(e.target.value)}
                        style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '6px 8px', borderRadius: '4px' }}
                      >
                        <option value="">-- Choose system from configuration --</option>
                        {wg.systems.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.typeId})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ width: '100px' }}>
                      <label style={{ display: 'block', fontSize: '11px', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                        Stock Count:
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={selectedSysCountToAdd}
                        onChange={(e) => setSelectedSysCountToAdd(Math.max(1, Number(e.target.value)))}
                        style={{ width: '100%', background: '#070C14', border: '1px solid var(--border)', color: 'var(--paper)', padding: '6px 8px', borderRadius: '4px' }}
                      />
                    </div>

                    <button
                      className="wg-btn"
                      style={{ background: '#4F9FD6', color: '#070C14', borderColor: '#4F9FD6', fontWeight: 600, padding: '6px 14px' }}
                      onClick={() => handleAddQuota(target)}
                      disabled={!selectedSysIdToAdd}
                    >
                      + Add to Quota
                    </button>
                  </div>

                  {/* Quota Items Table */}
                  <div style={{ background: '#0E1724', borderRadius: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--paper-dim)' }}>
                          <th style={{ padding: '10px 14px' }}>Platform / System</th>
                          <th style={{ padding: '10px 14px' }}>Type / Role</th>
                          <th style={{ padding: '10px 14px' }}>Status</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center' }}>Authorized Quota</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(currentQuotas).length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--paper-dim)' }}>
                              No systems assigned yet. Add systems above to establish the force quota.
                            </td>
                          </tr>
                        )}
                        {Object.entries(currentQuotas).map(([sysId, count]) => {
                          const spec = wg.systems.find((s) => s.id === sysId);
                          const validation = spec ? validateSimSystem(spec) : { valid: false, missingFields: [] };

                          return (
                            <tr key={sysId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                              <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                                {spec?.name ?? sysId}
                              </td>
                              <td style={{ padding: '10px 14px', color: 'var(--paper-dim)' }}>
                                {spec?.typeId ?? 'generic'}
                              </td>
                              <td style={{ padding: '10px 14px' }}>
                                {validation.valid ? (
                                  <span style={{ color: '#4FA85F', fontSize: '11px' }}>✅ Ready</span>
                                ) : (
                                  <span
                                    style={{ color: '#D9534F', fontSize: '11px', cursor: 'pointer' }}
                                    onClick={() => setValidationModalOpen(true)}
                                    title="Click to view missing critical fields"
                                  >
                                    ⚠️ Missing Specs
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                  <button
                                    className="wg-salvo-btn"
                                    onClick={() => handleUpdateCount(target, sysId, -1)}
                                    style={{ width: '22px', height: '22px' }}
                                  >
                                    -
                                  </button>
                                  <span style={{ fontWeight: 700, minWidth: '32px' }}>{count}</span>
                                  <button
                                    className="wg-salvo-btn"
                                    onClick={() => handleUpdateCount(target, sysId, 1)}
                                    style={{ width: '22px', height: '22px' }}
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                <button
                                  className="wg-salvo-btn"
                                  style={{ color: '#D9534F', borderColor: 'rgba(217, 83, 79, 0.3)' }}
                                  onClick={() => handleRemoveQuota(target, sysId)}
                                  title="Remove from quota"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* Pre-Flight Audit Modal */}
      <PreFlightValidationModal
        isOpen={validationModalOpen}
        onClose={() => setValidationModalOpen(false)}
        onOpenConfiguration={onOpenConfiguration}
        playerValidation={playerValidation}
        enemyValidation={enemyValidation}
        playerName={playerName}
        enemyName={enemyName}
      />
    </div>
  );
}
