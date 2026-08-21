/**
 * War Simulation MapLibre GL Layers & Live Visual Renderers
 *
 * Manages live GeoJSON sources and layers for:
 * 1. Sovereign Base installations (Airbases, Naval Ports, Army HQs, Silos) with distinct icons.
 * 2. Active Friendly Units with relatable military icons (✈️, 🚢, 🚁, 🛸, 🚀, 🛡️, ⛽).
 * 3. Selected Unit Multi-Envelopes (Detection Horizon, Engagement Radius, Combat Radius).
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
import { type SystemSpec } from './specs';
import { geodesicRing, greatCirclePath } from './geo';

const SRC_BASES = 'warsim-bases-src';
const SRC_ENTITIES = 'warsim-entities-src';
const SRC_CONTACTS = 'warsim-contacts-src';
const SRC_PATROLS = 'warsim-patrols-src';
const SRC_MISSILES = 'warsim-missiles-src';
const SRC_REACH_RING = 'warsim-reach-ring-src';
const SRC_ENVELOPES = 'warsim-envelopes-src';

const LYR_REACH_RING_FILL = 'warsim-reach-ring-fill';
const LYR_REACH_RING_LINE = 'warsim-reach-ring-line';
const LYR_ENVELOPES_FILL = 'warsim-envelopes-fill';
const LYR_ENVELOPES_LINE = 'warsim-envelopes-line';
const LYR_ENVELOPES_LABEL = 'warsim-envelopes-label';

const LYR_BASES_CIRCLE = 'warsim-bases-circle';
const LYR_BASES_LABEL = 'warsim-bases-label';
const LYR_ENTITIES_HALO = 'warsim-entities-halo';
const LYR_ENTITIES_CIRCLE = 'warsim-entities-circle';
const LYR_ENTITIES_LABEL = 'warsim-entities-label';
const LYR_CONTACTS_CIRCLE = 'warsim-contacts-circle';
const LYR_CONTACTS_LABEL = 'warsim-contacts-label';
const LYR_PATROLS_LINE = 'warsim-patrols-line';
const LYR_MISSILES_LINE = 'warsim-missiles-line';
const LYR_MISSILES_HEAD = 'warsim-missiles-head';

export function getSimUnitIcon(typeId: string): string {
  switch (typeId) {
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

export function installWarSimLayers(map: MLMap) {
  if (map.getSource(SRC_BASES)) return;

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

  // 0.1. Unit Envelopes (Detection, Engagement, Combat Radius)
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

  map.addLayer({
    id: LYR_ENVELOPES_LABEL,
    type: 'symbol',
    source: SRC_ENVELOPES,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, -1],
      'text-anchor': 'bottom',
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': '#070C14',
      'text-halo-width': 1.5,
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
    id: LYR_ENTITIES_HALO,
    type: 'circle',
    source: SRC_ENTITIES,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': 13,
      'circle-color': '#4FC3F7',
      'circle-opacity': 0.25,
      'circle-stroke-color': '#4FC3F7',
      'circle-stroke-width': 2,
    },
  });

  map.addLayer({
    id: LYR_ENTITIES_CIRCLE,
    type: 'circle',
    source: SRC_ENTITIES,
    paint: {
      'circle-radius': 7.5,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#070C14',
    },
  });

  map.addLayer({
    id: LYR_ENTITIES_LABEL,
    type: 'symbol',
    source: SRC_ENTITIES,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 10.5,
      'text-offset': [0, -1.4],
      'text-anchor': 'bottom',
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': '#070C14',
      'text-halo-width': 2,
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
  } | null,
  selectedEntityId?: string | null,
  systemsLibrary: SystemSpec[] = []
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

  // 0.1. Render Tactical Envelopes for Selected Entity (Detection, Engagement, Combat Radius)
  const envelopeFeatures: GeoJSON.Feature[] = [];
  const selectedEntity = session.entities.find((e) => e.id === selectedEntityId && e.status !== 'destroyed');

  if (selectedEntity) {
    const spec = systemsLibrary.find((s) => s.id === selectedEntity.systemId);

    // 1. Detection / Sensor Horizon Envelope
    const detectionRadiusKm = spec?.sensor?.detectionKm ?? (selectedEntity.typeId === 'awacs' ? 450 : selectedEntity.typeId === 'radar' ? 400 : 250);
    if (detectionRadiusKm > 0) {
      const detectCoords = geodesicRing(selectedEntity.lngLat, detectionRadiusKm, 64);
      envelopeFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [detectCoords] },
        properties: {
          color: '#4FC3F7',
          fillOpacity: 0.08,
          lineWidth: 1.5,
          label: `📡 ${selectedEntity.name} Detection Horizon (${detectionRadiusKm} km)`,
        },
      });
    }

    // 2. Weapon Engagement Envelope
    const maxWeaponRangeKm = spec?.weapons?.reduce((max, w) => Math.max(max, w.rangeKm), 0) ?? (selectedEntity.typeId === 'sam-launcher' ? 200 : selectedEntity.typeId === 'fighter' ? 120 : 0);
    if (maxWeaponRangeKm > 0) {
      const engageCoords = geodesicRing(selectedEntity.lngLat, maxWeaponRangeKm, 64);
      envelopeFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [engageCoords] },
        properties: {
          color: '#FF9800',
          fillOpacity: 0.1,
          lineWidth: 2,
          label: `⚔️ Engagement Envelope · ${spec?.weapons?.[0]?.name || 'Missiles'} (${maxWeaponRangeKm} km)`,
        },
      });
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

  // 2. Render Friendly Entities (In Flight / Patrol / Deployed) with Relatable Military Icons
  const friendlyEntities = session.entities.filter(
    (e) => e.iso === factionIso && e.status !== 'destroyed' && e.status !== 'docked'
  );
  const entityFeatures = friendlyEntities.map((e) => {
    const icon = getSimUnitIcon(e.typeId);
    const isSelected = e.id === selectedEntityId;

    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: e.lngLat },
      properties: {
        id: e.id,
        selected: isSelected,
        label: `${icon} ${e.name} [${e.status.replace('_', ' ').toUpperCase()}] ${e.currentFuelPct.toFixed(0)}%`,
        color: factionColor,
      },
    };
  });
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
    LYR_ENTITIES_HALO,
    LYR_PATROLS_LINE,
    LYR_BASES_LABEL,
    LYR_BASES_CIRCLE,
    LYR_REACH_RING_LINE,
    LYR_REACH_RING_FILL,
    LYR_ENVELOPES_LABEL,
    LYR_ENVELOPES_LINE,
    LYR_ENVELOPES_FILL,
  ];
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });

  const sourceIds = [SRC_MISSILES, SRC_CONTACTS, SRC_ENTITIES, SRC_PATROLS, SRC_BASES, SRC_REACH_RING, SRC_ENVELOPES];
  sourceIds.forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });
}
