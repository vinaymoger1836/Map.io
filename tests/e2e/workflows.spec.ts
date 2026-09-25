import { test, expect } from '@playwright/test';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, waitForMap, storedSession } from './support';

test('server isolation blocks disk writes even without browser interception', async ({ request }) => {
  const write = await request.put('/api/store/board', { data: { mustNeverReachUserData: true } });
  expect(write.status()).toBe(403);
  expect(await (await request.get('/api/store/board')).json()).toBeNull();
});

test('situation map opens sandbox and launches a fresh simulation', async ({ page }) => {
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  await page.goto('/');
  await waitForMap(page);
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await page.getByRole('button', { name: /War Sim/ }).first().click();
  await expect(page.getByRole('heading', { name: 'War Simulation Staging Deck' })).toBeVisible();
  await page.getByRole('button', { name: /Begin Simulation/ }).click();
  await expect(page.getByRole('button', { name: /PAUSE/ })).toBeVisible();
  await page.getByRole('button', { name: /PAUSE/ }).click();
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  expect((await storedSession(page)).status).toBe('paused');
  expect(pageErrors).toEqual([]);
});

test('restored session runs, switches faction, persists, opens AAR, and exits cleanly', async ({ page }) => {
  const { documents, pageErrors } = await preparePage(page, createFixture('sensor-contact'));
  await page.goto('/');
  await waitForMap(page);
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  await page.getByRole('button', { name: /RESUME/ }).click();
  await page.waitForFunction(() => (window.__warSimDiagnostics?.snapshot().metrics['engine.tick.ms']?.count ?? 0) >= 8);
  await page.getByRole('button', { name: /PAUSE/ }).click();
  await expect.poll(async () => (await storedSession(page))?.simTimeSec ?? 0).toBeGreaterThan(0);
  const savedTime = (await storedSession(page)).simTimeSec;
  await page.getByRole('button', { name: /\(Red\)/ }).click();
  // Same paused state does not trigger an immediate legacy autosave; wait for its documented 4 s interval.
  await expect.poll(async () => (await storedSession(page))?.activeFaction, { timeout: 10_000 }).toBe('enemy');
  await page.reload();
  await waitForMap(page);
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  expect((await storedSession(page)).simTimeSec).toBe(savedTime);
  expect((await storedSession(page)).activeFaction).toBe('enemy');
  await page.getByRole('button', { name: /Live AAR/ }).click();
  await expect(page.getByRole('heading', { name: /Master After-Action Report/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Exit Sim/ }).click();
  await expect(page.getByRole('button', { name: /RESUME/ })).toHaveCount(0);
  await expect.poll(() => documents.get('warsim-session')).toBeNull();
  expect(pageErrors).toEqual([]);
});
