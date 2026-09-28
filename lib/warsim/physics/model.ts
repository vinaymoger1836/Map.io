import type { WarSimSession } from '../../warSimTypes';
import type { PhysicalActor, PhysicalEncounter, PhysicalRound, PhysicalEvent } from './types';
import { add, sub, scale, length, unit, dot, fromENU, sweptSphere, type Vec3 } from './coordinates';

// Fictional reference profile; SI units. No calibration to real equipment.
export const PROFILE = Object.freeze({ mass: 180, thrust: 7800, burnSec: 12, dragArea: .035,
  maxNormalAcceleration: 95, lifetimeSec: 45, damage: 55, sensorRange: 9000, substep: .02 });
export function integrate(position: Vec3, velocity: Vec3, acceleration: Vec3, dt: number) {
  return { position: add(position, add(scale(velocity, dt), scale(acceleration, .5 * dt * dt))), velocity: add(velocity, scale(acceleration, dt)) };
}
function event(s: WarSimSession, kind: PhysicalEvent['kind'], round: PhysicalRound, time: number) {
  const p = s.physical!;
  const visibleTo = [...new Set(p.actors.filter(a => a.health > 0 && length(sub(a.position, round.position)) <= PROFILE.sensorRange).map(a => a.iso))];
  if (!visibleTo.includes(round.iso)) visibleTo.push(round.iso);
  p.events.push({ id: ++p.sequence, time, kind, roundId: round.id, position: [...round.position], visibleTo });
  p.events = p.events.slice(-256);
  for (const iso of visibleTo) s.eventLog.push({ id: `physical-${p.sequence}-${iso}`, simTimeSec: time,
    timeFormatted: `T+${time.toFixed(1)}`, faction: iso === s.playerIso ? 'player' : 'enemy',
    type: kind === 'expired' ? 'alert' : kind, title: `Reference weapon ${kind}`, detail: 'Synthetic point-mass encounter',
    lngLat: fromENU(round.position, p.origin).slice(0, 2) as [number, number] });
  s.eventLog = s.eventLog.slice(-512);
}
function launch(s: WarSimSession, shooter: PhysicalActor, target: PhysicalActor | PhysicalRound, interceptor: boolean, time: number) {
  const p = s.physical!;
  const direction = unit(sub(target.position, shooter.position));
  const round: PhysicalRound = { id: `round-${++p.sequence}`, shooterId: shooter.id, iso: shooter.iso,
    targetId: target.id, interceptor, position: add(shooter.position, [0, 0, 18]),
    velocity: add(scale(direction, interceptor ? 260 : 160), [0, 0, 45]), age: 0 };
  if (interceptor) shooter.interceptors--; else shooter.rounds--;
  shooter.cooldown = time + 1.5;
  p.rounds.push(round);
  event(s, 'launch', round, time);
}
export function launchPhysical(s: WarSimSession, shooterId: string, targetId: string): WarSimSession {
  const p = s.physical;
  if (!p) throw new Error('Open the physical reference encounter to use this order.');
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const a = p.actors.find(a => a.id === shooterId && a.iso === iso && a.health > 0);
  const b = p.actors.find(a => a.id === targetId && a.iso !== iso && a.health > 0);
  const contacts = s.activeFaction === 'player' ? s.fogOfWarContacts.playerContacts : s.fogOfWarContacts.enemyContacts;
  if (!a || !b || !contacts.some(c => c.targetEntityId === b.id) || length(sub(a.position, b.position)) > PROFILE.sensorRange) throw new Error('A current contact within 9 km is required.');
  if (a.rounds < 1 || a.cooldown > s.simTimeSec) throw new Error('Launcher is reloading or its magazine is empty.');
  launch(s, a, b, false, s.simTimeSec);
  syncPhysical(s);
  return s;
}
export function setPhysicalCourse(s: WarSimSession, id: string, heading: number, speed: number) {
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const a = s.physical?.actors.find(a => a.id === id && a.iso === iso && a.health > 0);
  if (!a || !Number.isFinite(heading) || !Number.isFinite(speed) || speed < 0 || speed > 16) throw new Error('Select an available vessel; speed must be 0–16 m/s.');
  a.course = ((heading % 360) + 360) % 360; a.desiredSpeed = speed;
  return s;
}
/** Authoritative 100 ms step split into five bounded physical substeps. */
export function stepPhysical(s: WarSimSession, dt: number): WarSimSession {
  const p = s.physical!;
  const count = Math.ceil(dt / PROFILE.substep), h = dt / count;
  for (let step = 0; step < count; step++) {
    const time = s.simTimeSec + step * h;
    for (const a of p.actors) {
      if (a.health <= 0 || a.cooldown > time || a.interceptors <= 0) continue;
      const threat = p.rounds.find(r => !r.interceptor && r.iso !== a.iso && length(sub(r.position, a.position)) < 1800
        && !p.rounds.some(i => i.interceptor && i.targetId === r.id && i.iso === a.iso));
      if (threat) launch(s, a, threat, true, time);
    }
    const starts = new Map<string, Vec3>([...p.actors, ...p.rounds].map(a => [a.id, [...a.position]]));
    for (const a of p.actors) {
      if (a.health <= 0) { a.velocity = [0, 0, 0]; continue; }
      const turn = ((a.course - a.heading + 540) % 360) - 180;
      a.heading += Math.max(-2 * h, Math.min(2 * h, turn));
      const desired = a.fuel > 0 ? a.desiredSpeed : 0;
      a.speed += Math.max(-.8 * h, Math.min(.4 * h, desired - a.speed));
      a.velocity = [Math.sin(a.heading * Math.PI / 180) * a.speed, Math.cos(a.heading * Math.PI / 180) * a.speed, 0];
      a.position = add(a.position, scale(a.velocity, h));
      a.fuel = Math.max(0, a.fuel - a.speed * h / 10000);
    }
    for (const r of p.rounds) {
      const target = r.interceptor ? p.rounds.find(t => t.id === r.targetId) : p.actors.find(a => a.id === r.targetId && a.health > 0);
      const speed = length(r.velocity), forward = unit(r.velocity);
      let normal: Vec3 = [0, 0, 0];
      if (target && length(sub(target.position, r.position)) <= PROFILE.sensorRange) {
        const distance = length(sub(target.position, r.position));
        const aim = add(target.position, scale(target.velocity, Math.min(4, distance / Math.max(100, speed))));
        // Terminal seeker: finite acceleration, finite range, perfect measurement in this reference only.
        const desired = scale(unit(sub(aim, r.position)), speed);
        const error = scale(sub(desired, r.velocity), 3);
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
      const candidates = r.interceptor ? p.rounds.filter(t => t.id === r.targetId) : p.actors.filter(a => a.iso !== r.iso && a.health > 0);
      for (const t of candidates) {
        const fraction = sweptSphere(starts.get(r.id)!, r.position, starts.get(t.id)!, t.position, r.interceptor ? 14 : 32);
        if (fraction !== null) hits.push({ fraction, round: r, target: t, kind: r.interceptor ? 'intercept' : 'impact' });
      }
      const start = starts.get(r.id)!;
      if (r.position[2] <= 0) hits.push({ fraction: Math.max(0, Math.min(1, start[2] / (start[2] - r.position[2] || 1))), round: r, kind: 'impact' });
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
        if ('health' in hit.target) hit.target.health = Math.max(0, hit.target.health - PROFILE.damage);
        else dead.add(hit.target.id);
      }
      event(s, hit.kind, r, time + hit.fraction * h);
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
    e.status = a.health <= 0 ? 'destroyed' : 'on_station'; e.damage = a.health <= 0 ? 'destroyed' : a.health < 100 ? 'damaged' : 'intact';
  }
  for (const faction of ['player', 'enemy'] as const) {
    const iso = faction === 'player' ? s.playerIso : s.enemyIso;
    const friends = p.actors.filter(a => a.iso === iso && a.health > 0);
    s.fogOfWarContacts[faction === 'player' ? 'playerContacts' : 'enemyContacts'] = p.actors.filter(a => a.iso !== iso && a.health > 0 && friends.some(f => length(sub(a.position, f.position)) <= PROFILE.sensorRange)).map(a => ({
      contactId: `contact-${a.id}`, targetEntityId: a.id, targetIso: a.iso, discoveredByFaction: faction, intelTier: 2,
      domain: 'sea', lastKnownLngLat: fromENU(a.position, p.origin).slice(0, 2) as [number, number], headingDeg: a.heading,
      speedKmh: a.speed * 3.6, lastDetectedSimTimeSec: time, decayTimerSec: 0, knownName: 'Surface contact',
    }));
  }
  s.activeMissiles = p.rounds.map(r => {
    const shooter = p.actors.find(a => a.id === r.shooterId)!;
    const target = [...p.actors, ...p.rounds].find(a => a.id === r.targetId);
    const point = (v: Vec3) => fromENU(v, p.origin).slice(0, 2) as [number, number];
    return { id: r.id, originLngLat: point(shooter.position), targetLngLat: point(target?.position ?? r.position), currentLngLat: point(r.position),
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
    || a.fuel < 0 || a.fuel > 100 || a.desiredSpeed < 0 || a.desiredSpeed > 16 || !Number.isSafeInteger(a.rounds) || a.rounds < 0
    || !Number.isSafeInteger(a.interceptors) || a.interceptors < 0) throw new Error('Invalid physical platform.');
  for (const r of p.rounds) if (!p.actors.some(a => a.id === r.shooterId && a.iso === r.iso) || r.age < 0) throw new Error('Invalid physical round.');
}
