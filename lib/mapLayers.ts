import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  Map as MLMap,
} from 'maplibre-gl';
import { BLOCS } from './blocs';
import type { MapData } from './data';
import { ARCTIC, BORDERS, CHROME, CONTROL, ENERGY, MILITARY, TIERS } from './theme';

/* ------------------------------------------------------------------ */
/* Zoom tiers                                                          */
/* ------------------------------------------------------------------ */

const Z2 = TIERS[1].minzoom;
const Z3 = TIERS[2].minzoom;

/**
 * Fades a feature in at the zoom its rank belongs to. MapLibre requires the
 * zoom expression at the top level, so the rank test lives inside each branch
 * rather than the other way round.
 */
function byTier(full = 1): DataDrivenPropertyValueSpecification<number> {
  return [
    'step',
    ['zoom'],
    ['case', ['<=', ['get', 'rank'], 1], full, 0],
    Z2,
    ['case', ['<=', ['get', 'rank'], 2], full, 0],
    Z3,
    full,
  ] as unknown as DataDrivenPropertyValueSpecification<number>;
}

/** Same idea for radius: a hidden feature also has no hit area. */
function radiusByTier(r1: number, r3: number): DataDrivenPropertyValueSpecification<number> {
  return [
    'step',
    ['zoom'],
    ['case', ['<=', ['get', 'rank'], 1], r1, 0],
    Z2,
    ['case', ['<=', ['get', 'rank'], 2], r1, 0],
    Z3,
    r3,
  ] as unknown as DataDrivenPropertyValueSpecification<number>;
}

const isKind = (...kinds: string[]): ExpressionSpecification =>
  ['in', ['get', 'kind'], ['literal', kinds]] as ExpressionSpecification;

const inBloc = (members: string[]): ExpressionSpecification =>
  ['in', ['get', 'iso'], ['literal', members]] as ExpressionSpecification;

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

/**
 * Basemap styles ship different glyph sets. Borrowing the font stack from a
 * symbol layer already in the style means labels survive a basemap switch
 * instead of silently disappearing.
 */
export function detectFont(map: MLMap): string[] {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === 'symbol') {
      const font = (layer.layout as { 'text-font'?: string[] } | undefined)?.['text-font'];
      if (Array.isArray(font) && font.length) return font;
    }
  }
  return ['Noto Sans Regular'];
}

/** All layers a click should be tested against, most specific first. */
export const INTERACTIVE_LAYERS = [
  'ctl-hotspot-dot',
  'en-lng',
  'en-refinery',
  'mi-naval',
  'mi-nuclear',
  'mi-base',
  'mi-airdef',
  'ar-port',
  'pl-capital-dot',
  'pl-city-dot',
  'ar-nsr',
  'ar-nsr-projected',
  'en-gas-active',
  'en-gas-idle',
  'en-oil',
  'bd-defacto',
  'bd-disputed',
  'bd-reference',
  'ctl-front-line',
  'ar-eez-fill',
  'ctl-occupied-fill',
  'ctl-crimea-fill',
];

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

export function installLayers(map: MLMap, data: MapData) {
  const font = detectFont(map);
  const firstSymbol = (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol')?.id;

  const addSource = (id: string, geojson: unknown) => {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: geojson as never });
  };

  addSource('countries', data.countries);
  addSource('control', data.control);
  addSource('frontline', data.frontline);
  addSource('hotspots', data.hotspots);
  addSource('borders-special', data.bordersSpecial);
  addSource('energy-lines', data.energyLines);
  addSource('energy-points', data.energyPoints);
  addSource('military', data.military);
  addSource('arctic-ice', data.arcticIce);
  addSource('arctic-routes', data.arcticRoutes);
  addSource('arctic-eez', data.arcticEez);
  addSource('arctic-ports', data.arcticPorts);
  addSource('places', data.places);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const add = (layer: any, before?: string) => {
    if (map.getLayer(layer.id)) return;
    map.addLayer(layer, before);
  };

  const label = (
    id: string,
    source: string,
    opts: {
      filter?: ExpressionSpecification;
      color: string;
      size?: number;
      offset?: [number, number];
      anchor?: string;
      uppercase?: boolean;
      full?: number;
    }
  ) =>
    add({
      id,
      type: 'symbol',
      source,
      ...(opts.filter ? { filter: opts.filter } : {}),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': font,
        'text-size': opts.size ?? 11,
        'text-offset': opts.offset ?? [0, 0.95],
        'text-anchor': opts.anchor ?? 'top',
        'text-letter-spacing': opts.uppercase ? 0.14 : 0.02,
        'text-transform': opts.uppercase ? 'uppercase' : 'none',
        'text-max-width': 8,
        'text-allow-overlap': false,
        'text-padding': 3,
        visibility: 'none',
      },
      paint: {
        'text-color': opts.color,
        'text-opacity': byTier(opts.full ?? 1),
        'text-halo-color': CHROME.ink,
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      },
    });

  /* ---------- fills, tucked under the basemap's own labels ---------- */

  for (const bloc of [BLOCS.nato, BLOCS.eu, BLOCS.csto, BLOCS.eaeu]) {
    const color =
      bloc.id === 'nato'
        ? BORDERS.nato
        : bloc.id === 'eu'
          ? BORDERS.eu
          : bloc.id === 'csto'
            ? BORDERS.csto
            : BORDERS.eaeu;
    add(
      {
        id: `al-${bloc.id}`,
        type: 'fill',
        source: 'countries',
        filter: inBloc(bloc.members),
        layout: { visibility: 'none' },
        paint: { 'fill-color': color, 'fill-opacity': 0.16 },
      },
      firstSymbol
    );
  }

  add(
    {
      id: 'ar-ice-max',
      type: 'fill',
      source: 'arctic-ice',
      filter: isKind('ice-max'),
      layout: { visibility: 'none' },
      paint: { 'fill-color': ARCTIC.iceMax, 'fill-opacity': 0.22 },
    },
    firstSymbol
  );

  add(
    {
      id: 'ar-ice-min',
      type: 'fill',
      source: 'arctic-ice',
      filter: isKind('ice-min'),
      layout: { visibility: 'none' },
      paint: { 'fill-color': ARCTIC.iceMin, 'fill-opacity': 0.3 },
    },
    firstSymbol
  );

  add(
    {
      id: 'ar-eez-fill',
      type: 'fill',
      source: 'arctic-eez',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': [
          'match',
          ['get', 'claimant'],
          'Russia',
          ARCTIC.eezRu,
          ARCTIC.eezOther,
        ],
        'fill-opacity': 0.14,
      },
    },
    firstSymbol
  );

  add(
    {
      id: 'ctl-occupied-fill',
      type: 'fill',
      source: 'control',
      filter: isKind('occupied'),
      layout: { visibility: 'none' },
      paint: { 'fill-color': CONTROL.occupied, 'fill-opacity': 0.42 },
    },
    firstSymbol
  );

  add(
    {
      id: 'ctl-crimea-fill',
      type: 'fill',
      source: 'control',
      filter: isKind('occupied-2014'),
      layout: { visibility: 'none' },
      paint: { 'fill-color': CONTROL.occupiedSince2014, 'fill-opacity': 0.5 },
    },
    firstSymbol
  );

  /* ---------- border keylines ---------- */

  add({
    id: 'bd-international',
    type: 'line',
    source: 'countries',
    layout: { visibility: 'none', 'line-join': 'round' },
    paint: {
      'line-color': BORDERS.international,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 1.1],
      'line-opacity': 0.85,
    },
  });

  const blocOutline = (id: string, members: string[], color: string, width: number) =>
    add({
      id,
      type: 'line',
      source: 'countries',
      filter: inBloc(members),
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, width, 6, width * 2],
        'line-opacity': 0.9,
      },
    });

  blocOutline('bd-csto', BLOCS.csto.members, BORDERS.csto, 1);
  blocOutline('bd-eu', BLOCS.eu.members, BORDERS.eu, 0.9);
  blocOutline('bd-nato', BLOCS.nato.members, BORDERS.nato, 0.9);

  add({
    id: 'ctl-occupied-line',
    type: 'line',
    source: 'control',
    filter: isKind('occupied'),
    layout: { visibility: 'none' },
    paint: { 'line-color': CONTROL.occupied, 'line-width': 1, 'line-opacity': 0.9 },
  });

  add({
    id: 'ctl-crimea-line',
    type: 'line',
    source: 'control',
    filter: isKind('occupied-2014'),
    layout: { visibility: 'none' },
    paint: { 'line-color': CONTROL.occupiedSince2014, 'line-width': 1, 'line-opacity': 0.9 },
  });

  /* ---------- arctic lines ---------- */

  add({
    id: 'ar-eez-line',
    type: 'line',
    source: 'arctic-eez',
    layout: { visibility: 'none' },
    paint: {
      'line-color': ['match', ['get', 'claimant'], 'Russia', ARCTIC.eezRu, ARCTIC.eezOther],
      'line-width': 1.2,
      'line-dasharray': [3, 2],
      'line-opacity': 0.9,
    },
  });

  // line-dasharray takes no data-driven expression, so the established route
  // and the projected one are two layers rather than one styled by rank.
  add({
    id: 'ar-nsr',
    type: 'line',
    source: 'arctic-routes',
    filter: ['==', ['get', 'rank'], 1],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': ARCTIC.nsr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.8, 6, 3.4],
      'line-opacity': 0.95,
    },
  });

  add({
    id: 'ar-nsr-projected',
    type: 'line',
    source: 'arctic-routes',
    filter: ['==', ['get', 'rank'], 2],
    layout: { visibility: 'none', 'line-cap': 'butt' },
    paint: {
      'line-color': ARCTIC.nsr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 2.6],
      'line-dasharray': [2, 2],
      'line-opacity': 0.7,
    },
  });

  /* ---------- energy corridors ---------- */

  add({
    id: 'en-oil',
    type: 'line',
    source: 'energy-lines',
    filter: isKind('oil'),
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': ENERGY.oil,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 3],
      'line-opacity': ['case', ['==', ['get', 'status'], 'idle'], 0.45, 0.95],
    },
  });

  add({
    id: 'en-gas-idle',
    type: 'line',
    source: 'energy-lines',
    filter: ['all', isKind('gas'), ['==', ['get', 'status'], 'idle']],
    layout: { visibility: 'none', 'line-cap': 'butt' },
    paint: {
      'line-color': ENERGY.gasSuspended,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 3],
      'line-dasharray': [2, 2.5],
      'line-opacity': 0.85,
    },
  });

  add({
    id: 'en-gas-active',
    type: 'line',
    source: 'energy-lines',
    filter: ['all', isKind('gas'), ['!=', ['get', 'status'], 'idle']],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': ENERGY.gas,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.6, 6, 3.4],
      'line-opacity': 0.95,
    },
  });

  /* ---------- contested and disputed lines ---------- */

  add({
    id: 'bd-reference',
    type: 'line',
    source: 'borders-special',
    filter: isKind('reference'),
    layout: { visibility: 'none' },
    paint: {
      'line-color': BORDERS.international,
      'line-width': 1.4,
      'line-dasharray': [1, 2],
      'line-opacity': 0.9,
    },
  });

  add({
    id: 'bd-defacto',
    type: 'line',
    source: 'borders-special',
    filter: isKind('de-facto'),
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': BORDERS.deFacto,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 2.6],
      'line-dasharray': [2, 1.6],
      'line-opacity': 0.95,
    },
  });

  add({
    id: 'bd-disputed',
    type: 'line',
    source: 'borders-special',
    filter: isKind('disputed'),
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': BORDERS.disputed,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 2.6],
      'line-dasharray': [1, 1.6],
      'line-opacity': 0.95,
    },
  });

  /* ---------- the front ---------- */

  add({
    id: 'ctl-front-band',
    type: 'line',
    source: 'frontline',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONTROL.contestedBand,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 8, 6, 24, 9, 70],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 6, 9, 40],
      'line-opacity': 0.3,
    },
  });

  add({
    id: 'ctl-front-line',
    type: 'line',
    source: 'frontline',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONTROL.frontline,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 6, 3, 9, 5],
      'line-opacity': 1,
    },
  });

  /* ---------- point layers ---------- */

  const dot = (
    id: string,
    source: string,
    color: DataDrivenPropertyValueSpecification<string> | string,
    filter?: ExpressionSpecification,
    r1 = 4,
    r3 = 5
  ) =>
    add({
      id,
      type: 'circle',
      source,
      ...(filter ? { filter } : {}),
      layout: { visibility: 'none' },
      paint: {
        'circle-color': color,
        'circle-radius': radiusByTier(r1, r3),
        'circle-opacity': byTier(0.95),
        'circle-stroke-color': CHROME.ink,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': byTier(0.9),
      },
    });

  dot('en-refinery', 'energy-points', ENERGY.refinery, isKind('refinery'), 3.5, 4.5);
  dot('en-lng', 'energy-points', ENERGY.lng, isKind('lng'), 4, 5);
  dot('mi-base', 'military', MILITARY.base, isKind('base'), 3.5, 4.5);
  dot('mi-airdef', 'military', MILITARY.airDefence, isKind('airdef'), 3.5, 4.5);
  dot('mi-nuclear', 'military', MILITARY.nuclear, isKind('nuclear'), 4, 5);
  dot(
    'mi-naval',
    'military',
    ['match', ['get', 'bloc'], 'ru', MILITARY.navalRu, MILITARY.navalNato] as never,
    isKind('naval'),
    4.5,
    5.5
  );
  dot('ar-port', 'arctic-ports', ARCTIC.port, undefined, 4, 5);
  dot('pl-city-dot', 'places', CHROME.paperDim, isKind('city'), 2.6, 3.2);

  add({
    id: 'pl-capital-dot',
    type: 'circle',
    source: 'places',
    filter: isKind('capital'),
    layout: { visibility: 'none' },
    paint: {
      'circle-color': 'rgba(0,0,0,0)',
      'circle-radius': radiusByTier(3.4, 4),
      'circle-stroke-color': CHROME.paper,
      'circle-stroke-width': 1.6,
      'circle-stroke-opacity': byTier(0.95),
    },
  });

  add({
    id: 'ctl-hotspot-ring',
    type: 'circle',
    source: 'hotspots',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONTROL.hotspot,
      'circle-radius': radiusByTier(11, 14),
      'circle-opacity': byTier(0.16),
      'circle-blur': 0.5,
    },
  });

  add({
    id: 'ctl-hotspot-dot',
    type: 'circle',
    source: 'hotspots',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONTROL.hotspot,
      'circle-radius': radiusByTier(4.5, 5.5),
      'circle-opacity': byTier(1),
      'circle-stroke-color': CHROME.ink,
      'circle-stroke-width': 1.2,
      'circle-stroke-opacity': byTier(1),
    },
  });

  /* ---------- labels ---------- */

  label('pl-city-label', 'places', {
    filter: isKind('city'),
    color: CHROME.paperDim,
    size: 10.5,
  });

  label('pl-capital-label', 'places', {
    filter: isKind('capital'),
    color: CHROME.paper,
    size: 11.5,
    uppercase: true,
  });

  label('en-lng-label', 'energy-points', { filter: isKind('lng'), color: ENERGY.lng, size: 10 });
  label('en-gas-label', 'energy-lines', {
    filter: ['all', isKind('gas'), ['!=', ['get', 'status'], 'idle']] as ExpressionSpecification,
    color: ENERGY.gas,
    size: 10,
    anchor: 'center',
    offset: [0, 0],
  });
  label('mi-naval-label', 'military', { filter: isKind('naval'), color: MILITARY.base, size: 10 });
  label('mi-nuclear-label', 'military', {
    filter: isKind('nuclear'),
    color: MILITARY.nuclear,
    size: 10,
  });
  label('ar-port-label', 'arctic-ports', { color: ARCTIC.port, size: 10 });
  label('ar-nsr-label', 'arctic-routes', {
    color: ARCTIC.nsr,
    size: 10,
    anchor: 'center',
    offset: [0, -0.9],
  });
  label('ctl-hotspot-label', 'hotspots', {
    color: CONTROL.hotspot,
    size: 11,
    uppercase: true,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Applies the panel's on/off state to the map. */
export function applyVisibility(
  map: MLMap,
  keyLayers: Record<string, string[]>,
  state: Record<string, boolean>
) {
  for (const [key, layers] of Object.entries(keyLayers)) {
    const visibility = state[key] ? 'visible' : 'none';
    for (const id of layers) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }
}
