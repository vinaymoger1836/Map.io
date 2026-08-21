'use client';

/**
 * War Simulation Master After-Action Report (AAR) Modal
 *
 * Consolidates the real-time operational debrief:
 * 1. Executive Summary & Loss Exchange Ratio (LER).
 * 2. Force Casualties & Personnel Losses (KIA/WIA).
 * 3. Munitions Expenditure & Strike Success Rates.
 * 4. Chronological Battle Event Timeline.
 * 5. Publication-ready Markdown export & download.
 */

import React, { useMemo } from 'react';
import { type WarSimSession } from '@/lib/warSimTypes';
import { formatSimTime } from '@/lib/warSimEngine';
import { downloadFile, copyTextToClipboard } from '@/lib/scenarioIO';

export interface WarSimAarModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: WarSimSession;
}

export function WarSimAarModal({ isOpen, onClose, session }: WarSimAarModalProps) {
  if (!isOpen) return null;

  const { playerIso, enemyIso, personnel, entities, activeMissiles, eventLog, simTimeSec } = session;

  // Compute casualty metrics
  const playerUnits = entities.filter((e) => e.iso === playerIso);
  const enemyUnits = entities.filter((e) => e.iso === enemyIso);

  const playerDestroyed = playerUnits.filter((e) => e.status === 'destroyed');
  const enemyDestroyed = enemyUnits.filter((e) => e.status === 'destroyed');

  const playerDamaged = playerUnits.filter((e) => e.status === 'in_repair' || e.status === 'damaged_rtb');
  const enemyDamaged = enemyUnits.filter((e) => e.status === 'in_repair' || e.status === 'damaged_rtb');

  const playerActive = playerUnits.filter((e) => e.status !== 'destroyed' && e.status !== 'in_repair' && e.status !== 'damaged_rtb');
  const enemyActive = enemyUnits.filter((e) => e.status !== 'destroyed' && e.status !== 'in_repair' && e.status !== 'damaged_rtb');

  // Loss Exchange Ratio (LER)
  const playerLossCount = playerDestroyed.reduce((acc, u) => acc + u.count, 0);
  const enemyLossCount = enemyDestroyed.reduce((acc, u) => acc + u.count, 0);

  const ler =
    playerLossCount === 0 && enemyLossCount === 0
      ? '1.00'
      : playerLossCount === 0
        ? `${enemyLossCount}.00 : 0`
        : (enemyLossCount / playerLossCount).toFixed(2);

  // Generate Markdown Briefing Text
  const markdownText = useMemo(() => {
    return `# MASTER AFTER-ACTION REPORT: ${session.name}
**Date of Engagement**: ${new Date(session.createdAt).toLocaleDateString()}
**Elapsed Simulation Time**: ${formatSimTime(simTimeSec)}
**Participants**: ${playerIso} (Blue Force) vs ${enemyIso} (Red Force)

---

## 1. Executive Summary & Strategic Verdict
- **Loss Exchange Ratio (Enemy Losses per Friendly Loss)**: ${ler}
- **Friendly (${playerIso}) Units Active**: ${playerActive.length} | **Damaged**: ${playerDamaged.length} | **Destroyed**: ${playerDestroyed.length}
- **Adversary (${enemyIso}) Units Active**: ${enemyActive.length} | **Damaged**: ${enemyDamaged.length} | **Destroyed**: ${enemyDestroyed.length}

---

## 2. Platform Casualty & Order of Battle Ledger
### Friendly Forces (${playerIso}):
${playerUnits.map((u) => `- **${u.name}**: ${u.status.toUpperCase()} (${u.currentFuelPct.toFixed(0)}% fuel, ${u.personnel} personnel)`).join('\n') || '- No units deployed.'}

### Adversary Forces (${enemyIso}):
${enemyUnits.map((u) => `- **${u.name}**: ${u.status.toUpperCase()} (${u.currentFuelPct.toFixed(0)}% fuel, ${u.personnel} personnel)`).join('\n') || '- No units deployed.'}

---

## 3. Chronological Operational Timeline (${eventLog.length} Recorded Events)
${eventLog.map((e) => `[${e.timeFormatted}] **${e.title}** (${e.faction.toUpperCase()}): ${e.detail}`).join('\n')}
`;
  }, [session, simTimeSec, playerIso, enemyIso, ler, playerActive, playerDamaged, playerDestroyed, enemyActive, enemyDamaged, enemyDestroyed, playerUnits, enemyUnits, eventLog]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 10, 18, 0.88)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#0E1724',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '840px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          color: 'var(--paper)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📋</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Master After-Action Report (AAR)
              </h2>
              <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
                {session.name} · Elapsed Time: {formatSimTime(simTimeSec)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--paper-dim)', fontSize: '18px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Executive Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div style={{ background: '#09101B', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)' }}>Loss Exchange Ratio</span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#4FC3F7', marginTop: '4px' }}>{ler}</div>
              <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Adversary per friendly loss</span>
            </div>

            <div style={{ background: '#09101B', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', borderTop: `3px solid ${session.playerColor}` }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)' }}>Blue ({playerIso}) Losses</span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: playerDestroyed.length ? '#D9534F' : '#4FA85F', marginTop: '4px' }}>
                {playerDestroyed.length} destroyed <span style={{ fontSize: '12px', color: 'var(--paper-dim)' }}>({playerDamaged.length} damaged)</span>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>{playerActive.length} mission capable</span>
            </div>

            <div style={{ background: '#09101B', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', borderTop: `3px solid ${session.enemyColor}` }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)' }}>Red ({enemyIso}) Losses</span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: enemyDestroyed.length ? '#D9534F' : '#4FA85F', marginTop: '4px' }}>
                {enemyDestroyed.length} destroyed <span style={{ fontSize: '12px', color: 'var(--paper-dim)' }}>({enemyDamaged.length} damaged)</span>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>{enemyActive.length} mission capable</span>
            </div>
          </div>

          {/* Chronological Event Log */}
          <div style={{ background: '#09101B', padding: '14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', textTransform: 'uppercase', color: 'var(--paper)' }}>
              Operational Event Log ({eventLog.length} Events)
            </h3>
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {eventLog.length === 0 && <p style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>No combat events recorded yet.</p>}
              {eventLog.slice().reverse().map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: '6px 8px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderLeft: `3px solid ${e.type === 'impact' ? '#D9534F' : e.type === 'alert' ? '#FFB020' : '#4FA85F'}`,
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <strong style={{ color: 'var(--paper)' }}>{e.title}</strong>
                    <span style={{ fontFamily: 'monospace', color: 'var(--paper-dim)' }}>{e.timeFormatted}</span>
                  </div>
                  <p style={{ margin: 0, color: 'var(--paper-dim)' }}>{e.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="wg-btn"
              style={{ fontSize: '11px' }}
              onClick={() => copyTextToClipboard(markdownText)}
            >
              📋 Copy Markdown
            </button>
            <button
              className="wg-btn"
              style={{ fontSize: '11px' }}
              onClick={() => downloadFile(`${session.name.toLowerCase().replace(/\s+/g, '-')}-aar.md`, markdownText, 'text/markdown')}
            >
              💾 Export Markdown Report
            </button>
          </div>
          <button className="wg-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
