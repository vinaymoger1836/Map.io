# Phase 4 progress: coastal damage and readiness

Started 28 September 2026. This work applies to the optional Glasswater physical reference only. Legacy WarSim sessions continue through their existing engine.

## Implemented slice

- Vessel integrity and propulsion, sensor, strike launcher, and point-defense condition are authoritative physical state. A point-mass impact reduces integrity and one capability. A capability below 30% cannot perform its action. Propulsion condition also limits speed before complete failure. Impacts interrupt active repairs.
- Each reference vessel has a finite stock of repair kits. A stopped vessel can open one kit for a 30-second repair. Condition and integrity improve continuously, so cancelling retains work already done. The opened kit is consumed even if work is cancelled or interrupted. A save stores the remaining repair time and resources. Older physical saves without the new optional fields still load, with intact capability defaults and no newly granted kits.
- Coordinated strikes can reserve a shooter round and support sensor channel for a delayed launch. Support and launcher readiness are checked at acceptance and execution. Cancelling, timeout, execution, or loss of a shooter/target releases the commitments. Completed weapon events record an outcome on the mission; projection withholds that outcome until the selected observer scope receives the event.
- The tactical inspector shows condition, repair progress and blocked actions. The intelligence board shows scheduled launch time and observed mission outcome. Damaged vessels display a small smoke plume.

This is an illustrative synthetic damage model, not a real equipment reliability or repair estimate. Impacts select a damaged capability by the synthetic round sequence. Repairs do not replenish fuel or ammunition.

## Verification

- 55 unit/integration tests pass. New tests check damage gating, repair kit conservation, partial work on cancellation, deterministic checkpoint restore, delayed mission execution, cancellation release, and overcommitted save rejection.
- TypeScript and production build pass. The isolated intelligence Chromium workflow passed its assertions; its Playwright runner was stopped after it stayed open following test completion.
- The standalone `validate:warsim:physics` script did not start in this Windows environment: `tsx` failed during `os.userInfo()` with `uv_os_get_passwd` ENOMEM. The physics unit tests pass, but the numerical trajectory artifact was not regenerated.

## Remaining Phase 4 gates

- Introduce a common conserved logistics ledger for fuel, ammunition, personnel, and replenishment across the full saved scenario. The reference currently checks strike-round and sensor-channel reservations and keeps local fuel, ammunition, and kit counters.
- Add sortie queues, carrier and base capacity, return and resupply workflows, and cross-domain readiness dependencies once the air and ground reference actors are integrated.
- Expand mission phases and completion conditions beyond this coordinated strike. Track damage assessment as observer evidence rather than direct access to hostile condition.
- Run the full browser suite and numerical validation after the Windows `tsx` startup issue is resolved.
