/**
 * Builds public/data/systems.json — the shipped systems library.
 * Run with:  node scripts/generate-systems.mjs
 *
 * ON THE NUMBERS — READ THIS BEFORE TRUSTING ANY OF THEM.
 *
 * These figures were written from memory. Nothing here was looked up, and no
 * entry cites a source. They are placeholders: good enough to build features
 * against, not good enough to reason from.
 *
 * They fall into three honest tiers, which is what `confidence` records:
 *
 *   high    recalled, widely published, unlikely to be far wrong — hull
 *           displacement, VLS cell counts, crew, air wing size
 *   medium  recalled, but conditional or contested — every radar and missile
 *           range, none of which means anything without the target it assumes
 *   low     invented. Kill probability, reaction time and salvo size are not
 *           published by anyone; these exist so the engagement model has
 *           something to multiply, not because they are known
 *
 * The replacement path is `scripts/systems-research-prompt.md`, which produces a
 * file whose figures carry real citations. `scripts/validate-systems.mjs` checks
 * the result and will tell you how many figures actually have a source behind
 * them — which today is zero.
 *
 * Edit the tables below rather than the JSON they produce.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
mkdirSync(OUT, { recursive: true });

/* Source labels. Deliberately worded so a tooltip in the app cannot be mistaken
   for a citation — because none of these are one. */
const PUB = 'recalled — widely published, not verified here';
const VAR = 'recalled — sources vary, not verified here';
const EST = 'model placeholder — no published figure exists';

/**
 * Builds provenance for a system from three lists of field paths, so the tables
 * below stay about the systems rather than about bookkeeping.
 */
const prov = ({ high = [], medium = [], low = [] }) => {
  const out = {};
  for (const path of high) out[path] = { source: PUB, confidence: 'high' };
  for (const path of medium) out[path] = { source: VAR, confidence: 'medium' };
  for (const path of low) out[path] = { source: EST, confidence: 'low' };
  return out;
};

/** Every weapon figure that is an engagement-model input rather than a fact. */
const weaponProv = (index, { rangeConfidence = 'medium' } = {}) => ({
  [`weapons.${index}.rangeKm`]: {
    source: rangeConfidence === 'high' ? PUB : VAR,
    confidence: rangeConfidence,
  },
  [`weapons.${index}.pk`]: { source: EST, confidence: 'low' },
  [`weapons.${index}.reactionSec`]: { source: EST, confidence: 'low' },
  [`weapons.${index}.magazine`]: { source: VAR, confidence: 'medium' },
  [`weapons.${index}.salvo`]: { source: EST, confidence: 'low' },
});

/** Resolves 'weapons.0.rangeKm' against a spec. */
const resolvePath = (spec, path) => {
  let node = spec;
  for (const step of path.split('.')) {
    if (node === null || node === undefined) return undefined;
    node = Array.isArray(node) ? node[Number(step)] : node[step];
  }
  return node;
};

const systems = [];
const add = (spec) => {
  // The builders below attach provenance for every field their family *might*
  // have; a carrier has no VLS and an oiler has no radar. A key pointing at an
  // absent field is dead weight that would survive into the researched file, so
  // it is dropped here rather than tolerated.
  if (spec.provenance) {
    for (const path of Object.keys(spec.provenance)) {
      if (resolvePath(spec, path) === undefined) delete spec.provenance[path];
    }
  }
  systems.push(spec);
  return spec;
};

/* ------------------------------------------------------------------ */
/* Ground-based air defence                                            */
/* ------------------------------------------------------------------ */

const sam = ({ id, name, origin, typeId = 'sam-launcher', detection, tracks, channels, weapons, note }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    sensor: {
      detectionKm: detection,
      tracks,
      engagements: channels,
      sees: ['air', 'ballistic'],
      horizonLimited: true,
      antennaM: 25,
    },
    weapons,
    provenance: {
      ...prov({ medium: ['sensor.detectionKm', 'sensor.tracks'], low: ['sensor.engagements'] }),
      ...weapons.reduce((acc, _, i) => ({ ...acc, ...weaponProv(i) }), {}),
    },
  });

sam({
  id: 's-400',
  name: 'S-400 Triumf',
  origin: 'Russia',
  detection: 600,
  tracks: 80,
  channels: 36,
  weapons: [
    { name: '40N6', rangeKm: 380, magazine: 8, salvo: 2, pk: 0.7, reactionSec: 10, engages: ['air', 'ballistic'] },
    { name: '48N6DM', rangeKm: 250, magazine: 8, salvo: 2, pk: 0.75, reactionSec: 10, engages: ['air'] },
  ],
  note: 'Battalion of launchers with a 91N6E acquisition radar.',
});

sam({
  id: 's-300pmu2',
  name: 'S-300PMU-2 Favorit',
  origin: 'Russia',
  detection: 300,
  tracks: 36,
  channels: 12,
  weapons: [{ name: '48N6E2', rangeKm: 200, magazine: 8, salvo: 2, pk: 0.7, reactionSec: 12, engages: ['air', 'ballistic'] }],
});

sam({
  id: 's-350',
  name: 'S-350 Vityaz',
  origin: 'Russia',
  detection: 250,
  tracks: 40,
  channels: 16,
  weapons: [{ name: '9M96E2', rangeKm: 120, magazine: 12, salvo: 2, pk: 0.75, reactionSec: 8, engages: ['air'] }],
});

sam({
  id: 'pantsir-s1',
  name: 'Pantsir-S1',
  origin: 'Russia',
  detection: 36,
  tracks: 20,
  channels: 4,
  weapons: [
    { name: '57E6', rangeKm: 20, magazine: 12, salvo: 2, pk: 0.7, reactionSec: 5, engages: ['air'] },
    { name: '2A38M 30 mm', rangeKm: 4, magazine: 1400, salvo: 50, pk: 0.3, reactionSec: 3, engages: ['air'] },
  ],
  note: 'Point defence, usually protecting a longer-ranged battery.',
});

sam({
  id: 'buk-m3',
  name: 'Buk-M3',
  origin: 'Russia',
  detection: 160,
  tracks: 36,
  channels: 6,
  weapons: [{ name: '9M317M', rangeKm: 70, magazine: 6, salvo: 2, pk: 0.75, reactionSec: 10, engages: ['air'] }],
});

sam({
  id: 'tor-m2',
  name: 'Tor-M2',
  origin: 'Russia',
  detection: 32,
  tracks: 48,
  channels: 4,
  weapons: [{ name: '9M338K', rangeKm: 16, magazine: 16, salvo: 2, pk: 0.7, reactionSec: 5, engages: ['air'] }],
});

sam({
  id: 'patriot-pac3',
  name: 'MIM-104 Patriot PAC-3',
  origin: 'United States',
  detection: 170,
  tracks: 100,
  channels: 9,
  weapons: [
    { name: 'PAC-3 MSE', rangeKm: 120, magazine: 12, salvo: 2, pk: 0.8, reactionSec: 10, engages: ['air', 'ballistic'] },
    { name: 'PAC-2 GEM-T', rangeKm: 160, magazine: 16, salvo: 2, pk: 0.7, reactionSec: 10, engages: ['air'] },
  ],
});

sam({
  id: 'thaad',
  name: 'THAAD',
  origin: 'United States',
  detection: 870,
  tracks: 60,
  channels: 6,
  weapons: [{ name: 'THAAD interceptor', rangeKm: 200, magazine: 8, salvo: 2, pk: 0.8, reactionSec: 15, engages: ['ballistic'] }],
  note: 'AN/TPY-2 radar; exo-atmospheric intercept, no aircraft engagement.',
});

sam({
  id: 'nasams',
  name: 'NASAMS',
  origin: 'Norway / United States',
  detection: 120,
  tracks: 60,
  channels: 6,
  weapons: [{ name: 'AMRAAM-ER', rangeKm: 50, magazine: 6, salvo: 2, pk: 0.7, reactionSec: 8, engages: ['air'] }],
});

sam({
  id: 'iris-t-slm',
  name: 'IRIS-T SLM',
  origin: 'Germany',
  detection: 250,
  tracks: 50,
  channels: 8,
  weapons: [{ name: 'IRIS-T SLM', rangeKm: 40, magazine: 8, salvo: 2, pk: 0.75, reactionSec: 6, engages: ['air'] }],
});

sam({
  id: 'samp-t',
  name: 'SAMP/T',
  origin: 'France / Italy',
  detection: 350,
  tracks: 100,
  channels: 10,
  weapons: [{ name: 'Aster 30', rangeKm: 120, magazine: 8, salvo: 2, pk: 0.75, reactionSec: 10, engages: ['air', 'ballistic'] }],
});

sam({
  id: 'hq-9b',
  name: 'HQ-9B',
  origin: 'China',
  detection: 300,
  tracks: 100,
  channels: 12,
  weapons: [{ name: 'HQ-9B', rangeKm: 250, magazine: 8, salvo: 2, pk: 0.7, reactionSec: 12, engages: ['air', 'ballistic'] }],
});

sam({
  id: 'hq-16',
  name: 'HQ-16',
  origin: 'China',
  detection: 140,
  tracks: 40,
  channels: 6,
  weapons: [{ name: 'HQ-16', rangeKm: 40, magazine: 6, salvo: 2, pk: 0.7, reactionSec: 8, engages: ['air'] }],
});

sam({
  id: 'barak-8',
  name: 'Barak 8 (land)',
  origin: 'Israel / India',
  detection: 250,
  tracks: 60,
  channels: 8,
  weapons: [{ name: 'Barak 8', rangeKm: 100, magazine: 8, salvo: 2, pk: 0.75, reactionSec: 8, engages: ['air'] }],
});

sam({
  id: 'akash',
  name: 'Akash',
  origin: 'India',
  detection: 150,
  tracks: 64,
  channels: 4,
  weapons: [{ name: 'Akash', rangeKm: 30, magazine: 3, salvo: 2, pk: 0.7, reactionSec: 10, engages: ['air'] }],
});

sam({
  id: 'iron-dome',
  name: 'Iron Dome',
  origin: 'Israel',
  detection: 70,
  tracks: 200,
  channels: 20,
  weapons: [{ name: 'Tamir', rangeKm: 70, magazine: 20, salvo: 2, pk: 0.85, reactionSec: 4, engages: ['ballistic'] }],
  note: 'Against rockets and artillery, not aircraft.',
});

sam({
  id: 'kub-mobile',
  name: 'Mobile SHORAD (generic)',
  origin: '—',
  typeId: 'mobile-ad',
  detection: 30,
  tracks: 20,
  channels: 2,
  weapons: [{ name: 'Short-range SAM', rangeKm: 12, magazine: 8, salvo: 1, pk: 0.6, reactionSec: 5, engages: ['air'] }],
  note: 'A stand-in for whatever short-range system a formation actually carries.',
});

/* ------------------------------------------------------------------ */
/* Radars and early warning                                            */
/* ------------------------------------------------------------------ */

const radar = ({ id, name, origin, detection, tracks, note, typeId = 'radar', antennaM = 30 }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    sensor: { detectionKm: detection, tracks, sees: ['air', 'ballistic'], horizonLimited: true, antennaM },
    provenance: prov({ medium: ['sensor.detectionKm', 'sensor.tracks'] }),
  });

radar({ id: 'nebo-m', name: 'Nebo-M', origin: 'Russia', detection: 600, tracks: 200 });
radar({ id: 'an-tpy-2', name: 'AN/TPY-2', origin: 'United States', detection: 1000, tracks: 100, note: 'X-band, ballistic missile defence.' });
radar({ id: 'jy-27a', name: 'JY-27A', origin: 'China', detection: 500, tracks: 100, note: 'VHF, marketed against low-observable aircraft.' });
radar({ id: 'ground-radar', name: 'Air surveillance radar (generic)', origin: '—', detection: 300, tracks: 100 });
radar({
  id: 'oth-radar',
  name: 'Over-the-horizon radar',
  origin: '—',
  detection: 3000,
  tracks: 300,
  note: 'Sees past the horizon by bouncing off the ionosphere; poor accuracy, enormous reach.',
  antennaM: 40,
});

/* ------------------------------------------------------------------ */
/* Fighters and strike aircraft                                        */
/* ------------------------------------------------------------------ */

const aircraft = ({ id, name, origin, typeId, radius, refuelled, speed, payload, signature, weapons = [], sensor, note }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    signature,
    sensor,
    weapons,
    platform: { combatRadiusKm: radius, refuelledRadiusKm: refuelled, speedKmh: speed, payloadKg: payload, crew: 1 },
    provenance: {
      ...prov({
        medium: ['platform.combatRadiusKm', 'platform.refuelledRadiusKm', 'platform.payloadKg'],
        high: ['platform.speedKmh'],
      }),
      ...weapons.reduce((acc, _, i) => ({ ...acc, ...weaponProv(i) }), {}),
      ...(sensor ? prov({ medium: ['sensor.detectionKm'] }) : {}),
    },
  });

const aam = (name, rangeKm, magazine = 4) => ({
  name,
  rangeKm,
  magazine,
  salvo: 2,
  pk: 0.5,
  reactionSec: 20,
  engages: ['air'],
});

aircraft({
  id: 'f-35a',
  name: 'F-35A Lightning II',
  origin: 'United States',
  typeId: 'fighter',
  radius: 1100,
  refuelled: 1900,
  speed: 1930,
  payload: 8100,
  signature: 'low',
  sensor: { detectionKm: 150, tracks: 20, sees: ['air', 'ground'] },
  weapons: [aam('AIM-120D', 160)],
});
aircraft({
  id: 'f-22a',
  name: 'F-22A Raptor',
  origin: 'United States',
  typeId: 'fighter',
  radius: 850,
  refuelled: 1600,
  speed: 2410,
  payload: 4500,
  signature: 'low',
  sensor: { detectionKm: 200, tracks: 20, sees: ['air'] },
  weapons: [aam('AIM-120D', 160, 6)],
});
aircraft({
  id: 'f-16c',
  name: 'F-16C Fighting Falcon',
  origin: 'United States',
  typeId: 'fighter',
  radius: 550,
  refuelled: 1200,
  speed: 2120,
  payload: 7700,
  signature: 'medium',
  sensor: { detectionKm: 120, tracks: 10, sees: ['air', 'ground'] },
  weapons: [aam('AIM-120C', 105)],
});
aircraft({
  id: 'f-15e',
  name: 'F-15E Strike Eagle',
  origin: 'United States',
  typeId: 'strike',
  radius: 1270,
  refuelled: 2200,
  speed: 2650,
  payload: 11000,
  signature: 'high',
  weapons: [aam('AIM-120C', 105)],
});
aircraft({
  id: 'f-18ef',
  name: 'F/A-18E/F Super Hornet',
  origin: 'United States',
  typeId: 'strike',
  radius: 720,
  refuelled: 1400,
  speed: 1915,
  payload: 8050,
  signature: 'medium',
  weapons: [aam('AIM-120C', 105)],
  note: 'Carrier-borne.',
});
aircraft({
  id: 'su-35s',
  name: 'Su-35S',
  origin: 'Russia',
  typeId: 'fighter',
  radius: 1600,
  refuelled: 2400,
  speed: 2400,
  payload: 8000,
  signature: 'high',
  sensor: { detectionKm: 350, tracks: 30, sees: ['air'] },
  weapons: [aam('R-77-1', 110), { name: 'R-37M', rangeKm: 300, magazine: 2, salvo: 1, pk: 0.5, reactionSec: 25, engages: ['air'] }],
});
aircraft({
  id: 'su-57',
  name: 'Su-57 Felon',
  origin: 'Russia',
  typeId: 'fighter',
  radius: 1500,
  refuelled: 2300,
  speed: 2135,
  payload: 10000,
  signature: 'low',
  weapons: [aam('R-77M', 190)],
});
aircraft({
  id: 'su-34',
  name: 'Su-34 Fullback',
  origin: 'Russia',
  typeId: 'strike',
  radius: 1100,
  refuelled: 1900,
  speed: 1900,
  payload: 12000,
  signature: 'high',
});
aircraft({
  id: 'mig-31bm',
  name: 'MiG-31BM',
  origin: 'Russia',
  typeId: 'fighter',
  radius: 1450,
  refuelled: 2200,
  speed: 3000,
  payload: 9000,
  signature: 'high',
  sensor: { detectionKm: 320, tracks: 24, sees: ['air'] },
  weapons: [{ name: 'R-37M', rangeKm: 300, magazine: 4, salvo: 1, pk: 0.5, reactionSec: 25, engages: ['air'] }],
});
aircraft({
  id: 'j-20',
  name: 'J-20 Mighty Dragon',
  origin: 'China',
  typeId: 'fighter',
  radius: 1100,
  refuelled: 2000,
  speed: 2100,
  payload: 11000,
  signature: 'low',
  weapons: [{ name: 'PL-15', rangeKm: 200, magazine: 4, salvo: 2, pk: 0.55, reactionSec: 20, engages: ['air'] }],
});
aircraft({
  id: 'j-16',
  name: 'J-16',
  origin: 'China',
  typeId: 'strike',
  radius: 1500,
  refuelled: 2300,
  speed: 2100,
  payload: 12000,
  signature: 'high',
  weapons: [{ name: 'PL-15', rangeKm: 200, magazine: 4, salvo: 2, pk: 0.55, reactionSec: 20, engages: ['air'] }],
});
aircraft({
  id: 'rafale',
  name: 'Rafale',
  origin: 'France',
  typeId: 'fighter',
  radius: 1850,
  refuelled: 2600,
  speed: 1912,
  payload: 9500,
  signature: 'medium',
  weapons: [{ name: 'Meteor', rangeKm: 200, magazine: 4, salvo: 2, pk: 0.6, reactionSec: 20, engages: ['air'] }],
});
aircraft({
  id: 'typhoon',
  name: 'Eurofighter Typhoon',
  origin: 'Europe',
  typeId: 'fighter',
  radius: 1390,
  refuelled: 2300,
  speed: 2495,
  payload: 9000,
  signature: 'medium',
  weapons: [{ name: 'Meteor', rangeKm: 200, magazine: 4, salvo: 2, pk: 0.6, reactionSec: 20, engages: ['air'] }],
});
aircraft({
  id: 'gripen-e',
  name: 'JAS 39E Gripen',
  origin: 'Sweden',
  typeId: 'fighter',
  radius: 1500,
  refuelled: 2200,
  speed: 2200,
  payload: 6000,
  signature: 'medium',
  weapons: [{ name: 'Meteor', rangeKm: 200, magazine: 4, salvo: 2, pk: 0.6, reactionSec: 20, engages: ['air'] }],
});
aircraft({
  id: 'su-30mki',
  name: 'Su-30MKI',
  origin: 'India / Russia',
  typeId: 'fighter',
  radius: 1500,
  refuelled: 2400,
  speed: 2120,
  payload: 8000,
  signature: 'high',
  weapons: [aam('R-77', 110)],
});
aircraft({
  id: 'tejas',
  name: 'HAL Tejas Mk1A',
  origin: 'India',
  typeId: 'fighter',
  radius: 500,
  refuelled: 1000,
  speed: 2200,
  payload: 3500,
  signature: 'medium',
});
aircraft({
  id: 'a-10c',
  name: 'A-10C Thunderbolt II',
  origin: 'United States',
  typeId: 'strike',
  radius: 460,
  speed: 700,
  payload: 7260,
  signature: 'high',
  note: 'Close air support; short reach, long loiter.',
});

/* ---- bombers ---- */

add({
  id: 'b-2a',
  name: 'B-2A Spirit',
  typeId: 'bomber',
  origin: 'United States',
  signature: 'low',
  platform: { combatRadiusKm: 5500, refuelledRadiusKm: 9000, speedKmh: 1010, payloadKg: 18000, crew: 2 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.refuelledRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'b-1b',
  name: 'B-1B Lancer',
  typeId: 'bomber',
  origin: 'United States',
  signature: 'medium',
  platform: { combatRadiusKm: 5500, refuelledRadiusKm: 9000, speedKmh: 1330, payloadKg: 34000, crew: 4 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'b-52h',
  name: 'B-52H Stratofortress',
  typeId: 'bomber',
  origin: 'United States',
  signature: 'high',
  platform: { combatRadiusKm: 7200, refuelledRadiusKm: 12000, speedKmh: 1000, payloadKg: 31500, crew: 5 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'tu-160',
  name: 'Tu-160 Blackjack',
  typeId: 'bomber',
  origin: 'Russia',
  signature: 'high',
  platform: { combatRadiusKm: 7300, refuelledRadiusKm: 11000, speedKmh: 2220, payloadKg: 40000, crew: 4 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'tu-95ms',
  name: 'Tu-95MS Bear',
  typeId: 'bomber',
  origin: 'Russia',
  signature: 'high',
  platform: { combatRadiusKm: 6400, refuelledRadiusKm: 9000, speedKmh: 830, payloadKg: 15000, crew: 7 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'h-6k',
  name: 'H-6K',
  typeId: 'bomber',
  origin: 'China',
  signature: 'high',
  platform: { combatRadiusKm: 3500, speedKmh: 1050, payloadKg: 12000, crew: 4 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});

/* ---- support aircraft ---- */

add({
  id: 'e-3g',
  name: 'E-3G Sentry',
  typeId: 'awacs',
  origin: 'United States',
  sensor: { detectionKm: 400, tracks: 600, sees: ['air', 'surface'] },
  platform: { combatRadiusKm: 1600, speedKmh: 850, crew: 20, enduranceDays: 0 },
  provenance: prov({ medium: ['sensor.detectionKm', 'sensor.tracks', 'platform.combatRadiusKm'] }),
});
add({
  id: 'a-50u',
  name: 'A-50U Mainstay',
  typeId: 'awacs',
  origin: 'Russia',
  sensor: { detectionKm: 400, tracks: 300, sees: ['air', 'surface'] },
  platform: { combatRadiusKm: 1400, speedKmh: 800, crew: 15 },
  provenance: prov({ medium: ['sensor.detectionKm', 'platform.combatRadiusKm'] }),
});
add({
  id: 'kj-500',
  name: 'KJ-500',
  typeId: 'awacs',
  origin: 'China',
  sensor: { detectionKm: 470, tracks: 100, sees: ['air', 'surface'] },
  platform: { combatRadiusKm: 1500, speedKmh: 550, crew: 10 },
  provenance: prov({ medium: ['sensor.detectionKm', 'platform.combatRadiusKm'] }),
});
add({
  id: 'e-2d',
  name: 'E-2D Advanced Hawkeye',
  typeId: 'awacs',
  origin: 'United States',
  sensor: { detectionKm: 550, tracks: 300, sees: ['air', 'surface'] },
  platform: { combatRadiusKm: 320, speedKmh: 640, crew: 5 },
  provenance: prov({ medium: ['sensor.detectionKm', 'platform.combatRadiusKm'] }),
  note: 'Carrier-borne.',
});
add({
  id: 'kc-46a',
  name: 'KC-46A Pegasus',
  typeId: 'tanker',
  origin: 'United States',
  platform: { combatRadiusKm: 6500, speedKmh: 915, payloadKg: 96000, crew: 3 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
  note: 'Payload is transferable fuel.',
});
add({
  id: 'il-78',
  name: 'Il-78 Midas',
  typeId: 'tanker',
  origin: 'Russia',
  platform: { combatRadiusKm: 3500, speedKmh: 830, payloadKg: 85000, crew: 6 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'platform.payloadKg'] }),
});
add({
  id: 'c-17a',
  name: 'C-17A Globemaster III',
  typeId: 'airlift',
  origin: 'United States',
  platform: { combatRadiusKm: 4480, speedKmh: 830, payloadKg: 77500, crew: 3 },
  provenance: prov({ high: ['platform.payloadKg'], medium: ['platform.combatRadiusKm'] }),
});
add({
  id: 'p-8a',
  name: 'P-8A Poseidon',
  typeId: 'mpa',
  origin: 'United States',
  sensor: { detectionKm: 320, tracks: 100, sees: ['surface', 'subsurface'] },
  platform: { combatRadiusKm: 2200, speedKmh: 900, crew: 9 },
  provenance: prov({ medium: ['sensor.detectionKm', 'platform.combatRadiusKm'] }),
});
add({
  id: 'mq-9',
  name: 'MQ-9A Reaper',
  typeId: 'uav',
  origin: 'United States',
  signature: 'medium',
  sensor: { detectionKm: 60, tracks: 4, sees: ['ground', 'surface'] },
  platform: { combatRadiusKm: 1850, speedKmh: 300, payloadKg: 1700 },
  provenance: prov({ medium: ['platform.combatRadiusKm', 'sensor.detectionKm'] }),
});
add({
  id: 'bayraktar-tb2',
  name: 'Bayraktar TB2',
  typeId: 'uav',
  origin: 'Türkiye',
  signature: 'medium',
  platform: { combatRadiusKm: 150, speedKmh: 220, payloadKg: 150 },
  provenance: prov({ medium: ['platform.combatRadiusKm'] }),
  note: 'Radius is line-of-sight control; far greater with a satellite link.',
});
add({
  id: 'shahed-136',
  name: 'Shahed-136',
  typeId: 'uav',
  origin: 'Iran',
  signature: 'low',
  platform: { combatRadiusKm: 2000, speedKmh: 185, payloadKg: 50 },
  provenance: prov({ medium: ['platform.combatRadiusKm'], low: ['platform.payloadKg'] }),
  note: 'One-way attack drone; the radius is one-way.',
});
add({
  id: 'ah-64e',
  name: 'AH-64E Apache',
  typeId: 'attack-heli',
  origin: 'United States',
  platform: { combatRadiusKm: 480, speedKmh: 300, payloadKg: 3000, crew: 2 },
  weapons: [{ name: 'AGM-114 Hellfire', rangeKm: 11, magazine: 16, salvo: 1, pk: 0.8, reactionSec: 15, engages: ['ground'] }],
  provenance: { ...prov({ medium: ['platform.combatRadiusKm'] }), ...weaponProv(0) },
});
add({
  id: 'ka-52',
  name: 'Ka-52 Alligator',
  typeId: 'attack-heli',
  origin: 'Russia',
  platform: { combatRadiusKm: 460, speedKmh: 300, payloadKg: 2000, crew: 2 },
  provenance: prov({ medium: ['platform.combatRadiusKm'] }),
});
add({
  id: 'ch-47f',
  name: 'CH-47F Chinook',
  typeId: 'transport-heli',
  origin: 'United States',
  platform: { combatRadiusKm: 370, speedKmh: 300, payloadKg: 10800, crew: 3 },
  provenance: prov({ medium: ['platform.combatRadiusKm'], high: ['platform.payloadKg'] }),
});

/* ------------------------------------------------------------------ */
/* Surface combatants                                                  */
/* ------------------------------------------------------------------ */

const ship = ({ id, name, origin, typeId, displacement, crew, vls, aircraft: air, detection, weapons = [], speed = 55, note }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    sensor: detection
      ? { detectionKm: detection, tracks: 200, sees: ['air', 'surface'], horizonLimited: true, antennaM: 30 }
      : undefined,
    weapons,
    platform: { displacementT: displacement, crew, vls, aircraft: air, speedKmh: speed, enduranceDays: 45 },
    provenance: {
      ...prov({
        high: ['platform.displacementT', 'platform.vls', 'platform.aircraft'],
        medium: ['platform.crew', 'sensor.detectionKm', 'platform.enduranceDays'],
      }),
      ...weapons.reduce((acc, _, i) => ({ ...acc, ...weaponProv(i) }), {}),
    },
  });

ship({
  id: 'arleigh-burke',
  name: 'Arleigh Burke class (Flight IIA)',
  origin: 'United States',
  typeId: 'destroyer',
  displacement: 9200,
  crew: 330,
  vls: 96,
  detection: 320,
  weapons: [
    { name: 'SM-6', rangeKm: 240, magazine: 32, salvo: 2, pk: 0.75, reactionSec: 15, engages: ['air', 'ballistic'] },
    { name: 'SM-2MR', rangeKm: 170, magazine: 32, salvo: 2, pk: 0.7, reactionSec: 15, engages: ['air'] },
    { name: 'Tomahawk', rangeKm: 1600, magazine: 24, salvo: 4, pk: 0.8, reactionSec: 300, engages: ['ground'] },
  ],
});
ship({
  id: 'ticonderoga',
  name: 'Ticonderoga class',
  origin: 'United States',
  typeId: 'cruiser',
  displacement: 9800,
  crew: 330,
  vls: 122,
  detection: 320,
  weapons: [{ name: 'SM-6', rangeKm: 240, magazine: 40, salvo: 2, pk: 0.75, reactionSec: 15, engages: ['air', 'ballistic'] }],
});
ship({
  id: 'type-055',
  name: 'Type 055 (Renhai)',
  origin: 'China',
  typeId: 'cruiser',
  displacement: 12000,
  crew: 300,
  vls: 112,
  detection: 300,
  weapons: [
    { name: 'HHQ-9B', rangeKm: 200, magazine: 48, salvo: 2, pk: 0.7, reactionSec: 15, engages: ['air'] },
    { name: 'YJ-18', rangeKm: 540, magazine: 16, salvo: 4, pk: 0.7, reactionSec: 120, engages: ['surface'] },
  ],
});
ship({
  id: 'type-052d',
  name: 'Type 052D (Luyang III)',
  origin: 'China',
  typeId: 'destroyer',
  displacement: 7500,
  crew: 280,
  vls: 64,
  detection: 250,
  weapons: [{ name: 'HHQ-9', rangeKm: 200, magazine: 32, salvo: 2, pk: 0.7, reactionSec: 15, engages: ['air'] }],
});
ship({
  id: 'admiral-gorshkov',
  name: 'Admiral Gorshkov class',
  origin: 'Russia',
  typeId: 'frigate',
  displacement: 5400,
  crew: 210,
  vls: 32,
  detection: 250,
  weapons: [
    { name: 'Redut 9M96', rangeKm: 150, magazine: 32, salvo: 2, pk: 0.7, reactionSec: 12, engages: ['air'] },
    { name: 'Kalibr', rangeKm: 1500, magazine: 16, salvo: 4, pk: 0.75, reactionSec: 300, engages: ['ground'] },
  ],
});
ship({
  id: 'slava',
  name: 'Slava class',
  origin: 'Russia',
  typeId: 'cruiser',
  displacement: 11500,
  crew: 480,
  vls: 64,
  detection: 300,
  weapons: [{ name: 'S-300F Fort', rangeKm: 90, magazine: 64, salvo: 2, pk: 0.65, reactionSec: 20, engages: ['air'] }],
});
ship({
  id: 'type-45',
  name: 'Type 45 (Daring class)',
  origin: 'United Kingdom',
  typeId: 'destroyer',
  displacement: 8500,
  crew: 190,
  vls: 48,
  detection: 400,
  weapons: [{ name: 'Aster 30', rangeKm: 120, magazine: 32, salvo: 2, pk: 0.75, reactionSec: 12, engages: ['air'] }],
});
ship({
  id: 'fremm',
  name: 'FREMM class',
  origin: 'France / Italy',
  typeId: 'frigate',
  displacement: 6000,
  crew: 145,
  vls: 32,
  detection: 250,
  weapons: [{ name: 'Aster 15', rangeKm: 30, magazine: 16, salvo: 2, pk: 0.75, reactionSec: 10, engages: ['air'] }],
});
ship({
  id: 'kolkata',
  name: 'Kolkata class',
  origin: 'India',
  typeId: 'destroyer',
  displacement: 7400,
  crew: 330,
  vls: 48,
  detection: 250,
  weapons: [
    { name: 'Barak 8', rangeKm: 100, magazine: 32, salvo: 2, pk: 0.75, reactionSec: 12, engages: ['air'] },
    { name: 'BrahMos', rangeKm: 450, magazine: 16, salvo: 4, pk: 0.8, reactionSec: 120, engages: ['surface'] },
  ],
});
ship({
  id: 'maya',
  name: 'Maya class',
  origin: 'Japan',
  typeId: 'destroyer',
  displacement: 10250,
  crew: 300,
  vls: 96,
  detection: 320,
  weapons: [{ name: 'SM-6', rangeKm: 240, magazine: 32, salvo: 2, pk: 0.75, reactionSec: 15, engages: ['air', 'ballistic'] }],
});
ship({
  id: 'visby',
  name: 'Visby class',
  origin: 'Sweden',
  typeId: 'corvette',
  displacement: 640,
  crew: 43,
  detection: 100,
  speed: 65,
  note: 'Low-signature hull.',
});

/* ---- carriers and amphibious ---- */

ship({
  id: 'nimitz',
  name: 'Nimitz class',
  origin: 'United States',
  typeId: 'carrier-ship',
  displacement: 100000,
  crew: 5000,
  aircraft: 75,
  detection: 300,
  speed: 56,
});
ship({
  id: 'gerald-ford',
  name: 'Gerald R. Ford class',
  origin: 'United States',
  typeId: 'carrier-ship',
  displacement: 100000,
  crew: 4500,
  aircraft: 75,
  detection: 350,
  speed: 56,
});
ship({
  id: 'queen-elizabeth',
  name: 'Queen Elizabeth class',
  origin: 'United Kingdom',
  typeId: 'carrier-ship',
  displacement: 65000,
  crew: 1600,
  aircraft: 40,
  detection: 300,
});
ship({
  id: 'liaoning',
  name: 'Liaoning / Shandong',
  origin: 'China',
  typeId: 'carrier-ship',
  displacement: 60000,
  crew: 2600,
  aircraft: 36,
  detection: 250,
});
ship({
  id: 'fujian',
  name: 'Fujian',
  origin: 'China',
  typeId: 'carrier-ship',
  displacement: 80000,
  crew: 3000,
  aircraft: 50,
  detection: 300,
});
ship({
  id: 'vikrant',
  name: 'INS Vikrant',
  origin: 'India',
  typeId: 'carrier-ship',
  displacement: 45000,
  crew: 1600,
  aircraft: 30,
  detection: 250,
});
ship({
  id: 'charles-de-gaulle',
  name: 'Charles de Gaulle',
  origin: 'France',
  typeId: 'carrier-ship',
  displacement: 42500,
  crew: 1900,
  aircraft: 30,
  detection: 250,
});
ship({
  id: 'america-class',
  name: 'America class',
  origin: 'United States',
  typeId: 'amphib-ship',
  displacement: 45000,
  crew: 1200,
  aircraft: 20,
  detection: 200,
});
ship({
  id: 'mistral',
  name: 'Mistral class',
  origin: 'France',
  typeId: 'amphib-ship',
  displacement: 21500,
  crew: 180,
  aircraft: 16,
  detection: 150,
});
ship({
  id: 'supply-oiler',
  name: 'Fleet replenishment oiler',
  origin: '—',
  typeId: 'logistics-ship',
  displacement: 40000,
  crew: 90,
  speed: 37,
});

/* ------------------------------------------------------------------ */
/* Submarines                                                          */
/* ------------------------------------------------------------------ */

const sub = ({ id, name, origin, typeId, displacement, crew, weapons = [], detection, note, endurance = 90 }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    signature: 'low',
    sensor: detection ? { detectionKm: detection, tracks: 20, sees: ['surface', 'subsurface'] } : undefined,
    weapons,
    platform: { displacementT: displacement, crew, speedKmh: 60, enduranceDays: endurance },
    provenance: {
      ...prov({ high: ['platform.displacementT'], medium: ['platform.crew', 'platform.enduranceDays', 'sensor.detectionKm'] }),
      ...weapons.reduce((acc, _, i) => ({ ...acc, ...weaponProv(i) }), {}),
    },
  });

sub({
  id: 'virginia',
  name: 'Virginia class',
  origin: 'United States',
  typeId: 'submarine',
  displacement: 7900,
  crew: 135,
  detection: 100,
  weapons: [
    { name: 'Mk 48 torpedo', rangeKm: 50, magazine: 25, salvo: 2, pk: 0.7, reactionSec: 120, engages: ['surface', 'subsurface'] },
    { name: 'Tomahawk', rangeKm: 1600, magazine: 12, salvo: 4, pk: 0.8, reactionSec: 300, engages: ['ground'] },
  ],
});
sub({
  id: 'astute',
  name: 'Astute class',
  origin: 'United Kingdom',
  typeId: 'submarine',
  displacement: 7400,
  crew: 98,
  detection: 100,
  weapons: [{ name: 'Spearfish torpedo', rangeKm: 54, magazine: 38, salvo: 2, pk: 0.7, reactionSec: 120, engages: ['surface', 'subsurface'] }],
});
sub({
  id: 'yasen-m',
  name: 'Yasen-M class',
  origin: 'Russia',
  typeId: 'submarine',
  displacement: 13800,
  crew: 64,
  detection: 90,
  weapons: [
    { name: 'Kalibr', rangeKm: 1500, magazine: 32, salvo: 4, pk: 0.75, reactionSec: 300, engages: ['ground'] },
    { name: 'Oniks', rangeKm: 600, magazine: 32, salvo: 4, pk: 0.7, reactionSec: 180, engages: ['surface'] },
  ],
});
sub({
  id: 'kilo',
  name: 'Kilo class (Project 636)',
  origin: 'Russia',
  typeId: 'submarine',
  displacement: 3950,
  crew: 52,
  detection: 60,
  endurance: 45,
  weapons: [{ name: '53-65 torpedo', rangeKm: 19, magazine: 18, salvo: 2, pk: 0.6, reactionSec: 120, engages: ['surface', 'subsurface'] }],
  note: 'Diesel-electric; very quiet, limited submerged endurance.',
});
sub({
  id: 'type-093',
  name: 'Type 093 (Shang class)',
  origin: 'China',
  typeId: 'submarine',
  displacement: 7000,
  crew: 100,
  detection: 70,
  weapons: [{ name: 'YJ-18', rangeKm: 540, magazine: 12, salvo: 4, pk: 0.65, reactionSec: 180, engages: ['surface'] }],
});
sub({
  id: 'ohio-ssbn',
  name: 'Ohio class SSBN',
  origin: 'United States',
  typeId: 'ssbn',
  displacement: 18750,
  crew: 155,
  weapons: [{ name: 'Trident II D5', rangeKm: 12000, magazine: 20, salvo: 1, pk: 0.9, reactionSec: 900, engages: ['ground'] }],
});
sub({
  id: 'borei',
  name: 'Borei class SSBN',
  origin: 'Russia',
  typeId: 'ssbn',
  displacement: 24000,
  crew: 107,
  weapons: [{ name: 'Bulava', rangeKm: 9300, magazine: 16, salvo: 1, pk: 0.85, reactionSec: 900, engages: ['ground'] }],
});
sub({
  id: 'arihant',
  name: 'Arihant class SSBN',
  origin: 'India',
  typeId: 'ssbn',
  displacement: 6000,
  crew: 95,
  weapons: [{ name: 'K-15 Sagarika', rangeKm: 750, magazine: 12, salvo: 1, pk: 0.85, reactionSec: 900, engages: ['ground'] }],
});

/* ------------------------------------------------------------------ */
/* Missiles and rocket artillery                                       */
/* ------------------------------------------------------------------ */

const launcher = ({ id, name, origin, typeId, weapon, note }) =>
  add({
    id,
    name,
    typeId,
    origin,
    note,
    weapons: [weapon],
    provenance: weaponProv(0),
  });

launcher({
  id: 'iskander-m',
  name: 'Iskander-M',
  origin: 'Russia',
  typeId: 'missile',
  weapon: { name: '9M723', rangeKm: 500, magazine: 2, salvo: 2, pk: 0.8, reactionSec: 240, engages: ['ground'] },
});
launcher({
  id: 'atacms',
  name: 'ATACMS',
  origin: 'United States',
  typeId: 'missile',
  weapon: { name: 'MGM-140', rangeKm: 300, magazine: 2, salvo: 2, pk: 0.8, reactionSec: 180, engages: ['ground'] },
});
launcher({
  id: 'df-21d',
  name: 'DF-21D',
  origin: 'China',
  typeId: 'missile',
  weapon: { name: 'DF-21D', rangeKm: 1500, magazine: 1, salvo: 1, pk: 0.5, reactionSec: 600, engages: ['surface'] },
  note: 'Anti-ship ballistic missile; the kill probability is the most contested number here.',
});
launcher({
  id: 'df-26',
  name: 'DF-26',
  origin: 'China',
  typeId: 'missile',
  weapon: { name: 'DF-26', rangeKm: 4000, magazine: 1, salvo: 1, pk: 0.6, reactionSec: 600, engages: ['ground', 'surface'] },
});
launcher({
  id: 'himars',
  name: 'M142 HIMARS',
  origin: 'United States',
  typeId: 'rocket',
  weapon: { name: 'GMLRS', rangeKm: 80, magazine: 6, salvo: 6, pk: 0.7, reactionSec: 120, engages: ['ground'] },
});
launcher({
  id: 'bm-30-smerch',
  name: 'BM-30 Smerch',
  origin: 'Russia',
  typeId: 'rocket',
  weapon: { name: '9M55K', rangeKm: 90, magazine: 12, salvo: 12, pk: 0.4, reactionSec: 180, engages: ['ground'] },
});
launcher({
  id: 'tomahawk-tel',
  name: 'Typhon / Tomahawk (land)',
  origin: 'United States',
  typeId: 'missile',
  weapon: { name: 'Tomahawk', rangeKm: 1600, magazine: 4, salvo: 4, pk: 0.8, reactionSec: 600, engages: ['ground'] },
});
launcher({
  id: 'bastion-p',
  name: 'K-300P Bastion-P',
  origin: 'Russia',
  typeId: 'missile',
  weapon: { name: 'P-800 Oniks', rangeKm: 600, magazine: 2, salvo: 2, pk: 0.7, reactionSec: 300, engages: ['surface'] },
});
launcher({
  id: 'brahmos-land',
  name: 'BrahMos (land)',
  origin: 'India',
  typeId: 'missile',
  weapon: { name: 'BrahMos', rangeKm: 450, magazine: 3, salvo: 3, pk: 0.8, reactionSec: 300, engages: ['ground', 'surface'] },
});
launcher({
  id: 'minuteman-iii',
  name: 'LGM-30G Minuteman III',
  origin: 'United States',
  typeId: 'silo',
  weapon: { name: 'Minuteman III', rangeKm: 13000, magazine: 1, salvo: 1, pk: 0.9, reactionSec: 300, engages: ['ground'] },
});
launcher({
  id: 'rs-24-yars',
  name: 'RS-24 Yars',
  origin: 'Russia',
  typeId: 'silo',
  weapon: { name: 'RS-24', rangeKm: 11000, magazine: 1, salvo: 1, pk: 0.9, reactionSec: 300, engages: ['ground'] },
});

/* ------------------------------------------------------------------ */
/* Ground formations                                                   */
/* ------------------------------------------------------------------ */

add({
  id: 'm1a2-abrams',
  name: 'M1A2 Abrams',
  typeId: 'armour',
  origin: 'United States',
  weapons: [{ name: '120 mm M256', rangeKm: 4, magazine: 42, salvo: 1, pk: 0.8, reactionSec: 10, engages: ['ground'] }],
  platform: { speedKmh: 67, crew: 4 },
  provenance: { ...prov({ high: ['platform.crew', 'platform.speedKmh'] }), ...weaponProv(0) },
});
add({
  id: 't-90m',
  name: 'T-90M',
  typeId: 'armour',
  origin: 'Russia',
  weapons: [{ name: '125 mm 2A46M', rangeKm: 5, magazine: 43, salvo: 1, pk: 0.7, reactionSec: 10, engages: ['ground'] }],
  platform: { speedKmh: 60, crew: 3 },
  provenance: { ...prov({ high: ['platform.crew', 'platform.speedKmh'] }), ...weaponProv(0) },
});
add({
  id: 'leopard-2a7',
  name: 'Leopard 2A7',
  typeId: 'armour',
  origin: 'Germany',
  weapons: [{ name: '120 mm Rh-120', rangeKm: 4, magazine: 42, salvo: 1, pk: 0.8, reactionSec: 10, engages: ['ground'] }],
  platform: { speedKmh: 70, crew: 4 },
  provenance: { ...prov({ high: ['platform.crew'] }), ...weaponProv(0) },
});
add({
  id: 'm109a7',
  name: 'M109A7 Paladin',
  typeId: 'artillery',
  origin: 'United States',
  weapons: [{ name: '155 mm', rangeKm: 30, magazine: 39, salvo: 3, pk: 0.4, reactionSec: 60, engages: ['ground'] }],
  platform: { speedKmh: 61, crew: 4 },
  provenance: { ...prov({ high: ['platform.crew'] }), ...weaponProv(0) },
});
add({
  id: 'caesar',
  name: 'CAESAR 155 mm',
  typeId: 'artillery',
  origin: 'France',
  weapons: [{ name: '155 mm', rangeKm: 42, magazine: 18, salvo: 3, pk: 0.4, reactionSec: 60, engages: ['ground'] }],
  platform: { speedKmh: 80, crew: 5 },
  provenance: { ...prov({ high: ['platform.crew'] }), ...weaponProv(0) },
});

/* ------------------------------------------------------------------ */

writeFileSync(join(OUT, 'systems.json'), `${JSON.stringify(systems, null, 1)}\n`);

const byType = systems.reduce((acc, s) => ({ ...acc, [s.typeId]: (acc[s.typeId] ?? 0) + 1 }), {});
console.log(`systems.json  ${systems.length} systems`);
console.log(
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  ${t}: ${n}`)
    .join('\n')
);
