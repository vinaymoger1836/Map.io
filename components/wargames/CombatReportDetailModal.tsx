'use client';

/**
 * Combat After-Action Report (AAR) & Tactical Analysis Modal
 *
 * Provides in-depth tactical telemetry and battle damage analysis for:
 * 1. Incoming attacks / defensive interceptions & damage sustained.
 * 2. Offensive strikes executed against enemy targets (with PID status, missiles launched/intercepted, and BDA).
 * 3. Reconnaissance & positive identification (PID) discoveries.
 */

import React from 'react';
import { type CombatReport } from '@/lib/warSimTypes';

export interface CombatReportDetailModalProps {
  report: CombatReport;
  onClose: () => void;
  onFlyToLocation?: (lngLat: [number, number]) => void;
  playerCountryName?: string;
  enemyCountryName?: string;
}

export function CombatReportDetailModal({
  report,
  onClose,
  onFlyToLocation,
  playerCountryName = 'Friendly',
  enemyCountryName = 'Hostile',
}: CombatReportDetailModalProps) {
  const isOffensive = report.category === 'offensive_strike';
  const isDefensive = report.category === 'under_attack';
  const isRecon = report.category === 'recon_intel';
  const isBattleOps = report.category === 'battle_ops' || Boolean(report.isConsolidatedBattleOps);

  const categoryColor = isBattleOps ? '#00E676' : isDefensive ? '#FF5252' : isOffensive ? '#FF9800' : '#4FC3F7';
  const categoryLabel = isBattleOps
    ? '🏆 THEATER BATTLE OPERATIONS (BATTLE OPS) CONSOLIDATED REPORT'
    : isDefensive
      ? '🛡️ DEFENSIVE ENGAGEMENT / UNDER ATTACK'
      : isOffensive
        ? '🚀 OFFENSIVE STRIKE MISSION'
        : '📡 RECONNAISSANCE & POSITIVE IDENTIFICATION (PID)';
  const primary = report.primaryEntity;
  const opposing = report.opposingEntity;
  const munitions = report.munitionsDetails;
  const interception = report.interceptionTelemetry;
  const bda = report.damageAssessment;
  const intel = report.intelDetails;
  const battleOps = report.battleOpsDetails;

  const getHeaderBadge = () => {
    switch (report.category) {
      case 'battle_ops':
        return { text: 'JOINT THEATER BATTLE OPS AFTER-ACTION REPORT', color: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' };
      case 'under_attack':
        return { text: 'DEFENSIVE ENGAGEMENT & THREAT REPORT', color: '#FF5252', bg: 'rgba(255, 82, 82, 0.15)' };
      case 'offensive_strike':
        return { text: 'OFFENSIVE STRIKE & TARGETING REPORT', color: '#FF9800', bg: 'rgba(255, 152, 0, 0.15)' };
      case 'recon_intel':
        return { text: 'RECONNAISSANCE & POSITIVE IDENTIFICATION (PID)', color: '#4FC3F7', bg: 'rgba(79, 195, 247, 0.15)' };
      default:
        return { text: 'COMBAT ACTION REPORT', color: '#B0BEC5', bg: 'rgba(176, 190, 197, 0.15)' };
    }
  };

  const badge = getHeaderBadge();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 1200,
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
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          backgroundColor: '#090F19',
          border: `1px solid ${badge.color}40`,
          borderRadius: '10px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#E0E6ED',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            background: '#0D1624',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: badge.color,
                  background: badge.bg,
                  border: `1px solid ${badge.color}40`,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                }}
              >
                {badge.text}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--paper-dim)' }}>
                {report.timeFormatted}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '15.5px', color: '#FFFFFF', fontWeight: 700 }}>
              {report.title}
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {report.lngLat && onFlyToLocation && (
              <button
                type="button"
                className="wg-btn"
                onClick={() => onFlyToLocation(report.lngLat!)}
                style={{
                  padding: '5px 10px',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  color: '#4FC3F7',
                }}
                title="Center tactical map on this engagement coordinate"
              >
                <span>📍</span> MAP LOCATION
              </button>
            )}
            <button
              type="button"
              className="wg-btn"
              onClick={onClose}
              style={{ padding: '5px 9px', fontSize: '13px' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          style={{
            padding: '16px 18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* Operational Incident Summary */}
          <div
            style={{
              padding: '10px 12px',
              background: '#070C14',
              borderRadius: '6px',
              border: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                color: 'var(--paper-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'block',
                marginBottom: '3px',
              }}
            >
              Operational Incident Summary
            </span>
            <p style={{ margin: 0, fontSize: '12px', color: '#E0E6ED', lineHeight: 1.45 }}>
              {report.summary}
            </p>
          </div>

          {/* Section 1: Forces Involved & Positive Identification Status */}
          <div>
            <label
              style={{
                fontSize: '10.5px',
                fontWeight: 800,
                color: 'var(--paper-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              1. Forces Involved & Positive Identification (PID) Status
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: opposing ? '1fr 1fr' : '1fr', gap: '10px' }}>
              {/* Friendly Force Card */}
              <div
                style={{
                  background: '#0B131E',
                  border: '1px solid rgba(79, 195, 247, 0.25)',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#4FC3F7', fontWeight: 700, textTransform: 'uppercase' }}>
                    {isRecon ? '📡 Detecting Sensor Asset' : isDefensive ? '🛡️ Defending Platform' : '🚀 Attacking Platform'}
                  </span>
                  <span style={{ fontSize: '9.5px', background: 'rgba(79, 195, 247, 0.15)', color: '#4FC3F7', padding: '1px 6px', borderRadius: '3px' }}>
                    {primary.iso} Force
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                  <strong style={{ fontSize: '13.5px', color: '#FFFFFF' }}>{primary.name}</strong>
                  {primary.count && primary.count > 1 && (
                    <span style={{ fontSize: '11px', color: '#4FC3F7', fontWeight: 600 }}>({primary.count} units)</span>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                  <span>Domain: <strong style={{ color: '#E0E6ED', textTransform: 'capitalize' }}>{primary.domain}</strong></span>
                  <span>•</span>
                  <span>Type: <strong style={{ color: '#E0E6ED', textTransform: 'capitalize' }}>{primary.typeId}</strong></span>
                </div>
              </div>

              {/* Opposing Force Card (with PID Highlight) */}
              {opposing && (
                <div
                  style={{
                    background: '#0B131E',
                    border: `1px solid ${opposing.isPID ? 'rgba(79, 168, 95, 0.35)' : 'rgba(255, 152, 0, 0.35)'}`,
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: opposing.isPID ? '#4FA85F' : '#FF9800', fontWeight: 700, textTransform: 'uppercase' }}>
                      {isRecon ? '🎯 Discovered Contact' : isDefensive ? '⚔️ Opposing Threat' : '🎯 Target Force'}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 800,
                        letterSpacing: '0.4px',
                        background: opposing.isPID ? 'rgba(79, 168, 95, 0.18)' : 'rgba(255, 152, 0, 0.18)',
                        color: opposing.isPID ? '#4FA85F' : '#FF9800',
                        border: `1px solid ${opposing.isPID ? 'rgba(79, 168, 95, 0.4)' : 'rgba(255, 152, 0, 0.4)'}`,
                        padding: '1px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      {opposing.isPID ? '✓ POSITIVE PID (TIER 2)' : '⚠️ SENSOR TRACK ONLY (TIER 1)'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <strong style={{ fontSize: '13.5px', color: opposing.isPID ? '#FFFFFF' : '#FFB020' }}>
                      {opposing.name}
                    </strong>
                    {opposing.count && (
                      <span style={{ fontSize: '11px', color: '#B0BEC5' }}>({opposing.count} units)</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
                    <span>Domain: <strong style={{ color: '#E0E6ED', textTransform: 'capitalize' }}>{opposing.domain}</strong></span>
                    {opposing.typeId && (
                      <>
                        <span>•</span>
                        <span>Type: <strong style={{ color: '#E0E6ED', textTransform: 'capitalize' }}>{opposing.typeId}</strong></span>
                      </>
                    )}
                    {opposing.rcsM2 !== undefined && (
                      <>
                        <span>•</span>
                        <span>RCS: <strong style={{ color: '#4FC3F7' }}>{opposing.rcsM2 >= 1 ? `${opposing.rcsM2.toFixed(1)} m²` : `${opposing.rcsM2} m²`}</strong></span>
                      </>
                    )}
                  </div>

                  <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', lineHeight: 1.35, marginTop: '2px' }}>
                    {opposing.isPID ? (
                      <span>
                        Verified by friendly radar/reconnaissance assets. Platform type, classification and weapons signature verified.
                      </span>
                    ) : (
                      <span style={{ color: '#FFB020' }}>
                        Raw kinematic sensor radar/sonar track. Target identity unconfirmed; dispatch AWACS or recon UAV to achieve optical/ISAR Positive Identification (PID).
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Munitions & Weapon Release Telemetry */}
          {munitions && (
            <div>
              <label
                style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: 'var(--paper-dim)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                2. Munitions & Weapon Release Telemetry
              </label>

              <div
                style={{
                  background: '#070C14',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '12px',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Ordnance / Missiles:</span>
                  <strong style={{ color: '#FFFFFF', fontSize: '12px' }}>{munitions.weaponName}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Salvo Commitment:</span>
                  <strong style={{ color: '#4FC3F7', fontSize: '12px' }}>{munitions.salvoCount} Rounds</strong>
                </div>

                {munitions.standoffDistanceKm !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Release Stand-off:</span>
                    <strong style={{ color: '#FFFFFF', fontSize: '12px' }}>{munitions.standoffDistanceKm.toFixed(0)} km</strong>
                  </div>
                )}

                {munitions.rangeKm !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Max Weapon Range:</span>
                    <strong style={{ color: '#FFFFFF', fontSize: '12px' }}>{munitions.rangeKm} km</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Air Defense & Interception Telemetry */}
          {interception && (
            <div>
              <label
                style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: 'var(--paper-dim)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                3. Air Defense Countermeasures & Interception Telemetry
              </label>

              <div
                style={{
                  background: '#070C14',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', fontSize: '11px' }}>
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Air Defense Network:</span>
                    <strong style={{ color: '#FFFFFF' }}>{interception.defenseSystemName || 'Active Defense Grid'}</strong>
                  </div>

                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Interceptors Fired:</span>
                    <strong style={{ color: '#4FC3F7' }}>{interception.interceptorsLaunched} × {interception.interceptorType || 'SAM'}</strong>
                  </div>

                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Threats Intercepted:</span>
                    <strong style={{ color: interception.missilesIntercepted > 0 ? '#4FA85F' : 'var(--paper-dim)' }}>
                      {interception.missilesIntercepted} Destroyed in Mid-Air
                    </strong>
                  </div>

                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Penetrating Missiles:</span>
                    <strong style={{ color: interception.missilesPenetrated > 0 ? '#FF5252' : '#4FA85F' }}>
                      {interception.missilesPenetrated} Leakers
                    </strong>
                  </div>
                </div>

                {/* Progress bar for interception efficiency */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--paper-dim)' }}>Interception Kill Rate:</span>
                    <strong style={{ color: interception.successRatePct >= 70 ? '#4FA85F' : interception.successRatePct > 0 ? '#FF9800' : '#FF5252' }}>
                      {interception.successRatePct.toFixed(0)}%
                    </strong>
                  </div>
                  <div style={{ height: '6px', width: '100%', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, interception.successRatePct))}%`,
                        background: interception.successRatePct >= 70 ? '#4FA85F' : interception.successRatePct > 0 ? '#FF9800' : '#FF5252',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: '#B0BEC5', lineHeight: 1.4 }}>
                  <span>Engagement Detail: <strong>{interception.responseDetail}</strong></span>
                </div>

                {/* Detailed Per-System Interception Breakdown */}
                {interception.breakdown && interception.breakdown.length > 0 && (
                  <div
                    style={{
                      marginTop: '4px',
                      padding: '10px 12px',
                      background: 'rgba(79, 195, 247, 0.05)',
                      border: '1px solid rgba(79, 195, 247, 0.2)',
                      borderRadius: '6px',
                    }}
                  >
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, color: '#4FC3F7', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>🛡️ Integrated Interception Breakdown by Defending Unit</span>
                      {report.networkDetails && (
                        <span style={{ fontSize: '9px', color: '#00E676', background: 'rgba(0, 230, 118, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                          🌐 {report.networkDetails.networkName}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {interception.breakdown.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '11px',
                            background: 'rgba(0, 0, 0, 0.4)',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{item.defenderName}</span>
                            <span
                              style={{
                                fontSize: '9px',
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '3px',
                                background: item.interceptType === 'sam' ? 'rgba(33, 150, 243, 0.2)' : 'rgba(255, 152, 0, 0.2)',
                                color: item.interceptType === 'sam' ? '#64B5F6' : '#FFB74D',
                                border: `1px solid ${item.interceptType === 'sam' ? 'rgba(33, 150, 243, 0.4)' : 'rgba(255, 152, 0, 0.4)'}`,
                              }}
                            >
                              {item.interceptType === 'sam' ? '🚀 Area SAM' : '💥 Point CIWS'}
                            </span>
                            <span style={{ color: '#90A4AE', fontSize: '10.5px' }}>via {item.interceptorWeapon}</span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ color: '#90A4AE', fontSize: '10px' }}>
                              Expended: <strong style={{ color: '#E0E6ED' }}>{item.roundsFired}</strong>
                            </span>
                            <span style={{ color: item.countDestroyed > 0 ? '#4FA85F' : '#90A4AE', fontWeight: 700 }}>
                              {item.countDestroyed > 0 ? `🎯 ${item.countDestroyed} Intercepted` : '0 Hits'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 4: Battle Damage Assessment (BDA) */}
          {bda && (
            <div>
              <label
                style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: 'var(--paper-dim)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                4. Battle Damage Assessment (BDA) & Target State
              </label>

              <div
                style={{
                  background: '#070C14',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>Confirmed Result:</span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      background:
                        bda.damageInflicted === 'destroyed'
                          ? 'rgba(217, 83, 79, 0.2)'
                          : bda.damageInflicted === 'heavy'
                            ? 'rgba(255, 152, 0, 0.2)'
                            : 'rgba(79, 168, 95, 0.2)',
                      color:
                        bda.damageInflicted === 'destroyed'
                          ? '#FF5252'
                          : bda.damageInflicted === 'heavy'
                            ? '#FF9800'
                            : '#4FA85F',
                      border: `1px solid ${
                        bda.damageInflicted === 'destroyed'
                          ? 'rgba(217, 83, 79, 0.4)'
                          : bda.damageInflicted === 'heavy'
                            ? 'rgba(255, 152, 0, 0.4)'
                            : 'rgba(79, 168, 95, 0.4)'
                      }`,
                    }}
                  >
                    {bda.targetResultState} ({bda.damageInflicted.toUpperCase()} DAMAGE)
                  </span>

                  {bda.personnelLosses !== undefined && bda.personnelLosses > 0 && (
                    <span style={{ fontSize: '11px', color: '#FF5252' }}>
                      • <strong>{bda.personnelLosses}</strong> Personnel Casualties
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '11.5px', color: '#CFD8DC', lineHeight: 1.4 }}>
                  {bda.bdaSummary}
                </div>

                {bda.subsystemsDamaged && bda.subsystemsDamaged.length > 0 && (
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--paper-dim)', fontWeight: 700 }}>
                      Subsystem Degradation Report:
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {bda.subsystemsDamaged.map((sub, sIdx) => (
                        <span
                          key={sIdx}
                          style={{
                            fontSize: '9.5px',
                            background: 'rgba(255, 82, 82, 0.15)',
                            border: '1px solid rgba(255, 82, 82, 0.3)',
                            color: '#FF8A80',
                            padding: '2px 6px',
                            borderRadius: '3px',
                          }}
                        >
                          ⚠️ {sub}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 4b: Battle Ops Consolidated Multi-Phase Theater Assessment */}
          {battleOps && (
            <div>
              <label
                style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: '#00E676',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                🏆 Multi-Phase Battle Ops Theater Execution Summary
              </label>

              <div
                style={{
                  background: '#070C14',
                  border: '1px solid rgba(0, 230, 118, 0.3)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* Strategic Outcome Banner */}
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(0, 230, 118, 0.1)',
                    border: '1px solid rgba(0, 230, 118, 0.3)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#00E676',
                    fontWeight: 700,
                  }}
                >
                  🎖️ {battleOps.strategicOutcome}
                </div>

                {/* Key Telemetry Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', fontSize: '11px' }}>
                  <div style={{ background: '#0B131E', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--paper-dim)', fontSize: '10px', display: 'block' }}>Total Phases:</span>
                    <strong style={{ color: '#E0E6ED' }}>{battleOps.totalPhases} Scheduled Phases</strong>
                  </div>
                  <div style={{ background: '#0B131E', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--paper-dim)', fontSize: '10px', display: 'block' }}>Munitions Fired:</span>
                    <strong style={{ color: '#FFB020' }}>{battleOps.totalSalvoLaunched} Missiles / Bombs</strong>
                  </div>
                  <div style={{ background: '#0B131E', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--paper-dim)', fontSize: '10px', display: 'block' }}>Interceptions:</span>
                    <strong style={{ color: '#FF5252' }}>{battleOps.totalIntercepted} Intercepted</strong>
                  </div>
                  <div style={{ background: '#0B131E', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--paper-dim)', fontSize: '10px', display: 'block' }}>Direct Hits:</span>
                    <strong style={{ color: '#00E676' }}>{battleOps.directHits} Hits Scored</strong>
                  </div>
                </div>

                {/* Phase Breakdown List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <span style={{ fontSize: '10.5px', color: 'var(--paper-dim)', fontWeight: 700 }}>
                    Chronological Phase Execution Timeline:
                  </span>
                  {battleOps.phasesSummary.map((p, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#0B131E',
                        border: '1px solid var(--border)',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '1px 5px', borderRadius: '3px', fontSize: '9.5px', fontWeight: 700 }}>
                          {p.triggerTimeFormatted}
                        </span>
                        <strong>{p.name}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--paper-dim)', fontSize: '10px' }}>{p.taskCount} tasks</span>
                        <span style={{ color: '#00E676', fontWeight: 600, fontSize: '10px' }}>{p.outcome}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Target Casualties */}
                {battleOps.targetCasualties && battleOps.targetCasualties.length > 0 && (
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '10.5px', color: '#FF5252', fontWeight: 700 }}>
                      Confirmed Target Casualties & Neutralizations:
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {battleOps.targetCasualties.map((cas, cIdx) => (
                        <span
                          key={cIdx}
                          style={{
                            fontSize: '10px',
                            background: 'rgba(255, 82, 82, 0.15)',
                            border: '1px solid rgba(255, 82, 82, 0.3)',
                            color: '#FF8A80',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontWeight: 600,
                          }}
                        >
                          💥 {cas}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 5: Reconnaissance & Sensor Intel (if Recon report) */}
          {intel && (
            <div>
              <label
                style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                  letterSpacing: '0.6px',
                  color: 'var(--paper-dim)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                Intel & Electronic Sensor Reconnaissance
              </label>

              <div
                style={{
                  background: '#070C14',
                  border: '1px solid rgba(79, 195, 247, 0.3)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '12px',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Sensors Used:</span>
                  <strong style={{ color: '#4FC3F7' }}>{intel.sensorUsed}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Coordinates:</span>
                  <strong style={{ color: '#FFFFFF' }}>{intel.coordinatesText}</strong>
                </div>

                {intel.distanceKm !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Contact Distance:</span>
                    <strong style={{ color: '#4FC3F7' }}>{intel.distanceKm.toFixed(0)} km from Sensor</strong>
                  </div>
                )}

                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Domain Classification:</span>
                  <strong style={{ color: '#FFFFFF' }}>{intel.discoveredDomain}</strong>
                </div>

                {intel.rcsM2 !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Target Physical RCS:</span>
                    <strong style={{ color: '#4FC3F7' }}>
                      {intel.rcsM2 >= 1 ? `${intel.rcsM2.toFixed(1)} m²` : `${intel.rcsM2} m²`}
                      {intel.rcsMultiplier ? ` (×${intel.rcsMultiplier.toFixed(2)} radar echo)` : ''}
                    </strong>
                  </div>
                )}

                {intel.nominalRangeKm !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Nominal Baseline Range:</span>
                    <strong style={{ color: '#90A4AE' }}>{intel.nominalRangeKm} km (5 m² target)</strong>
                  </div>
                )}

                {intel.effectiveRangeKm !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Effective Radar Reach:</span>
                    <strong style={{ color: '#4FA85F' }}>{intel.effectiveRangeKm.toFixed(0)} km</strong>
                  </div>
                )}

                {intel.radarHorizonKm !== undefined && intel.radarHorizonKm > 0 && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Line-of-Sight Horizon:</span>
                    <strong style={{ color: '#E0E6ED' }}>{intel.radarHorizonKm.toFixed(0)} km</strong>
                  </div>
                )}

                {intel.estimatedComposition && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Verified Order of Battle:</span>
                    <strong style={{ color: '#4FA85F' }}>{intel.estimatedComposition}</strong>
                  </div>
                )}

                {intel.detectionBottleneck && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Sensor Resolution:</span>
                    <span style={{ color: '#90A4AE', fontSize: '10px' }}>{intel.detectionBottleneck}</span>
                  </div>
                )}
              </div>

              {intel.physicsExplanation && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '10px 12px',
                    background: 'rgba(79, 195, 247, 0.08)',
                    border: '1px solid rgba(79, 195, 247, 0.3)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#B3E5FC',
                    lineHeight: '1.45',
                  }}
                >
                  <strong style={{ color: '#4FC3F7', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                    🔬 Sensor Horizon & RCS Physics Analysis:
                  </strong>
                  <span style={{ color: '#E0E6ED' }}>{intel.physicsExplanation}</span>
                </div>
              )}
            </div>
          )}

          {/* SECTION 4c: TOPOGRAPHIC TERRAIN & LINE-OF-SIGHT (LOS) ANALYSIS */}
          {report.terrainDetails && (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '12px', color: '#81C784', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ⛰️ Topographic Terrain & Mountain LOS Analysis
                </strong>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background: report.terrainDetails.terrainMasked ? 'rgba(217, 83, 79, 0.2)' : 'rgba(79, 168, 95, 0.2)',
                    color: report.terrainDetails.terrainMasked ? '#E57373' : '#81C784',
                    border: `1px solid ${report.terrainDetails.terrainMasked ? '#D9534F' : '#4FA85F'}44`,
                  }}
                >
                  {report.terrainDetails.terrainMasked ? '⛰️ TERRAIN MASKED' : '📡 UNMASKED LINE-OF-SIGHT'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '10px',
                  background: '#09101B',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  fontSize: '11px',
                }}
              >
                {report.terrainDetails.terrainElevationM !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Target Ground Elevation:</span>
                    <strong style={{ color: '#E0E6ED' }}>{report.terrainDetails.terrainElevationM} m ASL</strong>
                  </div>
                )}

                {report.terrainDetails.blockingMountainName && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Intervening Mountain Crest:</span>
                    <strong style={{ color: '#FFB020' }}>{report.terrainDetails.blockingMountainName}</strong>
                  </div>
                )}

                {report.terrainDetails.terrainClutterPenalty !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Ground Clutter Loss:</span>
                    <strong style={{ color: report.terrainDetails.terrainClutterPenalty > 0.3 ? '#E57373' : '#81C784' }}>
                      {(report.terrainDetails.terrainClutterPenalty * 100).toFixed(0)}%
                    </strong>
                  </div>
                )}
              </div>

              {report.terrainDetails.specializedEquipmentUsed && report.terrainDetails.specializedEquipmentUsed.length > 0 && (
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)', display: 'block', marginBottom: '4px' }}>
                    Specialized Avionics & Equipment Deployed:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {report.terrainDetails.specializedEquipmentUsed.map((eq, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: '10px',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          background: 'rgba(0, 230, 118, 0.1)',
                          border: '1px solid rgba(0, 230, 118, 0.3)',
                          color: '#00E676',
                          fontWeight: 600,
                        }}
                      >
                        {eq}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {report.terrainDetails.terrainExplanation && (
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'rgba(129, 199, 132, 0.08)',
                    border: '1px solid rgba(129, 199, 132, 0.25)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#C8E6C9',
                    lineHeight: '1.4',
                  }}
                >
                  <strong style={{ color: '#81C784', display: 'block', marginBottom: '2px' }}>
                    Tactical Topographic Telemetry:
                  </strong>
                  {report.terrainDetails.terrainExplanation}
                </div>
              )}
            </div>
          )}

          {/* Section 4d: Combat Air Refueling & Logistics Telemetry */}
          {report.aarDetails && (
            <div
              style={{
                marginTop: '14px',
                padding: '14px',
                borderRadius: '8px',
                background: 'rgba(0, 229, 255, 0.04)',
                border: '1px solid rgba(0, 229, 255, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#00E5FF',
                    letterSpacing: '0.5px',
                  }}
                >
                  ⛽ Combat Air Refueling (AAR) & Logistics Telemetry
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background: report.aarDetails.wasEmergencyBingoRescue ? 'rgba(255, 82, 82, 0.2)' : 'rgba(0, 229, 255, 0.2)',
                    color: report.aarDetails.wasEmergencyBingoRescue ? '#FF5252' : '#00E5FF',
                    border: `1px solid ${report.aarDetails.wasEmergencyBingoRescue ? '#FF5252' : '#00E5FF'}55`,
                  }}
                >
                  {report.aarDetails.wasEmergencyBingoRescue ? '🚨 EMERGENCY BINGO RESCUE' : '✓ SCHEDULED AAR SORTIE'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Tanker Platform:</span>
                  <strong style={{ color: '#00E5FF' }}>{report.aarDetails.tankerName}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Fuel Offloaded:</span>
                  <strong style={{ color: '#00E676' }}>{report.aarDetails.fuelOffloadedKg.toLocaleString()} kg</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Transfer Method:</span>
                  <strong style={{ color: '#FFFFFF', textTransform: 'capitalize' }}>
                    {report.aarDetails.refuelingMethod.replace(/_/g, ' ')}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Range Extension:</span>
                  <strong style={{ color: '#FFB020' }}>+{report.aarDetails.combatRadiusExtensionKm} km</strong>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '11px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '8px 10px',
                  borderRadius: '4px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Pre-AAR Fuel:</span>
                  <strong style={{ color: report.aarDetails.preRefuelFuelPct < 20 ? '#FF5252' : '#FFD54F' }}>
                    {report.aarDetails.preRefuelFuelPct}%
                  </strong>
                </div>
                <span style={{ color: '#00E5FF', fontSize: '14px' }}>➔</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Post-AAR Fuel:</span>
                  <strong style={{ color: '#00E676' }}>
                    {report.aarDetails.postRefuelFuelPct}%
                  </strong>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Hook-Up Duration:</span>
                  <strong style={{ color: '#E0E6ED' }}>{report.aarDetails.durationSec}s</strong>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(0, 229, 255, 0.06)',
                  border: '1px solid rgba(0, 229, 255, 0.2)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#B2EBF2',
                  lineHeight: '1.4',
                }}
              >
                <strong style={{ color: '#00E5FF', display: 'block', marginBottom: '2px' }}>
                  Logistics & Operational Impact:
                </strong>
                {report.aarDetails.logisticsAssessment}
              </div>
            </div>
          )}

          {/* Section 4e: Airspace Sovereignty & Border Incursions Telemetry */}
          {report.borderDetails && (
            <div
              style={{
                marginTop: '14px',
                padding: '14px',
                borderRadius: '8px',
                background: 'rgba(255, 202, 40, 0.04)',
                border: '1px solid rgba(255, 202, 40, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#FFCA28',
                    letterSpacing: '0.5px',
                  }}
                >
                  🌐 Airspace Sovereignty & Border Incursions Telemetry
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background:
                      report.borderDetails.hostileAirspaceBreaches > 0
                        ? 'rgba(255, 82, 82, 0.2)'
                        : 'rgba(76, 175, 80, 0.2)',
                    color:
                      report.borderDetails.hostileAirspaceBreaches > 0 ? '#FF5252' : '#4CAF50',
                    border: `1px solid ${
                      report.borderDetails.hostileAirspaceBreaches > 0 ? '#FF5252' : '#4CAF50'
                    }55`,
                  }}
                >
                  {report.borderDetails.hostileAirspaceBreaches > 0
                    ? `🚨 ${report.borderDetails.hostileAirspaceBreaches} HOSTILE BORDER BREACHES`
                    : '✓ CORRIDOR SOVEREIGNTY COMPLIANT'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Active ROE Doctrine:
                  </span>
                  <strong style={{ color: '#FFCA28', textTransform: 'capitalize' }}>
                    {report.borderDetails.activeRoeDoctrine.replace(/_/g, ' ')}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Total Border Crossings:
                  </span>
                  <strong style={{ color: '#FFFFFF' }}>{report.borderDetails.totalIncursions}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Hostile Breaches:
                  </span>
                  <strong style={{ color: '#FF5252' }}>
                    {report.borderDetails.hostileAirspaceBreaches}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Neutral Airspace Violations:
                  </span>
                  <strong style={{ color: '#FFCA28' }}>{report.borderDetails.neutralViolations}</strong>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(255, 202, 40, 0.06)',
                  border: '1px solid rgba(255, 202, 40, 0.2)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#FFF8E1',
                  lineHeight: '1.4',
                }}
              >
                <strong style={{ color: '#FFCA28', display: 'block', marginBottom: '2px' }}>
                  Geopolitical & Airspace Assessment:
                </strong>
                {report.borderDetails.sovereigntyAssessment}
              </div>
            </div>
          )}

          {/* Section 4f: Space Reconnaissance & ASAT Warfare Telemetry */}
          {report.spaceDetails && (
            <div
              style={{
                marginTop: '14px',
                padding: '14px',
                borderRadius: '8px',
                background: 'rgba(0, 229, 255, 0.04)',
                border: '1px solid rgba(0, 229, 255, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#00E5FF',
                    letterSpacing: '0.5px',
                  }}
                >
                  🛰️ Space Reconnaissance & ASAT Warfare Telemetry
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background:
                      report.spaceDetails.destroyedSatellites > 0
                        ? 'rgba(255, 82, 82, 0.2)'
                        : 'rgba(0, 230, 118, 0.2)',
                    color:
                      report.spaceDetails.destroyedSatellites > 0 ? '#FF5252' : '#00E676',
                  }}
                >
                  {report.spaceDetails.destroyedSatellites > 0
                    ? `⚠️ ${report.spaceDetails.destroyedSatellites} ASAT KILLS`
                    : '🟢 CONSTELLATION SECURE'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '10px',
                  fontSize: '11px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Orbital Passes:
                  </span>
                  <strong style={{ color: '#00E5FF' }}>
                    {report.spaceDetails.totalPasses} Overhead Sweeps
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Operational Satellites:
                  </span>
                  <strong style={{ color: '#00E676' }}>
                    {report.spaceDetails.operationalSatellites} in LEO
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    ASAT Interceptions:
                  </span>
                  <strong style={{ color: report.spaceDetails.destroyedSatellites > 0 ? '#FF5252' : '#78909C' }}>
                    {report.spaceDetails.destroyedSatellites} Neutralized
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Space PID Contacts:
                  </span>
                  <strong style={{ color: '#FFD54F' }}>
                    {report.spaceDetails.targetsDiscoveredCount} Unmasked
                  </strong>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(0, 229, 255, 0.06)',
                  border: '1px solid rgba(0, 229, 255, 0.2)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#B2EBF2',
                  lineHeight: '1.4',
                }}
              >
                <strong style={{ color: '#00E5FF', display: 'block', marginBottom: '2px' }}>
                  Space ISR Impact:
                </strong>
                {report.spaceDetails.spaceAssessment}
              </div>
            </div>
          )}

          {/* Section 4g: Electronic Warfare (EW), GPS Denial & SEAD Telemetry */}
          {report.ewDetails && (
            <div
              style={{
                background: 'var(--card-bg)',
                border: '1px solid rgba(224, 64, 251, 0.3)',
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#E040FB' }}>
                  ⚡ Section 4g: Electronic Attack (EA), GPS Denial & SEAD Strike Telemetry
                </h4>
                <span
                  style={{
                    fontSize: '9px',
                    padding: '2px 6px',
                    background: 'rgba(224, 64, 251, 0.15)',
                    color: '#E040FB',
                    borderRadius: '4px',
                    fontWeight: 700,
                  }}
                >
                  SPECTRUM DOMINANCE
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  fontSize: '11px',
                  background: 'rgba(0, 0, 0, 0.2)',
                  padding: '10px',
                  borderRadius: '4px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Radars Suppressed:
                  </span>
                  <strong style={{ color: '#E040FB' }}>
                    {report.ewDetails.radarsJammedCount} Radars Jammed
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Active EW Sorties:
                  </span>
                  <strong style={{ color: '#00E5FF' }}>
                    {report.ewDetails.jammingSortiesCount} Jammers Active
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    GPS Denial Strikes:
                  </span>
                  <strong style={{ color: '#FFB74D' }}>
                    {report.ewDetails.gpsDeniedStrikesCount} Missiles (±{report.ewDetails.averageInsDriftM}m INS Drift)
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    SEAD Anti-Radiation:
                  </span>
                  <strong style={{ color: '#FF5252' }}>
                    {report.ewDetails.antiRadiationHitsCount} / {report.ewDetails.antiRadiationStrikesCount} Direct Hits
                  </strong>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(224, 64, 251, 0.06)',
                  border: '1px solid rgba(224, 64, 251, 0.2)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#F8BBD0',
                  lineHeight: '1.4',
                }}
              >
                <strong style={{ color: '#E040FB', display: 'block', marginBottom: '2px' }}>
                  Electronic Warfare Assessment:
                </strong>
                {report.ewDetails.ewAssessment}
              </div>
            </div>
          )}

          {/* Section 4h: Carrier Strike Group (CSG) & Moving Airbase Operations */}
          {report.csgDetails && (
            <div
              style={{
                background: 'var(--card-bg)',
                border: '1px solid rgba(0, 229, 255, 0.3)',
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#00E5FF' }}>
                  🚢 Section 4h: Carrier Strike Group (CSG) & Moving Airbase Operations
                </h4>
                <span
                  style={{
                    fontSize: '9px',
                    padding: '2px 6px',
                    background: 'rgba(0, 229, 255, 0.15)',
                    color: '#00E5FF',
                    borderRadius: '4px',
                    fontWeight: 700,
                  }}
                >
                  NAVAL AIRPOWER
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '10px',
                  borderRadius: '4px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Total Carrier Sorties:
                  </span>
                  <strong style={{ color: '#00E5FF' }}>{report.csgDetails.totalCarrierSorties}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Flight Deck Traps:
                  </span>
                  <strong style={{ color: '#00E676' }}>{report.csgDetails.carrierTrapsCompleted}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>
                    Standoff Strikes:
                  </span>
                  <strong style={{ color: '#FF5252' }}>{report.csgDetails.carrierStrikesLaunched}</strong>
                </div>
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(0, 229, 255, 0.06)',
                  border: '1px solid rgba(0, 229, 255, 0.2)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#E0F7FA',
                  lineHeight: '1.4',
                }}
              >
                <strong style={{ color: '#00E5FF', display: 'block', marginBottom: '2px' }}>
                  Carrier Air Wing Assessment:
                </strong>
                {report.csgDetails.csgAssessment}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
          <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
            War Simulation Tactical Command • After-Action Analysis System
          </span>
          <button className="wg-btn" onClick={onClose}>
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
