/**
 * War Simulation Execution & Kinematics Engine
 *
 * Drives real-time base-anchored simulation updates:
 * 1. Time-step clock with adjustable acceleration (1x, 3x, 5x, 10x, 30x).
 * 2. Physical kinematics (Takeoff -> Ingress -> Loiter Orbit -> Bingo RTB -> Refuel).
 * 3. Base anchoring & quota-constrained deployments.
 * 4. In-flight missile flyouts and point-defense damage resolution.
 * 5. Dynamic sensor sweeps and fog-of-war contact tracking.
 */

import {
  distanceKm,
  destination,
  interpolate,
  bearingDeg,
} from './geo';
import {
  type WarSimSession,
  type SimEntity,
  type SimBase,
  type BaseType,
  type DetectedContact,
  type MissileFlyoutTrack,
  type SimBattleEvent,
  type CombatReport,
  type PatrolOrder,
  type PostStrikeAction,
  type StrikePlan,
} from './warSimTypes';
import {
  canStationAtBase,
  defaultBaseCapacity,
  calculateFuelBurnPct,
  calculateBingoFuelThreshold,
  isGroundCombatUnit,
  isStaticAirDefense,
  canWeaponEngageTarget,
} from './warSimRules';
import { isNavalCombatant } from './navalEngagement';
import {
  type SystemSpec,
  type WeaponFacet,
  domainOf,
  radarHorizonKm,
  defaultSonarFor,
  signatureRangeMultiplier,
  calculateDetectionRange,
  getSystemRcs,
  RCS_BASELINE_M2,
} from './specs';

/* ------------------------------------------------------------------ */
/* 1. Time-Step Clock & Master Engine Loop                            */
/* ------------------------------------------------------------------ */

export function formatSimTime(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  return `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getContactPID(
  entityId: string,
  observerFaction: 'player' | 'enemy',
  contacts: { playerContacts: DetectedContact[]; enemyContacts: DetectedContact[] }
): { isPID: boolean; knownName?: string; intelTier: number } {
  const contactList = observerFaction === 'player' ? contacts.playerContacts : contacts.enemyContacts;
  const c = contactList.find((item) => item.targetEntityId === entityId);
  return {
    isPID: c?.intelTier === 2,
    knownName: c?.knownName,
    intelTier: c?.intelTier ?? 0,
  };
}

export function tickWarSim(
  session: WarSimSession,
  dtRealSec: number,
  systemsLibrary: SystemSpec[]
): WarSimSession {
  if (session.status !== 'running') {
    return session;
  }

  // Calculate accelerated simulation time delta
  const dtSimSec = dtRealSec * (session.timeMultiplier || 3);
  const newSimTimeSec = session.simTimeSec + dtSimSec;
  const timeFormatted = formatSimTime(newSimTimeSec);

  const newEvents: SimBattleEvent[] = [...session.eventLog];
  const newReports: CombatReport[] = [...(session.reports || [])];

  const logEvent = (
    faction: 'player' | 'enemy' | 'neutral',
    type: SimBattleEvent['type'],
    title: string,
    detail: string,
    lngLat?: [number, number]
  ) => {
    newEvents.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: newSimTimeSec,
      timeFormatted,
      faction,
      type,
      title,
      detail,
      lngLat,
    });
  };

  const logReport = (report: Omit<CombatReport, 'id' | 'simTimeSec' | 'timeFormatted'>) => {
    newReports.push({
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      simTimeSec: newSimTimeSec,
      timeFormatted,
      ...report,
    });
  };

  // -------------------------------------------------------------
  // 1. Update Bases (Repairs & Status)
  // -------------------------------------------------------------
  const updatedBases: SimBase[] = session.bases.map((base) => {
    if (base.repairCountdownSec > 0) {
      const nextRepair = Math.max(0, base.repairCountdownSec - dtSimSec);
      const nextStatus = nextRepair === 0 ? 'operational' : base.runwayStatus;
      if (nextRepair === 0 && base.runwayStatus !== 'operational') {
        logEvent(
          base.iso === session.playerIso ? 'player' : 'enemy',
          'repair',
          `Base Repaired: ${base.name}`,
          `${base.name} runway and facilities restored to operational status.`,
          base.lngLat
        );
      }
      return {
        ...base,
        repairCountdownSec: nextRepair,
        runwayStatus: nextStatus,
      };
    }
    return base;
  });

  // -------------------------------------------------------------
  // 2. Identify Airborne Tanker Refueling Bubbles
  // -------------------------------------------------------------
  const playerTankers = session.entities.filter(
    (e) => e.iso === session.playerIso && e.status === 'on_station' && e.typeId === 'tanker'
  );
  const enemyTankers = session.entities.filter(
    (e) => e.iso === session.enemyIso && e.status === 'on_station' && e.typeId === 'tanker'
  );

  const hasTankerSupport = (entity: SimEntity): boolean => {
    const tankers = entity.iso === session.playerIso ? playerTankers : enemyTankers;
    return tankers.some((t) => distanceKm(entity.lngLat, t.lngLat) <= 250);
  };

  // -------------------------------------------------------------
  // 3. Update Entities (Kinematics, Orbit, Fuel, Lifecycle)
  // -------------------------------------------------------------
  const updatedEntities: SimEntity[] = session.entities.map((entity) => {
    if (entity.status === 'destroyed') return entity;

    const spec = systemsLibrary.find((s) => s.id === entity.systemId);
    const combatRadiusKm = spec?.platform?.combatRadiusKm ?? (entity.typeId === 'fighter' ? 900 : 1500);
    const speedKmh = entity.speedKmh > 0 ? entity.speedKmh : (spec?.platform?.speedKmh ?? 850);
    const homeBase = updatedBases.find((b) => b.id === entity.homeBaseId);
    let homeLngLat = homeBase?.lngLat;
    if (!homeLngLat) {
      const friendlyBases = updatedBases.filter((b) => b.iso === entity.iso);
      if (friendlyBases.length > 0) {
        let nearestDist = Infinity;
        let nearestCoord = friendlyBases[0].lngLat;
        for (const fb of friendlyBases) {
          const d = distanceKm(entity.lngLat, fb.lngLat);
          if (d < nearestDist) {
            nearestDist = d;
            nearestCoord = fb.lngLat;
          }
        }
        homeLngLat = nearestCoord;
      } else {
        homeLngLat = entity.lngLat;
      }
    }

    // Fuel multiplier (tanker support cuts burn rate in half)
    const fuelRateMult = hasTankerSupport(entity) ? 0.5 : 1.0;

    // A. Base Repairs Countdown
    if (entity.status === 'in_repair') {
      const nextTimer = Math.max(0, entity.repairTimerSec - dtSimSec);
      if (nextTimer === 0) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'repair',
          `Unit Repaired: ${entity.name}`,
          `${entity.name} repairs completed at home base. Ready for sortie.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'docked',
          damage: 'intact',
          repairTimerSec: 0,
          currentFuelPct: 100,
        };
      }
      return { ...entity, repairTimerSec: nextTimer };
    }

    // B. Base Turnaround / Refueling & Re-Arming Countdown
    if (entity.status === 'turnaround') {
      const nextTimer = Math.max(0, entity.turnaroundTimerSec - dtSimSec);
      if (nextTimer === 0) {
        const spec = systemsLibrary.find((s) => s.id === entity.systemId);
        const restoredWeapons = entity.customWeapons && entity.customWeapons.length > 0
          ? entity.customWeapons.map((w, idx) => {
              const specMag = spec?.weapons?.[idx]?.magazine ?? w.magazine ?? 2;
              return { ...w, magazine: specMag };
            })
          : (spec?.weapons ? spec.weapons.map((w) => ({ ...w })) : []);

        // If the platform was on an active patrol mission before bingo RTB, automatically resume patrol!
        if (entity.patrolOrder) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'rtb',
            `Patrol Resumed: ${entity.name}`,
            `${entity.name} completed refueling and re-arming at ${homeBase?.name ?? 'Base'}. Scrambling back to resume assigned patrol route.`,
            homeLngLat
          );

          return {
            ...entity,
            status: 'takeoff_ingress',
            turnaroundTimerSec: 0,
            currentFuelPct: 100,
            customWeapons: restoredWeapons,
            altitudeM: entity.patrolOrder.altitudeM || (isGroundCombatUnit(entity.typeId) ? 0 : 7000),
          };
        }

        return {
          ...entity,
          status: 'docked',
          turnaroundTimerSec: 0,
          currentFuelPct: 100,
          customWeapons: restoredWeapons,
        };
      }
      return { ...entity, turnaroundTimerSec: nextTimer };
    }

    // C. Stationary / Docked at Base
    if (entity.status === 'docked') {
      return { ...entity, lngLat: homeLngLat };
    }

    // D. Takeoff Ingress towards Patrol Center
    if (entity.status === 'takeoff_ingress' && entity.patrolOrder) {
      const targetPos = entity.patrolOrder.centerLngLat;
      const distToTarget = distanceKm(entity.lngLat, targetPos);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      // Fuel burn during ingress
      const fuelBurn = calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel threshold
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Bingo Fuel Triggered: ${entity.name}`,
          `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Returning to Base.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
        };
      }

      const isGround = isGroundCombatUnit(entity.typeId);
      const effectiveAlt = isGround ? 0 : entity.altitudeM;

      if (distToTarget <= Math.max(isGround ? 4 : 8, stepDistanceKm)) {
        // Arrived at destination / station
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'rtb',
          isGround ? `Unit In Position: ${entity.name}` : `On Station: ${entity.name}`,
          isGround
            ? `${entity.name} arrived at destination coordinates and assumed defensive posture.`
            : `${entity.name} established patrol orbit at designated coordinates.`,
          targetPos
        );
        return {
          ...entity,
          lngLat: targetPos,
          status: 'on_station',
          altitudeM: effectiveAlt,
          currentFuelPct: nextFuel,
        };
      }

      // Move along great circle
      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToTarget));
      const nextLngLat = interpolate(entity.lngLat, targetPos, fraction);
      const nextHeading = bearingDeg(entity.lngLat, targetPos);

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        altitudeM: effectiveAlt,
        currentFuelPct: nextFuel,
      };
    }

    // E. On Station / Holding Position / Multi-Waypoint Route Patrol
    if (entity.status === 'on_station' && entity.patrolOrder) {
      const isGround = isGroundCombatUnit(entity.typeId);
      const isStaticAD = isStaticAirDefense(entity.typeId);
      const { centerLngLat, patrolRadiusKm, orbitAngleDeg, routeType, waypoints } = entity.patrolOrder;

      // Ground formations & static batteries stay stationary at designated ground position
      if (isGround || isStaticAD) {
        return {
          ...entity,
          lngLat: centerLngLat,
          altitudeM: 0,
        };
      }

      // E.1. Custom Multi-Waypoint Route Navigation (WP1 -> WP2 -> WP3 ... -> WPN -> in reverse)
      if (routeType === 'waypoints' && waypoints && waypoints.length >= 2) {
        const currentIdx = Math.max(0, Math.min(waypoints.length - 1, entity.patrolOrder.currentWaypointIdx ?? 1));
        const direction = entity.patrolOrder.patrolDirection ?? 1;
        const targetWp = waypoints[currentIdx] || waypoints[0];

        const distToWp = distanceKm(entity.lngLat, targetWp);
        const stepDistKm = (speedKmh / 3600) * dtSimSec;

        // Route flight fuel consumption
        const fuelBurn = calculateFuelBurnPct(stepDistKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
        const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

        // Check Bingo Fuel
        const distToBase = distanceKm(entity.lngLat, homeLngLat);
        const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

        if (nextFuel <= bingoThreshold) {
          logEvent(
            entity.iso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `Bingo Fuel: ${entity.name}`,
            `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Aborting route for RTB.`,
            entity.lngLat
          );
          return {
            ...entity,
            status: 'bingo_rtb',
            currentFuelPct: nextFuel,
          };
        }

        // Check if reached current waypoint
        if (distToWp <= Math.max(4, stepDistKm)) {
          let nextIdx = currentIdx + direction;
          let nextDirection: 1 | -1 = direction;

          if (nextIdx >= waypoints.length) {
            // Reached final waypoint -> reverse direction
            nextDirection = -1;
            nextIdx = Math.max(0, waypoints.length - 2);
          } else if (nextIdx < 0) {
            // Reached start waypoint -> forward direction
            nextDirection = 1;
            nextIdx = Math.min(waypoints.length - 1, 1);
          }

          const nextTargetWp = waypoints[nextIdx] || targetWp;
          const nextHeading = bearingDeg(targetWp, nextTargetWp);

          return {
            ...entity,
            lngLat: targetWp,
            headingDeg: nextHeading,
            currentFuelPct: nextFuel,
            patrolOrder: {
              ...entity.patrolOrder,
              currentWaypointIdx: nextIdx,
              patrolDirection: nextDirection,
            },
          };
        }

        // Interpolate position towards target waypoint
        const fraction = Math.min(1, stepDistKm / Math.max(1, distToWp));
        const nextLngLat = interpolate(entity.lngLat, targetWp, fraction);
        const nextHeading = bearingDeg(entity.lngLat, targetWp);

        return {
          ...entity,
          lngLat: nextLngLat,
          headingDeg: nextHeading,
          currentFuelPct: nextFuel,
          patrolOrder: {
            ...entity.patrolOrder,
            currentWaypointIdx: currentIdx,
            patrolDirection: direction,
          },
        };
      }

      // E.2. Circular Orbit Loiter
      if (patrolRadiusKm <= 0) {
        return {
          ...entity,
          lngLat: centerLngLat,
        };
      }
      
      // Calculate angular step around orbit for aircraft / surface ships
      const circumferenceKm = 2 * Math.PI * Math.max(5, patrolRadiusKm);
      const stepDistKm = (speedKmh / 3600) * dtSimSec;
      const angleStepDeg = (stepDistKm / circumferenceKm) * 360;
      const nextAngle = (orbitAngleDeg + angleStepDeg) % 360;

      // Position along orbit circle
      const nextLngLat = destination(centerLngLat, patrolRadiusKm, nextAngle);
      const nextHeading = (nextAngle + 90) % 360;

      // Loiter fuel consumption
      const fuelBurn = calculateFuelBurnPct(0, combatRadiusKm, dtSimSec, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel
      const distToBase = distanceKm(nextLngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Bingo Fuel: ${entity.name}`,
          `${entity.name} fuel low (${nextFuel.toFixed(1)}%). Aborting station for RTB.`,
          nextLngLat
        );
        return {
          ...entity,
          lngLat: nextLngLat,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
        };
      }

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
        patrolOrder: {
          ...entity.patrolOrder,
          orbitAngleDeg: nextAngle,
        },
      };
    }

    // F. Return to Base (RTB - Bingo or Damaged)
    if (entity.status === 'bingo_rtb' || entity.status === 'damaged_rtb') {
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      if (distToBase <= Math.max(8, stepDistanceKm)) {
        // Landed at home base
        const isDamaged = entity.status === 'damaged_rtb';
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'rtb',
          `Unit Landed: ${entity.name}`,
          `${entity.name} touched down at ${homeBase?.name ?? 'Base'} for ${isDamaged ? 'repairs' : 'refueling & re-arming'}.`,
          homeLngLat
        );

        // Replenish ready magazines & fuel for equipped loadout on return to base
        const replenishedWeapons = entity.customWeapons && entity.customWeapons.length > 0
          ? entity.customWeapons.map((w, idx) => {
              const specMag = spec?.weapons?.[idx]?.magazine ?? w.magazine ?? 2;
              return { ...w, magazine: specMag };
            })
          : (spec?.weapons ? spec.weapons.map((w) => ({ ...w })) : []);

        return {
          ...entity,
          lngLat: homeLngLat,
          currentFuelPct: 100,
          customWeapons: replenishedWeapons,
          status: isDamaged ? 'in_repair' : 'turnaround',
          repairTimerSec: isDamaged ? 45 * 60 : 0, // 45 min repairs
          turnaroundTimerSec: isDamaged ? 0 : 15 * 60, // 15 min turnaround
        };
      }

      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToBase));
      const nextLngLat = interpolate(entity.lngLat, homeLngLat, fraction);
      const nextHeading = bearingDeg(entity.lngLat, homeLngLat);
      const nextFuel = Math.max(0, entity.currentFuelPct - (calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult));

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
      };
    }

    // G. Strike Ingress & Weapon Release ('engaging')
    if (entity.status === 'engaging' && entity.strikePlan) {
      const plan = entity.strikePlan;
      const targetEntity = session.entities.find((e) => e.id === plan.targetEntityId);
      const targetPos: [number, number] = targetEntity && targetEntity.status !== 'destroyed'
        ? targetEntity.lngLat
        : plan.targetLngLat;

      const distToTarget = distanceKm(entity.lngLat, targetPos);
      const stepDistanceKm = (speedKmh / 3600) * dtSimSec;

      // Fuel consumption during strike ingress
      const fuelBurn = calculateFuelBurnPct(stepDistanceKm, combatRadiusKm, 0, speedKmh) * fuelRateMult;
      const nextFuel = Math.max(0, entity.currentFuelPct - fuelBurn);

      // Check Bingo Fuel threshold
      const distToBase = distanceKm(entity.lngLat, homeLngLat);
      const bingoThreshold = calculateBingoFuelThreshold(distToBase, combatRadiusKm);

      if (nextFuel <= bingoThreshold) {
        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'alert',
          `Strike Aborted: ${entity.name}`,
          `${entity.name} reached Bingo Fuel (${nextFuel.toFixed(1)}%). Aborting strike mission for RTB.`,
          entity.lngLat
        );
        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
          strikePlan: undefined,
        };
      }

      // Check if custom attack waypoints exist and are pending navigation
      const hasAttackWaypoints = plan.attackWaypoints && plan.attackWaypoints.length > 0;
      const wpIdx = plan.currentWaypointIdx ?? 0;
      const areWaypointsPending = hasAttackWaypoints && wpIdx < plan.attackWaypoints!.length;

      if (areWaypointsPending) {
        const nextWp = plan.attackWaypoints![wpIdx];
        const distToWp = distanceKm(entity.lngLat, nextWp);

        if (distToWp <= Math.max(6, stepDistanceKm)) {
          // Arrived at current attack waypoint! Advance to next waypoint index
          const nextWpIdx = wpIdx + 1;
          const updatedPlan: StrikePlan = {
            ...plan,
            currentWaypointIdx: nextWpIdx,
          };

          return {
            ...entity,
            lngLat: nextWp,
            currentFuelPct: nextFuel,
            strikePlan: updatedPlan,
          };
        }

        // Steer along custom ingress corridor towards current waypoint
        const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToWp));
        const nextLngLat = interpolate(entity.lngLat, nextWp, fraction);
        const nextHeading = bearingDeg(entity.lngLat, nextWp);

        return {
          ...entity,
          lngLat: nextLngLat,
          headingDeg: nextHeading,
          currentFuelPct: nextFuel,
        };
      }

      // All waypoints completed (or direct ingress): Check if within weapon release stand-off envelope
      const effectiveReleaseRange = Math.max(5, plan.weaponRangeKm);
      if (distToTarget <= effectiveReleaseRange) {
        // --- WEAPON RELEASE POINT REACHED ---
        const currentWeapons = (entity.customWeapons && entity.customWeapons.length > 0)
          ? entity.customWeapons
          : (spec?.weapons || []);

        const itemsToFire: import('./warSimTypes').WeaponSalvoItem[] =
          plan.weaponsToFire && plan.weaponsToFire.length > 0
            ? plan.weaponsToFire
            : [
                {
                  weaponIndex: plan.weaponIndex,
                  weaponName: plan.weaponName || 'Ordnance',
                  weaponRangeKm: plan.weaponRangeKm || 100,
                  salvoCount: Math.max(1, plan.salvoCount || 1),
                },
              ];

        let updatedCustomWeapons = [...currentWeapons];
        let globalSalvoOffset = 0;
        const firedSummaries: string[] = [];

        for (const item of itemsToFire) {
          const wIdx = item.weaponIndex;
          const w = updatedCustomWeapons[wIdx] || updatedCustomWeapons[0];
          const wName = w?.name || item.weaponName || 'Ordnance';
          const missileSpeed = w?.speedMach ? w.speedMach * 1225 : ((w?.rangeKm ?? 100) > 100 ? 3200 : 1800);
          const missileCategory: any = w?.engages?.includes('air')
            ? 'air_to_air'
            : w?.engages?.includes('subsurface')
              ? 'torpedo'
              : 'cruise';

          const salvoCount = Math.max(1, item.salvoCount || 1);
          const curMagPerUnit = w?.magazine ?? 1;
          const totalRoundsBefore = entity.count * curMagPerUnit;
          const totalRoundsAfter = Math.max(0, totalRoundsBefore - salvoCount);
          const updatedMagazinePerUnit = Math.floor(totalRoundsAfter / entity.count);

          updatedCustomWeapons = updatedCustomWeapons.map((cw, idx) => {
            if (idx !== wIdx) return cw;
            return {
              ...cw,
              magazine: updatedMagazinePerUnit,
            };
          });

          // Spawn salvoCount missiles in activeMissiles with sequential ripple launch times
          for (let s = 0; s < salvoCount; s++) {
            const launchStaggerSec = globalSalvoOffset * 1.2;
            globalSalvoOffset++;

            const newMissile: MissileFlyoutTrack = {
              id: `msl-${Date.now()}-${wIdx}-${s}-${Math.random().toString(36).slice(2, 6)}`,
              originLngLat: entity.lngLat,
              targetLngLat: targetPos,
              currentLngLat: entity.lngLat,
              attackerEntityId: entity.id,
              targetEntityId: plan.targetEntityId,
              attackerIso: entity.iso,
              targetIso: targetEntity?.iso ?? (entity.iso === session.playerIso ? session.enemyIso : session.playerIso),
              weaponName: wName,
              weaponCategory: missileCategory,
              speedKmh: missileSpeed,
              startSimTimeSec: session.simTimeSec + launchStaggerSec,
              etaSimTimeSec: session.simTimeSec + Math.max(8, Math.round((distToTarget / missileSpeed) * 3600)) + launchStaggerSec,
              isIntercepted: false,
              progress: 0,
            };
            session.activeMissiles.push(newMissile);
          }

          firedSummaries.push(`${salvoCount} × ${wName}`);
        }

        const isAttackerPlayer = entity.iso === session.playerIso;
        const attackerFaction: 'player' | 'enemy' = isAttackerPlayer ? 'player' : 'enemy';
        const targetPID = getContactPID(plan.targetEntityId, attackerFaction, session.fogOfWarContacts);
        const targetSpec = targetEntity ? systemsLibrary.find((s) => s.id === targetEntity.systemId) : undefined;
        const targetDomain = targetSpec ? domainOf(targetSpec) : 'ground';
        const targetDisplayName = targetPID.isPID
          ? (targetEntity?.name ?? 'Hostile Entity')
          : `Hostile ${targetDomain.toUpperCase()} Track (Tier 1 Sensor Track)`;

        logReport({
          category: 'offensive_strike',
          title: `🚀 Strike Salvo Launched: ${entity.name}`,
          summary: `${entity.name} launched mixed salvo (${firedSummaries.join(' + ')}) against ${targetDisplayName} at ${distToTarget.toFixed(0)} km stand-off range.`,
          lngLat: entity.lngLat,
          countryIso: entity.iso,
          faction: attackerFaction,
          primaryEntity: {
            id: entity.id,
            name: entity.name,
            typeId: entity.typeId,
            domain: spec ? domainOf(spec) : 'air',
            iso: entity.iso,
            isFriendly: true,
            isPID: true,
            count: entity.count,
            rcsM2: entity.rcs ?? (spec ? getSystemRcs(spec, spec ? domainOf(spec) : 'air') : 5.0),
          },
          opposingEntity: {
            id: plan.targetEntityId,
            name: targetDisplayName,
            typeId: targetPID.isPID ? targetEntity?.typeId : undefined,
            domain: targetDomain,
            iso: targetEntity?.iso ?? (isAttackerPlayer ? session.enemyIso : session.playerIso),
            isFriendly: false,
            isPID: targetPID.isPID,
            count: targetPID.isPID ? targetEntity?.count : undefined,
            rcsM2: targetPID.isPID && targetEntity ? (targetEntity.rcs ?? (targetSpec ? getSystemRcs(targetSpec, targetDomain) : 5.0)) : undefined,
          },
          munitionsDetails: {
            weaponName: firedSummaries.join(' + '),
            salvoCount: itemsToFire.reduce((sum, it) => sum + (it.salvoCount || 1), 0),
            rangeKm: plan.weaponRangeKm,
            speedMach: spec?.weapons?.[plan.weaponIndex]?.speedMach,
            launchedBy: entity.name,
            standoffDistanceKm: distToTarget,
          },
          interceptionTelemetry: {
            defenseSystemName: 'Hostile Air Defense Network',
            interceptorType: 'Defensive SAM / CIWS',
            interceptorsLaunched: 0,
            missilesIntercepted: 0,
            missilesPenetrated: itemsToFire.reduce((sum, it) => sum + (it.salvoCount || 1), 0),
            successRatePct: 0,
            responseDetail: 'Inbound flight trajectory — awaiting air defense zone penetration',
          },
          damageAssessment: {
            targetResultState: targetEntity?.damage ?? 'intact',
            damageInflicted: 'none',
            bdaSummary: 'Missile package en route to target coordinates.',
          },
        });

        logEvent(
          entity.iso === session.playerIso ? 'player' : 'enemy',
          'strike',
          `🚀 Ordnance Released: ${entity.name}`,
          `${entity.name} launched mixed salvo (${firedSummaries.join(' + ')}) against target at ${distToTarget.toFixed(0)} km stand-off range. Executing ${plan.postStrikeAction.toUpperCase()} protocol.`,
          entity.lngLat
        );

        // Execute User-Selected Post-Strike Protocol
        if (plan.postStrikeAction === 'rtb') {
          return {
            ...entity,
            status: 'bingo_rtb',
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'return_to_patrol' && plan.returnPatrolOrder) {
          return {
            ...entity,
            status: 'takeoff_ingress',
            patrolOrder: plan.returnPatrolOrder,
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'loiter_target') {
          return {
            ...entity,
            status: 'on_station',
            patrolOrder: {
              centerLngLat: targetPos,
              patrolRadiusKm: 20,
              altitudeM: entity.altitudeM || 7000,
              orbitAngleDeg: 0,
              emcon: 'active',
            },
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        } else if (plan.postStrikeAction === 'designated_waypoint' && plan.customPostLngLat) {
          return {
            ...entity,
            status: 'takeoff_ingress',
            patrolOrder: {
              centerLngLat: plan.customPostLngLat,
              patrolRadiusKm: 15,
              altitudeM: entity.altitudeM || 7000,
              orbitAngleDeg: 0,
              emcon: 'active',
            },
            currentFuelPct: nextFuel,
            customWeapons: updatedCustomWeapons,
            strikePlan: undefined,
          };
        }

        return {
          ...entity,
          status: 'bingo_rtb',
          currentFuelPct: nextFuel,
          customWeapons: updatedCustomWeapons,
          strikePlan: undefined,
        };
      }

      // Ingress: move towards target
      const fraction = Math.min(1, stepDistanceKm / Math.max(1, distToTarget));
      const nextLngLat = interpolate(entity.lngLat, targetPos, fraction);
      const nextHeading = bearingDeg(entity.lngLat, targetPos);

      return {
        ...entity,
        lngLat: nextLngLat,
        headingDeg: nextHeading,
        currentFuelPct: nextFuel,
      };
    }

    return entity;
  });

  // -------------------------------------------------------------
  // 4. Multi-Layered Air Defense, Defensive Interceptions & Impacts
  // -------------------------------------------------------------
  // 4. Multi-Layered Air Defense, Defensive Interceptions & Impacts
  // -------------------------------------------------------------
  const newDefensiveInterceptors: MissileFlyoutTrack[] = [];

  // Pass 1: Kinematic Stepping & Dynamic Target Guidance
  for (const m of session.activeMissiles) {
    if (m.isIntercepted) continue;

    // If missile has a future launch time (sequential ripple salvo stagger), hold at launcher
    if (session.simTimeSec < m.startSimTimeSec) {
      continue;
    }

    // Dynamic guidance for SAM interceptors tracking active moving threat missiles
    if (m.weaponCategory === 'sam' && m.targetMissileId) {
      const liveThreat = session.activeMissiles.find((t) => t.id === m.targetMissileId && !t.isIntercepted);
      if (liveThreat) {
        m.targetLngLat = liveThreat.currentLngLat;
      }
    }

    const totalDist = distanceKm(m.originLngLat, m.targetLngLat);
    const speedKmh = Math.max(600, m.speedKmh);
    const stepDist = (speedKmh / 3600) * dtSimSec;
    const nextProgress = Math.min(1.0, m.progress + (stepDist / Math.max(1, totalDist)));
    const nextLngLat = interpolate(m.originLngLat, m.targetLngLat, nextProgress);

    m.progress = nextProgress;
    m.currentLngLat = nextLngLat;
  }

  // Pass 2: Mid-Air Kinetic Interceptor & Threat Collisions
  for (const sam of session.activeMissiles) {
    if (sam.isIntercepted || sam.weaponCategory !== 'sam' || !sam.targetMissileId) continue;
    if (session.simTimeSec < sam.startSimTimeSec) continue;

    const threat = session.activeMissiles.find((t) => t.id === sam.targetMissileId && !t.isIntercepted);
    if (threat) {
      const distToThreat = distanceKm(sam.currentLngLat, threat.currentLngLat);
      const combinedStepDist = ((sam.speedKmh + threat.speedKmh) / 3600) * dtSimSec;

      // Direct physical collision criteria (within combined step travel or terminal arrival)
      if (distToThreat <= Math.max(4.0, combinedStepDist * 1.3) || sam.progress >= 0.92) {
        // Snap both missiles to the exact intersection collision coordinates
        const collisionLngLat = interpolate(sam.currentLngLat, threat.currentLngLat, 0.5);
        sam.currentLngLat = collisionLngLat;
        threat.currentLngLat = collisionLngLat;

        const singleShotPk = sam.interceptorPk ?? 0.82;
        if (Math.random() < singleShotPk) {
          // Both missiles collide and are neutralized simultaneously
          threat.isIntercepted = true;
          sam.isIntercepted = true;

          const isDefenderPlayer = sam.attackerIso === session.playerIso;
          const defenderFaction: 'player' | 'enemy' = isDefenderPlayer ? 'player' : 'enemy';
          const threatAttacker = updatedEntities.find((e) => e.id === threat.attackerEntityId);
          const defender = updatedEntities.find((e) => e.id === sam.attackerEntityId);
          const attackerPID = getContactPID(threat.attackerEntityId, defenderFaction, session.fogOfWarContacts);
          const attackerDisplayName = attackerPID.isPID
            ? (threatAttacker?.name ?? 'Hostile Battery/Wing')
            : 'Hostile Platform (Unverified PID)';

          logReport({
            category: 'under_attack',
            title: `💥 Mid-Air Kinetic Interception: ${sam.weaponName}`,
            summary: `${sam.weaponName} achieved direct kinetic collision with incoming ${threat.weaponName} at ${collisionLngLat[1].toFixed(3)}°N, ${collisionLngLat[0].toFixed(3)}°E. Threat destroyed.`,
            lngLat: collisionLngLat,
            countryIso: sam.attackerIso,
            faction: defenderFaction,
            primaryEntity: {
              id: defender?.id ?? sam.attackerEntityId,
              name: defender?.name ?? sam.weaponName,
              typeId: defender?.typeId ?? 'sam',
              domain: 'land',
              iso: sam.attackerIso,
              isFriendly: true,
              isPID: true,
              rcsM2: defender?.rcs ?? 20.0,
            },
            opposingEntity: {
              id: threat.attackerEntityId,
              name: attackerDisplayName,
              typeId: attackerPID.isPID ? threatAttacker?.typeId : undefined,
              domain: 'air',
              iso: threat.attackerIso,
              isFriendly: false,
              isPID: attackerPID.isPID,
              rcsM2: attackerPID.isPID && threatAttacker ? (threatAttacker.rcs ?? 5.0) : undefined,
            },
            munitionsDetails: {
              weaponName: threat.weaponName,
              salvoCount: 1,
              launchedBy: attackerDisplayName,
            },
            interceptionTelemetry: {
              defenseSystemName: defender?.name ?? 'Air Defense System',
              interceptorType: sam.weaponName,
              interceptorsLaunched: 1,
              missilesIntercepted: 1,
              missilesPenetrated: 0,
              successRatePct: 100,
              responseDetail: 'Direct kinetic collision kill verified by telemetry',
            },
            damageAssessment: {
              targetResultState: defender?.damage ?? 'intact',
              damageInflicted: 'none',
              bdaSummary: 'Threat neutralized mid-air before entering terminal defense footprint.',
            },
          });

          logEvent(
            sam.attackerIso === session.playerIso ? 'player' : 'enemy',
            'intercept',
            `💥 Mid-Air Kinetic Interception: ${sam.weaponName}`,
            `${sam.weaponName} scored direct collision hit on incoming ${threat.weaponName} at ${distanceKm(sam.originLngLat, collisionLngLat).toFixed(0)} km stand-off range!`,
            collisionLngLat
          );
        } else {
          // Flyby / near miss: Interceptor expended its kinetic energy; threat continues ingress
          sam.isIntercepted = true;
          logEvent(
            sam.attackerIso === session.playerIso ? 'player' : 'enemy',
            'alert',
            `⚠️ Interceptor Missed: ${threat.weaponName}`,
            `${threat.weaponName} evaded ${sam.weaponName} intercept envelope and continues terminal ingress!`,
            collisionLngLat
          );
        }
      }
    } else {
      // Threat already destroyed by another interceptor
      if (sam.progress >= 0.95) {
        sam.isIntercepted = true;
      }
    }
  }

  // Pass 3: Radar Threat Tracking & Interceptor Launches (for incoming offensive threats)
  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress >= 1.0) continue;
    if (session.simTimeSec < m.startSimTimeSec) continue;

    const alreadyEngaged = m.engagedByDefenderIds ?? [];
    const defendingIso = m.targetIso;

    // Find all live friendly defenders (active deployed units, not docked in base)
    const potentialDefenders = updatedEntities.filter(
      (e) =>
        e.iso === defendingIso &&
        e.status !== 'destroyed' &&
        e.status !== 'docked' &&
        e.status !== 'in_repair' &&
        e.status !== 'turnaround'
    );

    for (const def of potentialDefenders) {
      const defSpec = systemsLibrary.find((s) => s.id === def.systemId);
      const distToMissile = distanceKm(def.lngLat, m.currentLngLat);

      // Sensor Horizon Detection Check
      const sensorReach = defSpec?.sensor?.detectionKm ?? (isGroundCombatUnit(def.typeId) ? 25 : 240);
      if (distToMissile > sensorReach) continue;

      // 1. Threat Detection Record
      const detectionTimes = m.defenderDetectionTimes || {};
      if (!detectionTimes[def.id]) {
        detectionTimes[def.id] = session.simTimeSec;
        m.defenderDetectionTimes = detectionTimes;
      }

      // 2. Air Defense Reaction Time Delay
      const reactionTimeSec = (defSpec?.sensor?.tracks && defSpec.sensor.tracks > 50) ? 5 : 8;
      const isReactionReady = session.simTimeSec >= (detectionTimes[def.id] + reactionTimeSec);

      if (!isReactionReady || alreadyEngaged.includes(def.id)) {
        continue;
      }

      // 3. Find Best Air Defense Interceptor Weapon
      const weapons = (def.customWeapons && def.customWeapons.length > 0)
        ? def.customWeapons
        : (defSpec?.weapons || []);

      let bestWeaponIdx = -1;
      let bestWeapon: WeaponFacet | null = null;

      for (let wIdx = 0; wIdx < weapons.length; wIdx++) {
        const w = weapons[wIdx];
        const hasAmmo = (w.magazine !== undefined ? w.magazine : (def.magazines?.[wIdx] ?? 2)) > 0;
        if (!hasAmmo) continue;
        if (w.rangeKm < distToMissile) continue;

        const isAirWeapon = canWeaponEngageTarget(w, 'air') || w.engages?.includes('air') || w.engages?.includes('ballistic-short') || w.engages?.includes('ballistic-medium');
        if (isAirWeapon) {
          if (!bestWeapon || w.rangeKm > bestWeapon.rangeKm) {
            bestWeapon = w;
            bestWeaponIdx = wIdx;
          }
        }
      }

      if (bestWeapon && bestWeaponIdx >= 0) {
        m.engagedByDefenderIds = [...alreadyEngaged, def.id];

        const curMag = bestWeapon.magazine !== undefined ? bestWeapon.magazine : (def.magazines?.[bestWeaponIdx] ?? 2);
        const salvoCommit = Math.min(curMag, bestWeapon.salvo ?? 2, 2);

        // Deduct from defender's magazine in real-time
        if (def.customWeapons && def.customWeapons[bestWeaponIdx]) {
          def.customWeapons[bestWeaponIdx] = {
            ...def.customWeapons[bestWeaponIdx],
            magazine: Math.max(0, curMag - salvoCommit),
          };
        }
        if (def.magazines) {
          def.magazines[bestWeaponIdx] = Math.max(0, curMag - salvoCommit);
        }

        const interceptorSpeed = Math.max(3600, (bestWeapon.speedMach ?? 4.0) * 1225);
        const tFlySec = (distToMissile / interceptorSpeed) * 3600;

        const singleShotPk = bestWeapon.pk ?? 0.82;
        const compoundPk = 1 - Math.pow(1 - singleShotPk, salvoCommit);

        // Spawn interceptor directly tracking target threat
        const interceptorTrack: MissileFlyoutTrack = {
          id: `msl-int-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          originLngLat: def.lngLat,
          targetLngLat: m.currentLngLat,
          currentLngLat: def.lngLat,
          attackerEntityId: def.id,
          targetEntityId: def.id,
          attackerIso: def.iso,
          targetIso: m.attackerIso,
          weaponName: bestWeapon.name || 'Defensive SAM',
          weaponCategory: 'sam',
          speedKmh: interceptorSpeed,
          startSimTimeSec: session.simTimeSec,
          etaSimTimeSec: session.simTimeSec + Math.max(2, Math.round(tFlySec)),
          isIntercepted: false,
          progress: 0.0,
          targetMissileId: m.id,
          interceptorPk: compoundPk,
        };
        newDefensiveInterceptors.push(interceptorTrack);

        const remainingMag = def.customWeapons?.[bestWeaponIdx]?.magazine ?? 0;
        const isDefPlayer = def.iso === session.playerIso;
        const defFaction: 'player' | 'enemy' = isDefPlayer ? 'player' : 'enemy';
        const threatAttacker = updatedEntities.find((e) => e.id === m.attackerEntityId);
        const attackerPID = getContactPID(m.attackerEntityId, defFaction, session.fogOfWarContacts);
        const attackerDisplayName = attackerPID.isPID
          ? (threatAttacker?.name ?? 'Hostile Battery/Wing')
          : 'Hostile Platform (Unverified PID)';

        logReport({
          category: 'under_attack',
          title: `🛡️ Defensive Response: ${def.name} Engaging Inbound Threat`,
          summary: `${def.name} acquired incoming ${m.weaponName} at ${distToMissile.toFixed(0)} km range. Launched ${salvoCommit} × ${bestWeapon.name} on collision intercept trajectory.`,
          lngLat: def.lngLat,
          countryIso: def.iso,
          faction: defFaction,
          primaryEntity: {
            id: def.id,
            name: def.name,
            typeId: def.typeId,
            domain: defSpec ? domainOf(defSpec) : 'land',
            iso: def.iso,
            isFriendly: true,
            isPID: true,
            count: def.count,
            rcsM2: def.rcs ?? (defSpec ? getSystemRcs(defSpec, 'ground') : 20.0),
          },
          opposingEntity: {
            id: m.attackerEntityId,
            name: attackerDisplayName,
            typeId: attackerPID.isPID ? threatAttacker?.typeId : undefined,
            domain: 'air',
            iso: m.attackerIso,
            isFriendly: false,
            isPID: attackerPID.isPID,
            rcsM2: attackerPID.isPID && threatAttacker ? (threatAttacker.rcs ?? 5.0) : undefined,
          },
          munitionsDetails: {
            weaponName: m.weaponName,
            salvoCount: 1,
            launchedBy: attackerDisplayName,
          },
          interceptionTelemetry: {
            defenseSystemName: def.name,
            interceptorType: bestWeapon.name,
            interceptorsLaunched: salvoCommit,
            missilesIntercepted: 0,
            missilesPenetrated: 1,
            successRatePct: 0,
            responseDetail: `Target acquired by fire-control radar. ${salvoCommit} × ${bestWeapon.name} interceptors in flight.`,
          },
          damageAssessment: {
            targetResultState: def.damage,
            damageInflicted: 'none',
            bdaSummary: 'Active air defense engagement in progress.',
          },
        });

        logEvent(
          def.iso === session.playerIso ? 'player' : 'enemy',
          'intercept',
          `🚀 Interceptor Salvo Launched: ${def.name}`,
          `${def.name} acquired incoming ${m.weaponName} at ${distToMissile.toFixed(0)} km range (Reaction: ${reactionTimeSec}s). Launched ${salvoCommit} × ${bestWeapon.name} on collision intercept vector (${remainingMag} ready rounds remaining).`,
          def.lngLat
        );
      }
    }
  }

  // Pass 4: Terminal Point Defense (CIWS) at Target Location
  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress < 0.95 || m.progress >= 1.0) continue;

    const targetEntity = updatedEntities.find((e) => e.id === m.targetEntityId);
    if (
      targetEntity &&
      targetEntity.status !== 'destroyed' &&
      targetEntity.status !== 'docked' &&
      targetEntity.status !== 'in_repair' &&
      targetEntity.status !== 'turnaround'
    ) {
      const targetSpec = systemsLibrary.find((s) => s.id === targetEntity.systemId);
      const tWeapons = (targetEntity.customWeapons && targetEntity.customWeapons.length > 0)
        ? targetEntity.customWeapons
        : (targetSpec?.weapons || []);

      const ciwsIdx = tWeapons.findIndex(
        (w) => w.rangeKm <= 15 && (canWeaponEngageTarget(w, 'air') || w.engages?.includes('air')) && (w.magazine ?? 2) > 0
      );

      if (ciwsIdx >= 0) {
        const ciwsWeapon = tWeapons[ciwsIdx];
        const curCiwsMag = ciwsWeapon.magazine ?? 2;
        if (targetEntity.customWeapons && targetEntity.customWeapons[ciwsIdx]) {
          targetEntity.customWeapons[ciwsIdx] = {
            ...targetEntity.customWeapons[ciwsIdx],
            magazine: Math.max(0, curCiwsMag - 1),
          };
        }

        if (Math.random() < 0.75) {
          m.isIntercepted = true;

          logReport({
            category: 'under_attack',
            title: `💥 CIWS Interception: ${targetEntity.name}`,
            summary: `${targetEntity.name} terminal CIWS (${ciwsWeapon.name}) destroyed incoming ${m.weaponName} at point-blank range.`,
            lngLat: targetEntity.lngLat,
            countryIso: targetEntity.iso,
            faction: targetEntity.iso === session.playerIso ? 'player' : 'enemy',
            primaryEntity: {
              id: targetEntity.id,
              name: targetEntity.name,
              typeId: targetEntity.typeId,
              domain: targetSpec ? domainOf(targetSpec) : 'sea',
              iso: targetEntity.iso,
              isFriendly: true,
              isPID: true,
              rcsM2: targetEntity.rcs ?? (targetSpec ? getSystemRcs(targetSpec, 'sea') : 100.0),
            },
            munitionsDetails: {
              weaponName: m.weaponName,
              salvoCount: 1,
              launchedBy: 'Hostile Platform',
            },
            interceptionTelemetry: {
              defenseSystemName: targetEntity.name,
              interceptorType: ciwsWeapon.name,
              interceptorsLaunched: 1,
              missilesIntercepted: 1,
              missilesPenetrated: 0,
              ciwsEngaged: true,
              successRatePct: 100,
              responseDetail: 'Terminal point defense auto-engaged; high rate of fire shredded incoming threat.',
            },
            damageAssessment: {
              targetResultState: targetEntity.damage,
              damageInflicted: 'none',
              bdaSummary: 'Threat destroyed at close perimeter — hull/facility intact.',
            },
          });

          logEvent(
            targetEntity.iso === session.playerIso ? 'player' : 'enemy',
            'intercept',
            `💥 CIWS Point Defense: ${targetEntity.name}`,
            `${targetEntity.name} terminal close-in weapon system (${ciwsWeapon.name}) destroyed incoming ${m.weaponName} at point-blank range!`,
            targetEntity.lngLat
          );
        }
      }
    }
  }

  // Pass 5: Missile Impact Resolution at Target Coordinates (progress >= 1.0)
  for (const m of session.activeMissiles) {
    if (m.isIntercepted || m.weaponCategory === 'sam' || m.progress < 1.0) continue;

    const targetEntity = updatedEntities.find((e) => e.id === m.targetEntityId);
    const targetBase = updatedBases.find((b) => b.id === m.targetEntityId);

    if (targetEntity && targetEntity.status !== 'destroyed') {
      const isNaval = isNavalCombatant(targetEntity.typeId);
      const isAir = targetEntity.typeId === 'fighter' || targetEntity.typeId === 'strike' || targetEntity.typeId === 'bomber' || targetEntity.typeId === 'awacs' || targetEntity.typeId === 'tanker';

      if (isNaval) {
        if (targetEntity.damage === 'intact') {
          targetEntity.damage = 'damaged';
          targetEntity.status = 'damaged_rtb';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Warship Struck: ${targetEntity.name}`,
            `${m.weaponName} scored direct anti-ship impact on ${targetEntity.name}. Superstructure damaged; vessel executing emergency RTB.`,
            targetEntity.lngLat
          );
        } else {
          targetEntity.status = 'destroyed';
          targetEntity.damage = 'destroyed';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Warship Sunk: ${targetEntity.name}`,
            `${m.weaponName} scored fatal strike on damaged ${targetEntity.name}. Hull compromised; vessel sinking.`,
            targetEntity.lngLat
          );
        }
      } else if (isAir) {
        targetEntity.status = 'destroyed';
        targetEntity.damage = 'destroyed';
        logEvent(
          m.attackerIso === session.playerIso ? 'player' : 'enemy',
          'impact',
          `💥 Aircraft Destroyed: ${targetEntity.name}`,
          `${m.weaponName} intercepted and destroyed ${targetEntity.name} in mid-air.`,
          targetEntity.lngLat
        );
      } else {
        // Ground Battalion / SAM Battery / Armor Column
        const catastrophic = Math.random() < 0.60;
        if (catastrophic) {
          targetEntity.status = 'destroyed';
          targetEntity.damage = 'destroyed';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `💥 Target Destroyed: ${targetEntity.name}`,
            `${m.weaponName} scored direct impact. ${targetEntity.name} neutralized.`,
            targetEntity.lngLat
          );
        } else {
          targetEntity.damage = 'damaged';
          targetEntity.status = 'damaged_rtb';
          logEvent(
            m.attackerIso === session.playerIso ? 'player' : 'enemy',
            'impact',
            `⚠️ Target Damaged: ${targetEntity.name}`,
            `${m.weaponName} caused heavy battle damage to ${targetEntity.name}. Unit withdrawing for repairs.`,
            targetEntity.lngLat
          );
        }
      }

      // Generate Combat Report for Defender & Attacker BDA
      const isTargetPlayer = targetEntity.iso === session.playerIso;
      const targetFaction: 'player' | 'enemy' = isTargetPlayer ? 'player' : 'enemy';
      const threatAttacker = updatedEntities.find((e) => e.id === m.attackerEntityId);
      const attackerPID = getContactPID(m.attackerEntityId, targetFaction, session.fogOfWarContacts);
      const attackerDisplayName = attackerPID.isPID
        ? (threatAttacker?.name ?? 'Hostile Battery/Wing')
        : 'Hostile Platform (Unverified PID)';

      const isCatastrophic = targetEntity.damage === 'destroyed';
      const bdaSummary = isCatastrophic
        ? `Catastrophic impact: ${targetEntity.name} neutralized and removed from theater.`
        : `Heavy battle damage: ${targetEntity.name} superstructure/airframe compromised; executing emergency RTB.`;

      // 1. Under Attack Report for Defender
      logReport({
        category: 'under_attack',
        title: isCatastrophic ? `💥 Catastrophic Loss: ${targetEntity.name} Destroyed` : `⚠️ Direct Hit: ${targetEntity.name} Damaged`,
        summary: `${targetEntity.name} struck by incoming ${m.weaponName}. Status: ${targetEntity.damage.toUpperCase()}.`,
        lngLat: targetEntity.lngLat,
        countryIso: targetEntity.iso,
        faction: targetFaction,
        primaryEntity: {
          id: targetEntity.id,
          name: targetEntity.name,
          typeId: targetEntity.typeId,
          domain: isNaval ? 'sea' : isAir ? 'air' : 'land',
          iso: targetEntity.iso,
          isFriendly: true,
          isPID: true,
          count: targetEntity.count,
          rcsM2: targetEntity.rcs ?? (isNaval ? 100.0 : isAir ? 5.0 : 20.0),
        },
        opposingEntity: {
          id: m.attackerEntityId,
          name: attackerDisplayName,
          typeId: attackerPID.isPID ? threatAttacker?.typeId : undefined,
          domain: 'air',
          iso: m.attackerIso,
          isFriendly: false,
          isPID: attackerPID.isPID,
          rcsM2: attackerPID.isPID && threatAttacker ? (threatAttacker.rcs ?? 5.0) : undefined,
        },
        munitionsDetails: {
          weaponName: m.weaponName,
          salvoCount: 1,
          launchedBy: attackerDisplayName,
        },
        interceptionTelemetry: {
          defenseSystemName: targetEntity.name,
          interceptorsLaunched: 0,
          missilesIntercepted: 0,
          missilesPenetrated: 1,
          successRatePct: 0,
          responseDetail: 'Threat penetrated defensive countermeasures and impacted hull/structure.',
        },
        damageAssessment: {
          targetResultState: targetEntity.damage,
          damageInflicted: isCatastrophic ? 'destroyed' : 'heavy',
          personnelLosses: isCatastrophic ? targetEntity.personnel : Math.round(targetEntity.personnel * 0.4),
          platformsDestroyed: isCatastrophic ? targetEntity.count : 0,
          bdaSummary,
        },
      });

      // 2. Offensive Strike BDA Report for Attacker
      const isAttackerPlayer = m.attackerIso === session.playerIso;
      const attackerFaction: 'player' | 'enemy' = isAttackerPlayer ? 'player' : 'enemy';
      const targetPID = getContactPID(targetEntity.id, attackerFaction, session.fogOfWarContacts);

      logReport({
        category: 'offensive_strike',
        title: `🎯 BDA Assessment: Direct Hit on ${targetPID.isPID ? targetEntity.name : 'Hostile Track'}`,
        summary: `${m.weaponName} scored direct impact on ${targetPID.isPID ? targetEntity.name : 'Hostile Target'}. Target confirmed ${targetEntity.damage.toUpperCase()}.`,
        lngLat: targetEntity.lngLat,
        countryIso: m.attackerIso,
        faction: attackerFaction,
        primaryEntity: {
          id: threatAttacker?.id ?? m.attackerEntityId,
          name: threatAttacker?.name ?? 'Friendly Strike Wing',
          typeId: threatAttacker?.typeId ?? 'strike',
          domain: 'air',
          iso: m.attackerIso,
          isFriendly: true,
          isPID: true,
          rcsM2: threatAttacker?.rcs ?? 5.0,
        },
        opposingEntity: {
          id: targetEntity.id,
          name: targetPID.isPID ? targetEntity.name : 'Hostile Target Track',
          typeId: targetPID.isPID ? targetEntity.typeId : undefined,
          domain: isNaval ? 'sea' : isAir ? 'air' : 'land',
          iso: targetEntity.iso,
          isFriendly: false,
          isPID: targetPID.isPID,
          count: targetPID.isPID ? targetEntity.count : undefined,
          rcsM2: targetPID.isPID ? (targetEntity.rcs ?? (isNaval ? 100.0 : isAir ? 5.0 : 20.0)) : undefined,
        },
        munitionsDetails: {
          weaponName: m.weaponName,
          salvoCount: 1,
          launchedBy: threatAttacker?.name ?? 'Friendly Strike',
        },
        damageAssessment: {
          targetResultState: targetEntity.damage,
          damageInflicted: isCatastrophic ? 'destroyed' : 'heavy',
          bdaSummary: isCatastrophic ? 'BDA Confirmed: Target completely neutralized.' : 'BDA Confirmed: Heavy battle damage inflicted.',
        },
      });
    } else if (targetBase) {
      targetBase.runwayStatus = 'damaged';
      targetBase.repairCountdownSec = 30 * 60;
      logEvent(
        m.attackerIso === session.playerIso ? 'player' : 'enemy',
        'impact',
        `💥 Base Struck: ${targetBase.name}`,
        `${m.weaponName} cratered runways at ${targetBase.name}. Flight operations halted for repairs.`,
        targetBase.lngLat
      );
    }

    // Impacted missile is consumed
    m.isIntercepted = true;
  }

  // Pass 6: Assemble Clean Active Missiles List
  const updatedMissiles = [
    ...session.activeMissiles.filter((m) => !m.isIntercepted && (m.progress < 1.0 || session.simTimeSec < m.startSimTimeSec)),
    ...newDefensiveInterceptors,
  ];

  // -------------------------------------------------------------
  // 5. Dynamic Sensor Sweeping & Fog of War Contacts Pipeline
  // -------------------------------------------------------------
  const playerContacts: DetectedContact[] = [];
  const enemyContacts: DetectedContact[] = [];

  // Static Bases are always visible baseline (Satellite Recon)
  // Mobile Entities are evaluated per sensor horizon
  const performSensorSweeps = (
    scanningFaction: 'player' | 'enemy',
    scanningIso: string,
    targetIso: string
  ): DetectedContact[] => {
    const contacts: DetectedContact[] = [];
    const scanners = updatedEntities.filter(
      (e) => e.iso === scanningIso && e.status !== 'destroyed' && e.status !== 'docked'
    );
    const friendlyBases = updatedBases.filter(
      (b) => b.iso === scanningIso && b.runwayStatus !== 'destroyed'
    );

    const opposingEntities = updatedEntities.filter(
      (e) => e.iso === targetIso && e.status !== 'destroyed' && e.status !== 'docked'
    );

    for (const target of opposingEntities) {
      const targetSpec = systemsLibrary.find((s) => s.id === target.systemId);
      const targetDomain = targetSpec ? domainOf(targetSpec) : 'air';

      let bestTier: 1 | 2 | 0 = 0;

      // Target physical characteristics (altitude/mast height & physical RCS)
      const targetHeightM = targetDomain === 'air'
        ? (target.altitudeM && target.altitudeM > 50 ? target.altitudeM : 10000)
        : (targetDomain === 'sea' ? (targetSpec?.sensor?.antennaM ?? (target.typeId === 'destroyer' ? 38 : 25)) : 3);

      const targetRcsM2 = target.rcs ?? getSystemRcs(targetSpec, targetDomain);

      // 1. Check all active friendly deployed platforms (aircraft, ships, drones, air defense, armor)
      for (const scanner of scanners) {
        const scanSpec = systemsLibrary.find((s) => s.id === scanner.systemId);
        const dist = distanceKm(scanner.lngLat, target.lngLat);
        const isGroundScanner = isGroundCombatUnit(scanner.typeId);

        // Ground combat vehicles (tanks, IFVs, artillery, infantry) have optical/thermal sights (~15 km)
        // and CANNOT detect high-altitude aircraft!
        if (isGroundScanner && scanner.typeId !== 'mobile-ad' && scanner.typeId !== 'sam-launcher') {
          if (targetDomain === 'air' && (target.altitudeM ?? 0) > 300) {
            continue;
          }
        }

        // Subsurface acoustic check
        if (targetDomain === 'sub') {
          const sonar = scanSpec?.sensor?.sonar ?? defaultSonarFor(scanSpec, scanner.typeId);
          const maxSonarKm = sonar.detectionKm ?? 35;
          if (dist <= maxSonarKm) {
            bestTier = Math.max(bestTier, 1) as 1 | 2;
          }
          continue;
        }

        // Sensor detection envelope
        let ratedEnvelopeKm = scanSpec?.sensor?.detectionKm ?? (
          isGroundScanner ? 15 : scanner.typeId === 'awacs' ? 450 : (scanner.typeId === 'uav' || scanner.typeId === 'recon') ? 180 : 250
        );

        // High-altitude maritime search radar / SAR for UAVs & Recon aircraft against sea combatants
        if ((scanner.typeId === 'uav' || scanner.typeId === 'recon') && targetDomain === 'sea') {
          ratedEnvelopeKm = Math.max(ratedEnvelopeKm, 180);
        }

        if (scanner.patrolOrder?.emcon === 'passive') {
          ratedEnvelopeKm = 0; // Passive silent running
        }

        // Scanner physical height
        const isAirScanner = scanner.typeId === 'fighter' || scanner.typeId === 'bomber' || scanner.typeId === 'awacs' || scanner.typeId === 'uav' || scanner.typeId === 'recon' || scanner.typeId === 'tanker' || scanner.typeId === 'helicopter' || scanner.typeId === 'attack-heli' || scanner.typeId === 'transport-heli';
        const scannerHeightM = isAirScanner
          ? (scanner.altitudeM && scanner.altitudeM > 50 ? scanner.altitudeM : 7000)
          : (scanSpec?.sensor?.antennaM ?? (scanner.typeId === 'destroyer' ? 38 : scanner.typeId === 'frigate' ? 25 : isGroundScanner ? 3 : 25));

        const horizonLimited = targetDomain !== 'air' || Boolean(scanSpec?.sensor?.horizonLimited);

        // Unified Sensor Detection Framework calculation
        const detectionResult = calculateDetectionRange({
          scannerHeightM,
          scannerEnvelopeKm: ratedEnvelopeKm,
          targetHeightM,
          targetRcsM2,
          targetDomain,
          horizonLimited,
        });

        const maxDetectionKm = detectionResult.detectionRangeKm;

        if (dist <= maxDetectionKm) {
          // Detected on Radar / Optics (Tier 1 baseline contact)
          bestTier = Math.max(bestTier, 1) as 1 | 2;

          // PID (Tier 2 Positive Identification) conditions:
          // 1. Within 50% of sensor horizon (high-resolution NCTR / ISAR classification)
          // 2. Or within visual / optical identification distance (<= 45 km)
          // 3. Or scanner is a dedicated Recon UAV / Maritime Patrol / AWACS / SOF
          if (
            scanner.typeId === 'uav' ||
            scanner.typeId === 'recon' ||
            scanner.typeId === 'awacs' ||
            scanner.typeId === 'special-forces' ||
            dist <= Math.max(45, maxDetectionKm * 0.50)
          ) {
            bestTier = 2;
          }
        }
      }

      // 2. Check friendly military base early-warning and coastal surveillance radars
      for (const base of friendlyBases) {
        const distToBase = distanceKm(base.lngLat, target.lngLat);
        const baseAntennaM = base.type === 'airbase' ? 45 : base.type === 'silo_complex' ? 35 : 30;
        const baseEnvelopeKm = base.type === 'silo_complex' ? 300 : base.type === 'airbase' ? 220 : base.type === 'naval_base' ? 140 : 60;

        if (targetDomain === 'air') {
          const baseAirDetection = calculateDetectionRange({
            scannerHeightM: baseAntennaM,
            scannerEnvelopeKm: baseEnvelopeKm,
            targetHeightM,
            targetRcsM2,
            targetDomain: 'air',
            horizonLimited: false,
          });
          if (distToBase <= baseAirDetection.detectionRangeKm) {
            bestTier = Math.max(bestTier, 1) as 1 | 2;
          }
        } else if (targetDomain === 'sea' && (base.type === 'naval_base' || base.type === 'carrier_group')) {
          const baseSeaDetection = calculateDetectionRange({
            scannerHeightM: baseAntennaM,
            scannerEnvelopeKm: baseEnvelopeKm,
            targetHeightM,
            targetRcsM2,
            targetDomain: 'sea',
            horizonLimited: true,
          });
          if (distToBase <= baseSeaDetection.detectionRangeKm) {
            bestTier = Math.max(bestTier, 1) as 1 | 2;
          }
        } else if (targetDomain === 'ground') {
          // Base perimeter ground surveillance perimeter (~15 km)
          if (distToBase <= 15) {
            bestTier = Math.max(bestTier, 1) as 1 | 2;
          }
        }
      }

      // Check if contact was previously positively identified (Tier 2 PID)
      const existingContacts = scanningFaction === 'player'
        ? session.fogOfWarContacts.playerContacts
        : session.fogOfWarContacts.enemyContacts;
      const prevContact = existingContacts.find((c) => c.targetEntityId === target.id);

      if (bestTier > 0) {
        // Once an enemy unit is PID (Tier 2), intel does not degrade as long as it remains within sensor range!
        if (prevContact && prevContact.intelTier === 2) {
          bestTier = 2;
        }

        // New Positive Identification (Tier 2 PID) Discovery Event & Report
        if (bestTier === 2 && (!prevContact || prevContact.intelTier !== 2)) {
          const scanner = scanners[0];
          const scanSpec = scanner ? systemsLibrary.find((s) => s.id === scanner.systemId) : undefined;
          logReport({
            category: 'recon_intel',
            title: `📡 Reconnaissance: Positive PID of ${target.name}`,
            summary: `${scanner?.name ?? 'Sensor Suite'} positively identified ${target.name} (${target.count} units, ${target.personnel} personnel, RCS: ${targetRcsM2 >= 1 ? targetRcsM2.toFixed(1) : targetRcsM2} m², status: ${target.damage.toUpperCase()}).`,
            lngLat: target.lngLat,
            countryIso: scanningIso,
            faction: scanningFaction,
            primaryEntity: {
              id: scanner?.id ?? 'sensor-net',
              name: scanner?.name ?? `${scanningFaction.toUpperCase()} Recon Asset`,
              typeId: scanner?.typeId ?? 'uav',
              domain: 'air',
              iso: scanningIso,
              isFriendly: true,
              isPID: true,
              rcsM2: scanner?.rcs ?? (scanSpec ? getSystemRcs(scanSpec, 'air') : 1.0),
            },
            opposingEntity: {
              id: target.id,
              name: target.name,
              typeId: target.typeId,
              domain: targetDomain,
              iso: target.iso,
              isFriendly: false,
              isPID: true,
              count: target.count,
              rcsM2: targetRcsM2,
            },
            intelDetails: {
              discoveredDomain: targetDomain.toUpperCase(),
              confidenceTier: 2,
              sensorUsed: scanner?.typeId === 'uav' ? 'Lynx Multi-Mode Radar (SAR/GMTI) + EO/IR Optical' : scanner?.typeId === 'awacs' ? 'APY-2 3D Surveillance Radar' : 'Surface Search & Fire-Control Radar',
              coordinatesText: `${target.lngLat[1].toFixed(3)}°N, ${target.lngLat[0].toFixed(3)}°E`,
              estimatedComposition: `${target.count} × ${target.name} (${target.damage.toUpperCase()})`,
              personnel: target.personnel,
              rcsM2: targetRcsM2,
              detectionBottleneck: 'Radar cross-section resolved against standard baseline',
            },
          });
        }

        const tier: 1 | 2 = bestTier === 2 ? 2 : 1;
        contacts.push({
          contactId: `cnt-${target.id}-${scanningFaction}`,
          targetEntityId: target.id,
          targetIso: target.iso,
          discoveredByFaction: scanningFaction,
          intelTier: tier,
          domain: targetDomain,
          lastKnownLngLat: target.lngLat,
          headingDeg: target.headingDeg,
          speedKmh: target.speedKmh,
          lastDetectedSimTimeSec: newSimTimeSec,
          decayTimerSec: 180, // Contact holds for 3 sim minutes
          knownName: tier === 2 ? target.name : undefined,
          knownCount: tier === 2 ? target.count : undefined,
          knownPersonnel: tier === 2 ? target.personnel : undefined,
          knownDamage: tier === 2 ? target.damage : undefined,
        });
      } else if (prevContact && prevContact.decayTimerSec > 0) {
        // Platform is currently outside live sensor sweep, but holds in tactical memory as Last Known Position (LKP)
        const nextDecay = Math.max(0, prevContact.decayTimerSec - dtSimSec);
        if (nextDecay > 0) {
          contacts.push({
            ...prevContact,
            decayTimerSec: nextDecay,
          });
        }
      }
    }

    return contacts;
  };

  const updatedPlayerContacts = performSensorSweeps('player', session.playerIso, session.enemyIso);
  const updatedEnemyContacts = performSensorSweeps('enemy', session.enemyIso, session.playerIso);

  return {
    ...session,
    simTimeSec: newSimTimeSec,
    bases: updatedBases,
    entities: updatedEntities,
    activeMissiles: updatedMissiles,
    fogOfWarContacts: {
      playerContacts: updatedPlayerContacts,
      enemyContacts: updatedEnemyContacts,
    },
    eventLog: newEvents.slice(-200), // Keep recent 200 events
    reports: newReports.slice(-150), // Keep recent 150 operational reports
  };
}

/* ------------------------------------------------------------------ */
/* 2. Commands & User Interaction Functions                           */
/* ------------------------------------------------------------------ */

/**
 * Uniquely identifies deployed formations of the same system specification.
 * If multiple units of the same system exist (or are deployed), assigns sequential designators:
 * e.g., "FREMM-class1", "FREMM-class2", "Su-35S-class1", etc.
 */
export function getUniqueSystemEntityName(
  systemName: string,
  systemId: string | undefined,
  iso: string,
  existingEntities: SimEntity[],
  count: number = 1
): string {
  let baseName = systemName.replace(/^\d+\s*[×x]\s*/i, '').trim();
  baseName = baseName.replace(/-class\s*\d+$/i, '').trim();
  baseName = baseName.replace(/\bclass(\s+ship|\s+frigate|\s+destroyer)?\b/gi, '').replace(/\s+/g, ' ').trim();
  baseName = baseName.replace(/[- ]?class$/i, '').trim();

  // Find all existing entities of this systemId for this faction
  const sameSystemEntities = existingEntities.filter(
    (e) => e.iso === iso && ((systemId && e.systemId === systemId) || e.name.toLowerCase().includes(baseName.toLowerCase()))
  );

  // Extract all existing sequence numbers
  const usedSeqs = new Set<number>();
  sameSystemEntities.forEach((e) => {
    const match = e.name.match(/-class\s*(\d+)/i);
    if (match) {
      usedSeqs.add(parseInt(match[1], 10));
    }
  });

  let nextSeq = 1;
  while (usedSeqs.has(nextSeq)) {
    nextSeq++;
  }

  const unitDesignator = `${baseName}-class${nextSeq}`;
  return count > 1 ? `${count} × ${unitDesignator}` : unitDesignator;
}

export function ensureUniqueEntityName(
  candidateName: string,
  systemId: string | undefined,
  iso: string,
  existingEntities: SimEntity[],
  currentEntityId?: string,
  count: number = 1
): string {
  let baseName = candidateName.replace(/^\d+\s*[×x]\s*/i, '').trim();
  baseName = baseName.replace(/-class\s*\d+$/i, '').trim();
  baseName = baseName.replace(/\bclass(\s+ship|\s+frigate|\s+destroyer)?\b/gi, '').replace(/\s+/g, ' ').trim();
  baseName = baseName.replace(/[- ]?class$/i, '').trim();

  const otherEntities = existingEntities.filter(
    (e) => e.id !== currentEntityId && e.iso === iso && ((systemId && e.systemId === systemId) || e.name.toLowerCase().includes(baseName.toLowerCase()))
  );

  const usedSeqs = new Set<number>();
  otherEntities.forEach((e) => {
    const match = e.name.match(/-class\s*(\d+)/i);
    if (match) {
      usedSeqs.add(parseInt(match[1], 10));
    }
  });

  const candidateMatch = candidateName.match(/-class\s*(\d+)/i);
  let chosenSeq = candidateMatch ? parseInt(candidateMatch[1], 10) : 1;

  if (usedSeqs.has(chosenSeq)) {
    chosenSeq = 1;
    while (usedSeqs.has(chosenSeq)) {
      chosenSeq++;
    }
  }

  const unitDesignator = `${baseName}-class${chosenSeq}`;
  return count > 1 ? `${count} × ${unitDesignator}` : unitDesignator;
}

/**
 * Deploys an authorized platform from national stock quota to a designated base.
 */
export function deployEntityToBase(
  session: WarSimSession,
  homeBaseId: string,
  systemId: string,
  count: number,
  systemsLibrary: SystemSpec[]
): WarSimSession {
  const base = session.bases.find((b) => b.id === homeBaseId);
  if (!base) return session;

  const spec = systemsLibrary.find((s) => s.id === systemId);
  const typeId = spec?.typeId || 'fighter';
  const domain = spec ? domainOf(spec) : 'air';

  // Check Base Stationing Rules
  const stationCheck = canStationAtBase(base.type, { domain, typeId });
  if (!stationCheck.allowed) {
    return session;
  }

  // Check Base Capacity Limits
  const currentStationedCount = session.entities.filter((e) => e.homeBaseId === homeBaseId && e.status !== 'destroyed').length;
  if (currentStationedCount >= base.maxCapacity) {
    return session;
  }

  const faction = base.iso === session.playerIso ? 'player' : 'enemy';
  const quotaLedger = { ...session.quotas[faction] };
  const quota = quotaLedger[systemId];

  if (!quota || (quota.deployed + count > quota.count)) {
    return session; // Exceeds authorized quota
  }

  // Update Quota Ledger
  quotaLedger[systemId] = {
    ...quota,
    deployed: quota.deployed + count,
  };

  const rawName = spec?.name ?? typeId;
  const entityName = getUniqueSystemEntityName(rawName, systemId, base.iso, session.entities, count);

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso: base.iso,
    name: entityName,
    typeId,
    systemId,
    count,
    homeBaseId,
    lngLat: base.lngLat,
    altitudeM: domain === 'air' ? 8000 : 0,
    headingDeg: 0,
    speedKmh: spec?.platform?.speedKmh ?? (domain === 'air' ? 850 : 50),
    currentFuelPct: 100,
    status: 'docked',
    damage: 'intact',
    turnaroundTimerSec: 0,
    repairTimerSec: 0,
    personnel: (spec?.platform?.crew ?? 2) * count,
    magazines: {},
    customWeapons: spec?.weapons ? [...spec.weapons] : [],
  };

  return {
    ...session,
    quotas: {
      ...session.quotas,
      [faction]: quotaLedger,
    },
    entities: [...session.entities, newEntity],
  };
}

/**
 * Deploys an autonomous platform directly onto sovereign territory without needing a base
 * (e.g., SAM launcher batteries, early-warning radar arrays, strategic missile silos, field artillery).
 */
export function deployAutonomousEntity(
  session: WarSimSession,
  systemId: string,
  count: number,
  lngLat: [number, number],
  systemsLibrary: SystemSpec[],
  altitudeM: number = 0,
  rcs?: number
): WarSimSession {
  const spec = systemsLibrary.find((s) => s.id === systemId);
  const typeId = spec?.typeId || 'sam-launcher';
  const domain = spec ? domainOf(spec) : 'ground';
  const faction = session.activeFaction;
  const iso = faction === 'player' ? session.playerIso : session.enemyIso;

  const quotaLedger = { ...session.quotas[faction] };
  const quota = quotaLedger[systemId];

  if (!quota || (quota.deployed + count > quota.count)) {
    return session;
  }

  quotaLedger[systemId] = {
    ...quota,
    deployed: quota.deployed + count,
  };

  const rawName = spec?.name ?? typeId;
  const entityName = getUniqueSystemEntityName(rawName, systemId, iso, session.entities, count);

  const effectiveRcs = (rcs !== undefined && rcs > 0)
    ? rcs
    : (spec?.rcs ?? (spec ? getSystemRcs(spec, domain) : 5.0));

  const newEntity: SimEntity = {
    id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    iso,
    name: entityName,
    typeId,
    systemId,
    count,
    lngLat,
    altitudeM: altitudeM || 0,
    headingDeg: 0,
    speedKmh: 0,
    currentFuelPct: 100,
    status: 'on_station',
    damage: 'intact',
    turnaroundTimerSec: 0,
    repairTimerSec: 0,
    personnel: (spec?.platform?.crew ?? 4) * count,
    rcs: effectiveRcs,
    magazines: {},
    customWeapons: spec?.weapons ? [...spec.weapons] : [],
    patrolOrder: {
      centerLngLat: lngLat,
      patrolRadiusKm: 0,
      altitudeM: altitudeM || 0,
      orbitAngleDeg: 0,
      emcon: 'active',
    },
  };

  const newEvents = [
    ...session.eventLog,
    {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec: session.simTimeSec,
      timeFormatted: formatSimTime(session.simTimeSec),
      faction,
      type: 'strike' as const,
      title: `Battery Erected: ${newEntity.name}`,
      detail: `${newEntity.name} deployed to coordinates (RCS: ${effectiveRcs.toFixed(2)} m²) and initialized active radar/defense network.`,
      lngLat,
    },
  ];

  return {
    ...session,
    quotas: {
      ...session.quotas,
      [faction]: quotaLedger,
    },
    entities: [...session.entities, newEntity],
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Tasks a stationed entity to sortie and establish a patrol orbit.
 * If sortieCount is specified and is less than entity.count, splits the formation:
 * the requested sortieCount takes off on patrol, while the remaining count stays stationed at base.
 */
export function orderPatrol(
  session: WarSimSession,
  entityId: string,
  centerLngLat: [number, number],
  patrolRadiusKm: number = 15,
  altitudeM: number = 7000,
  emcon: 'active' | 'passive' = 'active',
  sortieCount?: number,
  customWeapons?: import('./specs').WeaponFacet[],
  routeType: 'orbit' | 'waypoints' = 'orbit',
  waypoints?: [number, number][],
  rcs?: number
): WarSimSession {
  const targetEntity = session.entities.find((e) => e.id === entityId);
  if (!targetEntity || targetEntity.status === 'destroyed' || targetEntity.status === 'in_repair') {
    return session;
  }

  const isGround = isGroundCombatUnit(targetEntity.typeId);
  const isStaticAD = isStaticAirDefense(targetEntity.typeId);
  const isCustomRoute = routeType === 'waypoints' && waypoints && waypoints.length >= 2;
  const effectiveRadiusKm = isGround || isStaticAD || isCustomRoute ? 0 : patrolRadiusKm;
  const effectiveAltM = isGround || isStaticAD ? 0 : altitudeM;
  const initialCenter = isCustomRoute ? waypoints[0] : centerLngLat;

  const effectiveCount = Math.max(1, Math.min(targetEntity.count, sortieCount ?? targetEntity.count));
  const isPartialSplit = effectiveCount < targetEntity.count;

  const patrolOrder: PatrolOrder = {
    centerLngLat: initialCenter,
    patrolRadiusKm: effectiveRadiusKm,
    altitudeM: effectiveAltM,
    orbitAngleDeg: 0,
    emcon,
    routeType: isCustomRoute ? 'waypoints' : 'orbit',
    waypoints: isCustomRoute ? waypoints : undefined,
    currentWaypointIdx: isCustomRoute ? 1 : undefined,
    patrolDirection: 1,
  };

  const faction: 'player' | 'enemy' = targetEntity.iso === session.playerIso ? 'player' : 'enemy';

  if (isPartialSplit) {
    const remainingCount = targetEntity.count - effectiveCount;
    const personnelPerUnit = Math.max(1, Math.round(targetEntity.personnel / targetEntity.count));
    const sortieEntityId = `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    const sortieName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      session.entities,
      undefined,
      effectiveCount
    );

    const dockedName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      [...session.entities.filter((e) => e.id !== targetEntity.id), { ...targetEntity, id: sortieEntityId, name: sortieName }],
      targetEntity.id,
      remainingCount
    );

    const updatedDockedEntity: SimEntity = {
      ...targetEntity,
      name: dockedName,
      count: remainingCount,
      personnel: remainingCount * personnelPerUnit,
    };

    const sortieEntity: SimEntity = {
      ...targetEntity,
      id: sortieEntityId,
      name: sortieName,
      count: effectiveCount,
      personnel: effectiveCount * personnelPerUnit,
      status: 'takeoff_ingress',
      patrolOrder,
      altitudeM: effectiveAltM,
      rcs: (rcs !== undefined && rcs > 0) ? rcs : targetEntity.rcs,
      customWeapons: customWeapons && customWeapons.length > 0 ? [...customWeapons] : targetEntity.customWeapons,
    };

    const homeBase = session.bases.find((b) => b.id === targetEntity.homeBaseId);
    let updatedBases = session.bases;
    if (homeBase && !homeBase.stationedEntityIds.includes(sortieEntity.id)) {
      updatedBases = session.bases.map((b) =>
        b.id === homeBase.id
          ? { ...b, stationedEntityIds: [...b.stationedEntityIds, sortieEntity.id] }
          : b
      );
    }

    const updatedEntities = session.entities.map((e) => (e.id === targetEntity.id ? updatedDockedEntity : e));
    updatedEntities.push(sortieEntity);

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'rtb' as const,
        title: isStaticAD
          ? `Air Defense Emplaced: ${sortieName}`
          : isGround
            ? `Ground Movement: ${sortieName}`
            : `Sortie Launched: ${sortieName}`,
        detail: isStaticAD
          ? `Emplaced ${sortieName} air defense battery (${remainingCount} in depot) at designated coordinates.`
          : isGround
            ? `Dispatched ${sortieName} (${remainingCount} remaining at base) on road march to designated coordinates.`
            : `Detached ${sortieName} (${remainingCount} remaining at base) on designated patrol mission (RCS: ${sortieEntity.rcs ?? 'default'} m²).`,
        lngLat: centerLngLat,
      },
    ];

    return {
      ...session,
      bases: updatedBases,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
    };
  } else {
    const uniqueName = ensureUniqueEntityName(
      targetEntity.name,
      targetEntity.systemId,
      targetEntity.iso,
      session.entities,
      targetEntity.id,
      targetEntity.count
    );

    const isAlreadyDeployed = targetEntity.status !== 'docked';
    const updatedEntities = session.entities.map((e) => {
      if (e.id !== entityId) return e;
      return {
        ...e,
        name: uniqueName,
        status: isAlreadyDeployed && e.status === 'on_station' ? 'on_station' as const : 'takeoff_ingress' as const,
        patrolOrder,
        altitudeM: effectiveAltM,
        rcs: (rcs !== undefined && rcs > 0) ? rcs : e.rcs,
        // Loadout can only be reconfigured at base — keep existing loadout if already deployed
        customWeapons: isAlreadyDeployed
          ? e.customWeapons
          : (customWeapons && customWeapons.length > 0 ? [...customWeapons] : e.customWeapons),
      };
    });

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'rtb' as const,
        title: isAlreadyDeployed
          ? `Patrol Retasked: ${uniqueName}`
          : isGround
            ? `Ground Movement: ${uniqueName}`
            : `Sortie Launched: ${uniqueName}`,
        detail: isAlreadyDeployed
          ? `${uniqueName} retasked to new operational coordinates while preserving equipped weapons.`
          : isGround
            ? `${uniqueName} departed base and is en route to designated defensive position.`
            : `${uniqueName} departed base and is en route to designated patrol coordinates.`,
        lngLat: centerLngLat,
      },
    ];

    return {
      ...session,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
    };
  }
}

/**
 * Manually updates the physical Radar Cross-Section (RCS in m²) of a deployed or stationed entity
 * (e.g. adjusting for external weapon pylons, drop tanks, or stealth coating degradation).
 */
export function updateEntityRcs(
  session: WarSimSession,
  entityId: string,
  rcs: number
): WarSimSession {
  return {
    ...session,
    entities: session.entities.map((e) =>
      e.id === entityId ? { ...e, rcs: rcs > 0 ? rcs : undefined } : e
    ),
  };
}

/**
 * Adds a new sovereign Base / HQ installation on the map.
 */
export function addSimBase(
  session: WarSimSession,
  name: string,
  type: BaseType,
  iso: string,
  lngLat: [number, number]
): WarSimSession {
  const newBase: SimBase = {
    id: `base-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: name || `${iso} ${type.replace('_', ' ').toUpperCase()}`,
    iso,
    type,
    lngLat,
    maxCapacity: defaultBaseCapacity(type),
    stationedEntityIds: [],
    runwayStatus: 'operational',
    repairCountdownSec: 0,
    supplies: { fuelPct: 100, ammoPct: 100 },
  };

  return {
    ...session,
    bases: [...session.bases, newBase],
  };
}

/**
 * Renames an existing sovereign base installation.
 */
export function renameSimBase(
  session: WarSimSession,
  baseId: string,
  newName: string
): WarSimSession {
  const updatedBases = session.bases.map((b) => {
    if (b.id !== baseId) return b;
    return { ...b, name: newName.trim() || b.name };
  });

  return {
    ...session,
    bases: updatedBases,
  };
}

/**
 * Orders a specific in-flight or deployed entity to immediately abort mission and return directly to its home base (or nearest friendly base).
 */
export function orderEntityRtb(session: WarSimSession, entityId: string): WarSimSession {
  let orderedName = '';
  let entityIso = session.playerIso;
  let homeLngLat: [number, number] | null = null;
  let homeBaseName = '';

  const updatedEntities = session.entities.map((e) => {
    if (e.id !== entityId) return e;
    orderedName = e.name;
    entityIso = e.iso;

    // Find its designated home base or fallback to nearest friendly base
    const homeBase = session.bases.find((b) => b.id === e.homeBaseId);
    if (homeBase) {
      homeLngLat = homeBase.lngLat;
      homeBaseName = homeBase.name;
    } else {
      const friendlyBases = session.bases.filter((b) => b.iso === e.iso);
      if (friendlyBases.length > 0) {
        let nearestDist = Infinity;
        let nearestCoord = friendlyBases[0].lngLat;
        for (const fb of friendlyBases) {
          const d = distanceKm(e.lngLat, fb.lngLat);
          if (d < nearestDist) {
            nearestDist = d;
            nearestCoord = fb.lngLat;
          }
        }
        homeLngLat = nearestCoord;
        homeBaseName = friendlyBases[0].name;
      }
    }

    const nextHeading = homeLngLat ? bearingDeg(e.lngLat, homeLngLat) : e.headingDeg;

    return {
      ...e,
      status: 'bingo_rtb' as const,
      headingDeg: nextHeading,
      patrolOrder: undefined, // Clear any orbit/loiter orders so it flies directly home
    };
  });

  const faction: 'player' | 'enemy' = entityIso === session.playerIso ? 'player' : 'enemy';
  const newEvents = orderedName
    ? [
        ...session.eventLog,
        {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          simTimeSec: session.simTimeSec,
          timeFormatted: formatSimTime(session.simTimeSec),
          faction,
          type: 'rtb' as const,
          title: `RTB Ordered: ${orderedName}`,
          detail: `${orderedName} was ordered to RTB immediately towards ${homeBaseName || 'home installation'}.`,
          lngLat: homeLngLat || undefined,
        },
      ]
    : session.eventLog;

  return {
    ...session,
    entities: updatedEntities,
    eventLog: newEvents.slice(-200),
  };
}

/**
 * Tasks an operational unit to conduct a targeted strike or intercept mission against an enemy contact/entity.
 */
export function orderStrikeMission(
  session: WarSimSession,
  attackerEntityId: string,
  targetEntityId: string,
  targetLngLat: [number, number],
  weaponIndex: number,
  salvoCount: number = 1,
  postStrikeAction: PostStrikeAction = 'rtb',
  customPostLngLat?: [number, number],
  systemsLibrary: SystemSpec[] = [],
  sortieCount?: number,
  customWeapons?: import('./specs').WeaponFacet[],
  weaponsToFire?: import('./warSimTypes').WeaponSalvoItem[],
  attackWaypoints?: [number, number][]
): WarSimSession {
  const attacker = session.entities.find((e) => e.id === attackerEntityId);
  if (!attacker || attacker.status === 'destroyed' || attacker.status === 'in_repair' || attacker.status === 'turnaround') {
    return session;
  }

  const spec = systemsLibrary.find((s) => s.id === attacker.systemId);
  const effectiveWeapons = (customWeapons && customWeapons.length > 0)
    ? customWeapons
    : (attacker.customWeapons && attacker.customWeapons.length > 0)
      ? attacker.customWeapons
      : (spec?.weapons || []);

  const weapon = effectiveWeapons[weaponIndex] || effectiveWeapons[0];
  const weaponName = (weaponsToFire && weaponsToFire.length > 0)
    ? weaponsToFire.map((w) => `${w.salvoCount}× ${w.weaponName}`).join(' + ')
    : (weapon?.name || 'Ordnance');
  const weaponRangeKm = (weaponsToFire && weaponsToFire.length > 0)
    ? Math.min(...weaponsToFire.map((w) => w.weaponRangeKm))
    : (weapon?.rangeKm || 100);
  const effectiveSalvo = (weaponsToFire && weaponsToFire.length > 0)
    ? weaponsToFire.reduce((sum, w) => sum + w.salvoCount, 0)
    : Math.max(1, salvoCount);

  const targetEntity = session.entities.find((e) => e.id === targetEntityId);
  const targetName = targetEntity?.name || 'Hostile Target Track';

  const effectiveCount = Math.max(1, Math.min(attacker.count, sortieCount ?? attacker.count));
  const isPartialSplit = effectiveCount < attacker.count;

  const strikePlan: StrikePlan = {
    targetEntityId,
    targetLngLat,
    weaponIndex: (weaponsToFire && weaponsToFire.length > 0) ? weaponsToFire[0].weaponIndex : weaponIndex,
    weaponName,
    weaponRangeKm,
    salvoCount: effectiveSalvo,
    postStrikeAction,
    returnPatrolOrder: attacker.patrolOrder ? { ...attacker.patrolOrder } : undefined,
    customPostLngLat,
    weaponsToFire: (weaponsToFire && weaponsToFire.length > 0) ? weaponsToFire : undefined,
    attackWaypoints: (attackWaypoints && attackWaypoints.length > 0) ? attackWaypoints : undefined,
    currentWaypointIdx: (attackWaypoints && attackWaypoints.length > 0) ? 0 : undefined,
  };

  const isPlayer = attacker.iso === session.playerIso;
  const faction: 'player' | 'enemy' = isPlayer ? 'player' : 'enemy';
  const cleanName = attacker.name.replace(/^\d+\s*[×x]\s*/i, '');

  if (isPartialSplit) {
    const remainingCount = attacker.count - effectiveCount;
    const personnelPerUnit = Math.max(1, Math.round(attacker.personnel / attacker.count));
    const sortieEntityId = `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    const sortieName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      session.entities,
      undefined,
      effectiveCount
    );

    const dockedName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      [...session.entities.filter((e) => e.id !== attacker.id), { ...attacker, id: sortieEntityId, name: sortieName }],
      attacker.id,
      remainingCount
    );

    const updatedDockedEntity: SimEntity = {
      ...attacker,
      name: dockedName,
      count: remainingCount,
      personnel: remainingCount * personnelPerUnit,
    };

    const sortieEntity: SimEntity = {
      ...attacker,
      id: sortieEntityId,
      name: sortieName,
      count: effectiveCount,
      personnel: effectiveCount * personnelPerUnit,
      status: 'engaging',
      assignedMission: 'strike',
      assignedTargetEntityId: targetEntityId,
      strikePlan,
      customWeapons: effectiveWeapons,
    };

    const homeBase = session.bases.find((b) => b.id === attacker.homeBaseId);
    let updatedBases = session.bases;
    if (homeBase && !homeBase.stationedEntityIds.includes(sortieEntity.id)) {
      updatedBases = session.bases.map((b) =>
        b.id === homeBase.id
          ? { ...b, stationedEntityIds: [...b.stationedEntityIds, sortieEntity.id] }
          : b
      );
    }

    const updatedEntities = session.entities.map((e) => (e.id === attacker.id ? updatedDockedEntity : e));
    updatedEntities.push(sortieEntity);

    const targetPID = getContactPID(targetEntityId, faction, session.fogOfWarContacts);
    const targetDisplayName = targetPID.isPID ? targetName : 'Hostile Target Track (Unverified PID)';

    const newReports: CombatReport[] = [
      ...(session.reports || []),
      {
        id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        category: 'offensive_strike',
        title: `🚀 Strike Sortie Tasked: ${sortieName}`,
        summary: `Scrambled ${sortieName} on strike mission against ${targetDisplayName} committing ${salvoCount} × ${weaponName} (Stand-off range: ${weaponRangeKm} km).`,
        lngLat: attacker.lngLat,
        countryIso: attacker.iso,
        faction,
        primaryEntity: {
          id: sortieEntity.id,
          name: sortieName,
          typeId: sortieEntity.typeId,
          domain: spec ? domainOf(spec) : 'air',
          iso: sortieEntity.iso,
          isFriendly: true,
          isPID: true,
          count: effectiveCount,
        },
        opposingEntity: {
          id: targetEntityId,
          name: targetDisplayName,
          typeId: targetPID.isPID ? targetEntity?.typeId : undefined,
          domain: 'surface',
          iso: targetEntity?.iso ?? (isPlayer ? session.enemyIso : session.playerIso),
          isFriendly: false,
          isPID: targetPID.isPID,
        },
        munitionsDetails: {
          weaponName,
          salvoCount: effectiveSalvo,
          rangeKm: weaponRangeKm,
          speedMach: weapon?.speedMach,
          launchedBy: sortieName,
        },
        interceptionTelemetry: {
          defenseSystemName: 'Hostile Air Defense Network',
          interceptorsLaunched: 0,
          missilesIntercepted: 0,
          missilesPenetrated: effectiveSalvo,
          successRatePct: 0,
          responseDetail: 'Sortie in flight — ingress to weapon release envelope',
        },
        damageAssessment: {
          targetResultState: targetEntity?.damage ?? 'intact',
          damageInflicted: 'none',
          bdaSummary: 'Sortie en route to strike waypoint.',
        },
      },
    ];

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'launch' as const,
        title: `Strike Sortie Scrambled: ${sortieName}`,
        detail: `Scrambled ${sortieName} (${remainingCount} remaining at base) on strike mission against ${targetName} committing ${salvoCount} × ${weaponName} (Max Range: ${weaponRangeKm} km). Post-strike protocol: ${postStrikeAction.toUpperCase().replace(/_/g, ' ')}.`,
        lngLat: attacker.lngLat,
      },
    ];

    return {
      ...session,
      bases: updatedBases,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
      reports: newReports.slice(-150),
    };
  } else {
    const uniqueName = ensureUniqueEntityName(
      attacker.name,
      attacker.systemId,
      attacker.iso,
      session.entities,
      attacker.id,
      attacker.count
    );

    const updatedEntities = session.entities.map((e) => {
      if (e.id !== attackerEntityId) return e;
      return {
        ...e,
        name: uniqueName,
        status: 'engaging' as const,
        assignedMission: 'strike' as const,
        assignedTargetEntityId: targetEntityId,
        strikePlan,
        customWeapons: effectiveWeapons,
      };
    });

    const targetPID = getContactPID(targetEntityId, faction, session.fogOfWarContacts);
    const targetDisplayName = targetPID.isPID ? targetName : 'Hostile Target Track (Unverified PID)';

    const newReports: CombatReport[] = [
      ...(session.reports || []),
      {
        id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        category: 'offensive_strike',
        title: `🚀 Strike Mission Tasked: ${uniqueName}`,
        summary: `${uniqueName} tasked on strike mission against ${targetDisplayName} committing ${salvoCount} × ${weaponName} (Stand-off range: ${weaponRangeKm} km).`,
        lngLat: attacker.lngLat,
        countryIso: attacker.iso,
        faction,
        primaryEntity: {
          id: attacker.id,
          name: uniqueName,
          typeId: attacker.typeId,
          domain: spec ? domainOf(spec) : 'air',
          iso: attacker.iso,
          isFriendly: true,
          isPID: true,
          count: attacker.count,
        },
        opposingEntity: {
          id: targetEntityId,
          name: targetDisplayName,
          typeId: targetPID.isPID ? targetEntity?.typeId : undefined,
          domain: 'surface',
          iso: targetEntity?.iso ?? (isPlayer ? session.enemyIso : session.playerIso),
          isFriendly: false,
          isPID: targetPID.isPID,
        },
        munitionsDetails: {
          weaponName,
          salvoCount: effectiveSalvo,
          rangeKm: weaponRangeKm,
          speedMach: weapon?.speedMach,
          launchedBy: uniqueName,
        },
        interceptionTelemetry: {
          defenseSystemName: 'Hostile Air Defense Network',
          interceptorsLaunched: 0,
          missilesIntercepted: 0,
          missilesPenetrated: effectiveSalvo,
          successRatePct: 0,
          responseDetail: 'Platform maneuvering to stand-off release envelope',
        },
        damageAssessment: {
          targetResultState: targetEntity?.damage ?? 'intact',
          damageInflicted: 'none',
          bdaSummary: 'Platform en route to stand-off release position.',
        },
      },
    ];

    const newEvents = [
      ...session.eventLog,
      {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        simTimeSec: session.simTimeSec,
        timeFormatted: formatSimTime(session.simTimeSec),
        faction,
        type: 'launch' as const,
        title: `Strike Mission Tasked: ${uniqueName}`,
        detail: `${uniqueName} tasked on strike mission against ${targetName} committing ${salvoCount} × ${weaponName} (Max Range: ${weaponRangeKm} km). Post-strike protocol: ${postStrikeAction.toUpperCase().replace(/_/g, ' ')}.`,
        lngLat: attacker.lngLat,
      },
    ];

    return {
      ...session,
      entities: updatedEntities,
      eventLog: newEvents.slice(-200),
      reports: newReports.slice(-150),
    };
  }
}
