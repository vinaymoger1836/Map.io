# Top-up prompt — filling gaps in files already researched

The first research pass produced good, well-cited files that were missing the one
thing the map needs most: armament. The rule that caused it — *"if you cannot
find a figure, omit the field"* — was read as permission to drop a whole weapon,
and then the whole `weapons` array, whenever a kill probability could not be
sourced.

Rather than re-researching from scratch and throwing away several hundred
citations, hand back each file with the prompt below. It adds what is missing and
touches nothing else.

## Which files need it

| File | Action |
| --- | --- |
| `01-sam-launcher.json` | Add `sensor.detectionKm` for `s-350`, `iris-t-slm`, `samp-t`, `barak-8`. Weapons are complete. |
| `02-radar.json` | **Nothing.** Radars carry no weapons; that is correct. |
| `03-fighter.json` | Add weapons to 11 of 12, and `sensor.detectionKm` to 10. |
| `04-missile.json` | **Nothing.** A missile launcher needs no search radar of its own. |
| `05-destroyer.json` | Add weapons and `sensor.detectionKm` to all 5. |
| `06-cruiser.json` | Add weapons and `sensor.detectionKm` to all 3. |
| `07-carrier-ship.json` | Add weapons and `sensor.detectionKm` to all 7. |
| `08-submarine.json` | Add weapons and `sensor.detectionKm` to all 5. |
| `09-bomber.json` | Add weapons to all 6. |

Families never started should use the corrected main prompt in
`systems-research-prompt.md` instead — its rule 0 now prevents this.

---

## The prompt

````
Attached is a JSON file of military system specifications that I researched
earlier. It is good work and I want to keep it. It has one systematic gap, and I
need you to fill that gap without disturbing anything else.

## The gap

Systems that plainly carry armament came back with no `weapons` array at all —
an Arleigh Burke with no missiles, an F-16C with nothing to shoot. This happened
because the earlier instructions said to omit any figure that could not be
sourced, and a weapon whose kill probability is unpublished got dropped entirely.

That was the wrong reading. A missing kill probability is a missing detail. A
missing weapon is a missing capability, and the application draws no engagement
range for it at all.

## What to add

For every system in the file that is missing them:

1. **`weapons[]`** — the two or three munitions that define what the platform is
   for. A destroyer's area air-defence missile, its anti-ship missile, its
   land-attack missile. Not close-in guns, decoys, torpedoes for self-defence or
   sidearms. Each weapon needs at minimum:
   - `id` — lowercase slug of the name: `sm-6`, `aim-120c`, `meteor`, `kalibr`.
     THE SAME MUNITION MUST GET THE SAME id AND THE SAME FIGURES IN EVERY SYSTEM
     THAT CARRIES IT. These are merged into one catalogue by that id later.
   - `name`, `rangeKm`, `engages` — all three are published for essentially
     everything here.
   - `massKg` where you can find it — the launch mass of one round.
   - `magazine` where the platform's loadout is known (VLS cells allocated,
     hardpoints, rails).
   - `pk`, `reactionSec`, `salvo` — estimate these and mark them placeholders.
2. **`sensor.detectionKm`** for anything with a search radar or sonar, with
   `sees`, `horizonLimited` (true for ships and ground sites, false for
   aircraft), and `antennaM` where the mast or antenna height is known.
3. **`platform.combatRadiusKm`** for anything that flies, and
   `platform.radiusHeavyKm` where a source gives a radius at a heavier load.

## What NOT to touch

- Do not change any field that already has a value.
- Do not change or remove any existing `provenance` entry. Add new ones for the
  fields you add; leave the rest byte-for-byte as they are.
- Do not change any `id`, `name` or `typeId`.
- Do not reorder or drop systems. The file must come back with exactly the same
  systems it went in with.

## The rules that still apply

- Never invent a citation, and never invent a URL. Every `source.url` must be a
  page you actually opened.
- `pk`, `reactionSec` and `salvo` are not published for almost anything. Give an
  estimate, set `confidence: "low"` and `source.kind: "placeholder"`, explain
  your reasoning in `source.note`, and attach NO url.
- A range means nothing without its conditions. Record what the figure assumes —
  target RCS, altitude, profile — in that field's `source.note`.
- Where sources disagree, use the commonly cited value, mark it `medium`, and
  record the spread in the note.

## Provenance shape, for the fields you add

```json
"weapons.0.rangeKm": {
  "source": {
    "kind": "reference",
    "title": "the page or publication",
    "url": "https://…",
    "note": "conditions the figure assumes, or how sources differ"
  },
  "confidence": "medium"
}
```

`kind` is one of `manufacturer`, `government`, `reference`, `press`,
`placeholder`. Paths are dotted: `sensor.detectionKm`, `weapons.1.rangeKm`,
`platform.combatRadiusKm`.

## Output

Return the complete file — every system, with the additions merged in — as a
single JSON array, written back to a file of the same name. No prose in the file.
Tell me in the conversation which systems you added weapons to, and which figures
you could not source.
````

---

## After it comes back

Drop the returned files into `research/`, overwriting the old ones, then:

```bash
node scripts/merge-systems.mjs
node scripts/validate-systems.mjs research/systems.merged.json
node scripts/merge-systems.mjs --write
```

`merge-systems` keeps the last definition of any id, so a topped-up file replaces
its earlier self cleanly — there is nothing to reconcile by hand.
