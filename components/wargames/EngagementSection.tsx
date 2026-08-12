'use client';

/**
 * A raid, and what the defence does to it.
 *
 * The one screen in the app that multiplies figures together rather than
 * reporting them, which is why so much of it is given over to saying what the
 * arithmetic assumed. A leakage number with its assumptions hidden is worse than
 * no number: it is a guess wearing arithmetic.
 *
 * The model is in `lib/engagement.ts`, including the four conventions it rests
 * on and which way each one is wrong.
 */

import { useMemo } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { attrition, verdict, type Assessment, type SilentReason } from '@/lib/engagement';
import { distanceKm } from '@/lib/geo';
import { TARGET_LABEL } from '@/lib/specs';
import { unitLabel, type DeployedUnit } from '@/lib/warGames';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

/** Losses read better to one decimal: "0.9 of 12 arrive" is the actual claim. */
const n1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

const SILENT: Record<SilentReason, string> = {
  'too-fast': 'through before it can fire',
  dry: 'out of ready rounds',
  'nothing-left': 'nothing left to engage',
  blind: 'in range, never detected',
};

const ALTITUDES: [number, string, string][] = [
  [100, 'Low', 'Under the horizon of most ground radars — the reason to fly it'],
  [3_000, 'Medium', 'Seen by most things well before they can shoot'],
  [10_000, 'High', 'Seen by everything, at close to brochure range'],
];

function Picker({
  label,
  hint,
  units,
  value,
  onChange,
  wg,
  emptyText,
}: {
  label: string;
  hint: string;
  units: DeployedUnit[];
  value: string | null;
  onChange: (id: string | null) => void;
  wg: WarGames;
  emptyText: string;
}) {
  return (
    <label className="wg-field wide">
      <span>
        {label} <em>{hint}</em>
      </span>
      {units.length ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {wg.board.nations[u.iso]?.name ?? u.iso} — {unitLabel(u, wg.formations, wg.systems)}
            </option>
          ))}
        </select>
      ) : (
        <p className="wg-empty">{emptyText}</p>
      )}
    </label>
  );
}

function Result({ a }: { a: Assessment }) {
  const share = attrition(a);
  const spread = a.leakers.high - a.leakers.low;

  return (
    <>
      <p className={`wg-verdict${share > 0.6 ? ' hot' : ''}`}>{verdict(a)}</p>

      {!a.blocked && (
        <>
          <p className="wg-leakers">
            <strong>{n1(a.leakers.low)}</strong>
            {spread > 0.05 && <> – <strong>{n1(a.leakers.high)}</strong></>} of {a.raid.count}{' '}
            arrive
            <span className="wg-leakers-sub">
              {n1(a.leakers.stated)} at the figures as written · {Math.round(share * 100)}% lost ·{' '}
              {km(a.distanceKm)} run · engaged as <em>{TARGET_LABEL[a.threat] ?? a.threat}</em>
            </span>
          </p>

          {spread > 0.05 && (
            <p className="wg-note">
              The spread is not a modelling choice — it is the confidence recorded against each
              kill probability, widened per figure. Nearly every <em>pk</em> in the library is
              marked <em>low</em>, because nobody publishes them, so the range is wide by rights.
            </p>
          )}
        </>
      )}

      {a.engagements.length > 0 && (
        <>
          <h4 className="wg-sub">Layers, in the order the raid meets them</h4>
          <table className="wg-table wg-layers">
            <thead>
              <tr>
                <th>At</th>
                <th>Firing</th>
                <th className="num">Facing</th>
                <th className="num">Rounds</th>
                <th className="num">Lost</th>
              </tr>
            </thead>
            <tbody>
              {a.engagements.map((e, i) => (
                <tr key={`${e.unitId}-${i}`} className={e.silent ? 'wg-silent' : undefined}>
                  <td>
                    {km(e.entryKm)}
                    <span className="wg-layer-sub">{Math.round(e.exposureSec)} s exposed</span>
                  </td>
                  <td>
                    {e.unitLabel}
                    {e.cued && <span className="wg-tag">cued</span>}
                    <span className="wg-layer-sub">
                      {e.weaponName} · {km(e.rangeKm)}
                      {e.heldFireKm !== undefined && ` · held fire ${km(e.heldFireKm)}`}
                      {e.assumedEngages && ' · target class not stated'}
                    </span>
                  </td>
                  <td className="num">{n1(e.facing)}</td>
                  {/* Fractional, and correctly so: every figure in the walk is an
                      expectation, so a layer facing 0.1 surviving raiders expends
                      0.1 of a salvo. Formatted like the others rather than raw. */}
                  <td className="num">{e.silent ? '—' : n1(e.rounds)}</td>
                  <td className="num">{e.silent ? SILENT[e.silent] : n1(e.killed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {a.unmodelled.length > 0 && (
        <>
          <h4 className="wg-sub">Cannot be modelled</h4>
          <ul className="wg-unmodelled">
            {a.unmodelled.map((u, i) => (
              <li key={i}>
                {u.weaponName} <em>on {u.unitLabel}</em>
              </li>
            ))}
          </ul>
          <p className="wg-note wg-warn">
            These weapons are in range and can engage this raid, but record no kill probability, so
            nothing above counts them. A missing figure is not a zero — the defence is stronger than
            the number says, by an amount nobody can state.
          </p>
        </>
      )}
    </>
  );
}

export function EngagementSection({ wg }: { wg: WarGames }) {
  const { board, raidFromId, raidToId, assessment } = wg;

  const attacker = board.units.find((u) => u.id === raidFromId) ?? null;

  // Anything belonging to somebody else. The board records no alliances, so it
  // cannot know two nations are on the same side.
  const targets = useMemo(() => {
    if (!attacker) return [];
    return board.units
      .filter((u) => u.iso !== attacker.iso)
      .sort((a, b) => distanceKm(attacker.lngLat, a.lngLat) - distanceKm(attacker.lngLat, b.lngLat));
  }, [board.units, attacker]);

  const reach = attacker
    ? wg.systems.find((s) => s.id === (attacker.kind === 'unit' ? attacker.systemId : undefined))
        ?.platform
    : undefined;
  const target = board.units.find((u) => u.id === raidToId) ?? null;
  const runKm = attacker && target ? distanceKm(attacker.lngLat, target.lngLat) : null;
  const radius = reach?.combatRadiusKm;
  const refuelled = reach?.refuelledRadiusKm;

  return (
    <>
      <section className="wg-block">
        <h3 className="wg-h">
          Raid
          {assessment && !assessment.blocked && (
            <span className="wg-h-note">
              {assessment.engagements.length} {assessment.engagements.length === 1 ? 'layer' : 'layers'}
            </span>
          )}
        </h3>

        <Picker
          label="Flown by"
          hint="a unit with a recorded speed"
          units={wg.raidCandidates}
          value={raidFromId}
          onChange={wg.setRaidFrom}
          wg={wg}
          emptyText="Nothing on the board can fly a raid. A raider must be a single unit — not a special unit — with a system whose speed is recorded."
        />

        <Picker
          label="Against"
          hint="anything not its own"
          units={targets}
          value={raidToId}
          onChange={wg.setRaidTo}
          wg={wg}
          emptyText={
            attacker ? 'Nothing belonging to another nation is on the board.' : 'Pick a raider first.'
          }
        />

        <div className="wg-field-label">Flown at</div>
        <div className="wg-kinds">
          {ALTITUDES.map(([metres, label, hint]) => (
            <button
              key={metres}
              className={`wg-kind${wg.coverage.targetAltM === metres ? ' on' : ''}`}
              onClick={() => wg.setTargetAltitude(metres)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="wg-note">
          The same altitude the coverage rings are drawn against, because it is the same number —
          a detection ring is what a radar sees of something at <em>this</em> height. Fly low and
          a battery holds its fire until the raid clears its horizon; fly high and it engages at
          close to the brochure figure.
        </p>

        {runKm !== null && radius !== undefined && (
          <p className={`wg-hint${runKm > (refuelled ?? radius) ? ' wg-warn' : ''}`}>
            {km(runKm)} out.{' '}
            {runKm <= radius
              ? `Inside its ${km(radius)} combat radius.`
              : refuelled && runKm <= refuelled
                ? `Beyond its ${km(radius)} combat radius — needs the tanker that makes it ${km(refuelled)}.`
                : `Beyond even its refuelled radius of ${km(refuelled ?? radius)}. The assessment still runs; getting there is your problem.`}
          </p>
        )}
      </section>

      {assessment && (
        <section className="wg-block">
          <h3 className="wg-h">Assessment</h3>
          <Result a={assessment} />

          {assessment.engagements.some((e) => e.cued) && (
            <p className="wg-note">
              A <em>cued</em> layer cannot see the raid itself and is firing on a friendly sensor&rsquo;s
              picture. Those engagements assume an air picture shared across the nation, and they
              are the first thing to disappear if the data link does.
            </p>
          )}

          <p className="wg-note">
            One engagement per battery: each fires a salvo at every raider it can hold, once, because
            re-fire interval is not a figure this library has. Weapons that record no magazine are
            not capped. Nothing fires at what it cannot see — but a system recording no sensor at
            all is unrecorded rather than blind, so it is not held back. The raid flies straight
            through everything at the recorded speed, which for most aircraft is a maximum rather
            than a cruise. Nothing is destroyed at the far end and nobody shoots back — this reads
            the board, it does not change it.
          </p>
        </section>
      )}
    </>
  );
}
