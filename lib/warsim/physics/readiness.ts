import type { WarSimSession } from '../../warSimTypes';
import type { PhysicalActor } from './types';

export type Capability = keyof NonNullable<PhysicalActor['condition']>;
export const CAPABILITIES: Capability[] = ['propulsion', 'sensor', 'strikeLauncher', 'pointDefense'];
export const condition = (actor: PhysicalActor, capability: Capability) => actor.condition?.[capability] ?? 100;
export const operational = (actor: PhysicalActor, capability: Capability) => actor.health > 0 && condition(actor, capability) >= 30;

/** A hit damages one system in a repeatable order. Repair progress and expended kits persist in the save. */
export function damageActor(actor: PhysicalActor, amount: number, damagedCapability?: Capability) {
  if (actor.health <= 0 || amount <= 0) return;
  actor.condition ??= { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 };
  const capability = damagedCapability ?? CAPABILITIES[(actor.damageHits ?? 0) % CAPABILITIES.length];
  actor.damageHits = (actor.damageHits ?? 0) + 1;
  actor.condition[capability] = Math.max(0, actor.condition[capability] - amount * 1.4);
  actor.health = Math.max(0, actor.health - amount);
  actor.repairJob = undefined; // An impact interrupts work already in progress; its kit was consumed at start.
  if (actor.health === 0) for (const key of CAPABILITIES) actor.condition[key] = 0;
}

export function startPhysicalRepair(s: WarSimSession, actorId: string, capability: Capability) {
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const actor = s.physical?.actors.find(a => a.id === actorId && a.iso === iso);
  if (!actor || !CAPABILITIES.includes(capability) || actor.health <= 0) throw new Error('Select a surviving friendly platform and repairable capability.');
  if (actor.repairJob) throw new Error('A repair is already in progress on this platform.');
  if (actor.speed > .5 || actor.desiredSpeed > .5) throw new Error('Stop the platform before starting repairs.');
  if (condition(actor, capability) >= 100) throw new Error('That capability is already intact.');
  if ((actor.repairKits ?? 0) < 1) throw new Error('No repair kits remain on this platform.');
  actor.repairKits!--; // A kit is opened at acceptance; cancelling retains completed work but cannot return it.
  actor.repairJob = { capability, remainingSec: 30 };
  return s;
}

export function cancelPhysicalRepair(s: WarSimSession, actorId: string) {
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const actor = s.physical?.actors.find(a => a.id === actorId && a.iso === iso);
  if (!actor?.repairJob) throw new Error('No active friendly repair to cancel.');
  actor.repairJob = undefined;
  return s;
}

export function stepPhysicalRepairs(actors: PhysicalActor[], dt: number) {
  for (const actor of actors) {
    const job = actor.repairJob;
    if (!job) continue;
    if (actor.health <= 0) { actor.repairJob = undefined; continue; }
    if (actor.speed > .5 || actor.desiredSpeed > .5) continue;
    const elapsed = Math.min(dt, job.remainingSec);
    actor.condition ??= { propulsion: 100, sensor: 100, strikeLauncher: 100, pointDefense: 100 };
    actor.condition[job.capability] = Math.min(100, actor.condition[job.capability] + elapsed * (60 / 30));
    actor.health = Math.min(100, actor.health + elapsed * (10 / 30));
    job.remainingSec = Math.max(0, job.remainingSec - elapsed);
    if (job.remainingSec === 0 || actor.condition[job.capability] === 100) actor.repairJob = undefined;
  }
}
