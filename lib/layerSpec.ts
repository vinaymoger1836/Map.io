import { ARCTIC, BORDERS, CONTROL, ENERGY, MILITARY } from './theme';

/**
 * One registry drives both the map and the panel. The panel row *is* the
 * legend key — there is no second legend to fall out of sync.
 */

export type SwatchShape = 'fill' | 'line' | 'dash' | 'dot' | 'band' | 'ring';

export interface Swatch {
  shape: SwatchShape;
  color: string;
  /** Optional second colour, e.g. a fill under an outline. */
  edge?: string;
}

export interface LayerKey {
  /** Toggle id, also used as the React key. */
  id: string;
  label: string;
  swatch: Swatch;
  /** MapLibre layer ids this switch controls. */
  layers: string[];
  on: boolean;
}

export interface LayerGroup {
  id: string;
  title: string;
  note?: string;
  open: boolean;
  keys: LayerKey[];
}

export const GROUPS: LayerGroup[] = [
  {
    id: 'control',
    title: 'Russia–Ukraine',
    note: 'Control of terrain as of 1 August 2026, hand-simplified. Treat it as orientation, not as an operational picture.',
    open: true,
    keys: [
      {
        id: 'ctl-occupied',
        label: 'Occupied since 2022',
        swatch: { shape: 'fill', color: CONTROL.occupied },
        layers: ['ctl-occupied-fill', 'ctl-occupied-line'],
        on: true,
      },
      {
        id: 'ctl-crimea',
        label: 'Annexed in 2014',
        swatch: { shape: 'fill', color: CONTROL.occupiedSince2014 },
        layers: ['ctl-crimea-fill', 'ctl-crimea-line'],
        on: true,
      },
      {
        id: 'ctl-front',
        label: 'Line of contact',
        swatch: { shape: 'band', color: CONTROL.frontline },
        layers: ['ctl-front-band', 'ctl-front-line'],
        on: true,
      },
      {
        id: 'ctl-hotspots',
        label: 'Contested points',
        swatch: { shape: 'ring', color: CONTROL.hotspot },
        layers: ['ctl-hotspot-ring', 'ctl-hotspot-dot', 'ctl-hotspot-label'],
        on: true,
      },
    ],
  },
  {
    id: 'borders',
    title: 'Borders',
    note: 'Colour encodes the kind of boundary, not the country on either side. Bloc outlines trace each member state, so internal borders inside a bloc are drawn too.',
    open: true,
    keys: [
      {
        id: 'bd-international',
        label: 'International',
        swatch: { shape: 'line', color: BORDERS.international },
        layers: ['bd-international'],
        on: true,
      },
      {
        id: 'bd-nato',
        label: 'NATO member outlines',
        swatch: { shape: 'line', color: BORDERS.nato },
        layers: ['bd-nato'],
        on: true,
      },
      {
        id: 'bd-eu',
        label: 'EU member outlines',
        swatch: { shape: 'line', color: BORDERS.eu },
        layers: ['bd-eu'],
        on: true,
      },
      {
        id: 'bd-csto',
        label: 'CSTO member outlines',
        swatch: { shape: 'line', color: BORDERS.csto },
        layers: ['bd-csto'],
        on: false,
      },
      {
        id: 'bd-defacto',
        label: 'De facto lines of control',
        swatch: { shape: 'dash', color: BORDERS.deFacto },
        layers: ['bd-defacto'],
        on: true,
      },
      {
        id: 'bd-disputed',
        label: 'Disputed boundaries',
        swatch: { shape: 'dash', color: BORDERS.disputed },
        layers: ['bd-disputed'],
        on: true,
      },
      {
        id: 'bd-reference',
        label: 'Recognised RU–UA border',
        swatch: { shape: 'dash', color: BORDERS.international },
        layers: ['bd-reference'],
        on: false,
      },
    ],
  },
  {
    id: 'alliances',
    title: 'Alliances',
    note: 'Fills overlap where memberships do — which is most of Europe.',
    open: false,
    keys: [
      {
        id: 'al-nato',
        label: 'NATO members',
        swatch: { shape: 'fill', color: BORDERS.nato },
        layers: ['al-nato'],
        on: false,
      },
      {
        id: 'al-eu',
        label: 'EU members',
        swatch: { shape: 'fill', color: BORDERS.eu },
        layers: ['al-eu'],
        on: false,
      },
      {
        id: 'al-csto',
        label: 'CSTO members',
        swatch: { shape: 'fill', color: BORDERS.csto },
        layers: ['al-csto'],
        on: false,
      },
      {
        id: 'al-eaeu',
        label: 'EAEU members',
        swatch: { shape: 'fill', color: BORDERS.eaeu },
        layers: ['al-eaeu'],
        on: false,
      },
    ],
  },
  {
    id: 'energy',
    title: 'Energy',
    note: 'Dimmed pipelines are idle: damaged, mothballed, or simply not flowing.',
    open: false,
    keys: [
      {
        id: 'en-gas',
        label: 'Gas pipelines — flowing',
        swatch: { shape: 'line', color: ENERGY.gas },
        layers: ['en-gas-active', 'en-gas-label'],
        on: false,
      },
      {
        id: 'en-gas-idle',
        label: 'Gas pipelines — idle',
        swatch: { shape: 'dash', color: ENERGY.gasSuspended },
        layers: ['en-gas-idle'],
        on: false,
      },
      {
        id: 'en-oil',
        label: 'Oil pipelines',
        swatch: { shape: 'line', color: ENERGY.oil },
        layers: ['en-oil'],
        on: false,
      },
      {
        id: 'en-lng',
        label: 'LNG terminals',
        swatch: { shape: 'dot', color: ENERGY.lng },
        layers: ['en-lng', 'en-lng-label'],
        on: false,
      },
      {
        id: 'en-refinery',
        label: 'Refineries and export terminals',
        swatch: { shape: 'dot', color: ENERGY.refinery },
        layers: ['en-refinery'],
        on: false,
      },
    ],
  },
  {
    id: 'military',
    title: 'Military',
    note: 'Well-known installations from open reporting, rounded to the site.',
    open: false,
    keys: [
      {
        id: 'mi-naval',
        label: 'Naval bases and fleet HQs',
        swatch: { shape: 'dot', color: MILITARY.navalRu, edge: MILITARY.navalNato },
        layers: ['mi-naval', 'mi-naval-label'],
        on: false,
      },
      {
        id: 'mi-base',
        label: 'Air and logistics bases',
        swatch: { shape: 'dot', color: MILITARY.base },
        layers: ['mi-base'],
        on: false,
      },
      {
        id: 'mi-nuclear',
        label: 'Nuclear-related sites',
        swatch: { shape: 'dot', color: MILITARY.nuclear },
        layers: ['mi-nuclear', 'mi-nuclear-label'],
        on: false,
      },
      {
        id: 'mi-airdef',
        label: 'Missile defence and early warning',
        swatch: { shape: 'dot', color: MILITARY.airDefence },
        layers: ['mi-airdef'],
        on: false,
      },
    ],
  },
  {
    id: 'arctic',
    title: 'Arctic',
    note: 'Sea ice geometry is generalised. The shelf claims are drawn to show that they overlap across the pole, which is the whole argument.',
    open: false,
    keys: [
      {
        id: 'ar-ice-max',
        label: 'Sea ice — winter maximum',
        swatch: { shape: 'fill', color: ARCTIC.iceMax },
        layers: ['ar-ice-max'],
        on: false,
      },
      {
        id: 'ar-ice-min',
        label: 'Sea ice — summer minimum',
        swatch: { shape: 'fill', color: ARCTIC.iceMin },
        layers: ['ar-ice-min'],
        on: false,
      },
      {
        id: 'ar-nsr',
        label: 'Northern Sea Route',
        swatch: { shape: 'line', color: ARCTIC.nsr },
        layers: ['ar-nsr', 'ar-nsr-projected', 'ar-nsr-label'],
        on: false,
      },
      {
        id: 'ar-eez',
        label: 'Extended shelf claims',
        swatch: { shape: 'dash', color: ARCTIC.eezRu },
        layers: ['ar-eez-fill', 'ar-eez-line'],
        on: false,
      },
      {
        id: 'ar-ports',
        label: 'Arctic ports and settlements',
        swatch: { shape: 'dot', color: ARCTIC.port },
        layers: ['ar-port', 'ar-port-label'],
        on: false,
      },
    ],
  },
  {
    id: 'places',
    title: 'Places',
    note: 'Detail is tied to zoom: capitals at every scale, cities from national scale, front-line towns at operational scale.',
    open: false,
    keys: [
      {
        id: 'pl-capital',
        label: 'Capitals',
        swatch: { shape: 'ring', color: '#E9E3D5' },
        layers: ['pl-capital-dot', 'pl-capital-label'],
        on: true,
      },
      {
        id: 'pl-city',
        label: 'Cities',
        swatch: { shape: 'dot', color: '#8C9AAA' },
        layers: ['pl-city-dot', 'pl-city-label'],
        on: true,
      },
    ],
  },
];

/** Flat map from toggle id to the MapLibre layers it owns. */
export const KEY_LAYERS: Record<string, string[]> = Object.fromEntries(
  GROUPS.flatMap((g) => g.keys.map((k) => [k.id, k.layers]))
);

export const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  GROUPS.flatMap((g) => g.keys.map((k) => [k.id, k.on]))
);

/** Arctic keys switched on together by the Arctic view button. */
export const ARCTIC_KEYS = ['ar-ice-min', 'ar-ice-max', 'ar-nsr', 'ar-eez', 'ar-ports'];
