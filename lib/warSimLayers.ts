/**
 * War Simulation MapLibre GL Layers & Live Visual Renderers
 *
 * Manages live GeoJSON sources and layers for:
 * 1. Sovereign Base installations (Airbases, Naval Ports, Army HQs, Silos).
 * 2. Active Friendly Units (Kinematic positions, headings, fuel status).
 * 3. Fog-of-War Contact Blips (Tier 1 Sensor Tracks vs. Tier 2 PID units).
 * 4. Patrol Orbit Rings & Ingress Trajectories.
 * 5. In-flight Missiles and Interceptors.
 * 6. Combat Radius Reach Rings during target selection.
 */

import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type DetectedContact,
  type MissileFlyoutTrack,
} from './warSimTypes';
import { geodesicRing, greatCirclePath } from './geo';

const SRC_BASES = 'warsim-bases-src';
const SRC_ENTITIES = 'warsim-entities-src';
const SRC_CONTACTS = 'warsim-contacts-src';
const SRC_PATROLS = 'warsim-patrols-src';
const SRC_MISSILES = 'warsim-missiles-src';
const SRC_REACH_RING = 'warsim-reach-ring-src';

const LYR_REACH_RING_FILL = 'warsim-reach-ring-fill';
const LYR_REACH_RING_LINE = 'warsim-reach-ring-line';
const LYR_BASES_CIRCLE = 'warsim-bases-circle';
const LYR_BASES_LABEL = 'warsim-bases-label';
const LYR_ENTITIES_CIRCLE = 'warsim-entities-circle';
const LYR_ENTITIES_LABEL = 'warsim-entities-label';
const LYR_CONTACTS_CIRCLE = 'warsim-contacts-circle';
const LYR_CONTACTS_LABEL = 'warsim-contacts-label';
const LYR_PATROLS_LINE = 'warsim-patrols-line';
const LYR_MISSILES_LINE = 'warsim-missiles-line';
const LYR_MISSILES_HEAD = 'warsim-missiles-head';

export function installWarSimLayers(map: MLMap) {
  if (map.getSource(SRC_BASES)) return;

  // 0. Reach Ring (Combat Radius Reach) Source & Layers
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
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
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

  // 3. Friendly Entities Source & Layers
  map.addSource(SRC_ENTITIES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_ENTITIES_CIRCLE,
    type: 'circle',
    source: SRC_ENTITIES,
    paint: {
      'circle-radius': 6.5,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#070C14',
    },
  });

  map.addLayer({
    id: LYR_ENTITIES_LABEL,
    type: 'symbol',
    source: SRC_ENTITIES,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, -1.3],
      'text-anchor': 'bottom',
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': '#070C14',
      'text-halo-width': 1.5,
    },
  });

  // 4. Fog of War Contacts Source & Layers
  map.addSource(SRC_CONTACTS, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LYR_CONTACTS_CIRCLE,
    type: 'circle',
    source: SRC_CONTACTS,
    paint: {
      'circle-radius': 7.5,
      'circle-color': ['case', ['==', ['get', 'tier'], 2], '#D9534F', '#FFB020'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  map.addLayer({
    id: LYR_CONTACTS_LABEL,
    type: 'symbol',
    source: SRC_CONTACTS,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'tier'], 2], '#D9534F', '#FFB020'],
      'text-halo-color': '#070C14',
      'text-halo-width': 1.5,
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
    paint: {
      'circle-radius': 4,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#FF5252',
      'circle-stroke-width': 2,
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
    mode: 'sortie' | 'place_autonomous' | 'place_base';
    originLngLat?: [number, number];
    maxRangeKm?: number;
  } | null
) {
  if (!map.getSource(SRC_BASES)) {
    installWarSimLayers(map);
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

  // 1. Render Bases with distinct iconography
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

  // 2. Render Friendly Entities (In Flight / Patrol / Deployed)
  const friendlyEntities = session.entities.filter(
    (e) => e.iso === factionIso && e.status !== 'destroyed' && e.status !== 'docked'
  );
  const entityFeatures = friendlyEntities.map((e) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: e.lngLat },
    properties: {
      id: e.id,
      label: `${e.name} [${e.status.replace('_', ' ').toUpperCase()}] ${e.currentFuelPct.toFixed(0)}%`,
      color: factionColor,
    },
  }));
  (map.getSource(SRC_ENTITIES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: entityFeatures,
  });

  // 3. Render Patrol Rings
  const patrolFeatures: GeoJSON.Feature[] = [];
  friendlyEntities.forEach((e) => {
    if (e.patrolOrder && (e.status === 'on_station' || e.status === 'takeoff_ingress')) {
      const ringCoords = geodesicRing(e.patrolOrder.centerLngLat, e.patrolOrder.patrolRadiusKm);
      patrolFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ringCoords] },
        properties: { color: factionColor },
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

  const contactFeatures = contacts.map((c) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: c.lastKnownLngLat },
    properties: {
      id: c.contactId,
      tier: c.intelTier,
      label: c.intelTier === 2 ? `🎯 ${c.knownName} (${c.knownCount ?? 1}x)` : `⚠️ UNKNOWN ${c.domain.toUpperCase()} [?]`,
    },
  }));
  (map.getSource(SRC_CONTACTS) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: contactFeatures,
  });

  // 5. Render Missiles
  const missileFeatures: GeoJSON.Feature[] = [];
  session.activeMissiles.forEach((m) => {
    const path = greatCirclePath(m.originLngLat, m.currentLngLat, 20);
    missileFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path },
      properties: {},
    });
    missileFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: m.currentLngLat },
      properties: {},
    });
  });
  (map.getSource(SRC_MISSILES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: missileFeatures,
  });
}

export function removeWarSimLayers(map: MLMap) {
  const layerIds = [
    LYR_MISSILES_HEAD,
    LYR_MISSILES_LINE,
    LYR_CONTACTS_LABEL,
    LYR_CONTACTS_CIRCLE,
    LYR_ENTITIES_LABEL,
    LYR_ENTITIES_CIRCLE,
    LYR_PATROLS_LINE,
    LYR_BASES_LABEL,
    LYR_BASES_CIRCLE,
    LYR_REACH_RING_LINE,
    LYR_REACH_RING_FILL,
  ];
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });

  const sourceIds = [SRC_MISSILES, SRC_CONTACTS, SRC_ENTITIES, SRC_PATROLS, SRC_BASES, SRC_REACH_RING];
  sourceIds.forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });
}
