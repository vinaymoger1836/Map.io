'use client';

/**
 * Quota System Deployment Modal
 *
 * Appears when clicking on a system in the Systems menu.
 * Allows deploying units to a designated compatible sovereign base.
 */

import React, { useState } from 'react';
import { type SimBase, type WarSimSession, type QuotaAllocation } from '@/lib/warSimTypes';
import { type SystemSpec, domainOf } from '@/lib/specs';
import { canStationAtBase } from '@/lib/warSimRules';

export interface DeploySystemModalProps {
  systemSpec: SystemSpec;
  quota: QuotaAllocation;
  session: WarSimSession;
  bases: SimBase[];
  onClose: () => void;
  onDeploy: (baseId: string, count: number) => void;
}

export function DeploySystemModal({
  systemSpec,
  quota,
  session,
  bases,
  onClose,
  onDeploy,
}: DeploySystemModalProps) {
  const remainingQuota = quota.count - quota.deployed;
  const domain = domainOf(systemSpec);

  // Compatible friendly bases
  const compatibleBases = bases.filter((b) => {
    const check = canStationAtBase(b.type, { domain, typeId: systemSpec.typeId });
    return check.allowed;
  });

  const [selectedBaseId, setSelectedBaseId] = useState<string>(compatibleBases[0]?.id || '');
  const [count, setCount] = useState<number>(Math.min(12, remainingQuota));

  const targetBase = bases.find((b) => b.id === selectedBaseId);

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
        zIndex: 9992,
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
          maxWidth: '540px',
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
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
              Deploy {systemSpec.name}
            </h2>
            <span style={{ fontSize: '11px', color: 'var(--paper-dim)' }}>
              Available in Quota Pool: <strong style={{ color: '#4FA85F' }}>{remainingQuota} units</strong> (out of {quota.count} total)
            </span>
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

        {/* Content */}
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Base Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--paper)', marginBottom: '4px' }}>
              Select Destination Sovereign Base:
            </label>
            {compatibleBases.length === 0 ? (
              <div style={{ padding: '10px', background: 'rgba(217, 83, 79, 0.1)', border: '1px solid #D9534F', borderRadius: '4px', fontSize: '11px', color: '#D9534F' }}>
                No compatible bases available for this domain ({domain}). Construct an appropriate base from the Bases menu.
              </div>
            ) : (
              <select
                value={selectedBaseId}
                onChange={(e) => setSelectedBaseId(e.target.value)}
                style={{
                  width: '100%',
                  background: '#09101B',
                  border: '1px solid var(--border)',
                  color: 'var(--paper)',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                {compatibleBases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.type.replace('_', ' ').toUpperCase()} · Max: {b.maxCapacity})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Count Slider */}
          {compatibleBases.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--paper)' }}>
                  Deploy Quantity:
                </label>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#4FC3F7' }}>
                  {count} units
                </span>
              </div>
              <input
                type="range"
                min="1"
                max={Math.max(1, remainingQuota)}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#4FA85F' }}
              />
            </div>
          )}

          {/* Platform Specifications */}
          <div style={{ background: '#09101B', padding: '10px 12px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '11px', color: 'var(--paper-dim)' }}>
            <div>Domain: <strong style={{ color: '#FFFFFF' }}>{domain.toUpperCase()}</strong> ({systemSpec.typeId})</div>
            {systemSpec.platform?.speedKmh && <div>Speed: <strong style={{ color: '#FFFFFF' }}>{systemSpec.platform.speedKmh} km/h</strong></div>}
            {systemSpec.platform?.combatRadiusKm && <div>Combat Radius: <strong style={{ color: '#FFFFFF' }}>{systemSpec.platform.combatRadiusKm} km</strong></div>}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <button className="wg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="wg-btn"
            style={{
              background: '#4FA85F',
              borderColor: '#4FA85F',
              color: '#070C14',
              fontWeight: 600,
            }}
            disabled={!selectedBaseId || remainingQuota <= 0}
            onClick={() => {
              onDeploy(selectedBaseId, count);
              onClose();
            }}
          >
            Deploy to {targetBase?.name || 'Base'}
          </button>
        </div>
      </div>
    </div>
  );
}
