/**
 * Layered Fleet Air Defense & Carrier Strike Group (CSG) Survivability Engine
 *
 * Models modern naval defense-in-depth against anti-ship missile (AShM) saturation salvos:
 * - Tier 1: Outer CAP Screen & Airborne Early Warning (E-2D Hawkeye + F/A-18F / F-35C).
 * - Tier 2: Area Air Defense (Aegis SM-6 / SM-2 / Aster 30 with Cooperative Engagement Capability).
 * - Tier 3: Medium-Range Local Defense (Quad-packed RIM-162 ESSM / CAMM).
 * - Tier 4: Terminal Point Defense & Soft-Kill EW (Nulka Active Decoys, SEWIP Block III, RAM & Phalanx CIWS).
 * - Ship Hull Survivability, Mission Kills, and Structural Damage Calculations.
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

/* ------------------------------------------------------------------ */
/* Fleet Discovery & Capability Helpers                                */
/* ------------------------------------------------------------------ */

export function isNavalCombatant(typeId: string): boolean {
  return ['destroyer', 'cruiser', 'carrier', 'corvette', 'frigate', 'submarine'].includes(typeId);
}

export function isNavalFlagship(typeId: string): boolean {
  return ['carrier', 'cruiser', 'destroyer', 'amphibious'].includes(typeId);
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
/* Layered Fleet Defense Simulation Engine                            */
/* ------------------------------------------------------------------ */

export function assessNavalFleetDefense(
  flagship: DeployedUnit,
  attacker: DeployedUnit,
  weaponIndex: number,
  salvoSize: number,
  allUnits: DeployedUnit[],
  unitStates: Map<string, UnitPersistentState>,
  ctx: BoardContext
): NavalFleetAssessment | null {
  const flagSpec = specOf(flagship, ctx);
  const attSpec = specOf(attacker, ctx);
  if (!flagSpec || !attSpec) return null;

  const flagLabel = unitLabel(flagship, ctx.formations, ctx.systems);
  const attLabel = unitLabel(attacker, ctx.formations, ctx.systems);

  const weapon = attSpec.weapons?.[weaponIndex] ?? {
    name: 'Anti-Ship Cruise Missile',
    rangeKm: 280,
    salvo: 4,
    magazine: 16,
  };

  const missileName = weapon.name ?? 'Anti-Ship Missile';
  const missileSpeedMach = (weapon as any).speedMach ?? (missileName.toLowerCase().includes('brahmos') || missileName.toLowerCase().includes('yj-18') || missileName.toLowerCase().includes('onyx') ? 2.8 : 0.88);
  const isSeaSkimmer = true;

  // Identify fleet screen
  const escorts = discoverFleetEscorts(flagship, allUnits);
  const allFleetUnits = [flagship, ...escorts];

  // Check AEW (E-2D Hawkeye) & CAP in theater
  const sameNationUnits = allUnits.filter((u) => u.iso === flagship.iso);
  const aewUnit = sameNationUnits.find((u) => {
    const s = specOf(u, ctx);
    return s?.typeId === 'awacs' || s?.name?.toLowerCase().includes('e-2') || s?.name?.toLowerCase().includes('hawkeye');
  });
  const capUnit = sameNationUnits.find((u) => {
    const s = specOf(u, ctx);
    return (s?.typeId === 'fighter' || s?.typeId === 'interceptor') && distanceKm(u.lngLat, flagship.lngLat) <= 400;
  });

  const hasAewCoverage = Boolean(aewUnit);
  const hasCecEnabled = hasAewCoverage || escorts.length > 0;
  const hasSoftKillEw = allFleetUnits.some((u) => {
    const s = specOf(u, ctx);
    return s?.typeId === 'destroyer' || s?.typeId === 'cruiser' || s?.typeId === 'carrier';
  });

  const battleLog: NavalFleetAssessment['battleLog'] = [];
  let logId = 0;
  const addLog = (timeFormatted: string, title: string, detail: string, badge?: { text: string; variant: string }) => {
    battleLog.push({ id: `naval-evt-${++logId}`, timeFormatted, title, detail, badge });
  };

  addLog(
    'T+00m',
    `Anti-Ship Salvo Launched`,
    `${attLabel} launched saturation strike of ${salvoSize} × ${missileName} (Mach ${missileSpeedMach}) against ${flagLabel}.`,
    { text: `${salvoSize} Inbound`, variant: 'standoff' }
  );

  let currentSalvo = salvoSize;
  const tierReports: NavalDefenseTierReport[] = [];
  let totalIntercepted = 0;
  let totalDecoyed = 0;

  // -------------------------------------------------------------
  // TIER 1: Outer CAP Screen & AEW Early Warning (300 km – 450 km)
  // -------------------------------------------------------------
  if (capUnit && currentSalvo > 0) {
    const capSpec = specOf(capUnit, ctx);
    const capLabel = unitLabel(capUnit, ctx.formations, ctx.systems);
    const capCount = capUnit.kind === 'unit' ? capUnit.count : 4;
    const aamKills = Math.min(currentSalvo, Math.round(capCount * (hasAewCoverage ? 1.8 : 1.2)));

    if (aamKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - aamKills);
      totalIntercepted += aamKills;

      addLog(
        'T+08m',
        `Tier 1: Outer CAP Interception`,
        `${capLabel} cued by ${hasAewCoverage ? 'E-2D Hawkeye AEW' : 'Shipboard Radar'} engaged inbound missile stream with BVR missiles. Splashed ${aamKills} missiles.`,
        { text: `${aamKills} Splashed`, variant: 'success' }
      );

      tierReports.push({
        tierNumber: 1,
        tierName: 'Outer CAP & AEW Screen',
        weaponName: 'AIM-120D / Meteor BVR Missiles',
        rangeKm: 350,
        missilesFacing: salvoSize,
        missilesIntercepted: aamKills,
        missilesDecoyed: 0,
        missilesLeaking: currentSalvo,
        defendersActive: [capLabel],
        roundsExpended: aamKills * 2,
        details: `${capLabel} splashed ${aamKills} missiles at long range.`,
      });
    }
  } else {
    addLog(
      'T+08m',
      `Tier 1: Outer Screen Bypassed`,
      `No Combat Air Patrol (CAP) was positioned along the ingress corridor. Inbound salvo penetrates to Aegis area defense tier.`,
      { text: 'Bypassed', variant: 'neutral' }
    );
  }

  // -------------------------------------------------------------
  // TIER 2: Long-Range Aegis Area Defense (SM-6 / SM-2, 100 km – 240 km)
  // -------------------------------------------------------------
  if (currentSalvo > 0) {
    const aegisShips = allFleetUnits.filter((u) => {
      const s = specOf(u, ctx);
      return s?.typeId === 'destroyer' || s?.typeId === 'cruiser';
    });

    const activeAegis = aegisShips.map((u) => unitLabel(u, ctx.formations, ctx.systems));
    const fireChannels = Math.max(4, aegisShips.length * (hasCecEnabled ? 6 : 4));
    const smSalvoCommitted = Math.min(currentSalvo * 2, fireChannels * 2);
    const smKills = Math.min(currentSalvo, Math.round(smSalvoCommitted * (hasCecEnabled ? 0.42 : 0.35)));

    if (smKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - smKills);
      totalIntercepted += smKills;

      addLog(
        'T+18m',
        `Tier 2: Aegis Area Air Defense Interception`,
        `${activeAegis.join(', ') || flagLabel} fired ${smSalvoCommitted} × SM-6/SM-2 interceptors via ${hasCecEnabled ? 'Cooperative Engagement Capability (CEC)' : 'Local SPY-1 Radar'}. Destroyed ${smKills} anti-ship missiles.`,
        { text: `${smKills} Intercepted`, variant: 'success' }
      );
    }

    tierReports.push({
      tierNumber: 2,
      tierName: 'Aegis Area Defense',
      weaponName: 'RIM-174 SM-6 / SM-2 Block IV',
      rangeKm: 240,
      missilesFacing: currentSalvo + smKills,
      missilesIntercepted: smKills,
      missilesDecoyed: 0,
      missilesLeaking: currentSalvo,
      defendersActive: activeAegis.length > 0 ? activeAegis : [flagLabel],
      roundsExpended: smSalvoCommitted,
      details: `Aegis fleet defense network intercepted ${smKills} missiles in outer missile engagement zone.`,
    });
  }

  // -------------------------------------------------------------
  // TIER 3: Medium-Range Local Air Defense (ESSM / CAMM, 25 km – 50 km)
  // -------------------------------------------------------------
  if (currentSalvo > 0) {
    const essmFacing = currentSalvo;
    const essmChannels = allFleetUnits.length * 4;
    const essmRounds = Math.min(essmFacing * 2, essmChannels);
    const essmKills = Math.min(currentSalvo, Math.round(essmRounds * (missileSpeedMach > 2.0 ? 0.35 : 0.48)));

    if (essmKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - essmKills);
      totalIntercepted += essmKills;

      addLog(
        'T+24m',
        `Tier 3: ESSM Local Defense Interception`,
        `Fleet VLS cells ripple-fired ${essmRounds} × RIM-162 ESSM quad-packed interceptors at sea-skimmers. Splashed ${essmKills} missiles.`,
        { text: `${essmKills} Splashed`, variant: 'success' }
      );
    }

    tierReports.push({
      tierNumber: 3,
      tierName: 'Medium-Range Fleet Defense',
      weaponName: 'RIM-162 ESSM (Quad-Packed)',
      rangeKm: 50,
      missilesFacing: essmFacing,
      missilesIntercepted: essmKills,
      missilesDecoyed: 0,
      missilesLeaking: currentSalvo,
      defendersActive: [flagLabel, ...escorts.map((e) => unitLabel(e, ctx.formations, ctx.systems))],
      roundsExpended: essmRounds,
      details: `Quad-packed ESSMs engaged terminal sea-skimmers, destroying ${essmKills} missiles.`,
    });
  }

  // -------------------------------------------------------------
  // TIER 4: Terminal Point Defense & Soft-Kill EW (0 km – 15 km)
  // -------------------------------------------------------------
  if (currentSalvo > 0) {
    const tier4Facing = currentSalvo;

    // 1. Soft-Kill EW & Decoys (Nulka / SEWIP)
    let decoyedCount = 0;
    if (hasSoftKillEw) {
      decoyedCount = Math.min(currentSalvo, Math.round(currentSalvo * 0.38));
      currentSalvo = Math.max(0, currentSalvo - decoyedCount);
      totalDecoyed += decoyedCount;

      if (decoyedCount > 0) {
        addLog(
          'T+28m',
          `Tier 4: Soft-Kill EW & Nulka Decoy Seduction`,
          `Nulka active hovering decoys and SEWIP Block III electronic attack beams seduced ${decoyedCount} missile radar seekers off-target into the open water.`,
          { text: `${decoyedCount} Decoyed`, variant: 'jammed' }
        );
      }
    }

    // 2. Hard-Kill CIWS (RAM & Phalanx 20mm Gatling)
    let ciwsKills = 0;
    if (currentSalvo > 0) {
      const ciwsFacing = currentSalvo;
      const ciwsPotential = (flagSpec.typeId === 'carrier' ? 4 : 2) + escorts.length * 2;
      ciwsKills = Math.min(currentSalvo, Math.round(ciwsPotential * (missileSpeedMach > 2.0 ? 0.3 : 0.5)));
      currentSalvo = Math.max(0, currentSalvo - ciwsKills);
      totalIntercepted += ciwsKills;

      if (ciwsKills > 0) {
        addLog(
          'T+29m',
          `Tier 4: Phalanx CIWS & RAM Terminal Barrage`,
          `Phalanx 20mm rotary cannons and RIM-116 RAM launchers engaged terminal leakers at 2 km. Shredded ${ciwsKills} missiles.`,
          { text: `${ciwsKills} Shredded`, variant: 'success' }
        );
      }
    }

    tierReports.push({
      tierNumber: 4,
      tierName: 'Terminal CIWS & Soft-Kill EW',
      weaponName: 'Nulka Decoys / SEWIP / Phalanx 20mm',
      rangeKm: 12,
      missilesFacing: tier4Facing,
      missilesIntercepted: ciwsKills,
      missilesDecoyed: decoyedCount,
      missilesLeaking: currentSalvo,
      defendersActive: [flagLabel],
      roundsExpended: 1500, // 20mm rounds + RAM
      details: `Nulka decoys seduced ${decoyedCount} missiles; Phalanx CIWS shredded ${ciwsKills} leakers.`,
    });
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

  const headline =
    flagshipDamage === 'intact'
      ? `CARRIER STRIKE GROUP SHIELD HELD — 0 Missile Impacts`
      : flagshipDamage === 'superstructure_damaged'
        ? `CSG AIR DEFENSE PENETRATED — Minor Damage on ${flagLabel}`
        : flagshipDamage === 'mission_kill'
          ? `CRITICAL FLEET MISSION KILL — ${flagLabel} Disabled by Saturation`
          : `FLEET FLAGSHIP SUNK — Massive Anti-Ship Missile Saturation`;

  const verdict =
    flagshipDamage === 'intact'
      ? `Layered Aegis fleet defenses (SM-6, ESSM, Nulka EW decoys, and CIWS) successfully neutralized all ${salvoSize} incoming missiles.`
      : `${totalImpacts} out of ${salvoSize} anti-ship missiles penetrated the 4-tier fleet air defense screen, inflicting ${flagshipDamage.replace('_', ' ').toUpperCase()} on ${flagLabel}.`;

  return {
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
    hasAewCoverage,
    hasCecEnabled,
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
