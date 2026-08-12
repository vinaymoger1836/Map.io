'use client';

/**
 * The War Games console.
 *
 * Composition only. Four sections rather than one long scroll: arranging the
 * board, describing equipment, counting what each nation has, and keeping whole
 * boards. Each is a different job, and putting them in one column meant the
 * colour picker sat above whatever you were actually doing.
 */

import { useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';

import { ArmamentsSection } from './wargames/SystemsEditor';
import { ForcesSection } from './wargames/ForcesSection';
import { EngagementSection } from './wargames/EngagementSection';
import { MapSection } from './wargames/MapSection';
import { ScenariosSection } from './wargames/ScenariosSection';
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
          raid: undefined,
          boards: wg.scenarios.length || undefined,
        }}
      />

      {section === 'map' && <MapSection wg={wg} color={paintColor} />}
      {section === 'armaments' && <ArmamentsSection wg={wg} color={paintColor} />}
      {section === 'forces' && <ForcesSection wg={wg} />}
      {section === 'raid' && <EngagementSection wg={wg} />}
      {section === 'boards' && <ScenariosSection wg={wg} />}

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
