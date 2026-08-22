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
import { TheaterSection } from './wargames/TheaterSection';
import { MapSection } from './wargames/MapSection';
import { ScenariosSection } from './wargames/ScenariosSection';
import { SectionNav, type Section } from './wargames/SectionNav';
import { NEUTRAL } from './wargames/icons';

export interface WarGamesPanelProps extends WarGames {
  onOpenConfiguration?: () => void;
  onOpenWarSim?: () => void;
}

export default function WarGamesPanel({ onOpenConfiguration, onOpenWarSim, ...wg }: WarGamesPanelProps) {
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
          raid: undefined,
          theater: wg.theaterPhases.length || undefined,
          boards: wg.scenarios.length || undefined,
        }}
        onOpenConfiguration={onOpenConfiguration}
        onOpenWarSim={onOpenWarSim}
      />

      {section === 'map' && <MapSection wg={wg} color={paintColor} />}
      {section === 'raid' && <EngagementSection wg={wg} />}
      {section === 'theater' && <TheaterSection wg={wg} />}
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
