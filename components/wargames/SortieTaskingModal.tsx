'use client';

/**
 * Pre-Mission Sortie Tasking & Weapon Loadout Configurator Modal
 *
 * Appears prior to dispatching an aircraft flight, naval strike group, or ground battalion.
 * Provides:
 * 1. Quantity Detachment Selector (e.g. 2 out of 36 fighters).
 * 2. Weapon Loadout Customization & Preset Selection (CAP, Strike, Anti-Ship, All).
 * 3. Flight Profile (Altitude, Patrol Orbit Radius, Active Radar vs. EMCON Silent).
 * 4. Geodesic Map Waypoint Dispatch.
 */

import React, { useState, useMemo } from 'react';
import { type SimEntity, type SimBase, type WarSimSession } from '@/lib/warSimTypes';
import { type SystemSpec, type WeaponFacet } from '@/lib/specs';
import { isGroundCombatUnit } from '@/lib/warSimRules';
import { getSimUnitIcon } from '@/lib/warSimLayers';

export interface SortieTaskingModalProps {
  entity: SimEntity;
  base?: SimBase;
  session: WarSimSession;
  systemsLibrary: SystemSpec[];
  onClose: () => void;
  onConfirmTasking: (params: {
    count: number;
    customWeapons: WeaponFacet[];
    patrolRadiusKm: number;
    altitudeM: number;
    emcon: 'active' | 'passive';
  }) => void;
}

export function SortieTaskingModal({
  entity,
  base,
  session,
  systemsLibrary,
  onClose,
  onConfirmTasking,
}: SortieTaskingModalProps) {
  const spec = useMemo(
    () => systemsLibrary.find((s) => s.id === entity.systemId),
    [systemsLibrary, entity.systemId]
  );

  const isGround = isGroundCombatUnit(entity.typeId);

  // 1. Quantity allocation
  const [count, setCount] = useState<number>(Math.min(2, entity.count));

  // 2. Weapon loadout state (list of equipped weapons from spec)
  const defaultWeapons: WeaponFacet[] = useMemo(() => {
    return entity.customWeapons && entity.customWeapons.length > 0
      ? entity.customWeapons
      : spec?.weapons || [];
  }, [entity.customWeapons, spec?.weapons]);

  const [selectedWeaponIndices, setSelectedWeaponIndices] = useState<number[]>(() => {
    return defaultWeapons.map((_, idx) => idx);
  });

  // 3. Operational Profile
  const [altitudeM, setAltitudeM] = useState<number>(isGround ? 0 : 7000);
  const [patrolRadiusKm, setPatrolRadiusKm] = useState<number>(isGround ? 0 : 15);
  const [emcon, setEmcon] = useState<'active' | 'passive'>('active');

  const cleanName = entity.name.replace(/^\d+\s*[×x]\s*/i, '');
  const combatRadiusKm = spec?.platform?.combatRadiusKm ?? (entity.typeId === 'fighter' ? 900 : 1500);

  // Check tanker coverage
  const hasTanker = session.entities.some(
    (e) => e.iso === entity.iso && e.status === 'on_station' && e.typeId === 'tanker'
  );
  const effectiveRadiusKm = isGround
    ? (spec?.platform?.combatRadiusKm ? spec.platform.combatRadiusKm * 2 : 550)
    : hasTanker
      ? combatRadiusKm * 1.75
      : combatRadiusKm;

  // Preset Loadout Applicators
  const applyPreset = (preset: 'all' | 'air' | 'strike') => {
    if (preset === 'all') {
      setSelectedWeaponIndices(defaultWeapons.map((_, i) => i));
      return;
    }

    const filtered = defaultWeapons
      .map((w, idx) => {
        const engages = w.engages || [];
        if (preset === 'air' && engages.includes('air')) return idx;
        if (preset === 'strike' && (engages.includes('ground') || engages.includes('surface'))) return idx;
        return -1;
      })
      .filter((idx) => idx !== -1);

    if (filtered.length > 0) {
      setSelectedWeaponIndices(filtered);
    } else {
      setSelectedWeaponIndices(defaultWeapons.map((_, i) => i));
    }
  };

  const handleLaunch = () => {
    const activeWeapons = defaultWeapons.filter((_, idx) => selectedWeaponIndices.includes(idx));
    onConfirmTasking({
      count,
      customWeapons: activeWeapons,
      patrolRadiusKm: isGround ? 0 : patrolRadiusKm,
      altitudeM: isGround ? 0 : altitudeM,
      emcon,
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(10px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          backgroundColor: '#09101B',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(79, 195, 247, 0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>{getSimUnitIcon(entity.typeId)}</span>
            <div>
              <div style={{ fontSize: '11px', color: '#4FC3F7', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
                Pre-Mission Tasking & Loadout Configurator
              </div>
              <h2 style={{ margin: 0, fontSize: '17px', color: '#FFFFFF', fontWeight: 700 }}>
                {cleanName}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-dim)',
              cursor: 'pointer',
              fontSize: '20px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Base Origin & Ready Count */}
          <div
            style={{
              background: '#070C14',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
            }}
          >
            <div>
              <span style={{ color: 'var(--paper-dim)' }}>Stationed Base: </span>
              <strong style={{ color: '#FFFFFF' }}>{base?.name || 'Field Station'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--paper-dim)' }}>Total Ready: </span>
              <strong style={{ color: '#4FA85F' }}>{entity.count} Units</strong>
            </div>
          </div>

          {/* Section 1: Quantity to Task */}
          <div>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--paper-dim)', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
              1. Task Formation Quantity
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#070C14',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4FC3F7',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    padding: '2px 8px',
                  }}
                  onClick={() => setCount((prev) => Math.max(1, prev - 1))}
                >
                  −
                </button>
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', minWidth: '32px', textAlign: 'center' }}>
                  {count}
                </span>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4FC3F7',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    padding: '2px 8px',
                  }}
                  onClick={() => setCount((prev) => Math.min(entity.count, prev + 1))}
                >
                  +
                </button>
              </div>

              <div style={{ fontSize: '11.5px', color: 'var(--paper-dim)' }}>
                Deploying <strong style={{ color: '#FFFFFF' }}>{count}</strong> of {entity.count} available (
                {entity.count - count} will remain on standby at base).
              </div>
            </div>
          </div>

          {/* Section 2: Weapon Loadout Customization */}
          {defaultWeapons.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--paper-dim)', fontWeight: 700 }}>
                  2. Weapon Loadout Customization
                </label>

                {/* Preset Loadout Buttons */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ fontSize: '9.5px', padding: '3px 8px' }}
                    onClick={() => applyPreset('all')}
                  >
                    All Weapons
                  </button>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ fontSize: '9.5px', padding: '3px 8px' }}
                    onClick={() => applyPreset('air')}
                  >
                    CAP / Air
                  </button>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ fontSize: '9.5px', padding: '3px 8px' }}
                    onClick={() => applyPreset('strike')}
                  >
                    Strike / Land
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {defaultWeapons.map((w, idx) => {
                  const isSelected = selectedWeaponIndices.includes(idx);
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedWeaponIndices((prev) =>
                          prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                        );
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${isSelected ? '#4FA85F' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(79, 168, 95, 0.08)' : '#070C14',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                        <div>
                          <strong style={{ fontSize: '12px', color: isSelected ? '#FFFFFF' : 'var(--paper-dim)' }}>
                            {w.name || `Weapon #${idx + 1}`}
                          </strong>
                          {w.engages && (
                            <div style={{ fontSize: '9px', color: 'var(--paper-dim)' }}>
                              Engages: {w.engages.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ fontSize: '12px', color: '#FF9800' }}>{w.rangeKm} km</strong>
                        {w.magazine && (
                          <div style={{ fontSize: '9px', color: 'var(--paper-dim)' }}>
                            Mag: {w.magazine} rounds
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 3: Flight Profile & EMCON (For Air & Naval) */}
          {!isGround && (
            <div>
              <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--paper-dim)', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                3. Flight & Sensor Profile
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {/* Altitude */}
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    Cruise Altitude:
                  </span>
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={altitudeM}
                    onChange={(e) => setAltitudeM(Number(e.target.value))}
                  >
                    <option value={500}>Low Level (500 m)</option>
                    <option value={4000}>Medium (4,000 m)</option>
                    <option value={7000}>High / Transit (7,000 m)</option>
                    <option value={10000}>Very High (10,000 m)</option>
                  </select>
                </div>

                {/* Patrol Radius */}
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    Patrol Orbit Radius:
                  </span>
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={patrolRadiusKm}
                    onChange={(e) => setPatrolRadiusKm(Number(e.target.value))}
                  >
                    <option value={0}>Stationary Loiter (0 km)</option>
                    <option value={15}>Tight Holding Pattern (15 km)</option>
                    <option value={30}>Tactical Orbit (30 km)</option>
                    <option value={60}>Wide Area Sweep (60 km)</option>
                  </select>
                </div>

                {/* EMCON */}
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    Radar EMCON:
                  </span>
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={emcon}
                    onChange={(e) => setEmcon(e.target.value as 'active' | 'passive')}
                  >
                    <option value="active">Active Radar 📡</option>
                    <option value="passive">Passive / Silent 🔕</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Operational Range Summary */}
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
            }}
          >
            <span>
              Effective {isGround ? 'Road Range' : 'Combat Radius'}:{' '}
              <strong style={{ color: '#4FC3F7' }}>{effectiveRadiusKm.toFixed(0)} km</strong>
              {hasTanker && !isGround ? ' (w/ Tanker +75%)' : ''}
            </span>
            <span>
              Cruise Speed: <strong>{entity.speedKmh} km/h</strong>
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          <button className="wg-btn" onClick={onClose}>
            Cancel
          </button>

          <button
            className="wg-btn accent"
            style={{
              background: '#4FA85F',
              color: '#070C14',
              borderColor: '#4FA85F',
              fontWeight: 700,
              fontSize: '12px',
              padding: '8px 20px',
            }}
            onClick={handleLaunch}
          >
            🌐 Designate Waypoint on Map ({count} Units)
          </button>
        </div>
      </div>
    </div>
  );
}
