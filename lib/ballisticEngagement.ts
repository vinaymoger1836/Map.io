/**
 * Multi-Tier Ballistic Missile Defense (BMD) & Hypersonic Glide Vehicle (HGV) Simulation Engine
 *
 * Models high-fidelity space/aerothermal trajectory physics and multi-layered missile defense:
 *
 * 1. Ballistic & Hypersonic Threat Aerothermal Classes:
 *    - SRBM (Short-Range, Iskander-M / ATACMS / Fateh-110, Apogee 50–100 km, Mach 6–7)
 *    - MRBM (Medium-Range, DF-21D / Sejjil / Shaheen-II, Apogee 250–450 km, Mach 10–12)
 *    - IRBM / ICBM (Intermediate/Intercontinental, DF-26 / Agni-V / Minuteman, Apogee 800–1400 km, Mach 20–24)
 *    - HGV (Hypersonic Boost-Glide Vehicle, DF-17 / Avangard / Zircon, Pull-Up Glide at 35–65 km, Mach 8–15)
 *    - HCM (Hypersonic Cruise Missile, Kinzhal / 3M22 Zircon / Scramjet, Sustained Mach 5–9)
 *
 * 2. Multi-Tier Concentric BMD Interceptor Network:
 *    - Tier 1: Exo-Atmospheric Midcourse Space Defense (> 100 km altitude, SM-3 Block IIA / Arrow-3 / S-500 77N6)
 *              Kinetic Exo-Atmospheric Kill Vehicle (EKV) space collision. Immune to low-altitude HGVs.
 *    - Tier 2: High-Altitude Endo-Atmospheric Defense (20–100 km altitude, THAAD / Aster 30NT / David's Sling / S-500)
 *              High-g divert thrusters intercepting re-entering warheads and hypersonic glide vehicles.
 *    - Tier 3: Low-Altitude Terminal Point Defense (< 25 km altitude, Patriot PAC-3 MSE / S-400 9M96 / Arrow-2)
 *              Direct Ka-band active radar seeker hit-to-kill against supersonic/hypersonic terminal dives.
 *
 * 3. Space-Based Infrared (SBIRS) & Early Warning X-Band Radar Networking (AN/TPY-2 / SPY-6 / Green Pine).
 */

import { distanceKm, interpolate } from './geo';
import { specOf, type BoardContext, type UnitPersistentState } from './theaterEngagement';
import { unitLabel, type DeployedUnit } from './warGames';
import type { SystemSpec, TargetClass, WeaponFacet } from './specs';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export type BallisticThreatKind = 'srbm' | 'mrbm' | 'irbm' | 'icbm' | 'hgv' | 'hcm';

export interface BallisticTrajectoryProfile {
  kind: BallisticThreatKind;
  kindLabel: string;
  distanceKm: number;
  apogeeAltitudeKm: number;
  burnoutMach: number;
  reentryMach: number;
  flightDurationSec: number;
  isExoAtmospheric: boolean;
  hasHypersonicSkipping: boolean;
  hasPlasmaSheathBlackout: boolean;
  trajectoryPoints: Array<{ fraction: number; altitudeKm: number; phase: 'boost' | 'midcourse' | 'glide' | 'terminal' }>;
}

export interface BmdDefenseTierReport {
  tierNumber: 1 | 2 | 3;
  tierName: string;
  altitudeZone: string;
  weaponName: string;
  interceptorsLaunched: number;
  missilesFacing: number;
  missilesIntercepted: number;
  missilesLeaking: number;
  defendersActive: string[];
  engagementMethod: 'kinetic_ekv_hit_to_kill' | 'endo_divert_attitude' | 'terminal_acm_hit_to_kill';
  details: string;
}

export interface BallisticDefenseAssessment {
  kind: 'bmd';
  targetUnit: DeployedUnit;
  targetLabel: string;
  attackerUnit: DeployedUnit;
  attackerLabel: string;
  weaponName: string;
  salvoSize: number;

  trajectory: BallisticTrajectoryProfile;

  hasBmdEarlyWarningRadar: boolean; // AN/TPY-2 / Green Pine / SPY-6
  hasSatelliteInfraredCueing: boolean; // SBIRS / DSP satellite detection

  tierReports: BmdDefenseTierReport[];
  totalIntercepted: number;
  totalImpacts: number;

  targetDamageStatus: 'intact' | 'superficial_damage' | 'cratered_suppressed' | 'obliterated';
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
/* Trajectory Calculation & Threat Classification                     */
/* ------------------------------------------------------------------ */

export function classifyBallisticThreat(weaponName: string, rangeKm: number): BallisticThreatKind {
  const name = weaponName.toLowerCase();
  if (name.includes('hgv') || name.includes('df-17') || name.includes('avangard') || name.includes('glide')) {
    return 'hgv';
  }
  if (name.includes('kinzhal') || name.includes('zircon') || name.includes('3m22') || name.includes('scramjet') || name.includes('hcm')) {
    return 'hcm';
  }
  if (rangeKm >= 5000 || name.includes('icbm') || name.includes('minuteman') || name.includes('rs-28') || name.includes('sarmat') || name.includes('topol')) {
    return 'icbm';
  }
  if (rangeKm >= 3000 || name.includes('df-26') || name.includes('agni-v') || name.includes('irbm')) {
    return 'irbm';
  }
  if (rangeKm >= 1000 || name.includes('df-21') || name.includes('sejjil') || name.includes('shaheen') || name.includes('mrbm')) {
    return 'mrbm';
  }
  return 'srbm';
}

export function computeBallisticTrajectory(
  kind: BallisticThreatKind,
  distanceKm: number
): BallisticTrajectoryProfile {
  let apogeeAltitudeKm = 80;
  let burnoutMach = 6.5;
  let reentryMach = 5.5;
  let flightDurationSec = 240;
  let hasHypersonicSkipping = false;
  let isExoAtmospheric = false;
  let kindLabel = 'Short-Range Ballistic Missile (SRBM)';

  switch (kind) {
    case 'srbm':
      apogeeAltitudeKm = Math.min(120, Math.max(45, distanceKm * 0.18));
      burnoutMach = 6.2;
      reentryMach = 5.0;
      flightDurationSec = Math.round(Math.sqrt(distanceKm) * 12 + 60);
      isExoAtmospheric = apogeeAltitudeKm > 100;
      kindLabel = 'Short-Range Ballistic Missile (SRBM)';
      break;

    case 'mrbm':
      apogeeAltitudeKm = Math.min(450, Math.max(150, distanceKm * 0.22));
      burnoutMach = 11.5;
      reentryMach = 9.8;
      flightDurationSec = Math.round(Math.sqrt(distanceKm) * 16 + 120);
      isExoAtmospheric = true;
      kindLabel = 'Medium-Range Ballistic Missile (MRBM)';
      break;

    case 'irbm':
      apogeeAltitudeKm = Math.min(900, Math.max(350, distanceKm * 0.24));
      burnoutMach = 17.0;
      reentryMach = 14.5;
      flightDurationSec = Math.round(Math.sqrt(distanceKm) * 18 + 180);
      isExoAtmospheric = true;
      kindLabel = 'Intermediate-Range Ballistic Missile (IRBM)';
      break;

    case 'icbm':
      apogeeAltitudeKm = Math.min(1300, Math.max(600, distanceKm * 0.26));
      burnoutMach = 24.0;
      reentryMach = 20.0;
      flightDurationSec = Math.round(Math.sqrt(distanceKm) * 20 + 240);
      isExoAtmospheric = true;
      kindLabel = 'Intercontinental Ballistic Missile (ICBM)';
      break;

    case 'hgv':
      apogeeAltitudeKm = 55; // Boost-glide atmospheric pull-up equilibrium
      burnoutMach = 14.0;
      reentryMach = 8.5;
      flightDurationSec = Math.round(distanceKm / 3.2);
      isExoAtmospheric = false;
      hasHypersonicSkipping = true;
      kindLabel = 'Hypersonic Boost-Glide Vehicle (HGV)';
      break;

    case 'hcm':
      apogeeAltitudeKm = 28; // Stratospheric scramjet cruise corridor
      burnoutMach = 8.0;
      reentryMach = 7.2;
      flightDurationSec = Math.round(distanceKm / 2.6);
      isExoAtmospheric = false;
      hasHypersonicSkipping = true;
      kindLabel = 'Hypersonic Cruise Missile (HCM)';
      break;
  }

  // Generate 20-point trajectory cross-section
  const trajectoryPoints: BallisticTrajectoryProfile['trajectoryPoints'] = [];
  const steps = 20;

  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    let altitudeKm = 0;
    let phase: BallisticTrajectoryProfile['trajectoryPoints'][0]['phase'] = 'midcourse';

    if (hasHypersonicSkipping) {
      if (fraction < 0.15) {
        // Boost phase to 60 km
        altitudeKm = (fraction / 0.15) * 60;
        phase = 'boost';
      } else if (fraction > 0.85) {
        // Terminal dive
        altitudeKm = 40 * ((1 - fraction) / 0.15);
        phase = 'terminal';
      } else {
        // Atmosphere wave-skipping oscillation between 38 km and 55 km
        const wave = Math.sin((fraction - 0.15) * 12);
        altitudeKm = 45 + wave * 8;
        phase = 'glide';
      }
    } else {
      // Parabolic ballistic Keplerian arc
      if (fraction < 0.15) phase = 'boost';
      else if (fraction > 0.85) phase = 'terminal';
      else phase = 'midcourse';

      altitudeKm = apogeeAltitudeKm * Math.sin(fraction * Math.PI);
    }

    trajectoryPoints.push({
      fraction,
      altitudeKm: Math.max(0, Math.round(altitudeKm * 10) / 10),
      phase,
    });
  }

  return {
    kind,
    kindLabel,
    distanceKm,
    apogeeAltitudeKm,
    burnoutMach,
    reentryMach,
    flightDurationSec,
    isExoAtmospheric,
    hasHypersonicSkipping,
    hasPlasmaSheathBlackout: burnoutMach >= 8,
    trajectoryPoints,
  };
}

/* ------------------------------------------------------------------ */
/* Multi-Tier BMD Engagement Simulation Engine                         */
/* ------------------------------------------------------------------ */

export function assessBallisticMissileDefense(
  attacker: DeployedUnit,
  target: DeployedUnit,
  weaponIndex: number,
  salvoSize: number,
  allUnits: DeployedUnit[],
  ctx: BoardContext
): BallisticDefenseAssessment | null {
  const attSpec = specOf(attacker, ctx);
  const tgtSpec = specOf(target, ctx);
  if (!attSpec || !tgtSpec) return null;

  const attLabel = unitLabel(attacker, ctx.formations, ctx.systems);
  const tgtLabel = unitLabel(target, ctx.formations, ctx.systems);
  const dist = distanceKm(attacker.lngLat, target.lngLat);

  const weapon = attSpec.weapons?.[weaponIndex] ?? {
    name: 'Ballistic Missile',
    rangeKm: Math.max(300, dist * 1.2),
    salvo: 2,
    magazine: 6,
  };

  const weaponName = weapon.name ?? 'Ballistic Missile';
  const threatKind = classifyBallisticThreat(weaponName, weapon.rangeKm ?? dist);
  const trajectory = computeBallisticTrajectory(threatKind, dist);

  // Discover defensive BMD umbrella around the target
  const sameNationUnits = allUnits.filter((u) => u.iso === target.iso);

  // 1. Check BMD Early Warning Radars (AN/TPY-2, Green Pine, SPY-6)
  const bmdRadar = sameNationUnits.find((u) => {
    const s = specOf(u, ctx);
    const n = (s?.name ?? '').toLowerCase();
    return (
      n.includes('tpy-2') ||
      n.includes('green pine') ||
      n.includes('spy-6') ||
      n.includes('spy-1') ||
      n.includes('voronezh') ||
      n.includes('don-2n') ||
      s?.typeId === 'radar'
    );
  });
  const hasBmdEarlyWarningRadar = Boolean(bmdRadar);
  const hasSatelliteInfraredCueing = true; // Global early warning satellite coverage

  const battleLog: BallisticDefenseAssessment['battleLog'] = [];
  let logId = 0;
  const addLog = (timeFormatted: string, title: string, detail: string, badge?: { text: string; variant: string }) => {
    battleLog.push({ id: `bmd-evt-${++logId}`, timeFormatted, title, detail, badge });
  };

  addLog(
    'T+00m',
    `Ballistic Launch Detected`,
    `Space-based infrared satellites (SBIRS) detected rocket plume. ${attLabel} launched ${salvoSize} × ${weaponName} (${trajectory.kindLabel}) at ${tgtLabel}.`,
    { text: `${salvoSize} Inbound (${trajectory.kind.toUpperCase()})`, variant: 'standoff' }
  );

  addLog(
    'T+02m',
    `Trajectory Calculated — Apogee ${trajectory.apogeeAltitudeKm} km`,
    `Early warning radar locked boost-phase track. Burnout speed Mach ${trajectory.burnoutMach.toFixed(1)}, peak apogee altitude ${trajectory.apogeeAltitudeKm} km (${trajectory.isExoAtmospheric ? 'Exo-Atmospheric Space Flight' : 'Endo-Atmospheric Glide'}).`,
    { text: `Mach ${trajectory.burnoutMach.toFixed(1)} / ${trajectory.apogeeAltitudeKm}km`, variant: 'neutral' }
  );

  let currentSalvo = salvoSize;
  const tierReports: BmdDefenseTierReport[] = [];
  let totalIntercepted = 0;

  // -----------------------------------------------------------------
  // TIER 1: Exo-Atmospheric Midcourse Defense (> 100 km Altitude)
  // (SM-3 Block IIA / Arrow-3 / S-500 77N6-N)
  // -----------------------------------------------------------------
  const exoDefenders = sameNationUnits.filter((u) => {
    const s = specOf(u, ctx);
    const n = (s?.name ?? '').toLowerCase();
    const engages = (s?.weapons ?? []).flatMap((w) => w.engages ?? []);
    return (
      (n.includes('sm-3') || n.includes('arrow-3') || n.includes('s-500') || engages.includes('ballistic-imrbm') || engages.includes('ballistic-medium')) &&
      distanceKm(u.lngLat, target.lngLat) <= 600
    );
  });

  if (trajectory.isExoAtmospheric && !trajectory.hasHypersonicSkipping && currentSalvo > 0 && exoDefenders.length > 0) {
    const exoLead = exoDefenders[0];
    const exoLeadLabel = unitLabel(exoLead, ctx.formations, ctx.systems);
    const exoFacing = currentSalvo;
    const exoChannels = exoDefenders.length * 4;
    const exoRounds = Math.min(exoFacing * 2, exoChannels);
    // Kinetic hit-to-kill in space vacuum
    const exoKills = Math.min(currentSalvo, Math.round(exoRounds * (hasBmdEarlyWarningRadar ? 0.65 : 0.45)));

    if (exoKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - exoKills);
      totalIntercepted += exoKills;

      const exoSpec = specOf(exoLead, ctx);
      const exoWpName = exoSpec?.weapons?.[0]?.name ?? 'Exo-Atmospheric Interceptor';

      addLog(
        'T+06m',
        `Tier 1: Exo-Atmospheric Kinetic Kill in Space`,
        `${exoLeadLabel} fired ${exoRounds} × ${exoWpName}. Obliterated ${exoKills} ballistic warheads in space at ${Math.round(trajectory.apogeeAltitudeKm * 0.85)} km altitude via direct kinetic collision.`,
        { text: `${exoKills} Hit-to-Kill in Space`, variant: 'success' }
      );
    }

    const exoLeadSpec = specOf(exoDefenders[0], ctx);
    const exoWpName = exoLeadSpec?.weapons?.[0]?.name ?? 'Exo-Atmospheric Interceptor';

    tierReports.push({
      tierNumber: 1,
      tierName: 'Exo-Atmospheric Midcourse Defense',
      altitudeZone: '> 100 km (Space Vacuum)',
      weaponName: exoWpName,
      interceptorsLaunched: exoRounds,
      missilesFacing: exoFacing,
      missilesIntercepted: exoKills,
      missilesLeaking: currentSalvo,
      defendersActive: exoDefenders.map((d) => unitLabel(d, ctx.formations, ctx.systems)),
      engagementMethod: 'kinetic_ekv_hit_to_kill',
      details: `${exoDefenders.map((d) => unitLabel(d, ctx.formations, ctx.systems)).join(', ')} intercepted ${exoKills} warheads during midcourse coast using ${exoWpName}.`,
    });
  } else if (trajectory.hasHypersonicSkipping && exoDefenders.length > 0) {
    addLog(
      'T+05m',
      `Tier 1: Exo-Atmospheric Defense Bypassed by HGV Glide`,
      `${weaponName} performed atmospheric pull-up at 55 km altitude, flying beneath the engagement floor of exo-atmospheric SM-3 / Arrow-3 kill vehicles.`,
      { text: 'HGV Layer Bypassed', variant: 'jammed' }
    );
  }

  // -----------------------------------------------------------------
  // TIER 2: High-Altitude Endo-Atmospheric Defense (20 km – 100 km)
  // (THAAD / Aster 30 Block 1NT / David's Sling / S-500)
  // -----------------------------------------------------------------
  const endoDefenders = sameNationUnits.filter((u) => {
    const s = specOf(u, ctx);
    const n = (s?.name ?? '').toLowerCase();
    const engages = (s?.weapons ?? []).flatMap((w) => w.engages ?? []);
    return (
      (n.includes('thaad') || n.includes('aster 30') || n.includes('david') || n.includes('s-500') || engages.includes('ballistic-medium') || engages.includes('ballistic-short')) &&
      distanceKm(u.lngLat, target.lngLat) <= 200
    );
  });

  if (currentSalvo > 0 && endoDefenders.length > 0) {
    const endoLead = endoDefenders[0];
    const endoLeadLabel = unitLabel(endoLead, ctx.formations, ctx.systems);
    const endoFacing = currentSalvo;
    const endoChannels = endoDefenders.length * 4;
    const endoRounds = Math.min(endoFacing * 2, endoChannels);

    // High-altitude divert attitude control motors
    const endoPk = trajectory.hasHypersonicSkipping ? 0.38 : hasBmdEarlyWarningRadar ? 0.58 : 0.45;
    const endoKills = Math.min(currentSalvo, Math.round(endoRounds * endoPk));

    const endoLeadSpec = specOf(endoLead, ctx);
    const endoWpName = endoLeadSpec?.weapons?.[0]?.name ?? 'High-Altitude Endo Interceptor';

    if (endoKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - endoKills);
      totalIntercepted += endoKills;

      addLog(
        'T+09m',
        `Tier 2: High-Altitude Endo Interception`,
        `${endoLeadLabel} ripple-fired ${endoRounds} × ${endoWpName} into the upper stratosphere (40 km altitude). Splashed ${endoKills} hypersonic warheads.`,
        { text: `${endoKills} Splashed (Stratosphere)`, variant: 'success' }
      );
    }

    tierReports.push({
      tierNumber: 2,
      tierName: 'High-Altitude Endo-Atmospheric Defense',
      altitudeZone: '20 km – 100 km (Upper Stratosphere)',
      weaponName: endoWpName,
      interceptorsLaunched: endoRounds,
      missilesFacing: endoFacing,
      missilesIntercepted: endoKills,
      missilesLeaking: currentSalvo,
      defendersActive: endoDefenders.map((d) => unitLabel(d, ctx.formations, ctx.systems)),
      engagementMethod: 'endo_divert_attitude',
      details: `${endoDefenders.map((d) => unitLabel(d, ctx.formations, ctx.systems)).join(', ')} engaged re-entering warheads using ${endoWpName}.`,
    });
  }

  // -----------------------------------------------------------------
  // TIER 3: Low-Altitude Terminal Hit-to-Kill Defense (< 25 km Altitude)
  // (Patriot PAC-3 MSE / S-400 9M96 / Arrow-2 / HQ-9B)
  // -----------------------------------------------------------------
  const terminalDefenders = sameNationUnits.filter((u) => {
    const s = specOf(u, ctx);
    const n = (s?.name ?? '').toLowerCase();
    const engages = (s?.weapons ?? []).flatMap((w) => w.engages ?? []);
    return (
      (n.includes('patriot') || n.includes('pac-3') || n.includes('s-400') || n.includes('arrow-2') || n.includes('hq-9') || engages.includes('ballistic-short') || engages.includes('air')) &&
      distanceKm(u.lngLat, target.lngLat) <= 45
    );
  });

  if (currentSalvo > 0 && terminalDefenders.length > 0) {
    const termLead = terminalDefenders[0];
    const termLeadSpec = specOf(termLead, ctx);
    const termWpName = termLeadSpec?.weapons?.[0]?.name ?? 'Terminal Hit-to-Kill Interceptor';
    const termLeadLabel = unitLabel(termLead, ctx.formations, ctx.systems);
    const termFacing = currentSalvo;
    const termChannels = terminalDefenders.length * 6;
    const termRounds = Math.min(termFacing * 2, termChannels);

    // Terminal Ka-band active radar seeker + Attitude Control Motors (ACM)
    const termPk = trajectory.reentryMach > 10 ? 0.35 : 0.52;
    const termKills = Math.min(currentSalvo, Math.round(termRounds * termPk));

    if (termKills > 0) {
      currentSalvo = Math.max(0, currentSalvo - termKills);
      totalIntercepted += termKills;

      addLog(
        'T+11m',
        `Tier 3: Terminal Point Defense Hit-to-Kill`,
        `${termLeadLabel} fired ${termRounds} × ${termWpName} with pulse attitude motors. Directly shredded ${termKills} incoming warheads at 12 km altitude.`,
        { text: `${termKills} Hit-to-Kill (Terminal)`, variant: 'success' }
      );
    }

    tierReports.push({
      tierNumber: 3,
      tierName: 'Terminal Point Defense',
      altitudeZone: '< 25 km (Troposphere Point Defense)',
      weaponName: termWpName,
      interceptorsLaunched: termRounds,
      missilesFacing: termFacing,
      missilesIntercepted: termKills,
      missilesLeaking: currentSalvo,
      defendersActive: terminalDefenders.map((d) => unitLabel(d, ctx.formations, ctx.systems)),
      engagementMethod: 'terminal_acm_hit_to_kill',
      details: `Direct body-to-body hit-to-kill kinetic collision using ${termWpName} destroyed ${termKills} warheads seconds before ground impact.`,
    });
  }

  // -----------------------------------------------------------------
  // Ground Impact & Facility Damage Resolution
  // -----------------------------------------------------------------
  const totalImpacts = currentSalvo;
  let targetDamageStatus: BallisticDefenseAssessment['targetDamageStatus'] = 'intact';

  if (totalImpacts === 0) {
    targetDamageStatus = 'intact';
    addLog(
      'T+12m',
      `Ballistic Missile Shield Held`,
      `All ${salvoSize} incoming ${weaponName} warheads were intercepted across the 3-tier BMD umbrella. ${tgtLabel} sustained 0 hits.`,
      { text: '0 Hits — BMD Shield Held', variant: 'success' }
    );
  } else if (totalImpacts === 1) {
    targetDamageStatus = 'superficial_damage';
    addLog(
      'T+12m',
      `Single Warhead Impact — Blast Overpressure Sustained`,
      `1 × hypersonic warhead penetrated terminal defense, detonating on target perimeter. Secondary structural damage on ${tgtLabel}.`,
      { text: '1 Warhead Impact', variant: 'loss' }
    );
  } else if (totalImpacts <= 3) {
    targetDamageStatus = 'cratered_suppressed';
    addLog(
      'T+12m',
      `Heavy Ground Impacts — Facility Cratered & Offline`,
      `${totalImpacts} × heavy warheads detonated on target coordinates, creating massive blast craters and disabling operational command on ${tgtLabel}.`,
      { text: `${totalImpacts} Heavy Impacts`, variant: 'loss' }
    );
  } else {
    targetDamageStatus = 'obliterated';
    addLog(
      'T+12m',
      `Catastrophic Saturation — Objective Completely Obliterated`,
      `${totalImpacts} direct ballistic warhead impacts totally destroyed ${tgtLabel} in massive hypersonic detonation wave.`,
      { text: `${totalImpacts} Impacts — Obliterated`, variant: 'loss' }
    );
  }

  const headline =
    targetDamageStatus === 'intact'
      ? `BMD SHIELD HELD — 0 of ${salvoSize} Ballistic Warheads Penetrated`
      : targetDamageStatus === 'superficial_damage'
        ? `BMD PERIMETER BREACHED — 1 Warhead Impact on ${tgtLabel}`
        : targetDamageStatus === 'cratered_suppressed'
          ? `HEAVY BALLISTIC DAMAGE — ${totalImpacts} Warheads Cratered ${tgtLabel}`
          : `OBJECTIVE OBLITERATED — Ballistic Saturation Overwhelmed BMD`;

  const verdict =
    targetDamageStatus === 'intact'
      ? `Layered missile defense (Space Midcourse EKV, Stratospheric THAAD, and PAC-3 MSE hit-to-kill) neutralized all ${salvoSize} incoming ${weaponName} warheads.`
      : `${totalImpacts} out of ${salvoSize} ${weaponName} warheads penetrated the BMD shield at Mach ${trajectory.reentryMach.toFixed(1)}, inflicting ${targetDamageStatus.replace('_', ' ').toUpperCase()} on ${tgtLabel}.`;

  return {
    kind: 'bmd',
    targetUnit: target,
    targetLabel: tgtLabel,
    attackerUnit: attacker,
    attackerLabel: attLabel,
    weaponName,
    salvoSize,
    trajectory,
    hasBmdEarlyWarningRadar,
    hasSatelliteInfraredCueing,
    tierReports,
    totalIntercepted,
    totalImpacts,
    targetDamageStatus,
    headline,
    verdict,
    battleLog,
  };
}
