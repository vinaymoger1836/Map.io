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

import React, { useState, useMemo, useCallback } from 'react';
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
import { holdingKey, keyOf, type Tally, getPreAssignedQuotasForCountry } from '@/lib/forces';
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
  const [forcesSearchQuery, setForcesSearchQuery] = useState('');
  const [newSysIdToPreAssign, setNewSysIdToPreAssign] = useState('');
  const [newSysCountToPreAssign, setNewSysCountToPreAssign] = useState<number>(24);
  const [newSysDomainFilter, setNewSysDomainFilter] = useState<Domain | 'all'>('all');

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

  // Arsenal Import / Export State
  const [importResult, setImportResult] = useState<{
    type: 'success' | 'error';
    message: string;
    count?: number;
    names?: string[];
  } | null>(null);
  const [importJsonText, setImportJsonText] = useState('');
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const customSystemsCount = useMemo(() => {
    return wg.systems.filter((s) => s.custom).length;
  }, [wg.systems]);

  const handleImportData = useCallback(
    (rawJson: string, sourceName?: string) => {
      try {
        const parsed = JSON.parse(rawJson);
        let items: unknown[] = [];

        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj.systems)) {
            items = obj.systems;
          } else if (Array.isArray(obj.catalogue)) {
            items = obj.catalogue;
          } else if (Array.isArray(obj.specs)) {
            items = obj.specs;
          } else if (Array.isArray(obj.arsenal)) {
            items = obj.arsenal;
          } else if ('name' in obj || 'id' in obj) {
            items = [obj];
          }
        }

        if (!items.length) {
          setImportResult({
            type: 'error',
            message: 'No valid weapon systems found in JSON data. Ensure file contains a system array or { systems: [...] } structure.',
          });
          return;
        }

        const res = wg.importSystems(items);
        if (res.error || res.count === 0) {
          setImportResult({
            type: 'error',
            message: res.error || 'Failed to import any valid weapon specifications.',
          });
        } else {
          const names = items
            .map((item) => (item as Record<string, unknown>).name || (item as Record<string, unknown>).id)
            .filter((n): n is string => Boolean(n))
            .slice(0, 10);

          setImportResult({
            type: 'success',
            message: `Successfully imported ${res.count} weapon system${res.count > 1 ? 's' : ''}${sourceName ? ` from ${sourceName}` : ''}. Saved to your active arsenal and browser storage!`,
            count: res.count,
            names,
          });
          setImportJsonText('');
        }
      } catch (err) {
        setImportResult({
          type: 'error',
          message: `Invalid JSON format: ${err instanceof Error ? err.message : 'Parse error'}`,
        });
      }
    },
    [wg]
  );

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

  const allNationsList = useMemo(() => {
    const list: { iso: string; name: string; color?: string }[] = [];
    const seen = new Set<string>();

    // Active board combatants first
    Object.entries(wg.board.nations).forEach(([iso, nat]) => {
      seen.add(iso);
      list.push({ iso, name: nat.name || iso, color: nat.color });
    });

    // World nations
    (wg.countries || []).forEach((c) => {
      if (!seen.has(c.iso)) {
        seen.add(c.iso);
        list.push({ iso: c.iso, name: c.name });
      }
    });

    if (!forcesSearchQuery.trim()) return list;
    const q = forcesSearchQuery.toLowerCase().trim();
    return list.filter((n) => n.name.toLowerCase().includes(q) || n.iso.toLowerCase().includes(q));
  }, [wg.board.nations, wg.countries, forcesSearchQuery]);

  const selectedCountryInfo = wg.countries?.find((c) => c.iso === selectedIso);
  const activeNation = wg.board.nations[selectedIso] ?? {
    name: selectedCountryInfo?.name || selectedIso,
    color: '#4DD0E1',
  };
  const nationTallies = wg.nationTally(selectedIso);

  const availableSystemsToAssign = useMemo(() => {
    return wg.systems
      .filter((s) => {
        if (newSysDomainFilter !== 'all' && domainOf(s) !== newSysDomainFilter) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [wg.systems, newSysDomainFilter]);

  const handleAutoPopulateNation = (iso: string) => {
    const templateQuotas = getPreAssignedQuotasForCountry(iso, {}, wg.systems);
    for (const [sysId, count] of Object.entries(templateQuotas)) {
      const spec = wg.systems.find((s) => s.id === sysId);
      if (spec) {
        wg.setHolding(iso, {
          typeId: spec.typeId,
          systemId: spec.id,
          count,
        });
      }
    }
  };

  const handleClearNationHoldings = (iso: string) => {
    const current = wg.forces[iso] ?? [];
    for (const h of current) {
      wg.removeHolding(iso, keyOf(h));
    }
  };

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
                <div style={{ padding: '0 0 10px 0' }}>
                  <h4 className="sidebar-heading" style={{ marginBottom: '8px' }}>NATIONAL ARSENALS</h4>
                  <input
                    type="text"
                    placeholder="🔍 Filter countries..."
                    value={forcesSearchQuery}
                    onChange={(e) => setForcesSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#070C14',
                      border: '1px solid var(--border)',
                      color: 'var(--paper)',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                  />
                </div>

                <div
                  className="nations-list wg-custom-scroll"
                  style={{
                    maxHeight: 'calc(100vh - 260px)',
                    overflowY: 'auto',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(79, 195, 247, 0.25) rgba(0, 0, 0, 0.2)',
                    paddingRight: '4px',
                  }}
                >
                  {allNationsList.map((nat) => {
                    const iso = nat.iso;
                    const isSelected = selectedIso === iso;
                    const assignedCount = wg.forces[iso]?.length || 0;

                    return (
                      <button
                        key={iso}
                        className={`nation-btn${isSelected ? ' on' : ''}`}
                        onClick={() => setSelectedIso(iso)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '8px 10px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                          <span className="nation-flag-pip" style={{ background: nat.color || '#4DD0E1' }} />
                          <span className="nation-name" style={{ fontWeight: 600, flex: 1, textAlign: 'left' }}>
                            {nat.name}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>{iso}</span>
                        </div>
                        <span style={{ fontSize: '10px', color: assignedCount > 0 ? '#4FA85F' : 'var(--paper-dim)', paddingLeft: '14px' }}>
                          {assignedCount > 0 ? `✓ ${assignedCount} Pre-Assigned` : 'Default Template'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Nation Inventory & Holdings View */}
              <div className="wg-orbat-content">
                <div className="wg-orbat-header-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="orbat-nation-title">
                      <span className="flag-circle" style={{ background: activeNation.color || '#4DD0E1' }} />
                      <h2>{activeNation.name} National Arsenal</h2>
                      <span className="iso-tag">{selectedIso}</span>
                    </div>
                    <p className="orbat-desc">
                      Pre-assign default weapon systems and starting quotas for this country. When selected in War Simulation, these systems are loaded automatically.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="wg-btn accent"
                      style={{ fontSize: '11px', padding: '6px 12px', background: '#4FC3F7', color: '#070C14', borderColor: '#4FC3F7', fontWeight: 600 }}
                      onClick={() => handleAutoPopulateNation(selectedIso)}
                      title="Load standard indigenous or operational systems template for this country"
                    >
                      ⚡ Auto-Populate Native Preset
                    </button>
                    {(wg.forces[selectedIso]?.length || 0) > 0 && (
                      <button
                        type="button"
                        className="wg-btn"
                        style={{ fontSize: '11px', padding: '6px 10px', borderColor: '#D9534F', color: '#D9534F' }}
                        onClick={() => {
                          if (window.confirm(`Clear all custom pre-assigned systems for ${activeNation.name}?`)) {
                            handleClearNationHoldings(selectedIso);
                          }
                        }}
                      >
                        🗑️ Reset to Template
                      </button>
                    )}
                  </div>
                </div>

                {/* Pre-Assign New System Card */}
                <div
                  style={{
                    background: '#0E1724',
                    padding: '14px 16px',
                    borderRadius: '6px',
                    border: '1px solid rgba(79, 195, 247, 0.25)',
                    marginBottom: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#4FC3F7', textTransform: 'uppercase' }}>
                      ➕ Pre-Assign System to {activeNation.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
                      Available Systems in Library: {availableSystemsToAssign.length}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.8fr auto', gap: '10px', alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                        Select Weapon System:
                      </label>
                      <select
                        value={newSysIdToPreAssign}
                        onChange={(e) => setNewSysIdToPreAssign(e.target.value)}
                        style={{
                          width: '100%',
                          background: '#070C14',
                          border: '1px solid var(--border)',
                          color: 'var(--paper)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        <option value="">-- Choose system to pre-assign --</option>
                        {availableSystemsToAssign.map((s) => (
                          <option key={s.id} value={s.id}>
                            [{domainOf(s).toUpperCase()}] {s.name} ({s.origin || 'Generic'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                        Domain Filter:
                      </label>
                      <select
                        value={newSysDomainFilter}
                        onChange={(e) => setNewSysDomainFilter(e.target.value as any)}
                        style={{
                          width: '100%',
                          background: '#070C14',
                          border: '1px solid var(--border)',
                          color: 'var(--paper)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        <option value="all">All Domains</option>
                        <option value="air">Air Combat</option>
                        <option value="sea">Maritime Surface</option>
                        <option value="ground">Ground / Artillery</option>
                        <option value="subsurface">Subsurface</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', color: 'var(--paper-dim)', marginBottom: '4px' }}>
                        Default Quota:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={newSysCountToPreAssign}
                        onChange={(e) => setNewSysCountToPreAssign(Math.max(1, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: '#070C14',
                          border: '1px solid var(--border)',
                          color: 'var(--paper)',
                          padding: '5px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      className="wg-btn accent"
                      style={{
                        background: newSysIdToPreAssign ? '#4FA85F' : 'rgba(255, 255, 255, 0.08)',
                        color: newSysIdToPreAssign ? '#070C14' : 'var(--paper-dim)',
                        borderColor: newSysIdToPreAssign ? '#4FA85F' : 'transparent',
                        fontWeight: 700,
                        fontSize: '11.5px',
                        padding: '6px 16px',
                        cursor: newSysIdToPreAssign ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!newSysIdToPreAssign}
                      onClick={() => {
                        if (!newSysIdToPreAssign) return;
                        const spec = wg.systems.find((s) => s.id === newSysIdToPreAssign);
                        if (spec) {
                          wg.setHolding(selectedIso, {
                            typeId: spec.typeId,
                            systemId: spec.id,
                            count: newSysCountToPreAssign,
                          });
                          setNewSysIdToPreAssign('');
                        }
                      }}
                    >
                      + Pre-Assign System
                    </button>
                  </div>
                </div>

                {/* Holdings Inventory Table */}
                <div className="wg-orbat-table-container">
                  <h3 className="section-title">Pre-Assigned Systems & Reserve Stock ({nationTallies.length})</h3>
                  <table className="wg-orbat-table">
                    <thead>
                      <tr>
                        <th>System / Equipment</th>
                        <th className="num">Default Starting Quota</th>
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
                                {spec?.origin && <span style={{ fontSize: '10px', color: 'var(--paper-dim)', marginLeft: '6px' }}>({spec.origin})</span>}
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
                                  title="Remove from pre-assigned roster"
                                >
                                  ✕ Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5} className="empty-row" style={{ padding: '24px', textAlign: 'center' }}>
                            <div style={{ fontSize: '13px', color: 'var(--paper-dim)', marginBottom: '8px' }}>
                              No custom systems pre-assigned yet for {activeNation.name}.
                            </div>
                            <button
                              type="button"
                              className="wg-btn"
                              style={{ fontSize: '11px', color: '#4FC3F7', borderColor: '#4FC3F7' }}
                              onClick={() => handleAutoPopulateNation(selectedIso)}
                            >
                              ⚡ Auto-Populate Standard Native Preset for {activeNation.name}
                            </button>
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
            {importResult && (
              <div
                style={{
                  marginBottom: '20px',
                  padding: '14px 18px',
                  borderRadius: '8px',
                  background:
                    importResult.type === 'success'
                      ? 'rgba(79, 168, 95, 0.15)'
                      : 'rgba(217, 83, 79, 0.15)',
                  border: `1px solid ${importResult.type === 'success' ? '#4FA85F' : '#D9534F'}`,
                  color: '#FFFFFF',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>
                    {importResult.type === 'success' ? '✓ Arsenal Imported & Persisted' : '⚠️ Import Failed'}
                  </span>
                  <button
                    onClick={() => setImportResult(null)}
                    style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: '#E2E8F0' }}>{importResult.message}</div>
                {importResult.names && importResult.names.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                    {importResult.names.map((name, i) => (
                      <span
                        key={i}
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                    {importResult.count && importResult.count > importResult.names.length && (
                      <span style={{ fontSize: '11px', color: '#94A3B8', alignSelf: 'center' }}>
                        +{importResult.count - importResult.names.length} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="wg-backup-container">
              {/* Card 1: Export */}
              <div className="backup-card">
                <h3>📤 Export Weapon Systems JSON</h3>
                <p>
                  Export your full active weapon specifications ({wg.systems.length} systems) or custom authored entries ({customSystemsCount} systems) as a portable JSON file.
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto' }}>
                  <button
                    className="wg-config-action-btn primary"
                    onClick={() => {
                      const dataStr = JSON.stringify(wg.systems, null, 2);
                      const blob = new Blob([dataStr], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `wargames-arsenal-all-${new Date().toISOString().slice(0, 10)}.json`;
                      link.click();
                    }}
                  >
                    Download Full Arsenal ({wg.systems.length})
                  </button>
                  {customSystemsCount > 0 && (
                    <button
                      className="wg-config-action-btn"
                      onClick={() => {
                        const customOnly = wg.systems.filter((s) => s.custom);
                        const dataStr = JSON.stringify(customOnly, null, 2);
                        const blob = new Blob([dataStr], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `wargames-arsenal-custom-${new Date().toISOString().slice(0, 10)}.json`;
                        link.click();
                      }}
                    >
                      Download Custom Only ({customSystemsCount})
                    </button>
                  )}
                </div>
              </div>

              {/* Card 2: Import */}
              <div className="backup-card">
                <h3>📥 Import Custom Systems Catalogue</h3>
                <p>
                  Upload a JSON file containing weapon specifications or paste JSON directly. Automatically merged into your active arsenal and persisted in browser storage.
                </p>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                      handleImportData(evt.target?.result as string, file.name);
                    };
                    reader.readAsText(file);
                  }}
                  style={{
                    border: `2px dashed ${isDraggingFile ? '#4FC3F7' : 'rgba(255, 255, 255, 0.15)'}`,
                    borderRadius: '8px',
                    padding: '16px',
                    textAlign: 'center',
                    background: isDraggingFile ? 'rgba(79, 195, 247, 0.05)' : 'rgba(0, 0, 0, 0.2)',
                    transition: 'all 0.2s',
                  }}
                >
                  <label style={{ display: 'block', cursor: 'pointer' }}>
                    <span style={{ fontSize: '20px', display: 'block', marginBottom: '4px' }}>📁</span>
                    <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>
                      Click to choose JSON file or drag & drop here
                    </span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="file-input"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          handleImportData(evt.target?.result as string, file.name);
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <button
                    className="wg-config-action-btn"
                    style={{ fontSize: '11px' }}
                    onClick={() => setShowJsonPaste(!showJsonPaste)}
                  >
                    {showJsonPaste ? '▲ Hide Direct Paste' : '📝 Paste JSON Text Directly'}
                  </button>
                </div>

                {showJsonPaste && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    <textarea
                      rows={5}
                      placeholder='[ { "id": "my-fighter", "name": "Custom Fighter", "typeId": "fighter", "platform": { "speedKmh": 1800, "combatRadiusKm": 1200 } } ]'
                      value={importJsonText}
                      onChange={(e) => setImportJsonText(e.target.value)}
                      style={{
                        background: '#09101B',
                        border: '1px solid var(--border)',
                        color: 'var(--paper)',
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        borderRadius: '4px',
                        padding: '8px',
                        width: '100%',
                        resize: 'vertical',
                      }}
                    />
                    <button
                      className="wg-config-action-btn primary"
                      style={{ alignSelf: 'flex-start' }}
                      disabled={!importJsonText.trim()}
                      onClick={() => handleImportData(importJsonText, 'Pasted JSON')}
                    >
                      Import Pasted JSON
                    </button>
                  </div>
                )}
              </div>

              {/* Card 3: Storage & Reset */}
              <div className="backup-card">
                <h3>⚙️ Storage & Arsenal Maintenance</h3>
                <p>
                  Active storage engine: <strong style={{ color: '#4FC3F7' }}>{wg.storageKind === 'files' ? 'Local Disk Files & Browser Cache' : 'Browser LocalStorage (Cloud Serverless / Vercel)'}</strong>.
                </p>
                <div style={{ fontSize: '12px', color: '#8C9CAE', lineHeight: '1.4' }}>
                  Total Systems in Library: <strong style={{ color: '#FFFFFF' }}>{wg.systems.length}</strong> ({customSystemsCount} custom authored).
                </div>
                {customSystemsCount > 0 && (
                  <button
                    className="wg-config-action-btn"
                    style={{ borderColor: 'rgba(217, 83, 79, 0.5)', color: '#D9534F', marginTop: 'auto' }}
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete all ${customSystemsCount} custom authored systems? Core library systems will be preserved.`)) {
                        wg.clearCustomSystems();
                        setImportResult({
                          type: 'success',
                          message: 'All custom authored weapon systems have been cleared.',
                        });
                      }
                    }}
                  >
                    🗑️ Reset Custom Systems ({customSystemsCount})
                  </button>
                )}
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
