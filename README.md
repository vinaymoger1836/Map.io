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

Dragging works by mouse or finger, and a unit can be taken hold of anywhere on
its symbol, its label, or the selection ring around it — the ring is drawn a
little wider than the chip precisely so it can be grabbed. A unit keeps the
offset it was picked up by rather than snapping its centre under the pointer,
and the map does not pan while a unit is in hand. Picking a unit up selects it,
so the console is already showing what you are holding when you put it down.

A nation's colour is its units' colour, so recolouring a country recolours
everything it has on the board.

The board (nations, colours, units, and any special units you invented) is saved
to disk and survives a reload — see *Where things are saved* below. **Clear
units** and **Clear colours** at the foot of the console empty it.

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

### Systems and specifications

A unit type says what symbol to draw. A **system** says what the thing actually
is — an S-400 rather than a launcher, an F-16C rather than a fighter — and it is
the system that carries the numbers. Pick a type, then pick a system for it, then
say how many: a deployment is `12 × F-16C Fighting Falcon`, and that count is
what the map labels and the order of battle add up.

Specs are **facets**, not a schema per class. Every system has the same optional
slots and fills the ones that apply:

| Facet | Holds |
| --- | --- |
| `sensor` | detection range, tracks held, fire channels, what it sees |
| `weapons` | range, ready rounds, salvo, kill probability, reaction time |
| `platform` | combat radius, refuelled radius, speed, payload, VLS, aircraft, crew |
| `signature` | how visible it is |

An S-400 fills sensor and weapons; a fighter fills platform and weapons; a
destroyer fills all of them; a supply truck fills none. Everything downstream —
coverage rings, inventory, engagement maths — reads facets, so a system you
invent tomorrow gets all of it without a line of new code.

The **Systems** tab browses the shipped library, and duplicating an entry is how
you disagree with a figure: library entries are read-only, your copy is yours,
and a copy with the same id replaces the original everywhere.

**About the numbers.** `public/data/systems.json` holds 104 researched systems:
917 figures carry provenance, and **425 of them carry the URL of a page someone
actually opened**. The rest are declared estimates, and the distinction is
recorded in the data rather than implied — `source.kind: "placeholder"` may not
carry a URL, and the validator fails the file if one does. Confidence is per
field, shown as a dot beside the value:

- **high** (223) — sourced and unambiguous: hull displacement, VLS cells, crew.
- **medium** (197) — sourced but conditional or contested. A range means nothing
  without the target it assumes; the S-400's "600 km" is against a large, high,
  non-manoeuvring target, and each figure's `source.note` records that condition.
- **low** (497) — mostly kill probability, reaction time and salvo size, which
  nobody publishes. They exist so the engagement model has something to multiply,
  and they say so.

Two detection ranges (S-350, SAMP/T) are model estimates rather than citations:
the research declined to record a figure its retrieved page did not state, which
was correct but left those batteries with no detection ring at all. Both are
marked `placeholder` with the reasoning in the note.

Known gap: the seven carriers and two amphibious ships carry no sensor or
armament, so they draw no ring of their own — their reach is currently the air
wing and escorts around them. That family is worth one more pass with
`scripts/systems-topup-prompt.md`.

To research further systems, hand `scripts/systems-research-prompt.md` to a
Claude with web search, then check what comes back.
`scripts/systems-topup-prompt.md` fills gaps in files already researched without
discarding the citations they already carry.

```bash
# one request per family; save each response into research/
node scripts/merge-systems.mjs                      # combine, and see what is left
node scripts/validate-systems.mjs research/systems.merged.json
node scripts/merge-systems.mjs --write              # install as the library

node scripts/validate-systems.mjs --all             # every warning, not the first 25
node scripts/generate-systems.mjs                   # or regenerate the placeholders
```

The validator reports how many figures carry a source URL — the number that says
whether the library is research or recollection. It also rejects a URL attached
to a `placeholder` source, which is an estimate wearing a citation's clothes, and
checks that a munition shared between platforms carries the same figures on both,
since the research arrives one family at a time and that is exactly the
arrangement in which an SM-6 grows a hundred kilometres between batches.

### Where things are saved

War Games configuration is written as JSON files under `data/` by a route at
`app/api/store/[doc]/route.ts`, so it survives a cleared browser, can be diffed
and backed up, and is worth committing:

| Document | Holds |
| --- | --- |
| `data/board.json` | the working board — nations, units, your special units |
| `data/systems.json` | systems you authored or edited |

`lib/store.ts` is the only file that knows this. It falls back to `localStorage`
if the route is unavailable — a static export, say — and the console says which
of the two is in use. A board saved before any of this existed is migrated out of
`localStorage` on first load.

The route is unauthenticated and single-user by design: it runs on the machine
serving the app. **If this is ever exposed to a network, that route needs an auth
check before anything else.**

Every board change is undoable — `Ctrl+Z`, `Ctrl+Shift+Z`, or the buttons beside
the tool row. History is per session and is not saved.

### Coverage

What a unit can reach, drawn on the map: weapon envelopes, sensor detection, and
combat radius, in the nation's colour. A formation's coverage comes from the
systems inside it, so a carrier group inherits its escorts' umbrella without
anybody typing a number into the formation.

Four modes, because the useful views are narrow ones:

| Mode | Shows |
| --- | --- |
| **Off** | Nothing — the default, because forty units with three rings each is a picture of nothing |
| **Selected** | Only the unit you have selected |
| **Nation** | Everything the active nation has on the board — this is where a hole in a defence belt becomes visible |
| **All** | Every unit; overlaps compound, so layered defence reads darker |

**One ring per target class, not one per system.** An Arleigh Burke's longest
weapon is a land-attack Tomahawk at 1,600 km, and drawing that as *the* envelope
implies an air-defence reach seven times what it has. Each engagement ring is the
longest weapon that answers a given class of threat, and weapons covering several
classes draw once rather than three times. The **Against** row subtracts classes
from the picture: turn off *Ground* and the Tomahawk ring stops crowding out the
370 km one that matters to an aircraft. Rings whose spec never said what they were
for are never filtered out, because hiding them would claim knowledge the data
does not have.

**The target classes are deliberately not the obvious ones.** `air` covers
aircraft, cruise missiles and drones together, because they are one engagement
problem — a cruise missile is a small aeroplane, not a ballistic threat, and a
label saying "aircraft" understated what an S-400 is pointed at. Ballistic is
split three ways instead, because a Patriot PAC-3 (45 km, terminal phase, against
battlefield rockets) and an SM-3 (1,200 km, exo-atmospheric, against
intermediate-range missiles) were both reading `vs ballistic`, which made the map
assert they answer the same threat:

| Tier | Against | Systems in the library |
| --- | --- | --- |
| `ballistic-short` | Battlefield rockets, SRBMs | PAC-3, Buk-M3, Barak 8, Aster 30, HQ-9B, 48N6E2, SM-6 |
| `ballistic-medium` | Theatre / medium-range | S-400's 48N6, THAAD, SM-3 |
| `ballistic-imrbm` | Intermediate-range and above | SM-3 |

A system carries every tier it covers, not only its highest — something credited
against an MRBM can certainly engage an SRBM.

**That classification is a judgement, not a citation.** Unlike every figure in
the library, the tiers carry no provenance, because they are not published
numbers — they are a reading of each system's documented role. The reasoning for
each one is written out per system in `scripts/retag-ballistic.mjs`, so it can be
argued with and changed in one line. Where a claim is contested — Russian and
Chinese ballistic-defence claims usually are — the narrower reading was taken.
Run that script against `research/` whenever a new batch arrives; a stale plain
`ballistic` tag fails validation rather than silently drawing an uninterpretable
ring, and systems saved before the split are migrated on load by `reviveSpec`.

**Hovering a ring's circumference says what it is** — which unit, which munition,
how far, and against what. A circle can only ever say *how far*; until you can ask
what for, an S-400's 400 km and 250 km rings look like one of them is a mistake.
They are its 40N6 against aircraft and its 48N6 against ballistic missiles, which
is what the card says when you point at either. The
hit target is a 14 px invisible line rather than the 1 px drawn one, and where
rings overlap the tooltip picks the circumference the pointer is actually nearest,
so two rings 10 px apart still resolve to the right one.

**Rings are ground distance, not pixels.** A 400 km reach is not a circle on Web
Mercator, and a fixed-pixel circle would flatter a system at 68°N and understate
one at the equator. `lib/geo.ts` walks a geodesic and hands MapLibre a polygon in
real coordinates — which is also why zooming behaves: it is geography, not
decoration. Verified by measuring: every vertex of a 380 km ring sits 380 km from
its unit at both 60°N and the equator, while the two rings look nothing alike.

**The radar horizon is modelled.** Sensors marked `horizonLimited` are cut short
by the earth's curve against the altitude you are asking about. Switch the target
altitude from **High** to **Low** and an S-400's 600 km detection range collapses
to 62 km — which is roughly the truth about a 100 m target, and a useful
corrective to reading brochure figures off a map.

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
                   board state and how it is revived
lib/specs.ts       system specifications, facets, envelopes, provenance
lib/geo.ts         geodesic circles and distance — no dependency
lib/store.ts       the document store — the only thing that knows about storage
lib/munitions.ts   the munitions catalogue, derived from the systems
lib/unitIcons.ts   the canvas icon factory
lib/warLayers.ts   MapLibre sources and layers for the board
lib/useWarGames.ts board state and the map wiring
app/api/store/[doc]/route.ts   reads and writes data/*.json
components/WarGamesPanel.tsx   the console: section nav, composition only
components/wargames/           MapSection      tool, selection, palette,
                                               coverage, then paint at the foot
                               ArmamentsSection the systems catalogue + editor
                               ForcesSection    per-nation strength
                               and the parts they use: NationBlock, Palette,
                               SelectedUnit, LoadoutEditor, CompositionEditor,
                               SpecSheet, Coverage, OrderOfBattle, EnvelopeTip,
                               SectionNav, Modal
```

### The console's three sections

One long scroll put the colour picker above whatever you were actually doing and
buried the systems catalogue under the deploy controls. They are three different
jobs, so they are three places:

| Section | For |
| --- | --- |
| **Map** | Arranging the board. Tool, the selected unit and its editors, the deploy palette, what coverage draws — and painting at the foot, because you choose a nation's colour once and then deploy under it for an hour. |
| **Armaments** | What every system *is*. Search and filter the catalogue, read a spec sheet with its sources, duplicate a library entry to disagree with it, or author a new one in a dialog with the whole schema. |
| **Forces** | What each nation has. Strength by nation and the order of battle today; national inventory — stock that deploying draws down — is the Phase 3 addition, and it lands here. |

The system form is a dialog rather than a column, because thirty-odd fields in a
384 px panel is a scroll inside a scroll. It is portalled to `<body>`: the console
carries a `backdrop-filter`, and **any filtered ancestor becomes the containing
block for `position: fixed` descendants**, so an overlay declared inside it is
silently clipped to the panel's width.

### Changing what a deployed unit carries

Select a unit, open **Edit**, and its armament is a list you can add to and take
from. The change is local to that deployment: re-arming one flight of Su-30s
changes that flight's rings and nothing else — not the system, not the library,
not the other Su-30s on the board. `lib/munitions.ts` resolves the loadout
against the catalogue and hands everything downstream an *effective* spec, so
rings, tooltips and the spec sheet all redraw without any of them knowing that
loadouts exist.

**The catalogue is derived, never authored.** Every weapon on every system is a
row in it, keyed by the munition's own id — which is why the research prompt
insists the same round gets the same id everywhere. What a system may carry is
answered in two steps: if it declares `compatible`, that list is exact; otherwise
it is inferred from what other systems in the same domain carry. The inferred
answer is right at the domain level and costs nothing — it will not put a
Tomahawk on a MiG or a Meteor in a VLS cell — but it will offer a Rafale an
R-37M it cannot carry. Declaring `compatible` on that airframe is the fix, and
the interface says which of the two you are looking at.

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
- **A board is local to one machine.** It is a file under `data/`, so it
  survives a cleared browser but does not follow you to another computer.
  Scenarios and export/import are the next phase.
- **Coverage rings are flat circles of constant range.** Terrain does not mask
  them, a system's reach is not really uniform in every direction, and a ring
  drawn around a point near a pole will not enclose the pole properly.
- **System figures are approximate and some are guesses.** They carry their
  confidence for exactly that reason. Correct anything that matters to you —
  duplicating a library entry takes two clicks — rather than trusting a number
  because it is on a screen.
