/** Opt-in Phase 0 measurements. No simulation behavior depends on this module. */
import type { ProfilerOnRenderCallback } from 'react';

type Metric = 'engine.tick.ms' | 'render.sync.ms' | 'map.setData.ms' | 'react.commit.ms' | 'frame.interval.ms' | 'heap.used.bytes';
type Series = { count: number; total: number; min: number; max: number; samples: number[] };
const LIMIT = 6000;
let active = false;
let startedAt = 0;
const metrics = new Map<Metric, Series>();

export function recordWarSimMetric(metric: Metric, value: number) {
  if (!active || !Number.isFinite(value)) return;
  let series = metrics.get(metric);
  if (!series) {
    series = { count: 0, total: 0, min: value, max: value, samples: [] };
    metrics.set(metric, series);
  }
  series.samples[series.count % LIMIT] = value;
  series.count++;
  series.total += value;
  series.min = Math.min(series.min, value);
  series.max = Math.max(series.max, value);
}

export function measureWarSim<T>(metric: Metric, action: () => T): T {
  if (!active) return action();
  const start = performance.now();
  try { return action(); } finally { recordWarSimMetric(metric, performance.now() - start); }
}

export const recordWarSimCommit: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  recordWarSimMetric('react.commit.ms', actualDuration);
};

function reset() {
  metrics.clear();
  startedAt = performance.now();
}

function snapshot() {
  return {
    schemaVersion: 1,
    durationMs: performance.now() - startedAt,
    percentileWindow: `Most recent ${LIMIT} samples per metric; count/mean/min/max cover the full capture.`,
    metrics: Object.fromEntries([...metrics].map(([name, series]) => {
      const sorted = [...series.samples].sort((a, b) => a - b);
      const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
      return [name, { count: series.count, mean: series.total / series.count, min: series.min,
        max: series.max, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
        first: series.count <= LIMIT ? series.samples[0] : null,
        last: series.samples[(series.count - 1) % LIMIT] }];
    })),
  };
}

export type WarSimDiagnosticsSnapshot = ReturnType<typeof snapshot>;

declare global {
  interface Window {
    __warSimDiagnostics?: { reset: typeof reset; snapshot: typeof snapshot };
  }
}

/** Mount once with the application; callers must run the returned cleanup. */
export function startWarSimDiagnostics(): () => void {
  if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_WARSIM_DIAGNOSTICS !== '1') return () => {};
  active = true;
  reset();
  window.__warSimDiagnostics = { reset, snapshot };
  let lastFrame: number | null = null;
  let frame = 0;
  const onFrame = (now: number) => {
    if (document.visibilityState === 'visible' && lastFrame !== null) {
      recordWarSimMetric('frame.interval.ms', now - lastFrame);
    }
    lastFrame = document.visibilityState === 'visible' ? now : null;
    frame = requestAnimationFrame(onFrame);
  };
  frame = requestAnimationFrame(onFrame);
  const memory = setInterval(() => {
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (heap) recordWarSimMetric('heap.used.bytes', heap.usedJSHeapSize);
  }, 1000);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
    clearInterval(memory);
    metrics.clear();
    delete window.__warSimDiagnostics;
  };
}
