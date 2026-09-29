# Phase 7 progress: recorded replay and joint benchmark

Started 29 September 2026. This is a bounded replay and validation slice for **Glasswater / Joint probe**. It does not complete the plan's release or visual targets.

## Delivered

- The authoritative runtime saves an append-only record of accepted and rejected player orders, autonomous decisions, and faction-delivered events. It also captures blue and red headquarters views every simulated second and when an order or objective changes state. Static view data is stored once; frames retain actors, contacts, rounds, missions, reservations, and recent visible events. Detailed sensor/report history is omitted from replay frames; the live intelligence model still owns it.
- The tactical view can scrub recorded frames while paused or concluded, show nearby records, and export the selected faction's replay and AAR as JSON. Each frame and record is projected to that faction; blue exports do not include red decision records. The recorded-frame reader does not execute the model, so the data remains readable when its model version differs from the current engine. Loading and resuming an old simulation model is still restricted by checkpoint validation.
- Browser and server persistence now report a failure if neither copy acknowledges a write. A read-only server reply is not treated as an acknowledgement. If browser quota blocks a write but the server succeeds, restore chooses the newer runtime tick/command sequence. The UI shows a checkpoint-save error when both writes fail. Storage is still the existing browser/server document system; transactional event chunks and IndexedDB remain open work.
- `npm run bench:warsim:joint` runs five fixed seeds for disabled, cautious, balanced, and aggressive red opposition. It records outcome, resource use, archive size, CPU tick timings, environment, and source hashes. The archived report is [phase-7-joint-batch.json](baselines/phase-7-joint-batch.json).

## Joint batch result

Windows 10.0.26200, AMD Ryzen 7 7445HS, 12 logical cores, Node 24.15.0, Turbo power scheme. Each trial ran the 100 ms fixed step for at most 900 ticks. CPU timing includes replay capture but excludes worker transfer, persistence, browser rendering, and React.

| Red variant | Red wins / 5 | Mean red rounds spent | Largest replay archive | Highest per-trial tick p95 |
| --- | ---: | ---: | ---: | ---: |
| Disabled | 0 | 0 | 1.58 MB | 5.27 ms |
| Cautious | 0 | 0 | 1.77 MB | 5.01 ms |
| Balanced | 0 | 8 | 2.42 MB | 5.39 ms |
| Aggressive | 0 | 8 | 2.50 MB | 5.31 ms |

All five seeds gave the same outcome in each variant. Cautious red reserved three strikes but fired none; balanced and aggressive exhausted eight rounds without damaging the blue frigate. The benchmark therefore demonstrates repeatability and resource limits, not effective opposition or a calibrated win probability. The synthetic equipment, sensor, interception, and damage model need sensitivity and outcome tuning before claims about difficulty or realism. Five seeds do not supply a meaningful uncertainty interval.

## Verification and remaining gates

69 unit/integration tests pass. New tests cover scoped frames, deterministic archive continuation after checkpoint restore, event history beyond the live log limit, reading old recorded model versions, and save failure/newer-copy behavior. TypeScript and production build pass. The isolated Chromium replay scrub workflow passed its assertions; Playwright remained open after reporting the passing test and was stopped.

The replay captures one-second states, so motion between frames is not preserved. AAR JSON is faction-scoped and machine-readable; a complete human-readable AAR and event-by-event camera playback remain open. Recording starts when a new runtime first sees the scenario; earlier events in old saves cannot be recovered. Persistence still sends full checkpoints through the worker and uses the existing document store. Full visual presets, streaming, context recovery, long-session transactional persistence, large-force benchmarks, and measured 1080p frame-time targets remain Phase 7 work.
