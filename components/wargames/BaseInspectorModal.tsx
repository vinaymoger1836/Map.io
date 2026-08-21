'use client';

/**
 * Base Logistics & Sortie Command Modal
 *
 * Appears when clicking on any Base on the map or from the sidebar.
 * Displays stationed aircraft/ships/armor, live fuel & status (Idle, Patrol, Turnaround, Repairs),
 * and allows commanding idle systems to sortie / patrol anywhere within combat radius!
 */

import React, { useState } from 'react';
import {
  type SimBase,
  type SimEntity,
  type WarSimSession,
} from '@/lib/warSimTypes';
import { type SystemSpec } from '@/lib/specs';
import { canStationAtBase } from '@/lib/warSimRules';

export interface BaseInspectorModalProps {
  base: SimBase;
  session: WarSimSession;
  onClose: () => void;
  stationedEntities: SimEntity[];
  onStartSortie: (entity: SimEntity, count?: number) => void;
  onOrderRtb: (entityId: string) => void;
  onDeployToThisBase: (systemId: string, count: number) => void;
  onRenameBase?: (baseId: string, newName: string) => void;
  systemsLibrary: SystemSpec[];
}

export function BaseInspectorModal({
  base,
  session,
  onClose,
  stationedEntities,
  onStartSortie,
  onOrderRtb,
  onDeployToThisBase,
  onRenameBase,
  systemsLibrary,
}: BaseInspectorModalProps) {
  const [quickDeployOpen, setQuickDeployOpen] = useState(false);
  const [selectedSysId, setSelectedSysId] = useState<string>('');
  const [deployCount, setDeployCount] = useState<number>(12);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(base.name);
  const [sortieCounts, setSortieCounts] = useState<Record<string, number>>({});

  const activeFaction = session.activeFaction;
  const quotaLedger = session.quotas[activeFaction] || {};
  const currentTotal = stationedEntities.reduce((sum, e) => sum + e.count, 0);

  const getStatusBadge = (e: SimEntity) => {
    switch (e.status) {
      case 'docked':
        return { label: '🟢 IDLE (Ready to Sortie)', color: '#4FA85F', bg: 'rgba(79, 168, 95, 0.15)' };
      case 'takeoff_ingress':
        return { label: '🔵 INGRESS (En Route)', color: '#4F9FD6', bg: 'rgba(79, 159, 214, 0.15)' };
      case 'on_station':
        return { label: '🟣 ON STATION (Patrol Orbit)', color: '#BA68C8', bg: 'rgba(186, 104, 200, 0.15)' };
      case 'bingo_rtb':
        return { label: '🟡 BINGO RTB (Low Fuel)', color: '#FFB020', bg: 'rgba(255, 176, 32, 0.15)' };
      case 'damaged_rtb':
        return { label: '🔴 DAMAGED RTB', color: '#D9534F', bg: 'rgba(217, 83, 79, 0.15)' };
      case 'turnaround':
        return {
          label: `🟠 REFUELING (T-${Math.ceil(e.turnaroundTimerSec / 60)}m)`,
          color: '#E8833A',
          bg: 'rgba(232, 131, 58, 0.15)',
        };
      case 'in_repair':
        return {
          label: `🛠️ IN REPAIR (T-${Math.ceil(e.repairTimerSec / 60)}m)`,
          color: '#D9534F',
          bg: 'rgba(217, 83, 79, 0.15)',
        };
      default:
        return { label: e.status, color: '#9AA7B4', bg: 'rgba(255, 255, 255, 0.1)' };
    }
  };

  const getBaseIcon = (type: string) => {
    switch (type) {
      case 'airbase':
        return '🛫';
      case 'naval_base':
        return '⚓';
      case 'carrier_group':
        return '🚢';
      case 'silo_complex':
        return '🚀';
      default:
        return '🏰';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 10, 18, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 9990,
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
          maxWidth: '720px',
          maxHeight: '85vh',
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
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>{getBaseIcon(base.type)}</span>
            <div>
              {isEditingName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      background: '#070C14',
                      border: '1px solid #4FC3F7',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: 700,
                    }}
                    autoFocus
                  />
                  <button
                    className="wg-btn accent"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => {
                      if (onRenameBase && editName.trim()) {
                        onRenameBase(base.id, editName.trim());
                      }
                      setIsEditingName(false);
                    }}
                  >
                    ✓ Save
                  </button>
                  <button
                    className="wg-btn"
                    style={{ padding: '2px 6px', fontSize: '11px' }}
                    onClick={() => {
                      setEditName(base.name);
                      setIsEditingName(false);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {base.name}
                  </h2>
                  <button
                    onClick={() => setIsEditingName(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4FC3F7',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: '1px 4px',
                      borderRadius: '3px',
                    }}
                    title="Rename this installation"
                  >
                    ✏️ Rename
                  </button>
                </div>
              )}
              <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
                {base.type.replace('_', ' ').toUpperCase()} · Sovereign {base.iso} Territory · Location: [{base.lngLat[0].toFixed(2)}°, {base.lngLat[1].toFixed(2)}°]
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-dim)',
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Base Status Strip */}
        <div
          style={{
            padding: '10px 20px',
            background: '#09101B',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11.5px',
          }}
        >
          <div>
            Status:{' '}
            <strong
              style={{
                color: base.runwayStatus === 'operational' ? '#4FA85F' : '#D9534F',
              }}
            >
              {base.runwayStatus.toUpperCase()}
            </strong>
            {base.repairCountdownSec > 0 && (
              <span style={{ color: '#FFB020', marginLeft: '6px' }}>
                (Repairs: {Math.ceil(base.repairCountdownSec / 60)}m remaining)
              </span>
            )}
          </div>
          <div>
            Holding Capacity:{' '}
            <strong style={{ color: currentTotal >= base.maxCapacity ? '#D9534F' : '#4FC3F7' }}>
              {currentTotal} / {base.maxCapacity} units
            </strong>
          </div>
          <button
            className="wg-btn"
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            onClick={() => setQuickDeployOpen(!quickDeployOpen)}
          >
            {quickDeployOpen ? 'Cancel Deployment' : '+ Deploy From Quota'}
          </button>
        </div>

        {/* Quick Deploy Drawer */}
        {quickDeployOpen && (
          <div
            style={{
              padding: '12px 20px',
              background: 'rgba(79, 159, 214, 0.08)',
              borderBottom: '1px solid rgba(79, 159, 214, 0.2)',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
                Select Compatible System:
              </label>
              <select
                value={selectedSysId}
                onChange={(e) => setSelectedSysId(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0E1724',
                  border: '1px solid var(--border)',
                  color: 'var(--paper)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                <option value="">-- Choose system from national quota --</option>
                {Object.entries(quotaLedger).map(([sysId, q]) => {
                  const spec = systemsLibrary.find((s) => s.id === sysId);
                  const typeId = spec?.typeId || 'fighter';
                  const domain = spec ? (spec.typeId === 'destroyer' ? 'sea' : 'air') : 'air';
                  const stationable = canStationAtBase(base.type, { domain, typeId });
                  const remaining = q.count - q.deployed;

                  return (
                    <option key={sysId} value={sysId} disabled={!stationable.allowed || remaining <= 0}>
                      {q.customName || sysId} ({remaining} avail / {q.count} total) {!stationable.allowed ? '(Incompatible)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--paper-dim)', marginBottom: '2px' }}>
                Quantity:
              </label>
              <input
                type="number"
                min="1"
                max={selectedSysId ? Math.min(quotaLedger[selectedSysId]?.count - quotaLedger[selectedSysId]?.deployed, base.maxCapacity - currentTotal) : 12}
                value={deployCount}
                onChange={(e) => setDeployCount(Math.max(1, Number(e.target.value)))}
                style={{
                  width: '70px',
                  background: '#0E1724',
                  border: '1px solid var(--border)',
                  color: 'var(--paper)',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              />
            </div>

            <button
              className="wg-btn"
              style={{
                alignSelf: 'flex-end',
                background: '#4FA85F',
                borderColor: '#4FA85F',
                color: '#070C14',
                fontWeight: 600,
                fontSize: '11px',
              }}
              disabled={!selectedSysId || currentTotal >= base.maxCapacity}
              onClick={() => {
                onDeployToThisBase(selectedSysId, deployCount);
                setQuickDeployOpen(false);
              }}
            >
              Confirm Deploy
            </button>
          </div>
        )}

        {/* Stationed Units Roster */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '13px', textTransform: 'uppercase', color: 'var(--paper-dim)' }}>
            Stationed Formations & Squadrons ({stationedEntities.length})
          </h3>

          {stationedEntities.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--paper-dim)', fontSize: '12px' }}>
              No military units currently stationed at this installation. Use "+ Deploy From Quota" to station squadrons.
            </div>
          )}

          {stationedEntities.map((entity) => {
            const spec = systemsLibrary.find((s) => s.id === entity.systemId);
            const statusBadge = getStatusBadge(entity);
            const isIdle = entity.status === 'docked';
            const isSortied = entity.status === 'takeoff_ingress' || entity.status === 'on_station';
            const combatRadiusKm = spec?.platform?.combatRadiusKm ?? 900;

            return (
              <div
                key={entity.id}
                style={{
                  background: '#09101B',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#FFFFFF' }}>
                      {entity.name}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontWeight: 600,
                        color: statusBadge.color,
                        background: statusBadge.bg,
                      }}
                    >
                      {statusBadge.label}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '14px', fontSize: '11px', color: 'var(--paper-dim)' }}>
                    <span>
                      Fuel:{' '}
                      <strong style={{ color: entity.currentFuelPct < 25 ? '#D9534F' : '#4FA85F' }}>
                        {entity.currentFuelPct.toFixed(0)}%
                      </strong>
                    </span>
                    <span>
                      Speed: <strong>{entity.speedKmh} km/h</strong>
                    </span>
                    <span>
                      Radius: <strong>{combatRadiusKm} km</strong>
                    </span>
                    <span>
                      Crew: <strong>{entity.personnel} personnel</strong>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {isIdle && (
                    entity.count > 1 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: '#070C14',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            padding: '2px 4px',
                            gap: '2px',
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#4FC3F7',
                              cursor: 'pointer',
                              padding: '1px 6px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSortieCounts((prev) => ({
                                ...prev,
                                [entity.id]: Math.max(1, (prev[entity.id] ?? Math.min(2, entity.count)) - 1),
                              }));
                            }}
                          >
                            −
                          </button>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF', minWidth: '22px', textAlign: 'center' }}>
                            {sortieCounts[entity.id] ?? Math.min(2, entity.count)}
                          </span>
                          <button
                            type="button"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#4FC3F7',
                              cursor: 'pointer',
                              padding: '1px 6px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSortieCounts((prev) => ({
                                ...prev,
                                [entity.id]: Math.min(entity.count, (prev[entity.id] ?? Math.min(2, entity.count)) + 1),
                              }));
                            }}
                          >
                            +
                          </button>
                        </div>

                        <button
                          className="wg-btn"
                          style={{
                            background: '#4FA85F',
                            color: '#070C14',
                            borderColor: '#4FA85F',
                            fontWeight: 700,
                            fontSize: '11px',
                            padding: '5px 12px',
                            whiteSpace: 'nowrap',
                          }}
                          onClick={() => {
                            onClose();
                            const count = sortieCounts[entity.id] ?? Math.min(2, entity.count);
                            onStartSortie(entity, count);
                          }}
                        >
                          🚀 Sortie ({sortieCounts[entity.id] ?? Math.min(2, entity.count)} / {entity.count})
                        </button>
                      </div>
                    ) : (
                      <button
                        className="wg-btn"
                        style={{
                          background: '#4FA85F',
                          color: '#070C14',
                          borderColor: '#4FA85F',
                          fontWeight: 600,
                          fontSize: '11px',
                          padding: '5px 12px',
                        }}
                        onClick={() => {
                          onClose();
                          onStartSortie(entity, 1);
                        }}
                      >
                        🚀 Sortie / Patrol
                      </button>
                    )
                  )}

                  {isSortied && (
                    <button
                      className="wg-btn"
                      style={{
                        background: '#0E1724',
                        color: '#FFB020',
                        borderColor: '#FFB020',
                        fontSize: '11px',
                        padding: '5px 10px',
                      }}
                      onClick={() => onOrderRtb(entity.id)}
                    >
                      🏠 Recall RTB
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <button className="wg-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
