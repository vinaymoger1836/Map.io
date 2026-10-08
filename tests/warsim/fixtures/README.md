# Versioned WarSim fixtures

`v1/scenarios.ts` returns fresh structured clones of authored, synthetic systems and sessions. Parameters are test inputs, not real equipment performance estimates. The version is `1`; seed `240925`; test epoch `2026-09-25T00:00:00Z`.

| Fixture | Initial workload | Purpose |
| --- | --- | --- |
| transit | One aircraft | Movement distance, fuel, clock multipliers, pause |
| sensor-contact | One scout and one unarmed vessel | Asymmetric acquisition, stale position and expiry |
| engagement | One shooter and one unarmed vessel | Inventory, launch, flyout, report completion |
| fleet | 100 platforms and 50 projectiles | Repeatable engine/render workload |
| joint-operations | Air scout, surface shooter, ground sensor and opposing vessel | Cross-domain observation; scripted requirements for collection, delayed delivery and lost support |

The joint collection script marks unimplemented actions `planned`. Three pending tests track delayed dissemination, support-loss fallback and evidence deduplication. They must become executable tests as those models arrive.

The legacy engine creates default satellites when given an empty array. These fixtures instead contain one destroyed synthetic satellite to prevent unrelated default sensing. The fleet projectiles start away from the fleets to maintain the intended workload during a short capture.

`pacific-csg-defense.wargames.json` is a byte-for-byte copy of the repository's original reference scenario. Tests read the copy, never write the original. It exercises the legacy `wargames-bundle` marker.

`withLegacyRuntime` supplies a test-only seeded RNG and advancing timestamp to synchronous core runs and restores both globals in `finally`. Browser runs use normal legacy runtime randomness; neither harness nor fixture adds deterministic replay to production. Change fixture semantics by adding a new version, and retain old inputs for migration checks.
