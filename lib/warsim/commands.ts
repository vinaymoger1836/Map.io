/** Legacy commands extracted from the UI; evaluated only by the authoritative runtime. */
import type { WarSimSession, BaseType, PostStrikeAction, BattleOpsPlan, BattleOpsPhase, BattleOpsTask, AirspaceRoeDoctrine, SystemThreatLevel } from '../warSimTypes';
import type { SystemSpec } from '../specs';
import { simNow, simRandom } from './context';
import { cancelPhysicalMission, coalitionScope, factionScope, forwardPhysicalReport, hq, requestPhysicalCollection, reservePhysicalMission,
  setCoalitionSharing, setPhysicalEmission, setPhysicalLink } from './intelligence';
import { launchPhysical, setPhysicalCourse } from './physics/model';
import { cancelPhysicalRepair, startPhysicalRepair, type Capability } from './physics/readiness';
import {
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
  updateEntityThreatLevel,
  updateGlobalFactionThreatLevel,
  rearmCarrierAirWing,
  orderCarrierAirStrike,
  CARRIER_LOADOUT_PRESETS,
} from '../warSimEngine';
export const commandHandlers = {
launchPhysical: (s: WarSimSession, _d: SystemSpec[], shooter: string, track: string, revision?: number) => launchPhysical(s, shooter, track, revision),
setPhysicalCourse: (s: WarSimSession, _d: SystemSpec[], id: string, heading: number, speed: number) => setPhysicalCourse(s, id, heading, speed),
setObserverScope: (s: WarSimSession, _d: SystemSpec[], scopeId: string) => {
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  if (!s.physical || ![hq(iso), factionScope(iso), coalitionScope(iso)].includes(scopeId)
    && !s.physical.actors.some(a => a.iso === iso && `${a.id}:local` === scopeId)) throw new Error('Observer scope is unavailable.');
  s.observerScope = scopeId; return s;
},
requestPhysicalCollection: (s: WarSimSession, _d: SystemSpec[], assetId: string, center: [number, number, number], radiusM: number) =>
  requestPhysicalCollection(s, assetId, center, radiusM, Math.round(s.simTimeSec * 10)),
setPhysicalEmission: (s: WarSimSession, _d: SystemSpec[], assetId: string, mode: 'active' | 'passive') => setPhysicalEmission(s, assetId, mode),
setPhysicalLink: (s: WarSimSession, _d: SystemSpec[], assetId: string, active: boolean) => setPhysicalLink(s, assetId, active),
forwardPhysicalReport: (s: WarSimSession, _d: SystemSpec[], evidenceId: string, to: 'faction' | 'coalition') =>
  forwardPhysicalReport(s, evidenceId, to, Math.round(s.simTimeSec * 10)),
setCoalitionSharing: (s: WarSimSession, _d: SystemSpec[], active: boolean) => setCoalitionSharing(s, active),
planPhysicalStrike: (s: WarSimSession, _d: SystemSpec[], shooter: string, trackId: string, supportId: string, revision: number,
  onLoss: 'hold' | 'abort' | 'continue-local', delaySec = 0) => reservePhysicalMission(s, shooter, trackId, supportId, revision, onLoss, Math.round(s.simTimeSec * 10), delaySec),
cancelPhysicalMission: (s: WarSimSession, _d: SystemSpec[], missionId: string) => cancelPhysicalMission(s, missionId),
startPhysicalRepair: (s: WarSimSession, _d: SystemSpec[], actorId: string, capability: Capability) => startPhysicalRepair(s, actorId, capability),
cancelPhysicalRepair: (s: WarSimSession, _d: SystemSpec[], actorId: string) => cancelPhysicalRepair(s, actorId),
setPlayback: (prev: WarSimSession, _systems: SystemSpec[], status: 'running' | 'paused'): WarSimSession => ({ ...prev, status }),
orderWaypointPatrol: (prev: WarSimSession, _systems: SystemSpec[], entityId: string,
  waypoints: [number, number][], altitudeM: number, emcon: 'active' | 'passive',
  count?: number, weapons?: import('../specs').WeaponFacet[], rcs?: number): WarSimSession => {
  if (!waypoints.length) throw new Error('Place at least one waypoint.');
  return orderPatrol(prev, entityId, waypoints[0], 0, altitudeM, emcon, count, weapons, 'waypoints', waypoints, rcs);
},
togglePlay: (prev: WarSimSession, systemsLibrary: SystemSpec[]): WarSimSession | null => {
      if (!prev) return null;
      return {
        ...prev,
        status: prev.status === 'running' ? 'paused' : 'running',
      };
    },
setSpeedMultiplier: (prev: WarSimSession, systemsLibrary: SystemSpec[], multiplier: number): WarSimSession | null => {
      if (!prev) return null;
      return {
        ...prev,
        timeMultiplier: multiplier,
      };
    },
switchActiveFaction: (prev: WarSimSession, systemsLibrary: SystemSpec[]): WarSimSession | null => {
      if (!prev) return null;
      const nextFaction = prev.activeFaction === 'player' ? 'enemy' : 'player';
      return {
        ...prev,
        activeFaction: nextFaction,
        ...(prev.physical ? { observerScope: `${nextFaction === 'player' ? prev.playerIso : prev.enemyIso}:hq` } : {}),
      };
    },
deployUnitToBase: (prev: WarSimSession, systemsLibrary: SystemSpec[], baseId: string, systemId: string, count: number): WarSimSession | null => {
        if (!prev) return null;
        return deployEntityToBase(prev, baseId, systemId, count, systemsLibrary);
      },
deployAutonomousBattery: (prev: WarSimSession, systemsLibrary: SystemSpec[], systemId: string, count: number, lngLat: [number, number]): WarSimSession | null => {
        if (!prev) return null;
        return deployAutonomousEntity(prev, systemId, count, lngLat, systemsLibrary);
      },
orderSortieToPoint: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string, targetLngLat: [number, number], patrolRadiusKm: number = 15, sortieCount?: number, altitudeM: number = 7000, emcon: 'active' | 'passive' = 'active', customWeapons?: import('../specs').WeaponFacet[], rcs?: number): WarSimSession | null => {
        if (!prev) return null;
        return orderPatrol(prev, entityId, targetLngLat, patrolRadiusKm, altitudeM, emcon, sortieCount, customWeapons, 'orbit', undefined, rcs);
      },
orderRtb: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string): WarSimSession | null => {
        if (!prev) return null;
        return orderEntityRtb(prev, entityId);
      },
orderStrike: (prev: WarSimSession, systemsLibrary: SystemSpec[], attackerEntityId: string, targetEntityId: string, targetLngLat: [number, number], weaponIndex: number, salvoCount: number = 1, postStrikeAction: PostStrikeAction = 'rtb', customPostLngLat?: [number, number], sortieCount?: number, customWeapons?: import('../specs').WeaponFacet[], weaponsToFire?: import('../warSimTypes').WeaponSalvoItem[], attackWaypoints?: [number, number][], resume = false): WarSimSession | null => {
        if (!prev) return null;
        const next = orderStrikeMission(
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
        if (next === prev) return prev;
        return resume ? { ...next, status: 'running' } : next;
      },
createBaseAtLocation: (prev: WarSimSession, systemsLibrary: SystemSpec[], name: string, type: BaseType, lngLat: [number, number]): WarSimSession | null => {
        if (!prev) return null;
        const iso = prev.activeFaction === 'player' ? prev.playerIso : prev.enemyIso;
        return addSimBase(prev, name, type, iso, lngLat);
      },
renameBase: (prev: WarSimSession, systemsLibrary: SystemSpec[], baseId: string, newName: string): WarSimSession | null => {
        if (!prev) return null;
        return renameSimBase(prev, baseId, newName);
      },
orderRefuelAtTanker: (prev: WarSimSession, systemsLibrary: SystemSpec[], receiverEntityId: string, tankerEntityId?: string, targetFuelPct = 100): WarSimSession | null => {
        if (!prev) return null;
        return orderAerialRefueling(prev, receiverEntityId, tankerEntityId, targetFuelPct, systemsLibrary);
      },
setEntityRcs: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string, rcs: number): WarSimSession | null => {
        if (!prev) return null;
        return updateEntityRcs(prev, entityId, rcs);
      },
createNetwork: (prev: WarSimSession, systemsLibrary: SystemSpec[], name: string, doctrine: import('../warSimTypes').NetworkDoctrine = 'layered_optimal'): WarSimSession | null => {
      if (!prev) return null;
      const faction = prev.activeFaction;
      const iso = faction === 'player' ? prev.playerIso : prev.enemyIso;
      const newNet: import('../warSimTypes').BattlefieldNetwork = {
        id: `net-${simNow().toString(36)}-${simRandom('identifiers').toString(36).slice(2, 5)}`,
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
    },
assignEntityToNetwork: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string, networkId: string): WarSimSession | null => {
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
    },
removeEntityFromNetwork: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string): WarSimSession | null => {
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
    },
setNetworkDoctrine: (prev: WarSimSession, systemsLibrary: SystemSpec[], networkId: string, doctrine: import('../warSimTypes').NetworkDoctrine): WarSimSession | null => {
      if (!prev || !prev.networks) return prev;
      const updatedNetworks = prev.networks.map((n) => (n.id === networkId ? { ...n, doctrine } : n));
      return {
        ...prev,
        networks: updatedNetworks,
      };
    },
toggleNetworkOth: (prev: WarSimSession, systemsLibrary: SystemSpec[], networkId: string): WarSimSession | null => {
      if (!prev || !prev.networks) return prev;
      const updatedNetworks = prev.networks.map((n) =>
        n.id === networkId ? { ...n, othTargetingEnabled: !n.othTargetingEnabled } : n
      );
      return {
        ...prev,
        networks: updatedNetworks,
      };
    },
updateBattleOpsPlan: (prev: WarSimSession, systemsLibrary: SystemSpec[], updates: Partial<BattleOpsPlan>): WarSimSession | null => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      return {
        ...prev,
        battleOpsPlan: {
          ...currentPlan,
          ...updates,
        },
      };
    },
addBattleOpsPhase: (prev: WarSimSession, systemsLibrary: SystemSpec[], name?: string, triggerDelaySec?: number): WarSimSession | null => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      const nextNum = currentPlan.phases.length + 1;
      const lastDelay = currentPlan.phases.length > 0
        ? currentPlan.phases[currentPlan.phases.length - 1].triggerDelaySec
        : 0;
      const newPhase: BattleOpsPhase = {
        id: `phase-${simNow()}-${nextNum}`,
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
    },
removeBattleOpsPhase: (prev: WarSimSession, systemsLibrary: SystemSpec[], phaseId: string): WarSimSession | null => {
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
    },
updateBattleOpsPhase: (prev: WarSimSession, systemsLibrary: SystemSpec[], phaseId: string, updates: Partial<BattleOpsPhase>): WarSimSession | null => {
      if (!prev || !prev.battleOpsPlan) return prev;
      const updatedPhases = prev.battleOpsPlan.phases.map((p) => (p.id === phaseId ? { ...p, ...updates } : p));
      return {
        ...prev,
        battleOpsPlan: {
          ...prev.battleOpsPlan,
          phases: updatedPhases,
        },
      };
    },
addBattleOpsTask: (prev: WarSimSession, systemsLibrary: SystemSpec[], phaseId: string, taskData: Omit<BattleOpsTask, 'id' | 'status'>): WarSimSession | null => {
      if (!prev) return null;
      const currentPlan = prev.battleOpsPlan || createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      const newTask: BattleOpsTask = {
        ...taskData,
        id: `task-${simNow()}-${simRandom('identifiers').toString(36).slice(2, 6)}`,
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
    },
removeBattleOpsTask: (prev: WarSimSession, systemsLibrary: SystemSpec[], phaseId: string, taskId: string): WarSimSession | null => {
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
    },
startBattleOpsExecution: (prev: WarSimSession, systemsLibrary: SystemSpec[]): WarSimSession | null => {
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
    },
resetBattleOpsPlan: (prev: WarSimSession, systemsLibrary: SystemSpec[]): WarSimSession | null => {
      if (!prev) return null;
      const newPlan = createDefaultBattleOpsPlan(prev.playerIso, prev.enemyIso);
      return {
        ...prev,
        battleOpsPlan: newPlan,
      };
    },
setAirspaceRoe: (prev: WarSimSession, systemsLibrary: SystemSpec[], doctrine: AirspaceRoeDoctrine): WarSimSession | null => { return (prev ? setSessionAirspaceRoe(prev, doctrine) : null); },
orderAsatStrike: (prev: WarSimSession, systemsLibrary: SystemSpec[], launcherEntityId: string, targetSatelliteId: string): WarSimSession | null => {
      if (!prev) return null;
      const res = launchAsatStrike(prev, launcherEntityId, targetSatelliteId);
      return res.session;
    },
orderSeadStrike: (prev: WarSimSession, systemsLibrary: SystemSpec[], attackerEntityId: string, targetRadarEntityId: string): WarSimSession | null => {
      if (!prev) return null;
      const res = launchSeadStrike(prev, attackerEntityId, targetRadarEntityId);
      return res.session;
    },
updateEntityEwMode: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string, mode: 'off' | 'standoff_jamming' | 'gps_denial' | 'self_protection', jammingTargetLngLat?: [number, number]): WarSimSession | null => { return (prev ? setEntityEwMode(prev, entityId, mode, jammingTargetLngLat) : null); },
setEntityThreatLevel: (prev: WarSimSession, systemsLibrary: SystemSpec[], entityId: string, threatLevel: SystemThreatLevel): WarSimSession | null => { return (prev ? updateEntityThreatLevel(prev, entityId, threatLevel) : null); },
setGlobalThreatLevel: (prev: WarSimSession, systemsLibrary: SystemSpec[], factionIso: string, threatLevel: SystemThreatLevel, typeCategory?: 'all' | 'air' | 'sam' | 'naval' | 'ground'): WarSimSession | null => { return (prev ? updateGlobalFactionThreatLevel(prev, factionIso, threatLevel, typeCategory) : null); },
orderRearmCarrierAirWing: (prev: WarSimSession, systemsLibrary: SystemSpec[], squadronEntityId: string, presetKey: keyof typeof CARRIER_LOADOUT_PRESETS): WarSimSession | null => {
      if (!prev) return null;
      const res = rearmCarrierAirWing(prev, squadronEntityId, presetKey);
      return res.session;
    },
orderLaunchCarrierStrike: (prev: WarSimSession, systemsLibrary: SystemSpec[], carrierEntityId: string, squadronEntityId: string, targetEntityId: string, targetLngLat: [number, number], weaponIndex = 0, salvoCount = 2): WarSimSession | null => {
      if (!prev) return null;
      const res = orderCarrierAirStrike(
        prev,
        carrierEntityId,
        squadronEntityId,
        targetEntityId,
        targetLngLat,
        weaponIndex,
        salvoCount,
        systemsLibrary
      );
      return res.session;
    },
};
