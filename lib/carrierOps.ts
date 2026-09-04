/**
 * Carrier Strike Group (CSG) & Moving Airbase Operations Engine
 *
 * Implements:
 * 1. Mobile Carrier Bases: Links moving carrier ship entities to dynamic carrier_group bases.
 * 2. Real-Time Moving Flight Deck Synchronization: Embarked aircraft on deck move with the carrier.
 * 3. Dynamic Return-To-Carrier (RTC) Trapping: Ingressing RTB jets track the carrier's moving coordinates,
 *    trap on arresting wires, rearm, and refuel on board.
 * 4. Carrier Air Wing Weapon Customization: Reconfigures squadron loadouts on board (CAP, ASuW, Land Strike, SEAD).
 * 5. Coordinated Carrier Strike Missions: Launches airstrikes and patrols directly from mobile carriers against enemy targets.
 * 6. Multi-Layered Escort Screen Defense: CSG cruisers, destroyers, and ASW frigates screen the carrier.
 * 7. After-Action CSG Combat Telemetry.
 */

import { distanceKm, bearingDeg, destination } from './geo';
import {
  type SimEntity,
  type SimBase,
  type MissileFlyoutTrack,
  type WarSimSession,
  type SimBattleEvent,
  type CombatReport,
} from './warSimTypes';
import { type SystemSpec, type WeaponFacet, domainOf } from './specs';
import { isNavalCombatant } from './navalEngagement';
import { isStaticAirDefense } from './warSimRules';

/* ------------------------------------------------------------------ */
/* 1. Identification & Loadout Presets                                */
/* ------------------------------------------------------------------ */

export function isCarrierPlatform(entity: SimEntity, spec?: SystemSpec): boolean {
  if (entity.isCarrier || entity.typeId === 'carrier') return true;
  const name = entity.name.toLowerCase();
  const sysName = (spec?.name || '').toLowerCase();
  return (
    name.includes('carrier') ||
    name.includes('cvn') ||
    name.includes('nimitz') ||
    name.includes('ford') ||
    name.includes('fujian') ||
    name.includes('queen elizabeth') ||
    name.includes('de gaulle') ||
    name.includes('liaoning') ||
    name.includes('shandong') ||
    name.includes('cavour') ||
    name.includes('vikrant') ||
    name.includes('izumo') ||
    name.includes('kuznetsov') ||
    sysName.includes('carrier') ||
    sysName.includes('cvn')
  );
}

export interface CarrierLoadoutPreset {
  id: string;
  name: string;
  description: string;
  role: 'cap' | 'asuw' | 'strike' | 'sead' | 'asw';
  weapons: WeaponFacet[];
}

export const CARRIER_LOADOUT_PRESETS: Record<string, CarrierLoadoutPreset> = {
  cap_air_superiority: {
    id: 'cap_air_superiority',
    name: '🛡️ Fleet Air Defense (CAP)',
    description: 'Long-range radar-guided BVR AMRAAM & High-Off-Boresight Sidewinder air interceptors.',
    role: 'cap',
    weapons: [
      {
        name: 'AIM-120D AMRAAM (BVR)',
        rangeKm: 160,
        speedMach: 4.0,
        magazine: 4,
        salvo: 2,
        pk: 0.88,
        reactionSec: 4,
        engages: ['air'],
      },
      {
        name: 'AIM-9X Block II Sidewinder',
        rangeKm: 35,
        speedMach: 2.7,
        magazine: 2,
        salvo: 1,
        pk: 0.85,
        reactionSec: 3,
        engages: ['air'],
      },
    ],
  },
  asuw_maritime_strike: {
    id: 'asuw_maritime_strike',
    name: '🚢 Anti-Surface Warfare (ASuW / Anti-Ship)',
    description: 'Stealth standoff Long-Range Anti-Ship Missiles (LRASM) for anti-ship strikes.',
    role: 'asuw',
    weapons: [
      {
        name: 'AGM-158C LRASM Anti-Ship Missile',
        rangeKm: 370,
        speedMach: 0.85,
        magazine: 2,
        salvo: 1,
        pk: 0.92,
        reactionSec: 8,
        engages: ['surface'],
      },
      {
        name: 'AIM-120D AMRAAM (Self-Defense)',
        rangeKm: 160,
        speedMach: 4.0,
        magazine: 2,
        salvo: 1,
        pk: 0.85,
        reactionSec: 4,
        engages: ['air'],
      },
    ],
  },
  strike_land_attack: {
    id: 'strike_land_attack',
    name: '💥 Precision Land Attack / Deep Strike',
    description: 'Standoff glide weapons & GPS/INS guided heavy penetration bombs.',
    role: 'strike',
    weapons: [
      {
        name: 'AGM-154C JSOW Standoff Glide Munition',
        rangeKm: 130,
        speedMach: 0.9,
        magazine: 2,
        salvo: 1,
        pk: 0.90,
        reactionSec: 6,
        engages: ['ground'],
      },
      {
        name: 'GBU-31 JDAM (2,000 lb GPS/INS)',
        rangeKm: 28,
        speedMach: 0.88,
        magazine: 2,
        salvo: 1,
        pk: 0.88,
        reactionSec: 5,
        engages: ['ground'],
      },
    ],
  },
  sead_radar_suppression: {
    id: 'sead_radar_suppression',
    name: '⚡ SEAD / DEAD Radar Suppression',
    description: 'High-Speed Anti-Radiation Missiles (AARGM-ER) targeting radiating SAM radars.',
    role: 'sead',
    weapons: [
      {
        name: 'AGM-88G AARGM-ER Anti-Radiation Missile',
        rangeKm: 240,
        speedMach: 3.5,
        magazine: 2,
        salvo: 1,
        pk: 0.92,
        reactionSec: 5,
        engages: ['ground'],
        isAntiRadiation: true,
      },
      {
        name: 'AIM-120D AMRAAM (Self-Defense)',
        rangeKm: 160,
        speedMach: 4.0,
        magazine: 2,
        salvo: 1,
        pk: 0.85,
        reactionSec: 4,
        engages: ['air'],
      },
    ],
  },
  asw_subsurface: {
    id: 'asw_subsurface',
    name: '🌊 Anti-Submarine Warfare (ASW)',
    description: 'Acoustic homing lightweight torpedoes & dipping sonar search equipment.',
    role: 'asw',
    weapons: [
      {
        name: 'Mk-54 Lightweight ASW Torpedo',
        rangeKm: 12,
        speedKnots: 45,
        magazine: 2,
        salvo: 1,
        pk: 0.82,
        reactionSec: 6,
        engages: ['subsurface'],
      },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* 2. Real-Time Mobile Carrier Base & Flight Deck Synchronization      */
/* ------------------------------------------------------------------ */

export function syncMovingCarrierBases(
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): {
  updatedBases: SimBase[];
  updatedEntities: SimEntity[];
  csgEvents: SimBattleEvent[];
} {
  const csgEvents: SimBattleEvent[] = [];
  const simTime = session.simTimeSec;

  // 1. Identify all aircraft carriers currently deployed on the map
  const carrierEntities = session.entities.filter((e) => {
    if (e.status === 'destroyed') return false;
    const spec = systemsLibrary.find((s) => s.id === e.systemId);
    return isCarrierPlatform(e, spec);
  });

  let workingBases = [...session.bases];
  let workingEntities = [...session.entities];

  // 2. Synchronize or create matching carrier_group bases for each mobile carrier
  for (const carrier of carrierEntities) {
    let carrierBase = workingBases.find(
      (b) => b.carrierEntityId === carrier.id || (b.type === 'carrier_group' && b.id === carrier.carrierBaseId)
    );

    if (!carrierBase) {
      // Auto-create a mobile carrier_group base linked to this carrier ship
      carrierBase = {
        id: `base-cvn-${carrier.id}`,
        name: `${carrier.name} Flight Deck`,
        iso: carrier.iso,
        type: 'carrier_group',
        lngLat: carrier.lngLat,
        maxCapacity: 48,
        stationedEntityIds: [],
        runwayStatus: 'operational',
        repairCountdownSec: 0,
        carrierEntityId: carrier.id,
        supplies: {
          fuelPct: 100,
          ammoPct: 100,
        },
      };
      workingBases.push(carrierBase);
    } else {
      // Keep base position continuously glued to the carrier ship's live location
      carrierBase.lngLat = carrier.lngLat;
      carrierBase.name = `${carrier.name} Flight Deck`;
    }

    // Ensure the carrier entity has its carrierBaseId and isCarrier set
    workingEntities = workingEntities.map((e) => {
      if (e.id === carrier.id) {
        return {
          ...e,
          isCarrier: true,
          carrierBaseId: carrierBase!.id,
        };
      }
      return e;
    });

    // 3. Move all aircraft stationed on this carrier along with the carrier ship
    workingEntities = workingEntities.map((e) => {
      const isStationedOnThisCarrier = e.homeBaseId === carrierBase!.id;

      if (!isStationedOnThisCarrier) return e;

      // If embarked on deck / in hangar, position moves synchronously with the ship
      if (e.status === 'docked' || e.status === 'turnaround' || e.status === 'in_repair') {
        return {
          ...e,
          lngLat: carrier.lngLat,
        };
      }

      // If on Return-To-Carrier (RTC), update recovery destination to live carrier location!
      if (e.status === 'bingo_rtb' || e.status === 'damaged_rtb') {
        const distToCarrier = distanceKm(e.lngLat, carrier.lngLat);

        // Within 3 km of carrier: Trap on arresting gear wire!
        if (distToCarrier <= 3.5) {
          csgEvents.push({
            id: `evt-trap-${Date.now()}-${e.id.slice(-4)}`,
            simTimeSec: simTime,
            timeFormatted: `${Math.floor(simTime / 60)}m`,
            faction: e.iso === session.playerIso ? 'player' : 'enemy',
            type: 'rtb',
            title: `🛬 Carrier Arrested Landing: ${e.name}`,
            detail: `${e.name} caught the 3-wire on ${carrier.name}'s flight deck. Commencing turnaround, re-fueling, and re-arming cycle.`,
            lngLat: carrier.lngLat,
          });

          return {
            ...e,
            status: 'turnaround',
            currentFuelPct: 100,
            lngLat: carrier.lngLat,
            homeBaseId: carrierBase!.id,
          };
        }
      }

      return e;
    });
  }

  return {
    updatedBases: workingBases,
    updatedEntities: workingEntities,
    csgEvents,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Carrier Air Wing Weapon Customization                           */
/* ------------------------------------------------------------------ */

export function applyCarrierAirWingLoadout(
  session: WarSimSession,
  squadronEntityId: string,
  presetKey: keyof typeof CARRIER_LOADOUT_PRESETS
): { session: WarSimSession; summary: string } {
  const preset = CARRIER_LOADOUT_PRESETS[presetKey];
  if (!preset) return { session, summary: 'Invalid loadout preset' };

  let aircraftName = 'Squadron';
  const updatedEntities = session.entities.map((e) => {
    if (e.id !== squadronEntityId) return e;
    aircraftName = e.name;
    return {
      ...e,
      customWeapons: preset.weapons.map((w) => ({ ...w })),
    };
  });

  return {
    session: {
      ...session,
      entities: updatedEntities,
    },
    summary: `${aircraftName} reconfigured with ${preset.name}`,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Multi-Layer Escort Screen Defense                               */
/* ------------------------------------------------------------------ */

export function getCarrierStrikeGroupScreen(
  carrier: SimEntity,
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): {
  carrier: SimEntity;
  airDefenseEscorts: SimEntity[];
  aswEscorts: SimEntity[];
  compositeSamRangeKm: number;
  compositeAswRangeKm: number;
} {
  const escorts = session.entities.filter((e) => {
    if (e.id === carrier.id || e.iso !== carrier.iso || e.status === 'destroyed') return false;
    const isNaval = isNavalCombatant(e.typeId);
    if (!isNaval) return false;
    const dist = distanceKm(carrier.lngLat, e.lngLat);
    return dist <= 65; // Within 65 km escort screen radius
  });

  let maxSamRange = 35; // Carrier self-defense (SeaRAM / ESSM)
  let maxAswRange = 15;

  const adEscorts: SimEntity[] = [];
  const aswEscorts: SimEntity[] = [];

  for (const escort of escorts) {
    const spec = systemsLibrary.find((s) => s.id === escort.systemId);
    const weapons = escort.customWeapons || spec?.weapons || [];

    let hasAreaSam = false;
    let hasAsw = false;

    for (const w of weapons) {
      if (w.engages?.includes('air') && w.rangeKm > 50) {
        hasAreaSam = true;
        if (w.rangeKm > maxSamRange) maxSamRange = w.rangeKm;
      }
      if (w.engages?.includes('subsurface')) {
        hasAsw = true;
        if (w.rangeKm > maxAswRange) maxAswRange = w.rangeKm;
      }
    }

    if (hasAreaSam) adEscorts.push(escort);
    if (hasAsw) aswEscorts.push(escort);
  }

  return {
    carrier,
    airDefenseEscorts: adEscorts,
    aswEscorts,
    compositeSamRangeKm: maxSamRange,
    compositeAswRangeKm: maxAswRange,
  };
}

/* ------------------------------------------------------------------ */
/* 5. Launch Standoff Strike Mission from Moving Carrier              */
/* ------------------------------------------------------------------ */

export function launchCarrierAirStrike(
  session: WarSimSession,
  carrierEntityId: string,
  squadronEntityId: string,
  targetEntityId: string,
  targetLngLat: [number, number],
  weaponIndex = 0,
  salvoCount = 2,
  systemsLibrary: SystemSpec[] = []
): {
  session: WarSimSession;
  status: 'launched' | 'failed';
  summary: string;
} {
  const carrier = session.entities.find((e) => e.id === carrierEntityId);
  const squadron = session.entities.find((e) => e.id === squadronEntityId);
  const target = session.entities.find((e) => e.id === targetEntityId);

  if (!carrier || carrier.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Carrier ship unavailable or sunk' };
  }
  if (!squadron || squadron.status === 'destroyed') {
    return { session, status: 'failed', summary: 'Squadron aircraft unavailable' };
  }

  const spec = systemsLibrary.find((s) => s.id === squadron.systemId);
  const weapons = squadron.customWeapons || spec?.weapons || [];
  const weapon = weapons[weaponIndex] || weapons[0];

  if (!weapon) {
    return { session, status: 'failed', summary: 'No viable strike weapon equipped' };
  }

  const distKm = distanceKm(carrier.lngLat, targetLngLat);
  const totalStrikeRadiusKm = 1100; // Fighter combat radius + weapon standoff range

  if (distKm > totalStrikeRadiusKm) {
    return {
      session,
      status: 'failed',
      summary: `Target is beyond carrier air wing operational radius (${distKm.toFixed(0)} km > max ${totalStrikeRadiusKm} km)`,
    };
  }

  const flyoutSpeedKmh = Math.max(900, (weapon.speedMach ?? 0.85) * 1225);
  const tFlySec = Math.max(20, Math.round((distKm / flyoutSpeedKmh) * 3600));

  const isPlayer = carrier.iso === session.playerIso;
  const isAntiRadiation = Boolean(weapon.isAntiRadiation);

  const strikeMissiles: MissileFlyoutTrack[] = [];
  for (let i = 0; i < salvoCount; i++) {
    strikeMissiles.push({
      id: `msl-cvw-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      originLngLat: carrier.lngLat,
      targetLngLat: targetLngLat,
      currentLngLat: carrier.lngLat,
      attackerEntityId: squadron.id,
      targetEntityId: target?.id || targetEntityId,
      attackerIso: carrier.iso,
      targetIso: target?.iso || (isPlayer ? session.enemyIso : session.playerIso),
      weaponName: weapon.name || 'Carrier Standoff Munition',
      weaponCategory: weapon.engages?.includes('surface') ? 'cruise' : weapon.engages?.includes('ground') ? 'bomb' : 'air_to_air',
      speedKmh: flyoutSpeedKmh,
      startSimTimeSec: session.simTimeSec,
      etaSimTimeSec: session.simTimeSec + tFlySec,
      isIntercepted: false,
      progress: 0.0,
      interceptorPk: weapon.pk ?? 0.88,
      isAntiRadiation,
    });
  }

  const newEvents: SimBattleEvent[] = [
    ...session.eventLog,
    {
      id: `evt-cvw-launch-${Date.now()}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: `${Math.floor(session.simTimeSec / 60)}m`,
      faction: isPlayer ? 'player' : 'enemy',
      type: 'strike',
      title: `🚀 Carrier Strike Launched: ${carrier.name}`,
      detail: `${squadron.name} catapult-launched ${salvoCount} × ${weapon.name} against ${target?.name || 'Target'} at ${distKm.toFixed(0)} km standoff.`,
      lngLat: carrier.lngLat,
    },
  ];

  return {
    session: {
      ...session,
      activeMissiles: [...session.activeMissiles, ...strikeMissiles],
      eventLog: newEvents.slice(-200),
    },
    status: 'launched',
    summary: `${salvoCount} × ${weapon.name} launched from ${carrier.name}`,
  };
}

/* ------------------------------------------------------------------ */
/* 6. After-Action Carrier Strike Group Combat Reporting              */
/* ------------------------------------------------------------------ */

export function createCsgCombatReport(
  session: WarSimSession,
  systemsLibrary: SystemSpec[] = []
): NonNullable<CombatReport['csgDetails']> {
  const carriers = session.entities.filter((e) => isCarrierPlatform(e, systemsLibrary.find((s) => s.id === e.systemId)));
  const carrierMissiles = (session.activeMissiles || []).filter((m) => m.id.startsWith('msl-cvw-'));
  const traps = (session.eventLog || []).filter((e) => e.type === 'rtb' && e.title.includes('Carrier Arrested Landing'));

  let assessment = 'Carrier Strike Groups maintained maritime sea-control with mobile air wings conducting cyclic flight ops.';
  if (carriers.length > 0) {
    assessment = `Active Naval Airpower: ${carriers.length} aircraft carriers operated as mobile sovereign airbases, executing ${carrierMissiles.length} standoff strike sorties with ${traps.length} successful flight deck arrested landings.`;
  }

  return {
    totalCarrierSorties: carrierMissiles.length + traps.length,
    carrierTrapsCompleted: traps.length,
    carrierStrikesLaunched: carrierMissiles.length,
    escortInterceptionsCount: 0,
    csgAssessment: assessment,
    carrierEvents: carriers.map((c) => ({
      carrierName: c.name,
      event: '🚢 Mobile Sea Base & Escort Screen Operations Active',
      aircraftName: 'Carrier Air Wing (CVW)',
      simTimeSec: session.simTimeSec,
    })),
  };
}
