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
import { type SystemSpec } from './specs';
import { geodesicRing, greatCirclePath } from './geo';
import { ensureIcons, unitIconId, type IconSpec } from './unitIcons';
import { UNIT_BY_ID, type EchelonMark } from './warGames';
import { isGroundCombatUnit } from './warSimRules';

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

const LYR_BASES_CIRCLE = 'warsim-bases-circle';
const LYR_BASES_LABEL = 'warsim-bases-label';
const LYR_ENTITIES_HALO = 'warsim-entities-halo';
const LYR_ENTITIES_SYMBOL = 'warsim-entities-symbol';
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
      'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
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
  systemsLibrary: SystemSpec[] = [],
  activeWeaponIndex?: number | null,
  showAllEnvelopes: boolean = false
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
      // Sensor horizon envelope
      const detectionRadiusKm = spec?.sensor?.detectionKm ?? (
        isGround ? 8 : e.typeId === 'awacs' ? 450 : e.typeId === 'radar' ? 400 : 200
      );
      if (detectionRadiusKm > 0) {
        const detectCoords = geodesicRing(e.lngLat, detectionRadiusKm, 48);
        envelopeFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [detectCoords] },
          properties: {
            color: '#4FC3F7',
            fillOpacity: isSelected ? 0.12 : 0.04,
            lineWidth: isSelected ? 1.8 : 1.0,
            label: isGround ? `🔭 ${e.name} (${detectionRadiusKm} km)` : `📡 ${e.name} (${detectionRadiusKm} km)`,
          },
        });
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

      // 1. Detection / Sensor Horizon Envelope (Always on for selected entity)
      const detectionRadiusKm = spec?.sensor?.detectionKm ?? (
        isGround ? 8 : selectedEntity.typeId === 'awacs' ? 450 : selectedEntity.typeId === 'radar' ? 400 : 250
      );
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
              : `📡 ${selectedEntity.name} Sensor Horizon (${detectionRadiusKm} km)`,
          },
        });
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

    const isGround = isGroundCombatUnit(e.typeId);
    const cleanName = e.name.replace(/^\d+\s*[×x]\s*/i, '');
    const statusText =
      e.status === 'on_station'
        ? (isGround ? 'ENTRENCHED' : 'PATROL')
        : e.status === 'takeoff_ingress'
          ? (isGround ? 'MARCHING' : 'INGRESS')
          : e.status === 'bingo_rtb'
            ? 'RTB'
            : e.status.toUpperCase();

    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: e.lngLat },
      properties: {
        id: e.id,
        selected: isSelected,
        icon: iconId,
        label: `${e.count > 1 ? `${e.count} × ` : ''}${cleanName} [${statusText}] ${e.currentFuelPct.toFixed(0)}%`,
        color: factionColor,
      },
    };
  });

  ensureIcons(map, iconSpecs);

  (map.getSource(SRC_ENTITIES) as GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: entityFeatures,
  });

  // 3. Render Patrol Rings
  const patrolFeatures: GeoJSON.Feature[] = [];
  friendlyEntities.forEach((e) => {
    if (e.patrolOrder && (e.status === 'on_station' || e.status === 'takeoff_ingress') && e.patrolOrder.patrolRadiusKm > 0) {
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
    LYR_ENTITIES_SYMBOL,
    LYR_ENTITIES_HALO,
    LYR_PATROLS_LINE,
    LYR_BASES_LABEL,
    LYR_BASES_CIRCLE,
    LYR_REACH_RING_LINE,
    LYR_REACH_RING_FILL,
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
