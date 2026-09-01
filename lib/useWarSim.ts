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
import {
  tickWarSim,
  deployEntityToBase,
  deployAutonomousEntity,
  orderPatrol,
  orderEntityRtb,
  orderStrikeMission,
  addSimBase,
  renameSimBase,
  updateEntityRcs,
  createDefaultBattleOpsPlan,
  orderAerialRefueling,
  setSessionAirspaceRoe,
  launchAsatStrike,
  launchSeadStrike,
  setEntityEwMode,
} from './warSimEngine';
import { type SystemSpec, domainOf } from './specs';
import { isGroundCombatUnit } from './warSimRules';
import { writeDoc } from './store';
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
  systemsLibrary,
  mapRef,
  onClose,
}: UseWarSimProps) {
  const [session, setSession] = useState<WarSimSession | null>(initialSession);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [targetPicking, setTargetPicking] = useState<TargetPickingState | null>(null);
  const [activeWeaponIndex, setActiveWeaponIndex] = useState<number | null>(null);
  const [showAllEnvelopes, setShowAllEnvelopes] = useState<boolean>(false);

  // Reset active weapon envelope preview when entity selection changes
  useEffect(() => {
    setActiveWeaponIndex(null);
  }, [selectedEntityId]);

  const lastTickTimeRef = useRef<number>(Date.now());
  const sessionRef = useRef<WarSimSession | null>(session);
  sessionRef.current = session;

  // Sync internal session state from initialSession prop
  useEffect(() => {
    setSession(initialSession);
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
  // Master Clock & Kinematic Loop (Ticks every ~100 ms)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!session || session.status !== 'running') return;

    lastTickTimeRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const dtRealSec = (now - lastTickTimeRef.current) / 1000;
      lastTickTimeRef.current = now;

      if (sessionRef.current && sessionRef.current.status === 'running') {
        const next = tickWarSim(sessionRef.current, dtRealSec, systemsLibrary);
        setSession(next);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [session?.status, systemsLibrary]);

  // Auto-Save to Store every 4 seconds
  useEffect(() => {
    if (!session || session.status === 'setup') return;

    // Immediately save on state transition
    if (sessionRef.current) {
      writeDoc('warsim-session', sessionRef.current);
    }

    const saveInterval = setInterval(() => {
      if (sessionRef.current && sessionRef.current.status !== 'setup') {
        writeDoc('warsim-session', sessionRef.current);
      }
    }, 4000);

    return () => clearInterval(saveInterval);
  }, [session?.id, session?.status]);

  // Persist paused state immediately before page unload / browser restart
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionRef.current && sessionRef.current.status !== 'setup') {
        writeDoc('warsim-session', {
          ...sessionRef.current,
          status: 'paused',
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // -------------------------------------------------------------
  // User Commands & Actions
  // -------------------------------------------------------------

  const togglePlay = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        status: prev.status === 'running' ? 'paused' : 'running',
      };
    });
  }, []);

  const setSpeedMultiplier = useCallback((multiplier: number) => {
    setSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        timeMultiplier: multiplier,
      };
    });
  }, []);

  const switchActiveFaction = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      const nextFaction = prev.activeFaction === 'player' ? 'enemy' : 'player';
      return {
        ...prev,
        activeFaction: nextFaction,
      };
    });
    setSelectedEntityId(null);
    setSelectedContactId(null);
    setSelectedBaseId(null);
    setTargetPicking(null);
  }, []);

  const deployUnitToBase = useCallback(
    (baseId: string, systemId: string, count: number) => {
      setSession((prev) => {
        if (!prev) return null;
        return deployEntityToBase(prev, baseId, systemId, count, systemsLibrary);
      });
    },
    [systemsLibrary]
  );

  const deployAutonomousBattery = useCallback(
    (systemId: string, count: number, lngLat: [number, number]) => {
      setSession((prev) => {
        if (!prev) return null;
        return deployAutonomousEntity(prev, systemId, count, lngLat, systemsLibrary);
      });
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
      setSession((prev) => {
        if (!prev) return null;
        return orderPatrol(prev, entityId, targetLngLat, patrolRadiusKm, altitudeM, emcon, sortieCount, customWeapons, 'orbit', undefined, rcs);
      });
      setTargetPicking(null);
    },
    []
  );

  const orderRtb = useCallback(
    (entityId: string) => {
      setSession((prev) => {
        if (!prev) return null;
        return orderEntityRtb(prev, entityId);
      });
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
      setSession((prev) => {
        if (!prev) return null;
        return orderStrikeMission(
          prev,
          attackerEntityId,
          targetEntityId,
          targetLngLat,
          weaponIndex,
          salvoCount,
          postStrikeAction,
          customPostLngLat,
          systemsLibrary,
          sortieCount,
          customWeapons,
          weaponsToFire,
          attackWaypoints
        );
      });
      setTargetPicking(null);
    },
    [systemsLibrary]
  );

  const createBaseAtLocation = useCallback(
    (name: string, type: BaseType, lngLat: [number, number]) => {
      setSession((prev) => {
        if (!prev) return null;
        const iso = prev.activeFaction === 'player' ? prev.playerIso : prev.enemyIso;
        return addSimBase(prev, name, type, iso, lngLat);
      });
      setTargetPicking(null);
    },
    []
  );

  const renameBase = useCallback(
    (baseId: string, newName: string) => {
      setSession((prev) => {
        if (!prev) return null;
        return renameSimBase(prev, baseId, newName);
      });
    },
    []
  );

  const orderRefuelAtTanker = useCallback(
    (receiverEntityId: string, tankerEntityId?: string, targetFuelPct = 100) => {
      setSession((prev) => {
        if (!prev) return null;
        return orderAerialRefueling(prev, receiverEntityId, tankerEntityId, targetFuelPct, systemsLibrary);
      });
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

      // Temporarily pause clock while plotting attack route
      setSession((prev) => (prev ? { ...prev, status: 'paused' } : null));

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
      setSession((prev) => (prev ? { ...prev, status: 'paused' } : null));
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
    setSession((prev) => {
      if (!prev) return null;
      // If was planning strike route, resume clock
      if (targetPicking?.mode === 'strike_route' && prev.status === 'paused') {
        return { ...prev, status: 'running' };
      }
      return prev;
    });
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
      setSession((prev) => (prev && prev.status === 'paused' ? { ...prev, status: 'running' } : prev));
      setTargetPicking(null);
      return;
    }

    if (targetPicking.mode === 'strike_route' && targetPicking.strikeParams) {
      const waypoints = targetPicking.pickedWaypoints ?? [];
      const p = targetPicking.strikeParams;
      setSession((prev) => {
        if (!prev) return null;
        const updated = orderStrikeMission(
          prev,
          p.attackerEntityId,
          p.targetEntityId,
          p.targetLngLat,
          p.weaponIndex,
          p.salvoCount,
          p.postStrikeAction,
          p.customPostLngLat,
          systemsLibrary,
          p.sortieCount,
          p.customWeapons,
          p.weaponsToFire,
          waypoints.length > 0 ? waypoints : undefined
        );
        // Resume simulation clock
        return {
          ...updated,
          status: 'running',
        };
      });
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

    setSession((prev) => {
      if (!prev) return null;
      return orderPatrol(
        prev,
        targetPicking.entityId!,
        waypoints[0],
        0,
        targetPicking.altitudeM ?? 7000,
        targetPicking.emcon ?? 'active',
        targetPicking.count,
        targetPicking.customWeapons,
        'waypoints',
        waypoints,
        targetPicking.rcs
      );
    });
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
      setSession((prev) => {
        if (!prev) return null;
        return updateEntityRcs(prev, entityId, rcs);
      });
    },
    []
  );

  const createNetwork = useCallback((name: string, doctrine: import('./warSimTypes').NetworkDoctrine = 'layered_optimal') => {
    setSession((prev) => {
      if (!prev) return null;
      const faction = prev.activeFaction;
      const iso = faction === 'player' ? prev.playerIso : prev.enemyIso;
      const newNet: import('./warSimTypes').BattlefieldNetwork = {
        id: `net-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        name: name.trim() || `${iso} Tactical Datalink Grid`,
        faction,
        iso,
        doctrine,
        nodes: [],
        sharedContactIds: [],
        othTargetingEnabled: true,
      };
      return {
        ...prev,
        networks: [...(prev.networks || []), newNet],
      };
    });
  }, []);

  const assignEntityToNetwork = useCallback((entityId: string, networkId: string) => {
    setSession((prev) => {
      if (!prev) return null;
      const targetEntity = prev.entities.find((e) => e.id === entityId);
      if (!targetEntity || targetEntity.status === 'docked' || targetEntity.status === 'turnaround' || targetEntity.status === 'in_repair' || targetEntity.status === 'destroyed') {
        return prev;
      }
      const updatedEntities = prev.entities.map((e) => (e.id === entityId ? { ...e, networkId } : e));
      const targetNet = prev.networks?.find((n) => n.id === networkId);
      const updatedNetworks = (prev.networks || []).map((net) => {
        if (net.id === networkId) {
          if (!net.nodes.some((n) => n.entityId === entityId)) {
            return {
              ...net,
              nodes: [
                ...net.nodes,
                {
                  entityId,
                  role: 'shooter' as const,
                  datalinkStatus: 'active' as const,
                  channelCapacity: 4,
                  activeChannelsUsed: 0,
                },
              ],
            };
          }
        } else {
          return {
            ...net,
            nodes: net.nodes.filter((n) => n.entityId !== entityId),
          };
        }
        return net;
      });
      return {
        ...prev,
        entities: updatedEntities,
        networks: updatedNetworks,
      };
    });
  }, []);

  const removeEntityFromNetwork = useCallback((entityId: string) => {
    setSession((prev) => {
      if (!prev) return null;
      const updatedEntities = prev.entities.map((e) => (e.id === entityId ? { ...e, networkId: undefined } : e));
      const updatedNetworks = (prev.networks || []).map((net) => ({
        ...net,
        nodes: net.nodes.filter((n) => n.entityId !== entityId),
      }));
      return {
        ...prev,
        entities: updatedEntities,
        networks: updatedNetworks,
      };
    });
  }, []);

  const setNetworkDoctrine = useCallback((networkId: string, doctrine: import('./warSimTypes').NetworkDoctrine) => {
    setSession((prev) => {
      if (!prev || !prev.networks) return prev;
      const updatedNetworks = prev.networks.map((n) => (n.id === networkId ? { ...n, doctrine } : n));
      return {
        ...prev,
        networks: updatedNetworks,
      };
    });
  }, []);

  const toggleNetworkOth = useCallback((networkId: string) => {
    setSession((prev) => {
      if (!prev || !prev.networks) return prev;
      const updatedNetworks = prev.networks.map((n) =>
        n.id === networkId ? { ...n, othTargetingEnabled: !n.othTargetingEnabled } : n
      );
      return {
        ...prev,
        networks: updatedNetworks,
      };
    });
  }, []);

  // -------------------------------------------------------------
  // Battle Ops Multi-Phase Operational Management
  // -------------------------------------------------------------

  const updateBattleOpsPlan = useCallback((updates: Partial<BattleOpsPlan>) => {
    setSession((prev) => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      return {
        ...prev,
        battleOpsPlan: {
          ...currentPlan,
          ...updates,
        },
      };
    });
  }, []);

  const addBattleOpsPhase = useCallback((name?: string, triggerDelaySec?: number) => {
    setSession((prev) => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      const nextNum = currentPlan.phases.length + 1;
      const lastDelay = currentPlan.phases.length > 0
        ? currentPlan.phases[currentPlan.phases.length - 1].triggerDelaySec
        : 0;
      const newPhase: BattleOpsPhase = {
        id: `phase-${Date.now()}-${nextNum}`,
        phaseNumber: nextNum,
        name: name || `Phase ${nextNum}: Strategic Strike Package`,
        triggerDelaySec: triggerDelaySec !== undefined ? triggerDelaySec : lastDelay + 900,
        status: 'pending',
        tasks: [],
      };
      return {
        ...prev,
        battleOpsPlan: {
          ...currentPlan,
          phases: [...currentPlan.phases, newPhase],
        },
      };
    });
  }, []);

  const removeBattleOpsPhase = useCallback((phaseId: string) => {
    setSession((prev) => {
      if (!prev || !prev.battleOpsPlan) return prev;
      const filtered = prev.battleOpsPlan.phases.filter((p) => p.id !== phaseId);
      const renumbered = filtered.map((p, idx) => ({ ...p, phaseNumber: idx + 1 }));
      return {
        ...prev,
        battleOpsPlan: {
          ...prev.battleOpsPlan,
          phases: renumbered,
        },
      };
    });
  }, []);

  const updateBattleOpsPhase = useCallback((phaseId: string, updates: Partial<BattleOpsPhase>) => {
    setSession((prev) => {
      if (!prev || !prev.battleOpsPlan) return prev;
      const updatedPhases = prev.battleOpsPlan.phases.map((p) => (p.id === phaseId ? { ...p, ...updates } : p));
      return {
        ...prev,
        battleOpsPlan: {
          ...prev.battleOpsPlan,
          phases: updatedPhases,
        },
      };
    });
  }, []);

  const addBattleOpsTask = useCallback((phaseId: string, taskData: Omit<BattleOpsTask, 'id' | 'status'>) => {
    setSession((prev) => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      const newTask: BattleOpsTask = {
        ...taskData,
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'pending',
      };
      const updatedPhases = currentPlan.phases.map((p) =>
        p.id === phaseId ? { ...p, tasks: [...p.tasks, newTask] } : p
      );
      return {
        ...prev,
        battleOpsPlan: {
          ...currentPlan,
          phases: updatedPhases,
        },
      };
    });
  }, []);

  const removeBattleOpsTask = useCallback((phaseId: string, taskId: string) => {
    setSession((prev) => {
      if (!prev || !prev.battleOpsPlan) return prev;
      const updatedPhases = prev.battleOpsPlan.phases.map((p) =>
        p.id === phaseId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p
      );
      return {
        ...prev,
        battleOpsPlan: {
          ...prev.battleOpsPlan,
          phases: updatedPhases,
        },
      };
    });
  }, []);

  const startBattleOpsExecution = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      const resetPhases: BattleOpsPhase[] = currentPlan.phases.map((p) => ({
        ...p,
        status: 'pending',
        tasks: p.tasks.map((t) => ({ ...t, status: 'pending', resultSummary: undefined, salvoId: undefined })),
      }));

      const plan: BattleOpsPlan = {
        ...currentPlan,
        status: 'executing',
        startedAtSimTimeSec: prev.simTimeSec,
        completedAtSimTimeSec: undefined,
        finalReportGenerated: false,
        phases: resetPhases,
      };

      return {
        ...prev,
        status: 'running', // Automatically unpause the simulation
        battleOpsPlan: plan,
      };
    });
  }, []);

  const resetBattleOpsPlan = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      const newPlan = createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      return {
        ...prev,
        battleOpsPlan: newPlan,
      };
    });
  }, []);

  const setAirspaceRoe = useCallback((doctrine: AirspaceRoeDoctrine) => {
    setSession((prev) => (prev ? setSessionAirspaceRoe(prev, doctrine) : null));
  }, []);

  const orderAsatStrike = useCallback((launcherEntityId: string, targetSatelliteId: string) => {
    setSession((prev) => {
      if (!prev) return null;
      const res = launchAsatStrike(prev, launcherEntityId, targetSatelliteId);
      return res.session;
    });
  }, []);

  const orderSeadStrike = useCallback((attackerEntityId: string, targetRadarEntityId: string) => {
    setSession((prev) => {
      if (!prev) return null;
      const res = launchSeadStrike(prev, attackerEntityId, targetRadarEntityId);
      return res.session;
    });
  }, []);

  const updateEntityEwMode = useCallback((
    entityId: string,
    mode: 'off' | 'standoff_jamming' | 'gps_denial' | 'self_protection',
    jammingTargetLngLat?: [number, number]
  ) => {
    setSession((prev) => (prev ? setEntityEwMode(prev, entityId, mode, jammingTargetLngLat) : null));
  }, []);

  const exitSim = useCallback(() => {
    // 1. Immediately reset internal session and all sub-selections
    setSession(null);
    setSelectedEntityId(null);
    setSelectedContactId(null);
    setSelectedBaseId(null);
    setTargetPicking(null);
    setActiveWeaponIndex(null);
    setShowAllEnvelopes(false);

    // 2. Erase persisted session doc so subsequent sessions start completely fresh
    writeDoc('warsim-session', null);

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
    setSession,
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
