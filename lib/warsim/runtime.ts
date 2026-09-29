import type { WarSimSession } from '../warSimTypes';
import type { SystemSpec } from '../specs';
import { tickWarSim } from '../warSimEngine';
import { commandHandlers } from './commands';
import { seedFromId, withSimulationContext } from './context';
import { MODEL_VERSION, STEP_MS, type CommandEnvelope, type CommandReceipt, type RuntimeCheckpoint } from './contracts';
import { projectObserver } from './projection';
import { stepPhysical, validatePhysical } from './physics/model';
import { coalitionScope, ensurePhysicalIntel, factionScope, hq, local } from './intelligence';
import { decideOpponent, decisionInterval, evaluateObjectives } from './opposition';
import { appendReplayRecord, captureReplayFrame, createReplay, recordReplayOrder, recordVisibleEvents,
  validateReplay } from './replay';

function finiteData(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite numeric input.');
  if (value && typeof value === 'object') for (const item of Object.values(value)) finiteData(item);
}
function validateSession(session: WarSimSession) {
  if (!session || typeof session.id !== 'string' || !session.id || !Number.isFinite(session.simTimeSec) || session.simTimeSec < 0
    || !Array.isArray(session.entities) || !Array.isArray(session.bases) || !Array.isArray(session.activeMissiles)
    || !Array.isArray(session.eventLog) || !session.fogOfWarContacts || !session.personnel || !session.quotas
    || !['player', 'enemy'].includes(session.activeFaction) || !['running', 'paused', 'setup', 'concluded'].includes(session.status)) {
    throw new Error('This save is missing required simulation fields. The original save has been retained.');
  }
  const ids = new Set<string>();
  if (session.physical) {
    validatePhysical(session.physical, session);
    const iso = session.activeFaction === 'player' ? session.playerIso : session.enemyIso;
    if (session.observerScope && ![hq(iso), factionScope(iso), coalitionScope(iso)].includes(session.observerScope)
      && !session.physical.actors.some(a => a.iso === iso && local(a.id) === session.observerScope)) {
      throw new Error('The saved observer scope does not belong to the active faction.');
    }
  }
  for (const e of [...session.entities, ...session.bases]) {
    if (!e.id || ids.has(e.id) || !Array.isArray(e.lngLat) || e.lngLat.length !== 2
      || !e.lngLat.every(Number.isFinite) || Math.abs(e.lngLat[0]) > 180 || Math.abs(e.lngLat[1]) > 90) {
      throw new Error('The save contains an invalid or duplicate platform/base.');
    }
    ids.add(e.id);
  }
}

/** Environment-independent authoritative host, also used by headless tests. */
export class SimulationRuntime {
  private world: WarSimSession;
  private state: RuntimeCheckpoint;
  private receipts: CommandReceipt[] = [];
  private replaySeen = new Set<string>();
  constructor(input: WarSimSession, definitions: SystemSpec[], seed?: number) {
    validateSession(input);
    seed ??= seedFromId(input.id);
    finiteData(input);
    const saved = input.runtime;
    const modelVersion = input.physical?.model ?? MODEL_VERSION;
    if (saved && (saved.schemaVersion !== 1 || saved.modelVersion !== modelVersion || saved.stepMs !== STEP_MS
      || !Number.isSafeInteger(saved.tick) || saved.tick < 0 || !Number.isSafeInteger(saved.nextSequence) || saved.nextSequence < 1
      || !Number.isFinite(saved.originSimTimeSec) || saved.originSimTimeSec < 0
      || Math.abs(input.simTimeSec - (saved.originSimTimeSec + saved.tick * STEP_MS / 1000)) > 1e-6
      || !saved.random || !Number.isSafeInteger(saved.random.idCounter) || saved.random.idCounter < 0
      || !Number.isFinite(saved.random.epochMs)
      || ![saved.random.combat, saved.random.identifiers].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff)
      || !Array.isArray(saved.definitions)
      || !Array.isArray(saved.pendingCommands) || !Array.isArray(saved.acceptedCommands) || !saved.coordination)) {
      throw new Error('Unsupported or damaged runtime checkpoint. The original save has been retained.');
    }
    this.world = structuredClone(input);
    delete this.world.runtime;
    this.state = saved ? structuredClone(saved) : {
      schemaVersion: 1, modelVersion, stepMs: STEP_MS,
      tick: 0, originSimTimeSec: input.simTimeSec,
      random: { combat: seed >>> 0, identifiers: (seed ^ 0x9e3779b9) >>> 0, idCounter: 0, epochMs: 1_800_000_000_000 },
      nextSequence: 1, definitions: structuredClone(definitions), pendingCommands: [], acceptedCommands: [],
      coordination: { observations: [], collectionTasks: [], messages: [], dependencies: [], reservations: [] },
    };
    const coordination = this.state.coordination;
    if (![coordination.observations, coordination.collectionTasks, coordination.messages, coordination.dependencies,
      coordination.reservations].every(Array.isArray)) throw new Error('Invalid coordination checkpoint.');
    if (this.world.physical) {
      const intel = ensurePhysicalIntel(this.world);
      if (coordination.physical && JSON.stringify(coordination.physical) !== JSON.stringify(intel)) throw new Error('Conflicting intelligence checkpoint.');
      coordination.physical ??= intel;
      this.world.physical.intel = coordination.physical;
      this.world.observerScope ??= `${this.world.activeFaction === 'player' ? this.world.playerIso : this.world.enemyIso}:hq`;
      if (this.state.replay) validateReplay(this.state.replay);
      else this.state.replay = createReplay(this.world, this.tick, modelVersion);
      this.replaySeen = new Set(this.state.replay.records.filter(r => r.kind === 'event').map(r => r.sourceId!));
      recordVisibleEvents(this.state.replay, this.world, this.tick, this.replaySeen);
    }
    if (this.state.pendingCommands.some(c => c.version !== 1 || !Number.isSafeInteger(c.sequence) || c.sequence >= this.state.nextSequence
      || c.sequence < 1 || !Number.isSafeInteger(c.executeAtTick) || c.executeAtTick < this.tick
      || !c.scope || !c.command || !Object.hasOwn(commandHandlers, c.command.type))) throw new Error('Invalid queued command checkpoint.');
    if (![1, 3, 5, 10, 30].includes(this.world.timeMultiplier)) this.world.timeMultiplier = 1;
  }
  get tick() { return this.state.tick; }
  get running() { return this.world.status === 'running'; }
  get speed() { return this.world.timeMultiplier; }
  get pendingCount() { return this.state.pendingCommands.length; }
  checkpoint(): WarSimSession { return structuredClone({ ...this.world, runtime: this.state }); }
  observer(): WarSimSession { return projectObserver(this.world); }
  takeReceipts() { return this.receipts.splice(0); }

  submit(envelope: CommandEnvelope) {
    const reject = (reason: string) => {
      this.receipts.push({ sequence: envelope.sequence, tick: this.tick, status: 'rejected', reason });
      recordReplayOrder(this.state.replay, envelope, this.tick, 'rejected', reason);
    };
    if (envelope.version !== 1 || envelope.sequence !== this.state.nextSequence) {
      reject('Command version or sequence does not match the current session.'); return;
    }
    this.state.nextSequence++;
    if (!Number.isSafeInteger(envelope.executeAtTick) || envelope.executeAtTick < this.tick) {
      reject('Command refers to a tick that has already passed.'); return;
    }
    try { finiteData(envelope); }
    catch (error) { reject(String(error)); return; }
    this.state.pendingCommands.push(structuredClone(envelope));
    this.state.pendingCommands.sort((a, b) => a.executeAtTick - b.executeAtTick || a.sequence - b.sequence);
    this.applyDueCommands();
  }

  private validateCommand(envelope: CommandEnvelope, world = this.world) {
    const { command, scope } = envelope;
    const expectedScope = world.physical ? world.observerScope : `${world.activeFaction}:hq`;
    if (!scope || scope.faction !== world.activeFaction || scope.commandGroupId !== expectedScope) {
      throw new Error('The command belongs to a different observer. Select the faction again.');
    }
    if (!Object.hasOwn(commandHandlers, command.type) || !Array.isArray(command.args)) throw new Error('Unknown command.');
    const args = command.args as unknown[];
    if (world.physical && !['setPlayback', 'togglePlay', 'setSpeedMultiplier', 'switchActiveFaction', 'launchPhysical', 'setPhysicalCourse',
      'setObserverScope', 'requestPhysicalCollection', 'setPhysicalEmission', 'setPhysicalLink', 'forwardPhysicalReport',
      'setCoalitionSharing', 'planPhysicalStrike', 'cancelPhysicalMission', 'startPhysicalRepair', 'cancelPhysicalRepair',
      'configureOpponent'].includes(command.type)) {
      throw new Error('This reference encounter does not support that order.');
    }
    const iso = scope.faction === 'player' ? world.playerIso : world.enemyIso;
    const entityCommands = ['orderSortieToPoint', 'orderWaypointPatrol', 'orderRtb', 'orderStrike', 'orderRefuelAtTanker',
      'setEntityRcs', 'assignEntityToNetwork', 'removeEntityFromNetwork', 'orderAsatStrike', 'orderSeadStrike',
      'updateEntityEwMode', 'setEntityThreatLevel', 'orderRearmCarrierAirWing', 'orderLaunchCarrierStrike'];
    if (entityCommands.includes(command.type) && !world.entities.some(e => e.id === args[0] && e.iso === iso && e.status !== 'destroyed')) {
      throw new Error('Select an available platform belonging to this faction.');
    }
    if (['renameBase', 'deployUnitToBase'].includes(command.type) && !world.bases.some(b => b.id === args[0] && b.iso === iso)) {
      throw new Error('The selected base is unavailable to this faction.');
    }
    if (command.type === 'setSpeedMultiplier' && ![1, 3, 5, 10, 30].includes(args[0] as number)) throw new Error('Unsupported simulation speed.');
    if (command.type === 'setPlayback' && !['running', 'paused'].includes(args[0] as string)) throw new Error('Invalid playback state.');
    if (world.physical?.objectives?.status !== undefined && world.physical.objectives.status !== 'ongoing'
      && (command.type === 'togglePlay' || command.type === 'setPlayback' && args[0] === 'running')) {
      throw new Error('The scenario has concluded. Start a new probe to play again.');
    }
    if (command.type === 'setEntityRcs' && (typeof args[1] !== 'number' || args[1] < 0)) throw new Error('RCS must be a nonnegative number.');
    if (command.type === 'setGlobalThreatLevel' && args[0] !== iso) throw new Error('Cannot change the other faction’s orders.');
    const netId = command.type === 'assignEntityToNetwork' ? args[1]
      : ['toggleNetworkOth', 'setNetworkDoctrine'].includes(command.type) ? args[0] : undefined;
    if (netId !== undefined && !world.networks?.some(n => n.id === netId && n.iso === iso)) throw new Error('Network is unavailable to this faction.');
    const count = command.type === 'deployUnitToBase' ? args[2] : command.type === 'deployAutonomousBattery' ? args[1] : undefined;
    if (count !== undefined && (!Number.isSafeInteger(count) || (count as number) <= 0)) throw new Error('Deploy a positive whole number of platforms.');
  }
  private applyDueCommands() {
    while (this.state.pendingCommands[0]?.executeAtTick <= this.tick) {
      const envelope = this.state.pendingCommands.shift()!;
      const randomBefore = { ...this.state.random };
      try {
        this.validateCommand(envelope);
        // Legacy actions can mutate nested arrays. Rejected commands are atomic.
        const draft = structuredClone(this.world);
        const handler = commandHandlers[envelope.command.type] as (s: WarSimSession, d: SystemSpec[], ...args: unknown[]) => WarSimSession | null;
        const next = withSimulationContext(this.state.random, () => handler(draft, this.state.definitions, ...envelope.command.args));
        const idempotent = ['setPlayback', 'setSpeedMultiplier', 'setEntityRcs', 'setAirspaceRoe', 'setEntityThreatLevel', 'setGlobalThreatLevel', 'updateEntityEwMode'];
        if (!next || (!idempotent.includes(envelope.command.type) && JSON.stringify(next) === JSON.stringify(this.world))) {
          throw new Error('Order could not be applied; check readiness, inventory and task parameters.');
        }
        validateSession(next);
        finiteData(next);
        this.world = next;
        if (next.physical?.intel) this.state.coordination.physical = next.physical.intel;
        this.state.acceptedCommands.push({ ...envelope, appliedAtTick: this.tick });
        this.receipts.push({ sequence: envelope.sequence, tick: this.tick, status: 'accepted' });
        recordReplayOrder(this.state.replay, envelope, this.tick, 'accepted');
        recordVisibleEvents(this.state.replay, this.world, this.tick, this.replaySeen);
        if (this.state.replay) captureReplayFrame(this.state.replay, this.world, this.tick, true);
      } catch (error) {
        this.state.random = randomBefore;
        const reason = error instanceof Error ? error.message : String(error);
        this.receipts.push({ sequence: envelope.sequence, tick: this.tick, status: 'rejected', reason });
        recordReplayOrder(this.state.replay, envelope, this.tick, 'rejected', reason);
      }
    }
  }
  private runOpponent() {
    const opposition = this.world.physical?.opposition;
    if (!opposition?.enabled || this.world.physical?.objectives?.status !== 'ongoing' || this.tick < opposition.nextDecisionTick) return;
    const view = projectObserver({ ...this.world, activeFaction: 'enemy', observerScope: hq(this.world.enemyIso) });
    const choice = decideOpponent(view);
    opposition.nextDecisionTick = this.tick + (choice.priority === 'collection' ? 14 : decisionInterval(opposition.difficulty));
    let result: 'accepted' | 'rejected' | 'wait' = choice.command ? 'accepted' : 'wait', rejection: string | undefined;
    if (choice.command) {
      const randomBefore = { ...this.state.random };
      try {
        const draft = structuredClone(this.world), activeFaction = draft.activeFaction, observerScope = draft.observerScope;
        draft.activeFaction = 'enemy'; draft.observerScope = hq(draft.enemyIso);
        const envelope: CommandEnvelope = { version: 1, sequence: 0, executeAtTick: this.tick,
          scope: { faction: 'enemy', commandGroupId: draft.observerScope }, command: choice.command };
        this.validateCommand(envelope, draft);
        const handler = commandHandlers[choice.command.type] as (s: WarSimSession, d: SystemSpec[], ...args: unknown[]) => WarSimSession | null;
        const next = withSimulationContext(this.state.random, () => handler(draft, this.state.definitions, ...choice.command!.args));
        if (!next) throw new Error('Autonomous order was not applied.');
        next.activeFaction = activeFaction; next.observerScope = observerScope;
        validateSession(next); finiteData(next);
        this.world = next;
        if (next.physical?.intel) this.state.coordination.physical = next.physical.intel;
      } catch (error) {
        this.state.random = randomBefore; result = 'rejected'; rejection = error instanceof Error ? error.message : String(error);
      }
    }
    const state = this.world.physical!.opposition!;
    state.decisions.push({ id: ++state.sequence, tick: this.tick, priority: choice.priority, utility: choice.utility,
      reason: choice.reason, command: choice.command, result, rejection });
    state.decisions = state.decisions.slice(-256);
    if (this.state.replay) appendReplayRecord(this.state.replay, { tick: this.tick, faction: 'enemy', kind: 'decision',
      title: choice.priority, detail: `${choice.reason}${rejection ? ` ${rejection}` : ''}`, command: choice.command,
      result });
  }
  step(): boolean {
    this.applyDueCommands();
    if (!this.running) return false;
    if (this.world.physical) this.runOpponent();
    const speed = this.world.timeMultiplier;
    const next = withSimulationContext(this.state.random, () => this.world.physical
      ? stepPhysical(this.world, STEP_MS / 1000)
      : tickWarSim({ ...this.world, timeMultiplier: 1 }, STEP_MS / 1000, this.state.definitions));
    this.state.tick++;
    this.world = { ...next, timeMultiplier: speed, simTimeSec: this.state.originSimTimeSec + this.tick * STEP_MS / 1000 };
    if (this.world.physical) evaluateObjectives(this.world, this.tick);
    recordVisibleEvents(this.state.replay, this.world, this.tick, this.replaySeen);
    if (this.state.replay) captureReplayFrame(this.state.replay, this.world, this.tick, !this.running);
    this.applyDueCommands();
    return true;
  }
}
