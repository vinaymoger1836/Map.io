'use client';

import React, { useState } from 'react';
import {
  type SimEntity,
  type SimBase,
  type WarSimSession,
  type DetectedContact,
} from '@/lib/warSimTypes';
import { type SystemSpec } from '@/lib/specs';
import { distanceKm } from '@/lib/geo';
import {
  CARRIER_LOADOUT_PRESETS,
  getCarrierStrikeGroupScreen,
} from '@/lib/carrierOps';

export interface CarrierAirWingModalProps {
  isOpen: boolean;
  onClose: () => void;
  carrier: SimEntity;
  carrierBase?: SimBase;
  embarkedSquadrons: SimEntity[];
  session: WarSimSession;
  systemsLibrary: SystemSpec[];
  onRearmSquadron?: (squadronEntityId: string, presetKey: any) => void;
  onLaunchStrike?: (
    carrierEntityId: string,
    squadronEntityId: string,
    targetEntityId: string,
    targetLngLat: [number, number],
    weaponIndex: number,
    salvoCount: number
  ) => void;
  onStartSortie?: (entity: SimEntity) => void;
}

export function CarrierAirWingModal({
  isOpen,
  onClose,
  carrier,
  carrierBase,
  embarkedSquadrons,
  session,
  systemsLibrary,
  onRearmSquadron,
  onLaunchStrike,
  onStartSortie,
}: CarrierAirWingModalProps) {
  const [selectedSquadronId, setSelectedSquadronId] = useState<string>(
    embarkedSquadrons[0]?.id || ''
  );
  const [strikeTargetId, setStrikeTargetId] = useState<string>('');
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);
  const [salvoCount, setSalvoCount] = useState<number>(2);
  const [activeTab, setActiveTab] = useState<'squadrons' | 'strike' | 'escorts'>('squadrons');

  if (!isOpen) return null;

  const selectedSquadron = embarkedSquadrons.find((s) => s.id === selectedSquadronId) || embarkedSquadrons[0];
  const csgScreen = getCarrierStrikeGroupScreen(carrier, session, systemsLibrary);

  // Filter enemy contacts within 1100 km carrier strike radius
  const enemyTargets = session.entities.filter((e) => {
    if (e.iso === carrier.iso || e.status === 'destroyed') return false;
    const dist = distanceKm(carrier.lngLat, e.lngLat);
    return dist <= 1100;
  });

  const handleLaunchStrike = () => {
    if (!selectedSquadron || !strikeTargetId || !onLaunchStrike) return;
    const target = session.entities.find((e) => e.id === strikeTargetId);
    if (!target) return;

    onLaunchStrike(
      carrier.id,
      selectedSquadron.id,
      target.id,
      target.lngLat,
      selectedWeaponIdx,
      salvoCount
    );
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 10, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        color: 'var(--paper)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '840px',
          maxWidth: '94vw',
          maxHeight: '90vh',
          backgroundColor: '#09101B',
          border: '1px solid rgba(0, 229, 255, 0.4)',
          borderRadius: '8px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(0, 229, 255, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(90deg, rgba(0, 229, 255, 0.15) 0%, rgba(9, 16, 27, 0.9) 100%)',
            borderBottom: '1px solid rgba(0, 229, 255, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '22px' }}>🚢</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', color: '#00E5FF', letterSpacing: '0.5px' }}>
                  {carrier.name} · CARRIER AIR WING (CVW) OPERATIONS
                </h2>
                <div style={{ fontSize: '11px', color: 'var(--paper-dim)', marginTop: '2px' }}>
                  Mobile Sea Base · Pos: {carrier.lngLat[1].toFixed(3)}°N, {carrier.lngLat[0].toFixed(3)}°E · Speed:{' '}
                  {carrier.speedKmh} km/h ({(carrier.speedKmh / 1.852).toFixed(0)} kts) · Hdg:{' '}
                  {carrier.headingDeg.toFixed(0)}°
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-dim)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('squadrons')}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: activeTab === 'squadrons' ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'squadrons' ? '2px solid #00E5FF' : '2px solid transparent',
              color: activeTab === 'squadrons' ? '#00E5FF' : 'var(--paper-dim)',
              fontWeight: 600,
              fontSize: '11.5px',
              cursor: 'pointer',
            }}
          >
            ✈️ Embarked Squadrons & Loadouts ({embarkedSquadrons.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('strike')}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: activeTab === 'strike' ? 'rgba(255, 82, 82, 0.12)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'strike' ? '2px solid #FF5252' : '2px solid transparent',
              color: activeTab === 'strike' ? '#FF5252' : 'var(--paper-dim)',
              fontWeight: 600,
              fontSize: '11.5px',
              cursor: 'pointer',
            }}
          >
            🚀 Launch Carrier Air Strike
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('escorts')}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: activeTab === 'escorts' ? 'rgba(79, 195, 247, 0.12)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'escorts' ? '2px solid #4FC3F7' : '2px solid transparent',
              color: activeTab === 'escorts' ? '#4FC3F7' : 'var(--paper-dim)',
              fontWeight: 600,
              fontSize: '11.5px',
              cursor: 'pointer',
            }}
          >
            🛡️ CSG Layered Escort Screen ({csgScreen.airDefenseEscorts.length + csgScreen.aswEscorts.length})
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* TAB 1: SQUADRONS & LOADOUTS */}
          {activeTab === 'squadrons' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '16px' }}>
              {/* Left Column: Squadron List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Stationed Air Wing Complement:
                </span>

                {embarkedSquadrons.length === 0 && (
                  <div
                    style={{
                      padding: '24px',
                      textAlign: 'center',
                      color: 'var(--paper-dim)',
                      fontSize: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: '6px',
                    }}
                  >
                    No aircraft currently stationed on this carrier. Deploy carrier-capable fighters (F-35C, F/A-18, E-2D, Rafale-M) to this carrier.
                  </div>
                )}

                {embarkedSquadrons.map((sq) => {
                  const isSelected = sq.id === selectedSquadron?.id;
                  return (
                    <div
                      key={sq.id}
                      onClick={() => setSelectedSquadronId(sq.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        background: isSelected ? 'rgba(0, 229, 255, 0.12)' : '#0F1A2A',
                        border: `1px solid ${isSelected ? '#00E5FF' : 'var(--border)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '12px', color: isSelected ? '#00E5FF' : '#FFFFFF' }}>
                          {sq.name}
                        </strong>
                        <span
                          style={{
                            fontSize: '9.5px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: sq.status === 'docked' ? 'rgba(79, 168, 95, 0.2)' : 'rgba(255, 176, 32, 0.2)',
                            color: sq.status === 'docked' ? '#4FA85F' : '#FFB020',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          {sq.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                        <span>Fuel: <strong style={{ color: sq.currentFuelPct < 25 ? '#D9534F' : '#4FA85F' }}>{sq.currentFuelPct.toFixed(0)}%</strong></span>
                        <span>Weapons: <strong>{(sq.customWeapons || []).length} Types</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Selected Squadron Loadout Customizer */}
              {selectedSquadron ? (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '6px',
                    background: '#0F1A2A',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '13.5px', color: '#FFFFFF' }}>{selectedSquadron.name}</h3>
                      <span style={{ fontSize: '10.5px', color: '#00E5FF' }}>Ready on Flight Deck</span>
                    </div>
                  </div>

                  {/* Current Armament */}
                  <div>
                    <span style={{ fontSize: '10.5px', color: 'var(--paper-dim)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Current Pylon Weapons:
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      {(selectedSquadron.customWeapons || []).map((w, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '6px 8px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '4px',
                            fontSize: '11px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span>{w.name}</span>
                          <span style={{ color: '#4FC3F7', fontSize: '10px' }}>
                            {w.rangeKm} km · {w.speedMach ? `Mach ${w.speedMach}` : ''} · Pk {w.pk}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Re-arm Loadout Presets */}
                  <div>
                    <span style={{ fontSize: '10.5px', color: '#00E5FF', fontWeight: 700, textTransform: 'uppercase' }}>
                      🛠️ Swap Weapon Loadout Preset:
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px', marginTop: '6px' }}>
                      {Object.values(CARRIER_LOADOUT_PRESETS).map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="wg-btn"
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            fontSize: '11px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                          onClick={() => onRearmSquadron?.(selectedSquadron.id, preset.id)}
                        >
                          <div>
                            <strong style={{ color: '#FFFFFF' }}>{preset.name}</strong>
                            <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>{preset.description}</div>
                          </div>
                          <span style={{ color: '#00E5FF', fontSize: '10px' }}>ARM ➔</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scramble Sortie Button */}
                  {onStartSortie && (
                    <button
                      type="button"
                      className="wg-btn"
                      style={{
                        marginTop: 'auto',
                        padding: '8px',
                        background: 'rgba(79, 168, 95, 0.2)',
                        borderColor: '#4FA85F',
                        color: '#4FA85F',
                        fontWeight: 700,
                        fontSize: '11.5px',
                      }}
                      onClick={() => {
                        onClose();
                        onStartSortie(selectedSquadron);
                      }}
                    >
                      🚀 Catapult Scramble CAP Patrol
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--paper-dim)', fontSize: '12px' }}>
                  Select a squadron to manage loadouts
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LAUNCH STRIKE MISSION */}
          {activeTab === 'strike' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: 'rgba(255, 82, 82, 0.08)',
                  border: '1px solid rgba(255, 82, 82, 0.3)',
                  fontSize: '11px',
                  color: 'var(--paper-dim)',
                }}
              >
                Launch an offensive carrier strike package against any hostile radar, airbase, naval surface combatant, or SAM battery within 1,100 km of the carrier.
              </div>

              {/* Step 1: Select Attacking Squadron */}
              <div>
                <label style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                  1. Launching Squadron:
                </label>
                <select
                  value={selectedSquadronId}
                  onChange={(e) => setSelectedSquadronId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: '#0F1A2A',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    color: '#FFFFFF',
                    fontSize: '11px',
                  }}
                >
                  {embarkedSquadrons.map((sq) => (
                    <option key={sq.id} value={sq.id}>
                      {sq.name} ({sq.customWeapons?.[0]?.name || 'Standard Ordnance'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Target Selection */}
              <div>
                <label style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                  2. Select Hostile Target:
                </label>
                <select
                  value={strikeTargetId}
                  onChange={(e) => setStrikeTargetId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: '#0F1A2A',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    color: '#FFFFFF',
                    fontSize: '11px',
                  }}
                >
                  <option value="">-- Choose Target --</option>
                  {enemyTargets.map((tgt) => {
                    const dist = distanceKm(carrier.lngLat, tgt.lngLat);
                    return (
                      <option key={tgt.id} value={tgt.id}>
                        {tgt.name} ({tgt.iso.toUpperCase()}) · {dist.toFixed(0)} km away
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Step 3: Salvo Size */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    3. Salvo Commitment:
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[1, 2, 4, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="wg-btn"
                        style={{
                          flex: 1,
                          padding: '6px',
                          background: salvoCount === n ? 'rgba(0, 229, 255, 0.2)' : undefined,
                          borderColor: salvoCount === n ? '#00E5FF' : undefined,
                          color: salvoCount === n ? '#00E5FF' : undefined,
                          fontWeight: salvoCount === n ? 700 : 400,
                        }}
                        onClick={() => setSalvoCount(n)}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    Selected Weapon:
                  </label>
                  <div style={{ padding: '6px 10px', background: '#0F1A2A', borderRadius: '4px', fontSize: '11px', color: '#00E5FF' }}>
                    {selectedSquadron?.customWeapons?.[0]?.name || 'Standard Standoff Munition'}
                  </div>
                </div>
              </div>

              {/* Launch Strike Button */}
              <button
                type="button"
                className="wg-btn"
                disabled={!strikeTargetId}
                style={{
                  marginTop: '8px',
                  padding: '10px',
                  background: strikeTargetId ? 'rgba(255, 82, 82, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  borderColor: strikeTargetId ? '#FF5252' : 'var(--border)',
                  color: strikeTargetId ? '#FF5252' : 'var(--paper-dim)',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  cursor: strikeTargetId ? 'pointer' : 'not-allowed',
                }}
                onClick={handleLaunchStrike}
              >
                🚀 CATAPULT LAUNCH STRIKE PACKAGE
              </button>
            </div>
          )}

          {/* TAB 3: CSG ESCORT SCREEN */}
          {activeTab === 'escorts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    background: 'rgba(79, 195, 247, 0.08)',
                    border: '1px solid rgba(79, 195, 247, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                    Fleet Air Defense Umbrella (Area SAM):
                  </span>
                  <strong style={{ fontSize: '18px', color: '#4FC3F7' }}>
                    {csgScreen.compositeSamRangeKm} km
                  </strong>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                    SM-6 / Aster-30 / Long-Range CEC Network
                  </span>
                </div>

                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    background: 'rgba(0, 230, 118, 0.08)',
                    border: '1px solid rgba(0, 230, 118, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', textTransform: 'uppercase' }}>
                    Undersea ASW Torpedo Screen:
                  </span>
                  <strong style={{ fontSize: '18px', color: '#00E676' }}>
                    {csgScreen.compositeAswRangeKm} km
                  </strong>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                    Towed-Array & Dipping Sonar Frigate Screen
                  </span>
                </div>
              </div>

              <span style={{ fontSize: '11px', color: 'var(--paper-dim)', textTransform: 'uppercase', fontWeight: 700, marginTop: '6px' }}>
                Active Screen Escorts ({csgScreen.airDefenseEscorts.length + csgScreen.aswEscorts.length}):
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[...csgScreen.airDefenseEscorts, ...csgScreen.aswEscorts].map((escort) => {
                  const dist = distanceKm(carrier.lngLat, escort.lngLat);
                  return (
                    <div
                      key={escort.id}
                      style={{
                        padding: '8px 10px',
                        background: '#0F1A2A',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '11px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong style={{ color: '#FFFFFF' }}>{escort.name}</strong>
                        <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                          {escort.typeId.toUpperCase()} · {dist.toFixed(1)} km from CVN
                        </div>
                      </div>
                      <span style={{ fontSize: '10px', color: '#4FC3F7', fontWeight: 700 }}>
                        ON SCREEN ✓
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
