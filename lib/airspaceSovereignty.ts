/**
 * Airspace Sovereignty, Border Incursion Detection & Rules of Engagement (ROE) Engine
 *
 * Provides real-time geospatial airspace classification:
 * 1. Resolves coordinates to Sovereign Country Airspace or International Waters.
 * 2. Classifies airspace as Friendly, Hostile, Neutral, or International.
 * 3. Detects national border crossings, airspace incursions, and neutral airspace violations.
 * 4. Enforces Airspace Rules of Engagement (ROE) for SAM batteries and interceptor networks
 *    (Weapons Free vs ADIZ Border Defense vs Neutral Airspace Sanctuary).
 */

import { distanceKm } from './geo';
import {
  type SimEntity,
  type WarSimSession,
  type CombatReport,
  type AirspaceClassification,
  type AirspaceRoeDoctrine,
  type AirspaceLocation,
  type BorderIncursionRecord,
} from './warSimTypes';

/* ------------------------------------------------------------------ */
/* 1. Country Knowledge Base & Spatial Bounding Boxes                 */
/* ------------------------------------------------------------------ */

export interface CountryBoundaryInfo {
  iso: string;
  name: string;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  centerLngLat: [number, number];
  polygon?: [number, number][][]; // Simplified polygon coordinates for fast PIP
}

/**
 * High-performance bounding box and approximate boundary polygon lookup for major
 * theater nations across Eurasia, Middle East, Asia-Pacific, and Americas.
 */
export const COUNTRY_BOUNDARIES: CountryBoundaryInfo[] = [
  // Europe & NATO Eastern Flank
  {
    iso: 'PL',
    name: 'Poland',
    bbox: [14.1, 49.0, 24.1, 54.8],
    centerLngLat: [19.1, 52.0],
    polygon: [
      [[14.1, 53.9], [18.7, 54.8], [22.8, 54.3], [24.1, 52.8], [23.5, 50.3], [22.8, 49.0], [18.8, 49.5], [14.8, 50.9], [14.1, 53.9]]
    ],
  },
  {
    iso: 'UA',
    name: 'Ukraine',
    bbox: [22.1, 44.3, 40.2, 52.4],
    centerLngLat: [31.2, 48.5],
    polygon: [
      [[24.0, 51.5], [33.0, 52.4], [40.2, 49.5], [38.0, 47.0], [35.0, 46.5], [33.5, 44.5], [29.5, 45.3], [22.1, 48.2], [24.0, 51.5]]
    ],
  },
  {
    iso: 'RU',
    name: 'Russia',
    bbox: [19.5, 41.2, 180.0, 82.0],
    centerLngLat: [37.6, 55.7],
    polygon: [
      [[27.5, 58.0], [33.0, 68.0], [40.0, 68.0], [60.0, 70.0], [90.0, 75.0], [140.0, 72.0], [170.0, 65.0], [130.0, 45.0], [80.0, 50.0], [50.0, 48.0], [38.0, 47.0], [35.0, 52.0], [27.5, 58.0]]
    ],
  },
  {
    iso: 'BY',
    name: 'Belarus',
    bbox: [23.1, 51.2, 32.8, 56.2],
    centerLngLat: [27.6, 53.9],
    polygon: [
      [[23.5, 52.0], [24.0, 55.0], [28.0, 56.0], [31.5, 55.0], [32.5, 53.5], [30.5, 51.3], [24.0, 51.8], [23.5, 52.0]]
    ],
  },
  {
    iso: 'RO',
    name: 'Romania',
    bbox: [20.2, 43.6, 29.7, 48.3],
    centerLngLat: [25.0, 45.9],
    polygon: [
      [[20.5, 46.0], [23.5, 48.0], [28.0, 48.2], [29.6, 45.3], [28.6, 43.7], [22.7, 44.2], [20.5, 46.0]]
    ],
  },
  {
    iso: 'DE',
    name: 'Germany',
    bbox: [5.8, 47.2, 15.0, 55.1],
    centerLngLat: [10.4, 51.1],
    polygon: [
      [[6.0, 51.0], [7.0, 54.0], [10.0, 54.8], [14.2, 53.8], [14.8, 51.0], [13.0, 48.8], [9.8, 47.5], [7.5, 48.0], [6.0, 51.0]]
    ],
  },
  {
    iso: 'GB',
    name: 'United Kingdom',
    bbox: [-8.2, 49.9, 1.8, 60.9],
    centerLngLat: [-2.0, 54.0],
    polygon: [
      [[-5.0, 50.0], [1.5, 51.5], [1.0, 53.0], [-2.0, 58.5], [-5.0, 58.5], [-5.0, 54.0], [-5.0, 50.0]]
    ],
  },
  {
    iso: 'FR',
    name: 'France',
    bbox: [-5.1, 41.3, 9.6, 51.1],
    centerLngLat: [2.2, 46.2],
    polygon: [
      [[-4.5, 48.5], [1.5, 51.0], [8.0, 49.0], [7.0, 43.5], [3.0, 42.5], [-1.5, 43.5], [-4.5, 48.5]]
    ],
  },
  {
    iso: 'TR',
    name: 'Turkey',
    bbox: [25.6, 35.8, 44.8, 42.1],
    centerLngLat: [35.2, 38.9],
    polygon: [
      [[26.0, 41.5], [32.0, 42.0], [41.5, 41.5], [44.5, 39.0], [42.5, 37.0], [36.0, 36.0], [28.0, 37.0], [26.0, 41.5]]
    ],
  },
  {
    iso: 'FI',
    name: 'Finland',
    bbox: [20.5, 59.5, 31.6, 70.1],
    centerLngLat: [25.7, 61.9],
    polygon: [
      [[21.5, 60.0], [21.0, 64.0], [24.0, 69.0], [29.0, 70.0], [30.0, 65.0], [28.0, 61.0], [23.0, 60.0], [21.5, 60.0]]
    ],
  },
  {
    iso: 'SE',
    name: 'Sweden',
    bbox: [11.1, 55.3, 24.2, 69.1],
    centerLngLat: [18.6, 60.1],
    polygon: [
      [[12.0, 56.0], [12.0, 60.0], [18.0, 68.5], [23.5, 66.0], [18.5, 59.5], [14.0, 55.5], [12.0, 56.0]]
    ],
  },
  {
    iso: 'NO',
    name: 'Norway',
    bbox: [4.5, 57.9, 31.1, 71.2],
    centerLngLat: [8.5, 60.5],
    polygon: [
      [[5.0, 59.0], [5.0, 62.5], [14.0, 68.0], [28.0, 71.0], [30.0, 70.0], [18.0, 68.5], [12.0, 60.0], [7.0, 58.0], [5.0, 59.0]]
    ],
  },
  {
    iso: 'EE',
    name: 'Estonia',
    bbox: [21.8, 57.5, 28.2, 59.7],
    centerLngLat: [25.0, 58.6],
    polygon: [
      [[22.0, 58.5], [24.0, 59.5], [28.0, 59.4], [27.5, 57.8], [24.5, 57.8], [22.0, 58.5]]
    ],
  },
  {
    iso: 'LV',
    name: 'Latvia',
    bbox: [20.9, 55.7, 28.2, 58.1],
    centerLngLat: [24.6, 56.9],
    polygon: [
      [[21.0, 56.5], [23.5, 57.5], [27.8, 57.8], [28.0, 56.0], [24.5, 56.2], [21.0, 56.5]]
    ],
  },
  {
    iso: 'LT',
    name: 'Lithuania',
    bbox: [20.9, 53.9, 26.8, 56.4],
    centerLngLat: [23.9, 55.2],
    polygon: [
      [[21.0, 55.5], [24.0, 56.4], [26.5, 55.5], [25.5, 54.0], [22.5, 54.5], [21.0, 55.5]]
    ],
  },

  // Middle East & Levant
  {
    iso: 'IL',
    name: 'Israel',
    bbox: [34.2, 29.5, 35.9, 33.3],
    centerLngLat: [34.8, 31.0],
    polygon: [
      [[34.3, 31.3], [35.0, 33.1], [35.6, 33.3], [35.5, 31.5], [34.9, 29.5], [34.3, 31.3]]
    ],
  },
  {
    iso: 'IR',
    name: 'Iran',
    bbox: [44.0, 25.0, 63.3, 39.8],
    centerLngLat: [53.7, 32.4],
    polygon: [
      [[45.0, 39.0], [50.0, 37.5], [55.0, 37.0], [61.0, 36.0], [62.0, 27.0], [56.0, 26.5], [50.0, 29.5], [48.0, 31.5], [45.0, 39.0]]
    ],
  },
  {
    iso: 'SY',
    name: 'Syria',
    bbox: [35.6, 32.3, 42.4, 37.3],
    centerLngLat: [38.5, 35.0],
    polygon: [
      [[36.0, 35.5], [37.0, 37.0], [42.0, 37.0], [41.5, 34.0], [37.0, 32.5], [36.0, 35.5]]
    ],
  },
  {
    iso: 'IQ',
    name: 'Iraq',
    bbox: [38.8, 29.1, 48.6, 37.4],
    centerLngLat: [43.7, 33.2],
    polygon: [
      [[41.5, 37.0], [45.0, 36.0], [48.0, 31.0], [47.0, 30.0], [42.0, 31.5], [39.0, 33.5], [41.5, 37.0]]
    ],
  },
  {
    iso: 'SA',
    name: 'Saudi Arabia',
    bbox: [34.5, 16.4, 55.7, 32.2],
    centerLngLat: [45.0, 23.9],
    polygon: [
      [[36.0, 28.0], [40.0, 31.5], [47.0, 31.0], [50.0, 28.0], [55.0, 22.0], [50.0, 17.0], [42.0, 16.5], [36.0, 28.0]]
    ],
  },

  // Asia-Pacific
  {
    iso: 'CN',
    name: 'China',
    bbox: [73.5, 18.2, 134.8, 53.6],
    centerLngLat: [104.2, 35.8],
    polygon: [
      [[75.0, 38.0], [87.0, 48.0], [120.0, 52.0], [130.0, 48.0], [122.0, 40.0], [120.0, 30.0], [110.0, 20.0], [100.0, 22.0], [80.0, 30.0], [75.0, 38.0]]
    ],
  },
  {
    iso: 'TW',
    name: 'Taiwan',
    bbox: [119.8, 21.9, 122.1, 25.3],
    centerLngLat: [120.9, 23.7],
    polygon: [
      [[120.0, 25.0], [121.5, 25.3], [122.0, 24.0], [121.0, 22.0], [120.0, 23.0], [120.0, 25.0]]
    ],
  },
  {
    iso: 'JP',
    name: 'Japan',
    bbox: [122.9, 24.0, 153.9, 45.5],
    centerLngLat: [138.2, 36.2],
    polygon: [
      [[130.0, 32.0], [135.0, 35.0], [141.0, 41.0], [145.0, 44.0], [141.0, 38.0], [132.0, 33.0], [130.0, 32.0]]
    ],
  },
  {
    iso: 'US',
    name: 'United States',
    bbox: [-171.8, 18.9, -66.9, 71.4],
    centerLngLat: [-98.5, 39.8],
    polygon: [
      [[-124.0, 48.0], [-95.0, 49.0], [-70.0, 45.0], [-75.0, 35.0], [-80.0, 25.0], [-97.0, 26.0], [-117.0, 32.5], [-124.0, 48.0]]
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 2. Point-in-Polygon (PIP) & Fast Bounding Box Check                */
/* ------------------------------------------------------------------ */

/**
 * Checks if a point [lng, lat] lies inside a polygon ring using Ray-Casting algorithm.
 */
export function isPointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Resolves any latitude/longitude coordinate to a specific Country and Airspace Classification.
 */
export function resolveAirspaceLocation(
  lngLat: [number, number],
  playerIso: string,
  enemyIso: string,
  coalitionIsos: { player: string[]; enemy: string[] } = { player: [], enemy: [] }
): AirspaceLocation {
  const [lng, lat] = lngLat;

  // 1. Check known country boundaries
  for (const country of COUNTRY_BOUNDARIES) {
    const [minLng, minLat, maxLng, maxLat] = country.bbox;
    // Bounding box pre-filter
    if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
      if (country.polygon) {
        for (const ring of country.polygon) {
          if (isPointInPolygon(lngLat, ring)) {
            // Found matching sovereign country polygon
            const iso = country.iso;
            let classification: AirspaceClassification = 'neutral';

            if (iso === playerIso || coalitionIsos.player.includes(iso)) {
              classification = 'friendly';
            } else if (iso === enemyIso || coalitionIsos.enemy.includes(iso)) {
              classification = 'hostile';
            }

            return {
              countryIso: iso,
              countryName: country.name,
              classification,
            };
          }
        }
      } else {
        // Fallback to bounding box match if polygon is absent
        const iso = country.iso;
        let classification: AirspaceClassification = 'neutral';
        if (iso === playerIso || coalitionIsos.player.includes(iso)) {
          classification = 'friendly';
        } else if (iso === enemyIso || coalitionIsos.enemy.includes(iso)) {
          classification = 'hostile';
        }
        return {
          countryIso: iso,
          countryName: country.name,
          classification,
        };
      }
    }
  }

  // 2. Default: International Airspace / High Seas
  return {
    countryIso: 'INT',
    countryName: 'International Waters / Airspace',
    classification: 'international',
  };
}

/* ------------------------------------------------------------------ */
/* 3. Border Incursion Tracking & Event Evaluation                     */
/* ------------------------------------------------------------------ */

/**
 * Checks if a moving entity crossed an international border between two simulation ticks.
 */
export function evaluateBorderIncursion(
  entity: SimEntity,
  currentLocation: AirspaceLocation,
  previousLocation?: AirspaceLocation
): BorderIncursionRecord | null {
  if (!previousLocation) return null;
  if (currentLocation.countryIso === previousLocation.countryIso) return null;

  // An international border crossing occurred!
  const isEntityPlayer = entity.iso === 'US' || entity.iso === 'UA' || entity.iso === 'IL' || entity.iso === 'TW';
  const faction: 'player' | 'enemy' = isEntityPlayer ? 'player' : 'enemy';

  let incursionType: BorderIncursionRecord['incursionType'] = 'friendly_entry';

  if (currentLocation.classification === 'hostile') {
    incursionType = 'hostile_breach';
  } else if (currentLocation.classification === 'neutral') {
    incursionType = 'neutral_violation';
  } else if (currentLocation.classification === 'international') {
    incursionType = 'international_exit';
  }

  return {
    id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    simTimeSec: 0, // Injected by caller
    entityId: entity.id,
    entityName: entity.name,
    entityIso: entity.iso,
    faction,
    fromIso: previousLocation.countryIso,
    fromName: previousLocation.countryName,
    toIso: currentLocation.countryIso,
    toName: currentLocation.countryName,
    incursionType,
    lngLat: entity.lngLat,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Airspace Rules of Engagement (ROE) Enforcement                  */
/* ------------------------------------------------------------------ */

/**
 * Evaluates whether a SAM battery, naval interceptor, or combat air patrol is legally
 * authorized to fire upon a target under the theater's active Airspace ROE Doctrine.
 */
export function canEngageUnderAirspaceRoe(
  targetAirspace: AirspaceLocation,
  roeDoctrine: AirspaceRoeDoctrine = 'weapons_free',
  defenderFaction: 'player' | 'enemy'
): { canFire: boolean; reason: string } {
  // Mode 1: Weapons Free (Engage anywhere in kinematic envelope)
  if (roeDoctrine === 'weapons_free') {
    return { canFire: true, reason: 'Weapons Free: Kinetic reach authorized across all boundaries' };
  }

  // Mode 2: ADIZ Border Defense (Hold fire until sovereign border incursion)
  if (roeDoctrine === 'adiz_border_defense') {
    if (targetAirspace.classification === 'friendly') {
      return { canFire: true, reason: 'Target has violated Sovereign Friendly Airspace — Engagement Authorized' };
    }
    if (targetAirspace.classification === 'international') {
      return { canFire: true, reason: 'Target in International Airspace — Hot Pursuit Authorized' };
    }
    return {
      canFire: false,
      reason: `ADIZ Restriction: Target is still inside ${targetAirspace.countryName} airspace. Holding fire until border incursion.`,
    };
  }

  // Mode 3: Neutral Airspace Sanctuary (Strict diplomatic neutrality protection)
  if (roeDoctrine === 'neutral_sanctuary') {
    if (targetAirspace.classification === 'neutral') {
      return {
        canFire: false,
        reason: `Neutral Sanctuary: Target is currently over neutral ${targetAirspace.countryName}. Firing prohibited to prevent diplomatic crisis.`,
      };
    }
    return { canFire: true, reason: 'Non-neutral airspace — Engagement Authorized' };
  }

  return { canFire: true, reason: 'Authorized' };
}

/* ------------------------------------------------------------------ */
/* 5. After-Action Airspace Telemetry & Reporting                      */
/* ------------------------------------------------------------------ */

export function createAirspaceCombatReport(
  session: WarSimSession,
  incursions: BorderIncursionRecord[]
): NonNullable<CombatReport['borderDetails']> {
  const hostileBreaches = incursions.filter((i) => i.incursionType === 'hostile_breach').length;
  const neutralViolations = incursions.filter((i) => i.incursionType === 'neutral_violation').length;

  let assessment = 'All tactical sorties adhered to established international flight corridors.';
  if (hostileBreaches > 0 && neutralViolations > 0) {
    assessment = `High-intensity border violations: ${hostileBreaches} sovereign airspace breaches and ${neutralViolations} diplomatic neutral airspace intrusions recorded during theater operations.`;
  } else if (hostileBreaches > 0) {
    assessment = `Direct cross-border offensive strikes conducted: ${hostileBreaches} hostile sovereign airspace breaches logged.`;
  } else if (neutralViolations > 0) {
    assessment = `Diplomatic friction alert: ${neutralViolations} unauthorized overflights across neutral 3rd-party nations without diplomatic overflight clearance.`;
  }

  return {
    totalIncursions: incursions.length,
    hostileAirspaceBreaches: hostileBreaches,
    neutralViolations,
    activeRoeDoctrine: session.airspaceRoeDoctrine || 'weapons_free',
    sovereigntyAssessment: assessment,
    incursionLog: incursions.map((i) => ({
      entityName: i.entityName,
      fromCountry: i.fromName,
      toCountry: i.toName,
      incursionType: i.incursionType,
      simTimeSec: i.simTimeSec,
    })),
  };
}
