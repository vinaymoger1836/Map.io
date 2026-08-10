'use client';

/**
 * What each unit can reach, drawn on the map.
 *
 * Off by default, because forty units with three rings each is a picture of
 * nothing. The interesting views are one unit at a time and one nation at a
 * time: the second is where a hole in an air-defence belt becomes visible.
 */

import type { WarGames } from '@/lib/useWarGames';
import type { EnvelopeKind } from '@/lib/specs';

const MODES = [
  ['off', 'Off', 'No coverage drawn'],
  ['selected', 'Selected', 'Only the unit you have selected'],
  ['nation', 'Nation', 'Everything the active nation has on the board'],
  ['all', 'All', 'Every unit — overlaps compound, so layered defence reads darker'],
] as const;

const KINDS: [EnvelopeKind, string, string][] = [
  ['engagement', 'Weapons', 'How far it can shoot'],
  ['detection', 'Sensors', 'How far it can see'],
  ['strike', 'Reach', 'Combat radius, unrefuelled'],
  ['strike-refuelled', 'Refuelled', 'Combat radius with tanker support'],
];

/** Altitudes worth asking about, because the horizon answer differs so much. */
const ALTITUDES: [number, string][] = [
  [100, 'Low'],
  [3000, 'Medium'],
  [10000, 'High'],
];

export function Coverage({ wg }: { wg: WarGames }) {
  const { coverage } = wg;
  const horizonMatters = coverage.kinds.detection && coverage.mode !== 'off';

  return (
    <section className="wg-block">
      <h3 className="wg-h">Coverage</h3>

      <div className="wg-tools wg-tools-4">
        {MODES.map(([id, label, hint]) => (
          <button
            key={id}
            className={`wg-tool${coverage.mode === id ? ' on' : ''}`}
            aria-pressed={coverage.mode === id}
            onClick={() => wg.setCoverageMode(id)}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="wg-kinds">
        {KINDS.map(([id, label, hint]) => (
          <button
            key={id}
            className={`wg-kind${coverage.kinds[id] ? ' on' : ''}`}
            aria-pressed={coverage.kinds[id]}
            onClick={() => wg.toggleCoverageKind(id)}
            title={hint}
            disabled={coverage.mode === 'off'}
          >
            {label}
          </button>
        ))}
      </div>

      {horizonMatters && (
        <>
          <h4 className="wg-sub">Target altitude</h4>
          <div className="wg-kinds">
            {ALTITUDES.map(([metres, label]) => (
              <button
                key={metres}
                className={`wg-kind${coverage.targetAltM === metres ? ' on' : ''}`}
                onClick={() => wg.setTargetAltitude(metres)}
                title={`${metres.toLocaleString()} m`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="wg-note">
            Ground and sea radars are cut short by the earth’s curve. Switch to <b>Low</b> and a
            600 km detection range collapses to what it can actually see of something flying at
            100 m.
          </p>
        </>
      )}

      {coverage.mode !== 'off' && (
        <p className="wg-note">
          Rings are ground distance, not pixels — the same reach looks different at 60°N and at the
          equator because it is.
        </p>
      )}
    </section>
  );
}
