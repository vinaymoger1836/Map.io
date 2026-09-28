'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WarSimSession } from '../warSimTypes';
import type { SystemSpec } from '../specs';
import { writeDoc } from '../store';
import { recordWarSimMetric } from './diagnostics';
import { seedFromId } from './context';
import type { SimulationCommand, WorkerRequest, WorkerResponse, RuntimeDiagnostics } from './contracts';

/** Owns transport/lifecycle only. Commands and model steps execute in the worker. */
export function useSimulationRuntime(initial: WarSimSession | null, catalogue: SystemSpec[]) {
  const [session, setView] = useState<WarSimSession | null>(null);
  const [definitions, setDefinitions] = useState(catalogue);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [restartCount, setRestartCount] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const checkpoint = useRef<WarSimSession | null>(null);
  const viewRef = useRef(session);
  const nextSequence = useRef(1);
  const catalogueRef = useRef(catalogue);
  catalogueRef.current = catalogue;
  const previousInitial = useRef(initial);
  const saveQueue = useRef(Promise.resolve());
  const persist = useCallback((value: WarSimSession | null) => {
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => writeDoc('warsim-session', value));
  }, []);
  const ready = Boolean(initial?.runtime?.definitions?.length || catalogue.length);

  useEffect(() => {
    setError(null);
    setView(null);
    viewRef.current = null;
    setDiagnostics(null);
    if (previousInitial.current !== initial) checkpoint.current = null;
    previousInitial.current = initial;
    if (!initial || !ready) return;
    let disposed = false;
    let worker: Worker;
    let previousTick = -1;
    let previousStatus = '';
    let lastSave = 0;
    const fail = (message: string) => {
      if (disposed) return;
      setError(message);
      workerRef.current?.terminate();
      workerRef.current = null;
      if (viewRef.current) { viewRef.current = { ...viewRef.current, status: 'paused' }; setView(viewRef.current); }
    };
    try {
      worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module', name: 'warsim-runtime' });
    } catch (error) { fail(`Simulation could not start: ${String(error)}`); return; }
    workerRef.current = worker;
    const send = (request: WorkerRequest) => worker.postMessage(request);
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (disposed || workerRef.current !== worker) return;
      if (data.type === 'error') { fail(data.message); return; }
      checkpoint.current = data.checkpoint;
      nextSequence.current = Math.max(nextSequence.current, data.checkpoint.runtime!.nextSequence);
      viewRef.current = data.session;
      setView(data.session);
      setDiagnostics(data.diagnostics);
      if (previousTick !== data.diagnostics.tick && data.diagnostics.tick > 0) {
        recordWarSimMetric('engine.tick.ms', data.diagnostics.lastTickMs);
      }
      previousTick = data.diagnostics.tick;
      const rejected = data.receipts.find(r => r.status === 'rejected');
      if (rejected) setError(rejected.reason ?? 'Order rejected.');
      const now = performance.now();
      if (now - lastSave > 4000 || previousStatus !== data.session.status || data.receipts.length > 0) {
        persist(data.checkpoint);
        lastSave = now;
      }
      previousStatus = data.session.status;
    };
    worker.onerror = (event) => { event.preventDefault(); fail(`Simulation worker stopped: ${event.message}`); };
    worker.onmessageerror = () => fail('Simulation response could not be decoded. Your last checkpoint is retained.');
    const source = restartCount > 0 && checkpoint.current ? { ...checkpoint.current, status: 'paused' as const } : initial;
    nextSequence.current = source.runtime?.nextSequence ?? 1;
    setDefinitions(source.runtime?.definitions ?? catalogueRef.current);
    // Keep a separate legacy copy before writing the first versioned checkpoint.
    if (!source.runtime && source.status === 'paused') {
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => writeDoc(`warsim-legacy-${seedFromId(String(source.id)).toString(16)}`, source));
    }
    send({ type: 'initialize', version: 1, session: source, definitions: catalogueRef.current, visible: !document.hidden });
    const visibility = () => send({ type: 'visibility', visible: !document.hidden });
    const unload = () => {
      // The latest acknowledged checkpoint is synchronously mirrored by writeDoc
      // to localStorage. Unacknowledged commands are never claimed as saved.
      if (checkpoint.current) void writeDoc('warsim-session', { ...checkpoint.current, status: 'paused' });
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', unload);
    window.addEventListener('beforeunload', unload);
    return () => {
      disposed = true;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', unload);
      window.removeEventListener('beforeunload', unload);
    };
  }, [initial, ready, restartCount, persist]);

  const dispatch = useCallback((command: SimulationCommand) => {
    setError(null);
    const view = viewRef.current;
    if (!workerRef.current || !view) { setError('Simulation is not ready. Reload the checkpoint to continue.'); return; }
    const request: WorkerRequest = { type: 'command', envelope: {
      version: 1, sequence: nextSequence.current++, executeAtTick: -1,
      scope: { faction: view.activeFaction, commandGroupId: `${view.activeFaction}:hq` }, command,
    } };
    workerRef.current.postMessage(request);
  }, []);
  const close = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    checkpoint.current = null;
    viewRef.current = null;
    setView(null);
    persist(null);
  }, [persist]);
  return { session, definitions, dispatch, close, error, diagnostics,
    dismissError: () => setError(null), restart: () => setRestartCount(n => n + 1) };
}
