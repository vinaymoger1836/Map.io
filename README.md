# Eurasia — geopolitical situation map

An interactive MapLibre GL map of Europe, Russia and the Arctic, built on Next.js 15
(App Router, TypeScript). Borders are coloured by *kind*, alliance blocs can be
overlaid, energy and military layers sit on top, and the Russia–Ukraine line of
contact is drawn from an editable snapshot.

```bash
npm install
npm run dev      # http://localhost:3000
```

No API keys. Basemap tiles come from CARTO and OpenFreeMap; country geometry is
fetched from world-atlas (Natural Earth) on jsDelivr.

---

## The one thing to read before using this

**The war data is a hand-drawn approximation, dated 1 August 2026.** It is fit for
orientation — showing roughly where the front runs and which places are contested —
and unfit for anything else. It will drift out of date immediately. Before you show
this to anyone, replace the geometry from a sourced dataset and update the `asOf`
date in `components/EurasiaMap.tsx`.

The Arctic shelf claims are schematic too. They are drawn to show that Russian,
Danish and Canadian submissions overlap across the pole, not to represent the
coordinates any of them actually filed.

---

## Editing the data

Everything lives in `public/data/*.geojson` and is fetched at runtime, so edits show
up on reload without a rebuild.

| File | What it holds |
| --- | --- |
| `control.geojson` | Occupied-territory polygons (2022 and 2014) |
| `frontline.geojson` | The line of contact |
| `hotspots.geojson` | Contested towns and sites |
| `borders-special.geojson` | De facto lines, disputed boundaries |
| `energy-lines.geojson` | Gas and oil pipeline corridors |
| `energy-points.geojson` | LNG terminals, refineries, export terminals |
| `military.geojson` | Bases, naval HQs, nuclear and early-warning sites |
| `arctic-*.geojson` | Sea ice, routes, shelf claims, ports |
| `places.geojson` | Cities and capitals — regenerate, don't hand-edit |

Every feature carries the same property vocabulary:

```jsonc
{
  "name": "Pokrovsk",     // shown as the label and the detail heading
  "kind": "hotspot",      // selects which layer draws it
  "rank": 1,              // 1 = always visible, 2 = from z4.6, 3 = from z6.4
  "status": "…",          // optional, shown in the detail panel
  "note": "…"             // optional, the paragraph in the detail panel
}
```

`places.geojson` and the Arctic geometry are generated:

```bash
node scripts/generate-data.mjs
```

Edit the arrays at the top of that script rather than the JSON it produces.

### Wiring it to a live source later

You chose a static snapshot, but the seam is clean if you change your mind:
`lib/data.ts` is the only place that knows where the GeoJSON comes from. Point
`getLocal('frontline')` at an API route that proxies and caches a live feed, and
nothing else in the app changes.

---

## How zoom-dependent detail works

Each feature has a `rank`. `byTier()` in `lib/mapLayers.ts` turns that into a
top-level zoom `step` whose branches test the rank — MapLibre requires zoom
expressions at the top level, which is why the test is nested that way round rather
than the obvious way. Radius is faded in the same expression as opacity, so a
feature you can't see also has no click target.

The tier boundaries are in `lib/theme.ts`. Change `TIERS` and both the map and the
readout rail follow.

---

## Adding a layer

1. Add the GeoJSON to `public/data/`, load it in `lib/data.ts`.
2. Add the MapLibre layer in `lib/mapLayers.ts` (`visibility: 'none'` initially —
   the panel turns things on).
3. Register a key in `lib/layerSpec.ts` with its swatch and the layer ids it owns.

The panel renders itself from `GROUPS`. There is no separate legend to update:
the switch and the legend key are the same row.

---

## Layout

```
app/            layout, page, globals.css (all design tokens)
components/     EurasiaMap (map + state), ControlPanel, DetailPanel, ReadoutRail
lib/theme.ts    colour and zoom tiers — the single source of truth
lib/layerSpec.ts  the layer registry that drives the panel
lib/mapLayers.ts  MapLibre sources, layers, expressions
lib/blocs.ts    alliance membership by ISO numeric code
lib/data.ts     data loading
scripts/        data generation
```

## Known limitations

- **Bloc outlines trace member states, not the bloc frontier.** Drawing a single
  outer edge needs a polygon dissolve; adding `@turf/union` over the member
  geometries at load time would fix it at the cost of a dependency and a second or
  two of startup.
- **Arctic view switches to globe projection.** Web Mercator cannot show the pole,
  so the Arctic button calls `setProjection({ type: 'globe' })`. On a MapLibre
  build without globe support it falls back to a Mercator fly-to and the polar
  geometry looks stretched.
- **Country geometry is a network fetch.** If jsDelivr is unreachable the border
  and alliance layers come up empty and the panel says so. Drop
  `countries-50m.json` into `public/data/` and repoint `COUNTRIES_URL` for an
  offline build.
- **Sea ice extent is illustrative**, hand-fitted to typical modern maxima and
  minima. Use NSIDC data for anything quantitative.
