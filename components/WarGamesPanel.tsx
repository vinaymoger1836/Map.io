'use client';

/**
 * The War Games console.
 *
 * Composition only. Three sections rather than one long scroll: arranging the
 * board, describing equipment, and counting what each nation has. Each is a
 * different job, and putting them in one column meant the colour picker sat
 * above whatever you were actually doing.
 */

import { useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';

import { ArmamentsSection } from './wargames/SystemsEditor';
import { ForcesSection } from './wargames/ForcesSection';
import { MapSection } from './wargames/MapSection';
import { SectionNav, type Section } from './wargames/SectionNav';
import { NEUTRAL } from './wargames/icons';

export default function WarGamesPanel(wg: WarGames) {
  const [section, setSection] = useState<Section>('map');
  const activeColor = wg.activeNation?.color ?? wg.color;
  const paintColor = wg.activeIso ? activeColor : NEUTRAL;

  return (
    <div className="wg">
      <SectionNav
        section={section}
        onChange={setSection}
        counts={{
          map: undefined,
          armaments: wg.systems.length,
          forces: wg.board.units.length,
        }}
      />

      {section === 'map' && <MapSection wg={wg} color={paintColor} />}
      {section === 'armaments' && <ArmamentsSection wg={wg} color={paintColor} />}
      {section === 'forces' && <ForcesSection wg={wg} />}

      <p className="wg-storage">
        {wg.storageKind === 'files'
          ? 'Saved to data/ on this machine.'
          : wg.storageKind === 'browser'
            ? 'Saved in this browser only — the file store is unavailable.'
            : 'Loading…'}
      </p>

      {wg.error && <p className="wg-error">{wg.error}</p>}
    </div>
  );
}
