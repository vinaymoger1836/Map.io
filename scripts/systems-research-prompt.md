# Research prompt — War Games systems library

Hand the block below to Claude (claude.ai or Cowork) with web search enabled. It
produces `public/data/systems.json`, replacing figures that were written from
memory with figures that carry a real source.

## How the work goes

**A family at a time, not a system at a time.** Ask for the `sam-launcher` group
and you get 16 systems back in one JSON array — not one system, and not all 104.

On an agentic surface (Cowork, Claude Code) the prompt asks it to write one file
per family into `research/` and keep going through the roster by itself; you may
still want to run it in two or three sittings rather than one, because 104 systems
with citations is a lot of searching. In a plain chat you get one array per reply
and save it yourself.

The roster has 27 families and 104 systems. About eleven sittings covers it if the
small families are combined:

| Request | Groups to ask for | Systems |
| --- | --- | --- |
| 1 | `sam-launcher` (first 8) | 8 |
| 2 | `sam-launcher` (rest), `mobile-ad` | 9 |
| 3 | `fighter` | 12 |
| 4 | `strike`, `bomber` | 11 |
| 5 | `awacs`, `tanker`, `airlift`, `mpa` | 8 |
| 6 | `uav`, `attack-heli`, `transport-heli` | 6 |
| 7 | `destroyer`, `cruiser`, `frigate`, `corvette` | 11 |
| 8 | `carrier-ship`, `amphib-ship`, `logistics-ship` | 10 |
| 9 | `submarine`, `ssbn` | 8 |
| 10 | `missile`, `rocket`, `silo` | 11 |
| 11 | `radar`, `armour`, `artillery` | 10 |

The 16-strong SAM group is split because it is the heaviest: every entry has two
weapons and a full provenance block, and a response that runs out of room halfway
through a JSON array is worth nobody's time.

Then assemble and check:

```bash
# save each response as research/01-sam.json, research/02-sam.json, ...
node scripts/merge-systems.mjs                 # combines them, says what is missing
node scripts/validate-systems.mjs research/systems.merged.json
node scripts/merge-systems.mjs --write         # installs it as the library
```

`merge-systems` keeps the last definition of any id, so re-researching one family
is just dropping a newer file in. It also unwraps a response that arrived inside a
markdown fence, and reports how much of the roster is still outstanding.

The validator refuses anything the app cannot load: unknown ids, unknown unit
types, malformed facets, provenance pointing at fields that do not exist, and —
the one that matters most — a citation on a figure nobody publishes.

---

## The prompt

````
You are compiling a reference file of military system specifications for a
mapping/war games application. The figures will be used to draw coverage rings on a map and
to feed a transparent engagement model, so they must be traceable. A wrong number
that cites its source is recoverable. A confident number with no source is not.

## What I need

A JSON array of system objects, exactly matching the schema below, for the systems
in the roster at the end.

## How to deliver it

**If you can create files** — Cowork, Claude Code, anything with a filesystem —
then write the results as files, one per family, and treat the file as the
deliverable rather than pasting it into the conversation as well:

- Name them `NN-family.json`, numbered in the order you do them:
  `01-sam-launcher.json`, `02-sam-launcher.json`, `03-fighter.json`, and so on.
  The leading number matters — the files are merged in filename order.
- Each file contains **only** the JSON array for that family. No prose, no
  markdown fence, nothing but the array.
- After each file, tell me in the conversation: which ids went in, which figures
  you could not source, and which families are still outstanding. That summary is
  for me, not for the file.
- Work through every family in the roster unless I have named specific ones. Save
  each file as you finish it rather than holding them all to the end — if you run
  out of room, I want the eight families you did complete, not nothing.

**If you can only reply in chat**, return ONLY the JSON array for the family I
asked for — no commentary, no preamble, no markdown fence — and I will save it
myself.

## Sourcing rules — read these before anything else

0. **A system's principal armament and sensor are not optional.** Omitting a
   figure is fine. Omitting the *thing being described* is not: a destroyer with
   an empty `weapons` array has no reach on the map, which is worse than an
   uncertain range. So:
   - Anything that shoots gets `weapons[]`, with at least `id`, `name`,
     `rangeKm` and `engages` on each. Those four are published for essentially
     every system in this roster. `pk`, `reactionSec`, `salvo` and `magazine`
     may be placeholders — that is what placeholders are for.
   - Anything with a search radar or sonar gets `sensor.detectionKm`.
   - Anything that flies gets `platform.combatRadiusKm`.
   - Include the two or three weapons that define what the platform is *for* —
     a destroyer's area air-defence missile, its anti-ship missile, its
     land-attack missile — not its close-in guns, decoys or sidearms.
   If a figure for one of these genuinely cannot be found, include the field with
   your best estimate and mark it a placeholder. Do not drop the weapon.
1. **Never invent a citation.** If you cannot find a figure, omit the field. An
   absent field is fine; a fabricated source is not.
2. **Never invent a URL.** Every `source.url` must be a page you actually
   retrieved and read in this session.
3. **Some figures are not published by anyone.** Single-shot kill probability
   (`pk`), reaction time (`reactionSec`) and salvo size (`salvo`) are classified
   or simply unstated for almost every system. For these:
   - Give your best professional estimate.
   - Set `confidence: "low"` and `source.kind: "placeholder"`.
   - Put your reasoning in `source.note` (e.g. "no public figure; typical of
     modern semi-active seekers against non-manoeuvring targets").
   - Do NOT attach a URL to a placeholder. If a source genuinely does discuss it,
     cite it and raise the confidence accordingly.
4. **A range is meaningless without its conditions.** Radar detection ranges and
   missile ranges are quoted against a particular target — an RCS figure, an
   altitude, a non-manoeuvring profile. Record the stated conditions in
   `source.note` for that field. If a source gives 600 km against 4 m², say so.
   Prefer the figure with stated conditions over a larger unconditioned one.
5. **When sources disagree, say so.** Use the most commonly cited value, set
   `confidence: "medium"`, and record the spread in `source.note`
   (e.g. "reported 200–250 km depending on source").
6. **Prefer, in order:** the manufacturer or operating service's own published
   material; IISS Military Balance; CSIS Missile Threat; Janes; national navy or
   air force fact files; FAS; Naval Vessel Register. Treat enthusiast wikis as a
   lead to follow, not as a citation. Marketing claims are citable — label them:
   `source.kind: "manufacturer"` — because a manufacturer's maximum is a real
   published figure and also an optimistic one.
7. **Use the current in-service variant** named in the roster. Where the roster
   names a class, use the most numerous or most recent in-service member and say
   which one you used in the system's `note`.

## Schema

```ts
type TargetClass = 'air' | 'ballistic' | 'surface' | 'ground' | 'subsurface';

interface Source {
  kind: 'manufacturer' | 'government' | 'reference' | 'press' | 'placeholder';
  title: string;      // e.g. "IISS Military Balance 2024" or the page title
  url?: string;       // required unless kind is "placeholder"
  note?: string;      // conditions the figure assumes; disagreement between sources
}

interface System {
  id: string;         // EXACTLY as given in the roster — do not invent or rename
  name: string;       // as given in the roster, or corrected if the roster is wrong
  typeId: string;     // EXACTLY as given in the roster
  origin?: string;
  note?: string;      // variant used, service status, anything a reader needs

  sensor?: {
    detectionKm: number;      // against the conditions you record in provenance
    tracks?: number;          // targets held simultaneously
    engagements?: number;     // fire channels — simultaneous engagements
    sees?: TargetClass[];
    horizonLimited?: boolean; // true for surface-based radars, false for airborne
    antennaM?: number;        // antenna height, for the horizon calculation
  };

  weapons?: {
    // Lowercase slug of the name: "meteor", "aim-120c", "sm-6", "40n6".
    // THE SAME WEAPON MUST GET THE SAME id AND THE SAME FIGURES EVERYWHERE.
    // Meteor on a Rafale and Meteor on a Gripen are one munition, and these
    // entries are later merged into a single catalogue by that id.
    id: string;
    name: string;             // the munition, e.g. "40N6"
    rangeKm: number;
    minRangeKm?: number;
    massKg?: number;          // launch mass of one round — what it costs to carry
    salvo?: number;           // rounds committed per engagement
    magazine?: number;        // ready rounds: VLS cells, launcher rails, hardpoints
    pk?: number;              // single-shot kill probability, 0–1
    reactionSec?: number;     // detection to launch
    engages?: TargetClass[];
  }[];

  platform?: {
    // Combat radius is a profile, not a constant: the same aircraft flies much
    // further clean than it does under a heavy load. Record BOTH anchors where
    // sources give them, and say in the note which load each assumes.
    combatRadiusKm?: number;    // out and back with a typical load, unrefuelled
    radiusHeavyKm?: number;     // the same at or near maximum external load
    refuelledRadiusKm?: number;
    ferryRangeKm?: number;      // one way, clean
    speedKmh?: number;          // max, in km/h — convert knots and Mach
    payloadKg?: number;
    crew?: number;
    displacementT?: number;     // full load
    aircraft?: number;          // embarked air wing
    vls?: number;
    enduranceDays?: number;
  };

  signature?: 'low' | 'medium' | 'high';

  // Keyed by dotted path into this object. Every numeric field you fill in
  // SHOULD have an entry. Paths look like:
  //   "sensor.detectionKm", "weapons.0.rangeKm", "platform.vls"
  provenance: Record<string, {
    source: Source;
    confidence: 'high' | 'medium' | 'low';
  }>;
}
```

### Confidence

- `high` — published by the manufacturer or operating service, and not seriously
  disputed. Hull displacement, VLS cell count, crew, air wing size.
- `medium` — published but conditional or contested. Nearly every radar and
  missile range belongs here.
- `low` — an estimate, including everything you produced as a placeholder.

## Worked example

```json
[
  {
    "id": "example-sam",
    "name": "Example SAM system",
    "typeId": "sam-launcher",
    "origin": "Example",
    "note": "Figures are for the Mod 2 battery in service since 2015.",
    "sensor": {
      "detectionKm": 400,
      "tracks": 100,
      "engagements": 12,
      "sees": ["air", "ballistic"],
      "horizonLimited": true,
      "antennaM": 25
    },
    "weapons": [
      {
        "name": "Example missile",
        "rangeKm": 200,
        "magazine": 8,
        "salvo": 2,
        "pk": 0.7,
        "reactionSec": 10,
        "engages": ["air"]
      }
    ],
    "provenance": {
      "sensor.detectionKm": {
        "source": {
          "kind": "manufacturer",
          "title": "Example Corp product page",
          "url": "https://example.com/sam",
          "note": "Quoted against a 4 m² RCS target at high altitude; less against a fighter, and horizon-limited against anything low."
        },
        "confidence": "medium"
      },
      "weapons.0.rangeKm": {
        "source": {
          "kind": "reference",
          "title": "IISS Military Balance 2024",
          "url": "https://example.org/entry",
          "note": "Reported 180–200 km depending on source; 200 km is the manufacturer's figure."
        },
        "confidence": "medium"
      },
      "weapons.0.pk": {
        "source": {
          "kind": "placeholder",
          "title": "No public figure",
          "note": "Estimated from comparable active-radar-homing SAMs against non-manoeuvring targets. Not a published value."
        },
        "confidence": "low"
      }
    }
  }
]
```

## Rules that will get output rejected

- An `id` or `typeId` not in the roster.
- A `url` on a `placeholder` source.
- A `provenance` key pointing at a field the object does not have.
- `pk` outside 0–1, or any negative number.
- The same munition given different ids, or the same id given different figures,
  in two systems.
- Speeds in knots or Mach, ranges in miles — convert everything to km and km/h.
- Any prose inside a .json file. Progress notes belong in the conversation.

## Roster

Each bold heading is one family, and one file. If I have named specific families,
do those; otherwise work through all of them. Preserve every `id` and `typeId`
exactly. If a name is wrong or the system has been renamed, fix the name and
explain in the system's `note`.

If a batch is too long to finish in one response, stop at a complete system, close
the array, and say which ids you covered — a truncated JSON array is worthless,
whereas a short but valid one merges cleanly with the rest.

**airlift**
| `c-17a` | C-17A Globemaster III | United States |

**amphib-ship**
| `america-class` | America class | United States |
| `mistral` | Mistral class | France |

**armour**
| `m1a2-abrams` | M1A2 Abrams | United States |
| `t-90m` | T-90M | Russia |
| `leopard-2a7` | Leopard 2A7 | Germany |

**artillery**
| `m109a7` | M109A7 Paladin | United States |
| `caesar` | CAESAR 155 mm | France |

**attack-heli**
| `ah-64e` | AH-64E Apache | United States |
| `ka-52` | Ka-52 Alligator | Russia |

**awacs**
| `e-3g` | E-3G Sentry | United States |
| `a-50u` | A-50U Mainstay | Russia |
| `kj-500` | KJ-500 | China |
| `e-2d` | E-2D Advanced Hawkeye | United States |

**bomber**
| `b-2a` | B-2A Spirit | United States |
| `b-1b` | B-1B Lancer | United States |
| `b-52h` | B-52H Stratofortress | United States |
| `tu-160` | Tu-160 Blackjack | Russia |
| `tu-95ms` | Tu-95MS Bear | Russia |
| `h-6k` | H-6K | China |

**carrier-ship**
| `nimitz` | Nimitz class | United States |
| `gerald-ford` | Gerald R. Ford class | United States |
| `queen-elizabeth` | Queen Elizabeth class | United Kingdom |
| `liaoning` | Liaoning / Shandong | China |
| `fujian` | Fujian | China |
| `vikrant` | INS Vikrant | India |
| `charles-de-gaulle` | Charles de Gaulle | France |

**corvette**
| `visby` | Visby class | Sweden |

**cruiser**
| `ticonderoga` | Ticonderoga class | United States |
| `type-055` | Type 055 (Renhai) | China |
| `slava` | Slava class | Russia |

**destroyer**
| `arleigh-burke` | Arleigh Burke class (Flight IIA) | United States |
| `type-052d` | Type 052D (Luyang III) | China |
| `type-45` | Type 45 (Daring class) | United Kingdom |
| `kolkata` | Kolkata class | India |
| `maya` | Maya class | Japan |

**fighter**
| `f-35a` | F-35A Lightning II | United States |
| `f-22a` | F-22A Raptor | United States |
| `f-16c` | F-16C Fighting Falcon | United States |
| `su-35s` | Su-35S | Russia |
| `su-57` | Su-57 Felon | Russia |
| `mig-31bm` | MiG-31BM | Russia |
| `j-20` | J-20 Mighty Dragon | China |
| `rafale` | Rafale | France |
| `typhoon` | Eurofighter Typhoon | Europe |
| `gripen-e` | JAS 39E Gripen | Sweden |
| `su-30mki` | Su-30MKI | India / Russia |
| `tejas` | HAL Tejas Mk1A | India |

**frigate**
| `admiral-gorshkov` | Admiral Gorshkov class | Russia |
| `fremm` | FREMM class | France / Italy |

**logistics-ship**
| `supply-oiler` | Fleet replenishment oiler | — |

**missile**
| `iskander-m` | Iskander-M | Russia |
| `atacms` | ATACMS | United States |
| `df-21d` | DF-21D | China |
| `df-26` | DF-26 | China |
| `tomahawk-tel` | Typhon / Tomahawk (land) | United States |
| `bastion-p` | K-300P Bastion-P | Russia |
| `brahmos-land` | BrahMos (land) | India |

**mobile-ad**
| `kub-mobile` | Mobile SHORAD (generic) | — |

**mpa**
| `p-8a` | P-8A Poseidon | United States |

**radar**
| `nebo-m` | Nebo-M | Russia |
| `an-tpy-2` | AN/TPY-2 | United States |
| `jy-27a` | JY-27A | China |
| `ground-radar` | Air surveillance radar (generic) | — |
| `oth-radar` | Over-the-horizon radar | — |

**rocket**
| `himars` | M142 HIMARS | United States |
| `bm-30-smerch` | BM-30 Smerch | Russia |

**sam-launcher**
| `s-400` | S-400 Triumf | Russia |
| `s-300pmu2` | S-300PMU-2 Favorit | Russia |
| `s-350` | S-350 Vityaz | Russia |
| `pantsir-s1` | Pantsir-S1 | Russia |
| `buk-m3` | Buk-M3 | Russia |
| `tor-m2` | Tor-M2 | Russia |
| `patriot-pac3` | MIM-104 Patriot PAC-3 | United States |
| `thaad` | THAAD | United States |
| `nasams` | NASAMS | Norway / United States |
| `iris-t-slm` | IRIS-T SLM | Germany |
| `samp-t` | SAMP/T | France / Italy |
| `hq-9b` | HQ-9B | China |
| `hq-16` | HQ-16 | China |
| `barak-8` | Barak 8 (land) | Israel / India |
| `akash` | Akash | India |
| `iron-dome` | Iron Dome | Israel |

**silo**
| `minuteman-iii` | LGM-30G Minuteman III | United States |
| `rs-24-yars` | RS-24 Yars | Russia |

**ssbn**
| `ohio-ssbn` | Ohio class SSBN | United States |
| `borei` | Borei class SSBN | Russia |
| `arihant` | Arihant class SSBN | India |

**strike**
| `f-15e` | F-15E Strike Eagle | United States |
| `f-18ef` | F/A-18E/F Super Hornet | United States |
| `su-34` | Su-34 Fullback | Russia |
| `j-16` | J-16 | China |
| `a-10c` | A-10C Thunderbolt II | United States |

**submarine**
| `virginia` | Virginia class | United States |
| `astute` | Astute class | United Kingdom |
| `yasen-m` | Yasen-M class | Russia |
| `kilo` | Kilo class (Project 636) | Russia |
| `type-093` | Type 093 (Shang class) | China |

**tanker**
| `kc-46a` | KC-46A Pegasus | United States |
| `il-78` | Il-78 Midas | Russia |

**transport-heli**
| `ch-47f` | CH-47F Chinook | United States |

**uav**
| `mq-9` | MQ-9A Reaper | United States |
| `bayraktar-tb2` | Bayraktar TB2 | Türkiye |
| `shahed-136` | Shahed-136 | Iran |
````

---

## Feeding the result back in

Replace `public/data/systems.json` with the validated file. Ids are preserved, so
anything already deployed on a board keeps working and simply gains better
figures. Systems you authored in the app live separately in `data/systems.json`
and continue to override the library by id.

`scripts/generate-systems.mjs` remains the source of the *current* file. Once the
researched file lands, either retire that script or reduce it to the handful of
generic entries (`ground-radar`, `supply-oiler`, `kub-mobile`) that stand in for
"whatever the player means".
