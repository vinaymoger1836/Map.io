import { expect, type Page } from '@playwright/test';
import type { BaselineFixture } from '../warsim/fixtures/v1/scenarios';

const empty = { type: 'FeatureCollection', features: [] };
const countries = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-100, 40] }, properties: { iso: '840', name: 'United States', kind: 'country', rank: 1 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [110, 35] }, properties: { iso: '156', name: 'China', kind: 'country', rank: 1 } },
] };

/** All remote geography/fonts and every store document are isolated per test. */
export async function preparePage(page: Page, fixture: BaselineFixture, restoreSession = true) {
  const documents = new Map<string, unknown>([
    ['probe', null], ['board', { nations: {}, units: [], formations: [] }],
    ['forces', {}], ['scenarios', { active: null, items: [] }], ['systems', fixture.systems],
    ['warsim-session', restoreSession ? { ...fixture.session, status: 'paused' } : null],
  ]);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (local) {
      if (url.pathname.startsWith('/api/store/')) {
        const doc = url.pathname.split('/').at(-1)!;
        if (route.request().method() === 'PUT') {
          documents.set(doc, route.request().postDataJSON());
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: documents.get(doc) ?? null });
      }
      if (url.pathname === '/data/systems.json') return route.fulfill({ json: fixture.systems });
      if (url.pathname === '/data/world-countries.geojson') return route.fulfill({ json: countries });
      if (url.pathname.endsWith('.geojson')) return route.fulfill({ json: empty });
      return route.continue();
    }
    if (url.hostname === 'basemaps.cartocdn.com' || url.hostname === 'tiles.openfreemap.org') {
      return route.fulfill({ json: { version: 8, glyphs: 'https://fixture.invalid/fonts/{fontstack}/{range}.pbf',
        sources: {}, layers: [{ id: 'fixture-background', type: 'background', paint: { 'background-color': '#0c141d' } }] } });
    }
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ json: {
      type: 'Topology', objects: { countries: { type: 'GeometryCollection', geometries: [] } }, arcs: [],
    } });
    // Empty valid protobuf means absent glyphs, with no remote tile/font dependency.
    if (url.hostname === 'fixture.invalid') return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      return route.fulfill({ contentType: 'text/css', body: '' });
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(({ restored }) => {
    // A fresh browser context isolates localStorage; keep it across reloads.
    if (!sessionStorage.getItem('phase0-initialized')) {
      localStorage.clear();
      localStorage.setItem('mapio.lastMode', restored ? 'wargames' : 'situation');
      sessionStorage.setItem('phase0-initialized', '1');
    }
  }, { restored: restoreSession });
  return { documents, pageErrors };
}

export async function waitForMap(page: Page) {
  await expect(page.locator('.map-boot')).toHaveCount(0);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__warSimDiagnostics));
}

export async function storedSession(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mapio.wargames.warsim-session') ?? 'null'));
}
