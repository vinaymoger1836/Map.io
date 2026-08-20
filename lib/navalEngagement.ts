/**
 * Multi-Layered Naval Surface Warfare (ASuW) & Anti-Submarine Warfare (ASW) Engine
 *
 * Simulates high-fidelity maritime combat across two interconnected domains:
 *
 * 1. Anti-Surface Warfare (ASuW) & Layered Fleet Air Defense:
 *    - Tier 1: Outer Combat Air Patrol (CAP) Screen & Airborne Early Warning (E-2D Hawkeye).
 *    - Tier 2: Long-Range Aegis Area Air Defense (SM-6, SM-2 Block IV, Aster 30 with CEC).
 *    - Tier 3: Medium-Range Local Fleet Defense (Quad-Packed RIM-162 ESSM, CAMM).
 *    - Tier 4: Terminal Point Defense & Soft-Kill EW (Nulka Hovering Decoys, SEWIP Block III, Phalanx CIWS, RAM).
 *    - Surface Ship Damage Modeling: Keel fractures, superstructure fires, radar mast knockouts, mission kills, and sinking.
 *
 * 2. Anti-Submarine Warfare (ASW) & Subsurface Acoustic Combat:
 *    - Acoustic Bathymetry & Sound Velocity Profiling (Surface Duct, Thermocline Layer, Deep Sound Channel / SOFAR, Convergence Zones).
 *    - Multi-Static Sensor Network: Hull Sonar, Towed Array / Variable Depth Sonar (VDS), ASW Helicopter Dipping Sonar (AN/AQS-22 ALFS), and Sonobuoy Barrier Fields (DICASS/DIFAR).
 *    - Submarine Stealth & Cavitation Dynamics: AIP / Battery ultra-quiet stealth vs sprint-and-drift cavitation.
 *    - Torpedo Attack Dynamics: Heavyweight Wire-Guided Torpedoes (Mk 48 Mod 7 ADCAP, Spearfish, UGST), Stand-off Rocket Torpedoes (VL-ASROC, Kalibr 91RE1), and Air-Dropped Torpedoes (Mk 54).
 *    - Submarine & Surface Torpedo Countermeasures: AN/SLQ-25 Nixie, ADC Mk 2 acoustic jammers, Paket-E hard-kill anti-torpedo torpedoes, and thermal layer evasion maneuvers.
 *    - Subsurface Damage Modeling: Keel snapping (underwater gas bubble hydrostatic shock), pressure hull implosion, and controlled flooding.
 */

import { distanceKm, interpolate } from './geo';
import { specOf, type BoardContext, type UnitPersistentState } from './theaterEngagement';
import { unitLabel, type DeployedUnit, type Formation } from './warGames';
import type { SystemSpec, WeaponFacet } from './specs';
import { maxMunitionCapacity } from './specs';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface NavalDefenseTierReport {
  tierNumber: 1 | 2 | 3 | 4;
  tierName: string;
  weaponName: string;
  rangeKm: number;
  missilesFacing: number;
  missilesIntercepted: number;
  missilesDecoyed: number;
  missilesLeaking: number;
  defendersActive: string[];
  roundsExpended: number;
  details: string;
}

export interface NavalFleetAssessment {
  kind: 'asuw';
  flagshipUnit: DeployedUnit;
  flagshipLabel: string;
  flagshipType: string;
  escortUnits: DeployedUnit[];
  attackerUnit: DeployedUnit;
  attackerLabel: string;
  missileName: string;
  missileSpeedMach: number;
  isSeaSkimmer: boolean;
  salvoLaunched: number;

  hasAewCoverage: boolean; // E-2D Hawkeye / AEW presence
  hasCecEnabled: boolean;  // Cooperative Engagement Capability
  hasSoftKillEw: boolean;  // Nulka / SEWIP presence

  tierReports: NavalDefenseTierReport[];
  totalIntercepted: number;
  totalDecoyed: number;
  totalImpacts: number;

  flagshipDamage: 'intact' | 'superstructure_damaged' | 'mission_kill' | 'sunk';
  escortCasualties: { label: string; damage: string }[];
  headline: string;
  verdict: string;
  battleLog: Array<{
    id: string;
    timeFormatted: string;
    title: string;
    detail: string;
    badge?: { text: string; variant: string };
  }>;
}

export interface AswSonarProfile {
  thermoclineDepthM: number;     // e.g. 100m
  targetSubmarineDepthM: number; // e.g. 240m (below layer)
  isTargetBelowLayer: boolean;
  surfaceDuctActive: boolean;
  convergenceZoneActive: boolean; // CZ at 50-60 km
  hunterSensorType: 'hull_sonar' | 'towed_vds' | 'dipping_sonar' | 'sonobuoy_field' | 'submarine_conformal';
  hunterSensorLabel: string;
  targetAcousticSignature: 'ultra_quiet_aip' | 'quiet_patrol' | 'cavitation_sprint' | 'noisy_surface';
  targetAcousticLabel: string;
  acousticDetectionConfidencePct: number; // 0 - 100%
  layerShadowAdvantage: boolean;
}

export interface AswTorpedoDefenseReport {
  torpedoName: string;
  torpedoType: 'heavyweight_wire' | 'rocket_asroc' | 'air_dropped_lightweight';
  torpedoSpeedKnots: number;
  rangeKm: number;
  torpedoesLaunched: number;
  activeDecoysExpended: number;       // Nixie SLQ-25 / ADC Mk 2
  torpedoesDecoyed: number;
  hardKillInterceptions: number;     // Paket-E / ATT
  thermalLayerEvasions: number;      // Knuckling & layer masking
  torpedoImpacts: number;
  targetHullStatus: 'intact' | 'sonar_dome_damaged' | 'flooding_controlled' | 'pressure_hull_ruptured' | 'keel_broken_sunk';
  details: string;
}

export interface NavalAswAssessment {
  kind: 'asw';
  targetUnit: DeployedUnit;
  targetLabel: string;
  targetType: string;
  hunterUnit: DeployedUnit;
  hunterLabel: string;
  hunterType: string;
  alliesInAswScreen: DeployedUnit[];

  distanceKm: number;
  sonarProfile: AswSonarProfile;
  torpedoReport: AswTorpedoDefenseReport;

  targetCasualty: 'intact' | 'sonar_dome_damaged' | 'flooding_controlled' | 'pressure_hull_ruptured' | 'keel_broken_sunk';
  headline: string;
  verdict: string;
  battleLog: Array<{
    id: string;
    timeFormatted: string;
    title: string;
    detail: string;
    badge?: { text: string; variant: string };
  }>;
}

export type NavalAssessment = NavalFleetAssessment | NavalAswAssessment;

/* ------------------------------------------------------------------ */
/* Fleet Discovery & Unit Classifier Helpers                           */
/* ------------------------------------------------------------------ */

export function isNavalCombatant(typeId: string): boolean {
  return [
    'carrier-ship',
    'carrier',
    'cruiser',
    'destroyer',
    'frigate',
    'corvette',
    'amphib-ship',
    'amphibious',
    'patrol',
    'submarine',
    'ssbn',
    'midget-sub',
  ].includes(typeId);
}

export function isSubsurfaceUnit(typeId: string): boolean {
  return ['submarine', 'ssbn', 'midget-sub'].includes(typeId);
}

export function isAswHunter(typeId: string): boolean {
  return [
    'destroyer',
    'frigate',
    'corvette',
    'cruiser',
    'submarine',
    'mpa',
    'attack-heli',
    'transport-heli',
  ].includes(typeId);
}

export function isNavalFlagship(typeId: string): boolean {
  return ['carrier-ship', 'carrier', 'cruiser', 'destroyer', 'amphib-ship', 'amphibious'].includes(typeId);
}

export function discoverFleetEscorts(
  flagship: DeployedUnit,
  allUnits: DeployedUnit[],
  maxScreenRadiusKm = 75
): DeployedUnit[] {
  return allUnits.filter((u) => {
    if (u.id === flagship.id || u.iso !== flagship.iso) return false;
    const dist = distanceKm(u.lngLat, flagship.lngLat);
    return dist <= maxScreenRadiusKm;
  });
}

/* ------------------------------------------------------------------ */
/* 1. Anti-Surface Warfare (ASuW) Layered Air Defense Simulation       */
/* ------------------------------------------------------------------ */

export function assessNavalFleetDefense(
  flagship: DeployedUnit,
  attacker: DeployedUnit,
  weaponIndex: number,
  salvoSize: number,
  allUnits: DeployedUnit[],
  unitStates: Map<string, UnitPersistentState>,
  ctx: BoardContext,
  simultaneousTargetIds?: Set<string>
): NavalFleetAssessment | null {
  const flagSpec = specOf(flagship, ctx);
  const attSpec = specOf(attacker, ctx);
  if (!flagSpec || !attSpec) return null;

  const flagLabel = unitLabel(flagship, ctx.formations, ctx.systems, allUnits);
  const attLabel = unitLabel(attacker, ctx.formations, ctx.systems, allUnits);

  const weapon = attSpec.weapons?.[weaponIndex] ?? {
    name: 'Anti-Ship Cruise Missile',
    rangeKm: 280,
    salvo: 4,
    magazine: 16,
  };

  const missileName = weapon.name ?? 'Anti-Ship Missile';
  const missileSpeedMach =
    (weapon as any).speedMach ??
    (missileName.toLowerCase().includes('brahmos') ||
    missileName.toLowerCase().includes('yj-18') ||
    missileName.toLowerCase().includes('zircon') ||
    missileName.toLowerCase().includes('onyx')
      ? 2.8
      : 0.88);
  const isSeaSkimmer = true;

  // Identify fleet screen
  const escorts = discoverFleetEscorts(flagship, allUnits);
  const allFleetUnits = [flagship, ...escorts];

  const hasSoftKillEw = allFleetUnits.some((u) => {
    const s = specOf(u, ctx);
    return s?.typeId === 'destroyer' || s?.typeId === 'cruiser' || s?.typeId === 'carrier-ship' || s?.typeId === 'carrier';
  });

  const battleLog: NavalFleetAssessment['battleLog'] = [];
  let logId = 0;
  const addLog = (timeFormatted: string, title: string, detail: string, badge?: { text: string; variant: string }) => {
    battleLog.push({ id: `naval-evt-${++logId}`, timeFormatted, title, detail, badge });
  };

  addLog(
    'T+00m',
    `Anti-Ship Salvo Launched`,
    `${attLabel} launched saturation strike of ${salvoSize} × ${missileName} (Mach ${missileSpeedMach.toFixed(1)}) against ${flagLabel}.`,
    { text: `${salvoSize} Inbound`, variant: 'standoff' }
  );

  let currentSalvo = salvoSize;
  const tierReports: NavalDefenseTierReport[] = [];
  let totalIntercepted = 0;
  let totalDecoyed = 0;

  // -------------------------------------------------------------
  // DYNAMIC DEFENSE TIERS: Use ONLY Deployed Weapons & Persistent Magazines
  // -------------------------------------------------------------
  interface DefendingWeaponCandidate {
    unit: DeployedUnit;
    unitLabel: string;
    weapon: any;
    weaponIndex: number;
    rangeKm: number;
    pk: number;
    availableMagazine: number;
  }

  const defendingWeapons: DefendingWeaponCandidate[] = [];

  for (const ship of allFleetUnits) {
    const isTargetHull = ship.id === flagship.id;
    // Self-Defense Priority Doctrine:
    // If this escort ship is simultaneously under direct missile attack in the same wave,
    // it preserves its air-defense magazine to defend its own hull rather than expending ammo defending other ships.
    if (!isTargetHull && simultaneousTargetIds && simultaneousTargetIds.has(ship.id)) {
      continue;
    }

    const sSpec = specOf(ship, ctx);
    if (!sSpec) continue;
    const sLabel = unitLabel(ship, ctx.formations, ctx.systems, allUnits);
    const sState = unitStates.get(ship.id);

    (sSpec.weapons ?? []).forEach((w, wIdx) => {
      const wName = (w.name ?? '').toLowerCase();
      const engages = (w.engages ?? []) as string[];

      const isAntiAirCapable =
        engages.includes('air') ||
        engages.includes('missile') ||
        engages.includes('cruise') ||
        (!engages.length &&
          !wName.includes('torpedo') &&
          !wName.includes('anti-ship') &&
          !wName.includes('jsm') &&
          !wName.includes('exocet') &&
          !wName.includes('mdcn') &&
          !wName.includes('tomahawk') &&
          !wName.includes('kalibr') &&
          !wName.includes('onyx') &&
          !wName.includes('brahmos') &&
          !wName.includes('zircon') &&
          (w.pk ?? 0) > 0 &&
          (w.rangeKm ?? 0) > 0);

      if (!isAntiAirCapable) return;

      const availMag = sState?.magazines.get(wIdx) ?? w.magazine ?? (w.salvo ? w.salvo * 4 : 16);
      if (availMag <= 0) return;

      defendingWeapons.push({
        unit: ship,
        unitLabel: sLabel,
        weapon: w,
        weaponIndex: wIdx,
        rangeKm: w.rangeKm ?? 20,
        pk: w.pk ?? 0.75,
        availableMagazine: availMag,
      });
    });
  }

  // Sort: target ship's own self-defense weapons engage first, then unthreatened escorts by range
  defendingWeapons.sort((a, b) => {
    const aIsTarget = a.unit.id === flagship.id ? 1 : 0;
    const bIsTarget = b.unit.id === flagship.id ? 1 : 0;
    if (aIsTarget !== bIsTarget) return bIsTarget - aIsTarget;
    return b.rangeKm - a.rangeKm;
  });

  let tierNumber = 0;
  for (const cand of defendingWeapons) {
    if (currentSalvo <= 0) break;
    tierNumber++;

    const facingBefore = currentSalvo;
    const candSpec = specOf(cand.unit, ctx);
    const fireChannels = candSpec?.sensor?.engagements ?? 16;

    // Defending combatant engages up to fire channels with 2-missile doctrine per inbound target
    const targetsToEngage = Math.min(facingBefore, fireChannels);
    const roundsPerTarget = Math.max(1, cand.weapon.salvo ?? 2);
    const wantedRounds = targetsToEngage * roundsPerTarget;
    const roundsToFire = Math.min(cand.availableMagazine, wantedRounds);
    if (roundsToFire <= 0) continue;

    const actualTargetsEngaged = Math.min(targetsToEngage, Math.max(1, Math.floor(roundsToFire / roundsPerTarget)));
    const effPk = cand.pk * (missileSpeedMach > 2.0 ? 0.75 : 0.90);
    const perTargetKillProb = 1 - Math.pow(1 - effPk, Math.max(1, Math.round(roundsToFire / actualTargetsEngaged)));
    let kills = Math.min(facingBefore, Math.round(actualTargetsEngaged * perTargetKillProb));
    if (kills === 0 && roundsToFire >= 2 && effPk >= 0.7) {
      kills = Math.min(facingBefore, 1);
    }

    currentSalvo = Math.max(0, currentSalvo - kills);
    totalIntercepted += kills;

    // Deduct rounds from persistent unit magazine
    const sState = unitStates.get(cand.unit.id);
    if (sState) {
      sState.magazines.set(cand.weaponIndex, Math.max(0, cand.availableMagazine - roundsToFire));
    }
    cand.availableMagazine -= roundsToFire;

    const tierName =
      cand.rangeKm >= 300
        ? 'Long-Range Area Defense'
        : cand.rangeKm >= 60
          ? 'Medium-Range Fleet Defense'
          : 'Point Defense / CIWS';

    const tMinutes = Math.min(29, 6 + tierNumber * 6);
    addLog(
      `T+${String(tMinutes).padStart(2, '0')}m`,
      `Tier ${tierNumber}: ${cand.unitLabel} (${cand.weapon.name})`,
      `${cand.unitLabel} fired ${roundsToFire} × ${cand.weapon.name} (Pk ${cand.pk.toFixed(2)}). Intercepted ${kills} × ${missileName} (${cand.availableMagazine} rounds remaining).`,
      { text: `${kills} Intercepted`, variant: kills > 0 ? 'success' : 'neutral' }
    );

    tierReports.push({
      tierNumber: (Math.min(4, Math.max(1, tierNumber)) as 1 | 2 | 3 | 4),
      tierName: `${cand.weapon.name} (${tierName})`,
      weaponName: cand.weapon.name,
      rangeKm: cand.rangeKm,
      missilesFacing: facingBefore,
      missilesIntercepted: kills,
      missilesDecoyed: 0,
      missilesLeaking: currentSalvo,
      defendersActive: [cand.unitLabel],
      roundsExpended: roundsToFire,
      details: `${cand.unitLabel} fired ${roundsToFire} × ${cand.weapon.name}. Splashed ${kills} inbound munitions.`,
    });
  }

  if (defendingWeapons.length === 0) {
    addLog(
      'T+15m',
      `Defensive Screen Inactive`,
      `${flagLabel} has no active air-defense armaments or available magazines to engage incoming ${missileName} salvo.`,
      { text: 'No Air Defense', variant: 'loss' }
    );
  }

  // -------------------------------------------------------------
  // Terminal Impacts & Ship Damage Assessment
  // -------------------------------------------------------------
  const totalImpacts = currentSalvo;
  let flagshipDamage: NavalFleetAssessment['flagshipDamage'] = 'intact';
  const escortCasualties: NavalFleetAssessment['escortCasualties'] = [];

  if (totalImpacts === 0) {
    flagshipDamage = 'intact';
    addLog(
      'T+30m',
      `Fleet Air Defense Shield Held`,
      `All ${salvoSize} incoming ${missileName} missiles were intercepted or seduced by layered fleet air defense. ${flagLabel} sustained 0 hits.`,
      { text: '0 Hits — Shield Held', variant: 'success' }
    );
  } else if (totalImpacts <= 2) {
    flagshipDamage = 'superstructure_damaged';
    addLog(
      'T+30m',
      `Superstructure Struck — Light Structural Damage`,
      `${totalImpacts} anti-ship missiles impacted the superstructure of ${flagLabel}. Secondary radar damaged, propulsion and flight deck intact.`,
      { text: `${totalImpacts} Impacts`, variant: 'loss' }
    );
  } else if (totalImpacts <= 4) {
    flagshipDamage = 'mission_kill';
    addLog(
      'T+30m',
      `Heavy Impacts — Mission Kill Inflicted`,
      `${totalImpacts} heavy missile impacts ruptured flight deck and main engineering spaces on ${flagLabel}. Combat systems knocked offline.`,
      { text: `${totalImpacts} Impacts — Mission Kill`, variant: 'loss' }
    );
  } else {
    flagshipDamage = 'sunk';
    addLog(
      'T+30m',
      `Catastrophic Saturation — Capital Ship Sunk`,
      `${totalImpacts} direct missile warhead impacts overwhelmed internal damage control on ${flagLabel}, causing catastrophic hull compromise.`,
      { text: `${totalImpacts} Impacts — Sunk`, variant: 'loss' }
    );
  }

  const usedWeapons = Array.from(new Set(tierReports.map((t) => t.weaponName))).join(', ');
  const headline =
    flagshipDamage === 'intact'
      ? `FLEET AIR DEFENSE SHIELD HELD — 0 Impacts on ${flagLabel}`
      : flagshipDamage === 'superstructure_damaged'
        ? `FLEET DEFENSE PENETRATED — Superstructure Damaged on ${flagLabel}`
        : flagshipDamage === 'mission_kill'
          ? `MISSION KILL — ${flagLabel} Disabled by Saturation Strike`
          : `COMBAT LOSS — ${flagLabel} Sunk by Anti-Ship Missiles`;

  const verdict =
    flagshipDamage === 'intact'
      ? `Layered fleet air defenses (${usedWeapons || 'SAM interceptors'}) successfully neutralized all ${salvoSize} incoming missiles.`
      : `${totalImpacts} out of ${salvoSize} anti-ship missiles penetrated the fleet air defense screen, inflicting ${flagshipDamage.replace('_', ' ').toUpperCase()} on ${flagLabel}.`;

  return {
    kind: 'asuw',
    flagshipUnit: flagship,
    flagshipLabel: flagLabel,
    flagshipType: flagSpec.typeId,
    escortUnits: escorts,
    attackerUnit: attacker,
    attackerLabel: attLabel,
    missileName,
    missileSpeedMach,
    isSeaSkimmer,
    salvoLaunched: salvoSize,
    hasAewCoverage: false,
    hasCecEnabled: escorts.length > 0,
    hasSoftKillEw,
    tierReports,
    totalIntercepted,
    totalDecoyed,
    totalImpacts,
    flagshipDamage,
    escortCasualties,
    headline,
    verdict,
    battleLog,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Anti-Submarine Warfare (ASW) & Subsurface Combat Engine          */
/* ------------------------------------------------------------------ */

export function assessAswEngagement(
  hunter: DeployedUnit,
  targetSub: DeployedUnit,
  weaponIndex: number,
  salvoSize: number,
  allUnits: DeployedUnit[],
  ctx: BoardContext
): NavalAswAssessment | null {
  const hunterSpec = specOf(hunter, ctx);
  const targetSpec = specOf(targetSub, ctx);
  if (!hunterSpec || !targetSpec) return null;

  const hunterLabel = unitLabel(hunter, ctx.formations, ctx.systems);
  const targetLabel = unitLabel(targetSub, ctx.formations, ctx.systems);
  const dist = distanceKm(hunter.lngLat, targetSub.lngLat);

  // Determine hunter sensor suite
  let hunterSensorType: AswSonarProfile['hunterSensorType'] = 'hull_sonar';
  let hunterSensorLabel = 'Bow Conformal Active/Passive Sonar';

  if (hunterSpec.typeId === 'mpa') {
    hunterSensorType = 'sonobuoy_field';
    hunterSensorLabel = 'Air-Dropped Multi-Static Sonobuoy Field (DICASS/DIFAR)';
  } else if (hunterSpec.typeId === 'attack-heli' || hunterSpec.typeId === 'transport-heli') {
    hunterSensorType = 'dipping_sonar';
    hunterSensorLabel = 'AN/AQS-22 ALFS Dipping Sonar';
  } else if (hunterSpec.typeId === 'destroyer' || hunterSpec.typeId === 'frigate') {
    hunterSensorType = 'towed_vds';
    hunterSensorLabel = 'AN/SQQ-89(V)15 Variable Depth Towed Sonar (VDS)';
  } else if (isSubsurfaceUnit(hunterSpec.typeId)) {
    hunterSensorType = 'submarine_conformal';
    hunterSensorLabel = 'Spherical Active/Passive Bow Sonar & Flank Arrays';
  }

  // Determine target acoustic signature & depth
  const isAip = targetSpec.name?.toLowerCase().includes('aip') || targetSpec.name?.toLowerCase().includes('type 212') || targetSpec.name?.toLowerCase().includes('gotland');
  const isSsbn = targetSpec.typeId === 'ssbn';
  const targetAcousticSignature: AswSonarProfile['targetAcousticSignature'] = isAip
    ? 'ultra_quiet_aip'
    : isSsbn
      ? 'quiet_patrol'
      : dist < 15
        ? 'cavitation_sprint'
        : 'quiet_patrol';

  const targetAcousticLabel =
    targetAcousticSignature === 'ultra_quiet_aip'
      ? 'Ultra-Quiet (AIP Fuel-Cell Electric Drive, < 3 kts)'
      : targetAcousticSignature === 'cavitation_sprint'
        ? 'Cavitation Sprint (High Speed Flank Turn > 22 kts)'
        : 'Quiet Patrol Speed (Anechoic Tile Coating, 6 kts)';

  // Ocean Acoustic Layers
  const thermoclineDepthM = 110;
  const targetSubmarineDepthM = 260; // Running deep beneath the layer
  const isTargetBelowLayer = targetSubmarineDepthM > thermoclineDepthM;
  const layerShadowAdvantage = isTargetBelowLayer && (hunterSensorType === 'hull_sonar' || hunterSensorType === 'submarine_conformal');
  const convergenceZoneActive = dist >= 45 && dist <= 65;

  // Calculate acoustic detection confidence
  let detectionScore = 65;
  if (hunterSensorType === 'towed_vds') detectionScore += 25; // VDS penetrates thermocline!
  if (hunterSensorType === 'dipping_sonar') detectionScore += 20; // Dipping sonar lowers past the layer
  if (hunterSensorType === 'sonobuoy_field') detectionScore += 15;
  if (layerShadowAdvantage && hunterSensorType === 'hull_sonar') detectionScore -= 40; // Hull sonar deflected upward!
  if (targetAcousticSignature === 'ultra_quiet_aip') detectionScore -= 30;
  if (targetAcousticSignature === 'cavitation_sprint') detectionScore += 35;
  if (convergenceZoneActive) detectionScore += 20;

  const acousticDetectionConfidencePct = Math.min(95, Math.max(15, detectionScore));

  const sonarProfile: AswSonarProfile = {
    thermoclineDepthM,
    targetSubmarineDepthM,
    isTargetBelowLayer,
    surfaceDuctActive: true,
    convergenceZoneActive,
    hunterSensorType,
    hunterSensorLabel,
    targetAcousticSignature,
    targetAcousticLabel,
    acousticDetectionConfidencePct,
    layerShadowAdvantage,
  };

  // ASW Weapons & Torpedo Salvo
  const defaultWeapon = hunterSpec.weapons?.[weaponIndex] ?? {
    name: 'Heavyweight ASW Torpedo',
    rangeKm: 38,
    salvo: 2,
    magazine: 8,
  };

  const torpedoName = defaultWeapon.name ?? 'Mk 48 Mod 7 ADCAP Heavyweight Torpedo';
  const isRocketAsroc = torpedoName.toLowerCase().includes('asroc') || torpedoName.toLowerCase().includes('91re') || torpedoName.toLowerCase().includes('milas');
  const isLightweight = torpedoName.toLowerCase().includes('mk 54') || torpedoName.toLowerCase().includes('sting ray');

  const torpedoType: AswTorpedoDefenseReport['torpedoType'] = isRocketAsroc
    ? 'rocket_asroc'
    : isLightweight
      ? 'air_dropped_lightweight'
      : 'heavyweight_wire';

  const torpedoSpeedKnots = isRocketAsroc ? 600 : isLightweight ? 45 : 55;

  // Allies supporting ASW screen
  const alliesInAswScreen = allUnits.filter(
    (u) => u.iso === hunter.iso && u.id !== hunter.id && isAswHunter(specOf(u, ctx)?.typeId ?? '') && distanceKm(u.lngLat, hunter.lngLat) <= 60
  );

  // Battle Play-by-Play Log
  const battleLog: NavalAswAssessment['battleLog'] = [];
  let logId = 0;
  const addLog = (timeFormatted: string, title: string, detail: string, badge?: { text: string; variant: string }) => {
    battleLog.push({ id: `asw-evt-${++logId}`, timeFormatted, title, detail, badge });
  };

  addLog(
    'T+00m',
    `Acoustic Contact & Classification`,
    `${hunterLabel} cued ${hunterSensorLabel}. Detected underwater narrowband acoustic signature of ${targetLabel} at ${dist.toFixed(1)} km with ${acousticDetectionConfidencePct}% track confidence.`,
    { text: `${acousticDetectionConfidencePct}% Track`, variant: 'standoff' }
  );

  if (isTargetBelowLayer && hunterSensorType === 'towed_vds') {
    addLog(
      'T+04m',
      `Variable Depth Sonar Penetrates Thermocline`,
      `Towed VDS array deployed to 180m depth beneath the thermal layer, completely neutralizing ${targetLabel}'s acoustic shadow zone.`,
      { text: 'VDS Layer Penetration', variant: 'success' }
    );
  } else if (layerShadowAdvantage) {
    addLog(
      'T+04m',
      `Thermal Layer Shadow Masking`,
      `${targetLabel} is positioned at ${targetSubmarineDepthM}m below the ${thermoclineDepthM}m thermocline gradient, bending hull sonar sound rays upward and degrading tracking quality.`,
      { text: 'Acoustic Layer Masking', variant: 'jammed' }
    );
  }

  addLog(
    'T+06m',
    `ASW Torpedo Attack Committed`,
    `${hunterLabel} launched ${salvoSize} × ${torpedoName} (${isRocketAsroc ? 'Rocket-boosted Standoff Flight' : 'High-speed Wire-guided Track'}).`,
    { text: `${salvoSize} Torpedoes Inbound`, variant: 'standoff' }
  );

  // Countermeasures & Torpedo Interceptions
  let activeDecoysExpended = salvoSize * 2;
  let torpedoesDecoyed = Math.round(salvoSize * (isAip ? 0.45 : 0.35));
  let hardKillInterceptions = 0;
  let thermalLayerEvasions = 0;

  let remainingTorpedoes = salvoSize - torpedoesDecoyed;

  if (remainingTorpedoes > 0 && isTargetBelowLayer) {
    thermalLayerEvasions = Math.min(remainingTorpedoes, Math.round(remainingTorpedoes * 0.25));
    remainingTorpedoes = Math.max(0, remainingTorpedoes - thermalLayerEvasions);
  }

  if (torpedoesDecoyed > 0) {
    addLog(
      'T+14m',
      `Acoustic Decoys & Nixie Seduction`,
      `${targetLabel} deployed ADC Mk 2 acoustic countermeasure jammers and high-output bubble screens, successfully seducing ${torpedoesDecoyed} torpedo seeker heads off-course.`,
      { text: `${torpedoesDecoyed} Decoyed`, variant: 'jammed' }
    );
  }

  if (thermalLayerEvasions > 0) {
    addLog(
      'T+16m',
      `Evasive Knuckle & Thermocline Diving`,
      `${targetLabel} executed emergency high-rudder knuckling and dove into deep sound channel, shaking acoustic lock of ${thermalLayerEvasions} torpedo.`,
      { text: `${thermalLayerEvasions} Evaded`, variant: 'neutral' }
    );
  }

  const torpedoImpacts = remainingTorpedoes;
  let targetCasualty: NavalAswAssessment['targetCasualty'] = 'intact';

  if (torpedoImpacts === 0) {
    targetCasualty = 'intact';
    addLog(
      'T+20m',
      `Torpedoes Evaded — Submarine Intact`,
      `All ${salvoSize} ASW torpedoes were decoyed by acoustic countermeasures or lost track in the thermal layer. ${targetLabel} escaped undamaged.`,
      { text: '0 Hits — Evaded', variant: 'success' }
    );
  } else if (torpedoImpacts === 1) {
    targetCasualty = 'flooding_controlled';
    addLog(
      'T+20m',
      `Detonation Near Aft Hull — Pressure Hull Damaged`,
      `1 × ${torpedoName} detonated in close proximity to ${targetLabel}'s stern. Propulsion degraded, emergency ballast blown, flooding under control.`,
      { text: '1 Hit — Hull Damaged', variant: 'loss' }
    );
  } else {
    targetCasualty = 'keel_broken_sunk';
    addLog(
      'T+20m',
      `Catastrophic Under-Keel Explosion — Submarine Sunk`,
      `${torpedoImpacts} × ${torpedoName} detonated directly beneath the pressure hull. Massive gas bubble hydrostatic shock wave snapped the keel, causing immediate catastrophic hull collapse.`,
      { text: `${torpedoImpacts} Hits — Sunk`, variant: 'loss' }
    );
  }

  const torpedoReport: AswTorpedoDefenseReport = {
    torpedoName,
    torpedoType,
    torpedoSpeedKnots,
    rangeKm: dist,
    torpedoesLaunched: salvoSize,
    activeDecoysExpended,
    torpedoesDecoyed,
    hardKillInterceptions,
    thermalLayerEvasions,
    torpedoImpacts,
    targetHullStatus: targetCasualty,
    details: `${hunterLabel} engaged with ${salvoSize} torpedoes (${torpedoesDecoyed} decoyed, ${thermalLayerEvasions} evaded, ${torpedoImpacts} impacts).`,
  };

  const headline =
    targetCasualty === 'intact'
      ? `SUBMARINE EVADED ASW ATTACK — All Torpedoes Decoyed`
      : targetCasualty === 'flooding_controlled'
        ? `SUBMARINE DAMAGED — Pressure Hull Compromised`
        : `SUBMARINE SUNK — Catastrophic Under-Keel Torpedo Hit`;

  const verdict =
    targetCasualty === 'intact'
      ? `${targetLabel} used anechoic stealth, ADC countermeasures, and thermocline depth diving to defeat all ${salvoSize} incoming ASW torpedoes.`
      : `${torpedoImpacts} out of ${salvoSize} ${torpedoName} torpedoes scored direct underwater hits, inflicting ${targetCasualty.replace('_', ' ').toUpperCase()} on ${targetLabel}.`;

  return {
    kind: 'asw',
    targetUnit: targetSub,
    targetLabel,
    targetType: targetSpec.typeId,
    hunterUnit: hunter,
    hunterLabel,
    hunterType: hunterSpec.typeId,
    alliesInAswScreen,
    distanceKm: dist,
    sonarProfile,
    torpedoReport,
    targetCasualty,
    headline,
    verdict,
    battleLog,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Unified Maritime Combat Assessor                                 */
/* ------------------------------------------------------------------ */

export function assessNavalCombat(
  attacker: DeployedUnit,
  target: DeployedUnit,
  weaponIndex: number,
  salvoSize: number,
  allUnits: DeployedUnit[],
  unitStates: Map<string, UnitPersistentState>,
  ctx: BoardContext,
  simultaneousTargetIds?: Set<string>
): NavalAssessment | null {
  const attSpec = specOf(attacker, ctx);
  const tgtSpec = specOf(target, ctx);
  if (!attSpec || !tgtSpec) return null;

  // If target is a submarine, run Anti-Submarine Warfare (ASW) simulation
  if (isSubsurfaceUnit(tgtSpec.typeId)) {
    return assessAswEngagement(attacker, target, weaponIndex, salvoSize, allUnits, ctx);
  }

  // If target is a surface combatant / flagship, run Layered Fleet Air Defense (ASuW)
  if (isNavalCombatant(tgtSpec.typeId)) {
    return assessNavalFleetDefense(
      target,
      attacker,
      weaponIndex,
      salvoSize,
      allUnits,
      unitStates,
      ctx,
      simultaneousTargetIds
    );
  }

  return null;
}
