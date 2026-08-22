'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type PostStrikeAction,
} from '@/lib/warSimTypes';
import { type SystemSpec, type WeaponFacet } from '@/lib/specs';
import { distanceKm } from '@/lib/geo';
import { canEntityEngageTarget, canWeaponEngageTarget, isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';
import { buildMunitions, compatibleMunitions, type Munition } from '@/lib/munitions';

export interface StrikeTargetInfo {
  targetId: string;
  name: string;
  count: number;
  domain: string;
  iso: string;
  lngLat: [number, number];
  intelTier: 1 | 2;
  damage?: string;
  speedKmh?: number;
  altitudeM?: number;
}

export interface StrikeTaskingModalProps {
  target: StrikeTargetInfo;
  session: WarSimSession;
  friendlyEntities: SimEntity[];
  friendlyBases: SimBase[];
  systemsLibrary: SystemSpec[];
  onClose: () => void;
  onLaunchStrike: (params: {
    attackerEntityId: string;
    targetEntityId: string;
    targetLngLat: [number, number];
    weaponIndex: number;
    salvoCount: number;
    postStrikeAction: PostStrikeAction;
    customPostLngLat?: [number, number];
    sortieCount?: number;
    customWeapons?: WeaponFacet[];
  }) => void;
}

export function StrikeTaskingModal({
  target,
  friendlyEntities,
  systemsLibrary,
  onClose,
  onLaunchStrike,
}: StrikeTaskingModalProps) {
  // 1. Attacker entity evaluation
  const evaluatedAttackers = useMemo(() => {
    return friendlyEntities.map((entity) => {
      const spec = systemsLibrary.find((s) => s.id === entity.systemId);
      const isGround = isGroundCombatUnit(entity.typeId);
      const isStaticAD = isStaticAirDefense(entity.typeId);

      const combatRadiusKm = spec?.platform?.combatRadiusKm ?? (entity.typeId === 'fighter' ? 900 : 1500);
      const effectiveRadiusKm = isGround
        ? (spec?.platform?.combatRadiusKm ? spec.platform.combatRadiusKm * 2 : 600)
        : combatRadiusKm;

      const distToTarget = distanceKm(entity.lngLat, target.lngLat);
      const isOutOfRange = distToTarget > effectiveRadiusKm && !isStaticAD;

      const engagementCheck = canEntityEngageTarget(entity, target.domain, spec);

      const weapons = (entity.customWeapons && entity.customWeapons.length > 0)
        ? entity.customWeapons
        : (spec?.weapons || []);

      const isEligible =
        engagementCheck.canEngage &&
        !isOutOfRange &&
        entity.status !== 'destroyed' &&
        entity.status !== 'in_repair' &&
        entity.status !== 'turnaround';

      return {
        entity,
        spec,
        isGround,
        isStaticAD,
        distToTarget,
        effectiveRadiusKm,
        isOutOfRange,
        engagementCheck,
        weapons,
        isEligible,
      };
    });
  }, [friendlyEntities, target, systemsLibrary]);

  // Default selected attacker: first eligible entity
  const [selectedAttackerId, setSelectedAttackerId] = useState<string>(() => {
    const firstEligible = evaluatedAttackers.find((a) => a.isEligible);
    return firstEligible?.entity.id || (evaluatedAttackers[0]?.entity.id ?? '');
  });

  const currentAttackerEval = evaluatedAttackers.find((a) => a.entity.id === selectedAttackerId);
  const isDockedAtBase = currentAttackerEval?.entity.status === 'docked';

  // 2. Sortie detachment count (for squadrons stationed at base)
  const [scrambleCount, setScrambleCount] = useState<number>(() => {
    return currentAttackerEval ? Math.min(2, currentAttackerEval.entity.count) : 1;
  });

  // 3. Munitions Catalogue & Compatible Systems
  const catalogue = useMemo(() => buildMunitions(systemsLibrary), [systemsLibrary]);
  const compatibleMunitionsList = useMemo(() => {
    if (!currentAttackerEval?.spec) return [];
    return compatibleMunitions(catalogue, currentAttackerEval.spec);
  }, [catalogue, currentAttackerEval?.spec]);

  // Filter compatible munitions capable of engaging this target domain
  const targetDomainMunitions = useMemo(() => {
    return compatibleMunitionsList.filter((m) => canWeaponEngageTarget(m.weapon, target.domain));
  }, [compatibleMunitionsList, target.domain]);

  // 4. Equipped Weapons loadout (can be modified directly if unit is at base)
  const [equippedWeapons, setEquippedWeapons] = useState<WeaponFacet[]>(() => {
    if (!currentAttackerEval) return [];
    const baseWeapons = currentAttackerEval.entity.customWeapons && currentAttackerEval.entity.customWeapons.length > 0
      ? [...currentAttackerEval.entity.customWeapons]
      : currentAttackerEval.spec?.weapons
        ? [...currentAttackerEval.spec.weapons]
        : [];

    // If unit is at base and currently has no compatible weapons for this target, auto-equip top matching munition
    const hasCompatible = baseWeapons.some((w) => canWeaponEngageTarget(w, target.domain));
    if (!hasCompatible && targetDomainMunitions.length > 0) {
      const topMun = targetDomainMunitions[0];
      return [
        ...baseWeapons,
        { ...topMun.weapon, name: topMun.name, magazine: topMun.weapon.magazine ?? 2 },
      ];
    }
    return baseWeapons;
  });

  // When selected attacker changes, sync weapons and count
  useEffect(() => {
    if (currentAttackerEval) {
      setScrambleCount(Math.min(2, currentAttackerEval.entity.count));
      const baseWeapons = currentAttackerEval.entity.customWeapons && currentAttackerEval.entity.customWeapons.length > 0
        ? [...currentAttackerEval.entity.customWeapons]
        : currentAttackerEval.spec?.weapons
          ? [...currentAttackerEval.spec.weapons]
          : [];

      const hasCompatible = baseWeapons.some((w) => canWeaponEngageTarget(w, target.domain));
      if (!hasCompatible && targetDomainMunitions.length > 0) {
        const topMun = targetDomainMunitions[0];
        setEquippedWeapons([
          ...baseWeapons,
          { ...topMun.weapon, name: topMun.name, magazine: topMun.weapon.magazine ?? 2 },
        ]);
      } else {
        setEquippedWeapons(baseWeapons);
      }
      setSelectedWeaponIdx(0);
    }
  }, [selectedAttackerId, target.domain, targetDomainMunitions]);

  // 5. Weapon selection from equipped loadout
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);

  // Compatible weapons from equipped loadout
  const activeCompatibleWeapons = useMemo(() => {
    const fromEquipped = equippedWeapons.filter((w) => canWeaponEngageTarget(w, target.domain));
    if (fromEquipped.length > 0) return fromEquipped;
    // Fallback to targetDomainMunitions mapped to WeaponFacet
    return targetDomainMunitions.map((m) => ({
      ...m.weapon,
      name: m.name,
      magazine: m.weapon.magazine ?? 2,
    }));
  }, [equippedWeapons, target.domain, targetDomainMunitions]);

  const activeWeapon = activeCompatibleWeapons[selectedWeaponIdx] || activeCompatibleWeapons[0];

  // 6. Salvo / Ordnance count selection
  const [userSalvoCount, setUserSalvoCount] = useState<number>(1);

  // 7. Post-Strike Protocol selection
  const [postStrikeAction, setPostStrikeAction] = useState<PostStrikeAction>('rtb');

  const effectiveAirframeSortieCount = isDockedAtBase
    ? Math.min(Math.max(1, scrambleCount), currentAttackerEval?.entity.count || 1)
    : (currentAttackerEval?.entity.count || 1);

  const roundsPerUnit = activeWeapon?.magazine ?? 2;
  const totalFormationRounds = effectiveAirframeSortieCount * roundsPerUnit;
  const effectiveSalvoCount = Math.min(Math.max(1, userSalvoCount), Math.max(1, totalFormationRounds));

  // Loadout Swapping Helpers
  const handleEquipMunition = (munition: Munition) => {
    const existingIndex = equippedWeapons.findIndex(
      (w) => (w.name || '').toLowerCase() === munition.name.toLowerCase()
    );

    if (existingIndex < 0) {
      const newWeapon: WeaponFacet = {
        ...munition.weapon,
        name: munition.name,
        magazine: munition.weapon.magazine ?? 2,
      };
      setEquippedWeapons((prev) => [newWeapon, ...prev]);
      setSelectedWeaponIdx(0);
    }
  };

  const handleApplyPreset = (preset: 'strike' | 'antiship' | 'cap') => {
    const matching = compatibleMunitionsList.filter((m) => {
      const engages = m.weapon.engages || [];
      if (preset === 'cap') return engages.includes('air');
      if (preset === 'strike') return engages.includes('ground') || engages.includes('surface');
      if (preset === 'antiship') return engages.includes('surface') || engages.includes('subsurface');
      return false;
    });

    if (matching.length > 0) {
      const selected = matching.slice(0, 3).map((m) => ({
        ...m.weapon,
        name: m.name,
        magazine: m.weapon.magazine ?? 2,
      }));
      setEquippedWeapons(selected);
      setSelectedWeaponIdx(0);
    }
  };

  const handleRestoreStandard = () => {
    if (currentAttackerEval?.spec?.weapons) {
      setEquippedWeapons([...currentAttackerEval.spec.weapons]);
      setSelectedWeaponIdx(0);
    }
  };

  const handleLaunch = () => {
    if (!currentAttackerEval || !currentAttackerEval.isEligible) return;

    // Ensure the active weapon is present in equippedWeapons
    let finalWeapons = [...equippedWeapons];
    let realWeaponIdx = finalWeapons.findIndex((w) => w.name === activeWeapon?.name);
    if (realWeaponIdx < 0 && activeWeapon) {
      finalWeapons = [activeWeapon, ...finalWeapons];
      realWeaponIdx = 0;
    }

    onLaunchStrike({
      attackerEntityId: selectedAttackerId,
      targetEntityId: target.targetId,
      targetLngLat: target.lngLat,
      weaponIndex: Math.max(0, realWeaponIdx),
      salvoCount: effectiveSalvoCount,
      postStrikeAction,
      sortieCount: isDockedAtBase ? effectiveAirframeSortieCount : undefined,
      customWeapons: isDockedAtBase ? finalWeapons : undefined,
    });
  };

  const domainLabel =
    target.domain === 'air'
      ? 'Air Target'
      : target.domain === 'ground' || target.domain === 'site'
        ? 'Ground Target'
        : target.domain === 'naval' || target.domain === 'surface'
          ? 'Maritime Surface Target'
          : 'Subsurface Target';

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
        color: 'var(--paper)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '740px',
          maxWidth: '96vw',
          maxHeight: '92vh',
          backgroundColor: '#09101B',
          border: '1px solid #D9534F',
          borderRadius: '10px',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(217, 83, 79, 0.12)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🎯</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', color: '#FF5252', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Strike & Intercept Tasking: {target.name}
              </h2>
              <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
                Target Domain: <strong>{domainLabel}</strong> · Faction: <strong>{target.iso}</strong> · Pos: {target.lngLat[1].toFixed(3)}°N, {target.lngLat[0].toFixed(3)}°E
              </span>
            </div>
          </div>

          <button
            className="wg-btn"
            style={{ padding: '4px 10px', fontSize: '12px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div
          style={{
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Target Intel Summary Banner */}
          <div
            style={{
              background: '#070C14',
              border: '1px solid rgba(217, 83, 79, 0.35)',
              borderRadius: '6px',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11.5px',
            }}
          >
            <div style={{ display: 'flex', gap: '18px' }}>
              <span>
                Classification: <strong style={{ color: '#FF5252' }}>{target.intelTier === 2 ? target.name : 'Unknown Hostile Track'}</strong>
              </span>
              <span>
                Domain: <strong>{target.domain.toUpperCase()}</strong>
              </span>
              <span>
                Strength: <strong>{target.count} Units</strong>
              </span>
            </div>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: target.intelTier === 2 ? 'rgba(79, 168, 95, 0.2)' : 'rgba(255, 176, 32, 0.2)',
                color: target.intelTier === 2 ? '#4FA85F' : '#FFB020',
                border: `1px solid ${target.intelTier === 2 ? '#4FA85F' : '#FFB020'}`,
                fontWeight: 600,
              }}
            >
              {target.intelTier === 2 ? '✓ POSITIVE PID (TIER 2)' : '⚠️ SENSOR TRACK (TIER 1)'}
            </span>
          </div>

          {/* Step 1: Attacking Unit Selection */}
          <div>
            <label
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                color: 'var(--paper-dim)',
                fontWeight: 700,
                display: 'block',
                marginBottom: '8px',
              }}
            >
              1. Assign Attacking Squadron / Battery
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {evaluatedAttackers.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '11px', color: 'var(--paper-dim)', textAlign: 'center' }}>
                  No friendly units deployed in theater.
                </div>
              ) : (
                evaluatedAttackers.map(({ entity, distToTarget, effectiveRadiusKm, isOutOfRange, engagementCheck, isEligible }) => {
                  const isSelected = entity.id === selectedAttackerId;
                  const statusLabel =
                    entity.status === 'on_station'
                      ? 'ON PATROL'
                      : entity.status === 'docked'
                        ? 'STATIONED AT BASE'
                        : entity.status.replace('_', ' ').toUpperCase();

                  return (
                    <div
                      key={entity.id}
                      onClick={() => {
                        if (isEligible) {
                          setSelectedAttackerId(entity.id);
                          setSelectedWeaponIdx(0);
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${isSelected ? '#4FC3F7' : isEligible ? 'var(--border)' : 'rgba(255, 255, 255, 0.05)'}`,
                        background: isSelected
                          ? 'rgba(79, 195, 247, 0.12)'
                          : isEligible
                            ? '#0E1724'
                            : 'rgba(255, 255, 255, 0.02)',
                        opacity: isEligible ? 1 : 0.55,
                        cursor: isEligible ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '12px', color: isEligible ? '#FFFFFF' : 'var(--paper-dim)' }}>
                            {entity.name}
                          </strong>
                          <span style={{ fontSize: '10px', color: '#4FC3F7', background: 'rgba(79, 195, 247, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                            {statusLabel}
                          </span>
                        </div>

                        {!isEligible && (
                          <span style={{ fontSize: '10px', color: '#FF5252', fontWeight: 600 }}>
                            {engagementCheck.reason || (isOutOfRange ? `⚠️ Out of combat reach (${distToTarget.toFixed(0)} km > ${effectiveRadiusKm.toFixed(0)} km)` : '⚠️ Unit unavailable')}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', fontSize: '11px' }}>
                        <span style={{ color: 'var(--paper-dim)' }}>
                          Distance: <strong style={{ color: isOutOfRange ? '#FF5252' : '#FFFFFF' }}>{distToTarget.toFixed(0)} km</strong>
                        </span>
                        <span style={{ color: 'var(--paper-dim)' }}>
                          Fuel: <strong style={{ color: entity.currentFuelPct < 25 ? '#D9534F' : '#4FA85F' }}>{entity.currentFuelPct.toFixed(0)}%</strong>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Step 1.1: Scramble Sortie Aircraft Count (Base Stationed Squadrons) */}
          {isDockedAtBase && currentAttackerEval && currentAttackerEval.entity.count > 1 && (
            <div
              style={{
                background: 'rgba(79, 195, 247, 0.08)',
                border: '1px solid rgba(79, 195, 247, 0.25)',
                borderRadius: '6px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    color: '#4FC3F7',
                    fontWeight: 700,
                    display: 'block',
                    margin: 0,
                  }}
                >
                  Sortie Scramble Strength (From Base Squadron)
                </label>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                  Scrambling <strong>{effectiveAirframeSortieCount}</strong> of <strong>{currentAttackerEval.entity.count}</strong> stationed airframes ({currentAttackerEval.entity.count - effectiveAirframeSortieCount} remain at base).
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="wg-btn"
                  style={{ padding: '3px 8px', fontSize: '12px' }}
                  onClick={() => setScrambleCount((prev) => Math.max(1, prev - 1))}
                  disabled={effectiveAirframeSortieCount <= 1}
                >
                  −
                </button>
                <strong style={{ fontSize: '13px', color: '#4FC3F7', minWidth: '28px', textAlign: 'center' }}>
                  {effectiveAirframeSortieCount} ×
                </strong>
                <button
                  type="button"
                  className="wg-btn"
                  style={{ padding: '3px 8px', fontSize: '12px' }}
                  onClick={() => setScrambleCount((prev) => Math.min(currentAttackerEval.entity.count, prev + 1))}
                  disabled={effectiveAirframeSortieCount >= currentAttackerEval.entity.count}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Weapon Selection & Base Loadout Configurator */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  color: 'var(--paper-dim)',
                  fontWeight: 700,
                  display: 'block',
                  margin: 0,
                }}
              >
                2. Select Weapon System for Release
              </label>

              {/* Stationed Loadout Presets Toolbar */}
              {isDockedAtBase && (
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', marginRight: '2px' }}>Base Re-Arm:</span>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('strike')}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9.5px',
                      borderRadius: '3px',
                      border: '1px solid #FF9800',
                      background: 'rgba(255, 152, 0, 0.15)',
                      color: '#FF9800',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🎯 Strike
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('antiship')}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9.5px',
                      borderRadius: '3px',
                      border: '1px solid #4FC3F7',
                      background: 'rgba(79, 195, 247, 0.15)',
                      color: '#4FC3F7',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🚢 Anti-Ship
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('cap')}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9.5px',
                      borderRadius: '3px',
                      border: '1px solid #4FA85F',
                      background: 'rgba(79, 168, 95, 0.15)',
                      color: '#4FA85F',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    ✈️ CAP
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreStandard}
                    style={{
                      padding: '2px 6px',
                      fontSize: '9.5px',
                      borderRadius: '3px',
                      border: '1px solid var(--border)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'var(--paper-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Reset
                  </button>
                </div>
              )}
            </div>

            {activeCompatibleWeapons.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(217, 83, 79, 0.1)',
                  border: '1px solid rgba(217, 83, 79, 0.3)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#FF5252',
                }}
              >
                ⚠️ Selected attacking unit has no weapons capable of engaging {target.domain.toUpperCase()} targets.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {activeCompatibleWeapons.map((weapon: WeaponFacet, idx: number) => {
                  const isSelected = idx === selectedWeaponIdx;
                  const distToTarget = currentAttackerEval?.distToTarget || 0;
                  const canReleaseImmediately = distToTarget <= weapon.rangeKm;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedWeaponIdx(idx)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${isSelected ? '#FF9800' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(255, 152, 0, 0.14)' : '#0E1724',
                        color: isSelected ? '#FF9800' : 'var(--paper)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <strong style={{ fontSize: '11.5px', color: isSelected ? '#FF9800' : '#FFFFFF' }}>
                          🚀 {weapon.magazine ? `${weapon.magazine} × ` : ''}{weapon.name}
                        </strong>
                        <strong style={{ fontSize: '11px', color: '#FF9800' }}>
                          {weapon.rangeKm} km
                        </strong>
                      </div>

                      <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <span>Speed: {weapon.speedMach ? `Mach ${weapon.speedMach}` : 'Supersonic'}</span>
                        <span style={{ color: canReleaseImmediately ? '#4FA85F' : '#4FC3F7', fontWeight: 600 }}>
                          {canReleaseImmediately ? '✓ IN ENGAGEMENT RANGE' : `INGRESS (${Math.max(0, distToTarget - weapon.rangeKm).toFixed(0)} km to launch)`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* If stationed at base: Show other compatible armory munitions available for this target domain */}
            {isDockedAtBase && targetDomainMunitions.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Available Base Munitions for {domainLabel}:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {targetDomainMunitions.map((mun, idx) => {
                    const isAlreadyEquipped = equippedWeapons.some((w) => (w.name || '').toLowerCase() === mun.name.toLowerCase());
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleEquipMunition(mun)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: `1px solid ${isAlreadyEquipped ? '#4FA85F' : 'rgba(255, 255, 255, 0.12)'}`,
                          background: isAlreadyEquipped ? 'rgba(79, 168, 95, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                          color: isAlreadyEquipped ? '#4FA85F' : 'var(--paper)',
                          fontSize: '10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span>{isAlreadyEquipped ? '✓' : '+'}</span>
                        <strong>{mun.name}</strong>
                        <span style={{ color: 'var(--paper-dim)', fontSize: '9px' }}>({mun.weapon.rangeKm}km)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Step 2.1: Salvo Size / Ordnance Count Selection */}
          {activeCompatibleWeapons.length > 0 && (
            <div
              style={{
                background: '#070C14',
                border: '1px solid rgba(255, 152, 0, 0.35)',
                borderRadius: '6px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      color: '#FF9800',
                      fontWeight: 700,
                      display: 'block',
                      margin: 0,
                    }}
                  >
                    Salvo Size / Weapons to Release
                  </label>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                    Formation has <strong>{totalFormationRounds} {activeWeapon?.name || 'rounds'}</strong> available ({effectiveAirframeSortieCount} aircraft × {roundsPerUnit} per airframe)
                  </span>
                </div>

                {/* Salvo Stepper Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="wg-btn"
                    style={{ padding: '4px 10px', fontSize: '13px', fontWeight: 'bold' }}
                    onClick={() => setUserSalvoCount((prev) => Math.max(1, prev - 1))}
                    disabled={effectiveSalvoCount <= 1}
                  >
                    −
                  </button>

                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#FF9800',
                      minWidth: '42px',
                      textAlign: 'center',
                      fontFamily: 'monospace',
                    }}
                  >
                    {effectiveSalvoCount} ×
                  </span>

                  <button
                    type="button"
                    className="wg-btn"
                    style={{ padding: '4px 10px', fontSize: '13px', fontWeight: 'bold' }}
                    onClick={() => setUserSalvoCount((prev) => Math.min(totalFormationRounds, prev + 1))}
                    disabled={effectiveSalvoCount >= totalFormationRounds}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Quick Select Buttons */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--paper-dim)', marginRight: '4px' }}>Quick Salvo:</span>
                {[1, 2, 4, totalFormationRounds]
                  .filter((v, i, a) => v <= totalFormationRounds && a.indexOf(v) === i)
                  .map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setUserSalvoCount(num)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        borderRadius: '4px',
                        border: `1px solid ${effectiveSalvoCount === num ? '#FF9800' : 'var(--border)'}`,
                        background: effectiveSalvoCount === num ? 'rgba(255, 152, 0, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                        color: effectiveSalvoCount === num ? '#FF9800' : 'var(--paper)',
                        cursor: 'pointer',
                        fontWeight: effectiveSalvoCount === num ? 700 : 400,
                      }}
                    >
                      {num === totalFormationRounds ? `Full Salvo (${num}x)` : `${num} Round${num > 1 ? 's' : ''}`}
                    </button>
                  ))}
              </div>

              <div style={{ fontSize: '10px', color: '#4FA85F', marginTop: '2px' }}>
                ✓ Committing <strong>{effectiveSalvoCount} of {totalFormationRounds} rounds</strong> across {effectiveAirframeSortieCount} aircraft. Post-strike remaining magazine: <strong>{totalFormationRounds - effectiveSalvoCount} rounds</strong>.
              </div>
            </div>
          )}

          {/* Step 3: Post-Strike Egress & Recovery Protocol */}
          <div>
            <label
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                color: 'var(--paper-dim)',
                fontWeight: 700,
                display: 'block',
                marginBottom: '8px',
              }}
            >
              3. Post-Strike Action (What unit does after releasing weapon)
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Option A: RTB */}
              <button
                type="button"
                onClick={() => setPostStrikeAction('rtb')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${postStrikeAction === 'rtb' ? '#4FC3F7' : 'var(--border)'}`,
                  background: postStrikeAction === 'rtb' ? 'rgba(79, 195, 247, 0.14)' : '#0E1724',
                  color: postStrikeAction === 'rtb' ? '#4FC3F7' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>🏠 RTB (Return to Base)</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Egress immediately after release and return to home base for turnaround/re-arming.
                </span>
              </button>

              {/* Option B: Return to Initial Patrol */}
              <button
                type="button"
                onClick={() => setPostStrikeAction('return_to_patrol')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${postStrikeAction === 'return_to_patrol' ? '#4FC3F7' : 'var(--border)'}`,
                  background: postStrikeAction === 'return_to_patrol' ? 'rgba(79, 195, 247, 0.14)' : '#0E1724',
                  color: postStrikeAction === 'return_to_patrol' ? '#4FC3F7' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>🔄 Return to Initial Patrol</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Return to pre-strike orbit/waypoints and continue surveillance patrol.
                </span>
              </button>

              {/* Option C: Loiter over Target */}
              <button
                type="button"
                onClick={() => setPostStrikeAction('loiter_target')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${postStrikeAction === 'loiter_target' ? '#4FC3F7' : 'var(--border)'}`,
                  background: postStrikeAction === 'loiter_target' ? 'rgba(79, 195, 247, 0.14)' : '#0E1724',
                  color: postStrikeAction === 'loiter_target' ? '#4FC3F7' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>📍 Loiter Around Target Area</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Establish holding orbit over target location for Battle Damage Assessment (BDA).
                </span>
              </button>

              {/* Option D: Designated Waypoint */}
              <button
                type="button"
                onClick={() => setPostStrikeAction('designated_waypoint')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${postStrikeAction === 'designated_waypoint' ? '#4FC3F7' : 'var(--border)'}`,
                  background: postStrikeAction === 'designated_waypoint' ? 'rgba(79, 195, 247, 0.14)' : '#0E1724',
                  color: postStrikeAction === 'designated_waypoint' ? '#4FC3F7' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>🗺️ Safe Holding Waypoint</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Egress to designated holding coordinates away from target air-defense envelopes.
                </span>
              </button>
            </div>
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
              background: currentAttackerEval?.isEligible ? '#FF5252' : '#333333',
              color: currentAttackerEval?.isEligible ? '#FFFFFF' : '#888888',
              borderColor: currentAttackerEval?.isEligible ? '#FF5252' : '#333333',
              fontWeight: 700,
              fontSize: '12px',
              padding: '8px 24px',
              cursor: currentAttackerEval?.isEligible ? 'pointer' : 'not-allowed',
            }}
            disabled={!currentAttackerEval?.isEligible}
            onClick={handleLaunch}
          >
            🚀 Launch Strike Mission ({activeWeapon?.name || 'Selected Munition'})
          </button>
        </div>
      </div>
    </div>
  );
}
