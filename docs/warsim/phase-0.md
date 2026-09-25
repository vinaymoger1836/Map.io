# WarSim Phase 0: baseline and migration fixtures

Implemented 25 September 2026. This phase establishes repeatable inputs, behavioral checks, measurement tools and migration references for the engine rewrite.

## Deliverables

- Five versioned synthetic fixtures: transit, sensor contact/loss, engagement, 100-platform fleet, and joint operations.
- A copied Pacific board export and compatibility regression coverage. The early `wargames-bundle` marker now imports its 12 units correctly.
- Vitest core/migration tests; Playwright launch, save/restore, faction, AAR and exit checks; dedicated browser benchmark.
- Opt-in engine, render, source submission, React render-duration, frame-interval and heap probes.
- [Capability matrix](capabilities.md) and [save migration inventory](migration-inventory.md).
- Recorded [core report](baselines/phase-0-core.json) and [browser report](baselines/phase-0-browser.json), with fixture versions, source hashes and machine metadata.

The joint fixture has executable asymmetric sensing and a script describing later collection, delayed delivery and support interruption. Three test placeholders explicitly track the missing intelligence/coordination behaviors. They are requirements for later phases.

## Run locally

Install the locked dependencies with `npm ci`. On PowerShell, install Chromium into the same workspace cache used by the runner:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache/ms-playwright'
npx playwright install chromium
npm run test
npm run typecheck
npm run test:e2e
npm run bench:warsim
npm run bench:warsim:browser
```

On POSIX shells, use `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" npx playwright install chromium`. Alternatively set `PLAYWRIGHT_BROWSERS_PATH` consistently for installation and test runs. Playwright may require host browser dependencies on Linux.

Run the two benchmarks sequentially, without a concurrent build or other benchmark. Core takes several minutes at the current fleet cost. Fresh output is written under ignored `.cache/warsim-baseline/`; browser output also includes `fleet.png`. Playwright HTML and failure traces go to ignored `playwright-report/` and `test-results/`. Keep historical reports under this document's `baselines/` directory when accepting a new baseline.

Browser runs start their own Next development server on port **3107**, refuse server reuse and use `.next-e2e`. They replace external basemaps/fonts/geography with fixtures. They use fresh browser storage and an in-memory document service; the real test-server API rejects writes. A hash check verifies that user JSON files remained unchanged. Do not manually work on those documents during the test run.

## Measurement definitions

| Metric | What is timed | What it excludes |
| --- | --- | --- |
| Core tick | `tickWarSim`, 20 warmup + 200 timed ticks, three fresh repetitions per fixture, 0.1 s input step at 1x | React, map, browser scheduling and persistence |
| Browser engine tick | Engine invocation from the existing live hook | Waiting in the event loop and rendering |
| Synchronous rendering | Whole `renderWarSimStateToMap` invocation | Map worker processing and GPU completion |
| Source update | Each of the nine main `GeoJSONSource.setData` submissions | Async worker/GPU time; preview-only source updates |
| `react.commit.ms` | React Profiler `actualDuration` for the map-shell subtree at each commit | DOM commit-phase duration; it is a render-duration measurement despite the metric name |
| Frame interval | Visible-page `requestAnimationFrame` callback intervals | Direct GPU frame timing |
| Heap | Node heap before/after GC; browser CDP heap before/after GC, plus browser `performance.memory` samples | Proof of leak freedom; browser memory samples may be rounded |
| Session size | UTF-8 bytes of serialized session JSON | Catalogue/geography payloads and browser persistence overhead |

Core controls `Math.random` and `Date.now` only inside the synchronous harness. Production and browser runs still use the legacy runtime clock/RNG. Core fixture input is repeatable; the engine has no saved replay seed yet.

The browser run warms up for 20 ticks, resets measurements, then requests a 12-second capture. Main-thread congestion means the actual captured window can be longer; use `durationMs` in the report. It centers the fleet at zoom 7. The 50 projectiles remain active offscreen to preserve a stable simulation workload. The blank basemap and absent remote glyphs keep network latency out of the baseline.

Diagnostics are disabled normally. Set `NEXT_PUBLIC_WARSIM_DIAGNOSTICS=1` before starting a development server to enable `window.__warSimDiagnostics.reset()` and `.snapshot()`. Buffers retain at most 6,000 samples per metric; total count/mean/extrema cover the complete capture. Benchmarks enable probes automatically.

## Recorded environment and initial result

Windows 10.0.26200 x64; AMD Ryzen 7 7445HS, 12 logical cores; approximately 15.23 GiB reported RAM; **Turbo** power scheme. Node 24.15.0. Browser: Chromium 153.0.8010.12, 1920 x 1080 viewport, headless **SwiftShader** software rendering, Next development/React StrictMode. No production GPU benchmark has been captured.

The browser fleet run retained all 100 platforms and 50 projectiles. Over an actual 14.48-second capture:

| Metric | Median | p95 | Samples |
| --- | ---: | ---: | ---: |
| Engine tick | 435.0 ms | 524.3 ms | 25 |
| Synchronous map render | 0.5 ms | 1.2 ms | 25 |
| Source submission | Below timer resolution | Below timer resolution | 225 |
| React subtree render duration | 6.1 ms | 7.3 ms | 25 |
| Frame interval | 566.6 ms | 666.6 ms | 25 |

Source submission averaged 0.0049 ms, but the browser timer rounds many individual samples to zero. This does not measure total MapLibre rendering cost. Browser CDP used JS heap changed from 32,544,000 bytes after initial GC to 32,335,376 after final GC; it reached 65,279,596 bytes before final GC. The short run provides no leak conclusion. Serialized session size grew from 74,099 to 324,291 bytes as contact/network/report state populated.

The separate final Node capture used 600 timed ticks per fixture:

| Fixture | Median tick | p95 tick | Initial / final session bytes (first repetition) |
| --- | ---: | ---: | ---: |
| Transit | 0.015 ms | 0.037 ms | 1,613 / 1,993 |
| Sensor contact | 0.083 ms | 0.200 ms | 1,853 / 4,724 |
| Engagement | 0.084 ms | 0.173 ms | 1,853 / 6,935 |
| Fleet | 274.263 ms | 321.094 ms | 74,099 / 324,152 |
| Joint operations | 0.422 ms | 0.705 ms | 3,192 / 6,687 |

In the first fleet repetition, Node used heap changed from 11,370,144 to 12,598,632 bytes across GC checkpoints. The report includes all three repetitions and population counts; changes include live contact/network state and runtime initialization, so this is not a steady-state leak estimate.

The fleet engine already exceeds the 100 ms scheduling interval. This supports prioritizing a worker/runtime boundary and profiling the engine's per-target calculations in Phase 1. Merely improving map visuals will not remove that simulation bottleneck. These development/software-rendering numbers must not be used as production frame-rate claims.

## Exit checks and next work

Verified: **17 core/migration tests passed**, with **three explicit Phase 3 placeholders**; **three browser workflow tests passed**; **one browser benchmark passed**; `npm run typecheck` and the production `npm run build` passed. Successful browser teardown also verified protected file hashes. See the recorded reports and fixture README for exact conditions and limits.

Phase 1 remains the next implementation step: versioned contracts, seeded runtime, fixed-step scheduling, typed commands, worker ownership, save adapters, and interpolated presentation. Current save formats and domain behavior remain the compatibility reference while that boundary is introduced.
