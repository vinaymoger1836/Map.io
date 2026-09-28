import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, waitForMap, storedSession } from './support';

test('coastal encounter launches, renders, fires, pauses, changes observer and recovers graphics', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  const graphicsErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) graphicsErrors.push(m.text()); });
  await page.goto('/'); await waitForMap(page);
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await page.getByRole('button', { name: /War Sim/ }).first().click();
  await page.getByRole('button', { name: 'Coastal encounter · 3D physics' }).click();
  await expect(page.getByTestId('tactical-canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'GLASSWATER' })).toBeVisible();
  await page.getByRole('button', { name: 'Follow selected' }).click();
  await page.waitForTimeout(1000);
  await mkdir('.cache/warsim-baselines', { recursive: true });
  await page.screenshot({ path: '.cache/warsim-baselines/phase-2-tactical.png' });
  await page.getByRole('button', { name: 'Launch guided round' }).click();
  await expect.poll(async () => (await storedSession(page))?.physical?.actors[0]?.rounds).toBe(7);
  await page.getByRole('button', { name: 'Start time' }).click();
  await page.waitForFunction(() => (window.__warSimDiagnostics?.snapshot().metrics['tactical.frame.interval.ms']?.count ?? 0) >= 140);
  await page.evaluate(() => window.__warSimDiagnostics!.reset());
  // Fixed measurement window at 1x, including a guided round in flight.
  await page.waitForTimeout(6000);
  const metrics = await page.evaluate(() => window.__warSimDiagnostics!.snapshot());
  const gpu = await page.getByTestId('tactical-canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  });
  await writeFile('.cache/warsim-baselines/phase-2-browser.json', JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), gpu,
    viewport: page.viewportSize(), preset: 'balanced / adaptive 0.5–1 pixel ratio / shadows off', mode: 'Next dev / headless / offline basemap', metrics }, null, 2));
  expect(metrics.metrics['tactical.render.ms']?.count).toBeGreaterThan(0);
  expect(metrics.metrics['map.updateData.ms']?.count ?? 0).toBe(0);
  await page.getByLabel('Tactical time multiplier').selectOption('3');
  await expect.poll(async () => (await storedSession(page))?.physical?.events.some((e: any) => e.kind === 'intercept'), { timeout: 40_000 }).toBe(true);
  await page.getByRole('button', { name: 'Pause time' }).click();
  await expect.poll(async () => (await storedSession(page))?.status).toBe('paused');
  const time = await page.getByTestId('tactical-time').textContent();
  await page.waitForTimeout(400); expect(await page.getByTestId('tactical-time').textContent()).toBe(time);
  await page.getByRole('button', { name: 'Switch faction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'FS Meridian' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FS Resolute' })).toHaveCount(0);
  await expect(page.getByTestId('tactical-canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Command map', exact: true }).click();
  await expect(page.getByTestId('tactical-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open 3D tactical view' }).click();
  await expect(page.getByTestId('tactical-canvas')).toBeVisible();
  await page.getByTestId('tactical-canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect(page.getByText('Graphics context lost.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Return to command map' }).click();
  await page.getByRole('button', { name: 'Open 3D tactical view' }).click();
  await expect(page.getByTestId('tactical-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Exit simulation', exact: true }).click();
  await expect(page.getByTestId('tactical-canvas')).toHaveCount(0);
  expect(pageErrors).toEqual([]); expect(graphicsErrors).toEqual([]);
});
