/**
 * The War Games map layers: painted nations, world labels, and deployed units.
 *
 * These live alongside the situation-map layers rather than replacing them —
 * both sets stay installed and visibility decides which mode you are looking
 * at. Re-installing on a basemap swap is therefore the same call as the first
 * install, and switching modes costs nothing but a layout property.
 */

import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import type { WorldData } from './data';
import { CHROME } from './theme';
import {
  ECHELON_BY_ID,
  UNIT_BY_ID,
  unitLabel,
  type DeployedUnit,
  type Nation,
} from './warGames';
import { unitIconId } from './unitIcons';

export const WAR_LAYERS = [
  'wg-nation-fill',
  'wg-nation-line',
  'wg-country-label',
  'wg-city-dot',
  'wg-city-label',
  'wg-capital-dot',
  'wg-capital-label',
  'wg-unit-halo',
  'wg-unit',
] as const;

/** Layers a click should be tested against, most specific first. */
export const WAR_INTERACTIVE = ['wg-unit', 'wg-nation-fill'] as const;

/**
 * Zoom steps at which more of the world's names are allowed on screen. Each
 * feature carries the zoom it deserves (`z`, from Natural Earth's own label
 * ranking); these are the checkpoints where that test is re-run.
 */
const BREAKS = [1.4, 2.2, 2.8, 3.4, 4, 4.6, 5.2, 5.8, 6.4, 7.2];

/**
 * Builds a step-over-zoom expression that yields `visible` for features whose
 * `z` has come due and `hidden` for the rest.
 *
 * The same trick the situation map uses for tiers: a symbol still occupies the
 * collision index at zero opacity, so labels that are not due yet must resolve
 * to an empty *string* — otherwise an invisible Ulaanbaatar can suppress a
 * visible Beijing.
 */
function byZ<T>(visible: T, hidden: T): unknown {
  const at = (z: number) => ['case', ['<=', ['get', 'z'], z], visible, hidden];
  const expr: unknown[] = ['step', ['zoom'], at(BREAKS[0])];
  for (const z of BREAKS.slice(1)) expr.push(z, at(z));
  return expr;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function installWarLayers(map: MLMap, world: WorldData, font: string[]) {
  const firstSymbol = (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol')?.id;

  const source = (id: string, data: unknown) => {
    const existing = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
    if (existing?.setData) existing.setData(data);
    else if (!existing) map.addSource(id, { type: 'geojson', data: data as never });
  };

  source('wg-world-countries', world.countries);
  source('wg-world-places', world.places);
  source('wg-units', emptyCollection());

  const add = (layer: any, before?: string) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };

  /* ---------- painted nations ---------- */

  // Under the basemap's own symbols, so a painted country never buries the
  // place names the player is using to aim.
  add(
    {
      id: 'wg-nation-fill',
      type: 'fill',
      source: 'countries',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
    },
    firstSymbol
  );

  add(
    {
      id: 'wg-nation-line',
      type: 'line',
      source: 'countries',
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 1.6 },
    },
    firstSymbol
  );

  /* ---------- world labels ---------- */

  add({
    id: 'wg-country-label',
    type: 'symbol',
    source: 'wg-world-countries',
    layout: {
      visibility: 'none',
      'text-field': byZ(['get', 'name'], ''),
      'text-font': font,
      'text-size': ['interpolate', ['linear'], ['zoom'], 1.4, 10, 4, 13, 7, 15],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.16,
      'text-max-width': 7,
      'text-padding': 4,
    },
    paint: {
      'text-color': CHROME.paper,
      'text-opacity': byZ(0.92, 0),
      'text-halo-color': CHROME.ink,
      'text-halo-width': 1.6,
      'text-halo-blur': 0.5,
    },
  });

  add({
    id: 'wg-city-dot',
    type: 'circle',
    source: 'wg-world-places',
    filter: ['==', ['get', 'kind'], 'city'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 8, 3.4],
      'circle-color': CHROME.paperDim,
      'circle-opacity': byZ(0.9, 0),
    },
  });

  add({
    id: 'wg-city-label',
    type: 'symbol',
    source: 'wg-world-places',
    filter: ['==', ['get', 'kind'], 'city'],
    layout: {
      visibility: 'none',
      'text-field': byZ(['get', 'name'], ''),
      'text-font': font,
      'text-size': 10.5,
      'text-offset': [0, 0.8],
      'text-anchor': 'top',
      'text-padding': 3,
    },
    paint: {
      'text-color': CHROME.paperDim,
      'text-opacity': byZ(1, 0),
      'text-halo-color': CHROME.ink,
      'text-halo-width': 1.4,
    },
  });

  add({
    id: 'wg-capital-dot',
    type: 'circle',
    source: 'wg-world-places',
    filter: ['==', ['get', 'kind'], 'capital'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.2, 8, 4.4],
      'circle-color': CHROME.brass,
      'circle-opacity': byZ(1, 0),
      'circle-stroke-color': CHROME.ink,
      'circle-stroke-width': 1,
      'circle-stroke-opacity': byZ(0.9, 0),
    },
  });

  add({
    id: 'wg-capital-label',
    type: 'symbol',
    source: 'wg-world-places',
    filter: ['==', ['get', 'kind'], 'capital'],
    layout: {
      visibility: 'none',
      'text-field': byZ(['get', 'name'], ''),
      'text-font': font,
      'text-size': 11.5,
      'text-offset': [0, 0.85],
      'text-anchor': 'top',
      'text-padding': 3,
    },
    paint: {
      'text-color': CHROME.paper,
      'text-opacity': byZ(1, 0),
      'text-halo-color': CHROME.ink,
      'text-halo-width': 1.5,
    },
  });

  /* ---------- units ---------- */

  add({
    id: 'wg-unit-halo',
    type: 'circle',
    source: 'wg-units',
    filter: ['==', ['get', 'id'], '__none__'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 14, 6, 20, 10, 26],
      'circle-color': CHROME.brass,
      'circle-opacity': 0.14,
      'circle-stroke-color': CHROME.brass,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.9,
    },
  });

  add({
    id: 'wg-unit',
    type: 'symbol',
    source: 'wg-units',
    layout: {
      visibility: 'none',
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 0.72, 9, 0.92],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'center',
      // Names are noise on a crowded world board; they arrive once you are
      // close enough for the board to be about a theatre rather than a planet.
      'text-field': ['step', ['zoom'], '', 4.2, ['get', 'label']],
      'text-font': font,
      'text-size': 10,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 2,
    },
    paint: {
      'text-color': CHROME.paper,
      'text-halo-color': CHROME.ink,
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export function setWarVisible(map: MLMap, on: boolean) {
  for (const id of WAR_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

/** Applies the current nation colours to the country fill and its outline. */
export function paintNations(map: MLMap, nations: Record<string, Nation>) {
  if (!map.getLayer('wg-nation-fill')) return;
  const entries = Object.entries(nations);

  if (!entries.length) {
    map.setPaintProperty('wg-nation-fill', 'fill-opacity', 0);
    map.setPaintProperty('wg-nation-line', 'line-opacity', 0);
    return;
  }

  const isos = entries.map(([iso]) => iso);
  const colorMatch = [
    'match',
    ['get', 'iso'],
    ...entries.flatMap(([iso, nation]) => [iso, nation.color]),
    'rgba(0,0,0,0)',
  ] as unknown as ExpressionSpecification;
  const painted = ['in', ['get', 'iso'], ['literal', isos]] as unknown as ExpressionSpecification;

  map.setPaintProperty('wg-nation-fill', 'fill-color', colorMatch);
  map.setPaintProperty('wg-nation-fill', 'fill-opacity', [
    'case',
    painted,
    0.42,
    0,
  ] as unknown as ExpressionSpecification);

  map.setPaintProperty('wg-nation-line', 'line-color', colorMatch);
  map.setPaintProperty('wg-nation-line', 'line-opacity', [
    'case',
    painted,
    0.85,
    0,
  ] as unknown as ExpressionSpecification);
}

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

/** Turns the board's units into the GeoJSON the unit layers read. */
export function unitsToGeoJSON(units: DeployedUnit[], nations: Record<string, Nation>) {
  return {
    type: 'FeatureCollection',
    features: units.map((u) => {
      const type = UNIT_BY_ID.get(u.typeId);
      const echelon = ECHELON_BY_ID.get(u.echelonId);
      const color = nations[u.iso]?.color ?? '#9AA7B4';
      return {
        type: 'Feature',
        id: u.id,
        properties: {
          id: u.id,
          icon: unitIconId(u.typeId, echelon?.mark ?? { kind: 'none' }, color),
          label: unitLabel(u),
          nation: nations[u.iso]?.name ?? '',
          type: type?.label ?? u.typeId,
          echelon: echelon?.label ?? '',
        },
        geometry: { type: 'Point', coordinates: u.lngLat },
      };
    }),
  };
}

export function setUnits(map: MLMap, units: DeployedUnit[], nations: Record<string, Nation>) {
  const src = map.getSource('wg-units') as { setData?: (d: unknown) => void } | undefined;
  src?.setData?.(unitsToGeoJSON(units, nations));
}

export function highlightUnit(map: MLMap, id: string | null) {
  if (!map.getLayer('wg-unit-halo')) return;
  map.setFilter('wg-unit-halo', ['==', ['get', 'id'], id ?? '__none__'] as ExpressionSpecification);
}
