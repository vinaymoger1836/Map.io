'use client';

/**
 * Interactive 4D Battle Playback HUD Controller.
 *
 * Floating HUD interface for scrubbing and playing back strike operations:
 * - Real-time mission clock & operational status readout
 * - Play/Pause, speed multipliers (1x, 2x, 5x, 10x), and scrub slider
 * - Quick phase jump markers and synchronized battle events
 */

import React from 'react';
import type { PlaybackModel, PlaybackFrame } from '@/lib/playback';

export interface PlaybackHUDProps {
  model: PlaybackModel;
  frame: PlaybackFrame;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onSetSpeed: (speed: number) => void;
  onClose: () => void;
}

export function PlaybackHUD({
  model,
  frame,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onSeek,
  onSetSpeed,
  onClose,
}: PlaybackHUDProps) {
  const distinctPhases = Array.from(new Set(model.segments.map((s) => s.phaseNumber))).sort((a, b) => a - b);

  return (
    <aside className="wg-playback-hud" aria-label="Battle Playback Controller">
      {/* Top Header: Mission Clock, Status & Close Button */}
      <div className="wg-playback-header">
        <div className="wg-playback-clock-group">
          <span className="wg-playback-clock-dot" style={{ animation: isPlaying ? 'wg-pulse 1.2s infinite' : 'none' }} />
          <span className="wg-playback-clock">{frame.timeFormatted}</span>
          <span className="wg-tag" style={{ background: 'var(--surface-hover)', fontSize: '10px' }}>
            Phase {frame.activePhaseNumber} of {distinctPhases.length}
          </span>
        </div>

        <div className="wg-playback-status" title={frame.activeStatusText}>
          {frame.activeStatusText}
        </div>

        <button
          className="wg-playback-btn icon-only"
          onClick={onClose}
          title="Exit battle playback"
          aria-label="Close playback"
        >
          ✕
        </button>
      </div>

      {/* Center Scrubber Bar with Phase Ticks */}
      <div className="wg-playback-scrubber-container">
        <input
          type="range"
          min={0}
          max={model.totalDurationSec}
          step={0.5}
          value={frame.timeSec}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="wg-playback-slider"
          aria-label="Timeline scrubber"
        />

        {/* Phase Jump Chips */}
        {distinctPhases.length > 1 && (
          <div className="wg-playback-phase-chips">
            {distinctPhases.map((pNum) => {
              const seg = model.segments.find((s) => s.phaseNumber === pNum);
              if (!seg) return null;
              const isCurrent = frame.activePhaseNumber === pNum;
              return (
                <button
                  key={pNum}
                  className={`wg-playback-chip ${isCurrent ? 'active' : ''}`}
                  onClick={() => onSeek(seg.startTimeSec)}
                  title={`Jump to Phase ${pNum}: ${seg.title}`}
                >
                  Phase {pNum}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Controls: Play/Pause, Rewind, Step, Speed */}
      <div className="wg-playback-controls">
        <div className="wg-playback-ctrl-group">
          <button
            className="wg-playback-btn"
            onClick={() => onSeek(Math.max(0, frame.timeSec - 10))}
            title="Rewind 10 seconds"
          >
            ⏪ −10s
          </button>

          <button
            className={`wg-playback-btn primary ${isPlaying ? 'playing' : ''}`}
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause playback' : 'Start animated playback'}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <button
            className="wg-playback-btn"
            onClick={() => onSeek(Math.min(model.totalDurationSec, frame.timeSec + 10))}
            title="Forward 10 seconds"
          >
            +10s ⏩
          </button>

          <button
            className="wg-playback-btn"
            onClick={() => onSeek(0)}
            title="Rewind to start"
          >
            🔄 Reset
          </button>
        </div>

        {/* Speed Selector */}
        <div className="wg-playback-speed-group">
          <span style={{ fontSize: '10px', color: 'var(--paper-dim)' }}>Speed:</span>
          {[1, 2, 5, 10].map((s) => (
            <button
              key={s}
              className={`wg-playback-speed-btn ${playbackSpeed === s ? 'active' : ''}`}
              onClick={() => onSetSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
