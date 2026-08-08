/**
 * Regenerates the mechanical GeoJSON layers (places, Arctic geometry).
 * Run with:  node scripts/generate-data.mjs
 *
 * The hand-curated layers — control, frontline, hotspots, borders-special,
 * energy, military — are NOT touched by this script. Edit those directly.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
mkdirSync(OUT, { recursive: true });

const write = (file, fc) => {
  writeFileSync(join(OUT, file), JSON.stringify(fc, null, 1) + '\n');
  console.log(`${file}  ${fc.features.length} features`);
};

const fc = (features, metadata) => ({ type: 'FeatureCollection', metadata, features });
const point = (lon, lat, props) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

/* ------------------------------------------------------------------ */
/* Places — [name, lon, lat, rank, kind]                               */
/* rank 1 shows at every zoom; 2 from ~4.6; 3 from ~6.4                */
/* ------------------------------------------------------------------ */

const PLACES = [
  ['Moscow', 37.62, 55.75, 1, 'capital'],
  ['Kyiv', 30.52, 50.45, 1, 'capital'],
  ['London', -0.13, 51.51, 1, 'capital'],
  ['Paris', 2.35, 48.86, 1, 'capital'],
  ['Berlin', 13.40, 52.52, 1, 'capital'],
  ['Warsaw', 21.01, 52.23, 1, 'capital'],
  ['Istanbul', 28.98, 41.01, 1, 'city'],
  ['Madrid', -3.70, 40.42, 1, 'capital'],
  ['Rome', 12.50, 41.90, 1, 'capital'],
  ['Brussels', 4.35, 50.85, 1, 'capital'],
  ['Ankara', 32.86, 39.93, 2, 'capital'],

  ['Saint Petersburg', 30.34, 59.93, 2, 'city'],
  ['Minsk', 27.57, 53.90, 2, 'capital'],
  ['Vilnius', 25.28, 54.69, 2, 'capital'],
  ['Riga', 24.11, 56.95, 2, 'capital'],
  ['Tallinn', 24.75, 59.44, 2, 'capital'],
  ['Helsinki', 24.94, 60.17, 2, 'capital'],
  ['Stockholm', 18.07, 59.33, 2, 'capital'],
  ['Oslo', 10.75, 59.91, 2, 'capital'],
  ['Copenhagen', 12.57, 55.68, 2, 'capital'],
  ['Amsterdam', 4.90, 52.37, 2, 'capital'],
  ['Vienna', 16.37, 48.21, 2, 'capital'],
  ['Prague', 14.42, 50.09, 2, 'capital'],
  ['Budapest', 19.04, 47.50, 2, 'capital'],
  ['Bucharest', 26.10, 44.43, 2, 'capital'],
  ['Sofia', 23.32, 42.70, 2, 'capital'],
  ['Belgrade', 20.46, 44.79, 2, 'capital'],
  ['Zagreb', 15.98, 45.81, 2, 'capital'],
  ['Athens', 23.73, 37.98, 2, 'capital'],
  ['Bern', 7.45, 46.95, 2, 'capital'],
  ['Lisbon', -9.14, 38.72, 2, 'capital'],
  ['Dublin', -6.26, 53.35, 2, 'capital'],
  ['Reykjavík', -21.94, 64.15, 2, 'capital'],
  ['Bratislava', 17.11, 48.15, 2, 'capital'],
  ['Ljubljana', 14.51, 46.06, 2, 'capital'],
  ['Chișinău', 28.86, 47.01, 2, 'capital'],
  ['Tbilisi', 44.79, 41.72, 2, 'capital'],
  ['Yerevan', 44.51, 40.18, 2, 'capital'],
  ['Baku', 49.87, 40.41, 2, 'capital'],
  ['Astana', 71.43, 51.13, 2, 'capital'],
  ['Kharkiv', 36.23, 49.99, 2, 'city'],
  ['Odesa', 30.73, 46.48, 2, 'city'],
  ['Lviv', 24.03, 49.84, 2, 'city'],
  ['Dnipro', 35.05, 48.47, 2, 'city'],
  ['Kaliningrad', 20.51, 54.71, 2, 'city'],
  ['Murmansk', 33.08, 68.97, 2, 'city'],
  ['Rostov-on-Don', 39.72, 47.24, 2, 'city'],
  ['Yekaterinburg', 60.60, 56.84, 2, 'city'],
  ['Novosibirsk', 82.93, 55.03, 2, 'city'],
  ['Vladivostok', 131.89, 43.12, 2, 'city'],
  ['Sevastopol', 33.52, 44.62, 2, 'city'],

  ['Sarajevo', 18.41, 43.86, 3, 'capital'],
  ['Skopje', 21.43, 42.00, 3, 'capital'],
  ['Tirana', 19.82, 41.33, 3, 'capital'],
  ['Podgorica', 19.26, 42.44, 3, 'capital'],
  ['Pristina', 21.17, 42.66, 3, 'capital'],
  ['Luxembourg', 6.13, 49.61, 3, 'capital'],
  ['Nicosia', 33.36, 35.17, 3, 'capital'],
  ['Zaporizhzhia', 35.14, 47.84, 3, 'city'],
  ['Kherson', 32.62, 46.64, 3, 'city'],
  ['Mykolaiv', 31.99, 46.98, 3, 'city'],
  ['Kramatorsk', 37.55, 48.73, 3, 'city'],
  ['Sloviansk', 37.60, 48.85, 3, 'city'],
  ['Donetsk', 37.80, 48.00, 3, 'city'],
  ['Luhansk', 39.32, 48.57, 3, 'city'],
  ['Mariupol', 37.55, 47.10, 3, 'city'],
  ['Melitopol', 35.37, 46.85, 3, 'city'],
  ['Simferopol', 34.10, 44.95, 3, 'city'],
  ['Sumy', 34.80, 50.91, 3, 'city'],
  ['Chernihiv', 31.29, 51.49, 3, 'city'],
  ['Belgorod', 36.59, 50.60, 3, 'city'],
  ['Kursk', 36.19, 51.73, 3, 'city'],
  ['Bryansk', 34.36, 53.24, 3, 'city'],
  ['Voronezh', 39.20, 51.67, 3, 'city'],
  ['Volgograd', 44.52, 48.71, 3, 'city'],
  ['Sochi', 39.73, 43.60, 3, 'city'],
  ['Arkhangelsk', 40.54, 64.54, 3, 'city'],
  ['Norilsk', 88.20, 69.35, 3, 'city'],
  ['Narva', 28.19, 59.38, 3, 'city'],
  ['Gdańsk', 18.65, 54.35, 3, 'city'],
  ['Rzeszów', 22.00, 50.04, 3, 'city'],
  ['Constanța', 28.65, 44.18, 3, 'city'],
  ['Varna', 27.92, 43.21, 3, 'city'],
  ['Trabzon', 39.72, 41.00, 3, 'city'],
];

write(
  'places.geojson',
  fc(
    PLACES.map(([name, lon, lat, rank, kind]) => point(lon, lat, { name, kind, rank })),
    { note: 'Rank drives zoom-dependent visibility. Regenerate with scripts/generate-data.mjs.' }
  )
);

/* ------------------------------------------------------------------ */
/* Arctic                                                              */
/* ------------------------------------------------------------------ */

/** Builds a polar cap polygon from an ice-edge profile of [lon, lat] pairs. */
function polarCap(edge) {
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 5) ring.push([lon, interpolate(edge, lon)]);
  for (let lon = 180; lon >= -180; lon -= 20) ring.push([lon, 89.7]);
  ring.push(ring[0].slice());
  return { type: 'Polygon', coordinates: [ring] };
}

function interpolate(edge, lon) {
  for (let i = 0; i < edge.length - 1; i++) {
    const [l0, a0] = edge[i];
    const [l1, a1] = edge[i + 1];
    if (lon >= l0 && lon <= l1) {
      const t = (lon - l0) / (l1 - l0 || 1);
      return +(a0 + (a1 - a0) * t).toFixed(2);
    }
  }
  return edge[edge.length - 1][1];
}

// Winter maximum: ice reaches down the Labrador Sea, the Bering Sea and the White Sea.
const EDGE_MAX = [
  [-180, 58], [-160, 57], [-140, 70], [-120, 71], [-100, 68], [-80, 62],
  [-60, 52], [-40, 60], [-20, 70], [0, 76], [20, 74], [40, 69],
  [60, 70], [80, 73], [100, 74], [120, 73], [140, 70], [160, 62], [180, 58],
];

// Summer minimum: open water along most of the Eurasian coast — the condition
// that makes the Northern Sea Route navigable.
const EDGE_MIN = [
  [-180, 72], [-160, 71], [-140, 74], [-120, 76], [-100, 79], [-80, 80],
  [-60, 81], [-40, 82], [-20, 82], [0, 82], [20, 81], [40, 80],
  [60, 80], [80, 80], [100, 79], [120, 78], [140, 76], [160, 74], [180, 72],
];

write(
  'arctic-ice.geojson',
  fc(
    [
      {
        type: 'Feature',
        properties: {
          name: 'Sea ice — winter maximum',
          kind: 'ice-max',
          rank: 1,
          note: 'Roughly the March extent. Generalised for display; use NSIDC data for anything quantitative.',
        },
        geometry: polarCap(EDGE_MAX),
      },
      {
        type: 'Feature',
        properties: {
          name: 'Sea ice — summer minimum',
          kind: 'ice-min',
          rank: 1,
          note: 'Roughly the September extent. The retreat of this edge is what opens the Northern Sea Route and what the competing shelf claims are ultimately about.',
        },
        geometry: polarCap(EDGE_MIN),
      },
    ],
    { accuracy: 'generalised, illustrative only', source: 'shape hand-fitted to typical modern extents' }
  )
);

write(
  'arctic-routes.geojson',
  fc(
    [
      {
        type: 'Feature',
        properties: {
          name: 'Northern Sea Route',
          kind: 'nsr',
          rank: 1,
          note: 'Murmansk to the Bering Strait along the Russian Arctic coast. Roughly 40 percent shorter than the Suez route between north-west Europe and north-east Asia, and controlled through a Russian permitting and icebreaker escort regime.',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [33.08, 68.97], [40, 69.6], [48, 70.2], [58.5, 70.4], [66, 72.5],
            [72.05, 71.27], [78, 74.5], [90, 76.5], [104, 77.7], [116, 76.5],
            [130, 75.8], [142, 75.2], [155, 73.5], [168, 70.5], [-172, 67.5],
            [-169, 65.8],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {
          name: 'Transpolar Sea Route (projected)',
          kind: 'nsr',
          rank: 2,
          note: 'A straight-line crossing over the pole through international waters, viable only if summer ice keeps retreating. It would bypass Russian jurisdiction entirely, which is precisely why it matters politically.',
        },
        geometry: {
          type: 'LineString',
          coordinates: [[10, 71], [15, 78], [30, 84], [90, 89], [-170, 84], [-170, 74], [-169, 65.8]],
        },
      },
    ],
    { accuracy: 'schematic corridors' }
  )
);

/** Wedge from a coastal arc up to the pole — the shape of a shelf claim. */
function wedge(arc) {
  const ring = arc.map(([lon, lat]) => [lon, lat]);
  const first = arc[0];
  const last = arc[arc.length - 1];
  ring.push([last[0], 89.6], [(first[0] + last[0]) / 2, 89.9], [first[0], 89.6], [first[0], first[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

write(
  'arctic-eez.geojson',
  fc(
    [
      {
        type: 'Feature',
        properties: {
          name: 'Russian extended shelf submission',
          kind: 'eez',
          claimant: 'Russia',
          rank: 1,
          note: 'Russia claims the Lomonosov and Mendeleev ridges as natural prolongations of its continental shelf, which would carry its seabed rights across the pole. Submitted to the UN shelf commission; overlapping with Danish and Canadian claims.',
        },
        geometry: wedge([[32, 69.5], [60, 70.5], [90, 76], [120, 73.5], [150, 70], [170, 68.5]]),
      },
      {
        type: 'Feature',
        properties: {
          name: 'Danish (Greenland) shelf submission',
          kind: 'eez',
          claimant: 'Denmark',
          rank: 2,
          note: 'Denmark filed a claim on Greenland\u2019s behalf covering the Lomonosov Ridge beyond the pole — the largest of the Arctic submissions and directly overlapping Russia\u2019s.',
        },
        geometry: wedge([[-60, 82.5], [-40, 83.5], [-20, 82.5], [0, 81.5]]),
      },
      {
        type: 'Feature',
        properties: {
          name: 'Canadian shelf submission',
          kind: 'eez',
          claimant: 'Canada',
          rank: 2,
          note: 'Canada\u2019s submission also runs along the Lomonosov Ridge toward the pole. Separately, Canada treats the Northwest Passage as internal waters, which the United States disputes.',
        },
        geometry: wedge([[-140, 71], [-120, 74], [-100, 79], [-80, 81]]),
      },
    ],
    { accuracy: 'schematic — these are political claims, drawn to show that they overlap, not to represent submitted coordinates' }
  )
);

const ARCTIC_PORTS = [
  ['Murmansk', 33.08, 68.97, 1, 'Russia\u2019s only large ice-free Arctic port, western terminal of the Northern Sea Route and base of the nuclear icebreaker fleet.'],
  ['Sabetta', 72.05, 71.27, 1, 'Purpose-built LNG port on the Yamal Peninsula, the commercial reason the route exists.'],
  ['Dudinka', 86.18, 69.41, 2, 'River port serving Norilsk\u2019s nickel and palladium output.'],
  ['Tiksi', 128.87, 71.63, 2, 'Lena delta port and a reactivated Russian military airfield.'],
  ['Pevek', 170.31, 69.70, 2, 'Eastern Russian Arctic port, powered by a floating nuclear plant.'],
  ['Longyearbyen', 15.65, 78.22, 2, 'Svalbard\u2019s main settlement. The archipelago is Norwegian, but the 1920 treaty gives signatories — including Russia — equal commercial access.'],
  ['Kirkenes', 30.05, 69.73, 2, 'Norwegian port on the Russian border, once pitched as a European rail head for Arctic shipping.'],
  ['Nuuk', -51.72, 64.18, 2, 'Capital of Greenland, the pivot of renewed strategic interest in the North Atlantic.'],
  ['Utqiaġvik', -156.79, 71.29, 3, 'Northernmost settlement in the United States, near the Bering approach to the route.'],
];

write(
  'arctic-ports.geojson',
  fc(
    ARCTIC_PORTS.map(([name, lon, lat, rank, note]) => point(lon, lat, { name, kind: 'port', rank, note })),
    { note: 'Ports and settlements that anchor Arctic shipping and basing.' }
  )
);
