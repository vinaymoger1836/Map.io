/**
 * War Simulation MapLibre GL Layers & Live Visual Renderers
 *
 * Manages live GeoJSON sources and layers for:
 * 1. Sovereign Base installations (Airbases, Naval Ports, Army HQs, Silos) with distinct icons.
 * 2. Active Friendly Units with NATO Tactical Military APP-6 Icons (aircraft, SAM domes, armor tracks, ships, UAVs).
 * 3. Selected Unit Multi-Envelopes (Detection Horizon, Engagement Radius).
 * 4. Fog-of-War Contact Blips (Tier 1 Sensor Tracks vs. Tier 2 PID units).
 * 5. Patrol Orbit Rings & Ingress Trajectories.
 * 6. In-flight Missiles and Interceptors.
 * 7. Combat Radius Reach Rings during target selection.
 */

import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type MissileFlyoutTrack,
} from './warSimTypes';
import { type SystemSpec, radarHorizonKm, domainOf } from './specs';
import { distanceKm, geodesicRing, greatCirclePath, bearingDeg } from './geo';
import { ensureIcons, ensurePlaybackIcons, unitIconId, type IconSpec } from './unitIcons';
import { UNIT_BY_ID, type EchelonMark } from './warGames';
import { isGroundCombatUnit, isStaticAirDefense } from './warSimRules';
import { isNavalCombatant } from './navalEngagement';
import { detectFont } from './mapLayers';
import {
  getKnownHostileThreatZones,
  evaluateFlightCorridor,
  type SAMThreatZone,
} from './threatAvoidance';
import { generateAarRacetrackCoordinates } from './aerialRefueling';

const SRC_BASES = 'warsim-bases-src';
const SRC_ENTITIES = 'warsim-entities-src';
const SRC_CONTACTS = 'warsim-contacts-src';
const SRC_PATROLS = 'warsim-patrols-src';
const SRC_MISSILES = 'warsim-missiles-src';
const SRC_REACH_RING = 'warsim-reach-ring-src';
const SRC_ENVELOPES = 'warsim-envelopes-src';
const SRC_PATROL_PREVIEW = 'warsim-patrol-preview-src';
const SRC_SATELLITES = 'warsim-satellites-src';
const SRC_EW = 'warsim-ew-src';

const LYR_REACH_RING_FILL = 'warsim-reach-ring-fill';
const LYR_REACH_RING_LINE = 'warsim-reach-ring-line';
const LYR_PATROL_PREVIEW_FILL = 'warsim-patrol-preview-fill';
const LYR_PATROL_PREVIEW_LINE = 'warsim-patrol-preview-line';
const LYR_PATROL_PREVIEW_CENTER = 'warsim-patrol-preview-center';
const LYR_PATROL_PREVIEW_LABEL = 'warsim-patrol-preview-label';
const LYR_ENVELOPES_FILL = 'warsim-envelopes-fill';
const LYR_ENVELOPES_LINE = 'warsim-envelopes-line';

const LYR_EW_JAMMING_CONE_FILL = 'warsim-ew-jamming-cone-fill';
const LYR_EW_JAMMING_CONE_LINE = 'warsim-ew-jamming-cone-line';
const LYR_EW_GPS_BUBBLE_FILL = 'warsim-ew-gps-bubble-fill';
const LYR_EW_GPS_BUBBLE_LINE = 'warsim-ew-gps-bubble-line';
const LYR_EW_LABEL = 'warsim-ew-label';

const LYR_SATELLITES_GROUNDTRACK = 'warsim-satellites-groundtrack';
const LYR_SATELLITES_SWATH_FILL = 'warsim-satellites-swath-fill';
const LYR_SATELLITES_SWATH_LINE = 'warsim-satellites-swath-line';
const LYR_SATELLITES_MARKER = 'warsim-satellites-marker';
const LYR_SATELLITES_LABEL = 'warsim-satellites-label';

const LYR_BASES_CIRCLE = 'warsim-bases-circle';
const LYR_BASES_LABEL = 'warsim-bases-label';
const LYR_ENTITIES_HALO = 'warsim-entities-halo';
const LYR_ENTITIES_MARKER = 'warsim-entities-marker';
const LYR_ENTITIES_SYMBOL = 'warsim-entities-symbol';
const LYR_CONTACTS_HALO = 'warsim-contacts-halo';
const LYR_CONTACTS_CIRCLE = 'warsim-contacts-circle';
const LYR_CONTACTS_LABEL = 'warsim-contacts-label';
const LYR_CONTACTS_SYMBOL = 'warsim-contacts-symbol';
const LYR_PATROLS_LINE = 'warsim-patrols-line';
const LYR_MISSILES_LINE = 'warsim-missiles-line';
const LYR_MISSILES_HEAD = 'warsim-missiles-head';
const LYR_MISSILES_SYMBOL = 'warsim-missiles-symbol';
const LYR_MISSILES_LABEL = 'warsim-missiles-label';

export function getSimUnitIcon(typeId: string): string {
  switch (typeId) {
    case 'satellite':
      return '🛰️';
    case 'fighter':
    case 'strike':
    case 'multirole':
    case 'interceptor':
      return '✈️';
    case 'strategic-bomber':
    case 'bomber':
      return '🛫';
    case 'awacs':
      return '📡';
    case 'tanker':
      return '⛽';
    case 'uav':
    case 'drone':
    case 'halej-uav':
      return '🛸';
    case 'attack-heli':
    case 'transport-heli':
      return '🚁';
    case 'destroyer':
    case 'frigate':
    case 'corvette':
      return '🚢';
    case 'carrier':
    case 'amphibious':
      return '🛳️';
    case 'submarine':
    case 'ssn':
    case 'ssbn':
      return '🤿';
    case 'sam-launcher':
      return '🚀';
    case 'radar':
    case 'early-warning':
      return '🌐';
    case 'tank':
    case 'ifv':
    case 'apc':
    case 'armor':
      return '🛡️';
    case 'artillery':
    case 'mlrs':
      return '💥';
    case 'special-forces':
      return '🎯';
    case 'silo':
      return '🚀';
    default:
      return '⚔️';
  }
}

export function mapSimTypeToUnitType(typeId: string): string {
  switch (typeId) {
    case 'fighter':
    case 'interceptor':
    case 'multirole':
      return 'fighter';
    case 'strike':
      return 'strike';
    case 'strategic-bomber':
    case 'bomber':
      return 'bomber';
    case 'awacs':
      return 'awacs';
    case 'tanker':
      return 'tanker';
    case 'uav':
    case 'drone':
    case 'halej-uav':
      return 'uav';
    case 'attack-heli':
      return 'attack-heli';
    case 'transport-heli':
      return 'transport-heli';
    case 'destroyer':
      return 'destroyer';
    case 'frigate':
      return 'frigate';
    case 'corvette':
      return 'corvette';
    case 'carrier':
      return 'carrier-ship';
    case 'amphibious':
      return 'amphib-ship';
    case 'submarine':
    case 'ssn':
      return 'submarine';
    case 'ssbn':
      return 'ssbn';
    case 'sam-launcher':
      return 'sam-launcher';
    case 'radar':
    case 'early-warning':
      return 'radar';
    case 'tank':
    case 'mbt':
    case 'armor':
    case 'armour':
      return 'armour';
    case 'ifv':
    case 'apc':
    case 'mech-infantry':
      return 'mech-infantry';
    case 'artillery':
      return 'artillery';
    case 'mlrs':
      return 'rocket';
    case 'special-forces':
      return 'special-forces';
    case 'silo':
      return 'silo';
    default:
      return 'infantry';
  }
}

export function simEntityIconSpec(e: SimEntity, color: string): IconSpec {
  const mappedKey = mapSimTypeToUnitType(e.typeId);
  const typeDef = UNIT_BY_ID.get(mappedKey) ?? UNIT_BY_ID.get('infantry')!;

  const mark: EchelonMark =
    e.count > 1
      ? { kind: 'text', text: `${e.count}×` }
      : typeDef.domain === 'air'
        ? { kind: 'text', text: 'SQN' }
        : typeDef.domain === 'site'
          ? { kind: 'text', text: 'BTY' }
          : { kind: 'bars', n: 2 };

  return {
    typeId: typeDef.id,
    glyph: typeDef.glyph,
    domain: typeDef.domain,
    color,
    mark,
  };
}

export function installWarSimLayers(map: MLMap) {
  if (map.getSource(SRC_BASES)) return;

  const font = detectFont(map);
  ensurePlaybackIcons(map);

  // 0. Reach Ring (Combat Radius Target Designation)
  map.addSource(SRC_REACH_RING, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_REACH_RING_FILL,
    type: 'fill',
    source: SRC_REACH_RING,
    paint: {
      'fill-color': '#4FC3F7',
      'fill-opacity': 0.08,
    },
  });

  map.addLayer({
    id: LYR_REACH_RING_LINE,
    type: 'line',
    source: SRC_REACH_RING,
    paint: {
      'line-color': '#4FC3F7',
      'line-width': 2,
      'line-dasharray': [4, 3],
      'line-opacity': 0.85,
    },
  });

  // 0.05. Real-time Cursor Patrol Orbit Preview
  map.addSource(SRC_PATROL_PREVIEW, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_PATROL_PREVIEW_FILL,
    type: 'fill',
    source: SRC_PATROL_PREVIEW,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['get', 'fillOpacity'],
    },
  });

  map.addLayer({
    id: LYR_PATROL_PREVIEW_LINE,
    type: 'line',
    source: SRC_PATROL_PREVIEW,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'lineWidth'],
      'line-dasharray': [3, 2],
      'line-opacity': 0.9,
    },
  });

  map.addLayer({
    id: LYR_PATROL_PREVIEW_CENTER,
    type: 'circle',
    source: SRC_PATROL_PREVIEW,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2.5,
    },
  });

  map.addLayer({
    id: LYR_PATROL_PREVIEW_LABEL,
    type: 'symbol',
    source: SRC_PATROL_PREVIEW,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-font': font,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': ['coalesce', ['get', 'color'], '#FFFFFF'],
      'text-halo-color': '#000000',
      'text-halo-width': 2,
    },
  });

  // 0.1. Unit Envelopes (Detection, Engagement)
  map.addSource(SRC_ENVELOPES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_ENVELOPES_FILL,
    type: 'fill',
    source: SRC_ENVELOPES,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['get', 'fillOpacity'],
    },
  });

  map.addLayer({
    id: LYR_ENVELOPES_LINE,
    type: 'line',
    source: SRC_ENVELOPES,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'lineWidth'],
      'line-dasharray': [3, 2],
      'line-opacity': 0.85,
    },
  });

  // 1. Bases Source & Layers
  map.addSource(SRC_BASES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_BASES_CIRCLE,
    type: 'circle',
    source: SRC_BASES,
    paint: {
      'circle-radius': 9,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  map.addLayer({
    id: LYR_BASES_LABEL,
    type: 'symbol',
    source: SRC_BASES,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-font': font,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': '#000000',
      'text-halo-width': 2,
    },
  });

  // 2. Patrol Rings Source & Layer
  map.addSource(SRC_PATROLS, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_PATROLS_LINE,
    type: 'line',
    source: SRC_PATROLS,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      'line-opacity': 0.7,
    },
  });

  // 3. Friendly Entities Source & Tactical Symbol Layers (NATO Chips)
  map.addSource(SRC_ENTITIES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_ENTITIES_HALO,
    type: 'circle',
    source: SRC_ENTITIES,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 20, 6, 28, 10, 36],
      'circle-color': '#4FC3F7',
      'circle-opacity': 0.22,
      'circle-stroke-color': '#4FC3F7',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.95,
    },
  });

  // Dedicated Tactical Position Dot Marker
  map.addLayer({
    id: LYR_ENTITIES_MARKER,
    type: 'circle',
    source: SRC_ENTITIES,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4.5, 6, 6.5, 10, 8.5],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.9,
    },
  });

  map.addLayer({
    id: LYR_ENTITIES_SYMBOL,
    type: 'symbol',
    source: SRC_ENTITIES,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 5, 0.78, 9, 0.96],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'center',
      'text-field': ['get', 'label'],
      'text-font': font,
      'text-size': 10.5,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': '#070C14',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  });

  // 4. Fog of War Contacts Source & Layers
  map.addSource(SRC_CONTACTS, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Contacts Selection Halo
  map.addLayer({
    id: LYR_CONTACTS_HALO,
    type: 'circle',
    source: SRC_CONTACTS,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 20, 6, 28, 10, 36],
      'circle-color': '#D9534F',
      'circle-opacity': 0.22,
      'circle-stroke-color': '#FF5252',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.95,
    },
  });

  // Tier 1 Sensor Track Radar Dot Blips
  map.addLayer({
    id: LYR_CONTACTS_CIRCLE,
    type: 'circle',
    source: SRC_CONTACTS,
    filter: ['==', ['get', 'tier'], 1],
    paint: {
      'circle-radius': 7.5,
      'circle-color': '#FFB020',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  // Tier 1 Sensor Track Labels
  map.addLayer({
    id: LYR_CONTACTS_LABEL,
    type: 'symbol',
    source: SRC_CONTACTS,
    filter: ['==', ['get', 'tier'], 1],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-font': font,
    },
    paint: {
      'text-color': '#FFB020',
      'text-halo-color': '#070C14',
      'text-halo-width': 1.5,
    },
  });

  // Tier 2 Positively Identified (PID) NATO Tactical Badge Icons
  map.addLayer({
    id: LYR_CONTACTS_SYMBOL,
    type: 'symbol',
    source: SRC_CONTACTS,
    filter: ['==', ['get', 'tier'], 2],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 5, 0.78, 9, 0.96],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'center',
      'text-field': ['get', 'label'],
      'text-font': font,
      'text-size': 10.5,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': '#070C14',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  });

  // 5. In-flight Missiles
  map.addSource(SRC_MISSILES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_MISSILES_LINE,
    type: 'line',
    source: SRC_MISSILES,
    paint: {
      'line-color': '#FF5252',
      'line-width': 2,
      'line-opacity': 0.8,
    },
  });

  map.addLayer({
    id: LYR_MISSILES_HEAD,
    type: 'circle',
    source: SRC_MISSILES,
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 3.5,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#FF5252',
      'circle-stroke-width': 1.5,
    },
  });

  map.addLayer({
    id: LYR_MISSILES_SYMBOL,
    type: 'symbol',
    source: SRC_MISSILES,
    filter: ['==', '$type', 'Point'],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': 0.9,
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  map.addLayer({
    id: LYR_MISSILES_LABEL,
    type: 'symbol',
    source: SRC_MISSILES,
    filter: ['==', '$type', 'Point'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 9.5,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-font': font,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#FF5252',
      'text-halo-color': '#070C14',
      'text-halo-width': 2,
    },
  });

  // 6. Space Layer: Orbital Satellites & Reconnaissance Swaths
  map.addSource(SRC_SATELLITES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_SATELLITES_GROUNDTRACK,
    type: 'line',
    source: SRC_SATELLITES,
    filter: ['==', ['get', 'kind'], 'groundtrack'],
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#FFD54F'],
      'line-width': 1.6,
      'line-dasharray': [4, 4],
      'line-opacity': 0.65,
    },
  });

  map.addLayer({
    id: LYR_SATELLITES_SWATH_FILL,
    type: 'fill',
    source: SRC_SATELLITES,
    filter: ['==', ['get', 'kind'], 'swath'],
    paint: {
      'fill-color': ['coalesce', ['get', 'swathColor'], '#00E5FF'],
      'fill-opacity': 0.12,
    },
  });

  map.addLayer({
    id: LYR_SATELLITES_SWATH_LINE,
    type: 'line',
    source: SRC_SATELLITES,
    filter: ['==', ['get', 'kind'], 'swath'],
    paint: {
      'line-color': ['coalesce', ['get', 'swathColor'], '#00E5FF'],
      'line-width': 1.2,
      'line-opacity': 0.55,
    },
  });

  map.addLayer({
    id: LYR_SATELLITES_MARKER,
    type: 'circle',
    source: SRC_SATELLITES,
    filter: ['==', ['get', 'kind'], 'satellite'],
    paint: {
      'circle-radius': 6,
      'circle-color': ['coalesce', ['get', 'color'], '#FFD54F'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  map.addLayer({
    id: LYR_SATELLITES_LABEL,
    type: 'symbol',
    source: SRC_SATELLITES,
    filter: ['==', ['get', 'kind'], 'satellite'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-font': font,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#FFD54F',
      'text-halo-color': '#070C14',
      'text-halo-width': 2,
    },
  });

  // 7. Electronic Warfare (EW), Directional Jamming Cones & GPS Denial
  map.addSource(SRC_EW, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_EW_JAMMING_CONE_FILL,
    type: 'fill',
    source: SRC_EW,
    filter: ['==', ['get', 'kind'], 'jamming_cone'],
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], '#00E5FF'],
      'fill-opacity': 0.14,
    },
  });

  map.addLayer({
    id: LYR_EW_JAMMING_CONE_LINE,
    type: 'line',
    source: SRC_EW,
    filter: ['==', ['get', 'kind'], 'jamming_cone'],
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#00E5FF'],
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      'line-opacity': 0.75,
    },
  });

  map.addLayer({
    id: LYR_EW_GPS_BUBBLE_FILL,
    type: 'fill',
    source: SRC_EW,
    filter: ['==', ['get', 'kind'], 'gps_bubble'],
    paint: {
      'fill-color': '#9C27B0',
      'fill-opacity': 0.08,
    },
  });

  map.addLayer({
    id: LYR_EW_GPS_BUBBLE_LINE,
    type: 'line',
    source: SRC_EW,
    filter: ['==', ['get', 'kind'], 'gps_bubble'],
    paint: {
      'line-color': '#E040FB',
      'line-width': 1.3,
      'line-dasharray': [4, 4],
      'line-opacity': 0.7,
    },
  });

  map.addLayer({
    id: LYR_EW_LABEL,
    type: 'symbol',
    source: SRC_EW,
    filter: ['==', ['get', 'kind'], 'label'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 9.5,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-font': font,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': ['coalesce', ['get', 'color'], '#E040FB'],
      'text-halo-color': '#070C14',
      'text-halo-width': 2,
    },
  });
}

/**
 * Syncs the live simulation state with MapLibre GeoJSON sources.
 */
export function renderWarSimStateToMap(
  map: MLMap,
  session: WarSimSession,
  activeFaction: 'player' | 'enemy',
  targetPicking?: {
    mode: 'sortie' | 'place_autonomous' | 'place_base' | 'strike_route';
    originLngLat?: [number, number];
    maxRangeKm?: number;
  } | null,
  selectedEntityId?: string | null,
  systemsLibrary: SystemSpec[] = [],
  activeWeaponIndex?: number | null,
  showAllEnvelopes: boolean = false,
  selectedContactId?: string | null
) {
  if (!map.getSource(SRC_BASES)) {
    installWarSimLayers(map);
  } else {
    // Ensure all simulation symbol and marker layers remain visible
    const simLayers = [
      LYR_BASES_CIRCLE,
      LYR_BASES_LABEL,
      LYR_ENTITIES_MARKER,
      LYR_ENTITIES_SYMBOL,
      LYR_CONTACTS_CIRCLE,
      LYR_CONTACTS_LABEL,
      LYR_CONTACTS_SYMBOL,
      LYR_MISSILES_LINE,
      LYR_MISSILES_HEAD,
      LYR_MISSILES_SYMBOL,
      LYR_MISSILES_LABEL,
      LYR_PATROLS_LINE,
    ];
    for (const id of simLayers) {
      if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'none') {
        map.setLayoutProperty(id, 'visibility', 'visible');
      }
    }
  }

  const isPlayer = activeFaction === 'player';
  const factionIso = isPlayer ? session.playerIso : session.enemyIso;
  const factionColor = isPlayer ? session.playerColor : session.enemyColor;
  const enemyColor = isPlayer ? session.enemyColor : session.playerColor;

  // 0. Render Reach Ring if selecting sortie target
  const reachRingFeatures: GeoJSON.Feature[] = [];
  if (targetPicking?.mode === 'sortie' && targetPicking.originLngLat && targetPicking.maxRangeKm) {
    const ringCoords = geodesicRing(targetPicking.originLngLat, targetPicking.maxRangeKm, 72);
    reachRingFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ringCoords] },
      properties: {},
    });
  }
  (map.getSource(SRC_REACH_RING) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: reachRingFeatures,
  });

  // 0.1. Render Tactical Envelopes (Either for ALL deployed friendly units or ONLY selected unit)
  const envelopeFeatures: GeoJSON.Feature[] = [];

  if (showAllEnvelopes) {
    const activeFriendly = session.entities.filter(
      (e) =>
        e.iso === factionIso &&
        e.status !== 'destroyed' &&
        e.status !== 'docked' &&
        e.status !== 'turnaround' &&
        e.status !== 'in_repair'
    );

    activeFriendly.forEach((e) => {
      const spec = systemsLibrary.find((s) => s.id === e.systemId);
      const isSelected = e.id === selectedEntityId;

      const isGround = isGroundCombatUnit(e.typeId);
      const isNaval = isNavalCombatant(e.typeId) || (spec ? domainOf(spec) === 'sea' : false);

      // Sensor horizon envelope
      const detectionRadiusKm = (e.typeId === 'uav' || e.typeId === 'recon')
        ? Math.max(spec?.sensor?.detectionKm ?? 40, 180)
        : (spec?.sensor?.detectionKm ?? (
            isGround ? 8 : e.typeId === 'awacs' ? 450 : e.typeId === 'radar' ? 400 : 200
          ));
      if (detectionRadiusKm > 0) {
        const detectCoords = geodesicRing(e.lngLat, detectionRadiusKm, 48);
        envelopeFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [detectCoords] },
          properties: {
            color: '#4FC3F7',
            fillOpacity: isSelected ? 0.12 : 0.04,
            lineWidth: isSelected ? 1.8 : 1.0,
            label: isGround
              ? `🔭 ${e.name} (${detectionRadiusKm} km)`
              : isNaval
                ? `📡 ${e.name} Air Search Radar (${detectionRadiusKm} km)`
                : `📡 ${e.name} (${detectionRadiusKm} km)`,
          },
        });
      }

      // Surface search clipped horizon for naval surface combatants
      if (isNaval && e.typeId !== 'submarine') {
        const antennaM = spec?.sensor?.antennaM ?? 25;
        const surfaceHorizonKm = Math.round(radarHorizonKm(antennaM, 25));
        if (surfaceHorizonKm > 0 && surfaceHorizonKm < detectionRadiusKm) {
          const surfCoords = geodesicRing(e.lngLat, surfaceHorizonKm, 48);
          envelopeFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [surfCoords] },
            properties: {
              color: '#00E5FF',
              fillOpacity: isSelected ? 0.10 : 0.03,
              lineWidth: isSelected ? 1.6 : 0.9,
              label: `🌊 ${e.name} Surface Horizon (${surfaceHorizonKm} km)`,
            },
          });
        }
      }

      // Weapon range for selected entity if previewing a specific weapon
      const weapons = (e.customWeapons && e.customWeapons.length > 0) ? e.customWeapons : (spec?.weapons || []);
      if (isSelected && activeWeaponIndex !== null && activeWeaponIndex !== undefined && weapons[activeWeaponIndex]) {
        const weapon = weapons[activeWeaponIndex];
        if (weapon.rangeKm > 0) {
          const engageCoords = geodesicRing(e.lngLat, weapon.rangeKm, 64);
          envelopeFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [engageCoords] },
            properties: {
              color: '#FF9800',
              fillOpacity: 0.14,
              lineWidth: 2,
              label: `⚔️ ${weapon.name || 'Munition'} (${weapon.rangeKm} km)`,
            },
          });
        }
      }
    });
  } else {
    // Only render for selectedEntity
    const selectedEntity = session.entities.find((e) => e.id === selectedEntityId && e.status !== 'destroyed');

    if (selectedEntity) {
      const spec = systemsLibrary.find((s) => s.id === selectedEntity.systemId);
      const isGround = isGroundCombatUnit(selectedEntity.typeId);
      const isNaval = isNavalCombatant(selectedEntity.typeId) || (spec ? domainOf(spec) === 'sea' : false);

      // 1. Detection / Sensor Horizon Envelope (Always on for selected entity)
      const detectionRadiusKm = (selectedEntity.typeId === 'uav' || selectedEntity.typeId === 'recon')
        ? Math.max(spec?.sensor?.detectionKm ?? 40, 180)
        : (spec?.sensor?.detectionKm ?? (
            isGround ? 8 : selectedEntity.typeId === 'awacs' ? 450 : selectedEntity.typeId === 'radar' ? 400 : 250
          ));
      if (detectionRadiusKm > 0) {
        const detectCoords = geodesicRing(selectedEntity.lngLat, detectionRadiusKm, 64);
        envelopeFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [detectCoords] },
          properties: {
            color: '#4FC3F7',
            fillOpacity: 0.08,
            lineWidth: 1.5,
            label: isGround
              ? `🔭 ${selectedEntity.name} Optic Horizon (${detectionRadiusKm} km)`
              : isNaval
                ? `📡 ${selectedEntity.name} Air Search Radar (${detectionRadiusKm} km)`
                : `📡 ${selectedEntity.name} Sensor Horizon (${detectionRadiusKm} km)`,
          },
        });
      }

      // 2. Surface Search / Clipped Horizon Envelope (For Naval Surface Assets)
      if (isNaval && selectedEntity.typeId !== 'submarine') {
        const antennaM = spec?.sensor?.antennaM ?? 25;
        const surfaceHorizonKm = Math.round(radarHorizonKm(antennaM, 25));
        if (surfaceHorizonKm > 0 && surfaceHorizonKm < detectionRadiusKm) {
          const surfCoords = geodesicRing(selectedEntity.lngLat, surfaceHorizonKm, 64);
          envelopeFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [surfCoords] },
            properties: {
              color: '#00E5FF',
              fillOpacity: 0.12,
              lineWidth: 1.8,
              label: `🌊 ${selectedEntity.name} Surface Horizon (${surfaceHorizonKm} km)`,
            },
          });
        }
      }

      // 2. Weapon Engagement Envelope (Displayed ONLY when a particular weapon is clicked)
      const weapons = (selectedEntity.customWeapons && selectedEntity.customWeapons.length > 0)
        ? selectedEntity.customWeapons
        : (spec?.weapons || []);

      if (activeWeaponIndex !== null && activeWeaponIndex !== undefined && weapons[activeWeaponIndex]) {
        const weapon = weapons[activeWeaponIndex];
        const weaponRangeKm = weapon.rangeKm;
        if (weaponRangeKm > 0) {
          const engageCoords = geodesicRing(selectedEntity.lngLat, weaponRangeKm, 64);
          envelopeFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [engageCoords] },
            properties: {
              color: '#FF9800',
              fillOpacity: 0.12,
              lineWidth: 2,
              label: `⚔️ ${weapon.name || 'Munition'} Range (${weaponRangeKm} km)`,
            },
          });
        }
      }
    }
  }

  (map.getSource(SRC_ENVELOPES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: envelopeFeatures,
  });

  // 1. Render Bases with distinct iconography (Filtered to sovereign bases)
  const basesFeatures = session.bases.map((b) => {
    const icon =
      b.type === 'airbase'
        ? '🛫'
        : b.type === 'naval_base'
          ? '⚓'
          : b.type === 'carrier_group'
            ? '🚢'
            : b.type === 'silo_complex'
              ? '🚀'
              : '🛡️';

    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: b.lngLat },
      properties: {
        id: b.id,
        name: `${icon} ${b.name}`,
        color: b.iso === session.playerIso ? session.playerColor : session.enemyColor,
      },
    };
  });
  (map.getSource(SRC_BASES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: basesFeatures,
  });

  // 2. Render Friendly Entities (In Flight / Patrol / Deployed) with NATO Tactical Chip Icons
  const friendlyEntities = session.entities.filter(
    (e) =>
      e.iso === factionIso &&
      e.status !== 'destroyed' &&
      e.status !== 'docked' &&
      e.status !== 'turnaround' &&
      e.status !== 'in_repair'
  );

  const iconSpecs: IconSpec[] = [];
  const entityFeatures = friendlyEntities.map((e) => {
    const isSelected = e.id === selectedEntityId;
    const spec = simEntityIconSpec(e, factionColor);
    iconSpecs.push(spec);
    const iconId = unitIconId(spec.typeId, spec.mark, spec.color);

    const isStaticAD = isStaticAirDefense(e.typeId);
    const isGround = isGroundCombatUnit(e.typeId);
    const isTanker = e.typeId === 'tanker' || e.name.toLowerCase().includes('tanker');
    const cleanName = e.name.replace(/^\d+\s*[×x]\s*/i, '');
    const statusText =
      isStaticAD
        ? 'AIR DEFENSE'
        : e.status === 'aar_refueling'
          ? '⛽ REFUELING'
          : e.status === 'aar_rendezvous'
            ? '⛽ AAR JOIN-UP'
            : isTanker && e.status === 'on_station'
              ? '⛽ AAR ANCHOR'
              : e.status === 'on_station'
                ? (isGround ? 'ENTRENCHED' : 'PATROL')
                : e.status === 'takeoff_ingress'
                  ? (isGround ? 'MARCHING' : 'INGRESS')
                  : e.status === 'bingo_rtb'
                    ? 'RTB'
                    : e.status.toUpperCase();

    const label = isStaticAD
      ? `${e.count > 1 ? `${e.count} × ` : ''}${cleanName} [AIR DEFENSE]`
      : isGround
        ? `${e.count > 1 ? `${e.count} × ` : ''}${cleanName} [${statusText}]`
        : isTanker && e.status === 'on_station'
          ? `${cleanName} [${statusText}] ${(e.tankerState?.offloadRemainingKg ?? 40000).toLocaleString()} kg Avail`
          : `${e.count > 1 ? `${e.count} × ` : ''}${cleanName} [${statusText}] ${e.currentFuelPct.toFixed(0)}%`;

    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: e.lngLat },
      properties: {
        id: e.id,
        selected: isSelected,
        icon: iconId,
        label,
        color: e.status === 'aar_refueling' || e.status === 'aar_rendezvous' ? '#00E5FF' : factionColor,
      },
    };
  });

  ensureIcons(map, iconSpecs);

  (map.getSource(SRC_ENTITIES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: entityFeatures,
  });

  // 3. Render Patrol Rings, AAR Anchor Racetracks & Multi-Waypoint Flight Corridors
  const patrolFeatures: GeoJSON.Feature[] = [];
  friendlyEntities.forEach((e) => {
    const isTanker = e.typeId === 'tanker' || e.name.toLowerCase().includes('tanker');

    // AAR Tanker Anchor Track Racetrack Rendering
    if (isTanker && e.status === 'on_station') {
      const anchorCenter = e.patrolOrder?.centerLngLat || e.lngLat;
      const lengthKm = e.tankerState?.orbitLengthKm ?? 80;
      const headingDeg = e.tankerState?.orbitHeadingDeg ?? 90;
      const racetrackCoords = generateAarRacetrackCoordinates(anchorCenter, lengthKm, 15, headingDeg);

      patrolFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [racetrackCoords] },
        properties: { color: '#00E5FF' },
      });
      return;
    }

    // Active AAR Umbilical Link Line (Receiver <-> Tanker)
    if (e.status === 'aar_refueling' && e.refuelingState?.tankerEntityId) {
      const tanker = session.entities.find((t) => t.id === e.refuelingState?.tankerEntityId);
      if (tanker) {
        patrolFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [tanker.lngLat, e.lngLat] },
          properties: { color: '#00E5FF' },
        });
      }
    }

    // AAR Rendezvous Ingress Vector
    if (e.status === 'aar_rendezvous' && e.refuelingState?.tankerEntityId) {
      const tanker = session.entities.find((t) => t.id === e.refuelingState?.tankerEntityId);
      if (tanker) {
        patrolFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [e.lngLat, tanker.lngLat] },
          properties: { color: '#00E5FF' },
        });
      }
    }

    if (e.patrolOrder && (e.status === 'on_station' || e.status === 'takeoff_ingress')) {
      if (e.patrolOrder.routeType === 'waypoints' && e.patrolOrder.waypoints && e.patrolOrder.waypoints.length >= 2) {
        // Multi-waypoint route line corridor
        patrolFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: e.patrolOrder.waypoints },
          properties: { color: factionColor },
        });
        // Waypoint dots
        e.patrolOrder.waypoints.forEach((wp) => {
          patrolFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: wp },
            properties: { color: factionColor },
          });
        });
      } else if (e.patrolOrder.patrolRadiusKm > 0) {
        const ringCoords = geodesicRing(e.patrolOrder.centerLngLat, e.patrolOrder.patrolRadiusKm);
        patrolFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ringCoords] },
          properties: { color: factionColor },
        });
      }
    }

    if (e.status === 'engaging' && e.strikePlan?.attackWaypoints && e.strikePlan.attackWaypoints.length > 0) {
      const remainingWps = e.strikePlan.attackWaypoints.slice(e.strikePlan.currentWaypointIdx ?? 0);
      const routeCoords = [e.lngLat, ...remainingWps, e.strikePlan.targetLngLat];
      patrolFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: routeCoords },
        properties: { color: '#FF9800' },
      });
      remainingWps.forEach((wp, idx) => {
        patrolFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: wp },
          properties: { color: '#FF9800' },
        });
      });
    }
  });
  (map.getSource(SRC_PATROLS) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: patrolFeatures,
  });

  // 4. Render Fog of War Contacts
  const contacts = isPlayer
    ? session.fogOfWarContacts.playerContacts
    : session.fogOfWarContacts.enemyContacts;

  const contactFeatures = contacts.map((c) => {
    const isTier2 = c.intelTier === 2;
    const isSelected = c.contactId === selectedContactId;
    let iconId: string | undefined = undefined;
    let label = '';

    if (isTier2) {
      const targetEntity = session.entities.find((e) => e.id === c.targetEntityId);
      const iconColor = isPlayer ? session.enemyColor : session.playerColor;
      let spec: IconSpec;

      if (targetEntity) {
        spec = simEntityIconSpec(targetEntity, iconColor);
      } else {
        const mappedKey =
          c.domain === 'air'
            ? 'fighter'
            : c.domain === 'sea'
              ? 'destroyer'
              : c.domain === 'sub'
                ? 'submarine'
                : c.domain === 'site'
                  ? 'silo'
                  : 'infantry';
        const typeDef = UNIT_BY_ID.get(mappedKey) ?? UNIT_BY_ID.get('infantry')!;
        spec = {
          typeId: typeDef.id,
          glyph: typeDef.glyph,
          domain: typeDef.domain,
          color: iconColor,
          mark: { kind: 'text', text: `${c.knownCount ?? 1}×` },
        };
      }
      iconSpecs.push(spec);
      iconId = unitIconId(spec.typeId, spec.mark, spec.color);

      const cleanName = (c.knownName || targetEntity?.name || 'Enemy Unit').replace(/^\d+\s*[×x]\s*/i, '');
      const count = c.knownCount ?? (targetEntity?.count ?? 1);
      label = `${count > 1 ? `${count} × ` : ''}${cleanName}`;
    } else {
      label = `⚠️ UNKNOWN ${c.domain.toUpperCase()} [?]`;
    }

    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: c.lastKnownLngLat },
      properties: {
        id: c.contactId,
        selected: isSelected,
        tier: c.intelTier,
        icon: iconId,
        label,
        color: isTier2 ? (isPlayer ? session.enemyColor : session.playerColor) : '#FFB020',
      },
    };
  });

  // Ensure all NATO icon badges (for both friendly units and PID Tier 2 enemy contacts) are registered in MapLibre
  ensureIcons(map, iconSpecs);

  (map.getSource(SRC_CONTACTS) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: contactFeatures,
  });

  // 5. Render Active Missiles
  ensurePlaybackIcons(map);
  const missileFeatures: GeoJSON.Feature[] = [];
  session.activeMissiles.forEach((m) => {
    // Only render on map once launched and not intercepted
    if (session.simTimeSec < m.startSimTimeSec || m.isIntercepted || m.progress <= 0) return;

    const bearing = bearingDeg(m.originLngLat, m.targetLngLat);
    const isDefensive = m.weaponCategory === 'sam' || m.weaponCategory === 'air_to_air';
    const icon = isDefensive ? 'wg-icon-interceptor' : 'wg-icon-missile';
    const trackColor = isDefensive ? '#00E5FF' : '#FF5252';

    // Missile line trajectory
    missileFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [m.originLngLat, m.currentLngLat] },
      properties: {
        color: trackColor,
      },
    });
    // Missile warhead tip with rotating playback vector icon & label
    missileFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: m.currentLngLat },
      properties: {
        icon,
        bearing,
        label: `${m.weaponName} (${m.speedKmh.toFixed(0)} km/h)`,
      },
    });
  });
  (map.getSource(SRC_MISSILES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: missileFeatures,
  });

  // 6. Render Space Layer: Satellites, Orbital Ground Tracks & Sensor Swaths
  const satellites = session.satellites || [];
  const satelliteFeatures: GeoJSON.Feature[] = [];

  satellites.forEach((sat) => {
    if (sat.status === 'destroyed') return;

    const isSatFriendly = sat.faction === activeFaction;
    const satColor = isSatFriendly ? '#FFD54F' : '#FF5252';
    const swathColor = isSatFriendly ? '#00E5FF' : '#FF5252';

    // 6a. Orbital Ground-Track Linestring
    if (sat.groundTrack && sat.groundTrack.length > 1) {
      satelliteFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: sat.groundTrack },
        properties: {
          kind: 'groundtrack',
          color: satColor,
        },
      });
    }

    // 6b. Dynamic Sensor Swath Footprint Polygon
    if (sat.groundSwathPolygon && sat.groundSwathPolygon.length > 2) {
      satelliteFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [sat.groundSwathPolygon] },
        properties: {
          kind: 'swath',
          swathColor,
        },
      });
    }

    // 6c. Satellite Orbital Marker & Label
    satelliteFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: sat.currentLngLat },
      properties: {
        kind: 'satellite',
        id: sat.id,
        name: sat.name,
        color: satColor,
        label: `🛰️ ${sat.name} [${sat.sensorType.toUpperCase()} ${sat.altitudeKm}km]`,
      },
    });
  });

  (map.getSource(SRC_SATELLITES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: satelliteFeatures,
  });
}

/**
 * Updates the live interactive flight corridor, hostile SAM threat bubbles,
 * and waypoint doglegs on the map in real-time as the user plans a mission.
 */
export function updateWarSimPatrolPreview(
  map: MLMap,
  targetPicking?: {
    mode: 'sortie' | 'place_autonomous' | 'place_base' | 'strike_route';
    originLngLat?: [number, number];
    maxRangeKm?: number;
    patrolRadiusKm?: number;
    routeType?: 'orbit' | 'waypoints';
    pickedWaypoints?: [number, number][];
  } | null,
  cursor?: [number, number] | null,
  session?: WarSimSession | null,
  systemsLibrary: SystemSpec[] = []
) {
  const source = map.getSource(SRC_PATROL_PREVIEW) as GeoJSONSource | undefined;
  if (!source) return;

  if (!targetPicking || (targetPicking.mode !== 'sortie' && targetPicking.mode !== 'strike_route')) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const isStrikeRoute = targetPicking.mode === 'strike_route';
  const isCustomRoute = targetPicking.routeType === 'waypoints' || isStrikeRoute;
  const picked = targetPicking.pickedWaypoints ?? [];
  const themeColor = isStrikeRoute ? '#FF9800' : '#4FC3F7';
  const features: GeoJSON.Feature[] = [];

  // 1. Gather and render all Known Hostile SAM & Radar Threat Envelopes
  const threatZones = session ? getKnownHostileThreatZones(session, systemsLibrary) : [];
  threatZones.forEach((zone) => {
    // 1a. Lethal SAM Engagement Ring (Red / Orange)
    if (zone.samRangeKm > 0) {
      const ringCoords = geodesicRing(zone.lngLat, zone.samRangeKm, 48);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ringCoords] },
        properties: {
          color: zone.color,
          fillOpacity: 0.14,
          lineWidth: 1.8,
        },
      });

      // Label at top edge of SAM envelope
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [zone.lngLat[0], zone.lngLat[1] + (zone.samRangeKm / 111.0)] },
        properties: {
          color: zone.color,
          label: `⚠️ ${zone.name} [SAM ${zone.samRangeKm}km]`,
        },
      });
    }

    // 1b. Early Warning Radar Search Envelope (Translucent Yellow)
    if (zone.radarRangeKm > (zone.samRangeKm + 30) && zone.radarRangeKm > 75) {
      const radarCoords = geodesicRing(zone.lngLat, zone.radarRangeKm, 48);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [radarCoords] },
        properties: {
          color: '#FFD54F',
          fillOpacity: 0.04,
          lineWidth: 1.0,
        },
      });
    }
  });

  if (isCustomRoute) {
    // Assemble full flight corridor path
    const origin = targetPicking.originLngLat;
    const fullPath: [number, number][] = [];
    if (origin) fullPath.push(origin);
    fullPath.push(...picked);

    // Evaluate threats along the corridor
    const corridorEval = evaluateFlightCorridor(fullPath, threatZones, 900);

    // 2. Render Placed Waypoint Markers & Leg Lines
    let cumulativeDistKm = 0;
    for (let i = 0; i < fullPath.length; i++) {
      const pt = fullPath[i];
      const isOrigin = i === 0 && origin !== undefined;
      const wpIdx = isOrigin ? 0 : (origin ? i : i + 1);

      if (i > 0) {
        const legDist = distanceKm(fullPath[i - 1], pt);
        cumulativeDistKm += legDist;
      }

      const cumFlightMin = Math.round((cumulativeDistKm / 900) * 60);

      // Waypoint Point Marker
      let markerLabel = '';
      if (isOrigin) {
        markerLabel = '🛫 INGRESS START';
      } else if (isStrikeRoute && i === fullPath.length - 1 && picked.length > 0) {
        markerLabel = `🎯 WP-${wpIdx} (${cumulativeDistKm.toFixed(0)}km · ${cumFlightMin}m)`;
      } else {
        markerLabel = `WP-${wpIdx} (${cumulativeDistKm.toFixed(0)}km · ${cumFlightMin}m)`;
      }

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt },
        properties: {
          color: isOrigin ? '#00E676' : themeColor,
          label: markerLabel,
        },
      });
    }

    // 3. Render Flight Path Leg Lines Color-Coded by Threat
    corridorEval.legs.forEach((leg) => {
      const legColor =
        leg.threatLevel === 'danger'
          ? '#FF5252'
          : leg.threatLevel === 'caution'
            ? '#FFD54F'
            : isStrikeRoute ? '#FF9800' : '#00E676';

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [leg.from, leg.to],
        },
        properties: {
          color: legColor,
          lineWidth: 3.0,
        },
      });

      // Threat annotation at leg midpoint if penetrated
      if (leg.threatLevel === 'danger' && leg.penetratingThreats.length > 0) {
        const midPoint: [number, number] = [
          (leg.from[0] + leg.to[0]) / 2,
          (leg.from[1] + leg.to[1]) / 2,
        ];
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: midPoint },
          properties: {
            color: '#FF5252',
            label: `⚠️ LETHAL SAM ZONE (${leg.distanceKm.toFixed(0)}km)`,
          },
        });
      }
    });

    // 4. Dynamic Cursor Ingress Line
    if (cursor) {
      const lastPoint = fullPath.length > 0 ? fullPath[fullPath.length - 1] : origin;
      if (lastPoint) {
        const cursorLegDist = distanceKm(lastPoint, cursor);
        const cursorFlightMin = Math.round((cursorLegDist / 900) * 60);

        // Check if cursor leg penetrates hostile SAM
        const cursorEval = evaluateFlightCorridor([lastPoint, cursor], threatZones, 900);
        const cursorColor =
          cursorEval.threatLevel === 'danger'
            ? '#FF5252'
            : cursorEval.threatLevel === 'caution'
              ? '#FFD54F'
              : '#00E676';

        // Prospective Waypoint Marker at Cursor
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: cursor },
          properties: {
            color: cursorColor,
            label: `+${cursorLegDist.toFixed(0)}km (${cursorFlightMin}m) ${cursorEval.threatLevel === 'danger' ? '⚠️ DANGER' : ''}`,
          },
        });

        // Dynamic connecting line
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [lastPoint, cursor],
          },
          properties: {
            color: cursorColor,
            lineWidth: 2.0,
          },
        });
      }
    }

    source.setData({ type: 'FeatureCollection', features });
    return;
  }

  // Circular Orbit Mode
  if (!cursor) {
    source.setData({ type: 'FeatureCollection', features });
    return;
  }

  const patrolRadiusKm = targetPicking.patrolRadiusKm ?? 15;
  const isOutOfRange =
    targetPicking.originLngLat && targetPicking.maxRangeKm
      ? distanceKm(targetPicking.originLngLat, cursor) > targetPicking.maxRangeKm
      : false;

  const color = isOutOfRange ? '#FF5252' : '#4FC3F7';

  // 1. Center Station Point
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: cursor },
    properties: { color, label: `ORBIT CENTER (${patrolRadiusKm}km)` },
  });

  // 2. Loiter / Holding Orbit Preview Ring
  if (patrolRadiusKm > 0) {
    const orbitCoords = geodesicRing(cursor, patrolRadiusKm, 64);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [orbitCoords] },
      properties: {
        color,
        fillOpacity: isOutOfRange ? 0.08 : 0.16,
        lineWidth: 2,
      },
    });
  }

  source.setData({
    type: 'FeatureCollection',
    features,
  });
}

export function removeWarSimLayers(map: MLMap) {
  const layerIds = [
    LYR_MISSILES_LABEL,
    LYR_MISSILES_SYMBOL,
    LYR_MISSILES_HEAD,
    LYR_MISSILES_LINE,
    LYR_CONTACTS_SYMBOL,
    LYR_CONTACTS_LABEL,
    LYR_CONTACTS_CIRCLE,
    LYR_CONTACTS_HALO,
    LYR_ENTITIES_SYMBOL,
    LYR_ENTITIES_MARKER,
    LYR_ENTITIES_HALO,
    LYR_PATROLS_LINE,
    LYR_BASES_LABEL,
    LYR_BASES_CIRCLE,
    LYR_REACH_RING_LINE,
    LYR_REACH_RING_FILL,
    LYR_PATROL_PREVIEW_CENTER,
    LYR_PATROL_PREVIEW_LABEL,
    LYR_PATROL_PREVIEW_LINE,
    LYR_PATROL_PREVIEW_FILL,
    LYR_ENVELOPES_LINE,
    LYR_ENVELOPES_FILL,
    LYR_SATELLITES_LABEL,
    LYR_SATELLITES_MARKER,
    LYR_SATELLITES_SWATH_LINE,
    LYR_SATELLITES_SWATH_FILL,
    LYR_SATELLITES_GROUNDTRACK,
  ];
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });

  const sourceIds = [
    SRC_MISSILES,
    SRC_CONTACTS,
    SRC_ENTITIES,
    SRC_PATROLS,
    SRC_BASES,
    SRC_REACH_RING,
    SRC_PATROL_PREVIEW,
    SRC_ENVELOPES,
    SRC_SATELLITES,
  ];
  sourceIds.forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });
}
