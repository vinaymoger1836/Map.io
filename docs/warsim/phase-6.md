# Phase 6 progress: autonomous opposition and objectives

Started 29 September 2026. The separate **Glasswater / Joint probe** now has a bounded autonomous red force and a 90 second scenario objective. The older coastal reference and legacy scenarios retain their existing behavior.

## What is implemented

- At fixed simulation ticks, red headquarters builds an observer projection and chooses among collection, coordinated strike, direct local fire, formation movement, and waiting. Its decisions use only red headquarters contacts, sensor reports, links, readiness, cooldowns, available rounds, and reservations. The orders go through the same physical command handlers and validation path used by player orders. Failed orders record their rejection reason.
- Decisions record tick, priority, utility, explanation, command, and outcome in the saved checkpoint. The blue observer projection hides red decisions and its next decision tick. The red intelligence board displays recent explanations. Doctrine changes fallback and ammunition preferences; difficulty changes decision tempo and the minimum confidence for tasking. Neither setting adds hidden blue state to the red projection.
- The scenario ends when either frigate is disabled or the T+90 deadline expires. The objective card shows the faction brief, time remaining, result, and context-sensitive training prompt. Blue can configure doctrine, difficulty, or disable autonomous red before starting the probe. A concluded probe cannot be restarted by the play control.

## Verification

- 65 unit/integration tests pass. Phase 6 tests verify decisions remain identical when hidden blue truth changes at each difficulty, formation uses the course command, empty magazines stop strike tasking, saved runs resume deterministically, the autonomous benchmark reaches a victory result without red user orders, ammunition is not overdrawn, and concluded play is rejected.
- TypeScript and production build pass. The isolated Chromium opposition workflow passed its assertions, including applying settings and viewing a red decision. Playwright stayed open after reporting the passing test and was stopped, so the runner did not exit cleanly.

## Remaining Phase 6 work

- Extend the opponent and objectives from this synthetic 90 second probe to authored, saved joint scenarios. Add formation roles and mission priorities across more than one shooter and sensor group.
- Record autonomous orders in the full replay journal and show task changes on the timeline. The current bounded decision list is saved with the checkpoint; Phase 7 owns the append-only event journal and replay.
- Tune and validate doctrine and difficulty with documented benchmark seeds and outcomes. The present confidence thresholds and utility values are scenario heuristics, not calibrated combat behavior.
