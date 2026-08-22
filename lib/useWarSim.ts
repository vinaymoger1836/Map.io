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
} from './warSimEngine';
import { type SystemSpec, domainOf } from './specs';
import { isGroundCombatUnit } from './warSimRules';
import { writeDoc } from './store';

export interface TargetPickingState {
  mode: 'sortie' | 'place_autonomous' | 'place_base';
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
  customWeapons?: import('./specs').WeaponFacet[];
  routeType?: 'orbit' | 'waypoints';
  pickedWaypoints?: [number, number][];
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

  // Initialize from initialSession prop
  useEffect(() => {
    if (initialSession) {
      setSession(initialSession);
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

  // Auto-Save to Store every 10 seconds
  useEffect(() => {
    if (!session || session.status === 'setup') return;

    const saveInterval = setInterval(() => {
      if (sessionRef.current) {
        writeDoc('warsim-session', sessionRef.current);
      }
    }, 10000);

    return () => clearInterval(saveInterval);
  }, [session?.id]);

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
      customWeapons?: import('./specs').WeaponFacet[]
    ) => {
      setSession((prev) => {
        if (!prev) return null;
        return orderPatrol(prev, entityId, targetLngLat, patrolRadiusKm, altitudeM, emcon, sortieCount, customWeapons);
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
      customWeapons?: import('./specs').WeaponFacet[]
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
          customWeapons
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
    setTargetPicking(null);
  }, []);

  const confirmTargetPick = useCallback(
    (lngLat: [number, number]) => {
      if (!targetPicking) return;

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
          targetPicking.customWeapons
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
    if (!targetPicking || targetPicking.mode !== 'sortie' || !targetPicking.entityId) return;
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
        targetPicking.customWeapons
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
        waypoints
      );
    });
    setTargetPicking(null);
  }, [targetPicking, orderSortieToPoint]);

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
    orderRtb,
    orderStrike,
    createBaseAtLocation,
    renameBase,
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
    startAutonomousPicking,
    startBasePlacement,
    cancelTargetPicking,
    confirmTargetPick,
    confirmCustomRoute,
    undoLastWaypoint,
  };
}
