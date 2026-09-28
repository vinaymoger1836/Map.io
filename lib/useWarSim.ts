'use client';

/**
 * War Simulation React State Hook & Engine Driver
 *
 * Manages the live simulation state loop, user commands, base stationing,
 * patrol dispatching, fog of war contact filtering, autonomous battery placement,
 * and session persistence.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type BaseType,
  type DetectedContact,
  type PostStrikeAction,
  type BattleOpsPlan,
  type BattleOpsPhase,
  type BattleOpsTask,
  type AirspaceRoeDoctrine,
} from './warSimTypes';
import { CARRIER_LOADOUT_PRESETS } from './carrierOps';
import { useSimulationRuntime } from './warsim/useSimulationRuntime';
import { type SystemThreatLevel } from './warSimTypes';
import { type SystemSpec, domainOf } from './specs';
import { isGroundCombatUnit } from './warSimRules';
import { removeWarSimLayers } from './warSimLayers';
import {
  getKnownHostileThreatZones,
  generateOptimalThreatAvoidanceRoute,
  evaluateFlightCorridor,
} from './threatAvoidance';

export interface TargetPickingState {
  mode: 'sortie' | 'place_autonomous' | 'place_base' | 'strike_route';
  entityId?: string;
  systemId?: string;
  count?: number;
  baseType?: BaseType;
  baseName?: string;
  originLngLat?: [number, number];
  maxRangeKm?: number;
  label?: string;
  patrolRadiusKm?: number;
  altitudeM?: number;
  emcon?: 'active' | 'passive';
  rcs?: number;
  customWeapons?: import('./specs').WeaponFacet[];
  routeType?: 'orbit' | 'waypoints';
  pickedWaypoints?: [number, number][];
  onCorridorConfirmed?: (waypoints: [number, number][]) => void;
  strikeParams?: {
    attackerEntityId: string;
    targetEntityId: string;
    targetLngLat: [number, number];
    weaponIndex: number;
    salvoCount: number;
    postStrikeAction: import('./warSimTypes').PostStrikeAction;
    customPostLngLat?: [number, number];
    sortieCount?: number;
    customWeapons?: import('./specs').WeaponFacet[];
    weaponsToFire?: import('./warSimTypes').WeaponSalvoItem[];
  };
}

export interface UseWarSimProps {
  initialSession: WarSimSession | null;
  systemsLibrary: SystemSpec[];
  mapRef: React.RefObject<MLMap | null>;
  onClose?: () => void;
}

export function useWarSim({
  initialSession,
  systemsLibrary: catalogue,
  mapRef,
  onClose,
}: UseWarSimProps) {
  const runtime = useSimulationRuntime(initialSession, catalogue);
  const { session, dispatch } = runtime;
  const systemsLibrary = runtime.definitions;
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [targetPicking, setTargetPicking] = useState<TargetPickingState | null>(null);
  const [activeWeaponIndex, setActiveWeaponIndex] = useState<number | null>(null);
  const [showAllEnvelopes, setShowAllEnvelopes] = useState<boolean>(false);
  const routeWasRunning = useRef(false);

  // Reset active weapon envelope preview when entity selection changes
  useEffect(() => {
    setActiveWeaponIndex(null);
  }, [selectedEntityId]);

  const sessionRef = useRef<WarSimSession | null>(session);
  sessionRef.current = session;

  // Sync internal session state from initialSession prop
  useEffect(() => {
    if (!initialSession) {
      setSelectedEntityId(null);
      setSelectedContactId(null);
      setSelectedBaseId(null);
      setTargetPicking(null);
      setActiveWeaponIndex(null);
      setShowAllEnvelopes(false);
    }
  }, [initialSession]);



  // -------------------------------------------------------------
  // User Commands & Actions
  // -------------------------------------------------------------

  const togglePlay = useCallback(() => {
    dispatch({ type: 'togglePlay', args: [] });
  }, []);

  const setSpeedMultiplier = useCallback((multiplier: number) => {
    dispatch({ type: 'setSpeedMultiplier', args: [multiplier] });
  }, []);

  const switchActiveFaction = useCallback(() => {
    dispatch({ type: 'switchActiveFaction', args: [] });
    setSelectedEntityId(null);
    setSelectedContactId(null);
    setSelectedBaseId(null);
    setTargetPicking(null);
  }, []);

  const deployUnitToBase = useCallback(
    (baseId: string, systemId: string, count: number) => {
      dispatch({ type: 'deployUnitToBase', args: [baseId, systemId, count] });
    },
    [systemsLibrary]
  );

  const deployAutonomousBattery = useCallback(
    (systemId: string, count: number, lngLat: [number, number]) => {
      dispatch({ type: 'deployAutonomousBattery', args: [systemId, count, lngLat] });
      setTargetPicking(null);
    },
    [systemsLibrary]
  );

  const orderSortieToPoint = useCallback(
    (
      entityId: string,
      targetLngLat: [number, number],
      patrolRadiusKm: number = 15,
      sortieCount?: number,
      altitudeM: number = 7000,
      emcon: 'active' | 'passive' = 'active',
      customWeapons?: import('./specs').WeaponFacet[],
      rcs?: number
    ) => {
      dispatch({ type: 'orderSortieToPoint', args: [entityId, targetLngLat, patrolRadiusKm, sortieCount, altitudeM, emcon, customWeapons, rcs] });
      setTargetPicking(null);
    },
    []
  );

  const orderRtb = useCallback(
    (entityId: string) => {
      dispatch({ type: 'orderRtb', args: [entityId] });
      setTargetPicking(null);
    },
    []
  );

  const orderStrike = useCallback(
    (
      attackerEntityId: string,
      targetEntityId: string,
      targetLngLat: [number, number],
      weaponIndex: number,
      salvoCount: number = 1,
      postStrikeAction: PostStrikeAction = 'rtb',
      customPostLngLat?: [number, number],
      sortieCount?: number,
      customWeapons?: import('./specs').WeaponFacet[],
      weaponsToFire?: import('./warSimTypes').WeaponSalvoItem[],
      attackWaypoints?: [number, number][]
    ) => {
      dispatch({ type: 'orderStrike', args: [attackerEntityId, targetEntityId, targetLngLat, weaponIndex, salvoCount, postStrikeAction, customPostLngLat, sortieCount, customWeapons, weaponsToFire, attackWaypoints] });
      setTargetPicking(null);
    },
    [systemsLibrary]
  );

  const createBaseAtLocation = useCallback(
    (name: string, type: BaseType, lngLat: [number, number]) => {
      dispatch({ type: 'createBaseAtLocation', args: [name, type, lngLat] });
      setTargetPicking(null);
    },
    []
  );

  const renameBase = useCallback(
    (baseId: string, newName: string) => {
      dispatch({ type: 'renameBase', args: [baseId, newName] });
    },
    []
  );

  const orderRefuelAtTanker = useCallback(
    (receiverEntityId: string, tankerEntityId?: string, targetFuelPct = 100) => {
      dispatch({ type: 'orderRefuelAtTanker', args: [receiverEntityId, tankerEntityId, targetFuelPct] });
    },
    [systemsLibrary]
  );

  const startSortiePicking = useCallback(
    (
      entity: SimEntity,
      options?: {
        count?: number;
        customWeapons?: import('./specs').WeaponFacet[];
        patrolRadiusKm?: number;
        altitudeM?: number;
        emcon?: 'active' | 'passive';
        routeType?: 'orbit' | 'waypoints';
        rcs?: number;
      }
    ) => {
      const spec = systemsLibrary.find((s) => s.id === entity.systemId);
      const isGround = isGroundCombatUnit(entity.typeId);
      const combatRadiusKm = spec?.platform?.combatRadiusKm ?? (entity.typeId === 'fighter' ? 900 : 1500);

      // Check if tanker support is present in theater (extends radius by +75%)
      const iso = entity.iso;
      const hasTanker = sessionRef.current?.entities.some(
        (e) => e.iso === iso && e.status === 'on_station' && e.typeId === 'tanker'
      );
      const effectiveRadiusKm = isGround
        ? (spec?.platform?.combatRadiusKm ? spec.platform.combatRadiusKm * 2 : 600)
        : (hasTanker ? combatRadiusKm * 1.75 : combatRadiusKm);

      const base = sessionRef.current?.bases.find((b) => b.id === entity.homeBaseId);
      const originLngLat = base?.lngLat ?? entity.lngLat;

      const taskCount = options?.count ?? entity.count;
      const cleanName = entity.name.replace(/^\d+\s*[×x]\s*/i, '');
      const routeType = options?.routeType ?? 'orbit';

      setTargetPicking({
        mode: 'sortie',
        entityId: entity.id,
        count: taskCount,
        originLngLat,
        maxRangeKm: effectiveRadiusKm,
        patrolRadiusKm: options?.patrolRadiusKm,
        altitudeM: options?.altitudeM,
        emcon: options?.emcon,
        rcs: options?.rcs,
        customWeapons: options?.customWeapons,
        routeType,
        pickedWaypoints: [],
        label: isGround
          ? `Click on map to deploy ${taskCount > 1 ? `${taskCount} × ` : ''}${cleanName} (Road Range: ${effectiveRadiusKm.toFixed(0)} km)`
          : routeType === 'waypoints'
            ? `Click on map to place Waypoint #1 for ${taskCount > 1 ? `${taskCount} × ` : ''}${cleanName} route`
            : `Select Patrol Point for ${taskCount > 1 ? `${taskCount} × ` : ''}${cleanName} (Max Range: ${effectiveRadiusKm.toFixed(0)} km${hasTanker ? ' with AAR Tanker' : ''})`,
      });
    },
    [systemsLibrary]
  );

  const startAutonomousPicking = useCallback(
    (systemId: string, count: number) => {
      const spec = systemsLibrary.find((s) => s.id === systemId);
      setTargetPicking({
        mode: 'place_autonomous',
        systemId,
        count,
        label: `Click on sovereign territory to erect ${count} × ${spec?.name ?? 'Battery'}`,
      });
    },
    [systemsLibrary]
  );

  // -------------------------------------------------------------
  // Filtered State per Active Perspective
  // -------------------------------------------------------------

  const activeFaction = session?.activeFaction ?? 'player';
  const activeCountryIso = activeFaction === 'player' ? session?.playerIso ?? 'US' : session?.enemyIso ?? 'RU';
  const activeCountryColor = activeFaction === 'player' ? session?.playerColor ?? '#4F9FD6' : session?.enemyColor ?? '#D9534F';

  const visibleContacts: DetectedContact[] = useMemo(() => {
    if (!session) return [];
    return activeFaction === 'player'
      ? session.fogOfWarContacts.playerContacts
      : session.fogOfWarContacts.enemyContacts;
  }, [session, activeFaction]);

  const friendlyEntities: SimEntity[] = useMemo(() => {
    if (!session) return [];
    return session.entities.filter((e) => e.iso === activeCountryIso && e.status !== 'destroyed');
  }, [session, activeCountryIso]);

  const friendlyBases: SimBase[] = useMemo(() => {
    if (!session) return [];
    return session.bases.filter((b) => b.iso === activeCountryIso);
  }, [session, activeCountryIso]);

  const selectedBase = useMemo(() => {
    return session?.bases.find((b) => b.id === selectedBaseId) ?? null;
  }, [session, selectedBaseId]);

  const selectedEntity = useMemo(() => {
    return session?.entities.find((e) => e.id === selectedEntityId) ?? null;
  }, [session, selectedEntityId]);

  const selectedContact = useMemo(() => {
    return visibleContacts.find((c) => c.contactId === selectedContactId) ?? null;
  }, [visibleContacts, selectedContactId]);

  // -------------------------------------------------------------
  // Target Picking Handlers (Sortie target, Base placement, SAM battery)
  // -------------------------------------------------------------

  const startStrikeRoutePicking = useCallback(
    (params: {
      attackerEntityId: string;
      targetEntityId: string;
      targetLngLat: [number, number];
      weaponIndex: number;
      salvoCount: number;
      postStrikeAction: PostStrikeAction;
      customPostLngLat?: [number, number];
      sortieCount?: number;
      customWeapons?: import('./specs').WeaponFacet[];
      weaponsToFire?: import('./warSimTypes').WeaponSalvoItem[];
    }) => {
      const attacker = session?.entities.find((e) => e.id === params.attackerEntityId);
      const targetEntity = session?.entities.find((e) => e.id === params.targetEntityId);
      const targetName = targetEntity?.name || 'Target Track';

      // Temporarily pause clock while plotting attack route.
      routeWasRunning.current = session?.status === 'running';
      dispatch({ type: 'setPlayback', args: ['paused'] });

      setTargetPicking({
        mode: 'strike_route',
        entityId: params.attackerEntityId,
        originLngLat: attacker?.lngLat,
        pickedWaypoints: [],
        strikeParams: params,
        label: `Planning Attack Route for ${attacker?.name || 'Unit'}. Click map to place Attack Waypoint #1, or click 'Auto-Avoid SAMs'.`,
      });
    },
    [session?.entities]
  );

  const startCorridorPicking = useCallback(
    (params: {
      originLngLat?: [number, number];
      targetLngLat?: [number, number];
      initialWaypoints?: [number, number][];
      label?: string;
      onConfirm: (waypoints: [number, number][]) => void;
    }) => {
      routeWasRunning.current = sessionRef.current?.status === 'running';
      dispatch({ type: 'setPlayback', args: ['paused'] });
      setTargetPicking({
        mode: 'strike_route',
        originLngLat: params.originLngLat,
        pickedWaypoints: params.initialWaypoints || [],
        onCorridorConfirmed: params.onConfirm,
        strikeParams: params.targetLngLat ? {
          attackerEntityId: 'custom',
          targetEntityId: 'target',
          targetLngLat: params.targetLngLat,
          weaponIndex: 0,
          salvoCount: 1,
          postStrikeAction: 'rtb',
        } : undefined,
        label: params.label || `Designate flight corridor waypoints on map, or click 'Auto-Avoid Hostile SAMs'.`,
      });
    },
    []
  );

  const startBasePlacement = useCallback(
    (baseType: BaseType, baseName?: string) => {
      setTargetPicking({
        mode: 'place_base',
        baseType,
        baseName,
        label: `Click on map to construct ${baseName || baseType.replace('_', ' ').toUpperCase()}`,
      });
    },
    []
  );

  const cancelTargetPicking = useCallback(() => {
    if (targetPicking?.mode === 'strike_route' && routeWasRunning.current) dispatch({ type: 'setPlayback', args: ['running'] });
    setTargetPicking(null);
  }, [targetPicking]);

  const confirmTargetPick = useCallback(
    (lngLat: [number, number]) => {
      if (!targetPicking) return;

      if (targetPicking.mode === 'strike_route') {
        const prevWaypoints = targetPicking.pickedWaypoints ?? [];
        const nextWaypoints = [...prevWaypoints, lngLat];
        setTargetPicking({
          ...targetPicking,
          pickedWaypoints: nextWaypoints,
          label: `Attack Waypoint #${nextWaypoints.length} placed. Click map to add WP #${nextWaypoints.length + 1}, or click 'Launch Attack Route'.`,
        });
        return;
      }

      if (targetPicking.mode === 'sortie' && targetPicking.entityId) {
        if (targetPicking.routeType === 'waypoints') {
          // Add waypoint to route!
          const prevWaypoints = targetPicking.pickedWaypoints ?? [];
          const nextWaypoints = [...prevWaypoints, lngLat];
          setTargetPicking({
            ...targetPicking,
            pickedWaypoints: nextWaypoints,
            label: `Waypoint #${nextWaypoints.length} placed. Click map to add WP #${nextWaypoints.length + 1}, or click 'Confirm Route'.`,
          });
          return;
        }

        // Circular orbit mode
        orderSortieToPoint(
          targetPicking.entityId,
          lngLat,
          targetPicking.patrolRadiusKm ?? 15,
          targetPicking.count,
          targetPicking.altitudeM ?? 7000,
          targetPicking.emcon ?? 'active',
          targetPicking.customWeapons,
          targetPicking.rcs
        );
      } else if (targetPicking.mode === 'place_autonomous' && targetPicking.systemId && targetPicking.count) {
        deployAutonomousBattery(targetPicking.systemId, targetPicking.count, lngLat);
      } else if (targetPicking.mode === 'place_base' && targetPicking.baseType) {
        const iso = session?.activeFaction === 'player' ? session?.playerIso : session?.enemyIso;
        const defaultName = `${iso} ${targetPicking.baseType.replace('_', ' ').toUpperCase()} #${friendlyBases.length + 1}`;
        createBaseAtLocation(targetPicking.baseName?.trim() || defaultName, targetPicking.baseType, lngLat);
      }
    },
    [targetPicking, orderSortieToPoint, deployAutonomousBattery, createBaseAtLocation, session, friendlyBases.length]
  );

  const confirmCustomRoute = useCallback(() => {
    if (!targetPicking) return;

    if (targetPicking.onCorridorConfirmed) {
      const waypoints = targetPicking.pickedWaypoints ?? [];
      targetPicking.onCorridorConfirmed(waypoints);
      dispatch({ type: 'setPlayback', args: ['running'] });
      setTargetPicking(null);
      return;
    }

    if (targetPicking.mode === 'strike_route' && targetPicking.strikeParams) {
      const waypoints = targetPicking.pickedWaypoints ?? [];
      const p = targetPicking.strikeParams;
      dispatch({ type: 'orderStrike', args: [p.attackerEntityId, p.targetEntityId, p.targetLngLat,
        p.weaponIndex, p.salvoCount, p.postStrikeAction, p.customPostLngLat, p.sortieCount,
        p.customWeapons, p.weaponsToFire, waypoints.length ? waypoints : undefined, true] });
      setTargetPicking(null);
      return;
    }

    if (targetPicking.mode !== 'sortie' || !targetPicking.entityId) return;
    const waypoints = targetPicking.pickedWaypoints ?? [];
    if (waypoints.length === 0) return;

    if (waypoints.length === 1) {
      orderSortieToPoint(
        targetPicking.entityId,
        waypoints[0],
        targetPicking.patrolRadiusKm ?? 15,
        targetPicking.count,
        targetPicking.altitudeM ?? 7000,
        targetPicking.emcon ?? 'active',
        targetPicking.customWeapons,
        targetPicking.rcs
      );
      return;
    }

    dispatch({ type: 'orderWaypointPatrol', args: [targetPicking.entityId, waypoints,
      targetPicking.altitudeM ?? 7000, targetPicking.emcon ?? 'active', targetPicking.count,
      targetPicking.customWeapons, targetPicking.rcs] });
    setTargetPicking(null);
  }, [targetPicking, orderSortieToPoint, systemsLibrary]);

  const autoAvoidThreats = useCallback(() => {
    if (!targetPicking || !session) return;
    const origin = targetPicking.originLngLat;
    if (!origin) return;

    let target = targetPicking.strikeParams?.targetLngLat;
    if (!target && targetPicking.pickedWaypoints && targetPicking.pickedWaypoints.length > 0) {
      target = targetPicking.pickedWaypoints[targetPicking.pickedWaypoints.length - 1];
    }
    if (!target) return;

    const threatZones = getKnownHostileThreatZones(session, systemsLibrary);
    const autoRoute = generateOptimalThreatAvoidanceRoute(origin, target, threatZones, 900);

    // If strike route, waypoints are intermediate doglegs before terminal release point
    if (targetPicking.mode === 'strike_route') {
      const doglegs = autoRoute.slice(1, autoRoute.length - 1);
      setTargetPicking({
        ...targetPicking,
        pickedWaypoints: doglegs,
        label: doglegs.length > 0
          ? `⚡ Auto-routed around hostile SAMs (${doglegs.length} dogleg waypoints generated). Click 'Launch Attack Route'.`
          : `Direct path is already clear of hostile SAM threats.`,
      });
    } else {
      const fullWps = autoRoute.slice(1);
      setTargetPicking({
        ...targetPicking,
        pickedWaypoints: fullWps,
        label: `⚡ Auto-routed around hostile SAMs (${fullWps.length} waypoints generated). Click 'Confirm Route'.`,
      });
    }
  }, [targetPicking, session, systemsLibrary]);

  const undoLastWaypoint = useCallback(() => {
    if (!targetPicking || !targetPicking.pickedWaypoints || targetPicking.pickedWaypoints.length === 0) return;
    const nextWaypoints = targetPicking.pickedWaypoints.slice(0, -1);
    setTargetPicking({
      ...targetPicking,
      pickedWaypoints: nextWaypoints,
      label: nextWaypoints.length === 0
        ? `Click on map to place Waypoint #1`
        : `Waypoint #${nextWaypoints.length} placed. Click map to add WP #${nextWaypoints.length + 1}, or click 'Confirm Route'.`,
    });
  }, [targetPicking]);

  const setEntityRcs = useCallback(
    (entityId: string, rcs: number) => {
      dispatch({ type: 'setEntityRcs', args: [entityId, rcs] });
    },
    []
  );

  const createNetwork = useCallback((name: string, doctrine: import('./warSimTypes').NetworkDoctrine = 'layered_optimal') => {
    dispatch({ type: 'createNetwork', args: [name, doctrine] });
  }, []);

  const assignEntityToNetwork = useCallback((entityId: string, networkId: string) => {
    dispatch({ type: 'assignEntityToNetwork', args: [entityId, networkId] });
  }, []);

  const removeEntityFromNetwork = useCallback((entityId: string) => {
    dispatch({ type: 'removeEntityFromNetwork', args: [entityId] });
  }, []);

  const setNetworkDoctrine = useCallback((networkId: string, doctrine: import('./warSimTypes').NetworkDoctrine) => {
    dispatch({ type: 'setNetworkDoctrine', args: [networkId, doctrine] });
  }, []);

  const toggleNetworkOth = useCallback((networkId: string) => {
    dispatch({ type: 'toggleNetworkOth', args: [networkId] });
  }, []);

  // -------------------------------------------------------------
  // Battle Ops Multi-Phase Operational Management
  // -------------------------------------------------------------

  const updateBattleOpsPlan = useCallback((updates: Partial<BattleOpsPlan>) => {
    dispatch({ type: 'updateBattleOpsPlan', args: [updates] });
  }, []);

  const addBattleOpsPhase = useCallback((name?: string, triggerDelaySec?: number) => {
    dispatch({ type: 'addBattleOpsPhase', args: [name, triggerDelaySec] });
  }, []);

  const removeBattleOpsPhase = useCallback((phaseId: string) => {
    dispatch({ type: 'removeBattleOpsPhase', args: [phaseId] });
  }, []);

  const updateBattleOpsPhase = useCallback((phaseId: string, updates: Partial<BattleOpsPhase>) => {
    dispatch({ type: 'updateBattleOpsPhase', args: [phaseId, updates] });
  }, []);

  const addBattleOpsTask = useCallback((phaseId: string, taskData: Omit<BattleOpsTask, 'id' | 'status'>) => {
    dispatch({ type: 'addBattleOpsTask', args: [phaseId, taskData] });
  }, []);

  const removeBattleOpsTask = useCallback((phaseId: string, taskId: string) => {
    dispatch({ type: 'removeBattleOpsTask', args: [phaseId, taskId] });
  }, []);

  const startBattleOpsExecution = useCallback(() => {
    dispatch({ type: 'startBattleOpsExecution', args: [] });
  }, []);

  const resetBattleOpsPlan = useCallback(() => {
    dispatch({ type: 'resetBattleOpsPlan', args: [] });
  }, []);

  const setAirspaceRoe = useCallback((doctrine: AirspaceRoeDoctrine) => {
    dispatch({ type: 'setAirspaceRoe', args: [doctrine] });
  }, []);

  const orderAsatStrike = useCallback((launcherEntityId: string, targetSatelliteId: string) => {
    dispatch({ type: 'orderAsatStrike', args: [launcherEntityId, targetSatelliteId] });
  }, []);

  const orderSeadStrike = useCallback((attackerEntityId: string, targetRadarEntityId: string) => {
    dispatch({ type: 'orderSeadStrike', args: [attackerEntityId, targetRadarEntityId] });
  }, []);

  const updateEntityEwMode = useCallback((
    entityId: string,
    mode: 'off' | 'standoff_jamming' | 'gps_denial' | 'self_protection',
    jammingTargetLngLat?: [number, number]
  ) => {
    dispatch({ type: 'updateEntityEwMode', args: [entityId, mode, jammingTargetLngLat] });
  }, []);

  const setEntityThreatLevel = useCallback((entityId: string, threatLevel: SystemThreatLevel) => {
    dispatch({ type: 'setEntityThreatLevel', args: [entityId, threatLevel] });
  }, []);

  const setGlobalThreatLevel = useCallback((
    factionIso: string,
    threatLevel: SystemThreatLevel,
    typeCategory?: 'all' | 'air' | 'sam' | 'naval' | 'ground'
  ) => {
    dispatch({ type: 'setGlobalThreatLevel', args: [factionIso, threatLevel, typeCategory] });
  }, []);

  const orderRearmCarrierAirWing = useCallback((
    squadronEntityId: string,
    presetKey: keyof typeof CARRIER_LOADOUT_PRESETS
  ) => {
    dispatch({ type: 'orderRearmCarrierAirWing', args: [squadronEntityId, presetKey] });
  }, []);

  const orderLaunchCarrierStrike = useCallback((
    carrierEntityId: string,
    squadronEntityId: string,
    targetEntityId: string,
    targetLngLat: [number, number],
    weaponIndex = 0,
    salvoCount = 2
  ) => {
    dispatch({ type: 'orderLaunchCarrierStrike', args: [carrierEntityId, squadronEntityId, targetEntityId, targetLngLat, weaponIndex, salvoCount] });
  }, [systemsLibrary]);

  const exitSim = useCallback(() => {
    // 1. Immediately reset internal session and all sub-selections
    runtime.close();
    setSelectedEntityId(null);
    setSelectedContactId(null);
    setSelectedBaseId(null);
    setTargetPicking(null);
    setActiveWeaponIndex(null);
    setShowAllEnvelopes(false);

    // Persistence is serialized by the runtime client, including the final clear.

    // 3. Cleanly remove all live WarSim MapLibre layers and sources
    if (mapRef.current) {
      try {
        removeWarSimLayers(mapRef.current);
      } catch (err) {
        console.warn('[useWarSim] Error removing map layers on exit:', err);
      }
    }

    // 4. Notify parent callback
    onClose?.();
  }, [mapRef, onClose]);

  return {
    session,
    dispatchSimulation: runtime.dispatch,
    systemsLibrary,
    runtimeError: runtime.error,
    runtimeDiagnostics: runtime.diagnostics,
    dismissRuntimeError: runtime.dismissError,
    restartRuntime: runtime.restart,
    activeFaction,
    activeCountryIso,
    activeCountryColor,
    isPlaying: session?.status === 'running',
    togglePlay,
    speedMultiplier: session?.timeMultiplier ?? 3,
    setSpeedMultiplier,
    switchActiveFaction,
    deployUnitToBase,
    deployAutonomousBattery,
    orderSortieToPoint,
    setEntityRcs,
    orderRtb,
    orderRefuelAtTanker,
    orderStrike,
    setAirspaceRoe,
    orderAsatStrike,
    orderSeadStrike,
    updateEntityEwMode,
    setEntityThreatLevel,
    setGlobalThreatLevel,
    rearmCarrierAirWing: orderRearmCarrierAirWing,
    launchCarrierStrike: orderLaunchCarrierStrike,
    createBaseAtLocation,
    renameBase,
    createNetwork,
    assignEntityToNetwork,
    removeEntityFromNetwork,
    setNetworkDoctrine,
    toggleNetworkOth,
    battleOpsPlan: session?.battleOpsPlan,
    updateBattleOpsPlan,
    addBattleOpsPhase,
    removeBattleOpsPhase,
    updateBattleOpsPhase,
    addBattleOpsTask,
    removeBattleOpsTask,
    startBattleOpsExecution,
    resetBattleOpsPlan,
    friendlyEntities,
    friendlyBases,
    visibleContacts,
    selectedBase,
    selectedBaseId,
    setSelectedBaseId,
    selectedEntity,
    selectedEntityId,
    setSelectedEntityId,
    activeWeaponIndex,
    setActiveWeaponIndex,
    showAllEnvelopes,
    setShowAllEnvelopes,
    selectedContact,
    selectedContactId,
    setSelectedContactId,
    targetPicking,
    startSortiePicking,
    startStrikeRoutePicking,
    startCorridorPicking,
    startAutonomousPicking,
    startBasePlacement,
    cancelTargetPicking,
    confirmTargetPick,
    confirmCustomRoute,
    undoLastWaypoint,
    autoAvoidThreats,
    exitSim,
  };
}
