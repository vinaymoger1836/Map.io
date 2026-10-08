import { test, expect } from '@playwright/test';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, storedSession, waitForMap } from './support';

test('coastal intelligence board shows scoped reports, collection and delayed coverage', async ({ page }) => {
  test.setTimeout(90_000);
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  await page.goto('/'); await waitForMap(page);
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await page.getByRole('button', { name: /War Sim/ }).first().click();
  await page.getByRole('button', { name: /Coastal encounter/ }).click();
  await expect(page.getByTestId('tactical-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Intel & coordination' }).click();
  const board = page.getByRole('complementary', { name: 'Intelligence and coordination board' });
  await expect(board.getByText('CONTACT ASSESSMENTS / 1')).toBeVisible();
  await board.getByLabel('Observer scope').selectOption('blue-scout:local');
  await expect(board.getByText('No contact in this scope.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Start time' }).click();
  await expect.poll(async () => (await storedSession(page))?.physical?.intel?.tracks.some(
    (track: any) => track.scopeId === 'blue-scout:local' && track.evidenceIds.some((id: string) => id.startsWith('obs-')),
  )).toBe(true);
  await expect(board.getByText('CONTACT ASSESSMENTS / 1')).toBeVisible();
  await board.getByLabel('Observer scope').selectOption('840:hq');
  await expect.poll(async () => (await storedSession(page))?.physical?.intel?.tracks.some(
    (track: any) => track.scopeId === '840:hq' && track.evidenceIds.some((id: string) => id.startsWith('obs-')),
  )).toBe(true);
  await page.getByRole('button', { name: 'Pause time' }).click();
  await expect.poll(async () => (await storedSession(page))?.status).toBe('paused');
  await expect(board.getByLabel('Collection asset')).toHaveValue('blue-scout');
  await board.getByRole('button', { name: 'Request collection' }).click();
  await expect.poll(async () => (await storedSession(page))?.physical?.intel?.tasks.length).toBe(1);
  await page.getByRole('button', { name: 'Start time' }).click();
  await expect.poll(async () => (await storedSession(page))?.physical?.intel?.tasks[0]?.status, { timeout: 12_000 }).toBe('complete');
  await expect(board.getByText('RECENT COVERAGE')).toBeVisible();
  await expect(board.getByText(/contact .* blue-scout/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  expect(pageErrors).toEqual([]);
});
