import { SimulationRuntime } from './runtime';
import { FixedStepScheduler } from './scheduler';
import type { WorkerRequest, WorkerResponse } from './contracts';

const host = self as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(value: WorkerResponse): void };
let runtime: SimulationRuntime | undefined;
let visible = true;
let stopped = false;
let lastTickMs = 0;
const scheduler = new FixedStepScheduler();
function publish() {
  if (!runtime) return;
  host.postMessage({ type: 'frame', version: 1, session: runtime.observer(), checkpoint: runtime.checkpoint(),
    receipts: runtime.takeReceipts(), diagnostics: { tick: runtime.tick, stepMs: 100, lastTickMs,
      droppedWallMs: scheduler.droppedWallMs, suspended: !visible, pendingCommands: runtime.pendingCount } });
}
function fail(error: unknown) {
  stopped = true;
  host.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
host.onmessage = ({ data }) => {
  try {
    if (data.type === 'initialize') {
      if (data.version !== 1 || runtime) throw new Error('Unsupported or duplicate runtime initialization.');
      runtime = new SimulationRuntime(data.session, data.definitions);
      visible = data.visible;
    } else if (!runtime) throw new Error('Simulation is still loading.');
    else if (data.type === 'command') {
      // Immediate UI orders apply at the next available command boundary.
      const envelope = data.envelope;
      if (envelope.executeAtTick === -1) envelope.executeAtTick = runtime.tick;
      runtime.submit(envelope);
      scheduler.reset();
    } else if (data.type === 'visibility') { visible = data.visible; scheduler.reset(); }
    publish();
  } catch (error) { fail(error); }
};
function pump() {
  if (stopped) return;
  try {
    if (runtime && scheduler.advance(performance.now(), runtime.speed, runtime.running, visible)) {
      const start = performance.now();
      runtime.step();
      lastTickMs = performance.now() - start;
      publish();
    }
  } catch (error) { fail(error); }
  if (!stopped) setTimeout(pump, 16);
}
pump();
