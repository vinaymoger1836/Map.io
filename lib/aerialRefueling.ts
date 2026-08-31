/**
 * Combat Air Refueling (AAR) & Strategic Tanker Tracks Engine
 *
 * Implements high-fidelity aerial refueling physics, tanker orbit tracking,
 * receiver rendezvous navigation, boom/drogue fuel transfer, and emergency
 * bingo fuel rescue logistics.
 */

import {
  type SimEntity,
  type WarSimSession,
  type CombatReport,
} from './warSimTypes';
import {
  type SystemSpec,
  defaultTankerSpecsFor,
  defaultReceiverFuelFor,
} from './specs';
import { distanceKm, destination } from './geo';

/**
 * Initializes tanker-specific operational logistics on a SimEntity.
 */
export function initTankerState(
  entity: SimEntity,
  spec?: SystemSpec,
  orbitLengthKm = 80,
  orbitHeadingDeg = 90
): SimEntity['tankerState'] {
  const tankerSpecs = defaultTankerSpecsFor(spec, entity.typeId);
  return {
    offloadRemainingKg: tankerSpecs.fuelOffloadableKg,
    totalOffloadCapacityKg: tankerSpecs.fuelOffloadableKg,
    fuelOffloadRateKgPerMin: tankerSpecs.fuelOffloadRateKgPerMin,
    refuelingMethod: tankerSpecs.refuelingMethod,
    activeReceivers: [],
    maxReceivers: tankerSpecs.maxReceivers,
    orbitLengthKm,
    orbitHeadingDeg,
    totalTransferredKg: 0,
    sortiesServiced: 0,
    rescuedBingoCount: 0,
  };
}

/**
 * Generates a military standard racetrack polygon/linestring for an AAR Anchor Orbit.
 * Consists of two parallel straight legs of length `lengthKm` connected by two 180° turns of radius `turnRadiusKm`.
 */
export function generateAarRacetrackCoordinates(
  centerLngLat: [number, number],
  lengthKm = 80,
  turnRadiusKm = 15,
  headingDeg = 90,
  numTurnPoints = 8
): [number, number][] {
  const halfLen = lengthKm / 2;

  // Center points of the two semi-circle end turns
  const end1Center = destination(centerLngLat, halfLen, (headingDeg + 180) % 360);
  const end2Center = destination(centerLngLat, halfLen, headingDeg);

  const coords: [number, number][] = [];

  // 1. Straight leg 1: Right inbound leg
  const p1 = destination(end1Center, turnRadiusKm, (headingDeg + 90) % 360);
  const p2 = destination(end2Center, turnRadiusKm, (headingDeg + 90) % 360);
  coords.push(p1, p2);

  // 2. Turn 2: 180° semi-circle around end2Center
  for (let i = 1; i <= numTurnPoints; i++) {
    const angle = (headingDeg + 90 - (180 / numTurnPoints) * i) % 360;
    coords.push(destination(end2Center, turnRadiusKm, (angle + 360) % 360));
  }

  // 3. Straight leg 2: Left outbound leg
  const p3 = destination(end2Center, turnRadiusKm, (headingDeg + 270) % 360);
  const p4 = destination(end1Center, turnRadiusKm, (headingDeg + 270) % 360);
  coords.push(p3, p4);

  // 4. Turn 1: 180° semi-circle around end1Center to close the loop
  for (let i = 1; i <= numTurnPoints; i++) {
    const angle = (headingDeg + 270 - (180 / numTurnPoints) * i) % 360;
    coords.push(destination(end1Center, turnRadiusKm, (angle + 360) % 360));
  }

  // Close loop
  coords.push(coords[0]);
  return coords;
}

/**
 * Evaluates hardware compatibility between a tanker and a receiver aircraft.
 */
export function isAarCompatible(
  tankerMethod: 'boom' | 'probe_and_drogue' | 'universal',
  receiverMethod: 'boom' | 'probe_and_drogue' | 'universal'
): boolean {
  if (tankerMethod === 'universal' || receiverMethod === 'universal') return true;
  return tankerMethod === receiverMethod;
}

/**
 * Finds the optimal friendly tanker in theater for an aircraft seeking in-flight refueling.
 */
export function findBestTankerForReceiver(
  session: WarSimSession,
  receiver: SimEntity,
  systemsLibrary: SystemSpec[]
): {
  tanker: SimEntity | null;
  distanceKm: number;
  rendezvousEtaMin: number;
  availableFuelKg: number;
  isReachable: boolean;
} {
  const receiverSpec = systemsLibrary.find((s) => s.id === receiver.systemId);
  const receiverAar = defaultReceiverFuelFor(receiverSpec, receiver.typeId);

  if (!receiverAar.canAerialRefuel) {
    return { tanker: null, distanceKm: Infinity, rendezvousEtaMin: Infinity, availableFuelKg: 0, isReachable: false };
  }

  const speedKmh = receiver.speedKmh > 0 ? receiver.speedKmh : (receiverSpec?.platform?.speedKmh ?? 850);
  const combatRadiusKm = receiverSpec?.platform?.combatRadiusKm ?? 900;

  // Find all active on-station tankers for this faction
  const friendlyTankers = session.entities.filter(
    (e) =>
      e.iso === receiver.iso &&
      e.id !== receiver.id &&
      (e.typeId === 'tanker' || e.name.toLowerCase().includes('tanker')) &&
      e.status === 'on_station' &&
      (e.tankerState?.offloadRemainingKg ?? 0) > 1000
  );

  let bestTanker: SimEntity | null = null;
  let minDistance = Infinity;

  for (const tanker of friendlyTankers) {
    const tankerSpec = systemsLibrary.find((s) => s.id === tanker.systemId);
    const tankerCapabilities = defaultTankerSpecsFor(tankerSpec, tanker.typeId);
    const tankerMethod = tanker.tankerState?.refuelingMethod ?? tankerCapabilities.refuelingMethod;

    if (!isAarCompatible(tankerMethod, receiverAar.refuelMethod)) continue;

    // Check if slots are available
    const activeSlots = tanker.tankerState?.activeReceivers?.length ?? 0;
    const maxSlots = tanker.tankerState?.maxReceivers ?? tankerCapabilities.maxReceivers;
    if (activeSlots >= maxSlots) continue;

    const d = distanceKm(receiver.lngLat, tanker.lngLat);
    if (d < minDistance) {
      minDistance = d;
      bestTanker = tanker;
    }
  }

  if (!bestTanker) {
    return { tanker: null, distanceKm: Infinity, rendezvousEtaMin: Infinity, availableFuelKg: 0, isReachable: false };
  }

  const etaHours = minDistance / Math.max(100, speedKmh);
  const rendezvousEtaMin = Math.round(etaHours * 60);

  // Check fuel reachability: Does receiver have enough fuel to reach tanker?
  const fuelBurnNeededPct = (minDistance / (combatRadiusKm * 2)) * 100;
  const isReachable = receiver.currentFuelPct > fuelBurnNeededPct + 5; // 5% reserve margin

  return {
    tanker: bestTanker,
    distanceKm: minDistance,
    rendezvousEtaMin,
    availableFuelKg: bestTanker.tankerState?.offloadRemainingKg ?? 40000,
    isReachable,
  };
}

/**
 * Evaluates whether an aircraft that hit Bingo Fuel should divert to a Tanker instead of RTB to base.
 */
export function evaluateEmergencyBingoRescue(
  session: WarSimSession,
  receiver: SimEntity,
  homeBaseLngLat: [number, number],
  systemsLibrary: SystemSpec[]
): {
  shouldDivertToTanker: boolean;
  tanker: SimEntity | null;
  distanceToTankerKm: number;
  distanceToBaseKm: number;
} {
  const distToBase = distanceKm(receiver.lngLat, homeBaseLngLat);
  const bestTankerResult = findBestTankerForReceiver(session, receiver, systemsLibrary);

  if (!bestTankerResult.tanker || !bestTankerResult.isReachable) {
    return {
      shouldDivertToTanker: false,
      tanker: null,
      distanceToTankerKm: bestTankerResult.distanceKm,
      distanceToBaseKm: distToBase,
    };
  }

  // If tanker is significantly closer or reachable while home base is dangerously far:
  if (bestTankerResult.distanceKm < distToBase * 0.85 || receiver.currentFuelPct < 15) {
    return {
      shouldDivertToTanker: true,
      tanker: bestTankerResult.tanker,
      distanceToTankerKm: bestTankerResult.distanceKm,
      distanceToBaseKm: distToBase,
    };
  }

  return {
    shouldDivertToTanker: false,
    tanker: bestTankerResult.tanker,
    distanceToTankerKm: bestTankerResult.distanceKm,
    distanceToBaseKm: distToBase,
  };
}

/**
 * Steps fuel transfer physics for an aircraft hooked up to a tanker boom or drogue.
 */
export function stepAerialRefuelingTransfer(
  receiver: SimEntity,
  tanker: SimEntity,
  dtSimSec: number,
  systemsLibrary: SystemSpec[]
): {
  updatedReceiver: SimEntity;
  updatedTanker: SimEntity;
  fuelTransferredKg: number;
  isComplete: boolean;
  reason?: 'topped_off' | 'tanker_empty' | 'aborted';
} {
  const receiverSpec = systemsLibrary.find((s) => s.id === receiver.systemId);
  const receiverAar = defaultReceiverFuelFor(receiverSpec, receiver.typeId);

  const tankerSpec = systemsLibrary.find((s) => s.id === tanker.systemId);
  const tankerCapabilities = defaultTankerSpecsFor(tankerSpec, tanker.typeId);

  const flowRateKgPerMin = tanker.tankerState?.fuelOffloadRateKgPerMin ?? tankerCapabilities.fuelOffloadRateKgPerMin;
  const flowRateKgPerSec = flowRateKgPerMin / 60;

  const targetFuelPct = receiver.refuelingState?.targetFuelPct ?? 100;
  const receiverCapKg = receiverAar.fuelCapacityKg;

  // Max fuel transferable in this simulation tick
  const maxPossibleTransferKg = flowRateKgPerSec * dtSimSec;

  // Remaining fuel needed by receiver to hit target %
  const currentReceiverFuelKg = (receiver.currentFuelPct / 100) * receiverCapKg;
  const targetReceiverFuelKg = (targetFuelPct / 100) * receiverCapKg;
  const fuelNeededKg = Math.max(0, targetReceiverFuelKg - currentReceiverFuelKg);

  // Available fuel in tanker transfer reservoir
  const tankerAvailKg = tanker.tankerState?.offloadRemainingKg ?? tankerCapabilities.fuelOffloadableKg;

  // Actual transferred fuel
  const actualTransferKg = Math.min(maxPossibleTransferKg, fuelNeededKg, tankerAvailKg);

  // Calculate new percentages and kilograms
  const nextReceiverFuelKg = currentReceiverFuelKg + actualTransferKg;
  const nextReceiverFuelPct = Math.min(targetFuelPct, (nextReceiverFuelKg / receiverCapKg) * 100);

  const nextTankerAvailKg = Math.max(0, tankerAvailKg - actualTransferKg);
  const nextTankerTotalTransferred = (tanker.tankerState?.totalTransferredKg ?? 0) + actualTransferKg;

  const isReceiverFull = nextReceiverFuelPct >= targetFuelPct;
  const isTankerDry = nextTankerAvailKg <= 0;

  const isComplete = isReceiverFull || isTankerDry;

  // Update Tanker Active Receivers list
  let nextActiveReceivers = tanker.tankerState?.activeReceivers ?? [];
  let nextSortiesServiced = tanker.tankerState?.sortiesServiced ?? 0;
  let nextRescuedBingo = tanker.tankerState?.rescuedBingoCount ?? 0;

  if (isComplete) {
    nextActiveReceivers = nextActiveReceivers.filter((id) => id !== receiver.id);
    nextSortiesServiced += 1;
    if (receiver.refuelingState?.wasBingoRescue) {
      nextRescuedBingo += 1;
    }
  } else if (!nextActiveReceivers.includes(receiver.id)) {
    nextActiveReceivers = [...nextActiveReceivers, receiver.id];
  }

  const updatedTanker: SimEntity = {
    ...tanker,
    tankerState: {
      offloadRemainingKg: nextTankerAvailKg,
      totalOffloadCapacityKg: tanker.tankerState?.totalOffloadCapacityKg ?? tankerCapabilities.fuelOffloadableKg,
      fuelOffloadRateKgPerMin: flowRateKgPerMin,
      refuelingMethod: tanker.tankerState?.refuelingMethod ?? tankerCapabilities.refuelingMethod,
      activeReceivers: nextActiveReceivers,
      maxReceivers: tanker.tankerState?.maxReceivers ?? tankerCapabilities.maxReceivers,
      orbitLengthKm: tanker.tankerState?.orbitLengthKm ?? 80,
      orbitHeadingDeg: tanker.tankerState?.orbitHeadingDeg ?? 90,
      totalTransferredKg: nextTankerTotalTransferred,
      sortiesServiced: nextSortiesServiced,
      rescuedBingoCount: nextRescuedBingo,
    },
  };

  // If complete, restore receiver's previous or appropriate status
  let nextReceiverStatus = receiver.status;
  let nextPatrolOrder = receiver.patrolOrder;
  let nextStrikePlan = receiver.strikePlan;

  if (isComplete) {
    if (receiver.refuelingState?.preRefuelStrikePlan) {
      nextReceiverStatus = 'takeoff_ingress';
      nextStrikePlan = receiver.refuelingState.preRefuelStrikePlan;
    } else if (receiver.refuelingState?.preRefuelPatrolOrder) {
      nextReceiverStatus = 'takeoff_ingress';
      nextPatrolOrder = receiver.refuelingState.preRefuelPatrolOrder;
    } else if (receiver.refuelingState?.preRefuelStatus) {
      nextReceiverStatus = receiver.refuelingState.preRefuelStatus;
    } else {
      nextReceiverStatus = 'on_station';
    }
  }

  const updatedReceiver: SimEntity = {
    ...receiver,
    currentFuelPct: nextReceiverFuelPct,
    status: isComplete ? nextReceiverStatus : 'aar_refueling',
    patrolOrder: isComplete ? nextPatrolOrder : receiver.patrolOrder,
    strikePlan: isComplete ? nextStrikePlan : receiver.strikePlan,
    refuelingState: isComplete
      ? undefined
      : {
          tankerEntityId: tanker.id,
          stage: 'hooked',
          targetFuelPct,
          flowRateKgPerSec,
          fuelReceivedKg: (receiver.refuelingState?.fuelReceivedKg ?? 0) + actualTransferKg,
          preRefuelStatus: receiver.refuelingState?.preRefuelStatus ?? 'on_station',
          preRefuelPatrolOrder: receiver.refuelingState?.preRefuelPatrolOrder,
          preRefuelStrikePlan: receiver.refuelingState?.preRefuelStrikePlan,
          wasBingoRescue: receiver.refuelingState?.wasBingoRescue,
          durationSec: (receiver.refuelingState?.durationSec ?? 0) + dtSimSec,
        },
  };

  return {
    updatedReceiver,
    updatedTanker,
    fuelTransferredKg: actualTransferKg,
    isComplete,
    reason: isReceiverFull ? 'topped_off' : isTankerDry ? 'tanker_empty' : undefined,
  };
}

/**
 * Creates a formal Combat Report for an Aerial Refueling mission completion or emergency rescue.
 */
export function createAarCombatReport(
  session: WarSimSession,
  tanker: SimEntity,
  receiver: SimEntity,
  fuelTransferredKg: number,
  durationSec: number,
  wasEmergencyBingoRescue: boolean,
  preRefuelFuelPct: number,
  postRefuelFuelPct: number,
  systemsLibrary: SystemSpec[]
): CombatReport {
  const receiverSpec = systemsLibrary.find((s) => s.id === receiver.systemId);
  const tankerSpec = systemsLibrary.find((s) => s.id === tanker.systemId);
  const combatRadiusKm = receiverSpec?.platform?.combatRadiusKm ?? 900;
  const refuelledRadiusKm = receiverSpec?.platform?.refuelledRadiusKm ?? combatRadiusKm * 1.75;
  const extensionKm = Math.round(refuelledRadiusKm - combatRadiusKm);

  const tankerSpecs = defaultTankerSpecsFor(tankerSpec, tanker.typeId);

  const title = wasEmergencyBingoRescue
    ? `🚨 EMERGENCY AAR RESCUE: ${tanker.name} ➔ ${receiver.name}`
    : `⛽ COMBAT AIR REFUELING: ${tanker.name} ➔ ${receiver.name}`;

  const summary = wasEmergencyBingoRescue
    ? `${receiver.name} was rescued from flameout at ${preRefuelFuelPct.toFixed(1)}% fuel by ${tanker.name}. Offloaded ${fuelTransferredKg.toFixed(0)} kg of JP-8 jet fuel in ${Math.round(durationSec)}s, restoring fuel to ${postRefuelFuelPct.toFixed(0)}%.`
    : `${tanker.name} completed scheduled in-flight refueling with ${receiver.name}. Offloaded ${fuelTransferredKg.toFixed(0)} kg of fuel via ${tankerSpecs.refuelingMethod.toUpperCase()} transfer, extending operational combat radius by +${extensionKm} km.`;

  return {
    id: `rpt-aar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    simTimeSec: session.simTimeSec,
    timeFormatted: new Date(session.simTimeSec * 1000).toISOString().slice(11, 19),
    category: 'aar_logistics',
    title,
    summary,
    countryIso: receiver.iso,
    faction: receiver.iso === session.playerIso ? 'player' : 'enemy',
    lngLat: receiver.lngLat,
    primaryEntity: {
      id: tanker.id,
      name: tanker.name,
      typeId: tanker.typeId,
      domain: 'air',
      iso: tanker.iso,
      isFriendly: tanker.iso === session.playerIso,
      isPID: true,
      count: tanker.count,
    },
    opposingEntity: {
      id: receiver.id,
      name: receiver.name,
      typeId: receiver.typeId,
      domain: 'air',
      iso: receiver.iso,
      isFriendly: receiver.iso === session.playerIso,
      isPID: true,
      count: receiver.count,
    },
    aarDetails: {
      tankerName: tanker.name,
      tankerIso: tanker.iso,
      receiverName: receiver.name,
      receiverType: receiver.typeId,
      refuelingMethod: tankerSpecs.refuelingMethod,
      fuelOffloadedKg: Math.round(fuelTransferredKg),
      durationSec: Math.round(durationSec),
      preRefuelFuelPct: Math.round(preRefuelFuelPct),
      postRefuelFuelPct: Math.round(postRefuelFuelPct),
      wasEmergencyBingoRescue,
      combatRadiusExtensionKm: extensionKm,
      logisticsAssessment: wasEmergencyBingoRescue
        ? `CRITICAL RESCUE: Aircraft avoided combat loss/forced ditching through rapid airborne rendezvous.`
        : `TACTICAL SUCCESS: Strike package combat radius extended into deep theater targets without staging ground airfields.`,
    },
  };
}
