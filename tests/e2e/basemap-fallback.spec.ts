import { test, expect } from '@playwright/test';
import { createFixture } from '../warsim/fixtures/v1/scenarios';
import { preparePage, waitForMap } from './support';

test('failed remote tiles switch to an offline map while War Games stays usable', async ({ page }) => {
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  await page.route('**/gl/dark-matter-gl-style/style.json', route => route.fulfill({ json: {
    version: 8, sources: { streets: { type: 'vector',
      tiles: ['https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt'], minzoom: 0, maxzoom: 14 } },
    layers: [{ id: 'test-background', type: 'background', paint: { 'background-color': '#0c1722' } },
      { id: 'test-roads', type: 'line', source: 'streets', 'source-layer': 'roads', paint: { 'line-color': '#999' } }],
  } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Offline map active' })).toBeVisible();
  await waitForMap(page);
  await expect(page.getByRole('button', { name: 'offline', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'War games', exact: true }).click();
  await expect(page.getByRole('button', { name: /War Sim/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __map: import('maplibre-gl').Map }).__map.getLayer('wg-nation-fill')))).toBe(true);
  await expect(page.getByText('map errors in the last few seconds')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry online map' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('an unavailable style document can still boot the local map', async ({ page }) => {
  const { pageErrors } = await preparePage(page, createFixture('transit'), false);
  await page.route('**/gl/dark-matter-gl-style/style.json', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Offline map active' })).toBeVisible();
  await waitForMap(page);
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __map: import('maplibre-gl').Map }).__map.getLayer('bd-international')))).toBe(true);
  expect(pageErrors).toEqual([]);
});
