import type { WarSimSession } from '../warSimTypes';
import type { CommandEnvelope, Faction, SimulationCommand } from './contracts';
import { hq } from './intelligence';
import { projectObserver } from './projection';
import type { PhysicalEncounter } from './physics/types';

export const REPLAY_FRAME_TICKS = 10;
export interface ReplayRecord {
  id: number; tick: number; faction: Faction; kind: 'order' | 'decision' | 'event';
  title: string; detail: string; sourceId?: string; command?: SimulationCommand;
  result?: 'accepted' | 'rejected' | 'wait';
}
export interface ReplayFrame {
  tick: number;
  player: RecordedView;
  enemy: RecordedView;
}
export interface RecordedView {
  simTimeSec: WarSimSession['simTimeSec']; status: WarSimSession['status'];
  timeMultiplier: WarSimSession['timeMultiplier']; entities: WarSimSession['entities'];
  fogOfWarContacts: WarSimSession['fogOfWarContacts']; activeMissiles: WarSimSession['activeMissiles'];
  eventLog: WarSimSession['eventLog']; intelView: WarSimSession['intelView'];
  physical: Pick<PhysicalEncounter, 'actors' | 'rounds' | 'events' | 'opposition' | 'objectives'>;
}
export interface ReplayArchive {
  version: 1; modelVersion: string; intervalTicks: number; sequence: number;
  basis: { player: WarSimSession; enemy: WarSimSession };
  priorEventIds?: string[];
  records: ReplayRecord[]; frames: ReplayFrame[];
}
export interface FactionReplay {
  version: 1; modelVersion: string; intervalTicks: number; faction: Faction;
  records: ReplayRecord[]; frames: Array<{ tick: number; session: WarSimSession }>;
}

function recordedView(world: WarSimSession, faction: Faction): WarSimSession {
  const iso = faction === 'player' ? world.playerIso : world.enemyIso;
  const view = projectObserver({ ...world, activeFaction: faction, observerScope: hq(iso) });
  // These are presentation frames; the complete timeline is in records.
  view.eventLog = view.eventLog.slice(-12);
  if (view.physical) {
    view.physical.events = view.physical.events.slice(-12);
    if (view.physical.opposition) view.physical.opposition.decisions = view.physical.opposition.decisions.slice(-8);
  }
  return view;
}
function packView(view: WarSimSession): RecordedView {
  const p = view.physical!;
  const intel = view.intelView;
  return { simTimeSec: view.simTimeSec, status: view.status, timeMultiplier: view.timeMultiplier,
    entities: view.entities, fogOfWarContacts: view.fogOfWarContacts, activeMissiles: view.activeMissiles,
    eventLog: view.eventLog, intelView: intel ? { scopeId: intel.scopeId, tracks: [], tasks: [], sensors: [],
      links: [], coverage: [], messages: [], missions: intel.missions, reservations: intel.reservations } : undefined,
    physical: { actors: p.actors, rounds: p.rounds, events: p.events,
      opposition: p.opposition, objectives: p.objectives } };
}
function unpackView(archive: ReplayArchive, view: RecordedView, faction: Faction): WarSimSession {
  const basis = archive.basis[faction];
  return structuredClone({ ...basis, ...view, physical: { ...basis.physical!, ...view.physical } });
}

export function createReplay(world: WarSimSession, tick: number, modelVersion: string): ReplayArchive {
  const player = recordedView(world, 'player'), enemy = recordedView(world, 'enemy');
  const archive: ReplayArchive = { version: 1, modelVersion, intervalTicks: REPLAY_FRAME_TICKS,
    sequence: 0, basis: { player, enemy }, records: [], frames: [] };
  archive.frames.push({ tick, player: packView(player), enemy: packView(enemy) });
  return archive;
}

export function captureReplayFrame(archive: ReplayArchive, world: WarSimSession, tick: number, force = false) {
  if (!force && tick % archive.intervalTicks !== 0) return;
  const frame: ReplayFrame = { tick, player: packView(recordedView(world, 'player')),
    enemy: packView(recordedView(world, 'enemy')) };
  if (archive.frames.at(-1)?.tick === tick) archive.frames[archive.frames.length - 1] = frame;
  else archive.frames.push(frame);
}

export function appendReplayRecord(archive: ReplayArchive, entry: Omit<ReplayRecord, 'id'>) {
  archive.records.push({ ...entry, id: ++archive.sequence });
}

export function recordReplayOrder(archive: ReplayArchive | undefined, envelope: CommandEnvelope,
  tick: number, result: 'accepted' | 'rejected', reason?: string) {
  if (!archive) return;
  appendReplayRecord(archive, { tick, faction: envelope.scope.faction, kind: 'order',
    title: envelope.command.type, detail: reason ?? `${envelope.scope.commandGroupId} order ${result}.`,
    command: structuredClone(envelope.command), result });
}

export function recordVisibleEvents(archive: ReplayArchive | undefined, world: WarSimSession, tick: number,
  seen: Set<string>) {
  if (!archive) return;
  for (const event of world.eventLog) {
    if (event.faction !== 'player' && event.faction !== 'enemy') continue;
    const key = `${event.faction}:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    appendReplayRecord(archive, { tick, faction: event.faction, kind: 'event', sourceId: key,
      title: event.title, detail: event.detail });
  }
}

/** Recorded frames can be read without loading the original simulation model. */
export function factionReplay(archive: ReplayArchive, faction: Faction): FactionReplay {
  validateReplay(archive);
  return { version: 1, modelVersion: archive.modelVersion, intervalTicks: archive.intervalTicks, faction,
    records: archive.records.filter(r => r.faction === faction).map(r => structuredClone(r)),
    frames: archive.frames.map(frame => ({ tick: frame.tick, session: unpackView(archive, frame[faction], faction) })) };
}

export function validateReplay(archive: ReplayArchive) {
  if (!archive || archive.version !== 1 || typeof archive.modelVersion !== 'string'
    || !Number.isSafeInteger(archive.intervalTicks) || archive.intervalTicks < 1
    || !Number.isSafeInteger(archive.sequence) || archive.sequence < 0
    || !archive.basis || archive.basis.player?.activeFaction !== 'player'
    || archive.basis.enemy?.activeFaction !== 'enemy'
    || archive.basis.player.runtime !== undefined || archive.basis.enemy.runtime !== undefined
    || archive.priorEventIds !== undefined && (!Array.isArray(archive.priorEventIds)
      || archive.priorEventIds.some(id => typeof id !== 'string'))
    || !Array.isArray(archive.records) || !Array.isArray(archive.frames) || !archive.frames.length) {
    throw new Error('Invalid replay archive.');
  }
  if (archive.records.some((r, i) => !r || !Number.isSafeInteger(r.id) || r.id <= 0 || r.id > archive.sequence
    || i > 0 && r.id <= archive.records[i - 1].id || !Number.isSafeInteger(r.tick) || r.tick < 0
    || !['player', 'enemy'].includes(r.faction) || !['order', 'decision', 'event'].includes(r.kind)
    || typeof r.title !== 'string' || typeof r.detail !== 'string')) throw new Error('Invalid replay record.');
  if (archive.frames.some((frame, i) => !frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0
    || i > 0 && frame.tick <= archive.frames[i - 1].tick
    || !Number.isFinite(frame.player?.simTimeSec) || !Number.isFinite(frame.enemy?.simTimeSec)
    || !Array.isArray(frame.player?.physical?.actors) || !Array.isArray(frame.enemy?.physical?.actors)
    || frame.player.physical.actors.some(a => a.iso !== archive.basis.player.playerIso)
    || frame.enemy.physical.actors.some(a => a.iso !== archive.basis.enemy.enemyIso))) throw new Error('Invalid replay frame.');
}
