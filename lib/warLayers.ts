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
  describeComposition,
  findFormation,
  totalStrength,
  unitLabel,
  unitLook,
  type DeployedUnit,
  type Formation,
  type Nation,
} from './warGames';
import {
  combineEnvelopes,
  describeTargets,
  effectiveDetectionKm,
  envelopesFor,
  systemById,
  ENVELOPE_LABELS,
  TARGET_CLASSES,
  type Envelope,
  type EnvelopeKind,
  type SystemSpec,
  type TargetClass,
} from './specs';
import { buildMunitions, effectiveSpec } from './munitions';
import { distanceKm, geodesicCircle } from './geo';
import { unitIconId } from './unitIcons';

export const WAR_LAYERS = [
  'wg-nation-fill',
  'wg-nation-line',
  'wg-envelope-fill',
  'wg-envelope-line',
  'wg-envelope-hover',
  'wg-envelope-hit',
  'wg-raid-line',
  'wg-raid-head',
  'wg-country-label',
  'wg-city-dot',
  'wg-city-label',
  'wg-capital-dot',
  'wg-capital-label',
  'wg-unit-halo',
  'wg-unit',
] as const;

/**
 * Zoom steps at which more of the world's names are allowed on screen.
 *
 * The stops are whole numbers on purpose. A layout property is evaluated once
 * per tile, at that tile's zoom — which is always an integer — so a stop at 4.2
 * does not fire at map zoom 4.2, it fires when tiles for zoom 5 arrive. Half
 * steps look considered and behave like a bug; whole ones do what they say.
 */
const BREAKS = [2, 3, 4, 5, 6, 7, 8];

/** Features below this `z` are the handful the world view can hold at once. */
const BASE_Z = 1.5;

/**
 * Builds a step-over-zoom expression that yields `visible` for features whose
 * `z` has come due and `hidden` for the rest.
 *
 * The same trick the situation map uses for tiers: a symbol still occupies the
 * collision index at zero opacity, so labels that are not due yet must resolve
 * to an empty *string* — otherwise an invisible Ulaanbaatar can suppress a
 * visible Beijing.
 */
function byZ(visible: unknown, hidden: unknown): unknown {
  const at = (z: number) => ['case', ['<=', ['get', 'z'], z], visible, hidden];
  const expr: unknown[] = ['step', ['zoom'], at(BASE_Z)];
  for (const z of BREAKS) expr.push(z, at(z));
  return expr;
}

/**
 * Label ink for the two kinds of basemap. Cream type with a dark halo is right
 * on dark-matter and wrong on positron, where it reads as a photocopy; the
 * board should look like it belongs to whatever it is drawn on.
 */
const INK = {
  dark: {
    country: CHROME.paper,
    capital: CHROME.paper,
    city: CHROME.paperDim,
    unit: CHROME.paper,
    halo: CHROME.ink,
  },
  light: {
    country: '#16222E',
    capital: '#16222E',
    city: '#4C5D6E',
    unit: '#16222E',
    halo: '#FFFFFF',
  },
} as const;

/** Matches nothing, which is what coverage shows until it is asked for. */
const HIDE_ALL = ['==', ['get', 'unitId'], '__none__'] as unknown as ExpressionSpecification;

/* eslint-disable @typescript-eslint/no-explicit-any */

export function installWarLayers(map: MLMap, world: WorldData, font: string[], dark = true) {
  const ink = dark ? INK.dark : INK.light;
  const firstSymbol = (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol')?.id;

  const source = (id: string, data: unknown) => {
    const existing = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
    if (existing?.setData) existing.setData(data);
    else if (!existing) map.addSource(id, { type: 'geojson', data: data as never });
  };

  source('wg-world-countries', world.countries);
  source('wg-world-places', world.places);
  source('wg-units', emptyCollection());
  source('wg-envelopes', emptyCollection());
  source('wg-raid', emptyCollection());

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

  /* ---------- coverage envelopes ---------- */

  // Above the painted nations, below every label: shading that buries the place
  // names is shading nobody can use. Overlaps are left to compound on purpose —
  // two SAM belts over the same ground should look denser than one, and the gap
  // between them should read as a gap.
  add(
    {
      id: 'wg-envelope-fill',
      type: 'fill',
      source: 'wg-envelopes',
      filter: HIDE_ALL,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'match',
          ['get', 'kind'],
          'engagement',
          0.13,
          'detection',
          0.05,
          0.04,
        ],
      },
    },
    firstSymbol
  );

  add(
    {
      id: 'wg-envelope-line',
      type: 'line',
      source: 'wg-envelopes',
      filter: HIDE_ALL,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': 0.75,
        'line-width': ['match', ['get', 'kind'], 'engagement', 1.6, 1],
        'line-dasharray': [
          'match',
          ['get', 'kind'],
          'engagement',
          ['literal', [1, 0]],
          'detection',
          ['literal', [4, 2]],
          ['literal', [1, 2]],
        ],
      },
    },
    firstSymbol
  );

  // The ring the pointer is on, brightened. Drawn over the others so a ring
  // buried under three overlapping neighbours still lifts out when you find it.
  add(
    {
      id: 'wg-envelope-hover',
      type: 'line',
      source: 'wg-envelopes',
      filter: HIDE_ALL,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': 1,
        'line-width': 3,
      },
    },
    firstSymbol
  );

  // Invisible, and much fatter than the line it shadows. A 1 px circumference is
  // an unhittable target with a mouse and a hopeless one with a finger; this
  // gives the pointer something to find without thickening what you see.
  add(
    {
      id: 'wg-envelope-hit',
      type: 'line',
      source: 'wg-envelopes',
      filter: HIDE_ALL,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 14 },
    },
    firstSymbol
  );

  /* ---------- the axis of attack ---------- */

  // Drawn above the envelopes and below the labels: the whole point of the line
  // is to be read against the rings it crosses, so it must not be buried by
  // them, and it must not bury the place names you are aiming at.
  //
  // It is a great-circle polyline rather than a two-point line, because MapLibre
  // draws a two-point line straight in screen space — which at 60°N is a
  // different path from the one the raid was assessed along, and would show it
  // missing belts it actually crosses.
  add(
    {
      id: 'wg-raid-line',
      type: 'line',
      source: 'wg-raid',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.9,
        'line-dasharray': [3, 2],
      },
    },
    firstSymbol
  );

  // The target end, so the direction of the run is not ambiguous.
  add(
    {
      id: 'wg-raid-head',
      type: 'circle',
      source: 'wg-raid',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 5,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
      },
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
      'text-color': ink.country,
      'text-opacity': byZ(0.92, 0),
      'text-halo-color': ink.halo,
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
      'circle-color': ink.city,
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
      'text-color': ink.city,
      'text-opacity': byZ(1, 0),
      'text-halo-color': ink.halo,
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
      'circle-stroke-color': ink.halo,
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
      'text-color': ink.capital,
      'text-opacity': byZ(1, 0),
      'text-halo-color': ink.halo,
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
      // Sized a little wider than the icon it rings, because it doubles as the
      // grab handle: a ring that merely traces the chip is a highlight you
      // cannot take hold of.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 19, 6, 26, 10, 33],
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
      // Whole-number stop for the same reason as BREAKS above.
      'text-field': ['step', ['zoom'], '', 4, ['get', 'label']],
      'text-font': font,
      'text-size': 10,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 2,
    },
    paint: {
      'text-color': ink.unit,
      'text-halo-color': ink.halo,
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RaidPathSpec {
  ingress: [number, number][];
  munition?: [number, number][];
  releasePoint?: [number, number];
  targetPoint: [number, number];
  color: string;
  munitionColor?: string;
}

/**
 * Draws the raid's path, or clears it.
 * Supports single continuous paths or multi-phase standoff ingress + munition runs.
 */
export function setRaidPath(
  map: MLMap,
  pathData: [number, number][] | RaidPathSpec | null,
  color = '#E4B363'
) {
  const source = map.getSource('wg-raid') as { setData?: (d: unknown) => void } | undefined;
  if (!source?.setData) return;

  if (!pathData) {
    source.setData(emptyCollection());
    return;
  }

  if (Array.isArray(pathData)) {
    if (!pathData.length) {
      source.setData(emptyCollection());
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'LineString', coordinates: pathData },
        },
        {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Point', coordinates: pathData[pathData.length - 1] },
        },
      ],
    });
    return;
  }

  const features: Array<{
    type: 'Feature';
    properties: { color: string; kind?: string };
    geometry: { type: 'LineString' | 'Point'; coordinates: [number, number][] | [number, number] };
  }> = [];

  if (pathData.ingress.length > 1) {
    features.push({
      type: 'Feature',
      properties: { color: pathData.color, kind: 'ingress' },
      geometry: { type: 'LineString', coordinates: pathData.ingress },
    });
  }

  if (pathData.releasePoint) {
    features.push({
      type: 'Feature',
      properties: { color: pathData.color, kind: 'release' },
      geometry: { type: 'Point', coordinates: pathData.releasePoint },
    });
  }

  if (pathData.munition && pathData.munition.length > 1) {
    features.push({
      type: 'Feature',
      properties: { color: pathData.munitionColor ?? '#FFB020', kind: 'munition' },
      geometry: { type: 'LineString', coordinates: pathData.munition },
    });
  }

  features.push({
    type: 'Feature',
    properties: { color: pathData.munitionColor ?? pathData.color, kind: 'target' },
    geometry: { type: 'Point', coordinates: pathData.targetPoint },
  });

  source.setData({
    type: 'FeatureCollection',
    features,
  });
}

export function setWarVisible(map: MLMap, on: boolean) {
  for (const id of WAR_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

/** Layers this app installs itself, which the basemap sweep below must skip. */
const OURS = /^(wg-|al-|ar-|bd-|ctl-|en-|mi-|pl-|wt-)/;

/**
 * Basemap symbols we silenced, so exit puts back exactly those.
 *
 * Only layers this module actually switched off go in here. A layer the style
 * itself ships hidden must stay hidden on the way out, and the set survives a
 * basemap swap because ids from the old style are simply no longer found.
 */
const hiddenSymbols = new Set<string>();

/**
 * Silences the basemap's own labels for the duration of War Games.
 *
 * Two sets of place names on one map is not twice as informative: the styles
 * disagree about which cities matter and where their anchors sit, so you get
 * Jaipur twice, four pixels apart, in two fonts. The board names the world; the
 * basemap draws it.
 */
export function hideBasemapSymbols(map: MLMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol' || OURS.test(layer.id)) continue;
    if (map.getLayoutProperty(layer.id, 'visibility') === 'none') continue;
    map.setLayoutProperty(layer.id, 'visibility', 'none');
    hiddenSymbols.add(layer.id);
  }
}

export function restoreBasemapSymbols(map: MLMap) {
  for (const id of hiddenSymbols) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  }
  hiddenSymbols.clear();
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
function unitsToGeoJSON(
  units: DeployedUnit[],
  nations: Record<string, Nation>,
  formations: Formation[],
  systems: SystemSpec[]
) {
  return {
    type: 'FeatureCollection',
    features: units.flatMap((u) => {
      const look = unitLook(u, formations);
      if (!look) return [];
      const color = nations[u.iso]?.color ?? '#9AA7B4';
      const isFormation = u.kind === 'formation';
      const formation = isFormation ? findFormation(u.formationId, formations) : undefined;
      return [
        {
          type: 'Feature',
          id: u.id,
          properties: {
            id: u.id,
            icon: unitIconId(look.key, look.mark, color),
            // A strike group's label carries its size, because the whole point
            // of a special unit is that it is more than one thing.
            label: isFormation
              ? `${unitLabel(u, formations, systems)} · ${totalStrength(u.composition)}`
              : unitLabel(u, formations, systems),
            nation: nations[u.iso]?.name ?? '',
            type: isFormation ? (formation?.label ?? 'Special unit') : (u.typeId ?? ''),
            detail: isFormation ? describeComposition(u.composition, systems) : '',
          },
          geometry: { type: 'Point', coordinates: u.lngLat },
        },
      ];
    }),
  };
}

export function setUnits(
  map: MLMap,
  units: DeployedUnit[],
  nations: Record<string, Nation>,
  formations: Formation[],
  systems: SystemSpec[] = []
) {
  const src = map.getSource('wg-units') as { setData?: (d: unknown) => void } | undefined;
  src?.setData?.(unitsToGeoJSON(units, nations, formations, systems));
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/** What the coverage controls can ask for. */
export interface CoverageState {
  mode: 'off' | 'selected' | 'nation' | 'all';
  kinds: Record<EnvelopeKind, boolean>;
  /**
   * Which threats to draw the reach against. 'What can reach my aircraft' is a
   * different picture from 'what can reach my ships', and a board that draws
   * both at once answers neither.
   */
  targets: Record<TargetClass, boolean>;
  /** Altitude of the target the sensors are being judged against, in metres. */
  targetAltM: number;
}

/**
 * Every reach on the board, as polygons in real coordinates.
 *
 * A unit's envelopes come from its system; a formation's come from the systems
 * inside it, widest of each kind — which is how a carrier group inherits its
 * escorts' umbrella without anybody typing a number into the formation.
 */
export function envelopesToGeoJSON(
  units: DeployedUnit[],
  nations: Record<string, Nation>,
  formations: Formation[],
  systems: SystemSpec[],
  targetAltM: number
) {
  const features: unknown[] = [];
  const munitions = buildMunitions(systems);

  for (const unit of units) {
    const color = nations[unit.iso]?.color ?? '#9AA7B4';
    const unitName = unitLabel(unit, formations, systems);
    let envelopes: Envelope[];
    let specs: (SystemSpec | undefined)[];

    if (unit.kind === 'formation') {
      specs = unit.composition.filter((p) => p.count > 0).map((p) => systemById(systems, p.systemId));
      envelopes = combineEnvelopes(specs);
    } else {
      // Whatever this deployment is actually carrying, which is not necessarily
      // what its system carries as standard.
      const spec = effectiveSpec(systemById(systems, unit.systemId), unit.loadout, munitions);
      specs = [spec];
      envelopes = envelopesFor(spec);
    }

    for (const envelope of envelopes) {
      let radiusKm = envelope.radiusKm;

      // A radar on the ground cannot see past the horizon, whatever the
      // brochure says. Judged against the altitude the player is asking about.
      if (envelope.kind === 'detection') {
        const limited = specs
          .map((spec) => (spec ? effectiveDetectionKm(spec, targetAltM) : null))
          .filter((v): v is number => v !== null);
        if (limited.length) radiusKm = Math.max(...limited);
      }
      if (radiusKm <= 0) continue;

      const targets = envelope.engages ?? [];
      features.push({
        type: 'Feature',
        properties: {
          // Identifies this one ring, so hovering it can highlight it alone.
          key: `${unit.id}|${envelope.kind}|${[...targets].sort().join(',')}`,
          unitId: unit.id,
          unitName,
          iso: unit.iso,
          kind: envelope.kind,
          kindLabel: ENVELOPE_LABELS[envelope.kind],
          color,
          radiusKm: Math.round(radiusKm),
          label: envelope.label,
          weapon: envelope.weapon ?? '',
          // Delimited so a filter can ask 'does this ring cover air' with a
          // substring test — '|air|' cannot match inside '|airborne|'.
          targetKey: targets.length ? `|${[...targets].sort().join('|')}|` : '',
          targetText: targets.length ? describeTargets(targets) : '',
          // Whether the radius drawn is the brochure figure or what the earth's
          // curve leaves of it, which is the first thing you ask of a short ring.
          horizonCut: envelope.kind === 'detection' && Math.round(radiusKm) < Math.round(envelope.radiusKm),
          nominalKm: Math.round(envelope.radiusKm),
        },
        geometry: geodesicCircle(unit.lngLat, radiusKm),
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

export function setEnvelopes(
  map: MLMap,
  units: DeployedUnit[],
  nations: Record<string, Nation>,
  formations: Formation[],
  systems: SystemSpec[],
  targetAltM: number
) {
  const src = map.getSource('wg-envelopes') as { setData?: (d: unknown) => void } | undefined;
  src?.setData?.(envelopesToGeoJSON(units, nations, formations, systems, targetAltM));
}

/** What a hovered ring says for itself. */
export interface EnvelopeHover {
  key: string;
  unitName: string;
  kindLabel: string;
  weapon: string;
  radiusKm: number;
  targetText: string;
  horizonCut: boolean;
  nominalKm: number;
  color: string;
  /** Where to put the tooltip, in screen pixels. */
  point: [number, number];
}

/** Mean of a polygon's vertices — the centre a geodesic ring was drawn about. */
function ringCentre(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type !== 'Polygon' || !geometry.coordinates[0]?.length) return null;
  const ring = geometry.coordinates[0];
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return [lng / ring.length, lat / ring.length];
}

/** The ring under the pointer, or null. Reads only the invisible hit layer. */
export function envelopeAt(map: MLMap, point: { x: number; y: number }): EnvelopeHover | null {
  if (!map.getLayer('wg-envelope-hit')) return null;
  if (map.getLayoutProperty('wg-envelope-hit', 'visibility') === 'none') return null;
  const hits = map.queryRenderedFeatures([point.x, point.y] as never, { layers: ['wg-envelope-hit'] });
  if (!hits.length) return null;

  // Overlapping rings are the normal case — a battery's detection ring sits
  // outside its engagement ring, and two batteries interlock — so the pointer
  // lands on several at once. Take the one whose circumference it is nearest,
  // which is the one it looks like you are pointing at.
  const here = map.unproject([point.x, point.y] as never);
  const cursor: [number, number] = [here.lng, here.lat];
  let best = hits[0];
  let bestGap = Infinity;
  for (const hit of hits) {
    const centre = ringCentre(hit.geometry);
    const radius = Number((hit.properties ?? {}).radiusKm);
    if (!centre || !Number.isFinite(radius)) continue;
    const gap = Math.abs(distanceKm(cursor, centre) - radius);
    if (gap < bestGap) {
      bestGap = gap;
      best = hit;
    }
  }

  const props = (best.properties ?? {}) as Record<string, unknown>;
  return {
    key: String(props.key ?? ''),
    unitName: String(props.unitName ?? ''),
    kindLabel: String(props.kindLabel ?? ''),
    weapon: String(props.weapon ?? ''),
    radiusKm: Number(props.radiusKm ?? 0),
    targetText: String(props.targetText ?? ''),
    horizonCut: props.horizonCut === true || props.horizonCut === 'true',
    nominalKm: Number(props.nominalKm ?? 0),
    color: String(props.color ?? '#9AA7B4'),
    point: [point.x, point.y],
  };
}

export function highlightEnvelope(map: MLMap, key: string | null) {
  if (!map.getLayer('wg-envelope-hover')) return;
  map.setFilter('wg-envelope-hover', ['==', ['get', 'key'], key ?? '__none__'] as ExpressionSpecification);
}

/**
 * Which envelopes are on screen. A filter rather than a rebuild: toggling a
 * category should be a frame, not a recomputation of every circle on the board.
 */
export function applyCoverage(
  map: MLMap,
  state: CoverageState,
  selectedId: string | null,
  activeIso: string | null
) {
  if (!map.getLayer('wg-envelope-fill')) return;

  const kinds = (Object.keys(state.kinds) as EnvelopeKind[]).filter((k) => state.kinds[k]);
  let filter: unknown = HIDE_ALL;

  if (kinds.length && state.mode !== 'off') {
    const clauses: unknown[] = ['in', ['get', 'kind'], ['literal', kinds]];
    const ofKind: unknown[] = ['all', clauses];

    // A ring that never said what it was for — a combat radius, a weapon with
    // no stated targets — is not filtered by target, because filtering it out
    // would be claiming knowledge the spec does not have.
    const targets = (Object.keys(state.targets) as TargetClass[]).filter((t) => state.targets[t]);
    if (targets.length < TARGET_CLASSES.length) {
      ofKind.push([
        'any',
        ['==', ['get', 'targetKey'], ''],
        ...targets.map((t) => ['in', `|${t}|`, ['get', 'targetKey']]),
      ]);
    }

    if (state.mode === 'all') filter = ofKind;
    else if (state.mode === 'nation')
      filter = [...ofKind, ['==', ['get', 'iso'], activeIso ?? '__none__']];
    else filter = [...ofKind, ['==', ['get', 'unitId'], selectedId ?? '__none__']];
  }

  map.setFilter('wg-envelope-fill', filter as ExpressionSpecification);
  map.setFilter('wg-envelope-line', filter as ExpressionSpecification);
  // The hit target must agree with what is drawn, or the pointer finds rings
  // that are not on screen.
  if (map.getLayer('wg-envelope-hit')) map.setFilter('wg-envelope-hit', filter as ExpressionSpecification);
}

export function highlightUnit(map: MLMap, id: string | null) {
  if (!map.getLayer('wg-unit-halo')) return;
  map.setFilter('wg-unit-halo', ['==', ['get', 'id'], id ?? '__none__'] as ExpressionSpecification);
}
