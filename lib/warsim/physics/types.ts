import type { Geo, Vec3 } from './coordinates';
export interface PhysicalActor {
  id: string; iso: string; position: Vec3; velocity: Vec3;
  heading: number; course: number; speed: number; desiredSpeed: number;
  fuel: number; health: number; rounds: number; interceptors: number; cooldown: number;
}
export interface PhysicalRound {
  id: string; shooterId: string; iso: string; targetId: string; interceptor: boolean;
  position: Vec3; launchPosition: Vec3; velocity: Vec3; age: number;
  sourceScope?: string; aimPosition?: Vec3; aimVelocity?: Vec3; aimObservedTick?: number; trackRevision?: number; seekerLocked?: boolean;
}
export interface PhysicalEvent {
  id: number; time: number; kind: 'launch' | 'impact' | 'intercept' | 'expired';
  position: Vec3; roundId: string; visibleTo: string[]; terminatedRoundIds: string[];
  deliveries?: { scopeId: string; linkIds: string[]; deliveryTick: number }[];
}
export interface PhysicalEncounter {
  version: 1; model: 'coastal-pointmass-v1'; origin: Geo; sequence: number;
  actors: PhysicalActor[]; rounds: PhysicalRound[]; events: PhysicalEvent[];
  intel?: import('../intelligence').PhysicalIntel;
}
