/**
 * Interactive After-Action Report (AAR) Deck & Scenario Export Modal
 *
 * Provides a high-density, tabbed military debrief console with:
 * 1. Executive Combat Summary & Loss Exchange Ratio
 * 2. Munition & Ordinance Expenditure Ledger
 * 3. Platform Casualty & Damage Registry
 * 4. Tactical Lessons Learned & Doctrinal Insights
 * 5. Chronological Kill Chain Timeline
 * 6. One-Click Scenario JSON Export/Import & Markdown Report Downloads
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type ComprehensiveAarReport } from '@/lib/aarReport';
import {
  downloadFile,
  copyTextToClipboard,
  exportScenarioPackage,
  parseAndValidateScenarioJson,
  type CompleteScenarioPackage,
} from '@/lib/scenarioIO';
import { type WarGames } from '@/lib/useWarGames';

export interface AarModalProps {
  report: ComprehensiveAarReport;
  wg: WarGames;
  isOpen: boolean;
  onClose: () => void;
}

export function AarModal({ report, wg, isOpen, onClose }: AarModalProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'munitions' | 'casualties' | 'lessons' | 'timeline' | 'io'>('summary');
  const [isFullScreen, setIsFullScreen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(report.markdownBriefing);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadMarkdown = () => {
    const filename = `${report.id}-intelligence-brief.md`;
    downloadFile(filename, report.markdownBriefing, 'text/markdown');
  };

  const handleExportScenarioJson = () => {
    const bundle = wg.exportBundle(null);
    if (bundle) {
      downloadFile(`wargame-scenario-${Date.now()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    } else {
      const pkg = exportScenarioPackage(
        report.title,
        report.outcomeHeadline,
        wg.board.units,
        wg.board.formations,
        wg.board.nations,
        wg.raidWaypoints,
        {
          targetUnitId: wg.theaterTargetId,
          attackerIso: wg.theaterAttackerIso,
          phases: wg.theaterPhases,
        },
        {
          turns: wg.campaignTurns,
          balance: wg.campaignBalance,
        }
      );
      downloadFile(`wargame-scenario-${Date.now()}.json`, JSON.stringify(pkg, null, 2), 'application/json');
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = wg.importBundle(content);
      if (res.ok) {
        setImportSuccess('Scenario bundle successfully imported and loaded onto the map!');
        setImportError(null);
      } else {
        // Fallback to scenario package parser
        const pkg = parseAndValidateScenarioJson(content);
        if (pkg) {
          if (pkg.savedWaypoints) {
            wg.setRaidWaypoints(pkg.savedWaypoints);
          }
          if (pkg.theaterOperations) {
            if (pkg.theaterOperations.targetUnitId) wg.setTheaterTargetId(pkg.theaterOperations.targetUnitId);
            if (pkg.theaterOperations.attackerIso) wg.setTheaterAttackerIso(pkg.theaterOperations.attackerIso);
            if (pkg.theaterOperations.phases) {
              pkg.theaterOperations.phases.forEach((p) => wg.addTheaterPhase(p));
            }
          }
          setImportSuccess(`Successfully loaded scenario data: "${pkg.scenarioName}"`);
          setImportError(null);
        } else {
          setImportError(res.error || 'Failed to parse scenario file.');
          setImportSuccess(null);
        }
      }
    };
    reader.readAsText(file);
  };

  const isSuccess = report.missionSuccess;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isFullScreen ? 0 : '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: isFullScreen ? '100vw' : '1050px',
          height: isFullScreen ? '100vh' : '90vh',
          maxWidth: isFullScreen ? '100vw' : '96vw',
          maxHeight: isFullScreen ? '100vh' : '92vh',
          background: 'var(--panel)',
          border: isFullScreen ? 'none' : '1px solid var(--border)',
          borderRadius: isFullScreen ? '0px' : '8px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.75)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--paper)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 20px',
            background: 'var(--sidebar)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#E8833A' }}>
                📋 After-Action Intelligence Report (AAR)
              </span>
              <span className={`wg-tag ${isSuccess ? 'success' : 'loss'}`} style={{ fontSize: '10.5px' }}>
                {isSuccess ? 'OBJECTIVE ACCOMPLISHED' : 'MISSION REPULSED'}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--paper-dim)', marginTop: '3px' }}>
              {report.title} · {report.timestamp}
            </div>
          </div>

          {/* Quick Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="wg-btn"
              style={{ fontSize: '11px', padding: '5px 10px', background: copied ? '#4FA85F' : undefined }}
              onClick={handleCopy}
              title="Copy formatted markdown report"
            >
              {copied ? '✓ Copied Briefing' : '📋 Copy Brief'}
            </button>
            <button
              className="wg-btn"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={handleDownloadMarkdown}
              title="Download markdown briefing (.md)"
            >
              📄 Download MD
            </button>
            <button
              className="wg-btn"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={handleExportScenarioJson}
              title="Export complete scenario (.json)"
            >
              💾 Export Scenario
            </button>
            <button
              className="wg-salvo-btn"
              style={{ width: '28px', height: '28px', fontSize: '13px', marginLeft: '4px' }}
              onClick={() => setIsFullScreen(!isFullScreen)}
              title={isFullScreen ? 'Restore Windowed View' : 'Maximize Full Screen'}
            >
              {isFullScreen ? '🗗' : '⛶'}
            </button>
            <button
              className="wg-salvo-btn"
              style={{ width: '28px', height: '28px', fontSize: '15px' }}
              onClick={onClose}
              title="Close full-screen report"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--sidebar)',
            padding: '0 12px',
          }}
        >
          <button
            className={`wg-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'summary' ? 700 : 400 }}
          >
            📊 Executive Summary
          </button>
          <button
            className={`wg-tab-btn ${activeTab === 'munitions' ? 'active' : ''}`}
            onClick={() => setActiveTab('munitions')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'munitions' ? 700 : 400 }}
          >
            🎯 Munitions Matrix ({report.munitionMatrix.length})
          </button>
          <button
            className={`wg-tab-btn ${activeTab === 'casualties' ? 'active' : ''}`}
            onClick={() => setActiveTab('casualties')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'casualties' ? 700 : 400 }}
          >
            🎖 Casualties & Losses
          </button>
          <button
            className={`wg-tab-btn ${activeTab === 'lessons' ? 'active' : ''}`}
            onClick={() => setActiveTab('lessons')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'lessons' ? 700 : 400 }}
          >
            💡 Tactical Lessons ({report.tacticalLessons.length})
          </button>
          <button
            className={`wg-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
            onClick={() => setActiveTab('timeline')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'timeline' ? 700 : 400 }}
          >
            ⏱ Timeline Log ({report.chronologicalLog.length})
          </button>
          <button
            className={`wg-tab-btn ${activeTab === 'io' ? 'active' : ''}`}
            onClick={() => setActiveTab('io')}
            style={{ padding: '8px 14px', fontSize: '11.5px', fontWeight: activeTab === 'io' ? 700 : 400 }}
          >
            💾 Scenario I/O
          </button>
        </div>

        {/* Tab Content Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {/* TAB 1: EXECUTIVE SUMMARY */}
          {activeTab === 'summary' && (
            <div>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '6px',
                  background: isSuccess ? 'rgba(79, 168, 95, 0.12)' : 'rgba(217, 83, 79, 0.12)',
                  border: `1px solid ${isSuccess ? '#4FA85F' : '#D9534F'}`,
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: 700, color: isSuccess ? '#4FA85F' : '#D9534F' }}>
                  {report.outcomeVerdict}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--paper)', marginTop: '4px' }}>
                  {report.outcomeHeadline}
                </div>
              </div>

              {/* High-Level Stat Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
                <div className="wg-tactical-card" style={{ padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Attacking Force</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', color: '#E8833A' }}>
                    {report.attackerNation} ({report.attackerIso})
                  </div>
                </div>
                <div className="wg-tactical-card" style={{ padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Defending Force</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', color: '#4DD0E1' }}>
                    {report.defenderNation} ({report.defenderIso})
                  </div>
                </div>
                <div className="wg-tactical-card" style={{ padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Mission Outcome</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', color: isSuccess ? '#4FA85F' : '#D9534F' }}>
                    {isSuccess ? 'DEFEATED / OBLITERATED' : 'SHIELD HELD'}
                  </div>
                </div>
                <div className="wg-tactical-card" style={{ padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Attrition Exchange Ratio</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', color: '#FFB020' }}>
                    {report.attritionExchangeRatio}
                  </div>
                </div>
              </div>

              {/* Preview of Key Tactical Lessons */}
              {report.tacticalLessons.length > 0 && (
                <div className="wg-tactical-card" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#E8833A', marginBottom: '6px' }}>
                    Key Doctrinal Observations
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--paper-dim)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {report.tacticalLessons.slice(0, 3).map((l, idx) => (
                      <li key={idx}>
                        <strong style={{ color: 'var(--paper)' }}>{l.title}:</strong> {l.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MUNITIONS MATRIX */}
          {activeTab === 'munitions' && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--paper-dim)' }}>
                    <th style={{ padding: '6px 8px' }}>Side</th>
                    <th style={{ padding: '6px 8px' }}>Munition / Interceptor</th>
                    <th style={{ padding: '6px 8px' }}>Class</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Fired</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Intercepted</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Decoyed</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Hits</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Hit Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {report.munitionMatrix.map((m, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: m.side === 'attacker' ? '#E8833A' : '#4DD0E1' }}>
                        {m.side.toUpperCase()}
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{m.weaponName}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--paper-dim)' }}>{m.category.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.fired}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#D9534F' }}>{m.intercepted}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#FFB020' }}>{m.decoyedOrJammed}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4FA85F', fontWeight: 700 }}>{m.impacted}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: m.effectivenessPercent > 50 ? '#4FA85F' : '#D9534F' }}>
                        {m.effectivenessPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: CASUALTIES & LOSSES */}
          {activeTab === 'casualties' && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--paper-dim)' }}>
                    <th style={{ padding: '6px 8px' }}>Side</th>
                    <th style={{ padding: '6px 8px' }}>Platform / Objective</th>
                    <th style={{ padding: '6px 8px' }}>Domain</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Committed</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Losses</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Surviving</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.casualtyRegistry.map((c, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: c.side === 'attacker' ? '#E8833A' : '#4DD0E1' }}>
                        {c.side.toUpperCase()}
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.unitLabel}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--paper-dim)' }}>{c.domain}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.initialCount}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: c.lostCount > 0 ? '#D9534F' : 'var(--paper-dim)', fontWeight: 700 }}>
                        {c.lostCount}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4FA85F' }}>{c.survivingCount}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <span className={`wg-tag ${c.status === 'destroyed' || c.status === 'sunk' ? 'loss' : c.status === 'intact' ? 'success' : 'neutral'}`}>
                          {c.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: TACTICAL LESSONS */}
          {activeTab === 'lessons' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {report.tacticalLessons.map((l, idx) => (
                <div key={idx} className="wg-tactical-card" style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#E8833A' }}>
                      {l.title}
                    </span>
                    <span className="wg-tag" style={{ fontSize: '9.5px' }}>
                      {l.category.toUpperCase()}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--paper-dim)' }}>
                    {l.detail}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* TAB 5: CHRONOLOGICAL TIMELINE */}
          {activeTab === 'timeline' && (
            <ol className="wg-battlelog" style={{ margin: 0, padding: 0 }}>
              {report.chronologicalLog.map((evt, idx) => (
                <li key={idx} className="wg-battlelog-item">
                  <span className="wg-battlelog-dot neutral" />
                  <div className="wg-battlelog-card">
                    <div className="wg-battlelog-header">
                      <div className="wg-battlelog-meta">
                        <span className="wg-battlelog-time">{evt.timeFormatted}</span>
                        <span className="wg-battlelog-title">{evt.title}</span>
                      </div>
                      {evt.badgeText && <span className="wg-tag">{evt.badgeText}</span>}
                    </div>
                    <p className="wg-battlelog-detail">{evt.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* TAB 6: SCENARIO I/O */}
          {activeTab === 'io' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="wg-tactical-card" style={{ padding: '14px' }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#E8833A' }}>
                  Export Current Wargame Scenario (JSON)
                </h4>
                <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: 'var(--paper-dim)' }}>
                  Saves the entire battlefield configuration (units, custom loadouts, waypoints, theater operations, and campaign turns) to a standalone JSON file that can be shared or reloaded anytime.
                </p>
                <button className="wg-btn" onClick={handleExportScenarioJson}>
                  💾 Download Scenario JSON
                </button>
              </div>

              <div className="wg-tactical-card" style={{ padding: '14px' }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#4DD0E1' }}>
                  Import Saved Scenario (JSON)
                </h4>
                <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: 'var(--paper-dim)' }}>
                  Load a previously exported scenario JSON file to immediately populate the map and tactical panels.
                </p>
                <input
                  type="file"
                  accept=".json"
                  ref={fileInputRef}
                  onChange={handleImportFile}
                  style={{ display: 'none' }}
                />
                <button
                  className="wg-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📂 Select Scenario File (.json)
                </button>

                {importSuccess && (
                  <p className="wg-note" style={{ color: '#4FA85F', marginTop: '8px' }}>
                    ✦ {importSuccess}
                  </p>
                )}
                {importError && (
                  <p className="wg-note" style={{ color: '#D9534F', marginTop: '8px' }}>
                    ✕ {importError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
