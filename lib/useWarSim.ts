'use client';

/**
 * War Simulation React State Hook & Engine Driver
 *
 * Manages the live simulation state loop, user commands, base stationing,
 * patrol dispatching, fog of war contact filtering, and session persistence.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type BaseType,
  type DetectedContact,
} from './warSimTypes';
import {
  tickWarSim,
  deployEntityToBase,
  orderPatrol,
  addSimBase,
} from './warSimEngine';
import { type SystemSpec } from './specs';
import { writeDoc, readDoc } from './store';

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
  const [patrolDesignateMode, setPatrolDesignateMode] = useState<boolean>(false);
  const [basePlacementMode, setBasePlacementMode] = useState<BaseType | null>(null);

  const lastTickTimeRef = useRef<number>(Date.now());
  const sessionRef = useRef<WarSimSession | null>(session);
  sessionRef.current = session;

  // Initialize from initialSession prop
  useEffect(() => {
    if (initialSession) {
      setSession(initialSession);
    }
  }, [initialSession]);

  // Seed default sovereign bases if none exist
  useEffect(() => {
    if (session && session.bases.length === 0) {
      // Create initial airbase & naval base for player and enemy
      let s = addSimBase(session, 'Home Airbase North', 'airbase', session.playerIso, [-75.5, 38.5]);
      s = addSimBase(s, 'Naval Station Atlantic', 'naval_base', session.playerIso, [-76.3, 36.9]);
      s = addSimBase(s, 'Forward Airbase East', 'airbase', session.enemyIso, [37.2, 55.6]);
      s = addSimBase(s, 'Red Fleet Naval Base', 'naval_base', session.enemyIso, [33.5, 44.6]);
      setSession(s);
    }
  }, [session]);

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
  }, []);

  const deployUnit = useCallback(
    (baseId: string, systemId: string, count: number) => {
      setSession((prev) => {
        if (!prev) return null;
        return deployEntityToBase(prev, baseId, systemId, count, systemsLibrary);
      });
    },
    [systemsLibrary]
  );

  const dispatchPatrol = useCallback(
    (entityId: string, centerLngLat: [number, number], patrolRadiusKm: number = 80, altitudeM: number = 7000) => {
      setSession((prev) => {
        if (!prev) return null;
        return orderPatrol(prev, entityId, centerLngLat, patrolRadiusKm, altitudeM, 'active');
      });
      setPatrolDesignateMode(false);
    },
    []
  );

  const createBaseAtLocation = useCallback(
    (name: string, type: BaseType, lngLat: [number, number]) => {
      setSession((prev) => {
        if (!prev) return null;
        const iso = prev.activeFaction === 'player' ? prev.playerIso : prev.enemyIso;
        return addSimBase(prev, name, type, iso, lngLat);
      });
      setBasePlacementMode(null);
    },
    []
  );

  // Filter contacts visible to active faction under Fog of War
  const visibleContacts: DetectedContact[] = useMemo(() => {
    if (!session) return [];
    const faction = session.activeFaction;
    return faction === 'player'
      ? session.fogOfWarContacts.playerContacts
      : session.fogOfWarContacts.enemyContacts;
  }, [session]);

  const activeFactionIso = session?.activeFaction === 'player' ? session?.playerIso : session?.enemyIso;

  const friendlyEntities: SimEntity[] = useMemo(() => {
    if (!session) return [];
    return session.entities.filter((e) => e.iso === activeFactionIso && e.status !== 'destroyed');
  }, [session, activeFactionIso]);

  const friendlyBases: SimBase[] = useMemo(() => {
    if (!session) return [];
    return session.bases.filter((b) => b.iso === activeFactionIso);
  }, [session, activeFactionIso]);

  const selectedEntity = useMemo(() => {
    return session?.entities.find((e) => e.id === selectedEntityId) ?? null;
  }, [session, selectedEntityId]);

  const selectedContact = useMemo(() => {
    return visibleContacts.find((c) => c.contactId === selectedContactId) ?? null;
  }, [visibleContacts, selectedContactId]);

  return {
    session,
    setSession,
    isPlaying: session?.status === 'running',
    togglePlay,
    speedMultiplier: session?.timeMultiplier ?? 3,
    setSpeedMultiplier,
    switchActiveFaction,
    deployUnit,
    dispatchPatrol,
    createBaseAtLocation,
    friendlyEntities,
    friendlyBases,
    visibleContacts,
    selectedEntity,
    selectedEntityId,
    setSelectedEntityId,
    selectedContact,
    selectedContactId,
    setSelectedContactId,
    patrolDesignateMode,
    setPatrolDesignateMode,
    basePlacementMode,
    setBasePlacementMode,
  };
}
