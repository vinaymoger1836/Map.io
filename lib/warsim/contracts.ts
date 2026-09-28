import type { SystemSpec } from '../specs';
import type { WarSimSession } from '../warSimTypes';
import type { commandHandlers } from './commands';
import type { RandomState } from './context';

export const RUNTIME_VERSION = 1 as const;
export const MODEL_VERSION = 'legacy-fixed-v1' as const;
export const STEP_MS = 100;
export type Faction = 'player' | 'enemy';
export interface KnowledgeScope { faction: Faction; commandGroupId: string }
export interface Observation {
  id: string; scope: KnowledgeScope; sensorId: string; observedAtTick: number;
  modality: 'radar' | 'visual' | 'sonar' | 'space' | 'electronic';
  estimatedPosition: [number, number]; uncertaintyM: number;
  confidence: number; evidenceIds: string[];
}
export interface CollectionTask {
  id: string; scope: KnowledgeScope; assetId: string; requestedAtTick: number;
  status: 'requested' | 'collecting' | 'processing' | 'complete' | 'failed';
  observationIds: string[];
}
export interface CommunicationMessage {
  id: string; from: KnowledgeScope; to: KnowledgeScope; evidenceIds: string[];
  sentAtTick: number; deliverAtTick: number; linkId: string;
  status: 'queued' | 'delivered' | 'expired';
}
export interface MissionDependency {
  id: string; missionId: string; supportingAssetId: string;
  capability: 'sensing' | 'guidance' | 'communications' | 'refueling' | 'fires';
  onLoss: 'continue-local' | 'hold' | 'reassign' | 'abort'; available: boolean;
}
export interface ResourceReservation {
  id: string; missionId: string; assetId: string; resourceId: string;
  quantity: number; reservedAtTick: number; expiresAtTick: number;
}
/** Persisted contracts; Phase 3 supplies collection/fusion/dissemination behavior. */
export interface CoordinationState {
  observations: Observation[]; collectionTasks: CollectionTask[];
  messages: CommunicationMessage[]; dependencies: MissionDependency[];
  reservations: ResourceReservation[];
}
type HandlerArgs<T> = T extends (state: WarSimSession, systems: SystemSpec[], ...args: infer A) => unknown ? A : never;
export type SimulationCommand = { [K in keyof typeof commandHandlers]: {
  type: K; args: HandlerArgs<typeof commandHandlers[K]>;
} }[keyof typeof commandHandlers];
export interface CommandEnvelope {
  version: 1; sequence: number; scope: KnowledgeScope; executeAtTick: number; command: SimulationCommand;
}
export interface CommandReceipt {
  sequence: number; tick: number; status: 'accepted' | 'rejected'; reason?: string;
}
export interface RuntimeCheckpoint {
  schemaVersion: 1; modelVersion: typeof MODEL_VERSION; stepMs: 100;
  tick: number; originSimTimeSec: number; random: RandomState; nextSequence: number;
  definitions: SystemSpec[]; pendingCommands: CommandEnvelope[];
  acceptedCommands: Array<CommandEnvelope & { appliedAtTick: number }>;
  coordination: CoordinationState;
}
export interface RuntimeDiagnostics {
  tick: number; stepMs: number; lastTickMs: number; droppedWallMs: number;
  suspended: boolean; pendingCommands: number;
}
export interface RuntimeFrame {
  type: 'frame'; version: 1;
  /** Observer projection: the only session used by panels and renderers. */
  session: WarSimSession;
  /** Full state, passed exclusively to the persistence path. */
  checkpoint: WarSimSession;
  receipts: CommandReceipt[]; diagnostics: RuntimeDiagnostics;
}
export type WorkerRequest =
  | { type: 'initialize'; version: 1; session: WarSimSession; definitions: SystemSpec[]; visible: boolean }
  | { type: 'command'; envelope: CommandEnvelope }
  | { type: 'visibility'; visible: boolean }
  | { type: 'checkpoint' };
export type WorkerResponse = RuntimeFrame | { type: 'error'; message: string };
