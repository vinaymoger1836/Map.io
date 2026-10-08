import { test, expect } from '@playwright/test';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, waitForMap, storedSession } from './support';

test('server isolation blocks disk writes even without browser interception', async ({ request }) => {
  const write = await request.put('/api/store/board', { data: { mustNeverReachUserData: true } });
  expect(write.status()).toBe(403);
  expect(await (await request.get('/api/store/board')).json()).toBeNull();
});

test('situation map opens sandbox and launches a fresh simulation', async ({ page }) => {
  const fixture = createFixture('transit');
  // Fresh setup validates every quota platform, including this synthetic fighter.
  fixture.systems.find((system) => system.id === 'fixture-aircraft')!.weapons = [{
    id: 'fixture-air-round', name: 'Fixture air round', rangeKm: 80,
    speedMach: 2, magazine: 4, salvo: 1, pk: 0.5, reactionSec: 2, engages: ['air'],
  }];
  const { pageErrors } = await preparePage(page, fixture, false);
  await page.goto('/');
  await waitForMap(page);
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await page.getByRole('button', { name: /War Sim/ }).first().click();
  await expect(page.getByRole('heading', { name: 'War Simulation Staging Deck' })).toBeVisible();
  await page.getByRole('combobox').last().selectOption('156');
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
  // Commands save their acknowledged checkpoint; wait for that durable view before reload.
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

test('one worker survives play/pause and suspends hidden time without catching up', async ({ page }) => {
  const { pageErrors } = await preparePage(page, createFixture('transit'));
  await page.goto('/');
  await waitForMap(page);
  const state = page.getByTestId('simulation-runtime');
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  const workers = async () => {
    const named = await Promise.all(page.workers().map(async worker => {
      try { return await worker.evaluate(() => self.name) === 'warsim-runtime' ? worker : null; }
      catch { return null; } // A worker can finish while Playwright enumerates it.
    }));
    return named.filter(worker => worker !== null);
  };
  expect(await workers()).toHaveLength(1);
  const originalWorker = (await workers())[0];
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /RESUME/ }).click();
    await expect(page.getByRole('button', { name: /PAUSE/ })).toBeVisible();
    await page.getByRole('button', { name: /PAUSE/ }).click();
    await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  }
  expect(await workers()).toEqual([originalWorker]);
  await page.getByRole('button', { name: /RESUME/ }).click();
  await expect.poll(async () => Number(await state.getAttribute('data-tick'))).toBeGreaterThan(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(state).toHaveText('Simulation suspended');
  const hiddenTick = Number(await state.getAttribute('data-tick'));
  // Deliberate elapsed hidden time: the assertion checks absence of model steps.
  await page.waitForTimeout(650);
  expect(Number(await state.getAttribute('data-tick'))).toBe(hiddenTick);
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(state).toHaveText('Simulation running');
  await page.getByRole('button', { name: /PAUSE/ }).click();
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  const pausedTick = Number(await state.getAttribute('data-tick'));
  expect(pausedTick - hiddenTick).toBeLessThan(4);
  const saved = await storedSession(page);
  expect(saved.runtime.tick).toBe(pausedTick);
  expect(saved.runtime.acceptedCommands.length).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: /Exit Sim/ }).click();
  await expect.poll(async () => (await workers()).length).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('a worker failure can recover its last acknowledged checkpoint', async ({ page }) => {
  const { pageErrors } = await preparePage(page, createFixture('transit'));
  await page.goto('/');
  await waitForMap(page);
  await page.getByRole('button', { name: /RESUME/ }).click();
  await expect.poll(async () => Number(await page.getByTestId('simulation-runtime').getAttribute('data-tick'))).toBeGreaterThan(3);
  await page.getByRole('button', { name: /PAUSE/ }).click();
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeVisible();
  const before = await storedSession(page);
  for (const worker of page.workers()) {
    if (await worker.evaluate(() => self.name) !== 'warsim-runtime') continue;
    await worker.evaluate(() => { setTimeout(() => { throw new Error('Phase 1 fixture worker failure'); }, 0); });
    break;
  }
  await expect(page.getByRole('alert').filter({ hasText: 'Simulation worker stopped:' })).toContainText('Phase 1 fixture worker failure');
  await page.getByRole('button', { name: 'Reload checkpoint', exact: true }).click();
  await expect(page.getByTestId('simulation-runtime')).toHaveText('Simulation paused');
  const after = await storedSession(page);
  expect(after.runtime).toEqual(before.runtime);
  expect(after.entities).toEqual(before.entities);
  await page.getByRole('button', { name: /RESUME/ }).click();
  await expect.poll(async () => Number(await page.getByTestId('simulation-runtime').getAttribute('data-tick'))).toBeGreaterThan(before.runtime.tick);
  expect(pageErrors.filter(error => !error.includes('Phase 1 fixture worker failure'))).toEqual([]);
});
