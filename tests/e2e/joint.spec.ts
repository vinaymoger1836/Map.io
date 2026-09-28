import { test, expect } from '@playwright/test';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, storedSession, waitForMap } from './support';

test('joint probe shows authored environment and scoped cross-domain observations', async ({ page }) => {
  test.setTimeout(90_000);
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  await page.goto('/'); await waitForMap(page);
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await page.getByRole('button', { name: /War Sim/ }).first().click();
  await page.getByRole('button', { name: 'Joint probe · five domains' }).click();
  await expect(page.getByTestId('tactical-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Intel & coordination' }).click();
  const board = page.getByRole('complementary', { name: 'Intelligence and coordination board' });
  await expect(board.getByText(/authored fictional grid, 2 km spacing/)).toBeVisible();
  await board.getByLabel('Observer scope').selectOption('blue-sonar:local');
  await page.getByRole('button', { name: 'Start time' }).click();
  await expect(board.getByText(/Subsurface contact/).first()).toBeVisible();
  await board.getByLabel('Observer scope').selectOption('blue-ground-radar:local');
  await expect(board.getByText(/Surface contact/).first()).toBeVisible();
  await expect.poll(async () => (await storedSession(page))?.physical?.intel?.observations.some(
    (o: { modality: string }) => o.modality === 'orbital'), { timeout: 15_000 }).toBe(true);
  await page.getByRole('button', { name: 'Pause time' }).click();
  expect(pageErrors).toEqual([]);
});
