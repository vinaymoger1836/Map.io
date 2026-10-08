/** Synchronous legacy dependency bridge. Never overrides browser/Node globals. */
export interface RandomState { combat: number; identifiers: number; idCounter: number; epochMs: number }
let current: RandomState | undefined;
export function withSimulationContext<T>(state: RandomState, run: () => T): T {
  const previous = current;
  current = state;
  try { return run(); } finally { current = previous; }
}
export function simRandom(stream: 'combat' | 'identifiers' = 'combat'): number {
  if (!current) return Math.random(); // Compatibility for standalone legacy assessment tools.
  current[stream] = (Math.imul(current[stream], 1664525) + 1013904223) >>> 0;
  return current[stream] / 4294967296;
}
export function simNow(): number {
  return current ? current.epochMs + (++current.idCounter) * 16 : Date.now();
}
export function seedFromId(id: string): number {
  let seed = 2166136261;
  for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return seed;
}
