/**
 * Wargame Scenario Serialization & I/O Suite
 *
 * Provides complete JSON export/import and browser file downloads for:
 * 1. Full Battlefield State (Deployed units, custom loadouts, formations, waypoints)
 * 2. Theater Air Tasking Orders & Multi-Phase Operations
 * 3. Campaign Balance of Power & Turn History
 * 4. After-Action Reports (Markdown & JSON)
 */

import { type DeployedUnit, type Formation } from './warGames';
import { type StrikePhaseTask } from './theaterEngagement';
import { type CampaignTurn, type BalanceOfPower } from './campaign';
import { type ComprehensiveAarReport } from './aarReport';

export interface CompleteScenarioPackage {
  schemaVersion: '1.2.0';
  exportedAt: string;
  scenarioName: string;
  description: string;
  
  // Tactical State
  board: {
    units: DeployedUnit[];
    formations: Formation[];
    nations: Record<string, { name: string; side?: string }>;
  };

  // Waypoints & Route Overrides
  savedWaypoints?: [number, number][];

  // Theater Air Tasking Order Operations
  theaterOperations?: {
    targetUnitId: string | null;
    attackerIso: string | null;
    phases: StrikePhaseTask[];
  };

  // Campaign History
  campaign?: {
    turns: CampaignTurn[];
    balance: BalanceOfPower;
  };
}

/* ------------------------------------------------------------------ */
/* JSON Export & Download Helpers                                      */
/* ------------------------------------------------------------------ */

export function exportScenarioPackage(
  scenarioName: string,
  description: string,
  units: DeployedUnit[],
  formations: Formation[],
  nations: Record<string, { name: string; side?: string }>,
  waypoints?: [number, number][],
  theaterOps?: { targetUnitId: string | null; attackerIso: string | null; phases: StrikePhaseTask[] },
  campaign?: { turns: CampaignTurn[]; balance: BalanceOfPower }
): CompleteScenarioPackage {
  return {
    schemaVersion: '1.2.0',
    exportedAt: new Date().toISOString(),
    scenarioName: scenarioName || 'Custom Tactical Scenario',
    description: description || 'Exported from Map.io Eurasian Strategic Theater Wargame Engine',
    board: {
      units: JSON.parse(JSON.stringify(units)),
      formations: JSON.parse(JSON.stringify(formations)),
      nations: JSON.parse(JSON.stringify(nations)),
    },
    savedWaypoints: waypoints ? JSON.parse(JSON.stringify(waypoints)) : undefined,
    theaterOperations: theaterOps ? JSON.parse(JSON.stringify(theaterOps)) : undefined,
    campaign: campaign ? JSON.parse(JSON.stringify(campaign)) : undefined,
  };
}

export function downloadFile(filename: string, content: string, mimeType: string = 'application/json') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
}

export function parseAndValidateScenarioJson(jsonStr: string): CompleteScenarioPackage | null {
  try {
    const data = JSON.parse(jsonStr);
    if (!data || !data.board || !Array.isArray(data.board.units)) {
      return null;
    }
    return data as CompleteScenarioPackage;
  } catch (err) {
    console.error('Failed to parse scenario JSON:', err);
    return null;
  }
}
