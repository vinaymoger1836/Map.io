'use client';

/**
 * Panel-side icon previews.
 *
 * The map draws its symbols into MapLibre images; the console is HTML and needs
 * data URLs instead. Same factory, different destination — and the same reason
 * for a cache: rasterising forty icons on every keystroke in a search box is a
 * waste nobody would notice writing and everybody would notice using.
 */

import { iconDataUrl } from '@/lib/unitIcons';
import {
  ECHELON_BY_ID,
  UNIT_BY_ID,
  findFormation,
  formationLook,
  type DeployedUnit,
  type Domain,
  type EchelonMark,
  type Formation,
} from '@/lib/warGames';

export const NEUTRAL = '#9AA7B4';

const cache = new Map<string, string>();

function icon(key: string, domain: Domain, glyph: string, mark: EchelonMark, color: string): string {
  const cacheKey = `${key}|${JSON.stringify(mark)}|${color}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const url = iconDataUrl({ typeId: key, glyph, domain, color, mark });
  cache.set(cacheKey, url);
  return url;
}

export function unitPreview(typeId: string, color: string, echelonId?: string): string {
  const type = UNIT_BY_ID.get(typeId);
  if (!type) return '';
  const mark: EchelonMark = echelonId
    ? (ECHELON_BY_ID.get(echelonId)?.mark ?? { kind: 'none' })
    : { kind: 'none' };
  return icon(typeId, type.domain, type.glyph, mark, color);
}

export function formationPreview(formation: Formation, color: string): string {
  const look = formationLook(formation);
  return icon(`f:${formation.id}`, look.domain, look.glyph, { kind: 'text', text: formation.abbr }, color);
}

export function deployedPreview(u: DeployedUnit, custom: Formation[], color: string): string {
  if (u.kind === 'formation') {
    const formation = findFormation(u.formationId, custom);
    return formation ? formationPreview(formation, color) : '';
  }
  return unitPreview(u.typeId, color, u.echelonId);
}
