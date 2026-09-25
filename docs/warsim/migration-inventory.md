# WarSim persistence and migration inventory

Phase 0, 25 September 2026. This is an inventory and acceptance contract for future adapters. No new save schema or destructive migration is introduced in Phase 0.

## Stored documents

The browser prefix is `mapio.wargames.`. The local API uses `/api/store/<doc>` backed by `data/<doc>.json`. Existing documents are generally unversioned and must be treated as legacy inputs.

| Document / format | Contents and references | Migration requirements |
| --- | --- | --- |
| `board` | `BoardState`: nation colors, deployed units, custom formations. Unit IDs, country keys, coordinates, system IDs, composition and loadouts link to other data. Older board key: `mapio.wargames.v1`. | Preserve identities, coordinates, counts, colors, formation composition and authored choices. Report rejected entries rather than silently losing units. Run `reviveBoard` compatibility deliberately. |
| `systems` | Authored `SystemSpec[]`; shipped definitions separately in `public/data/systems.json`. Optional platform/sensor/weapon facets; read-time `reviveSpec`. | Retain user overrides and provenance. Resolve every referenced system and munition. Assign stable weapon IDs before converting magazines keyed by array index. Freeze the session's definition snapshot. |
| `forces` | Country-keyed arrays of `{typeId, systemId?, count}`. Missing holdings mean unrestricted board deployment. | Preserve the distinction between absent holdings and a zero count. Normalize country keys through an explicit mapping; preserve unresolved entries for user review. |
| `scenarios` | `{active, items[]}` with saved board copies and metadata. | Preserve scenario IDs/names/timestamps, active selection and each board. Global catalogue/holdings are distinct from scenario board state. |
| `warsim-session` | Unversioned `WarSimSession` or `null`: clock/speed/status/factions, quotas/personnel/bases, aggregate entities and missions, fuel/damage/magazines, missiles, contacts, networks, satellites, events/reports. | Adapter must preserve or explicitly retire every runtime field. Define unit/count semantics, timestamps, weapon-index mapping and references. Introduce schema/model/data versions and RNG/ID state; legacy saves cannot reconstruct past RNG decisions. Resume migrated legacy sessions paused with a migration report. |
| `mapio.lastMode` | Browser UI mode outside the document prefix. | Keep presentation preference separate from simulation checkpoints. |
| Canonical bundle | `kind: mapio.wargames.bundle`, `version: 1`, board, custom systems and holdings for involved nations; name/note/export time. | Preserve referenced data and merge rules: imported configuration adds missing IDs and retains existing definitions. A bundle is a board export, not an active-session checkpoint. |
| Early shared bundle | `kind: wargames-bundle`, `version: 1`. Root Pacific reference contains 12 deployed units and empty custom systems. | Phase 0 now accepts this marker in the board-bundle path. Previously it fell through to arsenal import and returned an empty board. Copied fixture checks every unit ID/count/coordinate and a canonical round trip. |
| Arsenal package | `format: mapio-arsenal-package`; systems and forces, without a scenario board. The reader also accepts loosely marked objects with systems/forces. | Route through an explicit arsenal adapter; do not interpret as a full-session or board checkpoint. Preserve equipment/holdings and explain conflicts. |
| Theater package | `CompleteScenarioPackage`, `schemaVersion: 1.2.0`, board, waypoints, optional theater operations/campaign history. Defined in `scenarioIO`, separate from bundle reader. | Retain operation references and history. Current parser only checks that `board.units` is an array; new adapters need real schema validation and version gating. |
| AAR exports | Markdown/JSON report artifacts. | Preserve as reports; they lack the state required to resume or replay an encounter. |

## Current save semantics and risks

- `store` writes localStorage first and attempts the server write. Failed file writes can be swallowed; an API `readonly` result is not reflected reliably in the UI storage status. Browser quota failures also do not provide a durable acknowledgement to the caller.
- Systems merge by ID, with browser entries overriding server entries. Most other documents prefer a nonempty local value without comparing revisions. The scenarios branch tests for arrays although the current scenario document is an object, then falls back to local-first selection.
- Board writes are debounced; live sessions save on an approximately four-second interval and selected lifecycle transitions. A paused faction change can wait for that interval. Current browser coverage waits for the stored value before reloading.
- Country identifiers include numeric map codes and alpha codes in default templates/space data. Do not silently choose a canonical faction from an ambiguous value.
- Entity `count` can represent several platforms; magazines can refer to weapon array positions. Splitting aggregates or reordering equipment without an explicit mapping changes inventories.
- Events/reports are truncated. Migrating a legacy session cannot manufacture an earlier timeline or exact replay seed.

## Required adapter sequence (Phase 1 onward)

1. Read without writing, identify format/version, and retain the original bytes for recovery.
2. Validate structure, finite coordinates/quantities, identifiers and reference closure. Separate supported defaults from unknown information; generate diagnostics.
3. Convert a copy into a versioned world, definition snapshot, knowledge state and runtime checkpoint. Use a recorded policy for legacy RNG initialization and missing fields.
4. Check entity, personnel, ammunition and fuel accounting; preserve unresolved records instead of deleting them silently.
5. Save to a new slot transactionally. Confirm durability before updating the active pointer. Keep the original slot available for rollback.
6. Exercise resume, faction views, ongoing missions/projectiles and export/reimport against the versioned fixtures before enabling automatic migration.

## Phase 0 safeguards and coverage

Core tests use synthetic inputs or the copy under `tests/warsim/fixtures/v1`, never mutable user documents. Browser tests use fresh contexts and an in-memory document API. A dedicated port and `.next-e2e` build directory isolate the test server. `MAPIO_E2E=1` makes its real storage API return empty reads and reject writes, even if browser interception is missed. The runner refuses to reuse another server.

Global setup fingerprints `data/*.json`, shipped systems and the root Pacific scenario before testing and checks them after testing. It does not restore or overwrite files. A concurrent manual edit can trigger this check; investigate the difference instead of discarding that edit.

Automated checks cover the copied Pacific/canonical bundle round trip, board/scenario revival, theater package waypoints, malformed/newer bundle rejection, and live-session pause/save/reload/faction/exit. They do not yet establish transactional storage, cross-version runtime migrations, or complete validation of arbitrary user imports.
