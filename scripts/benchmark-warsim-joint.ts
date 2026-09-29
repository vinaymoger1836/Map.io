import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createLittoralReference } from '../lib/warsim/physics/reference';
import { SimulationRuntime } from '../lib/warsim/runtime';
import { machineEnvironment } from '../tests/warsim/helpers/machine';

const seeds = [7, 19, 29, 43, 61];
const variants = ['disabled', 'cautious', 'balanced', 'aggressive'] as const;
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const runs = variants.flatMap(variant => seeds.map(seed => {
  const scenario = createLittoralReference();
  scenario.id = 'joint-benchmark-v1';
  scenario.status = 'running';
  scenario.physical!.opposition!.enabled = variant !== 'disabled';
  if (variant !== 'disabled') scenario.physical!.opposition!.doctrine = variant;
  const runtime = new SimulationRuntime(scenario, [], seed);
  const timings: number[] = [];
  while (runtime.running && runtime.tick < 900) {
    const start = performance.now();
    runtime.step();
    timings.push(performance.now() - start);
  }
  const saved = runtime.checkpoint(), physical = saved.physical!, archive = saved.runtime!.replay!;
  const red = physical.actors.find(a => a.id === 'red-frigate')!;
  const blue = physical.actors.find(a => a.id === 'blue-frigate')!;
  return { variant, seed, ticks: runtime.tick, result: physical.objectives!.status,
    redHealth: red.health, blueHealth: blue.health, redRoundsSpent: 8 - red.rounds,
    acceptedRedStrikes: physical.opposition!.decisions.filter(d => d.result === 'accepted'
      && ['coordinated-strike', 'local-strike'].includes(d.priority)).length,
    replayFrames: archive.frames.length, replayRecords: archive.records.length,
    replayBytes: Buffer.byteLength(JSON.stringify(archive)),
    tickP50Ms: quantile(timings, .5), tickP95Ms: quantile(timings, .95) };
}));
const summary = variants.map(variant => {
  const group = runs.filter(run => run.variant === variant);
  return { variant, trials: group.length, redVictories: group.filter(run => run.result === 'red-victory').length,
    meanRedRoundsSpent: group.reduce((sum, run) => sum + run.redRoundsSpent, 0) / group.length,
    meanAcceptedRedStrikes: group.reduce((sum, run) => sum + run.acceptedRedStrikes, 0) / group.length,
    maxReplayBytes: Math.max(...group.map(run => run.replayBytes)),
    tickP95Ms: quantile(group.map(run => run.tickP95Ms), .95) };
});
const report = { schemaVersion: 1, capturedAt: new Date().toISOString(),
  method: { scenario: 'Glasswater / Joint probe', seeds, variants, stepMs: 100, maxTicks: 900,
    caveats: ['Synthetic equipment and weather; outcomes are not calibrated combat predictions.',
      'CPU step timing includes replay capture but excludes worker transfer, persistence, rendering and React.',
      'Five seeds characterize this fixture only; outcome rates are not confidence intervals.'] },
  environment: { ...machineEnvironment(), node: process.version }, summary, runs };
const destination = '.cache/warsim-phase7/joint-batch.json';
mkdirSync('.cache/warsim-phase7', { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
for (const row of summary) console.log(`${row.variant}: ${row.redVictories}/${row.trials} red victories, ${row.meanRedRoundsSpent.toFixed(1)} mean rounds spent, ${row.tickP95Ms.toFixed(2)} ms max trial p95`);
console.log(`Report written to ${destination}`);
