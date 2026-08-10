# Eurasia — geopolitical situation map

An interactive MapLibre GL map of Europe, Russia and the Arctic, built on Next.js 15
(App Router, TypeScript). Borders are coloured by *kind*, alliance blocs can be
overlaid, energy and military layers sit on top, and the Russia–Ukraine line of
contact is drawn from an editable snapshot.

It has two modes. The **situation map** is the published assessment described
above. **War Games** is a sandbox on the same globe: the whole world named, every
country paintable, and military units you place yourself.

```bash
npm install
npm run dev      # http://localhost:3000
```

No API keys. Basemap tiles come from CARTO and OpenFreeMap; country geometry is
fetched from world-atlas (Natural Earth) on jsDelivr.

It opens quiet: international borders, place names and water names, and nothing
else. Every other group — the war layers included — starts switched off, so the
map asserts nothing you did not ask it to.

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
| `waters.geojson` | Ocean and sea name anchors — regenerate, don't hand-edit |
| `world-countries.geojson` | War Games: one label anchor per country — generated |
| `world-places.geojson` | War Games: capitals and major cities — generated |

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

`places.geojson`, `waters.geojson` and the Arctic geometry are generated:

```bash
node scripts/generate-data.mjs
```

Edit the arrays at the top of that script rather than the JSON it produces.

The two `world-*.geojson` files at the bottom of that script are derived from
Natural Earth over the network — 240 countries and a thousand cities is exactly
the kind of data a human transcribes wrongly. Without a connection that section
is skipped with a warning and the committed files stand.

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

Labels get the same treatment twice over. `nameByTier()` drives `text-field`, so an
out-of-tier label resolves to an empty string rather than to transparent text —
opacity alone was not enough, because a symbol at zero opacity still claims its box
in the collision index and goes on pushing visible labels off the map. An invisible
`Sevastopol` was what kept `BLACK SEA` from ever being drawn.

The tier boundaries are in `lib/theme.ts`. Change `TIERS` and both the map and the
readout rail follow.

---

## War Games

A sandbox mode, reached from the **War games** button. It opens on the world at
zoom 1.9 with every country, capital and major city named, and it silences the
basemap's own labels while it is open — two sets of place names on one map is not
twice as informative, it is Jaipur twice in two fonts.

Three tools, in the order you use them:

| Tool | What it does |
| --- | --- |
| **Paint** | Click a country to give it the active colour |
| **Deploy** | Click the map to place the selected unit; stays armed, `Esc` stops |
| **Select** | Click a unit to select, drag to reposition, `Delete` to remove |

A nation's colour is its units' colour, so recolouring a country recolours
everything it has on the board.

The board (nations, colours, units, and any special units you invented) is kept
in `localStorage` and survives a reload. **Clear units** and **Clear colours** at
the foot of the console empty it.

### Units and special units

The palette has two catalogues, because there are two kinds of thing on a board.

**Units** are one class of thing — a destroyer, a fighter squadron, a radar. Around
50 of them across five domains (ground, air, naval, subsurface, installations),
each with the echelons that make sense for it, from a special forces team to a
tank division. Pick the type, pick the quantity, deploy.

**Special units** are formations *of* units: a carrier strike group is a carrier
plus the escorts that make it a group; an air defence system is a radar plus the
launchers it cues and the post that commands them. Selecting one opens its
composition, which you set before deploying — how many destroyers screen a
carrier is exactly the sort of thing a board is for arguing about. Seven come
built in:

| Special unit | Typical composition |
| --- | --- |
| Carrier strike group | Carrier, 3 destroyers, 2 frigates, submarine, replenishment |
| Amphibious ready group | Assault ship, destroyer, frigate, marines, replenishment |
| Surface action group | Cruiser, 2 destroyers, frigate |
| Hunter-killer group | 2 submarines, maritime patrol, frigate |
| Air defence system | Radar, 4 launchers, command post |
| Air strike package | 4 strike, 2 fighters, AEW&C, tanker |
| Combined arms battlegroup | 2 armour, 2 mech infantry, artillery, air defence, engineers, logistics |

The catalogue composition is a starting point, never a rule: editing it changes
what the *next* deployment contains, and units already on the board keep the
composition they were placed with. **Save these counts** turns the edit into a
special unit of your own.

**Your own special units.** *New special unit* takes a name and a composition —
"Air strike package: 3 strike fighters, 1 bomber, 1 AEW&C, 1 tanker" — and adds
it to the palette. It is marked on the map with the initials of its name and
drawn as whatever it has most of, so that package flies a strike fighter in an
air frame. Deleting a special unit also removes what was deployed from it, since
those pins would otherwise lose their name and symbol.

Selecting a deployed special unit shows its composition first, with **Edit**
below for renaming it or changing what is inside that one.

### How the symbols are drawn

Every nation picks its own colour, so a sprite sheet would need one image per
(unit type × colour). Instead `lib/unitIcons.ts` paints each icon to a canvas on
demand and hands it to MapLibre as an image, cached by id — which keeps units on
a *symbol* layer, with the collision handling and GPU batching that brings,
rather than hundreds of DOM markers fighting the map for frames.

The symbology follows APP-6 loosely: the frame shape encodes the domain (arch for
air, hull for surface, inverted arch for subsurface, clipped corners for a fixed
site), the glyph encodes function, and the mark above the frame encodes size —
dots and bars for ground echelons, a short word for naval and air groupings.

### Where the pieces live

```
lib/warGames.ts    unit and formation catalogues, echelons, nation colours,
                   board state and its persistence
lib/unitIcons.ts   the canvas icon factory
lib/warLayers.ts   MapLibre sources and layers for the board
lib/useWarGames.ts board state and the map wiring
components/WarGamesPanel.tsx   the console
```

Adding a unit type is one line in `UNIT_TYPES` plus a glyph in `GLYPHS`; adding a
built-in special unit is one entry in `FORMATIONS`. The panel and the map both
render from those catalogues.

A deployed thing is a discriminated union — `kind: 'unit'` carries a type and an
echelon, `kind: 'formation'` carries a composition — rather than one shape with
optional fields, so nothing can quietly treat a strike group as if it had an
echelon. Boards saved before special units existed are migrated on load: the old
`carrier`, `amphibious` and `sam` types are read as the formations they became.

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
components/     EurasiaMap (map + mode state), ControlPanel, DetailPanel,
                ReadoutRail, WarGamesPanel
lib/theme.ts    colour and zoom tiers — the single source of truth
lib/layerSpec.ts  the layer registry that drives the panel
lib/mapLayers.ts  MapLibre sources, layers, expressions
lib/warGames.ts   War Games catalogue and board state
lib/warLayers.ts  War Games map layers
lib/unitIcons.ts  canvas-drawn unit symbols
lib/useWarGames.ts  War Games state and map wiring
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
- **War Games units are markers, not a model.** Nothing moves, shoots, spots or
  is scored; the mode is a board you arrange, not a simulation.
- **A War Games board is local to one browser.** It lives in `localStorage`, so
  it does not follow you to another machine and clearing site data loses it.
  Export/import would be a small addition to `lib/warGames.ts` if you need it.
