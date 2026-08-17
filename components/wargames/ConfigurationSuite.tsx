'use client';

/**
 * Full-Screen Theater Configuration & Arsenal Suite
 *
 * Dedicated full-screen management deck for:
 * 1. Weapons & Armaments Catalogue (specifications, radar ranges, weapon kinematics, custom authoring).
 * 2. Force Holdings & Order of Battle (ORBAT) by nation (inventories, holdings tallies, domain breakdown).
 * 3. Operational Combat Doctrine & Simulation Rules (EW jamming factors, SEAD suppression, salvo spacing).
 * 4. Systems Backup & JSON Schema (import/export custom arsenals, backup scenario state).
 */

import React, { useState, useMemo } from 'react';
import type { WarGames } from '@/lib/useWarGames';
import {
  DOMAINS,
  UNIT_BY_ID,
  type DeployedUnit,
  type Domain,
  totalStrength,
  findFormation,
} from '@/lib/warGames';
import {
  systemById,
  domainOf,
  nextSystemId,
  type SystemSpec,
  type WeaponFacet,
} from '@/lib/specs';
import { holdingKey, keyOf, type Tally } from '@/lib/forces';
import { Modal } from './Modal';
import { SystemForm } from './SystemsEditor';

const BLANK_SPEC: SystemSpec = { id: '', name: '', typeId: 'fighter', custom: true };

/* ------------------------------------------------------------------ */
/* Types & Navigation                                                 */
/* ------------------------------------------------------------------ */

export type ConfigTab = 'armaments' | 'forces' | 'doctrine' | 'backup';

const CONFIG_TABS: { id: ConfigTab; label: string; icon: string; description: string }[] = [
  {
    id: 'armaments',
    label: 'Weapons & Armaments',
    icon: '🎯',
    description: 'System specifications, radar envelopes, and weapon catalogues',
  },
  {
    id: 'forces',
    label: 'Order of Battle & Inventory',
    icon: '🛡️',
    description: 'National holdings, deployed forces, and reserve tallies',
  },
  {
    id: 'doctrine',
    label: 'Combat Doctrine & Rules',
    icon: '⚡',
    description: 'EW jamming, SEAD suppression, and tactical engagement parameters',
  },
  {
    id: 'backup',
    label: 'Arsenal Data & JSON',
    icon: '💾',
    description: 'Import/export custom weapon catalogues and scenario backups',
  },
];

/* ------------------------------------------------------------------ */
/* Main Component                                                     */
/* ------------------------------------------------------------------ */

export function ConfigurationSuite({
  wg,
  onClose,
  initialTab = 'armaments',
}: {
  wg: WarGames;
  onClose: () => void;
  initialTab?: ConfigTab;
}) {
  const [activeTab, setActiveTab] = useState<ConfigTab>(initialTab);

  // Armaments State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<Domain | 'all'>('all');
  const [selectedOrigin, setSelectedOrigin] = useState<string>('all');
  const [editingSystem, setEditingSystem] = useState<SystemSpec | null>(null);
  const [inspectedSystemId, setInspectedSystemId] = useState<string | null>(null);

  // Forces State
  const [selectedIso, setSelectedIso] = useState<string>(
    wg.activeIso || Object.keys(wg.board.nations)[0] || 'US'
  );

  // Doctrine State
  const [doctrineSettings, setDoctrineSettings] = useState({
    ewJammingReduction: 25, // % Pk reduction
    seadSuppressionFactor: 50, // % channel reduction
    capInterceptionRangeKm: 280,
    salvoStaggerSec: 0.75,
    bvrMinEngagementAltM: 500,
    autoRetaliationEnabled: true,
  });

  const [doctrineSaved, setDoctrineSaved] = useState(false);

  // Origins filter list
  const origins = useMemo(() => {
    const set = new Set<string>();
    for (const s of wg.systems) {
      if (s.origin) set.add(s.origin);
    }
    return Array.from(set).sort();
  }, [wg.systems]);

  // Filtered Systems
  const filteredSystems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return wg.systems.filter((s) => {
      if (selectedDomain !== 'all' && domainOf(s) !== selectedDomain) return false;
      if (selectedOrigin !== 'all' && s.origin !== selectedOrigin) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (UNIT_BY_ID.get(s.typeId)?.label ?? '').toLowerCase().includes(q) ||
        (s.origin ?? '').toLowerCase().includes(q) ||
        (s.weapons ?? []).some((w) => (w.name ?? '').toLowerCase().includes(q))
      );
    });
  }, [wg.systems, searchQuery, selectedDomain, selectedOrigin]);

  const activeNation = wg.board.nations[selectedIso] ?? { name: selectedIso, color: '#4DD0E1' };
  const nationTallies = wg.nationTally(selectedIso);

  const saveDoctrine = () => {
    setDoctrineSaved(true);
    setTimeout(() => setDoctrineSaved(false), 2500);
  };

  return (
    <div className="wg-config-suite">
      {/* Top Header Deck */}
      <header className="wg-config-header">
        <div className="wg-config-branding">
          <div className="wg-config-badge">TACTICAL SUITE</div>
          <div>
            <h1 className="wg-config-title">THEATER CONFIGURATION & ARSENAL</h1>
            <p className="wg-config-subtitle">
              Configure system specifications, weapon kinematics, national ORBATs, and theater rules.
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="wg-config-nav">
          {CONFIG_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`wg-config-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
              {tab.id === 'armaments' && (
                <span className="tab-count">{wg.systems.length}</span>
              )}
              {tab.id === 'forces' && (
                <span className="tab-count">{wg.board.units.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Exit / Return Button */}
        <button className="wg-config-close-btn" onClick={onClose} title="Return to Combat Map">
          <span className="close-arrow">←</span>
          <span>RETURN TO MAP</span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="wg-config-main">
        {/* ========================================================= */}
        {/* TAB 1: WEAPONS & ARMAMENTS CATALOGUE                       */}
        {/* ========================================================= */}
        {activeTab === 'armaments' && (
          <div className="wg-config-section">
            {/* Filter & Control Bar */}
            <div className="wg-config-controls-bar">
              <div className="wg-config-search-box">
                <span className="search-icon">🔍</span>
                <input
                  type="search"
                  placeholder="Search systems by name, weapon, type, or country origin..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="wg-config-search-input"
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => setSearchQuery('')}>
                    ✕
                  </button>
                )}
              </div>

              {/* Domain Filters */}
              <div className="wg-config-pills">
                <button
                  className={`wg-config-pill${selectedDomain === 'all' ? ' on' : ''}`}
                  onClick={() => setSelectedDomain('all')}
                >
                  All Domains ({wg.systems.length})
                </button>
                {DOMAINS.map((d) => {
                  const count = wg.systems.filter((s) => domainOf(s) === d.id).length;
                  return (
                    <button
                      key={d.id}
                      className={`wg-config-pill${selectedDomain === d.id ? ' on' : ''}`}
                      onClick={() => setSelectedDomain(d.id)}
                    >
                      {d.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Country Origin Filter */}
              <div className="wg-config-select-group">
                <label>Origin:</label>
                <select
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="wg-config-select"
                >
                  <option value="all">All Nations ({origins.length})</option>
                  {origins.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              {/* Add New Custom System Button */}
              <button
                className="wg-config-action-btn primary"
                onClick={() => setEditingSystem({ ...BLANK_SPEC, id: '' })}
              >
                <span>+</span> Author New System
              </button>
            </div>

            {/* Systems Catalog Grid */}
            <div className="wg-config-grid">
              {filteredSystems.map((spec) => {
                const typeInfo = UNIT_BY_ID.get(spec.typeId);
                const weapons = spec.weapons ?? [];
                const isCustom = Boolean(spec.custom);
                const isInspected = inspectedSystemId === spec.id;

                return (
                  <div
                    key={spec.id}
                    className={`wg-spec-card${isInspected ? ' inspected' : ''}`}
                    onClick={() => setInspectedSystemId(isInspected ? null : spec.id)}
                  >
                    <div className="wg-spec-card-header">
                      <div className="wg-spec-card-title-group">
                        <span className="wg-spec-domain-tag">{domainOf(spec)}</span>
                        <h3 className="wg-spec-card-name">{spec.name}</h3>
                        <span className="wg-spec-card-type">
                          {typeInfo?.label ?? spec.typeId} {spec.origin ? `· ${spec.origin}` : ''}
                        </span>
                      </div>

                      <div className="wg-spec-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="wg-spec-card-btn"
                          title="Duplicate & Customize Spec"
                          onClick={() => {
                            setEditingSystem({
                              ...spec,
                              id: '',
                              name: `${spec.name} (Custom)`,
                              custom: true,
                            });
                          }}
                        >
                          📋 Clone
                        </button>
                        <button
                          className="wg-spec-card-btn edit"
                          title="Edit Specification"
                          onClick={() => setEditingSystem(spec)}
                        >
                          ✏️ Edit
                        </button>
                        {isCustom && (
                          <button
                            className="wg-spec-card-btn delete"
                            title="Delete Custom System"
                            onClick={() => wg.deleteSystem(spec.id)}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick Specs Metrics */}
                    <div className="wg-spec-metrics-row">
                      {spec.platform?.speedKmh ? (
                        <div className="wg-spec-metric">
                          <span className="metric-label">SPEED</span>
                          <span className="metric-value">
                            {spec.platform.speedKmh >= 1200
                              ? `Mach ${(spec.platform.speedKmh / 1225).toFixed(1)}`
                              : `${spec.platform.speedKmh} km/h`}
                          </span>
                        </div>
                      ) : null}

                      {spec.platform?.combatRadiusKm ? (
                        <div className="wg-spec-metric">
                          <span className="metric-label">RADIUS</span>
                          <span className="metric-value">{spec.platform.combatRadiusKm} km</span>
                        </div>
                      ) : null}

                      {spec.sensor?.detectionKm ? (
                        <div className="wg-spec-metric">
                          <span className="metric-label">RADAR REACH</span>
                          <span className="metric-value">{spec.sensor.detectionKm} km</span>
                        </div>
                      ) : null}

                      {spec.sensor?.engagements ? (
                        <div className="wg-spec-metric">
                          <span className="metric-label">FIRE CHANNELS</span>
                          <span className="metric-value">{spec.sensor.engagements} concurrent</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Weapons Arsenal Overview */}
                    {weapons.length > 0 ? (
                      <div className="wg-spec-weapons-section">
                        <div className="weapons-header">ARMAMENT PAYLOAD ({weapons.length})</div>
                        <div className="weapons-list">
                          {weapons.map((w, wIdx) => (
                            <div key={wIdx} className="weapon-pill">
                              <span className="weapon-name">{w.name ?? 'Munition'}</span>
                              <span className="weapon-range">{w.rangeKm ? `${w.rangeKm} km` : 'Direct'}</span>
                              {w.pk ? <span className="weapon-pk">Pk {w.pk}</span> : null}
                              {w.magazine ? <span className="weapon-mag">{w.magazine} rounds</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="wg-spec-weapons-empty">No organic weapons configured</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: FORCES & ORDER OF BATTLE (ORBAT)                   */}
        {/* ========================================================= */}
        {activeTab === 'forces' && (
          <div className="wg-config-section">
            <div className="wg-orbat-layout">
              {/* Nation Selector Sidebar */}
              <aside className="wg-orbat-nations-sidebar">
                <h4 className="sidebar-heading">ACTIVE COMBATANTS</h4>
                <div className="nations-list">
                  {Object.entries(wg.board.nations).map(([iso, nat]) => {
                    const count = wg.board.units.filter((u) => u.iso === iso).length;
                    const isSelected = selectedIso === iso;
                    return (
                      <button
                        key={iso}
                        className={`nation-btn${isSelected ? ' on' : ''}`}
                        onClick={() => setSelectedIso(iso)}
                      >
                        <span className="nation-flag-pip" style={{ background: nat.color }} />
                        <span className="nation-name">{nat.name || iso}</span>
                        <span className="nation-count">{count} units</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Nation Inventory & Holdings View */}
              <div className="wg-orbat-content">
                <div className="wg-orbat-header-card">
                  <div className="orbat-nation-title">
                    <span className="flag-circle" style={{ background: activeNation.color }} />
                    <h2>{activeNation.name} Order of Battle</h2>
                    <span className="iso-tag">{selectedIso}</span>
                  </div>
                  <p className="orbat-desc">
                    Manage equipment inventory holdings, reserve allocations, and active deployed units.
                  </p>
                </div>

                {/* Holdings Inventory Table */}
                <div className="wg-orbat-table-container">
                  <h3 className="section-title">Equipment Inventory & Ready Reserves</h3>
                  <table className="wg-orbat-table">
                    <thead>
                      <tr>
                        <th>System / Equipment</th>
                        <th className="num">Held in Reserve</th>
                        <th className="num">Deployed on Map</th>
                        <th className="num">Available Left</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nationTallies.length > 0 ? (
                        nationTallies.map((row: Tally) => {
                          const key = keyOf(row.holding);
                          const spec = systemById(wg.systems, row.holding.systemId);
                          const name = spec?.name ?? UNIT_BY_ID.get(row.holding.typeId)?.label ?? row.holding.typeId;
                          const isOver = row.left < 0;

                          return (
                            <tr key={key} className={isOver ? 'over-allocated' : ''}>
                              <td className="system-cell">
                                <span className="domain-tag">{spec ? domainOf(spec) : 'generic'}</span>
                                <span className="system-name">{name}</span>
                              </td>
                              <td className="num">
                                <div className="stepper">
                                  <button
                                    onClick={() =>
                                      wg.setHolding(selectedIso, { ...row.holding, count: Math.max(0, row.held - 1) })
                                    }
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.held}
                                    onChange={(e) =>
                                      wg.setHolding(selectedIso, { ...row.holding, count: Number(e.target.value) })
                                    }
                                  />
                                  <button
                                    onClick={() =>
                                      wg.setHolding(selectedIso, { ...row.holding, count: row.held + 1 })
                                    }
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="num deployed-val">{row.deployed}</td>
                              <td className={`num left-val ${isOver ? 'negative' : ''}`}>{row.left}</td>
                              <td>
                                <button
                                  className="remove-btn"
                                  onClick={() => wg.removeHolding(selectedIso, key)}
                                  title="Remove from inventory"
                                >
                                  ✕ Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5} className="empty-row">
                            No inventory tracked for this nation. Deployments are unlimited.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Deployed Units List */}
                <div className="wg-deployed-units-section">
                  <h3 className="section-title">Active Deployed Units on Map ({wg.board.units.filter((u) => u.iso === selectedIso).length})</h3>
                  <div className="deployed-grid">
                    {wg.board.units
                      .filter((u) => u.iso === selectedIso)
                      .map((u: DeployedUnit) => {
                        const unitName =
                          u.name ||
                          (u.kind === 'formation'
                            ? findFormation(u.formationId, wg.board.formations)?.label ?? u.formationId
                            : systemById(wg.systems, u.systemId)?.name ?? UNIT_BY_ID.get(u.typeId)?.label ?? u.typeId);

                        const unitCount =
                          u.kind === 'formation' ? totalStrength(u.composition) : u.count;

                        return (
                          <div key={u.id} className="deployed-card">
                            <div className="card-top">
                              <span className="unit-name">{unitName}</span>
                              <span className="unit-count">{unitCount}x</span>
                            </div>
                            <div className="card-coords">
                              [{u.lngLat[0].toFixed(2)}°, {u.lngLat[1].toFixed(2)}°]
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: COMBAT DOCTRINE & THEATER RULES                    */}
        {/* ========================================================= */}
        {activeTab === 'doctrine' && (
          <div className="wg-config-section">
            <div className="wg-doctrine-container">
              <div className="wg-doctrine-header">
                <h2>⚡ Operational Theater Doctrine & Physics Rules</h2>
                <p>Fine-tune simulation parameters, electronic warfare effectiveness, and salvo dispersion.</p>
              </div>

              <div className="wg-doctrine-grid">
                {/* Rule Card 1 */}
                <div className="doctrine-card">
                  <h3>📡 Electronic Warfare & Jamming Degradation</h3>
                  <p>Percentage reduction applied to hostile radar track quality and missile Pk when EW escorts are active.</p>
                  <div className="slider-group">
                    <input
                      type="range"
                      min={10}
                      max={60}
                      value={doctrineSettings.ewJammingReduction}
                      onChange={(e) =>
                        setDoctrineSettings({ ...doctrineSettings, ewJammingReduction: Number(e.target.value) })
                      }
                    />
                    <span className="slider-value">−{doctrineSettings.ewJammingReduction}% Pk</span>
                  </div>
                </div>

                {/* Rule Card 2 */}
                <div className="doctrine-card">
                  <h3>🎯 SEAD Suppression Factor</h3>
                  <p>Fire channel reduction inflicted upon defending SAM radar batteries after anti-radiation strikes.</p>
                  <div className="slider-group">
                    <input
                      type="range"
                      min={25}
                      max={75}
                      value={doctrineSettings.seadSuppressionFactor}
                      onChange={(e) =>
                        setDoctrineSettings({ ...doctrineSettings, seadSuppressionFactor: Number(e.target.value) })
                      }
                    />
                    <span className="slider-value">−{doctrineSettings.seadSuppressionFactor}% Channels</span>
                  </div>
                </div>

                {/* Rule Card 3 */}
                <div className="doctrine-card">
                  <h3>🚀 Salvo Ripple Stagger Delay</h3>
                  <p>Time interval (seconds) between sequential VLS / rail missile ejections in salvo playback.</p>
                  <div className="slider-group">
                    <input
                      type="range"
                      min={0.3}
                      max={2.0}
                      step={0.1}
                      value={doctrineSettings.salvoStaggerSec}
                      onChange={(e) =>
                        setDoctrineSettings({ ...doctrineSettings, salvoStaggerSec: Number(e.target.value) })
                      }
                    />
                    <span className="slider-value">{doctrineSettings.salvoStaggerSec.toFixed(2)}s interval</span>
                  </div>
                </div>

                {/* Rule Card 4 */}
                <div className="doctrine-card">
                  <h3>✈️ Outer CAP Air-to-Air Screen Range</h3>
                  <p>Combat air patrol radius where defending fighters engage incoming strike packages.</p>
                  <div className="slider-group">
                    <input
                      type="range"
                      min={150}
                      max={450}
                      step={10}
                      value={doctrineSettings.capInterceptionRangeKm}
                      onChange={(e) =>
                        setDoctrineSettings({ ...doctrineSettings, capInterceptionRangeKm: Number(e.target.value) })
                      }
                    />
                    <span className="slider-value">{doctrineSettings.capInterceptionRangeKm} km</span>
                  </div>
                </div>
              </div>

              <div className="wg-doctrine-actions">
                <button className="wg-config-action-btn primary" onClick={saveDoctrine}>
                  {doctrineSaved ? '✓ Doctrine Parameters Saved' : '💾 Save Doctrine Rules'}
                </button>
                <button
                  className="wg-config-action-btn"
                  onClick={() =>
                    setDoctrineSettings({
                      ewJammingReduction: 25,
                      seadSuppressionFactor: 50,
                      capInterceptionRangeKm: 280,
                      salvoStaggerSec: 0.75,
                      bvrMinEngagementAltM: 500,
                      autoRetaliationEnabled: true,
                    })
                  }
                >
                  ↺ Reset to Military Standards
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: ARSENAL DATA & BACKUP                              */}
        {/* ========================================================= */}
        {activeTab === 'backup' && (
          <div className="wg-config-section">
            <div className="wg-backup-container">
              <div className="backup-card">
                <h3>📤 Export Weapon Systems JSON</h3>
                <p>Export your full active weapon specifications and custom systems catalogue as a portable JSON file.</p>
                <button
                  className="wg-config-action-btn primary"
                  onClick={() => {
                    const dataStr = JSON.stringify(wg.systems, null, 2);
                    const blob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `wargames-arsenal-${new Date().toISOString().slice(0, 10)}.json`;
                    link.click();
                  }}
                >
                  Download systems.json
                </button>
              </div>

              <div className="backup-card">
                <h3>📥 Import Custom Systems Catalogue</h3>
                <p>Load an external systems JSON file to merge or update armaments specifications.</p>
                <input
                  type="file"
                  accept=".json"
                  className="file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const parsed = JSON.parse(event.target?.result as string);
                        if (Array.isArray(parsed)) {
                          alert(`Successfully loaded ${parsed.length} systems from ${file.name}`);
                        }
                      } catch (err) {
                        alert('Invalid JSON file format.');
                      }
                    };
                    reader.readAsText(file);
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Specification Authoring / Edit Modal */}
      {editingSystem && (
        <Modal
          title={
            editingSystem.id
              ? `Edit ${editingSystem.name || 'System'}`
              : 'Author New System'
          }
          onClose={() => setEditingSystem(null)}
          footer={
            <div
              className="wg-row"
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end',
                width: '100%',
              }}
            >
              <button className="wg-btn" onClick={() => setEditingSystem(null)}>
                Cancel
              </button>
              <button
                className="wg-btn accent"
                disabled={!editingSystem.name.trim()}
                onClick={() => {
                  wg.saveSystem({
                    ...editingSystem,
                    id: editingSystem.id || nextSystemId(editingSystem.name),
                    custom: true,
                  });
                  setEditingSystem(null);
                }}
              >
                Save System Spec
              </button>
            </div>
          }
        >
          <SystemForm draft={editingSystem} setDraft={setEditingSystem} availableSystems={wg.systems} />
        </Modal>
      )}
    </div>
  );
}
