# Authoring a system

Every field in a system spec, what actually reads it, and what happens when you
leave it out — followed by two worked examples, a fighter and a destroyer,
annotated line by line.

The type definitions live in `lib/specs.ts`; this file is the guide to filling
them in. If the two ever disagree, `lib/specs.ts` is right.

---

## The one rule

**Blank means *not recorded*. It never means zero.**

The whole library is built on that distinction, and most of the surprises in the
list below come from it. A weapon with no `magazine` is not a weapon with no
ammunition — it is a weapon whose ammunition nobody published, and the engagement
model treats it as *unlimited* rather than *empty*. A system with no `sensor` is
not blind, it is unrecorded, and nothing holds its fire.

So an omission is not neutral. It is a claim, usually a generous one. Where you
genuinely do not know a figure, leave it out and let the model overstate rather
than typing a zero and letting it silently understate — but know which you are
doing.

## Facets, not classes

There is no destroyer schema. There is one shape with four optional slots, and a
system fills the ones that apply:

| Facet | What it is | Who fills it |
| --- | --- | --- |
| `sensor` | one search sensor — radar, sonar, an AEW&C's picture | ships, ground sites, AEW&C, some fighters |
| `weapons[]` | the munitions that define what it is for | anything armed |
| `platform` | the thing carrying them around | aircraft, ships, anything that moves |
| `signature` | how visible it is | aircraft, mostly |

A fighter fills `platform` and `weapons`. An early-warning radar fills `sensor`
alone. A destroyer fills all four. A supply truck fills none, and that is a
complete and correct spec.

---

## Top level

| Field | Required | What reads it |
| --- | --- | --- |
| `id` | yes | Identity. Lowercase letters, digits, dashes. A **custom system with the same id as a library one replaces it everywhere** — that is how you disagree with a shipped figure. |
| `name` | yes | Every label in the app. |
| `typeId` | yes | Two things, and the second is easy to miss. It picks the **map symbol**, and it decides what this system **is as a target**: `typeId` → domain → threat class, so a `destroyer` is engaged by anything whose weapons list `surface`. `missile`, `silo` and `ssbn` are special-cased into ballistic tiers by their longest weapon. |
| `origin` | no | Search and the browse list. |
| `note` | no | Free text. Variant, service dates, and — importantly — what the figures *do not* cover. |
| `signature` | no | `low` / `medium` / `high`. **Display only today.** Nothing computes with it; the engagement model has no stealth. |
| `compatible` | no | Munition ids this system may be re-armed with. Omitted, compatibility is inferred from the domain, which is right at the domain level and wrong in detail — it will offer a Rafale an R-37M. Declare it on the airframes where that matters. |
| `provenance` | no, but | Per-field sources. See below; the engagement model reads confidence out of it. |
| `custom` | — | Set by the app for systems you author. Do not type it by hand in a research file. |

Valid `typeId` values are the catalogue in `lib/warGames.ts`. The naval ones:
`carrier-ship`, `amphib-ship`, `cruiser`, `destroyer`, `frigate`, `corvette`,
`patrol`, `mine`, `logistics-ship`, `support-ship`, `intel-ship`, `submarine`,
`ssbn`, `midget-sub`.

## `sensor`

One sensor per system — the search sensor that matters. A destroyer has a dozen;
you record the air-search radar.

| Field | What reads it |
| --- | --- |
| `detectionKm` | **Required if `sensor` exists.** Draws the detection ring, and sets the point at which this system first holds a raid. |
| `horizonLimited` | `true` for anything on the ground or at sea, `false` for aircraft. When true, detection is cut to `4.12 × (√antennaM + √targetAltM)` — so a 320 km radar sees a 100 m sea-skimmer at about 60 km. This is the field that makes low-level penetration a real tactic. |
| `antennaM` | Height of the antenna above the surface, for that calculation. **Omitted, it falls back to 20 m**, which is a corvette's mast and a carrier's island alike. The validator warns about this. |
| `sees` | Target classes. **Filters the drawn ring only** — the engagement model's detection check does not consult it, so a sonar-only spec will still cue a SAM. Known simplification. |
| `engagements` | Fire channels: how many targets can be engaged at once. Caps simultaneity in the engagement model, multiplied by how many of the system stand at the pin. **Omitted means uncapped** — only 10 of 104 systems record it. |
| `tracks` | Targets held at once. **Display only.** |

## `weapons[]`

Two or three munitions that define what the platform is *for*. A destroyer's area
air-defence missile, its anti-ship missile, its land-attack missile. Not close-in
guns, not decoys, not self-defence torpedoes — they add rows and change no answer.

| Field | What reads it |
| --- | --- |
| `rangeKm` | **Required, > 0.** The engagement ring, and the radius the raid's path is tested against. |
| `id` | The munition catalogue key, shared across every platform carrying the round. `sm-6` on a Burke and on a Ticonderoga. This is what lets a deployed unit be re-armed from a list, and what the validator uses to check the same round has the same figures everywhere. **Omitted, it falls back to a slug of `name`** — which is how two Tomahawks once lived under two keys. Always set it. |
| `name` | Labels, and the fallback key. |
| `engages` | Target classes this round can be pointed at. Decides which ring it draws, and whether it may fire at a given raid. **Omitted, it engages everything**, and the layer is flagged *target class not stated*. |
| `pk` | Single-shot kill probability, 0–1. **Without it the weapon cannot be modelled at all** — it is listed under *Cannot be modelled* rather than counted as a zero. Nobody publishes these; estimate, and mark it a placeholder. |
| `salvo` | Rounds committed per target. The chance a salvo kills is `1 − (1 − pk)^salvo`. Defaults to 1. |
| `magazine` | Ready rounds, per instance of the system. **Omitted means infinite**, and this is the single most consequential omission in the library: an S-400's 48N6 records none, so on paper it stops any raid that enters its envelope. When an assessment comes back *Stopped* no matter what you change, this is usually why. |
| `reactionSec` | Detection to launch. If the raid crosses the envelope in less time than this, the layer never fires. |
| `minRangeKm` | **Display only**, and checked for consistency across platforms. The model has no minimum range. |
| `massKg` | Display, and consistency-checked across platforms. |

## `platform`

| Field | What reads it |
| --- | --- |
| `speedKmh` | **Without this the system cannot fly a raid at all.** Exposure time is the hinge the whole engagement calculation turns on, and there is no defensible default. Note that the library usually records a maximum, not a cruise. |
| `combatRadiusKm` | Draws the reach ring; warns when a raid is flown beyond it. |
| `refuelledRadiusKm` | The same, with tanker support. |
| `ferryRangeKm` | Display. |
| `vls` | Cells. Used by the loadout editor as a capacity floor — quad-packed rounds mean it is a floor, not a limit. |
| `payloadKg`, `crew`, `displacementT`, `aircraft`, `enduranceDays` | Display and the order of battle. |

## `provenance`

Keyed by dotted path — `sensor.detectionKm`, `weapons.0.rangeKm`,
`platform.combatRadiusKm` — pointing at a field the system actually has, or the
validator fails the file.

```json
"weapons.0.pk": {
  "source": {
    "kind": "placeholder",
    "title": "Modeling placeholder — not publicly disclosed",
    "note": "Why you chose this number, and what it assumes."
  },
  "confidence": "low"
}
```

`kind` is one of `manufacturer`, `government`, `reference`, `press`,
`placeholder`. Two hard rules, both enforced:

- A **`placeholder` must not carry a `url`**. An estimate with a link is an
  estimate wearing a reference's clothes.
- Every **other kind must carry the `url` of a page you actually opened**.

`confidence` is `high` / `medium` / `low`, and it is not decoration: the
engagement model widens each `pk` by ±10% / ±25% / ±40% according to it, and that
is where the "0.8 – 3.2 of 12 arrive" spread comes from. A `pk` with no recorded
confidence is treated as `low` — a figure that never said how good it was does
not get the benefit of the doubt.

A range means nothing without its conditions. The S-400's 600 km is against a
large, high, non-manoeuvring target; put that in `source.note`.

---

# Worked example: a fighter

`F-16C Fighting Falcon`, trimmed to the shape. No `sensor` — the F-16C's radar
was never researched, and the consequence is exactly what the rules above say:
the aircraft is not blind, it is unrecorded, so nothing constrains it.

```jsonc
{
  "id": "f-16c",
  "name": "F-16C Fighting Falcon",
  "typeId": "fighter",          // symbol; and makes it an 'air' target
  "origin": "United States",
  "note": "USAF single-seat multirole fighter. The combat radius is the fact
           sheet's air-to-surface figure and is optimistic; loaded air-to-air
           radius is typically less.",

  "platform": {
    "combatRadiusKm": 860,      // draws the reach ring
    "ferryRangeKm": 3222,
    "speedKmh": 2414,           // WITHOUT THIS IT CANNOT FLY A RAID
    "crew": 1
  },

  "weapons": [
    {
      "id": "aim-120c",         // shared key — same round on every airframe
      "name": "AIM-120C AMRAAM",
      "rangeKm": 105,
      "salvo": 1,
      "pk": 0.5,
      "reactionSec": 3,
      "engages": ["air"]        // air-to-air only: draws no ground ring
    },
    {
      "id": "aim-9x",
      "name": "AIM-9X Sidewinder",
      "rangeKm": 35,
      "salvo": 1,
      "pk": 0.6,
      "reactionSec": 2,
      "engages": ["air"]
    }
  ],

  "signature": "high",          // non-stealthy. Display only, today.

  "provenance": {
    "platform.combatRadiusKm": {
      "source": {
        "kind": "government",
        "title": "F-16 Fighting Falcon | U.S. Air Force Fact Sheet",
        "url": "https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104505/f-16-fighting-falcon/",
        "note": "'…can fly more than 500 miles (860 kilometers), deliver its weapons and return.'"
      },
      "confidence": "medium"    // sourced, but the source is optimistic
    },
    "weapons.0.pk": {
      "source": {
        "kind": "placeholder",  // therefore NO url
        "title": "Modeling placeholder — not publicly disclosed",
        "note": "Kill probability is not published by any source."
      },
      "confidence": "low"       // → the model brackets this pk by ±40%
    }
    // …one entry per figure
  }
}
```

Things worth noticing:

- **No `magazine` on either missile.** So in the model this F-16 never runs out
  of AMRAAM. Correct by the library's rules — hardpoint loadouts are not recorded
  anywhere — but it is why an aircraft's magazine is rarely the binding
  constraint.
- **No `sensor`.** It draws no detection ring, contributes nothing to its
  nation's air picture, and when defending is never held back for not seeing.
- `engages: ["air"]` on everything means this system is invisible to a raid of
  ships or ground units. It will appear in no layer against them.

---

# Worked example: a destroyer

`Arleigh Burke class (Flight IIA)`. A destroyer is the one class that fills every
facet, which is why it is the useful thing to copy.

```jsonc
{
  "id": "arleigh-burke",
  "name": "Arleigh Burke class (Flight IIA)",
  "typeId": "destroyer",        // symbol; and makes it a 'surface' target
  "origin": "United States",
  "note": "DDG-51 Flight IIA with SPY-1D(V) and 96 Mk-41 VLS cells. Figures are
           Flight IIA (DDG-79 on); Flight III adds SPY-6. VLS count and radar
           range are not on the Navy fact file.",

  "sensor": {
    "detectionKm": 320,         // brochure-ish, against a fighter-size target
    "sees": ["air"],
    "horizonLimited": true,     // IT IS A SHIP. Always true at sea.
    "antennaM": 20              // SPY-1D faces sit low on the superstructure
  },

  "weapons": [
    {
      "id": "sm-6",             // the SAME id and figures on every hull
      "name": "SM-6 (RIM-174)",
      "rangeKm": 370,
      "salvo": 2,
      "pk": 0.75,
      "reactionSec": 10,
      "engages": ["air", "surface", "ballistic-short"]
    },
    {
      "id": "tomahawk",
      "name": "Tomahawk (BGM-109)",
      "rangeKm": 1600,          // 4× the SM-6 — and a different question
      "salvo": 4,
      "pk": 0.8,
      "reactionSec": 60,
      "engages": ["ground"]     // THIS is what stops the 1,600 km ring being
    },                          // read as an air-defence umbrella
    {
      "id": "harpoon",
      "name": "Harpoon (RGM-84)",
      "rangeKm": 124,
      "massKg": 691,
      "salvo": 4,
      "pk": 0.6,
      "reactionSec": 30,
      "engages": ["surface"]
    }
  ],

  "platform": {
    "displacementT": 9700,
    "vls": 96,                  // capacity floor in the loadout editor
    "speedKmh": 56,
    "crew": 329,
    "aircraft": 2
  },

  "signature": "medium",

  "provenance": { /* one entry per figure — see the fighter above */ }
}
```

The three things that most often go wrong on a ship:

1. **`horizonLimited: true`, with a real `antennaM`.** Sixteen of the seventeen
   ships in the library once came back `false`, which handed every hull a
   brochure-range radar against sea-skimmers. If you leave `antennaM` out it
   defaults to 20 m — fine for a Burke, badly wrong for a carrier island or a
   patrol boat.
2. **`engages` on every weapon.** Omit it on the Tomahawk and the ship draws one
   1,600 km ring that reads as its air-defence reach, seven times what it has.
3. **The same munition id, with the same figures.** If your new destroyer carries
   an SM-6, copy `sm-6`'s range and mass exactly. The validator fails the file if
   one hull's SM-6 reaches 370 km and another's 240 km, and quietly duplicates the
   round in the re-arming list if you spell the id differently.

Note what is *not* recorded: no `magazine` on any of the three. Ninety-six cells
exist as `platform.vls`, but the split between SM-6, ESSM, VLA and Tomahawk is a
loadout decision, not a published fact — so in the model this ship never runs dry.
If you want a Burke that can be exhausted, that is what `magazine` is for, and
saying so in the `note` matters more than the number.

---

## Building a new destroyer, in order

1. `id`, `name`, `typeId: "destroyer"`, `origin`.
2. `platform` — `displacementT`, `speedKmh`, `crew`, `vls`, `aircraft`. These are
   the easy ones; hull figures are usually on a navy fact file and land as
   `high` confidence.
3. `sensor` — the air-search radar. `detectionKm`, `sees: ["air"]`,
   `horizonLimited: true`, and `antennaM` even if you have to reason it from the
   class rather than measure it. Say which in the note.
4. `weapons` — two or three. Area air defence, anti-ship, land attack. For each:
   `id`, `name`, `rangeKm`, `engages` — all published for essentially every
   ship — then `pk`, `salvo`, `reactionSec` as placeholders.
5. `provenance` for every number you typed. The validator will list the ones you
   missed.
6. `note` — the variant, and what the figures do not cover.

Then:

```bash
node scripts/validate-systems.mjs public/data/systems.json
```

It checks structure (a mistyped `detectionKm` does not crash anything — it
silently produces a system with no coverage, which is worse), rejects a
placeholder carrying a URL, warns about figures with no provenance at all, and
compares your munition ids against every other platform carrying the same round.

If you are authoring in the app instead, the **Armaments** tab has the whole
schema in a dialog: *New system*, or *Duplicate* on a library entry to disagree
with its figures. The form covers everything above except `compatible` and
`provenance`, which are JSON-only — a system authored in the UI carries no
sources, and the spec sheet will show its figures unmarked.

## Where the numbers come from

`scripts/systems-research-prompt.md` is the prompt for researching a family from
scratch; `scripts/systems-topup-prompt.md` fills gaps in a file that already has
citations worth keeping. Both encode the rules above, including the one that
matters most: never invent a citation, and never invent a URL.
