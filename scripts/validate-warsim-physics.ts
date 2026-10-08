/** Standalone numerical/trajectory report; never touches stored sessions. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createPhysicalReference } from '../lib/warsim/physics/reference';
import { launchPhysical, stepPhysical, PROFILE } from '../lib/warsim/physics/model';
import { SimulationRuntime } from '../lib/warsim/runtime';

async function main() {
  const s = createPhysicalReference(); s.physical!.actors[1].interceptors = 0;
  launchPhysical(s, 'blue-frigate', s.fogOfWarContacts.playerContacts[0].contactId);
  const trajectory: { time: number; east: number; north: number; altitude: number; speed: number }[] = [];
  for (let i = 0; i < 450 && s.physical!.rounds.length; i++) {
    const r = s.physical!.rounds[0]; trajectory.push({ time: s.simTimeSec, east: r.position[0], north: r.position[1], altitude: r.position[2], speed: Math.hypot(...r.velocity) });
    stepPhysical(s, .1); s.simTimeSec += .1;
  }
  const initial = createPhysicalReference(); initial.status = 'running'; const runtime = new SimulationRuntime(initial, [], 42);
  const costs: number[] = [];
  for (let i = 0; i < 1000; i++) { const t = performance.now(); runtime.step(); runtime.observer(); runtime.checkpoint(); if (i >= 100) costs.push(performance.now() - t); }
  costs.sort((a, b) => a - b);
  const report = { model: 'coastal-pointmass-v2', profile: PROFILE, sampleCount: costs.length,
    runtimeWithProjectionAndCheckpointMs: { median: costs[Math.floor(costs.length * .5)], p95: costs[Math.floor(costs.length * .95)] },
    terminalEvents: s.physical!.events, targetHealth: s.physical!.actors[1].health, trajectory };
  const maxTime = Math.max(...trajectory.map(p => p.time)), maxAltitude = Math.ceil(Math.max(...trajectory.map(p => p.altitude)) / 10) * 10;
  const points = trajectory.map(p => `${70 + p.time / maxTime * 850},${370 - p.altitude / maxAltitude * 290}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="450" viewBox="0 0 1000 450"><rect width="1000" height="450" fill="#0c1a25"/><g fill="#c3d8e3" font-family="sans-serif"><text x="70" y="35" font-size="20">Reference guided trajectory / altitude over simulation time</text><text x="70" y="60" font-size="12">Synthetic profile · 20 ms integration · unopposed target · metres in local ENU</text><path d="M70 80V370H920" stroke="#67818e" fill="none"/><text x="20" y="90">${maxAltitude}m</text><text x="35" y="375">0</text><text x="70" y="405">0s</text><text x="860" y="405">${maxTime.toFixed(1)}s</text><polyline points="${points}" fill="none" stroke="#7fe2eb" stroke-width="2"/></g></svg>`;
  await mkdir('.cache/warsim-baselines', { recursive: true });
  await writeFile('.cache/warsim-baselines/phase-2-trajectory.svg', svg);
  await writeFile('.cache/warsim-baselines/phase-2-physics.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, trajectory: `${trajectory.length} points (see .cache/warsim-baselines/phase-2-physics.json)` }, null, 2));
}
void main();
