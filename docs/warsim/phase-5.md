# Phase 5 progress: joint probe and environment

Started 28 September 2026. **War games → War Sim → Joint probe · five domains** opens a separate Glasswater reference. The older coastal reference and legacy WarSim scenarios remain available. This probe is a synthetic integration fixture, not a validated combat model.

## What is implemented

- A saved, versioned environment snapshot supplies a 20 × 20 km local elevation grid, a land/sea boundary threshold, visibility, rain, sea state, and wind. The 3D land mesh uses the same grid as ground movement and ground radar sight checks. The grid contains at most 4,096 samples and is fully supplied before any simulation step; missing cells and searches beyond coverage return `unavailable`, never a guessed elevation. Ground collection distinguishes blocked terrain from unavailable terrain and does not claim negative coverage for either.
- A tracked land patrol follows the authored surface and stops at the shoreline or missing terrain. A fixed ground radar can collect surface tracks through terrain sight checks and send them to HQ. Sea state limits vessel speed, while wind changes the air reconnaissance platform's ground track. Rain and visibility reduce radar and orbital collection range.
- An air reconnaissance platform, two surface vessels, a friendly sonar platform, an opposing submarine, and a scheduled orbital collector share the same 100 ms step, coordinates, observer scopes, link queue and checkpoint. Surface radar cannot see submerged targets; sonar can. The orbital collector samples once per 30 simulated seconds, then takes one second to process and two seconds to downlink a report. Its map marker is a proxy for an observation window, not an orbital trajectory.
- A fresh ground radar report can satisfy the support prerequisite for a surface strike. Disconnecting its data link holds the reserved mission. Surface guided rounds reject submerged and orbital contacts. The intelligence board shows evidence modality, observation time, link delay, next orbital scan and the environment provenance.

The grid is authored fictional data with `synthetic` confidence. Ground movement uses a height threshold for coastline and a simple slope limit. Air motion is planar at fixed altitude; the submarine keeps a fixed depth; the orbital collector is fixed in the local frame between scheduled windows. There is no bathymetry, thermocline, orbital propagation, atmospheric profile, weather timeline, cross-domain weapons model, or calibrated sensor performance. Orbital reports arrive stale under the reference's short contact-freshness rule, so they can inform the picture but cannot provide a current firing-quality track by themselves.

## Verification

- 61 unit/integration tests pass. New cases cover bounded terrain sampling, clear/blocked/unavailable sight, ground radar support of a sea mission, weather-dependent motion and collection, shoreline stopping, sonar isolation, delayed orbital downlink, interrupted reports, and deterministic checkpoint restore with the environment snapshot.
- TypeScript and production build pass. The isolated Chromium joint workflow passed its assertions; Playwright stayed open after the test and the runner was stopped.
- The standalone `validate:warsim:physics` script still cannot start in this Windows environment because `tsx` fails during `os.userInfo()` with `uv_os_get_passwd` ENOMEM. Existing physics unit tests pass, but a new numerical trajectory artifact was not generated.

## Remaining Phase 5 gates

- Replace the synthetic local grid and height-threshold coast with versioned geographic elevation, bathymetry and boundary providers for supported theaters. Add progressive loading and bounded caches without changing a result after the step that used it.
- Improve ground traversal, sea and air environmental effects, submarine depth/acoustic behavior, and orbital propagation and coverage windows. Add scenario authoring controls for environmental sources, uncertainty and validity ranges.
- Exercise a full saved joint scenario with domain-specific missions and resources across all five domains. The current probe connects all five to the shared clock and knowledge system, but only the ground-radar-to-surface-strike dependency affects a mission outcome.
- Finish Phase 4 logistics and readiness integration across the newly added domains, then run the full browser and numerical validation suites.
