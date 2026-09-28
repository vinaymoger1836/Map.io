import type { Geo, Vec3 } from './coordinates';
export interface PhysicalActor {
  id: string; iso: string; position: Vec3; velocity: Vec3;
  heading: number; course: number; speed: number; desiredSpeed: number;
  fuel: number; health: number; rounds: number; interceptors: number; cooldown: number;
}
export interface PhysicalRound {
  id: string; shooterId: string; iso: string; targetId: string; interceptor: boolean;
  position: Vec3; launchPosition: Vec3; velocity: Vec3; age: number;
}
export interface PhysicalEvent {
  id: number; time: number; kind: 'launch' | 'impact' | 'intercept' | 'expired';
  position: Vec3; roundId: string; visibleTo: string[]; terminatedRoundIds: string[];
}
export interface PhysicalEncounter {
  version: 1; model: 'coastal-pointmass-v1'; origin: Geo; sequence: number;
  actors: PhysicalActor[]; rounds: PhysicalRound[]; events: PhysicalEvent[];
}
