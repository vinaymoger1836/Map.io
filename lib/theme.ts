/**
 * Single source of truth for colour.
 *
 * Rule of the design: the interface chrome is almost colourless — deep chart
 * ink, parchment type, one brass accent. Every saturated colour on screen is
 * *data*. If you see red, it means something on the map means red.
 */

export const CHROME = {
  ink: '#0C141D',
  inkPanel: '#111C27',
  inkRaised: '#182634',
  rule: '#28394B',
  paper: '#E9E3D5',
  paperDim: '#8C9AAA',
  brass: '#C9A227',
} as const;

/** Control-of-terrain palette (Russia–Ukraine). */
export const CONTROL = {
  occupied: '#B03A2E',
  occupiedSince2014: '#7E2A22',
  frontline: '#E4572E',
  contestedBand: '#E4572E',
  ukraineHeld: '#3D7EA6',
  hotspot: '#F2A33C',
} as const;

/** Border keylines. Each colour encodes a *kind* of border, not a country. */
export const BORDERS = {
  international: '#5A6B7C',
  nato: '#4F8FCB',
  eu: '#D8B54A',
  csto: '#7E9B54',
  eaeu: '#4FA89B',
  deFacto: '#E4572E',
  disputed: '#C97BC0',
} as const;

/** Energy infrastructure. */
export const ENERGY = {
  gas: '#E0A83C',
  gasSuspended: '#6E6A5C',
  oil: '#8C6239',
  lng: '#5FBFA0',
  refinery: '#C4703F',
} as const;

/** Military. */
export const MILITARY = {
  base: '#8FA5BC',
  navalRu: '#B03A2E',
  navalNato: '#4F8FCB',
  nuclear: '#D9C24A',
  airDefence: '#9B7FD4',
} as const;

/** Arctic. */
export const ARCTIC = {
  iceMax: '#6E93AE',
  iceMin: '#BBD9EA',
  nsr: '#48C3D6',
  eezRu: '#B03A2E',
  eezOther: '#8FA5BC',
  port: '#BBD9EA',
} as const;

/**
 * Zoom tiers. The readout rail names the current tier, and every point layer
 * declares which tier it belongs to — this is how "zoom out for the big
 * picture, zoom in for detail" is implemented.
 */
export interface Tier {
  rank: 1 | 2 | 3;
  name: string;
  minzoom: number;
  note: string;
}

export const TIERS: Tier[] = [
  { rank: 1, name: 'Regional', minzoom: 0, note: 'Capitals, theatres, major infrastructure' },
  { rank: 2, name: 'National', minzoom: 4.6, note: 'Major cities, bases, terminals' },
  { rank: 3, name: 'Operational', minzoom: 6.4, note: 'Front-line towns, individual sites' },
];

export function tierForZoom(zoom: number): Tier {
  let current = TIERS[0];
  for (const t of TIERS) if (zoom >= t.minzoom) current = t;
  return current;
}
