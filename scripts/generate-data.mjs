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

/* ------------------------------------------------------------------ */
/* Waters — [name, lon, lat, rank, kind]                               */
/* Label anchors, not geometry: each point sits in open water near the */
/* middle of the body it names, so the label lands clear of any coast. */
/*                                                                     */
/* Rank is a zoom budget, not a judgement of importance. Rank 1 draws  */
/* at world zoom, so it is reserved for bodies wide enough to hold a   */
/* label there; rank 2 waits for ~4.6 and rank 3 for ~6.4, by which    */
/* point there is room for the enclosed seas, gulfs and straits. A     */
/* body that is famous but narrow (Hormuz, Gibraltar) still belongs    */
/* deep in the stack — at world zoom its label would be longer than    */
/* the water it names.                                                 */
/* ------------------------------------------------------------------ */

const WATERS = [
  /* Oceans -------------------------------------------------------- */
  ['Atlantic Ocean', -22.0, 44.0, 1, 'ocean'],
  ['South Atlantic Ocean', -15.0, -30.0, 1, 'ocean'],
  ['Arctic Ocean', 10.0, 84.0, 1, 'ocean'],
  ['Pacific Ocean', 165.0, 40.0, 1, 'ocean'],
  ['South Pacific Ocean', -125.0, -25.0, 1, 'ocean'],
  ['Indian Ocean', 80.0, -20.0, 1, 'ocean'],
  ['Southern Ocean', 60.0, -60.0, 1, 'ocean'],

  /* Europe and the Mediterranean ---------------------------------- */
  ['Mediterranean Sea', 17.5, 35.0, 1, 'sea'],
  ['Black Sea', 34.0, 43.3, 1, 'sea'],
  ['Baltic Sea', 19.5, 57.5, 1, 'sea'],
  ['North Sea', 3.5, 56.0, 1, 'sea'],
  ['Norwegian Sea', 2.0, 68.0, 1, 'sea'],
  ['Barents Sea', 40.0, 74.0, 1, 'sea'],
  ['Kara Sea', 75.0, 74.0, 1, 'sea'],
  ['Caspian Sea', 50.5, 41.5, 1, 'sea'],

  ['Greenland Sea', -5.0, 76.0, 2, 'sea'],
  ['Sea of Azov', 36.5, 46.1, 2, 'sea'],
  ['Aegean Sea', 25.0, 38.0, 2, 'sea'],
  ['Adriatic Sea', 15.5, 43.0, 2, 'sea'],
  ['Ionian Sea', 18.5, 38.0, 2, 'sea'],
  ['Tyrrhenian Sea', 12.0, 39.8, 2, 'sea'],
  ['Bay of Biscay', -5.0, 45.3, 2, 'sea'],
  ['English Channel', -1.0, 50.0, 2, 'sea'],
  ['Irish Sea', -5.2, 53.7, 2, 'sea'],
  ['Celtic Sea', -8.0, 50.5, 2, 'sea'],
  ['Gulf of Bothnia', 20.5, 62.5, 2, 'sea'],
  ['Gulf of Finland', 25.5, 60.0, 2, 'sea'],
  ['White Sea', 38.0, 65.5, 2, 'sea'],
  ['Skagerrak', 9.0, 57.8, 2, 'sea'],
  ['Sea of Marmara', 28.0, 40.7, 2, 'sea'],

  ['Kattegat', 11.5, 56.8, 3, 'sea'],
  ['Gulf of Riga', 23.5, 57.7, 3, 'sea'],
  ['Ligurian Sea', 8.8, 43.5, 3, 'sea'],
  ['Balearic Sea', 2.0, 40.0, 3, 'sea'],
  ['Alboran Sea', -3.0, 36.0, 3, 'sea'],
  ['Levantine Sea', 32.0, 34.0, 3, 'sea'],
  ['Strait of Gibraltar', -5.6, 35.9, 3, 'sea'],
  ['Kerch Strait', 36.5, 45.3, 3, 'sea'],

  /* Arctic and the Russian north ---------------------------------- */
  ['Laptev Sea', 125.0, 75.0, 2, 'sea'],
  ['East Siberian Sea', 160.0, 73.0, 2, 'sea'],
  ['Chukchi Sea', -175.0, 70.0, 2, 'sea'],
  ['Beaufort Sea', -140.0, 72.0, 2, 'sea'],
  ['Baffin Bay', -68.0, 74.0, 2, 'sea'],
  ['Denmark Strait', -27.0, 67.0, 2, 'sea'],
  ['Pechora Sea', 55.0, 69.5, 3, 'sea'],
  ['Gulf of Ob', 73.0, 70.0, 3, 'sea'],
  ['Bering Strait', -169.0, 65.8, 3, 'sea'],
  ['Davis Strait', -58.0, 66.0, 3, 'sea'],
  ['Hudson Strait', -70.0, 62.0, 3, 'sea'],

  /* North America ------------------------------------------------- */
  ['Hudson Bay', -85.0, 60.0, 1, 'sea'],
  ['Caribbean Sea', -75.0, 15.0, 1, 'sea'],
  ['Gulf of Mexico', -90.0, 25.0, 1, 'sea'],
  ['Labrador Sea', -55.0, 58.0, 2, 'sea'],
  ['Gulf of Alaska', -145.0, 55.0, 2, 'sea'],
  ['Gulf of California', -111.0, 27.0, 2, 'sea'],
  ['Sargasso Sea', -60.0, 30.0, 2, 'sea'],
  ['Gulf of St. Lawrence', -61.0, 48.0, 3, 'sea'],
  ['Florida Straits', -80.0, 24.3, 3, 'sea'],

  /* South America and the far south ------------------------------- */
  ['Scotia Sea', -45.0, -57.0, 2, 'sea'],
  ['Drake Passage', -65.0, -58.0, 2, 'sea'],
  ['Weddell Sea', -45.0, -72.0, 2, 'sea'],
  ['Ross Sea', 175.0, -75.0, 2, 'sea'],
  ['Amundsen Sea', -110.0, -72.0, 3, 'sea'],
  ['Bellingshausen Sea', -85.0, -70.0, 3, 'sea'],
  ['Río de la Plata', -56.5, -35.3, 3, 'sea'],

  /* Africa and the Middle East ------------------------------------ */
  ['Red Sea', 38.0, 22.0, 1, 'sea'],
  ['Persian Gulf', 51.5, 27.0, 1, 'sea'],
  ['Gulf of Guinea', 2.0, 2.0, 1, 'sea'],
  ['Gulf of Aden', 48.0, 12.5, 2, 'sea'],
  ['Mozambique Channel', 41.0, -18.0, 2, 'sea'],
  ['Gulf of Oman', 58.5, 24.5, 3, 'sea'],
  ['Strait of Hormuz', 56.5, 26.6, 3, 'sea'],
  ['Bab el-Mandeb', 43.4, 12.6, 3, 'sea'],
  ['Gulf of Suez', 33.0, 28.8, 3, 'sea'],

  /* South and Southeast Asia -------------------------------------- */
  ['Arabian Sea', 63.0, 15.0, 1, 'sea'],
  ['Bay of Bengal', 88.0, 15.0, 1, 'sea'],
  ['South China Sea', 114.0, 14.0, 1, 'sea'],
  ['Philippine Sea', 132.0, 18.0, 1, 'sea'],
  ['Andaman Sea', 96.0, 10.0, 2, 'sea'],
  ['Java Sea', 111.0, -5.0, 2, 'sea'],
  ['Banda Sea', 128.0, -6.0, 2, 'sea'],
  ['Timor Sea', 128.0, -11.5, 2, 'sea'],
  ['Arafura Sea', 136.0, -9.0, 2, 'sea'],
  ['Gulf of Thailand', 101.5, 9.0, 2, 'sea'],
  ['Celebes Sea', 122.0, 4.0, 3, 'sea'],
  ['Sulu Sea', 120.0, 9.0, 3, 'sea'],
  ['Molucca Sea', 125.0, 0.0, 3, 'sea'],
  ['Laccadive Sea', 73.0, 6.0, 3, 'sea'],
  ['Strait of Malacca', 99.5, 4.0, 3, 'sea'],
  ['Gulf of Tonkin', 107.5, 19.5, 3, 'sea'],
  ['Sunda Strait', 105.6, -5.9, 3, 'sea'],

  /* East Asia and the North Pacific ------------------------------- */
  ['Sea of Okhotsk', 150.0, 53.0, 1, 'sea'],
  ['Sea of Japan', 135.0, 40.0, 1, 'sea'],
  ['Bering Sea', 178.0, 58.0, 1, 'sea'],
  ['East China Sea', 125.0, 29.0, 1, 'sea'],
  ['Yellow Sea', 123.5, 35.5, 2, 'sea'],
  ['Bohai Sea', 119.5, 38.5, 3, 'sea'],
  ['Taiwan Strait', 119.5, 24.5, 3, 'sea'],
  ['Korea Strait', 129.0, 34.3, 3, 'sea'],

  /* Australia and the South Pacific ------------------------------- */
  ['Coral Sea', 155.0, -18.0, 1, 'sea'],
  ['Tasman Sea', 160.0, -38.0, 1, 'sea'],
  ['Great Australian Bight', 131.0, -36.0, 2, 'sea'],
  ['Bismarck Sea', 149.0, -4.0, 3, 'sea'],
  ['Solomon Sea', 154.0, -8.0, 3, 'sea'],
  ['Gulf of Carpentaria', 139.5, -14.0, 3, 'sea'],
  ['Bass Strait', 146.0, -39.7, 3, 'sea'],
  ['Cook Strait', 174.4, -41.3, 3, 'sea'],

  /* Inland ---------------------------------------------------------*/
  ['Aral Sea', 59.5, 45.0, 3, 'sea'],
];

write(
  'waters.geojson',
  fc(
    WATERS.map(([name, lon, lat, rank, kind]) => point(lon, lat, { name, kind, rank })),
    { note: 'Ocean and sea name anchors. Points position a label; they are not the extent of the water body.' }
  )
);
