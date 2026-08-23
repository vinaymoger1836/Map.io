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

  const categoryColor = isDefensive ? '#FF5252' : isOffensive ? '#FF9800' : '#4FC3F7';
  const categoryLabel = isDefensive
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0D1520 0%, #060B12 100%)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(79, 195, 247, 0.1)',
          overflow: 'hidden',
          color: '#E0E6ED',
          fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  letterSpacing: '0.8px',
                  color: categoryColor,
                  background: `${categoryColor}22`,
                  border: `1px solid ${categoryColor}55`,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                }}
              >
                {categoryLabel}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--paper-dim)', fontWeight: 600 }}>
                {report.timeFormatted}
              </span>
            </div>
            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
              {report.title}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {report.lngLat && onFlyToLocation && (
              <button
                type="button"
                className="wg-btn"
                onClick={() => onFlyToLocation(report.lngLat!)}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#4FC3F7',
                  borderColor: 'rgba(79, 195, 247, 0.3)',
                  background: 'rgba(79, 195, 247, 0.1)',
                }}
              >
                <span>📍</span> Map Location
              </button>
            )}
            <button
              type="button"
              className="wg-btn"
              onClick={onClose}
              style={{ padding: '4px 8px', fontSize: '13px', color: 'var(--paper-dim)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Executive Summary */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              background: '#070E17',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '12px',
              lineHeight: 1.5,
              color: '#CFD8DC',
            }}
          >
            <strong style={{ color: '#FFFFFF', display: 'block', marginBottom: '2px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Operational Incident Summary
            </strong>
            {report.summary}
          </div>

          {/* Section 1: Engagement Forces & PID Status */}
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
                    {isDefensive ? '🛡️ Defending Platform' : '🚀 Attacking Platform'}
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

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '10.5px', color: 'var(--paper-dim)' }}>
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
                      {isDefensive ? '⚔️ Opposing Threat' : '🎯 Target Force'}
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

                  <div style={{ fontSize: '10.5px', color: 'var(--paper-dim)', lineHeight: 1.35 }}>
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
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '10px',
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

                <div>
                  <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Domain Classification:</span>
                  <strong style={{ color: '#FFFFFF' }}>{intel.discoveredDomain}</strong>
                </div>

                {intel.rcsM2 !== undefined && (
                  <div>
                    <span style={{ color: 'var(--paper-dim)', display: 'block', fontSize: '10px' }}>Target RCS Footprint:</span>
                    <strong style={{ color: '#4FC3F7' }}>{intel.rcsM2 >= 1 ? `${intel.rcsM2.toFixed(1)} m²` : `${intel.rcsM2} m²`}</strong>
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
