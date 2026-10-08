# Phase 7 progress: recorded replay and joint benchmark

Started 29 September 2026. This is a bounded replay and validation slice for **Glasswater / Joint probe**. It does not complete the plan's release or visual targets.

## Delivered

- The authoritative runtime saves an append-only record of accepted and rejected player orders, autonomous decisions, and faction-delivered events. It also captures blue and red headquarters views every simulated second, after accepted player orders, and when the objective concludes. Static view data is stored once; frames retain actors, contacts, rounds, missions, reservations, and recent visible events. Detailed sensor/report history is omitted from replay frames; the live intelligence model still owns it.
- The tactical view can scrub recorded frames while paused or concluded, show nearby records, and export the selected faction's replay and AAR as JSON. Each frame and record is projected to that faction; blue exports do not include red decision records. The recorded-frame reader does not execute the model, so the data remains readable when its model version differs from the current engine. Loading and resuming an old simulation model is still restricted by checkpoint validation.
- Browser and server persistence now report a failure if neither copy acknowledges a write. A read-only server reply is not treated as an acknowledgement. If browser quota blocks a write but the server succeeds, restore chooses the newer runtime tick/command sequence. The UI shows a checkpoint-save error when both writes fail. Storage is still the existing browser/server document system; transactional event chunks and IndexedDB remain open work.
- `npm run bench:warsim:joint` runs five fixed seeds for disabled, cautious, balanced, and aggressive red opposition. It records outcome, resource use, archive size, CPU tick timings, environment, and source hashes. The archived report is [phase-7-joint-batch.json](baselines/phase-7-joint-batch.json).
- The physical model identifier is now `coastal-pointmass-v2` because seeker selection, support freshness, observed terminal events, and seeded sensor error changed the results. Older `v1` physical checkpoints are rejected on resume with the original save retained; their recorded replay archives can still be read without resimulation. There is no conversion of an old physical encounter into `v2` yet.

## Joint batch result

Windows 10.0.26200, AMD Ryzen 7 7445HS, 12 logical cores, Node 24.15.0, Turbo power scheme. Each trial ran the 100 ms fixed step for at most 900 ticks. CPU timing includes replay capture but excludes worker transfer, persistence, browser rendering, and React.

| Red variant | Red wins / 5 | Mean red rounds spent | Largest replay archive | Highest per-trial tick p95 |
| --- | ---: | ---: | ---: | ---: |
| Disabled | 0 | 0 | 1.58 MB | 5.66 ms |
| Cautious | 5 | 6 | 0.55 MB | 9.86 ms |
| Balanced | 5 | 8 | 0.59 MB | 9.82 ms |
| Aggressive | 5 | 8 | 0.59 MB | 9.48 ms |

All five seeds gave the same outcome in each variant: with red disabled, blue survived the 900-tick limit; each active red doctrine defeated the blue objective at tick 217. The earlier baseline hid three simulation defects: offensive seekers could retarget interceptor rounds, red favored a high-confidence escort contact over the briefed objective contact, and cautious missions lost required support during their acknowledgement delay. The corrected fixture also records seeded sensor position errors and water splashes without reporting unseen impacts to headquarters. The active doctrines now fire and can achieve the objective, but their identical outcomes and finish times do not demonstrate useful difficulty separation or outcome sensitivity. The synthetic equipment, sensor, interception, and damage model are uncalibrated; five seeds do not supply a meaningful win probability or uncertainty interval.

## Verification and remaining gates

78 unit/integration tests pass. New tests cover scoped frames, deterministic archive continuation after checkpoint restore, event history beyond the live log limit, older checkpoint upgrades, reading old recorded model versions while rejecting old physics resimulation, save failure/newer-copy behavior, objective track priority, support freshness, seeded sensor errors, seeker target compatibility, and splash visibility. TypeScript and production build pass. All three joint Chromium browser tests passed their assertions in this run; Playwright stayed open after reporting the third passing test and was stopped.

The replay captures one-second states, so motion between frames is not preserved. AAR JSON is faction-scoped and machine-readable; a complete human-readable AAR and event-by-event camera playback remain open. Recording starts when a new runtime first sees the scenario; earlier events in old saves cannot be recovered. Persistence still sends full checkpoints through the worker and uses the existing document store. Full visual presets, streaming, context recovery, long-session transactional persistence, large-force benchmarks, and measured 1080p frame-time targets remain Phase 7 work.
