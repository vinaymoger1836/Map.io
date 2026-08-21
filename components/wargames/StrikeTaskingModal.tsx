'use client';

import React, { useState, useMemo } from 'react';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type PostStrikeAction,
} from '@/lib/warSimTypes';
import { type SystemSpec, type WeaponFacet } from '@/lib/specs';
import { distanceKm } from '@/lib/geo';
import { canEntityEngageTarget, isGroundCombatUnit, isStaticAirDefense } from '@/lib/warSimRules';

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
    postStrikeAction: PostStrikeAction;
    customPostLngLat?: [number, number];
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

  // 2. Weapon selection for chosen attacker
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);

  // 3. Post-Strike Protocol selection
  const [postStrikeAction, setPostStrikeAction] = useState<PostStrikeAction>('rtb');

  const compatibleWeapons = currentAttackerEval?.engagementCheck.compatibleWeapons || [];
  const activeWeapon = compatibleWeapons[selectedWeaponIdx] || compatibleWeapons[0];

  const handleLaunch = () => {
    if (!currentAttackerEval || !currentAttackerEval.isEligible) return;

    // Find index of this weapon in entity's weapons array
    const realWeaponIdx = currentAttackerEval.weapons.findIndex((w) => w.name === activeWeapon?.name);

    onLaunchStrike({
      attackerEntityId: selectedAttackerId,
      targetEntityId: target.targetId,
      targetLngLat: target.lngLat,
      weaponIndex: realWeaponIdx >= 0 ? realWeaponIdx : 0,
      postStrikeAction,
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

          {/* Step 2: Weapon Selection (Filtered for Target Domain) */}
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
              2. Select Weapon System for Release
            </label>

            {compatibleWeapons.length === 0 ? (
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
                ⚠️ Selected attacking unit has no weapons capable of engaging {target.domain.toUpperCase()} targets. Please assign a different squadron.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {compatibleWeapons.map((weapon: WeaponFacet, idx: number) => {
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
                          {canReleaseImmediately ? '✓ IN ENGAGEMENT RANGE' : `INGRESS (${(distToTarget - weapon.rangeKm).toFixed(0)} km to launch)`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
