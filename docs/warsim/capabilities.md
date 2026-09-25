# Legacy WarSim capability baseline

Phase 0, 25 September 2026. This describes executable code at the start of the redesign. Equipment values and outcome probabilities have not been validated against real operations. A feature's presence in the UI or catalogue does not establish model fidelity.

## Architecture today

`EurasiaMap` owns modes and connects the board, catalogue, and simulation hooks. `useWarSim` owns a React session and calls `tickWarSim` on the main thread approximately every 100 ms. The engine combines domain updates with mission decisions, contact generation, weapons, damage, and reports. Supporting modules cover terrain, airspace, carrier operations, refueling, electronic effects, and space. `warSimLayers` converts the session into MapLibre GeoJSON sources; the console receives the same session. `store` writes browser storage and attempts the local JSON API.

This couples authoritative state, player knowledge, and presentation. Phase 1 introduces the runtime boundary; later phases replace individual models behind that boundary.

## What each domain actually models

| Area | Present behavior | Limits and redesign requirements | Evidence |
| --- | --- | --- | --- |
| Clock and state | Wall-time delta multiplied by selected speed; pause; session autosave. | No authoritative fixed step, checkpoint RNG, ordered command journal, or deterministic production replay. Some nested missile objects are mutated during a tick. | `lib/useWarSim.ts`, `lib/warSimEngine.ts`; transit/pause tests |
| Air | Geographic transit, patrol/waypoint orders, sorties, fuel depletion, return/turnaround, carrier and refueling helpers. | Scalar speed and altitude commands; no continuous force/energy model, validated maneuver envelope, or atmosphere/weather model. Nearby-tanker fuel relief and transfer logic need consolidation. | `warSimEngine`, `carrierOps`, `aerialRefueling`; transit fixture |
| Maritime surface | Moving ships, sensors, magazines, salvo launches, layered defense, subsystem damage and flooding. | Aggregate platform counts; scripted/probabilistic outcomes; no hydrodynamics, sea state, detailed ship geometry, or validated damage propagation. | `warSimEngine`, `warSimRules`; engagement and fleet fixtures |
| Land | Ground platforms/installations, geographic routing, ground-based sensing and fires, base support. | No terrain traversal cost, road-network logistics, cover/destructible terrain, or detailed formation combat. Terrain LOS uses analytic mountain approximations. | `warSimEngine`, `terrainLOS`; joint fixture's sensor only |
| Subsurface | Submarine classes, sonar reach/detection rules, depth-related state and torpedo categories. | Simplified sensing; no acoustic propagation or ocean profile. Shared projectile update clamps speed to at least 600 km/h, unsuitable for torpedo motion. No Phase 0 validated ASW encounter. | `warSimEngine` projectile update and sonar sweep; `warSimTypes` |
| Space | Approximate orbital tracks/swaths, periodic collection events, satellite status, ASAT flight bookkeeping. | Collection code inspects existing contacts and emits discovery events/counters but does not insert a fused contact. Default satellites use alpha country codes while many map workflows use numeric codes. No orbital dynamics validation. | `lib/spaceLayer.ts` |
| Electronic effects | Jamming/support modifiers and sensor/emission state influence selected calculations. | Rule modifiers, with no spectrum propagation, detailed receiver model, persistent message queue, or validated electronic environment. | `lib/electronicWarfare.ts`, `warSimEngine` |
| Weapons | Range/category gates, launch inventory consumption, moving flyout tracks, intercept attempts, probabilistic hits and salvo reports. | Geographic interpolation and speed/progress bookkeeping; no unified velocity/acceleration/guidance/collision state. Real-time animation alone is not validated weapon physics. Aggregate magazine rounding and missing compatibility defaults need explicit contracts. | `warSimEngine`, `warSimRules`; launch, inventory, flyout/report tests |
| Fog of war | Separate faction contact arrays, detection radius/horizon checks, last-known positions, expiry. | Contacts can expose exact truth fields. No enforceable observer snapshot boundary across map, console, AAR, and targeting. No spatial covariance, evidence lineage, or command-group-specific knowledge. | `warSimEngine`, `warSimLayers`; asymmetric acquisition/loss test |
| Intelligence | Sensor sweeps, reconnaissance-related events, reports and space scans. | No general collection-request lifecycle, processing queue, confidence fusion, delayed dissemination, or deduplication of forwarded evidence. | Joint fixture explicitly declares future expectations; three pending tests |
| Coordination | Network membership, shared contacts, OTH toggle, defense doctrines, channel and subsystem state. | Network synchronization rebuilds nodes and resets channel usage; link status derives from unit state. No durable resource reservations, queued communication, or joint task graph with support-loss fallback. | `syncEntitiesWithNetworks`, `warSimTypes` |
| Logistics/readiness | Personnel, quotas, bases, deployable stores, sortie turnaround, fuel, repair timers. | Simplified timers and aggregate accounting; no general resource ledger or transport/supply-chain model. | `warSimEngine`, `useWarSim`, staging and console |
| AAR/replay | Combat reports and live event log. | Buffers capped at 200 events and 150 reports; no complete replay journal/checkpoints. Reports can reveal world truth. | `warSimEngine`, `scenarioIO`; browser AAR smoke test |
| Visuals | MapLibre command map, military symbols, range/sensor overlays, moving GeoJSON tracks. | Full source regeneration from React session updates; no interpolated renderer contract or detailed 3D tactical scene/asset pipeline. | `EurasiaMap`, `warSimLayers`; browser baseline |

## Verification boundary

Phase 0 tests preserve selected legacy behaviors, including their simplifications. They do not validate all domain models. The fleet fixture measures cost; it is not a combat effectiveness experiment. The joint fixture provides ordered requirements for collection, delivery, and interruption; only its legacy sensor behavior executes today. Space and subsurface need dedicated regression encounters before their domain rewrites.

The next architectural step is a typed, versioned simulation boundary with deterministic scheduling and commands. Explicit knowledge, observation, communication, and reservation contracts must precede the later intelligence/coordination implementation. Performance work should retain these behavioral fixtures while separating simulation execution from rendering.
