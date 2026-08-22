'use client';

/**
 * Pre-Mission Sortie Tasking & Weapon Loadout Configurator Modal
 *
 * Appears prior to dispatching an aircraft flight, naval strike group, or ground battalion.
 * Provides:
 * 1. Quantity Detachment Selector (e.g. 2 out of 36 fighters).
 * 2. Compatible Munitions Catalogue & Weapon Swapping (CAP, Strike, Anti-Ship, Munition Search, Hardpoints).
 * 3. Flight Profile (Altitude, Sovereign Holding Pattern / Orbit Radius, Active Radar vs. EMCON Silent).
 * 4. Geodesic Map Waypoint Dispatch.
 */

import React, { useState, useMemo } from 'react';
import { type SimEntity, type SimBase, type WarSimSession } from '@/lib/warSimTypes';
import { type SystemSpec, type WeaponFacet, describeTargets, domainOf } from '@/lib/specs';
import { isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';
import { getSimUnitIcon } from '@/lib/warSimLayers';
import { buildMunitions, compatibleMunitions, type Munition } from '@/lib/munitions';

export interface SortieTaskingModalProps {
  entity: SimEntity;
  initialCount?: number;
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
    routeType: 'orbit' | 'waypoints';
  }) => void;
}

export function SortieTaskingModal({
  entity,
  initialCount,
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
  const isStaticAD = isStaticAirDefense(entity.typeId);
  const isDeployed = entity.status !== 'docked';

  const platformDomain = useMemo(() => {
    if (spec) return domainOf(spec);
    if (isGround || isStaticAD) return 'ground';
    const tid = (entity.typeId || '').toLowerCase();
    if (['destroyer', 'frigate', 'corvette', 'cruiser', 'carrier-ship', 'carrier', 'warship'].includes(tid)) return 'sea';
    if (['submarine', 'ssbn', 'ssn'].includes(tid)) return 'sub';
    return 'air';
  }, [spec, isGround, isStaticAD, entity.typeId]);

  // 1. Quantity allocation
  const [count, setCount] = useState<number>(() => {
    if (initialCount && initialCount > 0) {
      return Math.max(1, Math.min(entity.count, initialCount));
    }
    return Math.min(2, entity.count);
  });

  // 2. Munitions Catalogue & Compatible Systems
  const catalogue = useMemo(() => buildMunitions(systemsLibrary), [systemsLibrary]);
  const compatible = useMemo(() => compatibleMunitions(catalogue, spec), [catalogue, spec]);

  // Standard weapons from spec
  const standardWeapons: WeaponFacet[] = useMemo(() => spec?.weapons || [], [spec]);

  // Currently equipped weapon loadout
  const [equippedWeapons, setEquippedWeapons] = useState<WeaponFacet[]>(() => {
    return entity.customWeapons && entity.customWeapons.length > 0
      ? [...entity.customWeapons]
      : [...standardWeapons];
  });

  const [searchQuery, setSearchQuery] = useState('');

  // 3. Operational Patrol Profile
  const [patrolMode, setPatrolMode] = useState<'orbit' | 'waypoints'>('orbit');
  const [altitudeM, setAltitudeM] = useState<number>(() => {
    if (platformDomain === 'air') return 7000;
    if (platformDomain === 'sub') return -100;
    return 0; // 0m for surface ships and ground units
  });
  const [patrolRadiusKm, setPatrolRadiusKm] = useState<number>(() => {
    if (platformDomain === 'ground' || isStaticAD) return 0;
    return 15;
  });
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

  // Filter compatible munitions by search query
  const filteredCompatible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return compatible;
    return compatible.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.weapon.engages && m.weapon.engages.some((e) => e.toLowerCase().includes(q)))
    );
  }, [compatible, searchQuery]);

  // Loadout Action Handlers
  const handleRestoreStandard = () => {
    setEquippedWeapons([...standardWeapons]);
  };

  const handleToggleMunition = (munition: Munition) => {
    const existingIndex = equippedWeapons.findIndex(
      (w) => (w.name || '').toLowerCase() === munition.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Remove munition
      setEquippedWeapons((prev) => prev.filter((_, idx) => idx !== existingIndex));
    } else {
      // Add munition
      const newWeapon: WeaponFacet = {
        ...munition.weapon,
        name: munition.name,
        magazine: munition.weapon.magazine ?? 2,
      };
      setEquippedWeapons((prev) => [...prev, newWeapon]);
    }
  };

  const handleRemoveWeapon = (index: number) => {
    setEquippedWeapons((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAdjustMagazine = (index: number, delta: number) => {
    setEquippedWeapons((prev) =>
      prev.map((w, idx) => {
        if (idx !== index) return w;
        const currentMag = w.magazine ?? 2;
        const nextMag = Math.max(1, currentMag + delta);
        return { ...w, magazine: nextMag };
      })
    );
  };

  // Preset Role Applicators
  const applyPreset = (preset: 'cap' | 'strike' | 'antiship') => {
    const matching = compatible.filter((m) => {
      const engages = m.weapon.engages || [];
      if (preset === 'cap') return engages.includes('air');
      if (preset === 'strike') return engages.includes('ground') || engages.includes('surface');
      if (preset === 'antiship') return engages.includes('surface') || engages.includes('subsurface');
      return false;
    });

    if (matching.length > 0) {
      // Pick top 2-3 most capable munitions for this mission role
      const selected = matching.slice(0, 3).map((m) => ({
        ...m.weapon,
        name: m.name,
        magazine: m.weapon.magazine ?? 2,
      }));
      setEquippedWeapons(selected);
    }
  };

  const isEquipped = (munName: string) => {
    return equippedWeapons.some((w) => (w.name || '').toLowerCase() === munName.toLowerCase());
  };

  const isStandard = (munName: string) => {
    return standardWeapons.some((w) => (w.name || '').toLowerCase() === munName.toLowerCase());
  };

  const totalRoundsCount = equippedWeapons.reduce((sum, w) => sum + (w.magazine ?? 1), 0);

  const handleConfirm = () => {
    onConfirmTasking({
      count,
      customWeapons: equippedWeapons,
      patrolRadiusKm: isGround || isStaticAD || patrolMode === 'waypoints' ? 0 : patrolRadiusKm,
      altitudeM: isGround || isStaticAD ? 0 : altitudeM,
      emcon,
      routeType: patrolMode,
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '640px',
          maxWidth: '96vw',
          maxHeight: '92vh',
          backgroundColor: '#09101B',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.95)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(79, 195, 247, 0.07)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>{getSimUnitIcon(entity.typeId)}</span>
            <div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#4FC3F7',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  fontWeight: 600,
                }}
              >
                Pre-Mission Tasking & Loadout Configurator
              </div>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#FFFFFF', fontWeight: 700 }}>
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
        <div
          className="wg-custom-scroll"
          style={{
            padding: '18px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(79, 195, 247, 0.25) rgba(0, 0, 0, 0.2)',
          }}
        >
          {/* Base Origin & Ready Inventory Info */}
          <div
            style={{
              background: '#070C14',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '10px 14px',
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
              <span style={{ color: 'var(--paper-dim)' }}>Total Available: </span>
              <strong style={{ color: '#4FA85F' }}>{entity.count} Units</strong>
            </div>
          </div>

          {/* 1. Formation Quantity Detachment */}
          <div>
            <label
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                color: 'var(--paper-dim)',
                fontWeight: 700,
                display: 'block',
                marginBottom: '6px',
              }}
            >
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
                  padding: '3px 8px',
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
                <span
                  style={{
                    fontSize: '15px',
                    fontWeight: 800,
                    color: '#FFFFFF',
                    minWidth: '32px',
                    textAlign: 'center',
                  }}
                >
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
                Detaching <strong style={{ color: '#FFFFFF' }}>{count}</strong> of {entity.count} units (
                {entity.count - count} will remain stationed on base standby).
              </div>
            </div>
          </div>

          {/* 2. Weapon Loadout Customization & Compatible Munitions */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <label
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  color: 'var(--paper-dim)',
                  fontWeight: 700,
                }}
              >
                2. Armament & Weapon Loadout ({equippedWeapons.length} Systems · {totalRoundsCount} Rounds)
              </label>

              {isDeployed ? (
                <span
                  style={{
                    fontSize: '9.5px',
                    color: '#4FC3F7',
                    background: 'rgba(79, 195, 247, 0.1)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid rgba(79, 195, 247, 0.25)',
                    fontWeight: 600,
                  }}
                >
                  🔒 Deployed (Fixed Loadout)
                </span>
              ) : (
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ fontSize: '9.5px', padding: '3px 8px' }}
                    onClick={handleRestoreStandard}
                  >
                    Standard Fit
                  </button>
                  {platformDomain === 'sea' ? (
                    <>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('cap')}
                      >
                        Air Defense
                      </button>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('antiship')}
                      >
                        Anti-Ship
                      </button>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('strike')}
                      >
                        Land Attack
                      </button>
                    </>
                  ) : platformDomain === 'sub' ? (
                    <>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('antiship')}
                      >
                        Anti-Ship / ASW
                      </button>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('strike')}
                      >
                        Land Attack
                      </button>
                    </>
                  ) : platformDomain === 'ground' || isGround || isStaticAD ? (
                    <>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('cap')}
                      >
                        Air Defense
                      </button>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('strike')}
                      >
                        Ground Strike
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('cap')}
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
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '9.5px', padding: '3px 8px' }}
                        onClick={() => applyPreset('antiship')}
                      >
                        Anti-Ship
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Currently Equipped Weapons on Platform */}
            <div
              style={{
                background: '#070C14',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginBottom: isDeployed ? '0' : '10px',
              }}
            >
              {equippedWeapons.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--paper-dim)', padding: '6px', textAlign: 'center' }}>
                  Clean — carrying no weapons. Select compatible munitions below to equip.
                </div>
              ) : (
                equippedWeapons.map((weapon, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '4px',
                      padding: '6px 10px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF' }}>
                        {weapon.name || `Weapon #${idx + 1}`}
                      </div>
                      <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                        <span style={{ color: '#FF9800', fontWeight: 600 }}>{weapon.rangeKm} km</span>
                        {weapon.engages && (
                          <span> · vs {describeTargets(weapon.engages)}</span>
                        )}
                        {weapon.speedMach && <span> · Mach {weapon.speedMach}</span>}
                      </div>
                    </div>

                    {isDeployed ? (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#4FC3F7',
                          background: 'rgba(79, 195, 247, 0.08)',
                          padding: '3px 9px',
                          borderRadius: '4px',
                          border: '1px solid rgba(79, 195, 247, 0.2)',
                        }}
                      >
                        {weapon.magazine ?? 2} Ready Rounds
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: '#09101B',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            padding: '1px 4px',
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#4FC3F7',
                              cursor: 'pointer',
                              padding: '1px 6px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                            }}
                            onClick={() => handleAdjustMagazine(idx, -1)}
                          >
                            −
                          </button>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: '#FFFFFF',
                              minWidth: '22px',
                              textAlign: 'center',
                            }}
                          >
                            {weapon.magazine ?? 2}
                          </span>
                          <button
                            type="button"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#4FC3F7',
                              cursor: 'pointer',
                              padding: '1px 6px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                            }}
                            onClick={() => handleAdjustMagazine(idx, 1)}
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#D9534F',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '2px 6px',
                          }}
                          onClick={() => handleRemoveWeapon(idx)}
                          title="Remove munition"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {isDeployed ? (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--paper-dim)',
                  background: 'rgba(79, 195, 247, 0.04)',
                  border: '1px dashed rgba(79, 195, 247, 0.25)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '6px',
                }}
              >
                <span>🔒</span>
                <span>Weapon loadout is locked while deployed in the field. To reload or change weapon configuration, order RTB to base.</span>
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  className="wg-input"
                  style={{
                    width: '100%',
                    fontSize: '11px',
                    padding: '6px 10px',
                    marginBottom: '8px',
                    background: '#070C14',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    color: '#FFFFFF',
                  }}
                  placeholder={`Search ${compatible.length} compatible munitions…`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                <div
                  className="wg-custom-scroll"
                  style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    background: '#070C14',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '6px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '5px',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(79, 195, 247, 0.25) rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {filteredCompatible.length === 0 ? (
                    <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', padding: '10px', gridColumn: '1 / -1', textAlign: 'center' }}>
                      No matching compatible munitions found.
                    </div>
                  ) : (
                    filteredCompatible.map((m) => {
                      const equipped = isEquipped(m.name);
                      const standard = isStandard(m.name);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleToggleMunition(m)}
                          style={{
                            background: equipped ? 'rgba(79, 168, 95, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                            border: `1px solid ${equipped ? '#4FA85F' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '4px',
                            padding: '6px 8px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '2px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: equipped ? '#FFFFFF' : 'var(--paper-dim)' }}>
                              {m.name}
                          </span>
                          {standard && (
                            <span
                              style={{
                                fontSize: '8px',
                                textTransform: 'uppercase',
                                color: '#4FC3F7',
                                background: 'rgba(79, 195, 247, 0.12)',
                                padding: '1px 3px',
                                borderRadius: '2px',
                              }}
                            >
                              Standard
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                          <span style={{ color: '#FF9800' }}>{m.weapon.rangeKm} km</span>
                          {m.weapon.engages && (
                            <span>{m.weapon.engages[0]}</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

          {/* 3. Domain-Specific Patrol & Sensor Profile */}
          <div>
            <label
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                color: 'var(--paper-dim)',
                fontWeight: 700,
                display: 'block',
                marginBottom: '6px',
              }}
            >
              {platformDomain === 'sea'
                ? '3. Naval Surface Patrol & Radar Profile'
                : platformDomain === 'sub'
                  ? '3. Subsurface Patrol & Acoustic Profile'
                  : platformDomain === 'ground' || isGround || isStaticAD
                    ? '3. Ground Deployment & Radar Profile'
                    : '3. Flight & Sensor Profile'}
            </label>

            {/* Patrol Pattern Selector */}
            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                {platformDomain === 'sea'
                  ? 'Naval Patrol Pattern:'
                  : platformDomain === 'sub'
                    ? 'Subsurface Patrol Pattern:'
                    : platformDomain === 'ground' || isGround || isStaticAD
                      ? 'Deployment Area Pattern:'
                      : 'Patrol Route Pattern:'}
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  style={{
                    padding: '7px 10px',
                    borderRadius: '5px',
                    border: `1px solid ${patrolMode === 'orbit' ? '#4FC3F7' : 'var(--border)'}`,
                    background: patrolMode === 'orbit' ? 'rgba(79, 195, 247, 0.15)' : '#070C14',
                    color: patrolMode === 'orbit' ? '#4FC3F7' : 'var(--paper)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={() => setPatrolMode('orbit')}
                >
                  <span>🔄</span>
                  <span>
                    {platformDomain === 'sea'
                      ? 'Station Keeping / Patrol Orbit'
                      : platformDomain === 'sub'
                        ? 'Submerged Patrol Orbit'
                        : platformDomain === 'ground' || isGround || isStaticAD
                          ? 'Area Deployment Sector'
                          : 'Circular Holding Orbit'}
                  </span>
                </button>

                <button
                  type="button"
                  style={{
                    padding: '7px 10px',
                    borderRadius: '5px',
                    border: `1px solid ${patrolMode === 'waypoints' ? '#4FC3F7' : 'var(--border)'}`,
                    background: patrolMode === 'waypoints' ? 'rgba(79, 195, 247, 0.15)' : '#070C14',
                    color: patrolMode === 'waypoints' ? '#4FC3F7' : 'var(--paper)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={() => setPatrolMode('waypoints')}
                >
                  <span>🗺️</span>
                  <span>Custom Multi-Waypoint Route</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: patrolMode === 'orbit' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '10px' }}>
              {/* Domain Altitude / Depth / Elevation */}
              <div>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                  {platformDomain === 'sea'
                    ? 'Surface Operating State:'
                    : platformDomain === 'sub'
                      ? 'Submerged Depth:'
                      : platformDomain === 'ground' || isGround || isStaticAD
                        ? 'Terrain Elevation:'
                        : 'Cruise Altitude:'}
                </span>

                {platformDomain === 'sea' ? (
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={altitudeM}
                    onChange={(e) => setAltitudeM(Number(e.target.value))}
                  >
                    <option value={0}>Surface / Sea Level (0 m)</option>
                  </select>
                ) : platformDomain === 'sub' ? (
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={altitudeM}
                    onChange={(e) => setAltitudeM(Number(e.target.value))}
                  >
                    <option value={-10}>Periscope Depth (-10 m)</option>
                    <option value={-100}>Cruising Patrol Depth (-100 m)</option>
                    <option value={-250}>Deep Silent Running (-250 m)</option>
                  </select>
                ) : platformDomain === 'ground' || isGround || isStaticAD ? (
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={altitudeM}
                    onChange={(e) => setAltitudeM(Number(e.target.value))}
                  >
                    <option value={0}>Ground Surface (0 m)</option>
                  </select>
                ) : (
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
                )}
              </div>

              {/* Patrol Radius (Only for circular orbit) */}
              {patrolMode === 'orbit' && (
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    {platformDomain === 'sea'
                      ? 'Patrol Sweep Radius:'
                      : platformDomain === 'sub'
                        ? 'Acoustic Patrol Radius:'
                        : platformDomain === 'ground' || isGround || isStaticAD
                          ? 'Deployment Radius:'
                          : 'Patrol Orbit Radius:'}
                  </span>
                  <select
                    className="wg-select"
                    style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                    value={patrolRadiusKm}
                    onChange={(e) => setPatrolRadiusKm(Number(e.target.value))}
                  >
                    {platformDomain === 'sea' ? (
                      <>
                        <option value={0}>Stationary Picket (0 km)</option>
                        <option value={15}>Sector Patrol (15 km)</option>
                        <option value={30}>Task Group Sweep (30 km)</option>
                        <option value={60}>Wide Maritime Patrol (60 km)</option>
                      </>
                    ) : platformDomain === 'sub' ? (
                      <>
                        <option value={0}>Stationary Ambush (0 km)</option>
                        <option value={15}>ASW Box Patrol (15 km)</option>
                        <option value={30}>Acoustic Search Barrier (30 km)</option>
                      </>
                    ) : platformDomain === 'ground' || isGround || isStaticAD ? (
                      <>
                        <option value={0}>Stationary Emplacement (0 km)</option>
                        <option value={5}>Tactical Dispersal (5 km)</option>
                        <option value={15}>Sector Screening (15 km)</option>
                      </>
                    ) : (
                      <>
                        <option value={0}>Stationary Loiter (0 km)</option>
                        <option value={15}>Tight Holding Pattern (15 km)</option>
                        <option value={30}>Tactical Orbit (30 km)</option>
                        <option value={60}>Wide Area Sweep (60 km)</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* EMCON */}
              <div>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                  {platformDomain === 'sub'
                    ? 'Acoustic Sonar EMCON:'
                    : platformDomain === 'sea'
                      ? 'Sensors & Radar EMCON:'
                      : 'Radar EMCON:'}
                </span>
                <select
                  className="wg-select"
                  style={{ width: '100%', fontSize: '11px', padding: '6px' }}
                  value={emcon}
                  onChange={(e) => setEmcon(e.target.value as 'active' | 'passive')}
                >
                  {platformDomain === 'sub' ? (
                    <>
                      <option value="passive">Passive Sonar (Silent Running 🤫)</option>
                      <option value="active">Active Sonar Ping (Sonar Search 🔊)</option>
                    </>
                  ) : platformDomain === 'sea' ? (
                    <>
                      <option value="active">Active Radar & Sonar 📡</option>
                      <option value="passive">EMCON Alpha (Radar Silence 🤫)</option>
                    </>
                  ) : platformDomain === 'ground' || isGround || isStaticAD ? (
                    <>
                      <option value="active">Active Search Radar 📡</option>
                      <option value="passive">Passive Optical / Camouflage 🌲</option>
                    </>
                  ) : (
                    <>
                      <option value="active">Active Radar 📡</option>
                      <option value="passive">Passive / Silent 🔕</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Waypoint Guidance notice */}
            {patrolMode === 'waypoints' && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  background: 'rgba(79, 195, 247, 0.08)',
                  borderRadius: '5px',
                  border: '1px solid rgba(79, 195, 247, 0.25)',
                  fontSize: '10.5px',
                  color: '#4FC3F7',
                  lineHeight: '1.4',
                }}
              >
                📍 <strong>Interactive Route Planning</strong>:{' '}
                {platformDomain === 'sea'
                  ? 'After clicking below, click sequentially on the map to define maritime waypoints (WP-1, WP-2...). The warship will cruise along this route.'
                  : platformDomain === 'sub'
                    ? 'After clicking below, click sequentially on the map to define submerged waypoints. The submarine will patrol this track.'
                    : platformDomain === 'ground' || isGround || isStaticAD
                      ? 'After clicking below, click sequentially on the map to define ground march waypoints. The unit will advance along this route.'
                      : 'After clicking below, click sequentially on the map to define flight waypoints (WP-1, WP-2, WP-3...). The aircraft will patrol this corridor back and forth.'}
              </div>
            )}
          </div>

          {/* Operational Range Summary */}
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
            }}
          >
            <span>
              {platformDomain === 'sea'
                ? 'Naval Operating Range: '
                : platformDomain === 'sub'
                  ? 'Submerged Operating Range: '
                  : isStaticAD
                    ? 'Deployment Reach: '
                    : isGround
                      ? 'Road Range: '
                      : 'Effective Combat Radius: '}
              <strong style={{ color: '#4FC3F7' }}>{effectiveRadiusKm.toFixed(0)} km</strong>
              {hasTanker && platformDomain === 'air' ? ' (w/ Tanker +75%)' : ''}
            </span>
            <span>
              {isStaticAD ? (
                <>
                  Site Posture: <strong style={{ color: '#4FA85F' }}>Entrenched Battery</strong>
                </>
              ) : platformDomain === 'sea' || platformDomain === 'sub' ? (
                <>
                  Cruise Speed:{' '}
                  <strong>
                    {entity.speedKmh} km/h ({(entity.speedKmh * 0.539957).toFixed(0)} kts)
                  </strong>
                </>
              ) : (
                <>
                  Cruise Speed: <strong>{entity.speedKmh} km/h</strong>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 20px',
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
            onClick={handleConfirm}
          >
            🌐 {isStaticAD ? 'Emplace Battery on Map' : isGround ? 'Designate Ground Position' : patrolMode === 'waypoints' ? 'Plot Custom Route on Map' : 'Designate Patrol Point on Map'} ({count} Units)
          </button>
        </div>
      </div>
    </div>
  );
}
