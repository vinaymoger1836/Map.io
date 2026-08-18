/**
 * Comprehensive After-Action Report (AAR) Intelligence & Analysis Engine
 *
 * Consolidates combat outcomes across Single Raids, Multi-Phase Theater Operations,
 * Multi-Turn Escalation Campaigns, Naval Fleet Defenses, Subsurface ASW Hunts,
 * and Multi-Tier Ballistic Missile Defense (BMD) engagements.
 *
 * Generates:
 * 1. Executive Combat Summary & Loss Exchange Ratio
 * 2. Munitions & Ready Rounds Expenditure Matrix
 * 3. Platform & Target Casualty Registry
 * 4. Tactical Lessons Learned & Strategic Lessons
 * 5. Publication-Ready Markdown & Text Intelligence Briefings
 */

import { type Assessment } from './engagement';
import { type TheaterAssessment } from './theaterEngagement';
import { type NavalAssessment } from './navalEngagement';
import { type BallisticDefenseAssessment } from './ballisticEngagement';
import { unitLabel, type DeployedUnit, type Formation } from './warGames';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface MunitionExpenditureEntry {
  side: 'attacker' | 'defender';
  weaponName: string;
  category: 'cruise_missile' | 'ballistic' | 'hypersonic' | 'sam_interceptor' | 'torpedo' | 'ciws' | 'decoy' | 'bomb';
  fired: number;
  intercepted: number;
  decoyedOrJammed: number;
  impacted: number;
  effectivenessPercent: number;
}

export interface PlatformCasualtyEntry {
  side: 'attacker' | 'defender';
  unitLabel: string;
  typeLabel: string;
  domain: 'air' | 'naval' | 'subsurface' | 'ground' | 'radar';
  initialCount: number;
  lostCount: number;
  survivingCount: number;
  status: 'intact' | 'damaged' | 'suppressed' | 'destroyed' | 'sunk';
}

export interface TacticalLesson {
  category: 'air_defense' | 'saturation' | 'stealth_standoff' | 'naval_asw' | 'bmd_space' | 'magazine_depth';
  title: string;
  detail: string;
  impact: 'positive' | 'negative' | 'critical' | 'neutral';
}

export interface ComprehensiveAarReport {
  id: string;
  timestamp: string;
  title: string;
  battleType: 'single_raid' | 'theater_operation' | 'campaign_turn';

  // Combatants
  attackerNation: string;
  attackerIso: string;
  defenderNation: string;
  defenderIso: string;

  // Strategic Outcome
  outcomeVerdict: string;
  outcomeHeadline: string;
  missionSuccess: boolean;
  attritionExchangeRatio: string; // e.g. "1 : 4.2"

  // Itemized Data
  munitionMatrix: MunitionExpenditureEntry[];
  casualtyRegistry: PlatformCasualtyEntry[];
  tacticalLessons: TacticalLesson[];
  chronologicalLog: Array<{
    timeFormatted: string;
    title: string;
    detail: string;
    badgeText?: string;
  }>;

  // Raw Markdown Intelligence Briefing text
  markdownBriefing: string;
}

/* ------------------------------------------------------------------ */
/* AAR Report Generator Functions                                     */
/* ------------------------------------------------------------------ */

export function generateSingleRaidAar(
  assessment: Assessment,
  navalAss: NavalAssessment | null,
  bmdAss: BallisticDefenseAssessment | null,
  units: DeployedUnit[],
  nations: Record<string, { name: string }>
): ComprehensiveAarReport {
  const raid = assessment.raid;
  const attackerUnit = units.find((u) => u.id === raid.unitId);
  const attIso = attackerUnit?.iso ?? 'XX';
  const attNation = nations[attIso]?.name ?? attIso;

  // Derive defender from engagements or naval/bmd targets
  const targetUnit =
    (navalAss ? (navalAss.kind === 'asuw' ? navalAss.flagshipUnit : navalAss.targetUnit) : undefined) ??
    bmdAss?.targetUnit ??
    units.find((u) => u.iso !== attIso);
  const defIso = targetUnit?.iso ?? 'YY';
  const defNation = nations[defIso]?.name ?? defIso;
  const targetLabel = targetUnit ? unitLabel(targetUnit, [], []) : 'Objective Target';

  const outcome = assessment.battleOutcome;

  const munitionMatrix: MunitionExpenditureEntry[] = [];
  const casualtyRegistry: PlatformCasualtyEntry[] = [];
  const tacticalLessons: TacticalLesson[] = [];

  // Attacker Munitions
  const weaponName = raid.standoff?.weaponName ?? raid.spec.weapons?.[0]?.name ?? 'Standard Munition';
  const attFired = raid.standoff?.munitionCount ?? (raid.count * 4);
  let attIntercepted = 0;
  let attDecoyed = 0;
  let attImpacts = outcome.targetImpacts;

  for (const eng of assessment.engagements) {
    attIntercepted += eng.killed;
  }

  if (navalAss) {
    if (navalAss.kind === 'asuw') {
      attIntercepted = navalAss.totalIntercepted;
      attDecoyed = navalAss.totalDecoyed;
      attImpacts = navalAss.totalImpacts;
    } else {
      attIntercepted = navalAss.torpedoReport.torpedoesDecoyed;
      attDecoyed = navalAss.torpedoReport.thermalLayerEvasions;
      attImpacts = navalAss.torpedoReport.torpedoImpacts;
    }
  } else if (bmdAss) {
    attIntercepted = bmdAss.totalIntercepted;
    attImpacts = bmdAss.totalImpacts;
  }

  const attEff = attFired > 0 ? Math.round((attImpacts / attFired) * 100) : 0;
  munitionMatrix.push({
    side: 'attacker',
    weaponName,
    category: bmdAss ? 'ballistic' : raid.standoff?.enabled ? 'cruise_missile' : 'bomb',
    fired: attFired,
    intercepted: attIntercepted,
    decoyedOrJammed: attDecoyed,
    impacted: attImpacts,
    effectivenessPercent: attEff,
  });

  // Defender Interceptors
  for (const eng of assessment.engagements) {
    if (eng.rounds > 0) {
      munitionMatrix.push({
        side: 'defender',
        weaponName: `${eng.weaponName} (${eng.unitLabel})`,
        category: 'sam_interceptor',
        fired: eng.rounds,
        intercepted: eng.killed,
        decoyedOrJammed: 0,
        impacted: eng.killed,
        effectivenessPercent: eng.rounds > 0 ? Math.round((eng.killed / eng.rounds) * 100) : 0,
      });
    }
  }

  // Attacker Platform Casualties
  for (const loss of outcome.attackerLosses) {
    casualtyRegistry.push({
      side: 'attacker',
      unitLabel: loss.name,
      typeLabel: 'Strike Aircraft / Platform',
      domain: 'air',
      initialCount: loss.count,
      lostCount: loss.count,
      survivingCount: 0,
      status: 'destroyed',
    });
  }
  for (const surv of outcome.attackerSurvivors) {
    casualtyRegistry.push({
      side: 'attacker',
      unitLabel: surv.name,
      typeLabel: 'Strike Aircraft / Platform',
      domain: 'air',
      initialCount: surv.count,
      lostCount: 0,
      survivingCount: surv.count,
      status: 'intact',
    });
  }

  // Defender Target Casualties
  for (const def of outcome.defenderLosses) {
    casualtyRegistry.push({
      side: 'defender',
      unitLabel: def.name,
      typeLabel: 'Defensive Battery / Site',
      domain: 'ground',
      initialCount: def.count,
      lostCount: def.status === 'destroyed' ? def.count : 0,
      survivingCount: def.status === 'destroyed' ? 0 : def.count,
      status: def.status === 'destroyed' ? 'destroyed' : def.status === 'suppressed' ? 'suppressed' : def.status === 'damaged' ? 'damaged' : 'intact',
    });
  }

  // Tactical Lessons Generation
  if (attImpacts > 0 && attFired >= 8) {
    tacticalLessons.push({
      category: 'saturation',
      title: 'Air Defense Saturation Threshold Achieved',
      detail: `Attacking salvo of ${attFired} munitions exceeded defending simultaneous tracking channels, allowing ${attImpacts} leakers to penetrate.`,
      impact: 'positive',
    });
  }
  if (attIntercepted > 0) {
    tacticalLessons.push({
      category: 'air_defense',
      title: 'Layered Kinetic Defense Interceptions',
      detail: `Defending interceptor batteries splashed ${attIntercepted} incoming munitions before reaching terminal dive.`,
      impact: 'negative',
    });
  }
  if (navalAss?.kind === 'asw' && navalAss.sonarProfile.layerShadowAdvantage) {
    tacticalLessons.push({
      category: 'naval_asw',
      title: 'Acoustic Thermocline Layer Masking',
      detail: `Submarine running at ${navalAss.sonarProfile.targetSubmarineDepthM}m utilized thermal boundary refraction to degrade surface active sonar track confidence to ${navalAss.sonarProfile.acousticDetectionConfidencePct}%.`,
      impact: 'neutral',
    });
  }
  if (bmdAss && bmdAss.trajectory.hasHypersonicSkipping) {
    tacticalLessons.push({
      category: 'bmd_space',
      title: 'Hypersonic Atmospheric Wave-Skipping',
      detail: `HGV trajectory pull-up at ${bmdAss.trajectory.apogeeAltitudeKm} km successfully bypassed exo-atmospheric space kill vehicles.`,
      impact: 'positive',
    });
  }

  const chronologicalLog = assessment.battleLog.map((b) => ({
    timeFormatted: b.timeFormatted,
    title: b.title,
    detail: b.detail,
    badgeText: b.badge?.text,
  }));

  const isMissionSuccess = outcome.winner === 'attacker' || attImpacts > 0;
  const ratio = attImpacts > 0 ? `1 : ${Math.max(1, Math.round(attImpacts * 2.5))}` : '0 : 1';

  const report: ComprehensiveAarReport = {
    id: `aar-${Date.now()}`,
    timestamp: new Date().toUTCString(),
    title: `After-Action Report: Strike on ${targetLabel}`,
    battleType: 'single_raid',
    attackerNation: attNation,
    attackerIso: attIso,
    defenderNation: defNation,
    defenderIso: defIso,
    outcomeVerdict: outcome.verdictTitle,
    outcomeHeadline: outcome.verdictDescription,
    missionSuccess: isMissionSuccess,
    attritionExchangeRatio: ratio,
    munitionMatrix,
    casualtyRegistry,
    tacticalLessons,
    chronologicalLog,
    markdownBriefing: '',
  };

  report.markdownBriefing = renderAarMarkdown(report);
  return report;
}

export function generateTheaterAar(
  theaterAss: TheaterAssessment,
  units: DeployedUnit[],
  nations: Record<string, { name: string }>
): ComprehensiveAarReport {
  const attIso = theaterAss.attackerIso;
  const defIso = units.find((u) => u.id === theaterAss.mainTargetId)?.iso ?? 'XX';
  const attNation = nations[attIso]?.name ?? attIso;
  const defNation = nations[defIso]?.name ?? defIso;

  const munitionMatrix: MunitionExpenditureEntry[] = [];
  const casualtyRegistry: PlatformCasualtyEntry[] = [];
  const tacticalLessons: TacticalLesson[] = [];
  const chronologicalLog: ComprehensiveAarReport['chronologicalLog'] = [];

  let totalFired = 0;
  let totalIntercepted = 0;
  let totalImpacts = 0;

  // 1. Populate Platform Casualty Registry from persistent unit states
  if (theaterAss.unitFinalStates && theaterAss.unitFinalStates.size > 0) {
    for (const [uId, uState] of theaterAss.unitFinalStates.entries()) {
      const u = units.find((unit) => unit.id === uId);
      if (!u) continue;
      const side: 'attacker' | 'defender' = u.iso === theaterAss.attackerIso ? 'attacker' : 'defender';
      const label = unitLabel(u, [], []);
      const typeId = (u.kind === 'unit' ? u.typeId : 'formation').toLowerCase();

      let domain: PlatformCasualtyEntry['domain'] = 'ground';
      if (
        typeId.includes('ship') ||
        typeId === 'destroyer' ||
        typeId === 'frigate' ||
        typeId === 'carrier' ||
        typeId === 'corvette' ||
        typeId === 'cruiser'
      ) {
        domain = 'naval';
      } else if (typeId === 'submarine' || typeId === 'ssbn' || typeId === 'midget-sub') {
        domain = 'subsurface';
      } else if (
        typeId === 'fighter' ||
        typeId === 'strike' ||
        typeId === 'bomber' ||
        typeId === 'drone' ||
        typeId === 'ew' ||
        typeId === 'mpa' ||
        typeId === 'helicopter'
      ) {
        domain = 'air';
      } else if (typeId === 'radar') {
        domain = 'radar';
      }

      const lost = uState.destroyedCount || (uState.status === 'destroyed' ? uState.initialCount : 0);
      const surv = uState.aliveCount;
      let finalStatus: PlatformCasualtyEntry['status'] = uState.status;
      if (domain === 'naval' && (uState.status === 'destroyed' || uState.aliveCount === 0)) {
        finalStatus = 'sunk';
      }

      casualtyRegistry.push({
        side,
        unitLabel: label,
        typeLabel: u.kind === 'unit' ? u.typeId.toUpperCase() : 'Unit Formation',
        domain,
        initialCount: uState.initialCount,
        lostCount: lost,
        survivingCount: surv,
        status: finalStatus,
      });
    }
  }

  // 2. Munitions Matrix and Merged Phase Timeline
  const phaseNumbers = Array.from(new Set(theaterAss.phases.map((p) => p.phaseNumber))).sort((a, b) => a - b);

  for (const pNum of phaseNumbers) {
    const tasksInPhase = theaterAss.phases.filter((p) => p.phaseNumber === pNum);
    let phaseFired = 0;
    let phaseIntercepted = 0;
    let phaseImpacts = 0;
    const attackerDetails: string[] = [];
    const targetNames = Array.from(new Set(tasksInPhase.map((t) => t.targetLabel)));
    const defenderInterceptors: string[] = [];

    for (const phase of tasksInPhase) {
      phaseFired += phase.salvoCommitted;
      phaseIntercepted += phase.munitionsIntercepted;
      phaseImpacts += phase.munitionsImpacted;

      totalFired += phase.salvoCommitted;
      totalIntercepted += phase.munitionsIntercepted;
      totalImpacts += phase.munitionsImpacted;

      attackerDetails.push(`${phase.attackerLabel} (${phase.salvoCommitted} × ${phase.weaponName})`);

      munitionMatrix.push({
        side: 'attacker',
        weaponName: `${phase.weaponName} (Phase ${phase.phaseNumber})`,
        category:
          phase.task.category === 'bmd'
            ? 'ballistic'
            : phase.task.category === 'asw'
              ? 'torpedo'
              : 'cruise_missile',
        fired: phase.salvoCommitted,
        intercepted: phase.munitionsIntercepted,
        decoyedOrJammed: 0,
        impacted: phase.munitionsImpacted,
        effectivenessPercent:
          phase.salvoCommitted > 0 ? Math.round((phase.munitionsImpacted / phase.salvoCommitted) * 100) : 0,
      });

      // Collect defender interceptor munitions
      if (phase.interceptions && phase.interceptions.length > 0) {
        for (const ic of phase.interceptions) {
          defenderInterceptors.push(`${ic.defenderLabel} (${ic.roundsFired} rounds, ${ic.kills} kills)`);
        }
      }
    }

    // Consolidated T+00m Launch Event
    chronologicalLog.push({
      timeFormatted: 'T+00m',
      title: `[Phase ${pNum}] Coordinated Time-on-Target Salvo Launch`,
      detail:
        tasksInPhase.length === 1
          ? `${attackerDetails[0]} launched at ${targetNames.join(', ')}.`
          : `Simultaneous Coordinated Strike: ${attackerDetails.join(' + ')} launched at ${targetNames.join(', ')} (Total: ${phaseFired} committed).`,
      badgeText: `${phaseFired} Committed`,
    });

    // Consolidated T+18m Interception Event
    if (phaseIntercepted > 0) {
      const defDetail =
        defenderInterceptors.length > 0
          ? defenderInterceptors.join('; ')
          : `Defending air defense umbrella intercepted ${phaseIntercepted} incoming missiles.`;
      chronologicalLog.push({
        timeFormatted: 'T+18m',
        title: `[Phase ${pNum}] Layered Defensive Interceptions`,
        detail: `${defDetail} (${phaseFired - phaseIntercepted} leakers penetrated).`,
        badgeText: `${phaseIntercepted} Intercepted`,
      });
    } else {
      chronologicalLog.push({
        timeFormatted: 'T+18m',
        title: `[Phase ${pNum}] Defensive Interception Window`,
        detail: `No defending interceptors engaged. Entire salvo of ${phaseFired} missiles penetrated directly toward target complex.`,
        badgeText: '0 Intercepted',
      });
    }

    // Consolidated T+30m Impact / Damage Event
    const damageSummaries = tasksInPhase.map((t) => `${t.targetLabel}: ${t.targetDamageSummary}`);
    const isPhaseSuccess = tasksInPhase.some((t) => t.targetDestroyed || t.targetSuppressed);
    chronologicalLog.push({
      timeFormatted: 'T+30m',
      title: `[Phase ${pNum}] Phase Outcome Resolution`,
      detail: damageSummaries.join(' | '),
      badgeText: isPhaseSuccess ? 'Objective Struck' : 'Shield Held',
    });
  }

  // Tactical Lessons
  if (theaterAss.phases.some((p) => p.task.category === 'sead' && p.targetDestroyed)) {
    tacticalLessons.push({
      category: 'air_defense',
      title: 'SEAD Anti-Radiation Roll-Back Successful',
      detail: 'Preliminary SEAD waves destroyed defending radar emitters, blinding the defensive umbrella for subsequent main strike waves.',
      impact: 'positive',
    });
  }
  if (theaterAss.phases.some((p) => p.task.category === 'oca' && p.targetDestroyed)) {
    tacticalLessons.push({
      category: 'saturation',
      title: 'Combat Air Patrol (CAP) Sweep Established',
      detail: 'Offensive Counter-Air fighter sweeps eliminated defending interceptor flights before strike bombers entered weapons release envelopes.',
      impact: 'positive',
    });
  }
  if (theaterAss.phases.some((p) => (p.navalAssessment && p.navalAssessment.kind === 'asuw' && p.navalAssessment.flagshipDamage === 'sunk'))) {
    tacticalLessons.push({
      category: 'naval_asw',
      title: 'Naval Surface Strike Saturation Breach',
      detail: 'Coordinated multi-vector anti-ship missile saturation penetrated all 4 fleet defense tiers, resulting in catastrophic hull loss.',
      impact: 'positive',
    });
  }

  const isMissionSuccess = theaterAss.primaryTargetStatus === 'destroyed';
  const ratio = totalImpacts > 0 ? `1 : ${Math.max(1, Math.round(totalImpacts * 3.2))}` : '0 : 1';

  const report: ComprehensiveAarReport = {
    id: `aar-theater-${Date.now()}`,
    timestamp: new Date().toUTCString(),
    title: `Theater Operation Debrief: Campaign vs ${theaterAss.mainTargetLabel}`,
    battleType: 'theater_operation',
    attackerNation: attNation,
    attackerIso: attIso,
    defenderNation: defNation,
    defenderIso: defIso,
    outcomeVerdict: theaterAss.overallHeadline,
    outcomeHeadline: theaterAss.overallVerdict,
    missionSuccess: isMissionSuccess,
    attritionExchangeRatio: ratio,
    munitionMatrix,
    casualtyRegistry,
    tacticalLessons,
    chronologicalLog,
    markdownBriefing: '',
  };

  report.markdownBriefing = renderAarMarkdown(report);
  return report;
}

/* ------------------------------------------------------------------ */
/* Markdown Intelligence Briefing Formatter                           */
/* ------------------------------------------------------------------ */

export function renderAarMarkdown(aar: ComprehensiveAarReport): string {
  const lines: string[] = [];

  lines.push(`# TOP SECRET // COMBAT AFTER-ACTION INTELLIGENCE REPORT`);
  lines.push(`**Report ID:** \`${aar.id}\` | **Date/Time:** ${aar.timestamp}`);
  lines.push(`**Operational Theater:** ${aar.attackerNation} (${aar.attackerIso}) vs ${aar.defenderNation} (${aar.defenderIso})`);
  lines.push(`**Engagement Type:** ${aar.battleType.replace('_', ' ').toUpperCase()}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 1. EXECUTIVE ASSESSMENT & STRATEGIC VERDICT`);
  lines.push(`### **${aar.outcomeVerdict}**`);
  lines.push(`> ${aar.outcomeHeadline}`);
  lines.push(``);
  lines.push(`* **Mission Outcome:** ${aar.missionSuccess ? '✅ OBJECTIVE ACCOMPLISHED' : '❌ MISSION REPULSED'}`);
  lines.push(`* **Estimated Loss-to-Damage Ratio:** \`${aar.attritionExchangeRatio}\``);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 2. MUNITIONS & ORDINANCE EXPENDITURE LEDGER`);
  lines.push(`| Side | Munition / Weapon System | Class | Fired | Intercepted | Decoyed / Jammed | Hits | Hit Rate |`);
  lines.push(`|:-----|:-------------------------|:------|------:|------------:|-----------------:|-----:|---------:|`);

  for (const m of aar.munitionMatrix) {
    lines.push(
      `| **${m.side.toUpperCase()}** | ${m.weaponName} | ${m.category.replace('_', ' ')} | ${m.fired} | ${m.intercepted} | ${m.decoyedOrJammed} | ${m.impacted} | **${m.effectivenessPercent}%** |`
    );
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 3. PLATFORM CASUALTY & DAMAGE REGISTRY`);
  lines.push(`| Side | Platform / Objective | Domain | Force Size | Losses | Surviving | Final Status |`);
  lines.push(`|:-----|:---------------------|:-------|-----------:|-------:|----------:|:-------------|`);

  for (const c of aar.casualtyRegistry) {
    lines.push(
      `| **${c.side.toUpperCase()}** | ${c.unitLabel} | ${c.domain} | ${c.initialCount} | ${c.lostCount} | ${c.survivingCount} | **${c.status.toUpperCase()}** |`
    );
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 4. TACTICAL LESSONS LEARNED & DOCTRINE INSIGHTS`);
  if (aar.tacticalLessons.length === 0) {
    lines.push(`*Standard operational tactical parameters observed. No exceptional doctrinal anomalies recorded.*`);
  } else {
    for (const l of aar.tacticalLessons) {
      lines.push(`* **${l.title}** (\`${l.category.toUpperCase()}\`): ${l.detail}`);
    }
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 5. CHRONOLOGICAL COMBAT TIMELINE (KILL CHAIN DEBRIEF)`);
  for (const evt of aar.chronologicalLog) {
    lines.push(`* **\`${evt.timeFormatted}\`** — **${evt.title}**: ${evt.detail} ${evt.badgeText ? `[\`${evt.badgeText}\`]` : ''}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*CLASSIFIED DEFENSE SIMULATION REPORT — Map.io Tactical Wargame Engine*`);

  return lines.join('\n');
}
