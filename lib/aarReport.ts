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
import { type TheaterAssessment, specOf, type BoardContext } from './theaterEngagement';
import { type NavalAssessment } from './navalEngagement';
import { type BallisticDefenseAssessment } from './ballisticEngagement';
import { unitLabel, type DeployedUnit, type Formation } from './warGames';
import { maxMunitionCapacity, domainOf, type SystemSpec, type WeaponFacet } from './specs';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface WeaponSpecStatus {
  id?: string;
  name: string;
  rangeKm: number;
  pk?: number;
  engages?: string[];
  initialMagazine: number;
  expended: number;
  remainingMagazine: number;
  status: 'ready' | 'low' | 'depleted';
}

export interface UnitSpecLedgerEntry {
  unitId: string;
  unitLabel: string;
  side: 'attacker' | 'defender';
  nationName: string;
  iso: string;
  domain: 'air' | 'naval' | 'subsurface' | 'ground' | 'radar';
  typeId: string;
  speedKmh?: number;
  displacementT?: number;
  crew?: number;
  signature?: 'low' | 'medium' | 'high';
  sensor?: {
    detectionKm?: number;
    tracks?: number;
    engagements?: number; // Concurrent fire channels
    horizonLimited?: boolean;
  };
  weapons: WeaponSpecStatus[];
  finalStatus: 'intact' | 'damaged' | 'suppressed' | 'destroyed' | 'sunk';
}

export interface MunitionExpenditureEntry {
  side: 'attacker' | 'defender';
  weaponName: string;
  category:
    | 'cruise_missile'
    | 'ballistic'
    | 'hypersonic'
    | 'sam_interceptor'
    | 'torpedo'
    | 'ciws'
    | 'decoy'
    | 'bomb'
    | 'artillery_shell'
    | 'tank_round'
    | 'rocket_artillery';
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

export interface PersonnelCasualtyEntry {
  side: 'attacker' | 'defender';
  unitLabel: string;
  typeLabel: string;
  initialPersonnel: number;
  kia: number;
  wia: number;
  survivingPersonnel: number;
  status: 'operational' | 'combat_ineffective' | 'wiped_out';
}

export interface PersonnelCasualtySummary {
  attackerTotalDeployed: number;
  attackerKia: number;
  attackerWia: number;
  attackerSurviving: number;
  defenderTotalDeployed: number;
  defenderKia: number;
  defenderWia: number;
  defenderSurviving: number;
  entries: PersonnelCasualtyEntry[];
}

export interface TacticalLesson {
  category: 'air_defense' | 'saturation' | 'stealth_standoff' | 'naval_asw' | 'bmd_space' | 'magazine_depth';
  title: string;
  detail: string;
  impact: 'positive' | 'negative' | 'critical' | 'neutral';
}

export interface AarTimelineDetail {
  attackMunitions?: Array<{
    launcher: string;
    weaponName: string;
    count: number;
    target: string;
  }>;
  defenseLayers?: Array<{
    defender: string;
    interceptorWeapon: string;
    roundsFired: number;
    targetMissileName: string;
    interceptedCount: number;
    leakedCount: number;
    summary: string;
  }>;
  impacts?: Array<{
    target: string;
    missileName: string;
    hits: number;
    damageVerdict: string;
  }>;
}

export interface AarTimelineEntry {
  timeFormatted: string;
  phaseNumber?: number;
  title: string;
  detail: string;
  badgeText?: string;
  badgeVariant?: 'success' | 'loss' | 'neutral' | 'stealth' | 'standoff' | 'sead';
  breakdown?: AarTimelineDetail;
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
  personnelCasualties?: PersonnelCasualtySummary;
  tacticalLessons: TacticalLesson[];
  chronologicalLog: AarTimelineEntry[];
  unitSpecs: UnitSpecLedgerEntry[];

  // Raw Markdown Intelligence Briefing text
  markdownBriefing: string;
}

export function classifyMunitionCategory(
  weaponName: string,
  taskCategory: string
): MunitionExpenditureEntry['category'] {
  const w = weaponName.toLowerCase();
  if (taskCategory === 'asw' || w.includes('torpedo')) return 'torpedo';
  if (
    taskCategory === 'bmd' ||
    w.includes('ballistic') ||
    w.includes('iskander') ||
    w.includes('atacms') ||
    w.includes('df-')
  ) {
    return 'ballistic';
  }
  if (w.includes('hypersonic') || w.includes('kinzhal') || w.includes('zircon') || w.includes('hgv')) {
    return 'hypersonic';
  }
  if (
    w.includes('sam') ||
    w.includes('interceptor') ||
    w.includes('pac-3') ||
    w.includes('40n6') ||
    w.includes('48n6') ||
    w.includes('aster') ||
    w.includes('sn-7') ||
    w.includes('m75') ||
    w.includes('r-77') ||
    w.includes('aim-120') ||
    w.includes('iris-t')
  ) {
    return 'sam_interceptor';
  }
  if (
    w.includes('gun') ||
    w.includes('tank') ||
    w.includes('smoothbore') ||
    w.includes('120 mm') ||
    w.includes('125 mm') ||
    w.includes('105 mm') ||
    w.includes('cannon') ||
    w.includes('autocannon')
  ) {
    return 'tank_round';
  }
  if (
    w.includes('howitzer') ||
    w.includes('mortar') ||
    w.includes('155 mm') ||
    w.includes('152 mm') ||
    w.includes('122 mm') ||
    w.includes('artillery') ||
    w.includes('caesar') ||
    w.includes('paladin')
  ) {
    return 'artillery_shell';
  }
  if (
    w.includes('rocket') ||
    w.includes('smerch') ||
    w.includes('gmlrs') ||
    w.includes('grad') ||
    w.includes('uragan') ||
    w.includes('himars') ||
    w.includes('9m55') ||
    w.includes('9m528')
  ) {
    return 'rocket_artillery';
  }
  if (w.includes('bomb') || w.includes('jdam') || w.includes('paveway') || w.includes('gbu') || w.includes('glide bomb')) {
    return 'bomb';
  }
  if (w.includes('ciws') || w.includes('phalanx') || w.includes('goalkeeper') || w.includes('pantsir')) {
    return 'ciws';
  }
  if (w.includes('decoy') || w.includes('flare') || w.includes('chaff')) {
    return 'decoy';
  }
  return 'cruise_missile';
}

export function buildUnitSpecsLedger(
  units: DeployedUnit[],
  nations: Record<string, { name: string }>,
  unitStates: Map<string, any> | undefined,
  attackerIso: string,
  ctx?: BoardContext
): UnitSpecLedgerEntry[] {
  const ledger: UnitSpecLedgerEntry[] = [];
  const dummyCtx: BoardContext = ctx ?? { systems: [], munitions: new Map(), formations: [] };

  for (const u of units) {
    const spec = specOf(u, dummyCtx);
    if (!spec) continue;

    const side: 'attacker' | 'defender' = u.iso === attackerIso ? 'attacker' : 'defender';
    const nationName = nations[u.iso]?.name ?? u.iso;
    const uLabel = unitLabel(u, dummyCtx.formations, dummyCtx.systems);
    const uState = unitStates?.get(u.id);

    const typeId = (u.kind === 'unit' ? u.typeId : 'formation').toLowerCase();
    let domain: UnitSpecLedgerEntry['domain'] = 'ground';
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
      typeId === 'helicopter' ||
      typeId === 'awacs'
    ) {
      domain = 'air';
    } else if (typeId === 'radar') {
      domain = 'radar';
    }

    const finalStatus: UnitSpecLedgerEntry['finalStatus'] = uState?.status ?? 'intact';

    const weapons: WeaponSpecStatus[] = (spec.weapons ?? []).map((w: WeaponFacet, wIdx: number) => {
      const loadoutCount = u.kind === 'unit' ? u.loadout?.find((l) => l.id === w.id)?.count : undefined;
      const initialMagazine = maxMunitionCapacity(spec, w, u.kind === 'unit' ? u.count : 1, loadoutCount);
      const remainingMagazine =
        uState && uState.magazines && typeof uState.magazines.get === 'function'
          ? (uState.magazines.get(wIdx) ?? initialMagazine)
          : initialMagazine;
      const expended = Math.max(0, initialMagazine - remainingMagazine);
      const status: WeaponSpecStatus['status'] =
        remainingMagazine <= 0
          ? 'depleted'
          : remainingMagazine <= Math.max(1, Math.round(initialMagazine * 0.25))
            ? 'low'
            : 'ready';

      return {
        id: w.id,
        name: w.name ?? 'Munition',
        rangeKm: w.rangeKm ?? 0,
        pk: w.pk,
        engages: (w.engages ?? []) as string[],
        initialMagazine,
        expended,
        remainingMagazine,
        status,
      };
    });

    ledger.push({
      unitId: u.id,
      unitLabel: uLabel,
      side,
      nationName,
      iso: u.iso,
      domain,
      typeId: spec.typeId,
      speedKmh: spec.platform?.speedKmh,
      displacementT: spec.platform?.displacementT,
      crew: spec.platform?.crew,
      signature: spec.signature,
      sensor: spec.sensor
        ? {
            detectionKm: spec.sensor.detectionKm,
            tracks: spec.sensor.tracks,
            engagements: spec.sensor.engagements,
            horizonLimited: spec.sensor.horizonLimited,
          }
        : undefined,
      weapons,
      finalStatus,
    });
  }

  return ledger;
}

/* ------------------------------------------------------------------ */
/* AAR Report Generator Functions                                     */
/* ------------------------------------------------------------------ */

export function generateSingleRaidAar(
  assessment: Assessment,
  navalAss: NavalAssessment | null,
  bmdAss: BallisticDefenseAssessment | null,
  units: DeployedUnit[],
  nations: Record<string, { name: string }>,
  ctx?: BoardContext
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
    category: classifyMunitionCategory(weaponName, bmdAss ? 'bmd' : 'strike'),
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

  // Attacker Platform Casualties (Only losses / damaged assets)
  for (const loss of outcome.attackerLosses) {
    if (loss.count > 0) {
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
  }

  // Defender Target Casualties (Only suppressed, damaged, or destroyed assets)
  for (const def of outcome.defenderLosses) {
    if (def.status !== 'held' && def.count > 0) {
      casualtyRegistry.push({
        side: 'defender',
        unitLabel: def.name,
        typeLabel: 'Defensive Battery / Site',
        domain: 'ground',
        initialCount: def.count,
        lostCount: def.status === 'destroyed' ? def.count : 0,
        survivingCount: def.status === 'destroyed' ? 0 : def.count,
        status:
          def.status === 'destroyed'
            ? 'destroyed'
            : def.status === 'suppressed'
              ? 'suppressed'
              : def.status === 'damaged'
                ? 'damaged'
                : 'intact',
      });
    }
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

  const unitSpecs = buildUnitSpecsLedger(
    units.filter((u) => u.iso === attIso || u.iso === defIso),
    nations,
    undefined,
    attIso,
    ctx
  );

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
    unitSpecs,
    markdownBriefing: '',
  };

  report.markdownBriefing = renderAarMarkdown(report);
  return report;
}

export function generateTheaterAar(
  theaterAss: TheaterAssessment,
  units: DeployedUnit[],
  nations: Record<string, { name: string }>,
  ctx?: BoardContext
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
      const label = unitLabel(u, ctx?.formations ?? [], ctx?.systems ?? [], units);
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

      const isDestroyed = uState.status === 'destroyed' || (uState.aliveCount === 0 && (uState.initialCount ?? 0) > 0);
      const lost = isDestroyed ? uState.initialCount : Math.min(uState.initialCount, uState.destroyedCount || 0);
      const surv = isDestroyed ? 0 : Math.max(0, uState.initialCount - lost);
      let finalStatus: PlatformCasualtyEntry['status'] = isDestroyed ? 'destroyed' : uState.status;
      if (domain === 'naval' && isDestroyed) {
        finalStatus = 'sunk';
      }

      // Only record units that took damage, suppression, loss, or destruction (exclude intact platforms)
      if (lost > 0 || finalStatus !== 'intact') {
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
  }

  // Personnel Casualties Ledger
  const personnelEntries: PersonnelCasualtyEntry[] = [];
  let attTotPers = 0, attKiaPers = 0, attWiaPers = 0, attSurvPers = 0;
  let defTotPers = 0, defKiaPers = 0, defWiaPers = 0, defSurvPers = 0;

  if (theaterAss.unitFinalStates && theaterAss.unitFinalStates.size > 0) {
    for (const [uId, uState] of theaterAss.unitFinalStates.entries()) {
      const u = units.find((unit) => unit.id === uId);
      if (!u) continue;
      const side: 'attacker' | 'defender' = u.iso === theaterAss.attackerIso ? 'attacker' : 'defender';
      const label = unitLabel(u, ctx?.formations ?? [], ctx?.systems ?? [], units);

      const initPers = uState.initialPersonnel ?? 10;
      const kiaPers = uState.kiaPersonnel ?? 0;
      const wiaPers = uState.wiaPersonnel ?? 0;
      const survPers = Math.max(0, initPers - kiaPers - wiaPers);
      const persStatus: PersonnelCasualtyEntry['status'] =
        survPers === 0 ? 'wiped_out' : (kiaPers + wiaPers > initPers * 0.5 ? 'combat_ineffective' : 'operational');

      if (side === 'attacker') {
        attTotPers += initPers;
        attKiaPers += kiaPers;
        attWiaPers += wiaPers;
        attSurvPers += survPers;
      } else {
        defTotPers += initPers;
        defKiaPers += kiaPers;
        defWiaPers += wiaPers;
        defSurvPers += survPers;
      }

      if (kiaPers > 0 || wiaPers > 0 || uState.status !== 'intact') {
        personnelEntries.push({
          side,
          unitLabel: label,
          typeLabel: u.kind === 'unit' ? u.typeId.toUpperCase() : 'Unit Formation',
          initialPersonnel: initPers,
          kia: kiaPers,
          wia: wiaPers,
          survivingPersonnel: survPers,
          status: persStatus,
        });
      }
    }
  }

  const personnelSummary: PersonnelCasualtySummary = {
    attackerTotalDeployed: attTotPers,
    attackerKia: attKiaPers,
    attackerWia: attWiaPers,
    attackerSurviving: attSurvPers,
    defenderTotalDeployed: defTotPers,
    defenderKia: defKiaPers,
    defenderWia: defWiaPers,
    defenderSurviving: defSurvPers,
    entries: personnelEntries,
  };

  // 2. Munitions Matrix and Merged Phase Timeline
  const phaseNumbers = Array.from(new Set(theaterAss.phases.map((p) => p.phaseNumber))).sort((a, b) => a - b);

  for (const pNum of phaseNumbers) {
    const tasksInPhase = theaterAss.phases.filter((p) => p.phaseNumber === pNum);
    let phaseFired = 0;
    let phaseIntercepted = 0;
    let phaseImpacts = 0;
    const attackerDetails: string[] = [];
    const targetNames = Array.from(new Set(tasksInPhase.map((t) => t.targetLabel)));
    const attackMunitionsBreakdown: NonNullable<AarTimelineDetail['attackMunitions']> = [];
    const defenseLayersBreakdown: NonNullable<AarTimelineDetail['defenseLayers']> = [];

    for (const phase of tasksInPhase) {
      phaseFired += phase.salvoCommitted;
      phaseIntercepted += phase.munitionsIntercepted;
      phaseImpacts += phase.munitionsImpacted;

      totalFired += phase.salvoCommitted;
      totalIntercepted += phase.munitionsIntercepted;
      totalImpacts += phase.munitionsImpacted;

      attackerDetails.push(`${phase.attackerLabel} (${phase.salvoCommitted} × ${phase.weaponName})`);

      attackMunitionsBreakdown.push({
        launcher: phase.attackerLabel,
        weaponName: phase.weaponName,
      const taskAttackerUnit = units.find((u) => u.id === phase.task.attackerUnitId);
      const taskSide: 'attacker' | 'defender' = taskAttackerUnit?.iso === attIso ? 'attacker' : 'defender';

      munitionMatrix.push({
        side: taskSide,
        weaponName: `${phase.weaponName} (Phase ${phase.phaseNumber})`,
        category: classifyMunitionCategory(phase.weaponName, phase.task.category),
        fired: phase.salvoCommitted,
        intercepted: phase.munitionsIntercepted,
        decoyedOrJammed: 0,
        impacted: phase.munitionsImpacted,
        effectivenessPercent:
          phase.salvoCommitted > 0 ? Math.round((phase.munitionsImpacted / phase.salvoCommitted) * 100) : 0,
      });

      // Collect structured defender interceptor tiers
      if (phase.navalAssessment && phase.navalAssessment.kind === 'asuw') {
        for (const tier of phase.navalAssessment.tierReports) {
          const intercepted = tier.missilesIntercepted;
          const rounds = tier.roundsExpended;
          const missileName = phase.weaponName;
          const defenderName = tier.defendersActive.join(', ') || phase.targetLabel;
          const leaked = Math.max(0, tier.missilesFacing - intercepted - tier.missilesDecoyed);
          const layerSummary =
            intercepted > 0
              ? `${intercepted} × ${missileName} intercepted by ${defenderName} (${tier.weaponName})` +
                (leaked > 0 ? ` (${leaked} leakers bypassed to next tier)` : ` (Layer held)`)
              : `0 × ${missileName} intercepted (${tier.missilesFacing} passed through ${tier.tierName})`;

          defenseLayersBreakdown.push({
            defender: defenderName,
            interceptorWeapon: tier.tierName,
            roundsFired: rounds,
            targetMissileName: missileName,
            interceptedCount: intercepted,
            leakedCount: leaked,
            summary: layerSummary,
          });
        }
      } else if (phase.interceptions && phase.interceptions.length > 0) {
        let currentFacing = phase.salvoCommitted;
        for (const ic of phase.interceptions) {
          const leaked = Math.max(0, currentFacing - ic.kills);
          const layerSummary =
            ic.kills > 0
              ? `${ic.kills} × ${phase.weaponName} intercepted by ${ic.defenderLabel}` +
                (leaked > 0 ? ` (${leaked} leakers penetrated)` : ` (All intercepted)`)
              : `Failed to intercept incoming munitions`;

          defenseLayersBreakdown.push({
            defender: ic.defenderLabel,
            interceptorWeapon: ic.defenderLabel,
            roundsFired: ic.roundsFired,
            targetMissileName: phase.weaponName,
            interceptedCount: ic.kills,
            leakedCount: leaked,
            summary: layerSummary,
          });
          currentFacing = leaked;
        }
      }
    }

    const phaseOffsetMin = (pNum - 1) * 35;
    const launchTimeFormatted = `T+${String(0 + phaseOffsetMin).padStart(2, '0')}m`;
    const interceptTimeFormatted = `T+${String(18 + phaseOffsetMin).padStart(2, '0')}m`;
    const impactTimeFormatted = `T+${String(30 + phaseOffsetMin).padStart(2, '0')}m`;

    // Consolidated Launch Event
    chronologicalLog.push({
      timeFormatted: launchTimeFormatted,
      phaseNumber: pNum,
      title: `[Phase ${pNum}] Coordinated Time-on-Target Salvo Launch`,
      detail:
        tasksInPhase.length === 1
          ? `${attackerDetails[0]} launched at ${targetNames.join(', ')}.`
          : `Simultaneous Coordinated Strike: ${attackerDetails.join(' + ')} launched at ${targetNames.join(', ')} (Total: ${phaseFired} committed).`,
      badgeText: `${phaseFired} Inbound`,
      badgeVariant: 'standoff',
      breakdown: {
        attackMunitions: attackMunitionsBreakdown,
      },
    });

    // Consolidated Interception Event
    if (phaseIntercepted > 0) {
      chronologicalLog.push({
        timeFormatted: interceptTimeFormatted,
        phaseNumber: pNum,
        title: `[Phase ${pNum}] Layered Defensive Interceptions`,
        detail: `Defending fire control engaged incoming strike salvos: ${phaseIntercepted} intercepted across active defense tiers (${phaseFired - phaseIntercepted} penetrated).`,
        badgeText: `${phaseIntercepted} Intercepted`,
        badgeVariant: phaseFired - phaseIntercepted === 0 ? 'success' : 'neutral',
        breakdown: {
          defenseLayers: defenseLayersBreakdown,
        },
      });
    } else {
      chronologicalLog.push({
        timeFormatted: interceptTimeFormatted,
        phaseNumber: pNum,
        title: `[Phase ${pNum}] Defensive Interception Window`,
        detail: `No defending interceptors engaged. Entire salvo of ${phaseFired} munitions penetrated directly toward target complex.`,
        badgeText: '0 Intercepted',
        badgeVariant: 'loss',
        breakdown: {
          defenseLayers: defenseLayersBreakdown,
        },
      });
    }

    // Consolidated Impact / Damage Event (Deduplicated per target)
    const damageSummaries = Array.from(
      new Set(tasksInPhase.map((t) => `${t.targetLabel}: ${t.targetDamageSummary}`))
    );
    const isPhaseSuccess = tasksInPhase.some((t) => t.targetDestroyed || t.targetSuppressed);
    chronologicalLog.push({
      timeFormatted: impactTimeFormatted,
      phaseNumber: pNum,
      title: `[Phase ${pNum}] Phase Outcome & Strike Resolution`,
      detail: damageSummaries.join(' | '),
      badgeText: isPhaseSuccess ? `${phaseImpacts} Hits Struck` : 'Shield Held',
      badgeVariant: isPhaseSuccess ? 'success' : 'loss',
      breakdown: {
        impacts: tasksInPhase.map((t) => ({
          target: t.targetLabel,
          missileName: t.weaponName,
          hits: t.munitionsImpacted,
          damageVerdict: t.targetDamageSummary,
        })),
          target: t.targetLabel,
          missileName: t.weaponName,
          hits: t.munitionsImpacted,
          damageVerdict: t.targetDamageSummary,
        })),
      },
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

  const isMissionSuccess =
    theaterAss.overallHeadline.includes('VICTORY') ||
    theaterAss.primaryTargetStatus === 'destroyed' ||
    casualtyRegistry.some((c) => c.side === 'defender' && (c.status === 'sunk' || c.status === 'destroyed'));

  const ratio = totalImpacts > 0 ? `1 : ${Math.max(1, Math.round(totalImpacts * 3.2))}` : '0 : 1';

  // Filter unitSpecs strictly to active participating combatants
  const participatingUnitIds = new Set<string>();
  for (const p of theaterAss.phases) {
    if (p.task.attackerUnitId) participatingUnitIds.add(p.task.attackerUnitId);
    if (p.task.targetUnitId) participatingUnitIds.add(p.task.targetUnitId);
    if (p.interceptions) {
      for (const ic of p.interceptions) {
        if (ic.defenderUnitId) participatingUnitIds.add(ic.defenderUnitId);
      }
    }
    if (p.navalAssessment) {
      if (p.navalAssessment.kind === 'asuw') {
        if (p.navalAssessment.flagshipUnit?.id) participatingUnitIds.add(p.navalAssessment.flagshipUnit.id);
        if (p.navalAssessment.attackerUnit?.id) participatingUnitIds.add(p.navalAssessment.attackerUnit.id);
        for (const esc of p.navalAssessment.escortUnits ?? []) {
          participatingUnitIds.add(esc.id);
        }
      } else {
        if (p.navalAssessment.hunterUnit?.id) participatingUnitIds.add(p.navalAssessment.hunterUnit.id);
        if (p.navalAssessment.targetUnit?.id) participatingUnitIds.add(p.navalAssessment.targetUnit.id);
      }
    }
  }

  const activeParticipatingUnits =
    participatingUnitIds.size > 0
      ? units.filter((u) => participatingUnitIds.has(u.id))
      : units.filter((u) => u.iso === attIso || u.iso === defIso);

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
    personnelCasualties: personnelSummary,
    tacticalLessons,
    chronologicalLog,
    unitSpecs: buildUnitSpecsLedger(
      activeParticipatingUnits,
      nations,
      theaterAss.unitFinalStates,
      attIso,
      ctx
    ),
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
  lines.push(`## 3. PLATFORM & PERSONNEL CASUALTY REGISTRY`);
  lines.push(`### Platform & Heavy Equipment Losses`);
  if (aar.casualtyRegistry.length === 0) {
    lines.push(`*Zero platform casualties or structural damage recorded. All participating units survived intact with 0 losses.*`);
  } else {
    lines.push(`| Side | Platform / Objective | Domain | Force Size | Losses | Surviving | Final Status |`);
    lines.push(`|:-----|:---------------------|:-------|-----------:|-------:|----------:|:-------------|`);

    for (const c of aar.casualtyRegistry) {
      lines.push(
        `| **${c.side.toUpperCase()}** | ${c.unitLabel} | ${c.domain} | ${c.initialCount} | ${c.lostCount} | ${c.survivingCount} | **${c.status.toUpperCase()}** |`
      );
    }
  }

  if (aar.personnelCasualties && aar.personnelCasualties.entries.length > 0) {
    lines.push(``);
    lines.push(`### Military Personnel Casualties (Troops KIA / WIA)`);
    lines.push(`| Side | Unit / Formation | Troop Type | Deployed Troops | KIA (Killed) | WIA (Wounded) | Operational Survivors | Status |`);
    lines.push(`|:-----|:-----------------|:-----------|----------------:|-------------:|--------------:|----------------------:|:-------|`);
    for (const p of aar.personnelCasualties.entries) {
      lines.push(
        `| **${p.side.toUpperCase()}** | ${p.unitLabel} | ${p.typeLabel} | ${p.initialPersonnel} | ${p.kia} | ${p.wia} | ${p.survivingPersonnel} | \`${p.status.toUpperCase()}\` |`
      );
    }
    lines.push(``);
    lines.push(`* **Total Attacker Casualties:** \`${aar.personnelCasualties.attackerTotalDeployed} Deployed | ${aar.personnelCasualties.attackerKia} KIA | ${aar.personnelCasualties.attackerWia} WIA | ${aar.personnelCasualties.attackerSurviving} Operational\``);
    lines.push(`* **Total Defender Casualties:** \`${aar.personnelCasualties.defenderTotalDeployed} Deployed | ${aar.personnelCasualties.defenderKia} KIA | ${aar.personnelCasualties.defenderWia} WIA | ${aar.personnelCasualties.defenderSurviving} Operational\``);
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
    if (evt.breakdown?.attackMunitions && evt.breakdown.attackMunitions.length > 0) {
      for (const m of evt.breakdown.attackMunitions) {
        lines.push(`  * 🚀 **${m.launcher}** launched ${m.count} × ${m.weaponName} at *${m.target}*`);
      }
    }
    if (evt.breakdown?.defenseLayers && evt.breakdown.defenseLayers.length > 0) {
      for (const d of evt.breakdown.defenseLayers) {
        lines.push(`  * 🛡️ **${d.defender}** (\`${d.interceptorWeapon}\`): ${d.summary}`);
      }
    }
    if (evt.breakdown?.impacts && evt.breakdown.impacts.length > 0) {
      for (const imp of evt.breakdown.impacts) {
        lines.push(`  * 💥 **${imp.target}**: ${imp.hits} impacts from ${imp.missileName} — *${imp.damageVerdict}*`);
      }
    }
  }

  // 6. Unit Specifications & Armament Ledger
  if (aar.unitSpecs && aar.unitSpecs.length > 0) {
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 6. COMBATANT PLATFORM SPECIFICATIONS & ARMAMENT LEDGER`);

    for (const u of aar.unitSpecs) {
      lines.push(``);
      lines.push(`### **${u.unitLabel}** (\`${u.side.toUpperCase()}\` — ${u.nationName}, Status: **${u.finalStatus.toUpperCase()}**)`);
      const sensorDetails = u.sensor
        ? `${u.sensor.detectionKm ?? 0} km radar reach | ${u.sensor.engagements ?? 1} concurrent fire channels`
        : 'Passive / Visual detection';
      lines.push(`* **Sensors & Radar Profile:** ${sensorDetails}`);
      if (u.speedKmh || u.signature) {
        lines.push(`* **Platform Attributes:** Speed: ${u.speedKmh ?? '—'} km/h | Radar Signature: ${(u.signature ?? 'medium').toUpperCase()}${u.displacementT ? ` | Displacement: ${u.displacementT} t` : ''}${u.crew ? ` | Crew: ${u.crew}` : ''}`);
      }

      if (u.weapons.length > 0) {
        lines.push(`* **Armament & Magazine Ledger:**`);
        lines.push(`| Weapon System | Target Envelope | Max Range | Single-Shot Pk | Initial Mag | Expended | Remaining | Status |`);
        lines.push(`|:---|:---|:---:|:---:|:---:|:---:|:---:|:---|`);
        for (const w of u.weapons) {
          const engagesStr = w.engages && w.engages.length > 0 ? w.engages.join(', ') : 'multipurpose';
          const pkStr = w.pk !== undefined ? w.pk.toFixed(2) : '—';
          lines.push(`| **${w.name}** | ${engagesStr} | ${w.rangeKm} km | ${pkStr} | ${w.initialMagazine} | ${w.expended} | **${w.remainingMagazine}** | \`${w.status.toUpperCase()}\` |`);
        }
      } else {
        lines.push(`*No active strike or defensive armaments listed.*`);
      }
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*CLASSIFIED DEFENSE SIMULATION REPORT — Map.io Tactical Wargame Engine*`);

  return lines.join('\n');
}
