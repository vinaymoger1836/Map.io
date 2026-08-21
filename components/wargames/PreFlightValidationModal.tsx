'use client';

/**
 * Pre-Flight Validation Modal for War Simulation
 *
 * Displays a rigorous readiness audit of all allocated military systems before
 * simulation launch. Flags any missing critical fields (combat radius, speeds,
 * radar ranges, antenna heights, weapon ranges, Pk) with one-click navigation
 * to the Configuration Suite.
 */

import React from 'react';
import { type OrbatValidationResult, type SystemValidationReport } from '@/lib/specs';

export interface PreFlightValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConfiguration: (systemId?: string) => void;
  playerValidation: OrbatValidationResult;
  enemyValidation: OrbatValidationResult;
  playerName: string;
  enemyName: string;
}

export function PreFlightValidationModal({
  isOpen,
  onClose,
  onOpenConfiguration,
  playerValidation,
  enemyValidation,
  playerName,
  enemyName,
}: PreFlightValidationModalProps) {
  if (!isOpen) return null;

  const totalFailed = playerValidation.failedCount + enemyValidation.failedCount;
  const allPassed = totalFailed === 0;

  const renderReportsList = (reports: SystemValidationReport[], nationLabel: string) => {
    const failedReports = reports.filter((r) => !r.valid);
    if (failedReports.length === 0) {
      return (
        <div style={{ padding: '8px 12px', background: 'rgba(79, 168, 95, 0.1)', border: '1px solid #4FA85F', borderRadius: '4px', margin: '8px 0', fontSize: '11px', color: '#4FA85F' }}>
          ✅ All systems for {nationLabel} passed operational readiness validation.
        </div>
      );
    }

    return (
      <div style={{ marginTop: '8px' }}>
        <h4 style={{ fontSize: '12px', color: '#D9534F', margin: '6px 0' }}>
          ⚠️ {nationLabel} — {failedReports.length} Systems Incomplete:
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {failedReports.map((r) => (
            <div
              key={r.systemId}
              style={{
                background: 'rgba(217, 83, 79, 0.08)',
                border: '1px solid rgba(217, 83, 79, 0.3)',
                borderRadius: '4px',
                padding: '8px 10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--paper)' }}>
                  {r.systemName} <em style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>({r.domain})</em>
                </span>
                <button
                  className="wg-btn"
                  style={{ fontSize: '10px', padding: '2px 8px', borderColor: '#4F9FD6', color: '#4F9FD6' }}
                  onClick={() => {
                    onClose();
                    onOpenConfiguration(r.systemId);
                  }}
                >
                  ⚙️ Fix in Configuration
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11px', color: 'var(--paper-dim)' }}>
                {r.missingFields.map((m, idx) => (
                  <li key={idx} style={{ marginTop: '2px' }}>
                    <strong style={{ color: '#E8833A' }}>{m.label}</strong> ({m.field}): {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 10, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#0E1724',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>{allPassed ? '🛡️' : '⚠️'}</span>
            <h3 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Pre-Flight Operational Readiness Audit
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-dim)',
              fontSize: '16px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--paper-dim)', lineHeight: 1.5 }}>
            {allPassed
              ? 'All assigned military systems have verified kinematic speeds, combat radiuses, radar horizons, and weapon envelopes. The simulation is ready for launch.'
              : 'The following platforms are missing critical physical specifications required by the real-time simulation engine (e.g. combat radius for sorties, speed for transit, radar horizons, or weapon kill probabilities).'}
          </p>

          {renderReportsList(playerValidation.reports, playerName)}
          {renderReportsList(enemyValidation.reports, enemyName)}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button className="wg-btn" onClick={onClose}>
            Back to Setup
          </button>
          {!allPassed && (
            <button
              className="wg-btn"
              style={{ background: '#4F9FD6', color: '#0C141D', borderColor: '#4F9FD6', fontWeight: 600 }}
              onClick={() => {
                onClose();
                onOpenConfiguration();
              }}
            >
              Open Configuration Suite
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
