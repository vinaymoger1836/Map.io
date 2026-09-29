import type { WarSimSession } from '../../warSimTypes';
import type { PhysicalActor, PhysicalEncounter, PhysicalRound, PhysicalEvent } from './types';
import { add, sub, scale, length, unit, dot, fromENU, sweptSphere, type Vec3 } from './coordinates';
import { acquireSeeker, currentTrack, effectiveConfidence, ensurePhysicalIntel, hq, local, missionSupport, observedContacts,
  runPhysicalIntelligence, expireReservations, scopeTracks, validatePhysicalIntel, type IntelTrack } from '../intelligence';
import { CAPABILITIES, condition, damageActor, operational, stepPhysicalRepairs } from './readiness';
import { sampleSurface, seaSpeedFactor, validateEnvironment } from './environment';
import { validateOpposition } from '../opposition';

// Fictional reference profile; SI units. No calibration to real equipment.
export const PROFILE = Object.freeze({ mass: 180, thrust: 7800, burnSec: 12, dragArea: .035,
  maxNormalAcceleration: 95, lifetimeSec: 45, damage: 55, sensorRange: 9000, substep: .02 });
export function integrate(position: Vec3, velocity: Vec3, acceleration: Vec3, dt: number) {
  return { position: add(position, add(scale(velocity, dt), scale(acceleration, .5 * dt * dt))), velocity: add(velocity, scale(acceleration, dt)) };
}
function event(s: WarSimSession, kind: PhysicalEvent['kind'], round: PhysicalRound, time: number, interceptedId?: string) {
  const p = s.physical!;
  const i = ensurePhysicalIntel(s);
  const visibleTo = new Set<string>();
  const deliveries = new Map<string, NonNullable<PhysicalEvent['deliveries']>[number]>();
  const schedule = (scopeId: string, path: string[], tick: number) => {
    for (const link of i.links.filter(l => l.from === scopeId && l.active)) {
      const nextPath = [...path, link.id], due = tick + link.latencyTicks;
      const prior = deliveries.get(link.to);
      if (visibleTo.has(link.to) || prior && prior.deliveryTick <= due) continue;
      deliveries.set(link.to, { scopeId: link.to, linkIds: nextPath, deliveryTick: due });
      schedule(link.to, nextPath, due);
    }
  };
  for (const a of p.actors) {
    if (a.health <= 0) continue;
    const direct = length(sub(a.position, round.position)) <= 1200;
    const sensed = scopeTracks(i, local(a.id)).some(t => t.targetRef === round.id && t.state === 'fresh');
    if (a.iso === round.iso && a.id === round.shooterId || direct || sensed) {
      visibleTo.add(local(a.id));
    }
  }
  if (kind === 'launch' && round.sourceScope) visibleTo.add(round.sourceScope);
  const tick = Math.round(time * 10);
  for (const scopeId of visibleTo) schedule(scopeId, [], tick);
  p.events.push({ id: ++p.sequence, time, kind, roundId: round.id, position: [...round.position], visibleTo: [...visibleTo],
    terminatedRoundIds: kind === 'launch' ? [] : interceptedId ? [round.id, interceptedId] : [round.id], deliveries: [...deliveries.values()] });
  if (kind !== 'launch') for (const mission of i.missions) if (mission.firedRoundId === round.id || mission.firedRoundId === interceptedId) {
    mission.outcome = mission.firedRoundId === interceptedId ? 'intercept' : kind; mission.completedTick = tick;
  }
  p.events = p.events.slice(-256);
  publishPhysicalEvent(s, p.events.at(-1)!);
}
function publishPhysicalEvent(s: WarSimSession, event: PhysicalEvent) {
  for (const iso of [s.playerIso, s.enemyIso]) {
    if (!event.visibleTo.includes(hq(iso)) || s.eventLog.some(e => e.id === `physical-${event.id}-${iso}`)) continue;
    s.eventLog.push({ id: `physical-${event.id}-${iso}`, simTimeSec: event.time,
      timeFormatted: `T+${event.time.toFixed(1)}`, faction: iso === s.playerIso ? 'player' : 'enemy',
      type: event.kind === 'expired' || event.kind === 'splash' ? 'alert' : event.kind, title: `Reference weapon ${event.kind}`,
      detail: 'Synthetic point-mass encounter', lngLat: fromENU(event.position, s.physical!.origin).slice(0, 2) as [number, number] });
  }
  s.eventLog = s.eventLog.slice(-512);
}
function deliverPhysicalEvents(s: WarSimSession, tick: number) {
  const i = ensurePhysicalIntel(s);
  for (const event of s.physical!.events) {
    for (const delivery of event.deliveries ?? []) {
      if (delivery.deliveryTick > tick) continue;
      if (!delivery.linkIds.every(id => i.links.some(link => link.id === id && link.active))) continue;
      const finalLink = i.links.find(link => link.id === delivery.linkIds.at(-1));
      if (finalLink && !event.visibleTo.includes(finalLink.from)) continue;
      if (!event.visibleTo.includes(delivery.scopeId)) event.visibleTo.push(delivery.scopeId);
    }
    event.deliveries = event.deliveries?.filter(d => d.deliveryTick > tick);
    publishPhysicalEvent(s, event);
  }
}
function launch(s: WarSimSession, shooter: PhysicalActor, target: PhysicalActor | PhysicalRound, interceptor: boolean, time: number,
  track: IntelTrack, scopeId: string) {
  const p = s.physical!;
  const direction = unit(sub(track.position, shooter.position));
  const round: PhysicalRound = { id: `round-${++p.sequence}`, shooterId: shooter.id, iso: shooter.iso,
    targetId: target.id, interceptor, position: add(shooter.position, [0, 0, 18]), launchPosition: add(shooter.position, [0, 0, 18]),
    velocity: add(scale(direction, interceptor ? 260 : 160), [0, 0, 45]), age: 0,
    sourceScope: scopeId, aimPosition: [...track.position], aimVelocity: [...track.velocity], aimObservedTick: track.observedTick,
    trackRevision: track.revision };
  if (interceptor) shooter.interceptors--; else shooter.rounds--;
  shooter.cooldown = time + 1.5;
  p.rounds.push(round);
  event(s, 'launch', round, time);
}
export function launchPhysical(s: WarSimSession, shooterId: string, trackId: string, revision?: number): WarSimSession {
  const p = s.physical;
  if (!p) throw new Error('Open the physical reference encounter to use this order.');
  const i = ensurePhysicalIntel(s), tick = Math.round(s.simTimeSec * 10);
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const scopeId = s.observerScope ?? hq(iso);
  const a = p.actors.find(a => a.id === shooterId && a.iso === iso && a.health > 0);
  const track = currentTrack(i, scopeId, trackId, tick);
  const b = p.actors.find(b => b.id === track?.targetRef && b.iso !== iso);
  if (!a || !b || !track || effectiveConfidence(track, tick) < .3 || revision !== undefined && track.revision !== revision
    || length(sub(a.position, track.position)) > PROFILE.sensorRange) throw new Error('A current scoped contact within 9 km is required.');
  if (b.domain === 'subsurface' || b.domain === 'space') throw new Error('This surface round cannot engage a submerged or orbital target.');
  const reserved = i.reservations.filter(r => r.assetId === shooterId && r.resource === 'strike-round').length;
  if (!operational(a, 'strikeLauncher')) throw new Error('Strike launcher is damaged and unavailable.');
  if (a.rounds - reserved < 1 || a.cooldown > s.simTimeSec) throw new Error('Launcher is reloading or its unreserved magazine is empty.');
  launch(s, a, b, false, s.simTimeSec, track, scopeId);
  syncPhysical(s);
  return s;
}
export function setPhysicalCourse(s: WarSimSession, id: string, heading: number, speed: number) {
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const a = s.physical?.actors.find(a => a.id === id && a.iso === iso && a.health > 0);
  const maximum = a?.domain === 'air' ? 120 : a?.domain === 'subsurface' ? 8
    : a?.domain === 'land' ? a.groundMobility === 'tracked' ? 12 : 0 : a?.domain === 'space' ? 0 : 16;
  if (!a || !Number.isFinite(heading) || !Number.isFinite(speed) || speed < 0 || speed > maximum)
    throw new Error(`Select an available platform; speed must be 0–${maximum} m/s.`);
  if (a.repairJob && speed > 0) throw new Error('Cancel or finish repairs before getting under way.');
  if (speed > 0 && !operational(a, 'propulsion')) throw new Error('Propulsion is damaged and unavailable.');
  a.course = ((heading % 360) + 360) % 360; a.desiredSpeed = speed;
  return s;
}
/** Authoritative 100 ms step split into five bounded physical substeps. */
export function stepPhysical(s: WarSimSession, dt: number): WarSimSession {
  const p = s.physical!;
  const i = ensurePhysicalIntel(s), tick = Math.round(s.simTimeSec * 10);
  runPhysicalIntelligence(s, tick);
  deliverPhysicalEvents(s, tick);
  expireReservations(i, tick);
  stepPhysicalRepairs(p.actors, dt);
  for (const m of i.missions) {
    if (['executed', 'aborted'].includes(m.status)) continue;
    const a = p.actors.find(a => a.id === m.shooterId && a.health > 0);
    const b = p.actors.find(b => b.id === m.targetRef);
    const support = p.actors.find(a => a.id === m.supportId && a.health > 0);
    const track = currentTrack(i, m.scopeId, m.trackId, tick);
    if (!a || !b || b.health <= 0) {
      m.status = 'aborted'; m.reason = !a ? 'Shooter unavailable' : 'Target no longer available';
      i.reservations = i.reservations.filter(r => r.missionId !== m.id); continue;
    }
    const available = Boolean(operational(a, 'strikeLauncher') && a.rounds > 0 && support && operational(support, 'sensor') && track && tick - track.observedTick <= 15
      && effectiveConfidence(track, tick) >= .5 && missionSupport(i, m, tick));
    if (!available) {
      const ownTrack = i.tracks.find(t => t.scopeId === local(m.shooterId) && t.targetRef === m.targetRef && t.state === 'fresh');
      if (m.onLoss === 'continue-local' && operational(a, 'strikeLauncher') && b && ownTrack
        && tick >= (m.notBeforeTick ?? tick) && a.cooldown <= s.simTimeSec) {
        const before = p.rounds.length;
        launch(s, a, b, false, s.simTimeSec, ownTrack, local(a.id));
        m.firedRoundId = p.rounds[before]?.id; m.status = 'executed'; m.reason = 'Fired on the shooter’s local track after support loss';
        i.reservations = i.reservations.filter(r => r.missionId !== m.id);
        continue;
      }
      if (m.onLoss === 'abort') { m.status = 'aborted'; m.reason = 'Required support lost'; i.reservations = i.reservations.filter(r => r.missionId !== m.id); }
      else { m.status = 'held'; m.reason = 'Required support or current track unavailable'; }
      continue;
    }
    if (m.status === 'held' || m.status === 'awaiting-support') { m.status = 'ready'; m.readyTick = tick + 2; m.reason = 'Support acknowledged; fire queued'; }
    if (m.status === 'ready' && tick >= Math.max(m.readyTick ?? tick, m.notBeforeTick ?? tick) && a!.cooldown <= s.simTimeSec) {
      const before = p.rounds.length;
      launch(s, a!, b!, false, s.simTimeSec, track!, m.scopeId);
      m.firedRoundId = p.rounds[before]?.id; m.status = 'executed'; m.reason = 'Coordinated strike launched';
      i.reservations = i.reservations.filter(r => r.missionId !== m.id);
    }
  }
  const seeker = new Map(p.rounds.map(r => [r.id, acquireSeeker(s, r.id, tick)]));
  const count = Math.ceil(dt / PROFILE.substep), h = dt / count;
  for (let step = 0; step < count; step++) {
    const time = s.simTimeSec + step * h;
    for (const a of p.actors) {
      if (!operational(a, 'pointDefense') || a.cooldown > time || a.interceptors <= 0) continue;
      const threatTrack = scopeTracks(i, local(a.id)).find(t => t.domain === 'missile' && t.state === 'fresh'
        && length(sub(t.position, a.position)) < 1800 && p.rounds.some(r => r.id === t.targetRef && r.iso !== a.iso)
        && !p.rounds.some(r => r.interceptor && r.targetId === t.targetRef && r.iso === a.iso));
      const threat = p.rounds.find(r => r.id === threatTrack?.targetRef);
      if (threat && threatTrack) launch(s, a, threat, true, time, threatTrack, local(a.id));
    }
    const starts = new Map<string, Vec3>([...p.actors, ...p.rounds].map(a => [a.id, [...a.position]]));
    for (const a of p.actors) {
      if (a.health <= 0) { a.velocity = [0, 0, 0]; continue; }
      const turn = ((a.course - a.heading + 540) % 360) - 180;
      const air = a.domain === 'air', ground = a.domain === 'land';
      const fixed = a.domain === 'space' || ground && a.groundMobility !== 'tracked';
      const maxSpeed = air ? 120 : fixed ? 0 : ground ? 12 : a.domain === 'subsurface' ? 8 : 16 * seaSpeedFactor(p.environment);
      a.heading += Math.max(-(air ? 8 : 2) * h, Math.min((air ? 8 : 2) * h, turn));
      const desired = a.fuel > 0 && operational(a, 'propulsion') ? Math.min(a.desiredSpeed, maxSpeed * condition(a, 'propulsion') / 100) : 0;
      a.speed += Math.max(-.8 * h, Math.min(.4 * h, desired - a.speed));
      const wind = air ? p.environment?.weather : undefined;
      a.velocity = [Math.sin(a.heading * Math.PI / 180) * a.speed + (wind?.windEastMps ?? 0),
        Math.cos(a.heading * Math.PI / 180) * a.speed + (wind?.windNorthMps ?? 0), 0];
      const candidate = add(a.position, scale(a.velocity, h));
      if (ground && p.environment) {
        const surface = sampleSurface(p.environment, candidate[0], candidate[1]);
        if (surface.status === 'land' && Math.abs(surface.elevationM + 2 - a.position[2]) <= Math.max(1, a.speed * h * .2)) {
          candidate[2] = surface.elevationM + 2; a.position = candidate;
        } else { a.speed = 0; a.desiredSpeed = 0; a.velocity = [0, 0, 0]; }
      } else a.position = candidate;
      a.fuel = Math.max(0, a.fuel - a.speed * h / 10000);
    }
    for (const r of p.rounds) {
      const speed = length(r.velocity), forward = unit(r.velocity);
      let normal: Vec3 = [0, 0, 0];
      const ownTrack = seeker.get(r.id);
      const remote = r.sourceScope ? i.tracks.find(t => t.scopeId === r.sourceScope && t.targetRef === r.targetId && t.state !== 'lost') : undefined;
      const remoteLink = r.sourceScope?.endsWith(':hq') ? i.links.some(l => l.from === local(r.shooterId) && l.active) : true;
      if (ownTrack) { r.seekerLocked = true; r.aimPosition = [...ownTrack.position]; r.aimVelocity = [...ownTrack.velocity]; r.aimObservedTick = ownTrack.observedTick; }
      else if (remote && remoteLink && remote.revision !== r.trackRevision) {
        r.aimPosition = [...remote.position]; r.aimVelocity = [...remote.velocity]; r.aimObservedTick = remote.observedTick; r.trackRevision = remote.revision;
      }
      if (r.aimPosition) {
        const estimate = add(r.aimPosition, scale(r.aimVelocity ?? [0, 0, 0], Math.max(0, tick - (r.aimObservedTick ?? tick)) / 10));
        const distance = length(sub(estimate, r.position));
        const closing = -dot(r.aimVelocity ?? [0, 0, 0], unit(sub(estimate, r.position)));
        const aim = add(estimate, scale(r.aimVelocity ?? [0, 0, 0], Math.min(4, distance / Math.max(100, speed + closing))));
        if (!r.interceptor) aim[2] = distance > 300 ? 40 : 10;
        // Steering uses only a received track or the round's own seeker estimate.
        const desired = scale(unit(sub(aim, r.position)), speed);
        const error = add(scale(sub(desired, r.velocity), 3), [0, 0, 9.80665]);
        normal = sub(error, scale(forward, dot(error, forward)));
        normal = scale(normal, Math.min(1, PROFILE.maxNormalAcceleration / (length(normal) || 1)));
      }
      const thrust = r.age < PROFILE.burnSec ? PROFILE.thrust / PROFILE.mass : 0;
      const drag = .5 * 1.225 * PROFILE.dragArea * speed * speed / PROFILE.mass;
      const acceleration = add(add(scale(forward, thrust - drag), normal), [0, 0, -9.80665]);
      Object.assign(r, integrate(r.position, r.velocity, acceleration, h)); r.age += h;
    }
    // Resolve interactions globally by time of first contact; an intercepted round cannot impact later in this substep.
    const hits: { fraction: number; round: PhysicalRound; target?: PhysicalActor | PhysicalRound; kind: PhysicalEvent['kind'] }[] = [];
    for (const r of p.rounds) {
      const candidates = r.interceptor ? p.rounds.filter(t => t.id === r.targetId)
        : p.actors.filter(a => a.iso !== r.iso && a.health > 0 && a.domain !== 'subsurface' && a.domain !== 'space');
      for (const t of candidates) {
        const fraction = sweptSphere(starts.get(r.id)!, r.position, starts.get(t.id)!, t.position, r.interceptor ? 14 : 32);
        if (fraction !== null) hits.push({ fraction, round: r, target: t, kind: r.interceptor ? 'intercept' : 'impact' });
      }
      const start = starts.get(r.id)!;
      if (r.position[2] <= 0) hits.push({ fraction: Math.max(0, Math.min(1, start[2] / (start[2] - r.position[2] || 1))), round: r, kind: 'splash' });
      if (r.age >= PROFILE.lifetimeSec) hits.push({ fraction: 1, round: r, kind: 'expired' });
    }
    hits.sort((a, b) => a.fraction - b.fraction || a.round.id.localeCompare(b.round.id));
    const dead = new Set<string>();
    for (const hit of hits) {
      const r = hit.round;
      if (dead.has(r.id) || (hit.target && dead.has(hit.target.id))) continue;
      if (hit.target && 'health' in hit.target && hit.target.health <= 0) continue;
      r.position = add(starts.get(r.id)!, scale(sub(r.position, starts.get(r.id)!), hit.fraction));
      dead.add(r.id);
      if (hit.target) {
        if ('health' in hit.target) {
          const impactNumber = Number.parseInt(r.id.replace(/^round-/, ''), 10);
          damageActor(hit.target, PROFILE.damage, CAPABILITIES[(Number.isFinite(impactNumber) ? impactNumber : 0) % CAPABILITIES.length]);
        }
        else dead.add(hit.target.id);
      }
      event(s, hit.kind, r, time + hit.fraction * h, hit.kind === 'intercept' ? hit.target?.id : undefined);
    }
    p.rounds = p.rounds.filter(r => !dead.has(r.id));
  }
  syncPhysical(s, s.simTimeSec + dt);
  return s;
}
export function syncPhysical(s: WarSimSession, time = s.simTimeSec) {
  const p = s.physical!;
  for (const a of p.actors) {
    const e = s.entities.find(e => e.id === a.id)!;
    const geo = fromENU(a.position, p.origin);
    e.lngLat = [geo[0], geo[1]]; e.altitudeM = geo[2]; e.headingDeg = a.heading; e.speedKmh = a.speed * 3.6;
    e.currentFuelPct = a.fuel; e.magazines = { 0: a.rounds, 1: a.interceptors };
    e.status = a.health <= 0 ? 'destroyed' : a.repairJob ? 'in_repair' : 'on_station';
    e.damage = a.health <= 0 ? 'destroyed' : a.health < 100 || CAPABILITIES.some(key => condition(a, key) < 100) ? 'damaged' : 'intact';
    e.repairTimerSec = a.repairJob?.remainingSec ?? 0;
  }
  const tick = Math.round(time * 10);
  s.fogOfWarContacts.playerContacts = observedContacts(s, hq(s.playerIso), tick);
  s.fogOfWarContacts.enemyContacts = observedContacts(s, hq(s.enemyIso), tick);
  s.activeMissiles = p.rounds.map(r => {
    const shooter = p.actors.find(a => a.id === r.shooterId)!;
    const target = [...p.actors, ...p.rounds].find(a => a.id === r.targetId);
    const point = (v: Vec3) => fromENU(v, p.origin).slice(0, 2) as [number, number];
    return { id: r.id, originLngLat: point(r.launchPosition), targetLngLat: point(target?.position ?? r.position), currentLngLat: point(r.position),
      attackerEntityId: shooter.id, targetEntityId: r.targetId, attackerIso: r.iso, targetIso: target?.iso ?? '',
      weaponName: 'Reference guided round', weaponCategory: r.interceptor ? 'sam' : 'cruise', speedKmh: length(r.velocity) * 3.6,
      startSimTimeSec: time - r.age, etaSimTimeSec: time + 10, isIntercepted: false, progress: Math.min(.99, r.age / PROFILE.lifetimeSec), threatAltitudeM: r.position[2] };
  });
}
export function validatePhysical(p: PhysicalEncounter, s: WarSimSession) {
  if (p.version !== 1 || p.model !== 'coastal-pointmass-v1' || !Number.isSafeInteger(p.sequence) || p.sequence < 0
    || p.origin.length !== 3 || Math.abs(p.origin[0]) > 180 || Math.abs(p.origin[1]) > 89) throw new Error('Unsupported physical encounter.');
  const ids = new Set<string>();
  for (const a of [...p.actors, ...p.rounds]) {
    if (ids.has(a.id) || a.position.length !== 3 || a.velocity.length !== 3 || length(a.position) > 100000) throw new Error('Invalid physical body.');
    ids.add(a.id);
  }
  for (const a of p.actors) if (!s.entities.some(e => e.id === a.id && e.iso === a.iso) || a.health < 0 || a.health > 100
    || a.fuel < 0 || a.fuel > 100 || a.desiredSpeed < 0
    || a.desiredSpeed > (a.domain === 'air' ? 120 : a.domain === 'subsurface' ? 8
      : a.domain === 'land' ? a.groundMobility === 'tracked' ? 12 : 0 : a.domain === 'space' ? 0 : 16)
    || !Number.isSafeInteger(a.rounds) || a.rounds < 0
    || !Number.isSafeInteger(a.interceptors) || a.interceptors < 0) throw new Error('Invalid physical platform.');
  for (const a of p.actors) {
    if (a.domain && !['sea', 'air', 'land', 'subsurface', 'space'].includes(a.domain)
      || a.groundMobility && (a.domain !== 'land' || !['fixed', 'tracked'].includes(a.groundMobility))
      || a.condition && CAPABILITIES.some(key => !Number.isFinite(a.condition![key]) || a.condition![key] < 0 || a.condition![key] > 100)
      || a.repairKits !== undefined && (!Number.isSafeInteger(a.repairKits) || a.repairKits < 0)
      || a.repairJob && (!CAPABILITIES.includes(a.repairJob.capability) || !Number.isFinite(a.repairJob.remainingSec)
        || a.repairJob.remainingSec <= 0 || a.repairJob.remainingSec > 30 || a.health <= 0)) throw new Error('Invalid physical repair state.');
  }
  for (const r of p.rounds) if (!p.actors.some(a => a.id === r.shooterId && a.iso === r.iso) || r.age < 0) throw new Error('Invalid physical round.');
  if (p.environment) validateEnvironment(p.environment);
  validateOpposition(s);
  if (p.intel) validatePhysicalIntel(p.intel, s);
}
