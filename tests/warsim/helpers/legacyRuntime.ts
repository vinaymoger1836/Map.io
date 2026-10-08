import { FIXTURE_EPOCH_MS } from '../fixtures/v1/scenarios';

/**
 * Synchronous test/benchmark harness ONLY. The production engine has no saved
 * RNG or clock yet. Restore both globals even when the measured function fails.
 */
export function withLegacyRuntime<T>(seed: number, run: () => T): T {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  let state = seed >>> 0;
  let sequence = 0;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  Date.now = () => FIXTURE_EPOCH_MS + sequence++;
  try { return run(); } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
}
