import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { machineEnvironment } from '../warsim/helpers/machine';
import { preparePage, waitForMap, storedSession } from './support';

test('capture browser baseline on the 100-platform / 50-projectile fixture', async ({ page, browser }, testInfo) => {
  const fixture = createFixture('fleet');
  const { pageErrors } = await preparePage(page, fixture);
  await page.goto('/');
  await waitForMap(page);
  // Center on the actual workload; record rendering when the fleet is in view.
  await page.evaluate(() => {
    const map = (window as unknown as { __map: import('maplibre-gl').Map }).__map;
    map.jumpTo({ center: [-149.5, 0.1], zoom: 7 });
  });
  await page.getByRole('button', { name: /RESUME/ }).click();
  await page.waitForFunction(() => (window.__warSimDiagnostics?.snapshot().metrics['engine.tick.ms']?.count ?? 0) >= 20);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const memoryBefore = await cdp.send('Runtime.getHeapUsage');
  await page.evaluate(() => window.__warSimDiagnostics!.reset());
  // This is the measured observation window, not a readiness wait.
  await page.waitForTimeout(12_000);
  const metrics = await page.evaluate(() => window.__warSimDiagnostics!.snapshot());
  const memoryBeforeGc = await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.collectGarbage');
  const memoryAfterGc = await cdp.send('Runtime.getHeapUsage');
  await page.getByRole('button', { name: /PAUSE/ }).click();
  await expect.poll(async () => (await storedSession(page))?.status).toBe('paused');
  const final = await storedSession(page);
  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.maplibregl-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { vendor: 'unavailable', renderer: 'unavailable' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: String(gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
      renderer: String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
  });
  const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), fixture: fixture.id, fixtureVersion: fixture.schemaVersion,
    sourceHashes: Object.fromEntries(['lib/warSimEngine.ts', 'lib/warSimLayers.ts', 'lib/useWarSim.ts',
      'lib/warsim/diagnostics.ts', 'components/MapShell.tsx', 'components/EurasiaMap.tsx',
      'tests/warsim/fixtures/v1/scenarios.ts', 'tests/e2e/support.ts', 'package-lock.json']
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])),
    environment: { ...machineEnvironment(), browser: browser.version(), viewport: testInfo.project.use.viewport, gpu,
      mode: 'Next.js development, React StrictMode, headless Chromium' },
    caveats: ['Offline blank basemap and fixture geography: no external tile/font cost.',
      'setData cost is synchronous submission/serialization, not asynchronous worker or GPU completion.',
      'React commit metric is Profiler actualDuration in development; frames are requestAnimationFrame intervals.',
      'Browser execution uses the legacy wall clock and RNG; only the initial fixture is seeded.',
      '12-second heap deltas are an initial observation, not proof of a memory leak or leak freedom.'],
    metrics, memory: { before: memoryBefore, beforeGc: memoryBeforeGc, afterGc: memoryAfterGc },
    initialSessionBytes: Buffer.byteLength(JSON.stringify(fixture.session)), finalSessionBytes: Buffer.byteLength(JSON.stringify(final)),
    finalPopulation: { platforms: final.entities.length, projectiles: final.activeMissiles.length },
  };
  const destination = path.resolve('.cache/warsim-baseline/browser.json');
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach('browser-baseline', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: '.cache/warsim-baseline/fleet.png' });
  expect(metrics.metrics['engine.tick.ms']?.count).toBeGreaterThan(0);
  expect(metrics.metrics['render.sync.ms']?.count).toBeGreaterThan(0);
  expect(metrics.metrics['map.setData.ms']?.count).toBeGreaterThan(0);
  expect(metrics.metrics['react.commit.ms']?.count).toBeGreaterThan(0);
  expect(metrics.metrics['frame.interval.ms']?.count).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
