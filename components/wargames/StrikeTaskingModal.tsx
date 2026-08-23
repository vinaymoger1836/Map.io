'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type PostStrikeAction,
} from '@/lib/warSimTypes';
import { type SystemSpec, type WeaponFacet, domainOf } from '@/lib/specs';
import { distanceKm } from '@/lib/geo';
import { canEntityEngageTarget, canWeaponEngageTarget, isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';
import { buildMunitions, compatibleMunitions, type Munition } from '@/lib/munitions';

function getPlatformTerminology(typeId?: string, domain?: string): { plural: string; singular: string; strengthLabel: string } {
  const tid = (typeId || '').toLowerCase();
  const d = (domain || '').toLowerCase();

  if (d === 'sea' || ['destroyer', 'cruiser', 'frigate', 'corvette', 'carrier-ship', 'carrier', 'warship'].includes(tid)) {
    return { plural: 'warships', singular: 'warship', strengthLabel: 'Task Force Strength (From Naval Base)' };
  }
  if (d === 'sub' || ['submarine', 'ssbn', 'ssn'].includes(tid)) {
    return { plural: 'submarines', singular: 'submarine', strengthLabel: 'Submarine Detachment Strength' };
  }
  if (d === 'ground' || d === 'site' || ['sam-launcher', 'mobile-ad', 'tank', 'ifv', 'artillery', 'mlrs', 'silo', 'coastal-missile', 'infantry', 'special-forces'].includes(tid)) {
    if (['sam-launcher', 'mobile-ad', 'silo', 'coastal-missile', 'mlrs', 'artillery'].includes(tid)) {
      return { plural: 'launchers', singular: 'launcher', strengthLabel: 'Battery Strength (From Base Force)' };
    }
    return { plural: 'vehicles', singular: 'vehicle', strengthLabel: 'Battalion Strength (From Base Force)' };
  }
  return { plural: 'aircraft', singular: 'airframe', strengthLabel: 'Sortie Scramble Strength (From Base Squadron)' };
}

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
    weaponsToFire?: import('@/lib/warSimTypes').WeaponSalvoItem[];
    attackWaypoints?: [number, number][];
  }) => void;
  onStartStrikeRoutePlanning?: (params: {
    attackerEntityId: string;
    targetEntityId: string;
    targetLngLat: [number, number];
    weaponIndex: number;
    salvoCount: number;
    postStrikeAction: PostStrikeAction;
    customPostLngLat?: [number, number];
    sortieCount?: number;
    customWeapons?: WeaponFacet[];
    weaponsToFire?: import('@/lib/warSimTypes').WeaponSalvoItem[];
  }) => void;
}

export function StrikeTaskingModal({
  target,
  friendlyEntities,
  systemsLibrary,
  onClose,
  onLaunchStrike,
  onStartStrikeRoutePlanning,
}: StrikeTaskingModalProps) {
  // 1. Attacker entity evaluation
  const evaluatedAttackers = useMemo(() => {
    const list = friendlyEntities.map((entity) => {
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

      const isDeployed = entity.status !== 'docked';

      return {
        entity,
        spec,
        isGround,
        isStaticAD,
        isDeployed,
        distToTarget,
        effectiveRadiusKm,
        isOutOfRange,
        engagementCheck,
        weapons,
        isEligible,
      };
    });

    // Priority Sorting:
    // 1. Systems already deployed on the map (isDeployed = true) are placed at the top (high selection)
    // 2. Systems still stationed/docked at base (isDeployed = false) are placed at the bottom
    // 3. Within each tier, eligible units come before ineligible units, then sorted by distance
    return list.sort((a, b) => {
      if (a.isDeployed !== b.isDeployed) {
        return a.isDeployed ? -1 : 1;
      }
      if (a.isEligible !== b.isEligible) {
        return a.isEligible ? -1 : 1;
      }
      return a.distToTarget - b.distToTarget;
    });
  }, [friendlyEntities, target, systemsLibrary]);

  // Do NOT select any system by default (starts empty)
  const [selectedAttackerId, setSelectedAttackerId] = useState<string>('');

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

  // 4. Equipped Weapons loadout (can only be modified if unit is at base)
  const [equippedWeapons, setEquippedWeapons] = useState<WeaponFacet[]>(() => {
    if (!currentAttackerEval) return [];
    return currentAttackerEval.entity.customWeapons && currentAttackerEval.entity.customWeapons.length > 0
      ? [...currentAttackerEval.entity.customWeapons]
      : currentAttackerEval.spec?.weapons
        ? [...currentAttackerEval.spec.weapons]
        : [];
  });

  // When selected attacker changes, sync weapons, count, and reset salvo selections
  useEffect(() => {
    if (currentAttackerEval) {
      setScrambleCount(Math.min(2, currentAttackerEval.entity.count));
      const baseWeapons = currentAttackerEval.entity.customWeapons && currentAttackerEval.entity.customWeapons.length > 0
        ? [...currentAttackerEval.entity.customWeapons]
        : currentAttackerEval.spec?.weapons
          ? [...currentAttackerEval.spec.weapons]
          : [];

      setEquippedWeapons(baseWeapons);
      setSelectedWeaponIdx(0);
      setWeaponSalvoMap({}); // Reset weapon selection so no weapon is selected by default
    } else {
      setEquippedWeapons([]);
      setWeaponSalvoMap({});
    }
  }, [selectedAttackerId, target.domain, targetDomainMunitions]);

  // 5. Weapon selection from equipped loadout
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);

  // Compatible weapons from equipped loadout
  const activeCompatibleWeapons = useMemo(() => {
    const fromEquipped = equippedWeapons.filter((w) => canWeaponEngageTarget(w, target.domain));
    if (fromEquipped.length > 0) return fromEquipped;
    
    // Only if docked at base and has no equipped weapons matching, fallback to targetDomainMunitions
    if (isDockedAtBase && targetDomainMunitions.length > 0) {
      return targetDomainMunitions.map((m) => ({
        ...m.weapon,
        name: m.name,
        magazine: m.weapon.magazine ?? 2,
      }));
    }
    // Deployed units have NO fallback — they can only fire what they are deployed with!
    return [];
  }, [equippedWeapons, target.domain, targetDomainMunitions, isDockedAtBase]);

  // 6. Multi-Weapon Salvo Selection map (weaponIdx -> count) — No weapon selected by default!
  const [weaponSalvoMap, setWeaponSalvoMap] = useState<Record<number, number>>({});

  // 7. Ingress Route selection
  const [ingressRouteType, setIngressRouteType] = useState<'direct' | 'waypoints'>('direct');

  // 8. Post-Strike Protocol selection
  const [postStrikeAction, setPostStrikeAction] = useState<PostStrikeAction>('rtb');

  const effectiveAirframeSortieCount = isDockedAtBase
    ? Math.min(Math.max(1, scrambleCount), currentAttackerEval?.entity.count || 1)
    : (currentAttackerEval?.entity.count || 1);

  // Default to 0 rounds for all weapons (no weapon selected by default)
  const getSalvoForWeapon = (wIdx: number, weapon: WeaponFacet): number => {
    const maxAvail = effectiveAirframeSortieCount * (weapon.magazine ?? 2);
    return Math.min(weaponSalvoMap[wIdx] ?? 0, maxAvail);
  };

  const setSalvoForWeapon = (wIdx: number, weapon: WeaponFacet, count: number) => {
    const maxAvail = effectiveAirframeSortieCount * (weapon.magazine ?? 2);
    const newCount = Math.max(0, Math.min(maxAvail, count));
    setWeaponSalvoMap((prev) => ({
      ...prev,
      [wIdx]: newCount,
    }));
  };

  const configuredWeaponsToFire: import('@/lib/warSimTypes').WeaponSalvoItem[] = useMemo(() => {
    return activeCompatibleWeapons
      .map((w, idx) => {
        const salvo = getSalvoForWeapon(idx, w);
        const realIdx = equippedWeapons.findIndex((ew) => ew.name === w.name);
        return {
          weaponIndex: realIdx >= 0 ? realIdx : idx,
          weaponName: w.name || 'Munition',
          weaponRangeKm: w.rangeKm || 100,
          salvoCount: salvo,
        };
      })
      .filter((w) => w.salvoCount > 0);
  }, [activeCompatibleWeapons, equippedWeapons, effectiveAirframeSortieCount, weaponSalvoMap]);

  const totalCommittedRounds = configuredWeaponsToFire.reduce((sum, w) => sum + w.salvoCount, 0);

  // Loadout Swapping Helpers (Base only)
  const handleEquipMunition = (munition: Munition) => {
    if (!isDockedAtBase) return;
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
    if (!isDockedAtBase) return;
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
    if (!isDockedAtBase) return;
    if (currentAttackerEval?.spec?.weapons) {
      setEquippedWeapons([...currentAttackerEval.spec.weapons]);
      setSelectedWeaponIdx(0);
    }
  };

  const handleLaunch = () => {
    if (!currentAttackerEval || !currentAttackerEval.isEligible || totalCommittedRounds <= 0) return;

    let finalWeapons = [...equippedWeapons];
    const strikeParams = {
      attackerEntityId: selectedAttackerId,
      targetEntityId: target.targetId,
      targetLngLat: target.lngLat,
      weaponIndex: configuredWeaponsToFire[0]?.weaponIndex || 0,
      salvoCount: totalCommittedRounds,
      postStrikeAction,
      sortieCount: isDockedAtBase ? effectiveAirframeSortieCount : undefined,
      customWeapons: isDockedAtBase ? finalWeapons : undefined,
      weaponsToFire: configuredWeaponsToFire,
    };

    if (ingressRouteType === 'waypoints' && onStartStrikeRoutePlanning) {
      onStartStrikeRoutePlanning(strikeParams);
      onClose();
      return;
    }

    onLaunchStrike(strikeParams);
  };

  const attackerDomain = currentAttackerEval?.spec ? domainOf(currentAttackerEval.spec) : 'air';
  const platformTerms = getPlatformTerminology(currentAttackerEval?.entity.typeId, attackerDomain);

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
              1. Assign Attacking Squadron / Battery / Warship
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
              {evaluatedAttackers.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '11px', color: 'var(--paper-dim)', textAlign: 'center' }}>
                  No friendly units deployed in theater.
                </div>
              ) : (
                evaluatedAttackers.map(({ entity, isDeployed, distToTarget, effectiveRadiusKm, isOutOfRange, engagementCheck, isEligible }, idx) => {
                  const isSelected = entity.id === selectedAttackerId;
                  const prevAttacker = evaluatedAttackers[idx - 1];
                  const showSectionHeader = idx === 0 || prevAttacker?.isDeployed !== isDeployed;

                  const statusLabel =
                    entity.status === 'on_station'
                      ? 'ON PATROL'
                      : entity.status === 'docked'
                        ? 'STATIONED AT BASE'
                        : entity.status.replace('_', ' ').toUpperCase();

                  return (
                    <React.Fragment key={entity.id}>
                      {showSectionHeader && (
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.6px',
                            textTransform: 'uppercase',
                            color: isDeployed ? '#4FC3F7' : '#FFB020',
                            background: isDeployed ? 'rgba(79, 195, 247, 0.08)' : 'rgba(255, 176, 32, 0.08)',
                            border: `1px solid ${isDeployed ? 'rgba(79, 195, 247, 0.2)' : 'rgba(255, 176, 32, 0.2)'}`,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            marginTop: idx > 0 ? '6px' : '0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span>{isDeployed ? '📍 Deployed in Field / Airborne / At Sea (Immediate Response)' : '🏠 Stationed at Base (Scramble Required)'}</span>
                          <span style={{ fontSize: '9px', opacity: 0.8 }}>
                            {isDeployed ? 'HIGH SELECTION' : 'BASE RESERVE'}
                          </span>
                        </div>
                      )}

                      <div
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
                            ? 'rgba(79, 195, 247, 0.14)'
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
                            <input
                              type="radio"
                              name="selectedAttacker"
                              checked={isSelected}
                              onChange={() => {
                                if (isEligible) {
                                  setSelectedAttackerId(entity.id);
                                  setSelectedWeaponIdx(0);
                                }
                              }}
                              disabled={!isEligible}
                              style={{ cursor: isEligible ? 'pointer' : 'not-allowed', accentColor: '#4FC3F7' }}
                            />
                            <strong style={{ fontSize: '12px', color: isSelected ? '#4FC3F7' : isEligible ? '#FFFFFF' : 'var(--paper-dim)' }}>
                              {entity.name}
                            </strong>
                            <span
                              style={{
                                fontSize: '9.5px',
                                color: isDeployed ? '#4FC3F7' : 'var(--paper-dim)',
                                background: isDeployed ? 'rgba(79, 195, 247, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                                padding: '1px 5px',
                                borderRadius: '3px',
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          {!isEligible && (
                            <span style={{ fontSize: '10px', color: '#FF5252', fontWeight: 600, marginLeft: '22px' }}>
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
                    </React.Fragment>
                  );
                })
              )}
            </div>
          </div>

          {!currentAttackerEval ? (
            <div
              style={{
                padding: '28px 20px',
                background: '#070C14',
                border: '1px dashed var(--border)',
                borderRadius: '8px',
                textAlign: 'center',
                color: 'var(--paper-dim)',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '28px' }}>🎯</span>
              <strong style={{ color: '#FFFFFF', fontSize: '13px' }}>Select an Attacking System Above</strong>
              <span style={{ maxWidth: '420px', lineHeight: 1.4 }}>
                Choose an available deployed platform on the map or a squadron at base in Step 1 to configure weapons, salvo size, and flight route.
              </span>
            </div>
          ) : (
            <>
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
                      {platformTerms.strengthLabel}
                    </label>
                    <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                      Tasking <strong>{effectiveAirframeSortieCount}</strong> of <strong>{currentAttackerEval.entity.count}</strong> stationed {platformTerms.plural} ({currentAttackerEval.entity.count - effectiveAirframeSortieCount} remain at base).
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                      {isDockedAtBase ? '2. Configure Weapons & Select Munitions for Release' : '2. Select Weapon from Deployed Loadout'}
                    </label>
                    {!isDockedAtBase && (
                      <span
                        style={{
                          fontSize: '9.5px',
                          color: '#4FC3F7',
                          background: 'rgba(79, 195, 247, 0.12)',
                          border: '1px solid rgba(79, 195, 247, 0.3)',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                        }}
                        title="Weapon loadout cannot be changed while deployed on the map. Return to base to rearm."
                      >
                        🔒 Deployed Loadout (Fixed in Flight)
                      </span>
                    )}
                  </div>

              {/* Stationed Loadout Presets Toolbar (Base only) */}
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
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <strong>⚠️ Selected Unit Cannot Engage {target.domain.toUpperCase()} Targets</strong>
                <span>
                  {isDockedAtBase
                    ? `Stationed unit has no compatible weapons configured. Use the Base Re-Arm presets above or choose a munition from the base armory.`
                    : `This deployed unit is currently carrying: ${equippedWeapons.map((w) => w.name).join(', ') || 'no weapons'}. None of these weapons can engage ${target.domain.toUpperCase()} targets. (Deployed units cannot change weapon loadout; only systems at base can be re-armed before launch).`}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activeCompatibleWeapons.map((weapon: WeaponFacet, idx: number) => {
                  const currentSalvo = getSalvoForWeapon(idx, weapon);
                  const isIncluded = currentSalvo > 0;
                  const distToTarget = currentAttackerEval?.distToTarget || 0;
                  const canReleaseImmediately = distToTarget <= weapon.rangeKm;
                  const roundsPerUnit = weapon.magazine ?? 2;
                  const maxAvail = effectiveAirframeSortieCount * roundsPerUnit;

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: `1px solid ${isIncluded ? '#FF9800' : 'rgba(255, 255, 255, 0.12)'}`,
                        background: isIncluded ? 'rgba(255, 152, 0, 0.08)' : '#0E1724',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={(e) => {
                              setSalvoForWeapon(idx, weapon, e.target.checked ? Math.min(1, maxAvail) : 0);
                            }}
                            style={{ cursor: 'pointer', accentColor: '#FF9800' }}
                          />
                          <strong style={{ fontSize: '12px', color: isIncluded ? '#FF9800' : '#FFFFFF' }}>
                            🚀 {weapon.name}
                          </strong>
                          <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>
                            ({maxAvail} available • {effectiveAirframeSortieCount} {platformTerms.plural} × {roundsPerUnit} per {platformTerms.singular})
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '11px', color: '#FF9800' }}>
                            {weapon.rangeKm} km
                          </strong>
                          <span style={{ fontSize: '9.5px', color: canReleaseImmediately ? '#4FA85F' : '#4FC3F7', fontWeight: 600 }}>
                            {canReleaseImmediately ? '✓ IN ENGAGEMENT RANGE' : `INGRESS (${Math.max(0, distToTarget - weapon.rangeKm).toFixed(0)} km to launch)`}
                          </span>
                        </div>
                      </div>

                      {/* Salvo Stepper and Quick Buttons for this weapon */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)', marginRight: '2px' }}>Salvo:</span>
                          {[1, 2, 4, maxAvail]
                            .filter((v, i, a) => v <= maxAvail && a.indexOf(v) === i)
                            .map((num) => (
                              <button
                                key={num}
                                type="button"
                                onClick={() => setSalvoForWeapon(idx, weapon, num)}
                                style={{
                                  padding: '2px 7px',
                                  fontSize: '9.5px',
                                  borderRadius: '3px',
                                  border: `1px solid ${currentSalvo === num ? '#FF9800' : 'rgba(255, 255, 255, 0.1)'}`,
                                  background: currentSalvo === num ? 'rgba(255, 152, 0, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                                  color: currentSalvo === num ? '#FF9800' : 'var(--paper-dim)',
                                  cursor: 'pointer',
                                  fontWeight: currentSalvo === num ? 700 : 400,
                                }}
                              >
                                {num === maxAvail ? `Max (${num})` : `${num}x`}
                              </button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            className="wg-btn"
                            style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 'bold' }}
                            onClick={() => setSalvoForWeapon(idx, weapon, currentSalvo - 1)}
                            disabled={currentSalvo <= 0}
                          >
                            −
                          </button>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: currentSalvo > 0 ? '#FF9800' : 'var(--paper-dim)', minWidth: '32px', textAlign: 'center', fontFamily: 'monospace' }}>
                            {currentSalvo} ×
                          </span>
                          <button
                            type="button"
                            className="wg-btn"
                            style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 'bold' }}
                            onClick={() => setSalvoForWeapon(idx, weapon, currentSalvo + 1)}
                            disabled={currentSalvo >= maxAvail}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
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

          {/* Step 2.1: Coordinated Strike Package Summary */}
          {configuredWeaponsToFire.length > 0 && (
            <div
              style={{
                background: '#070C14',
                border: '1px solid rgba(255, 152, 0, 0.35)',
                borderRadius: '6px',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#FF9800', fontWeight: 700 }}>
                  🎯 Coordinated Strike Package Summary
                </span>
                <strong style={{ fontSize: '12px', color: '#4FA85F' }}>
                  {totalCommittedRounds} Total Round{totalCommittedRounds > 1 ? 's' : ''} Committed
                </strong>
              </div>

              <div style={{ fontSize: '10.5px', color: 'var(--paper)' }}>
                {configuredWeaponsToFire.map((w, i) => (
                  <span key={i} style={{ display: 'inline-block', marginRight: '8px' }}>
                    <strong>{w.salvoCount}× {w.weaponName}</strong> ({w.weaponRangeKm} km){i < configuredWeaponsToFire.length - 1 ? ' +' : ''}
                  </span>
                ))}
              </div>

              <div style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                ✓ All selected munitions will be released sequentially across {effectiveAirframeSortieCount} {platformTerms.plural} upon reaching stand-off engagement range.
              </div>
            </div>
          )}

          {/* Step 3: Ingress Flight Corridor Selection */}
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
              3. Ingress Flight Corridor (Attack Route Vector)
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Option A: Direct Ingress */}
              <button
                type="button"
                onClick={() => setIngressRouteType('direct')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${ingressRouteType === 'direct' ? '#FF9800' : 'var(--border)'}`,
                  background: ingressRouteType === 'direct' ? 'rgba(255, 152, 0, 0.14)' : '#0E1724',
                  color: ingressRouteType === 'direct' ? '#FF9800' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>⚡ Direct Ingress</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Fly straight to stand-off release envelope and release weapons immediately.
                </span>
              </button>

              {/* Option B: Custom Waypoints */}
              <button
                type="button"
                onClick={() => setIngressRouteType('waypoints')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${ingressRouteType === 'waypoints' ? '#FF9800' : 'var(--border)'}`,
                  background: ingressRouteType === 'waypoints' ? 'rgba(255, 152, 0, 0.14)' : '#0E1724',
                  color: ingressRouteType === 'waypoints' ? '#FF9800' : 'var(--paper)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '11.5px' }}>🗺️ Custom Ingress Waypoints</strong>
                <span style={{ fontSize: '9.5px', color: 'var(--paper-dim)' }}>
                  Pause clock & plot waypoints (WP 1 → WP 2 → Final Release) on map to evade SAMs/radar.
                </span>
              </button>
            </div>
          </div>

          {/* Step 4: Post-Strike Egress & Recovery Protocol */}
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
              4. Post-Strike Action (What unit does after releasing weapon)
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
            </>
          )}
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
              background: currentAttackerEval?.isEligible && totalCommittedRounds > 0 ? (ingressRouteType === 'waypoints' ? '#FF9800' : '#FF5252') : '#333333',
              color: currentAttackerEval?.isEligible && totalCommittedRounds > 0 ? '#FFFFFF' : '#888888',
              borderColor: currentAttackerEval?.isEligible && totalCommittedRounds > 0 ? (ingressRouteType === 'waypoints' ? '#FF9800' : '#FF5252') : '#333333',
              fontWeight: 700,
              fontSize: '12px',
              padding: '8px 24px',
              cursor: currentAttackerEval?.isEligible && totalCommittedRounds > 0 ? 'pointer' : 'not-allowed',
            }}
            disabled={!currentAttackerEval?.isEligible || totalCommittedRounds <= 0}
            onClick={handleLaunch}
          >
            {!currentAttackerEval
              ? '⚠️ Select an attacking system in Step 1'
              : totalCommittedRounds > 0
                ? ingressRouteType === 'waypoints'
                  ? `🗺️ Plot Ingress Route on Map (${totalCommittedRounds} Rounds Configured)`
                  : `🚀 Launch Direct Strike (${configuredWeaponsToFire.map((w) => `${w.salvoCount}× ${w.weaponName}`).join(' + ')})`
                : '⚠️ Select at least 1 weapon round to launch'}
          </button>
        </div>
      </div>
    </div>
  );
}
