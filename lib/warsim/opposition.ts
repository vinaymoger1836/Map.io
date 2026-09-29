import type { WarSimSession } from '../warSimTypes';
import type { SimulationCommand } from './contracts';
import { hq } from './intelligence';
import { length, sub, toENU } from './physics/coordinates';
import { operational } from './physics/readiness';

export type OpponentDoctrine = 'cautious' | 'balanced' | 'aggressive';
export type OpponentDifficulty = 'cadet' | 'standard' | 'veteran';
export interface OpponentDecision {
  id: number; tick: number; priority: string; utility: number; reason: string;
  command?: SimulationCommand; result: 'accepted' | 'rejected' | 'wait'; rejection?: string;
}
export interface OppositionState {
  version: 1; enabled: boolean; doctrine: OpponentDoctrine; difficulty: OpponentDifficulty;
  nextDecisionTick: number; sequence: number; decisions: OpponentDecision[];
}
export interface ScenarioObjectives {
  version: 1; deadlineTick: number; status: 'ongoing' | 'red-victory' | 'blue-victory'; concludedTick?: number;
  blueBrief: string; redBrief: string; trainingPrompts: string[];
}
export interface OpponentChoice { priority: string; utility: number; reason: string; command?: SimulationCommand }

export function createOpposition(): OppositionState {
  return { version: 1, enabled: true, doctrine: 'balanced', difficulty: 'standard', nextDecisionTick: 0, sequence: 0, decisions: [] };
}
export function createObjectives(): ScenarioObjectives {
  return { version: 1, deadlineTick: 900, status: 'ongoing',
    blueBrief: 'Protect FS Resolute until T+90 or disable the opposing frigate.',
    redBrief: 'Disable FS Resolute before T+90 using reports that reach red headquarters.',
    trainingPrompts: ['Use local sensor views to find observations before they reach HQ.',
      'A coordinated strike needs a fresh report from its supporting sensor and two free reservations.',
      'A broken support link holds or aborts a mission according to its declared fallback.'] };
}
export const decisionInterval = (difficulty: OpponentDifficulty) => difficulty === 'cadet' ? 20 : difficulty === 'veteran' ? 5 : 10;
const requiredConfidence = (difficulty: OpponentDifficulty) => difficulty === 'cadet' ? .8 : difficulty === 'veteran' ? .5 : .6;

/** This function accepts only an observer projection. It has no reference to world truth. */
export function decideOpponent(view: WarSimSession): OpponentChoice {
  const p = view.physical, intel = view.intelView, opponent = p?.opposition;
  if (!p || !intel || !opponent || view.activeFaction !== 'enemy' || view.observerScope !== hq(view.enemyIso))
    throw new Error('Opponent decisions require the red HQ observer snapshot.');
  if (p.objectives?.status !== 'ongoing') return { priority: 'objective', utility: 0, reason: 'Scenario objective has concluded.' };
  const shooter = p.actors.find(a => a.iso === view.enemyIso && a.rounds > 0 && operational(a, 'strikeLauncher'));
  const support = p.actors.find(a => a.iso === view.enemyIso && a.id !== shooter?.id && operational(a, 'sensor')
    && intel.sensors.some(s => s.actorId === a.id && s.mode === 'active' && s.sensorTime > 0)
    && intel.links.some(l => l.from === `${a.id}:local` && l.active));
  const contacts = view.fogOfWarContacts.enemyContacts.filter(c => c.trackState !== 'lost' && !['sub', 'space'].includes(c.domain))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.contactId.localeCompare(b.contactId));
  const contact = contacts.find(c => !shooter || length(sub(toENU([...c.lastKnownLngLat, 0], p.origin), shooter.position)) <= 9000);
  const confidence = contact?.confidence ?? 0, age = contact?.decayTimerSec ?? Infinity;
  const threshold = requiredConfidence(opponent.difficulty);
  const activeTask = support && intel.tasks.some(t => t.assetId === support.id
    && !['complete', 'interrupted', 'cancelled'].includes(t.status));
  if ((!contact || confidence < threshold || age > 1.5) && support && !activeTask) {
    const estimated = contact ? toENU([...contact.lastKnownLngLat, 0], p.origin) : [...support.position] as [number, number, number];
    const center: [number, number, number] = support.domain === 'subsurface'
      ? [estimated[0], estimated[1], support.position[2]] : estimated;
    if (length(sub(center, support.position)) <= (intel.sensors.find(s => s.actorId === support.id)?.rangeM ?? 0))
      return { priority: 'collection', utility: 80 + (1 - confidence) * 20,
        reason: contact ? `HQ contact ${contact.contactId} is ${age.toFixed(1)} s old at ${(confidence * 100).toFixed(0)}% confidence; request ${support.id} collection.`
          : `HQ has no target contact; search near ${support.id}.`,
        command: { type: 'requestPhysicalCollection', args: [support.id, center, 500] } };
  }
  const missionBusy = shooter && intel.missions.some(m => m.shooterId === shooter.id && !['executed', 'aborted'].includes(m.status));
  const reservedRounds = shooter ? intel.reservations.filter(r => r.assetId === shooter.id && r.resource === 'strike-round').length : 0;
  const minimumRounds = opponent.doctrine === 'cautious' ? 2 : 0;
  if (shooter && contact && !missionBusy && shooter.rounds - reservedRounds > minimumRounds && shooter.cooldown <= view.simTimeSec) {
    const track = intel.tracks.find(t => t.id === contact.contactId);
    if (support && track && confidence >= Math.max(.5, threshold) && age <= 1.5 && track.sourceIds.includes(support.id)
      && !intel.reservations.some(r => r.assetId === support.id && r.resource === 'sensor-channel')) {
      return { priority: 'coordinated-strike', utility: 100 + confidence * 20,
        reason: `Fresh ${support.id} evidence supports ${contact.contactId}; reserve one ${shooter.id} round and one sensor channel.`,
        command: { type: 'planPhysicalStrike', args: [shooter.id, contact.contactId, support.id, contact.revision ?? 0,
          opponent.doctrine === 'cautious' ? 'abort' : opponent.doctrine === 'aggressive' ? 'continue-local' : 'hold', 0] } };
    }
    if (opponent.doctrine !== 'cautious' && confidence >= (opponent.doctrine === 'aggressive' ? .3 : .7)
      && age <= 1.5) return {
      priority: 'local-strike', utility: 65 + confidence * 20,
      reason: `No eligible support channel; fire ${shooter.id} at scoped contact ${contact.contactId}.`,
      command: { type: 'launchPhysical', args: [shooter.id, contact.contactId, contact.revision] } };
  }
  const escort = p.actors.find(a => a.iso === view.enemyIso && a.domain === 'subsurface' && operational(a, 'propulsion'));
  if (escort && shooter && length(sub(escort.position, shooter.position)) > 2500) {
    const delta = sub(shooter.position, escort.position);
    const course = (Math.atan2(delta[0], delta[1]) * 180 / Math.PI + 360) % 360;
    if (Math.abs(((course - escort.course + 540) % 360) - 180) > 10) return {
      priority: 'formation', utility: 30, reason: `${escort.id} is outside the 2.5 km support spacing; close on ${shooter.id}.`,
      command: { type: 'setPhysicalCourse', args: [escort.id, course, 6] } };
  }
  return { priority: 'wait', utility: 0,
    reason: !shooter ? 'No ready red launcher or strike rounds remain.' : missionBusy ? 'A strike already owns the shooter or support resources.'
      : activeTask ? 'Collection is processing or awaiting delivery.' : 'No current HQ track and eligible support combination.' };
}

export function configureOpponent(s: WarSimSession, doctrine: OpponentDoctrine, difficulty: OpponentDifficulty, enabled: boolean) {
  if (!s.physical?.opposition || s.activeFaction !== 'player' || s.simTimeSec !== 0 || s.status !== 'paused'
    || !['cautious', 'balanced', 'aggressive'].includes(doctrine) || !['cadet', 'standard', 'veteran'].includes(difficulty)
    || typeof enabled !== 'boolean') throw new Error('Opponent settings can be changed by blue before the joint probe starts.');
  Object.assign(s.physical.opposition, { doctrine, difficulty, enabled });
  return s;
}

export function evaluateObjectives(s: WarSimSession, tick: number) {
  const objective = s.physical?.objectives;
  if (!objective || objective.status !== 'ongoing') return;
  const blue = s.physical!.actors.find(a => a.id === 'blue-frigate');
  const red = s.physical!.actors.find(a => a.id === 'red-frigate');
  if (blue && blue.health <= 0) objective.status = 'red-victory';
  else if (!red || red.health <= 0 || tick >= objective.deadlineTick) objective.status = 'blue-victory';
  else return;
  objective.concludedTick = tick;
  s.status = 'concluded';
  for (const faction of ['player', 'enemy'] as const) s.eventLog.push({ id: `joint-objective-${tick}-${faction}`,
    simTimeSec: s.simTimeSec, timeFormatted: `T+${s.simTimeSec.toFixed(1)}`, faction, type: 'alert',
    title: objective.status === 'red-victory' ? 'Red objective achieved' : 'Blue objective achieved',
    detail: objective.status === 'red-victory' ? 'FS Resolute disabled.' : 'The defense held or the red frigate was disabled.' });
  s.eventLog = s.eventLog.slice(-512);
}

export function validateOpposition(s: WarSimSession) {
  const opposition = s.physical?.opposition, objective = s.physical?.objectives;
  if (!opposition && !objective) return;
  if (!opposition || !objective || opposition.version !== 1 || objective.version !== 1
    || typeof opposition.enabled !== 'boolean' || !['cautious', 'balanced', 'aggressive'].includes(opposition.doctrine)
    || !['cadet', 'standard', 'veteran'].includes(opposition.difficulty)
    || !Number.isSafeInteger(opposition.nextDecisionTick) || opposition.nextDecisionTick < 0
    || !Number.isSafeInteger(opposition.sequence) || opposition.sequence < 0 || !Array.isArray(opposition.decisions)
    || opposition.decisions.length > 256 || !Number.isSafeInteger(objective.deadlineTick) || objective.deadlineTick <= 0
    || !['ongoing', 'red-victory', 'blue-victory'].includes(objective.status)) throw new Error('Invalid opposition or objective checkpoint.');
}
