/**
 * Two-Sided Theater Campaign & Retaliatory Strike Exchange Engine.
 *
 * Models dynamic Red vs Blue strategic exchanges across multiple conflict turns:
 * - Turn 1: Primary Strike (Attacker launches coordinated strike package).
 * - Turn 2: Retaliatory Counter-Strike (Defender retaliates with surviving missile TELs, warships, or bombers).
 * - Multi-Turn State & Magazine Persistence across sides.
 * - Automated Counter-Battery Target Acquisition (AI doctrine auto-targeting attacker airbases/ships).
 * - Relative Balance of Power & Strategic Escalation Index.
 */

import { distanceKm } from './geo';
import {
  assessTheaterRaid,
  discoverAttackerAssets,
  discoverDefensiveUmbrella,
  specOf,
  type StrikePhaseTask,
  type TheaterAssessment,
  type UnitPersistentState,
} from './theaterEngagement';
import { unitLabel, type DeployedUnit } from './warGames';
import type { BoardContext } from './theaterEngagement';
import { type SystemSpec } from './specs';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface BalanceOfPower {
  blueScore: number;
  redScore: number;
  blueRatio: number;
  redRatio: number;
  blueActivePlatforms: number;
  redActivePlatforms: number;
  escalationLevel: 'limited' | 'intense' | 'saturation' | 'strategic';
}

export interface CampaignTurn {
  turnNumber: number;
  initiatorIso: string;
  defenderIso: string;
  turnType: 'offensive' | 'retaliatory';
  title: string;
  targetUnitId: string;
  targetLabel: string;
  phases: StrikePhaseTask[];
  assessment: TheaterAssessment | null;
  balanceBefore: BalanceOfPower;
  balanceAfter: BalanceOfPower;
}

export interface CampaignState {
  id: string;
  nationA: string; // e.g. Blue
  nationB: string; // e.g. Red
  activeTurnNumber: number;
  turns: CampaignTurn[];
  unitPersistentStates: Map<string, UnitPersistentState>;
  overallStatus: 'turn_in_progress' | 'blue_dominant' | 'red_dominant' | 'stalemate';
  overallSummary: string;
}

/* ------------------------------------------------------------------ */
/* Balance of Power Calculation                                       */
/* ------------------------------------------------------------------ */

export function calculateBalanceOfPower(
  nationA: string,
  nationB: string,
  allUnits: DeployedUnit[],
  unitStates: Map<string, UnitPersistentState>,
  ctx: BoardContext
): BalanceOfPower {
  let blueScore = 0;
  let redScore = 0;
  let blueCount = 0;
  let redCount = 0;

  for (const u of allUnits) {
    if (u.iso !== nationA && u.iso !== nationB) continue;

    const state = unitStates.get(u.id);
    if (state && (state.status === 'destroyed' || state.aliveCount <= 0)) continue;

    const spec = specOf(u, ctx);
    const count = state ? state.aliveCount : (u.kind === 'unit' ? u.count : 1);

    // Platform combat weighting
    let baseWeight = 10;
    if (spec?.typeId === 'bomber' || spec?.typeId === 'strike') baseWeight = 25;
    else if (spec?.typeId === 'destroyer' || spec?.typeId === 'cruiser') baseWeight = 40;
    else if (spec?.typeId === 'silo' || spec?.typeId === 'missile') baseWeight = 30;
    else if (spec?.typeId === 'airbase' || spec?.typeId === 'headquarters') baseWeight = 50;
    else if (spec?.typeId === 'sam' || spec?.typeId === 'radar') baseWeight = 20;

    const unitScore = baseWeight * count;

    if (u.iso === nationA) {
      blueScore += unitScore;
      blueCount += count;
    } else {
      redScore += unitScore;
      redCount += count;
    }
  }

  const total = Math.max(1, blueScore + redScore);
  const blueRatio = blueScore / total;
  const redRatio = redScore / total;

  let escalationLevel: BalanceOfPower['escalationLevel'] = 'limited';
  if (total > 200) escalationLevel = 'intense';
  if (total > 450) escalationLevel = 'saturation';

  return {
    blueScore,
    redScore,
    blueRatio,
    redRatio,
    blueActivePlatforms: blueCount,
    redActivePlatforms: redCount,
    escalationLevel,
  };
}

/* ------------------------------------------------------------------ */
/* Automated Retaliation Strategy Generator                           */
/* ------------------------------------------------------------------ */

/**
 * Automatically formulates an optimal Counter-Battery / Retaliatory Strike Plan
 * for the defending nation against the attacker's launch origin nodes.
 */
export function generateAutoRetaliation(
  defenderIso: string,
  attackerIso: string,
  lastTurnAssessment: TheaterAssessment | null,
  allUnits: DeployedUnit[],
  unitStates: Map<string, UnitPersistentState>,
  ctx: BoardContext
): { targetUnit: DeployedUnit | null; phases: StrikePhaseTask[] } {
  // 1. Identify priority retaliation targets (Attacker's Airbase, Carrier, Destroyer, or Missile Silo)
  const attackerUnits = allUnits.filter((u) => u.iso === attackerIso);
  let targetUnit: DeployedUnit | null = null;

  // Prefer high-value forward operating bases or strike ships
  const highValueTarget = attackerUnits.find((u) => {
    const spec = specOf(u, ctx);
    return spec?.typeId === 'airbase' || spec?.typeId === 'destroyer' || spec?.typeId === 'cruiser' || spec?.typeId === 'silo';
  });

  targetUnit = highValueTarget ?? attackerUnits[0] ?? null;
  if (!targetUnit) return { targetUnit: null, phases: [] };

  // 2. Discover defending nation's surviving strike assets with ready magazines
  const umbrella = discoverDefensiveUmbrella(targetUnit, allUnits, ctx);
  const candidateRetaliators = discoverAttackerAssets(defenderIso, targetUnit, umbrella, allUnits, ctx);

  const usableRetaliators = candidateRetaliators.filter((c) => {
    const state = unitStates.get(c.unit.id);
    if (state && (state.status === 'destroyed' || state.aliveCount <= 0)) return false;
    return c.availableWeapons.some((w) => {
      const mag = state ? (state.magazines.get(w.index) ?? w.maxMagazine) : w.maxMagazine;
      return mag > 0;
    });
  });

  if (usableRetaliators.length === 0) {
    return { targetUnit, phases: [] };
  }

  const phases: StrikePhaseTask[] = [];

  // Phase 1: Ballistic / Standoff Counter-Battery Salvo
  const primaryPlatform = usableRetaliators[0];
  const weapon = primaryPlatform.availableWeapons[0];
  const state = unitStates.get(primaryPlatform.unit.id);
  const curMag = state ? (state.magazines.get(weapon?.index ?? 0) ?? weapon?.maxMagazine ?? 12) : (weapon?.maxMagazine ?? 12);
  const salvo = Math.min(curMag, Math.max(2, Math.floor(curMag * 0.75)));

  if (weapon && salvo > 0) {
    phases.push({
      id: `retaliate-p1-${Date.now()}`,
      phaseNumber: 1,
      title: 'Retaliatory Counter-Battery Missile Strike',
      category: 'strike',
      attackerUnitId: primaryPlatform.unit.id,
      targetUnitId: targetUnit.id,
      weaponIndex: weapon.index,
      salvoSize: salvo,
      altitudeM: 3000,
    });
  }

  // Phase 2: Follow-up Air/Drone Standoff Wave if second asset is available
  if (usableRetaliators.length > 1) {
    const secondaryPlatform = usableRetaliators[1];
    const secWeapon = secondaryPlatform.availableWeapons[0];
    const secState = unitStates.get(secondaryPlatform.unit.id);
    const secMag = secState ? (secState.magazines.get(secWeapon?.index ?? 0) ?? secWeapon?.maxMagazine ?? 8) : (secWeapon?.maxMagazine ?? 8);
    const secSalvo = Math.min(secMag, Math.max(1, Math.floor(secMag * 0.5)));

    if (secWeapon && secSalvo > 0) {
      phases.push({
        id: `retaliate-p2-${Date.now()}`,
        phaseNumber: 2,
        title: 'Secondary Follow-up Saturation Wave',
        category: 'strike',
        attackerUnitId: secondaryPlatform.unit.id,
        targetUnitId: targetUnit.id,
        weaponIndex: secWeapon.index,
        salvoSize: secSalvo,
        altitudeM: 3000,
      });
    }
  }

  return { targetUnit, phases };
}
