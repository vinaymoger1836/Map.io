import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createFixture, FIXTURE_IDS, FIXTURE_VERSION } from '../tests/warsim/fixtures/v1/scenarios';
import { withLegacyRuntime } from '../tests/warsim/helpers/legacyRuntime';
import { machineEnvironment } from '../tests/warsim/helpers/machine';
import { tickWarSim, launchSimStrikeSalvoDirectly } from '../lib/warSimEngine';
import { SimulationRuntime } from '../lib/warsim/runtime';

const useRuntime = process.argv.includes('--runtime');

const warmupTicks = 20;
const measuredTicks = 200;
const repetitions = 3;
const dtRealSec = 0.1;
const summarize = (samples: number[]) => {
  const ordered = [...samples].sort((a, b) => a - b);
  const p = (q: number) => ordered[Math.max(0, Math.ceil(ordered.length * q) - 1)];
  return { count: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50Ms: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99), maxMs: ordered.at(-1) };
};

const results = FIXTURE_IDS.map((id) => {
  const timing: number[] = [];
  const runs = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const fixture = createFixture(id);
    let state = fixture.session;
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const initialBytes = Buffer.byteLength(JSON.stringify(state));
    const run = withLegacyRuntime(fixture.seed, () => {
      if (id === 'engagement') {
        state = launchSimStrikeSalvoDirectly(state, 'blue-shooter', 'red-target', [-149.85, 0], 0, 2, 'loiter_target', fixture.systems).session;
      }
      const runtime = useRuntime ? new SimulationRuntime(state, fixture.systems, fixture.seed) : null;
      const step = () => { if (runtime) runtime.step(); else state = tickWarSim(state, dtRealSec, fixture.systems); };
      for (let i = 0; i < warmupTicks; i++) step();
      if (runtime) state = runtime.checkpoint();
      const initialPopulation = { platforms: state.entities.length, projectiles: state.activeMissiles.length };
      for (let i = 0; i < measuredTicks; i++) {
        const start = performance.now();
        step();
        timing.push(performance.now() - start);
      }
      if (runtime) state = runtime.checkpoint();
      return { initialPopulation, state };
    });
    const heapBeforeGc = process.memoryUsage().heapUsed;
    global.gc?.();
    runs.push({ repetition, initialPopulation: run.initialPopulation,
      finalPopulation: { platforms: state.entities.length, projectiles: state.activeMissiles.length,
        contacts: state.fogOfWarContacts.playerContacts.length + state.fogOfWarContacts.enemyContacts.length },
      simTimeSec: state.simTimeSec, initialSessionBytes: initialBytes, finalSessionBytes: Buffer.byteLength(JSON.stringify(state)),
      heapBeforeBytes: heapBefore, heapBeforeGcBytes: heapBeforeGc, heapAfterGcBytes: process.memoryUsage().heapUsed });
  }
  const result = { id, fixtureVersion: FIXTURE_VERSION, timing: summarize(timing), runs };
  console.log(`${id}: p50 ${result.timing.p50Ms.toFixed(2)} ms / p95 ${result.timing.p95Ms.toFixed(2)} ms (${timing.length} ticks)`);
  return result;
});

const sourcePaths = ['lib/warSimEngine.ts', 'lib/warSimRules.ts', 'lib/specs.ts', 'lib/terrainLOS.ts',
  'lib/spaceLayer.ts', 'lib/electronicWarfare.ts', 'lib/carrierOps.ts', 'lib/aerialRefueling.ts',
  'lib/airspaceSovereignty.ts', 'lib/threatLevelEngagements.ts', 'tests/warsim/fixtures/v1/scenarios.ts', 'package-lock.json',
  ...(useRuntime ? ['lib/warsim/runtime.ts', 'lib/warsim/context.ts', 'lib/warsim/commands.ts', 'lib/warsim/contracts.ts'] : [])];
const hashes = Object.fromEntries(sourcePaths.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
let revision = 'unavailable';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source hashes still identify the run */ }
const report = {
  schemaVersion: 1, capturedAt: new Date().toISOString(), revision, sourceHashes: hashes,
  runtime: useRuntime ? 'legacy-fixed-v1 headless runtime' : 'legacy engine harness',
  environment: { ...machineEnvironment(), node: process.version, gcAvailable: Boolean(global.gc) },
  method: { warmupTicks, measuredTicks, repetitions, dtRealSec, timeMultiplier: 1,
    caveats: [useRuntime ? 'Runtime uses checkpointed RNG and fixed steps; timing excludes checkpoint cloning and worker transport.' : 'Standalone legacy calls use the synchronous test RNG harness.',
      'CPU simulation only; no renderer/React cost. Short-run heap deltas are not a leak test.',
      'Measurements report this machine and fixture version; they are not universal performance guarantees.'] },
  results,
};
const destination = path.resolve(`.cache/warsim-baseline/${useRuntime ? 'phase-1-core' : 'core'}.json`);
mkdirSync(path.dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report written to ${destination}`);
