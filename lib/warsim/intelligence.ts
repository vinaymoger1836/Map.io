import type { WarSimSession, DetectedContact } from '../warSimTypes';
import { add, sub, scale, length, fromENU, toENU, type Vec3 } from './physics/coordinates';
import { operational } from './physics/readiness';
import { radarWeatherFactor, terrainSight } from './physics/environment';

export type TrackState = 'fresh' | 'stale' | 'lost';
export interface IntelObservation {
  id: string; targetRef: string; sourceId: string; scopeId: string;
  position: Vec3; velocity: Vec3; uncertaintyM: number; confidence: number;
  collectedTick: number; processedTick: number; modality: 'radar' | 'briefing' | 'seeker' | 'ground-radar' | 'air-radar';
  domain?: 'sea' | 'air' | 'land' | 'missile';
  taskId?: string; processed: boolean;
}
export interface IntelTrack {
  id: string; targetRef: string; scopeId: string; position: Vec3; velocity: Vec3;
  uncertaintyM: number; confidence: number; observedTick: number; receivedTick: number;
  state: TrackState; revision: number; evidenceIds: string[]; sourceIds: string[];
  domain: 'sea' | 'air' | 'land' | 'missile';
}
export interface IntelLink {
  id: string; from: string; to: string; active: boolean; latencyTicks: number; capacity: number;
}
export interface IntelMessage {
  id: string; observationId: string; from: string; to: string; linkId: string;
  sentTick: number; deliveryTick: number; status: 'queued' | 'delivered' | 'expired';
}
export interface IntelSensor {
  actorId: string; mode: 'active' | 'passive'; rangeM: number; intervalTicks: number; nextScanTick: number;
  sensorTime: number;
}
export interface IntelTask {
  id: string; assetId: string; scopeId: string; center: Vec3; radiusM: number;
  requestedTick: number; status: 'requested' | 'collecting' | 'processing' | 'disseminating' | 'complete' | 'interrupted' | 'cancelled';
  evidenceIds: string[]; finishedTick?: number; coverageId?: string;
}
export interface CoverageRecord { id: string; scopeId: string; center: Vec3; radiusM: number; observedTick: number; sensorId: string; result: 'contact' | 'no-contact'; }
export interface IntelReservation { id: string; missionId: string; assetId: string; resource: 'strike-round' | 'sensor-channel'; quantity: number; expiresTick: number; }
export interface IntelMission {
  id: string; shooterId: string; supportId: string; trackId: string; trackRevision: number; scopeId: string;
  targetRef: string; status: 'awaiting-support' | 'ready' | 'held' | 'executed' | 'aborted';
  onLoss: 'hold' | 'abort' | 'continue-local'; createdTick: number; readyTick?: number;
  notBeforeTick?: number; firedRoundId?: string; outcome?: 'impact' | 'intercept' | 'expired'; completedTick?: number;
  reason: string; evidenceIds: string[];
}
export interface PhysicalIntel {
  version: 1; sequence: number; contacts: Record<string, string>; observations: IntelObservation[];
  tracks: IntelTrack[]; links: IntelLink[]; messages: IntelMessage[]; sensors: IntelSensor[];
  tasks: IntelTask[]; coverage: CoverageRecord[]; missions: IntelMission[]; reservations: IntelReservation[];
  coalitionSharing: Record<string, boolean>;
}

export const hq = (iso: string) => `${iso}:hq`;
export const local = (id: string) => `${id}:local`;
export const factionScope = (iso: string) => `${iso}:faction`;
export const coalitionScope = (iso: string) => `${iso}:coalition`;
const ordered = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id.localeCompare(b.id));
const actorIso = (s: WarSimSession, id: string) => s.physical!.actors.find(a => a.id === id)?.iso;
const ownerIso = (s: WarSimSession, scopeId: string) => s.physical!.actors.find(a => local(a.id) === scopeId)?.iso
  ?? [s.playerIso, s.enemyIso].find(iso => [hq(iso), factionScope(iso), coalitionScope(iso)].includes(scopeId));
const nextId = (i: PhysicalIntel, prefix: string) => `${prefix}-${++i.sequence}`;

export function createPhysicalIntel(s: WarSimSession): PhysicalIntel {
  const p = s.physical!;
  const i: PhysicalIntel = { version: 1, sequence: 0, contacts: {}, observations: [], tracks: [], links: [], messages: [],
    sensors: [], tasks: [], coverage: [], missions: [], reservations: [], coalitionSharing: { [s.playerIso]: false, [s.enemyIso]: false } };
  for (const a of p.actors) {
    i.sensors.push({ actorId: a.id, mode: 'active', rangeM: a.domain === 'air' ? 12000 : a.id === 'blue-frigate' ? 2500 : 9000,
      intervalTicks: a.domain === 'air' || a.id.includes('scout') ? 5 : 10, nextScanTick: 0, sensorTime: 100 });
    i.links.push({ id: `link-${a.id}`, from: local(a.id), to: hq(a.iso), active: true, latencyTicks: 10, capacity: 2 });
  }
  for (const iso of [s.playerIso, s.enemyIso]) {
    i.links.push({ id: `link-${iso}-faction`, from: hq(iso), to: factionScope(iso), active: true, latencyTicks: 5, capacity: 8 });
    i.links.push({ id: `link-${iso}-coalition`, from: factionScope(iso), to: coalitionScope(iso), active: false, latencyTicks: 20, capacity: 4 });
  }
  // Explicit scenario-supplied briefing: a rough old report, not a live truth feed.
  for (const iso of [...new Set(p.actors.map(a => a.iso))]) {
    const enemy = p.actors.find(b => b.iso !== iso);
    if (!enemy) continue;
    const obs: IntelObservation = { id: nextId(i, 'brief'), targetRef: enemy.id, sourceId: 'scenario-briefing', scopeId: hq(iso), domain: enemy.domain ?? 'sea',
      position: add(enemy.position, [240, -160, 0]), velocity: [0, 0, 0], uncertaintyM: 600,
      confidence: .56, collectedTick: 0, processedTick: 0, modality: 'briefing', processed: true };
    i.observations.push(obs); fuse(i, obs, hq(iso), 0);
  }
  return i;
}
export function ensurePhysicalIntel(s: WarSimSession): PhysicalIntel {
  const p = s.physical!;
  if (!p.intel) {
    p.intel = createPhysicalIntel(s);
    // Phase 2 saves carried one faction contact array per side. Preserve those reported
    // positions as imported evidence; do not seed a new report from hidden actor truth.
    const i = p.intel;
    i.observations = []; i.tracks = []; i.contacts = {}; i.sequence = 0;
    const tick = Math.round(s.simTimeSec * 10);
    for (const [iso, contacts] of [[s.playerIso, s.fogOfWarContacts.playerContacts],
      [s.enemyIso, s.fogOfWarContacts.enemyContacts]] as const) {
      for (const contact of contacts) {
        const actor = p.actors.find(a => a.id === contact.targetEntityId && a.iso !== iso);
        if (!actor) continue;
        const heading = contact.headingDeg * Math.PI / 180, speed = contact.speedKmh / 3.6;
        const reportedTick = Math.max(0, Math.min(tick, Math.round(contact.lastDetectedSimTimeSec * 10)));
        const reportAgeSec = (tick - reportedTick) / 10;
        const observation: IntelObservation = { id: nextId(i, 'import'), targetRef: actor.id, sourceId: 'legacy-contact-import',
          scopeId: hq(iso), position: toENU([...contact.lastKnownLngLat, 0], p.origin),
          velocity: [Math.sin(heading) * speed, Math.cos(heading) * speed, 0],
          uncertaintyM: Math.max(250, contact.uncertaintyM ?? 250) + reportAgeSec * 25,
          confidence: .6 * Math.exp(-reportAgeSec / 30),
          collectedTick: tick, processedTick: tick, modality: 'briefing', processed: true };
        i.observations.push(observation); fuse(i, observation, hq(iso), tick);
      }
    }
    for (const event of p.events) event.visibleTo = event.visibleTo.map(scope =>
      scope === s.playerIso || scope === s.enemyIso ? hq(scope) : scope);
  }
  return p.intel;
}
export function currentTrack(i: PhysicalIntel, scopeId: string, id: string, tick: number): IntelTrack | undefined {
  const t = i.tracks.find(t => t.scopeId === scopeId && t.id === id);
  return t && tick - t.observedTick <= 45 && t.state !== 'lost' ? t : undefined;
}
export const effectiveConfidence = (track: IntelTrack, tick: number) => track.confidence * Math.exp(-Math.max(0, tick - track.observedTick) / 300);
export function scopeTracks(i: PhysicalIntel, scopeId: string): IntelTrack[] { return i.tracks.filter(t => t.scopeId === scopeId && t.state !== 'lost'); }
function fuse(i: PhysicalIntel, o: IntelObservation, scopeId: string, tick: number) {
  let t = i.tracks.find(t => t.scopeId === scopeId && t.targetRef === o.targetRef);
  if (t?.evidenceIds.includes(o.id)) return t;
  const id = i.contacts[o.targetRef] ??= nextId(i, 'track');
  if (!t) { t = { id, targetRef: o.targetRef, scopeId, position: [...o.position], velocity: [...o.velocity], uncertaintyM: o.uncertaintyM,
    confidence: o.confidence, observedTick: o.collectedTick, receivedTick: tick, state: 'fresh', revision: 1,
    evidenceIds: [o.id], sourceIds: [o.sourceId], domain: o.domain ?? (o.targetRef.startsWith('round-') ? 'missile' : 'sea') }; i.tracks.push(t); return t; }
  // An old observation cannot pull a current track backwards. Retain its provenance only.
  if (o.collectedTick < t.observedTick) { t.evidenceIds.push(o.id); return t; }
  const predicted = add(t.position, scale(t.velocity, (o.collectedTick - t.observedTick) / 10));
  const prior = 1 / Math.max(1, t.uncertaintyM ** 2), sample = 1 / Math.max(1, o.uncertaintyM ** 2);
  t.position = scale(add(scale(predicted, prior), scale(o.position, sample)), 1 / (prior + sample));
  t.velocity = scale(add(scale(t.velocity, prior), scale(o.velocity, sample)), 1 / (prior + sample));
  t.uncertaintyM = Math.max(10, Math.sqrt(1 / (prior + sample)));
  t.confidence = Math.min(.98, 1 - (1 - t.confidence) * (1 - o.confidence));
  t.observedTick = o.collectedTick; t.receivedTick = tick; t.state = 'fresh'; t.revision++;
  t.evidenceIds.push(o.id); t.evidenceIds = t.evidenceIds.slice(-128);
  if (!t.sourceIds.includes(o.sourceId)) t.sourceIds.push(o.sourceId);
  return t;
}
function noise(key: string, tick: number) {
  let h = 2166136261; for (let j = 0; j < key.length; j++) h = Math.imul(h ^ key.charCodeAt(j), 16777619);
  h = Math.imul(h ^ tick, 16777619);
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}
function observe(s: WarSimSession, sourceId: string, targetRef: string, scopeId: string, tick: number, uncertaintyM: number,
  modality: IntelObservation['modality'], taskId?: string, immediate = false): IntelObservation {
  const i = ensurePhysicalIntel(s), target = [...s.physical!.actors, ...s.physical!.rounds].find(a => a.id === targetRef)!;
  const o: IntelObservation = { id: nextId(i, 'obs'), targetRef, sourceId, scopeId,
    domain: 'domain' in target ? target.domain ?? 'sea' : 'missile',
    position: add(target.position, [noise(sourceId + targetRef, tick) * uncertaintyM * .6,
      noise(targetRef + sourceId, tick + 11) * uncertaintyM * .6, 0]),
    velocity: [...target.velocity], uncertaintyM, confidence: modality === 'seeker' ? .95 : .7,
    collectedTick: tick, processedTick: tick + (immediate ? 0 : 3), modality, taskId, processed: immediate };
  i.observations.push(o); if (immediate) fuse(i, o, scopeId, tick);
  i.observations = i.observations.slice(-512);
  return o;
}
function queue(i: PhysicalIntel, o: IntelObservation, link: IntelLink, tick: number) {
  if (!link.active || i.messages.some(m => m.observationId === o.id && m.linkId === link.id)) return;
  const outstanding = i.messages.filter(m => m.linkId === link.id && m.status === 'queued').length;
  if (outstanding >= link.capacity * 16) return;
  i.messages.push({ id: nextId(i, 'msg'), observationId: o.id, from: link.from, to: link.to,
    linkId: link.id, sentTick: tick, deliveryTick: tick + link.latencyTicks, status: 'queued' });
  i.messages = i.messages.slice(-512);
}
function route(i: PhysicalIntel, from: string, to: string): IntelLink[] | undefined {
  const path: IntelLink[] = [];
  let scope = from;
  while (scope !== to && path.length < 3) {
    const link = i.links.find(l => l.from === scope && l.active);
    if (!link) return;
    path.push(link); scope = link.to;
  }
  return scope === to ? path : undefined;
}
export function runPhysicalIntelligence(s: WarSimSession, tick: number) {
  const i = ensurePhysicalIntel(s), p = s.physical!;
  for (const t of i.tracks) {
    const age = tick - t.observedTick;
    t.state = age > 45 ? 'lost' : age > 15 ? 'stale' : 'fresh';
  }
  i.tracks = i.tracks.filter(t => tick - t.observedTick <= 120);
  for (const sensor of i.sensors) {
    if (tick < sensor.nextScanTick) continue;
    sensor.nextScanTick = tick + sensor.intervalTicks;
    const actor = p.actors.find(a => a.id === sensor.actorId);
    if (!actor || !operational(actor, 'sensor') || sensor.mode === 'passive' || sensor.sensorTime <= 0) continue;
    sensor.sensorTime = Math.max(0, sensor.sensorTime - .002);
    const tasks = i.tasks.filter(t => t.assetId === actor.id && ['requested', 'collecting'].includes(t.status));
    for (const task of tasks) task.status = 'collecting';
    const effectiveRange = sensor.rangeM * radarWeatherFactor(p.environment);
    const spotted = [...p.actors.filter(target => target.health > 0), ...p.rounds]
      .filter(target => target.iso !== actor.iso && length(sub(target.position, actor.position)) <= effectiveRange
        && (actor.domain !== 'land' || !p.environment || terrainSight(p.environment, actor.position, target.position) === 'clear'));
    for (const target of spotted) {
      const task = tasks.find(t => length(sub(target.position, t.center)) <= t.radiusM);
      const uncertainty = target.id.startsWith('round-') ? 25 + length(sub(target.position, actor.position)) * .015
        : 70 + length(sub(target.position, actor.position)) * .025;
      const o = observe(s, actor.id, target.id, local(actor.id), tick, uncertainty,
        actor.domain === 'land' ? 'ground-radar' : actor.domain === 'air' ? 'air-radar' : 'radar', task?.id);
      if (task) task.evidenceIds.push(o.id);
    }
    for (const task of tasks) {
      task.coverageId = nextId(i, 'coverage');
      i.coverage.push({ id: task.coverageId, scopeId: local(actor.id), center: task.center, radiusM: task.radiusM,
        observedTick: tick, sensorId: actor.id, result: task.evidenceIds.length ? 'contact' : 'no-contact' });
      task.status = 'processing';
    }
  }
  for (const o of i.observations) {
    if (o.processed || o.processedTick > tick) continue;
    o.processed = true; fuse(i, o, o.scopeId, tick);
    for (const link of i.links.filter(l => l.from === o.scopeId)) queue(i, o, link, tick);
    const task = i.tasks.find(t => t.id === o.taskId);
    if (task) {
      task.status = task.scopeId === o.scopeId ? 'complete' : 'disseminating';
      if (task.status === 'complete') task.finishedTick = tick;
    }
  }
  for (const task of i.tasks) {
    if (task.status === 'processing' && !task.evidenceIds.length && tick >= (i.coverage.find(c => c.id === task.coverageId)?.observedTick ?? tick) + 3) {
      const path = route(i, local(task.assetId), task.scopeId);
      task.status = path ? 'disseminating' : 'interrupted';
      if (path) task.finishedTick = tick + path.reduce((latency, link) => latency + link.latencyTicks, 0);
    }
    if (task.status === 'disseminating' && task.finishedTick !== undefined && tick >= task.finishedTick) {
      if (!route(i, local(task.assetId), task.scopeId)) task.status = 'interrupted';
      else {
        const coverage = i.coverage.find(c => c.id === task.coverageId)!;
        if (coverage.scopeId !== task.scopeId) i.coverage.push({ ...coverage, id: nextId(i, 'coverage'), scopeId: task.scopeId });
        task.status = 'complete';
      }
    }
  }
  for (const m of i.messages) {
    if (m.status !== 'queued' || m.deliveryTick > tick) continue;
    const link = i.links.find(l => l.id === m.linkId);
    if (!link?.active) { m.status = 'expired'; continue; }
    const o = i.observations.find(o => o.id === m.observationId);
    if (!o) { m.status = 'expired'; continue; }
    fuse(i, o, m.to, tick); m.status = 'delivered';
    for (const onward of i.links.filter(l => l.from === m.to && l.active)) queue(i, o, onward, tick);
    const task = i.tasks.find(t => t.id === o.taskId);
    if (task && m.to === task.scopeId) {
      task.status = 'complete'; task.finishedTick = tick;
      const coverage = i.coverage.find(c => c.id === task.coverageId);
      if (coverage && !i.coverage.some(c => c.scopeId === task.scopeId && c.sensorId === coverage.sensorId && c.observedTick === coverage.observedTick))
        i.coverage.push({ ...coverage, id: nextId(i, 'coverage'), scopeId: task.scopeId });
    }
  }
  for (const task of i.tasks) if (task.status === 'disseminating' && !route(i, local(task.assetId), task.scopeId)) task.status = 'interrupted';
  i.coverage = i.coverage.slice(-128);
}

export function acquireSeeker(s: WarSimSession, roundId: string, tick: number): IntelTrack | undefined {
  const p = s.physical!, i = ensurePhysicalIntel(s), r = p.rounds.find(r => r.id === roundId);
  if (!r) return;
  const aim = r.aimPosition
    ? add(r.aimPosition, scale(r.aimVelocity ?? [0, 0, 0], Math.max(0, tick - (r.aimObservedTick ?? tick)) / 10))
    : add(r.position, scale(r.velocity, 4));
  const target = [...p.actors.filter(a => a.health > 0), ...p.rounds.filter(candidate => candidate.id !== r.id)]
    .filter(candidate => candidate.iso !== r.iso && length(sub(candidate.position, r.position)) <= 4000)
    .sort((a, b) => length(sub(a.position, aim)) - length(sub(b.position, aim)) || a.id.localeCompare(b.id))[0];
  if (!target || length(sub(target.position, aim)) > (r.interceptor ? 350 : Math.max(300, r.age * 15 + 250)))
    return scopeTracks(i, local(r.id)).find(t => t.targetRef === r.targetId);
  r.targetId = target.id;
  const o = observe(s, r.id, target.id, local(r.id), tick, 18 + length(sub(target.position, r.position)) * .005, 'seeker', undefined, true);
  return i.tracks.find(t => t.scopeId === local(r.id) && t.evidenceIds.includes(o.id));
}
export function observedContacts(s: WarSimSession, scopeId: string, tick: number): DetectedContact[] {
  const i = ensurePhysicalIntel(s), p = s.physical!, iso = ownerIso(s, scopeId);
  return scopeTracks(i, scopeId).filter(t => actorIso(s, t.targetRef) !== iso && t.domain !== 'missile').map(t => {
    const age = Math.max(0, tick - t.observedTick) / 10;
    const estimated = add(t.position, scale(t.velocity, Math.min(age, 15)));
    const pos = fromENU(estimated, p.origin);
    return { contactId: t.id, targetEntityId: t.id, targetIso: 'unknown', discoveredByFaction: iso === s.playerIso ? 'player' : 'enemy',
      intelTier: 1, domain: t.domain === 'land' ? 'ground' : t.domain, lastKnownLngLat: [pos[0], pos[1]], headingDeg: Math.atan2(t.velocity[0], t.velocity[1]) * 180 / Math.PI,
      speedKmh: length(t.velocity) * 3.6, lastDetectedSimTimeSec: t.observedTick / 10, decayTimerSec: age,
      knownName: t.state === 'fresh' ? `${t.domain === 'air' ? 'Air' : t.domain === 'land' ? 'Ground' : 'Surface'} contact`
        : `${t.domain === 'air' ? 'Air' : t.domain === 'land' ? 'Ground' : 'Surface'} contact · ${t.state}`,
      uncertaintyM: t.uncertaintyM + age * 25, confidence: t.confidence * Math.exp(-age / 30), trackState: t.state,
      evidenceIds: [...t.evidenceIds], revision: t.revision, sourceIds: [...t.sourceIds] };
  });
}
export function projectIntel(s: WarSimSession, scopeId: string, tick: number) {
  const i = ensurePhysicalIntel(s), iso = ownerIso(s, scopeId);
  return { scopeId, tracks: scopeTracks(i, scopeId).map(t => ({ id: t.id, state: t.state, uncertaintyM: t.uncertaintyM + (tick - t.observedTick) * 2.5,
    confidence: t.confidence * Math.exp(-(tick - t.observedTick) / 300), ageSec: (tick - t.observedTick) / 10,
    revision: t.revision, evidenceIds: [...t.evidenceIds], sourceIds: [...t.sourceIds], domain: t.domain,
    history: t.evidenceIds.slice(-8).map(id => i.observations.find(o => o.id === id)).filter((o): o is IntelObservation => Boolean(o))
      .map(o => ({ id: o.id, sourceId: o.sourceId, modality: o.modality, collectedSec: o.collectedTick / 10,
        receivedSec: (i.messages.find(m => m.observationId === o.id && m.to === scopeId && m.status === 'delivered')?.deliveryTick ?? o.processedTick) / 10,
        location: fromENU(o.position, s.physical!.origin).slice(0, 2) as [number, number], uncertaintyM: o.uncertaintyM })) })),
    tasks: i.tasks.filter(t => actorIso(s, t.assetId) === iso).map(t => ({ ...t })),
    sensors: i.sensors.filter(sensor => actorIso(s, sensor.actorId) === iso).map(sensor => ({ ...sensor })),
    links: i.links.filter(link => ownerIso(s, link.from) === iso).map(link => ({ ...link })),
    coverage: i.coverage.filter(c => c.scopeId === scopeId && c.observedTick <= tick).map(c => ({ ...c })),
    messages: i.messages.filter(m => ownerIso(s, m.from) === iso && (m.from === scopeId || m.to === scopeId)).map(m => ({ id: m.id, status: m.status, sentTick: m.sentTick, deliveryTick: m.deliveryTick, from: m.from, to: m.to })),
    missions: i.missions.filter(m => actorIso(s, m.shooterId) === iso).map(m => {
      const observedOutcome = s.physical!.events.some(e => e.terminatedRoundIds.includes(m.firedRoundId ?? '') && e.kind === m.outcome && e.visibleTo.includes(scopeId));
      return { ...m, targetRef: undefined, outcome: observedOutcome ? m.outcome : undefined,
        completedTick: observedOutcome ? m.completedTick : undefined };
    }),
    reservations: i.reservations.filter(r => actorIso(s, r.assetId) === iso).map(r => ({ ...r })),
  };
}
export function requestPhysicalCollection(s: WarSimSession, assetId: string, center: Vec3, radiusM: number, tick: number) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const sensor = i.sensors.find(x => x.actorId === assetId), actor = s.physical!.actors.find(a => a.id === assetId && a.iso === iso && a.health > 0);
  if (!sensor || !actor || !operational(actor, 'sensor') || sensor.mode !== 'active' || !Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)
    || !Number.isFinite(radiusM) || radiusM < 100 || radiusM > sensor.rangeM || length(sub(center, actor.position)) > sensor.rangeM)
    throw new Error('Choose an active sensor and a reachable 100 m to 9 km search area.');
  if (i.tasks.some(t => t.assetId === assetId && !['complete', 'interrupted', 'cancelled'].includes(t.status))) throw new Error('Sensor already has a collection task.');
  const task: IntelTask = { id: nextId(i, 'task'), assetId, scopeId: s.observerScope ?? hq(iso), center: [...center], radiusM,
    requestedTick: tick, status: 'requested', evidenceIds: [] };
  i.tasks.push(task); return s;
}
export function setPhysicalEmission(s: WarSimSession, assetId: string, mode: IntelSensor['mode']) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const sensor = i.sensors.find(x => x.actorId === assetId && actorIso(s, assetId) === iso);
  if (!sensor || !['active', 'passive'].includes(mode)) throw new Error('Invalid sensor emission order.');
  if (mode === 'active' && !operational(s.physical!.actors.find(a => a.id === assetId)!, 'sensor'))
    throw new Error('Sensor is damaged and cannot transmit.');
  sensor.mode = mode;
  for (const task of i.tasks) if (task.assetId === assetId && !['complete', 'cancelled'].includes(task.status) && mode === 'passive') task.status = 'interrupted';
  return s;
}
export function setPhysicalLink(s: WarSimSession, assetId: string, active: boolean) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const link = i.links.find(l => l.from === local(assetId) && actorIso(s, assetId) === iso);
  if (!link || typeof active !== 'boolean') throw new Error('Invalid friendly data-link order.');
  link.active = active; return s;
}
export function forwardPhysicalReport(s: WarSimSession, evidenceId: string, to: 'faction' | 'coalition', tick: number) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const from = to === 'faction' ? hq(iso) : factionScope(iso), dest = to === 'faction' ? factionScope(iso) : coalitionScope(iso);
  const o = i.observations.find(o => o.id === evidenceId);
  const t = i.tracks.find(t => t.scopeId === from && t.evidenceIds.includes(evidenceId));
  const link = i.links.find(l => l.from === from && l.to === dest && l.active);
  if (!o || !t || !link) throw new Error('The report has not reached this scope or its sharing link is offline.');
  queue(i, o, link, tick); return s;
}
export function setCoalitionSharing(s: WarSimSession, active: boolean) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  if (typeof active !== 'boolean') throw new Error('Invalid sharing policy.');
  i.coalitionSharing[iso] = active;
  const link = i.links.find(l => l.from === factionScope(iso) && l.to === coalitionScope(iso))!;
  link.active = active; return s;
}
export function reservePhysicalMission(s: WarSimSession, shooterId: string, trackId: string, supportId: string,
  revision: number, onLoss: IntelMission['onLoss'], tick: number, delaySec = 0) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const scopeId = s.observerScope ?? hq(iso), shooter = s.physical!.actors.find(a => a.id === shooterId && a.iso === iso && a.health > 0);
  const support = s.physical!.actors.find(a => a.id === supportId && a.iso === iso && a.health > 0);
  const track = currentTrack(i, scopeId, trackId, tick);
  if (!shooter || !support || shooter.id === support.id || !track || track.revision !== revision || effectiveConfidence(track, tick) < .5
    || tick - track.observedTick > 15 || !['hold', 'abort', 'continue-local'].includes(onLoss))
    throw new Error('Mission requires an owned shooter, support sensor and current track revision.');
  if (!operational(shooter, 'strikeLauncher') || !operational(support, 'sensor'))
    throw new Error('Damaged strike launcher or support sensor blocks this mission.');
  if (!Number.isFinite(delaySec) || delaySec < 0 || delaySec > 30) throw new Error('Mission delay must be between 0 and 30 seconds.');
  if (!i.sensors.some(x => x.actorId === supportId && x.mode === 'active') || !i.links.some(l => l.from === local(supportId) && l.active))
    throw new Error('Support sensor or its data link is unavailable.');
  if (shooter.rounds - i.reservations.filter(r => r.assetId === shooterId && r.resource === 'strike-round').length < 1
    || i.reservations.some(r => r.assetId === supportId && r.resource === 'sensor-channel')) throw new Error('Strike round or sensor channel is already committed.');
  if (!i.tracks.some(t => t.scopeId === local(supportId) && t.targetRef === track.targetRef && t.state === 'fresh'))
    throw new Error('The support sensor has not produced a fresh local observation.');
  const id = nextId(i, 'mission');
  i.missions.push({ id, shooterId, supportId, trackId, trackRevision: revision, scopeId, targetRef: track.targetRef,
    status: 'awaiting-support', onLoss, createdTick: tick, notBeforeTick: tick + Math.round(delaySec * 10),
    reason: delaySec ? `Queued for T+${((tick + Math.round(delaySec * 10)) / 10).toFixed(1)}` : 'Awaiting support acknowledgement', evidenceIds: [...track.evidenceIds] });
  i.reservations.push({ id: nextId(i, 'reserve'), missionId: id, assetId: shooterId, resource: 'strike-round', quantity: 1, expiresTick: tick + 600 });
  i.reservations.push({ id: nextId(i, 'reserve'), missionId: id, assetId: supportId, resource: 'sensor-channel', quantity: 1, expiresTick: tick + 600 });
  return s;
}
export function cancelPhysicalMission(s: WarSimSession, missionId: string) {
  const i = ensurePhysicalIntel(s), iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const m = i.missions.find(m => m.id === missionId && actorIso(s, m.shooterId) === iso && !['executed', 'aborted'].includes(m.status));
  if (!m) throw new Error('No cancellable mission belongs to this faction.');
  m.status = 'aborted'; m.reason = 'Cancelled by command'; i.reservations = i.reservations.filter(r => r.missionId !== m.id); return s;
}
export function missionSupport(i: PhysicalIntel, m: IntelMission, tick: number) {
  const link = i.links.find(l => l.from === local(m.supportId));
  const sensor = i.sensors.find(x => x.actorId === m.supportId);
  const localTrack = i.tracks.find(t => t.scopeId === local(m.supportId) && t.targetRef === m.targetRef);
  const commandTrack = i.tracks.find(t => t.scopeId === m.scopeId && t.targetRef === m.targetRef);
  return Boolean(link?.active && sensor?.mode === 'active' && localTrack && commandTrack
    && tick - localTrack.observedTick <= 15 && localTrack.evidenceIds.some(id => commandTrack.evidenceIds.includes(id)));
}
export function expireReservations(i: PhysicalIntel, tick: number) {
  for (const m of i.missions) if (!['executed', 'aborted'].includes(m.status) && i.reservations.some(r => r.missionId === m.id && r.expiresTick <= tick)) {
    m.status = 'aborted'; m.reason = 'Mission timed out';
  }
  i.reservations = i.reservations.filter(r => r.expiresTick > tick && !i.missions.some(m => m.id === r.missionId && ['executed', 'aborted'].includes(m.status)));
}
export function validatePhysicalIntel(i: PhysicalIntel, s: WarSimSession) {
  if (i.version !== 1 || !Number.isSafeInteger(i.sequence) || i.sequence < 0
    || ![i.observations, i.tracks, i.links, i.messages, i.sensors, i.tasks, i.coverage, i.missions, i.reservations].every(Array.isArray))
    throw new Error('Invalid intelligence checkpoint.');
  for (const t of i.tracks) if (!t.id || !t.scopeId || !Array.isArray(t.evidenceIds) || !Array.isArray(t.position)
    || t.position.length !== 3 || t.uncertaintyM < 0 || t.confidence < 0 || t.confidence > 1) throw new Error('Invalid contact track.');
  for (const sensor of i.sensors) if (!s.physical!.actors.some(a => a.id === sensor.actorId) || sensor.sensorTime < 0) throw new Error('Invalid sensor state.');
  const commitments = new Set<string>();
  for (const r of i.reservations) {
    const mission = i.missions.find(m => m.id === r.missionId);
    const actor = s.physical!.actors.find(a => a.id === r.assetId);
    const key = `${r.missionId}:${r.resource}`;
    if (!Number.isSafeInteger(r.quantity) || r.quantity !== 1 || !mission || !actor || ['executed', 'aborted'].includes(mission.status)
      || r.assetId !== (r.resource === 'strike-round' ? mission.shooterId : mission.supportId)
      || !Number.isSafeInteger(r.expiresTick) || r.expiresTick <= mission.createdTick || commitments.has(key)) throw new Error('Invalid resource reservation.');
    commitments.add(key);
  }
  for (const m of i.missions) {
    if (!Number.isSafeInteger(m.createdTick) || m.notBeforeTick !== undefined && (!Number.isSafeInteger(m.notBeforeTick) || m.notBeforeTick < m.createdTick))
      throw new Error('Invalid queued mission.');
    if (!['executed', 'aborted'].includes(m.status) && (!commitments.has(`${m.id}:strike-round`) || !commitments.has(`${m.id}:sensor-channel`)))
      throw new Error('Mission has incomplete reservations.');
  }
  for (const actor of s.physical!.actors) {
    const rounds = i.reservations.filter(r => r.assetId === actor.id && r.resource === 'strike-round').reduce((n, r) => n + r.quantity, 0);
    const channels = i.reservations.filter(r => r.assetId === actor.id && r.resource === 'sensor-channel').reduce((n, r) => n + r.quantity, 0);
    if (rounds > actor.rounds || channels > 1) throw new Error('Resources are overcommitted.');
  }
}
