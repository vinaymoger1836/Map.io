import { STEP_MS } from './contracts';

/** Slow hosts shed wall-time debt, never skip model ticks or enlarge the step. */
export class FixedStepScheduler {
  private previous: number | null = null;
  private debt = 0;
  droppedWallMs = 0;
  reset() { this.previous = null; this.debt = 0; }
  advance(now: number, speed: number, running: boolean, visible: boolean): boolean {
    if (!running || !visible) { this.reset(); return false; }
    if (this.previous === null) { this.previous = now; return false; }
    const elapsed = Math.max(0, now - this.previous);
    this.previous = now;
    const admitted = Math.min(elapsed, 250);
    const nextDebt = this.debt + admitted * speed;
    this.droppedWallMs += elapsed - admitted + Math.max(0, nextDebt - STEP_MS * 8) / speed;
    this.debt = Math.min(nextDebt, STEP_MS * 8);
    if (this.debt + 1e-8 < STEP_MS) return false;
    this.debt -= STEP_MS;
    return true; // One step per task gives commands/visibility a scheduling opportunity.
  }
}
