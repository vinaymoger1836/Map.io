'use client';

/**
 * War Games state, and the wiring that keeps the map in step with it.
 *
 * The board is the single source of truth: nations with colours, and units with
 * an owner and a position. Everything on screen — the fills, the icons, the
 * order of battle — is derived from it, so there is exactly one place to change
 * when the rules change.
 *
 * Map listeners are registered once per session and read live state through
 * refs. Re-binding them on every keystroke in the panel would drop clicks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap, MapMouseEvent } from 'maplibre-gl';

import { loadWorldData, type WorldData } from './data';
import { detectFont } from './mapLayers';
import {
  ECHELON_BY_ID,
  EMPTY_BOARD,
  NATION_COLORS,
  UNIT_BY_ID,
  loadBoard,
  nextUnitId,
  saveBoard,
  type BoardState,
  type DeployedUnit,
  type Nation,
} from './warGames';
import { ensureIcons, type IconSpec } from './unitIcons';
import {
  highlightUnit,
  installWarLayers,
  paintNations,
  setUnits,
  setWarVisible,
} from './warLayers';

export type Tool = 'select' | 'paint' | 'deploy';

export interface CountryOption {
  iso: string;
  name: string;
  continent: string;
  lngLat: [number, number];
}

export interface WarGames {
  ready: boolean;
  loading: boolean;
  error: string | null;

  board: BoardState;
  countries: CountryOption[];

  tool: Tool;
  setTool: (t: Tool) => void;

  activeIso: string | null;
  activeNation: Nation | null;
  chooseNation: (iso: string) => void;
  color: string;
  setColor: (hex: string) => void;
  applyColor: (iso: string, hex: string) => void;

  typeId: string;
  setTypeId: (id: string) => void;
  echelonId: string;
  setEchelonId: (id: string) => void;

  selectedUnit: DeployedUnit | null;
  selectUnit: (id: string | null) => void;
  updateUnit: (id: string, patch: Partial<DeployedUnit>) => void;
  removeUnit: (id: string) => void;
  flyToUnit: (id: string) => void;

  clearUnits: () => void;
  clearNations: () => void;
  resetBoard: () => void;

  /** Re-installs layers and icons — call after a basemap swap. */
  hydrate: (map: MLMap) => void;
}

/** The whole board, which is the point of the mode. */
export const WORLD_VIEW = { center: [18, 26] as [number, number], zoom: 1.9 };

export function useWarGames({
  mapRef,
  mapReady,
  active,
}: {
  mapRef: React.MutableRefObject<MLMap | null>;
  mapReady: boolean;
  active: boolean;
}): WarGames {
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [world, setWorld] = useState<WorldData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>('paint');
  const [activeIso, setActiveIso] = useState<string | null>(null);
  const [color, setColor] = useState<string>(NATION_COLORS[0]);
  const [typeId, setTypeIdState] = useState('infantry');
  const [echelonId, setEchelonId] = useState('battalion');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const boardRef = useRef(board);
  const toolRef = useRef(tool);
  const activeIsoRef = useRef(activeIso);
  const colorRef = useRef(color);
  const typeRef = useRef(typeId);
  const echelonRef = useRef(echelonId);
  const countriesRef = useRef<Map<string, CountryOption>>(new Map());
  const hydratedRef = useRef(false);

  boardRef.current = board;
  toolRef.current = tool;
  activeIsoRef.current = activeIso;
  colorRef.current = color;
  typeRef.current = typeId;
  echelonRef.current = echelonId;

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    setBoard(loadBoard());
  }, []);

  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    saveBoard(board);
  }, [board]);

  /* ---------------- world roster ---------------- */

  useEffect(() => {
    if (!active || world || loading) return;
    setLoading(true);
    loadWorldData()
      .then((data) => {
        if (!data.countries.features.length) {
          setError('World roster is empty — run `node scripts/generate-data.mjs`.');
        }
        setWorld(data);
      })
      .catch((err: unknown) => {
        console.error('[wargames] world roster failed to load.', err);
        setError('World roster failed to load.');
      })
      .finally(() => setLoading(false));
  }, [active, world, loading]);

  const countries = useMemo<CountryOption[]>(() => {
    if (!world) return [];
    const list = world.countries.features
      .map((f) => {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        const coords = (f.geometry as { coordinates?: [number, number] })?.coordinates;
        return {
          iso: String(p.iso ?? ''),
          name: String(p.name ?? ''),
          continent: String(p.continent ?? 'Other'),
          lngLat: (coords ?? [0, 0]) as [number, number],
        };
      })
      .filter((c) => c.iso && c.name);
    countriesRef.current = new Map(list.map((c) => [c.iso, c]));
    return list;
  }, [world]);

  /* ---------------- map sync ---------------- */

  /** Every (type, echelon mark, colour) combination the board currently shows. */
  const iconSpecs = useMemo<IconSpec[]>(() => {
    const specs = new Map<string, IconSpec>();
    for (const u of board.units) {
      const type = UNIT_BY_ID.get(u.typeId);
      if (!type) continue;
      const mark = ECHELON_BY_ID.get(u.echelonId)?.mark ?? { kind: 'none' as const };
      const nationColor = board.nations[u.iso]?.color ?? '#9AA7B4';
      const key = `${u.typeId}|${u.echelonId}|${nationColor}`;
      if (!specs.has(key)) {
        specs.set(key, {
          typeId: u.typeId,
          glyph: type.glyph,
          domain: type.domain,
          color: nationColor,
          mark,
        });
      }
    }
    return [...specs.values()];
  }, [board]);

  const hydrate = useCallback(
    (map: MLMap) => {
      if (!world) return;
      installWarLayers(map, world, detectFont(map));
      ensureIcons(map, iconSpecs);
      paintNations(map, boardRef.current.nations);
      setUnits(map, boardRef.current.units, boardRef.current.nations);
      highlightUnit(map, selectedId);
      setWarVisible(map, active);
      hydratedRef.current = true;
    },
    [world, iconSpecs, selectedId, active]
  );

  // Install on entry; the camera only jumps the first time, so leaving and
  // returning does not throw away where the player was looking.
  const enteredOnce = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!active) {
      if (hydratedRef.current) setWarVisible(map, false);
      return;
    }
    if (!world) return;

    hydrate(map);
    if (!enteredOnce.current) {
      enteredOnce.current = true;
      map.flyTo({ ...WORLD_VIEW, duration: 1400 });
    }
  }, [active, mapReady, world, hydrate, mapRef]);

  // Board changes are pushed straight at the map rather than through a
  // re-install: setData plus a paint property is a frame, an install is a stall.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;
    ensureIcons(map, iconSpecs);
    paintNations(map, board.nations);
    setUnits(map, board.units, board.nations);
  }, [board, iconSpecs, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;
    highlightUnit(map, selectedId);
  }, [selectedId, mapRef]);

  /* ---------------- mutations ---------------- */

  const applyColor = useCallback((iso: string, hex: string) => {
    const meta = countriesRef.current.get(iso);
    setBoard((prev) => ({
      ...prev,
      nations: {
        ...prev.nations,
        [iso]: { iso, name: meta?.name ?? prev.nations[iso]?.name ?? iso, color: hex },
      },
    }));
  }, []);

  const chooseNation = useCallback(
    (iso: string) => {
      setActiveIso(iso);
      const existing = boardRef.current.nations[iso];
      if (existing) setColor(existing.color);
      else applyColor(iso, colorRef.current);
    },
    [applyColor]
  );

  const setTypeId = useCallback((id: string) => {
    setTypeIdState(id);
    const type = UNIT_BY_ID.get(id);
    if (!type) return;
    // Keep the current echelon when the new type supports it, so switching
    // between, say, armour and infantry does not reset you to battalion.
    setEchelonId((prev) => (type.echelons.includes(prev) ? prev : type.defaultEchelon));
  }, []);

  const deploy = useCallback((lngLat: [number, number]) => {
    const iso = activeIsoRef.current;
    if (!iso) return;
    const unit: DeployedUnit = {
      id: nextUnitId(),
      typeId: typeRef.current,
      echelonId: echelonRef.current,
      iso,
      lngLat,
    };
    setBoard((prev) => ({ ...prev, units: [...prev.units, unit] }));
  }, []);

  const updateUnit = useCallback((id: string, patch: Partial<DeployedUnit>) => {
    setBoard((prev) => ({
      ...prev,
      units: prev.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }));
  }, []);

  const removeUnit = useCallback((id: string) => {
    setBoard((prev) => ({ ...prev, units: prev.units.filter((u) => u.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const clearUnits = useCallback(() => {
    setBoard((prev) => ({ ...prev, units: [] }));
    setSelectedId(null);
  }, []);

  const clearNations = useCallback(() => {
    setBoard((prev) => ({ ...prev, nations: {} }));
  }, []);

  const resetBoard = useCallback(() => {
    setBoard(EMPTY_BOARD);
    setSelectedId(null);
    setActiveIso(null);
  }, []);

  const flyToUnit = useCallback(
    (id: string) => {
      const unit = boardRef.current.units.find((u) => u.id === id);
      const map = mapRef.current;
      if (!unit || !map) return;
      map.easeTo({ center: unit.lngLat, zoom: Math.max(map.getZoom(), 4.6), duration: 800 });
    },
    [mapRef]
  );

  /* ---------------- map interaction ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !active) return;

    const canvas = map.getCanvas();
    let dragging: { id: string; moved: boolean } | null = null;

    const unitAt = (e: MapMouseEvent) => {
      if (!map.getLayer('wg-unit')) return null;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['wg-unit'] });
      const id = hits[0]?.properties?.id;
      return typeof id === 'string' ? id : null;
    };

    const onClick = (e: MapMouseEvent) => {
      // A click that ended a drag is a move, not a selection.
      if (dragging?.moved) return;

      if (toolRef.current === 'deploy') {
        deploy([e.lngLat.lng, e.lngLat.lat]);
        return;
      }

      const hit = unitAt(e);
      if (hit) {
        setSelectedId(hit);
        return;
      }

      if (toolRef.current === 'paint' && map.getLayer('wg-nation-fill')) {
        const country = map.queryRenderedFeatures(e.point, { layers: ['wg-nation-fill'] })[0];
        const iso = country?.properties?.iso;
        if (typeof iso === 'string' && iso) {
          setActiveIso(iso);
          applyColor(iso, colorRef.current);
          return;
        }
      }
      setSelectedId(null);
    };

    const onDown = (e: MapMouseEvent) => {
      if (toolRef.current === 'deploy') return;
      const hit = unitAt(e);
      if (!hit) return;
      dragging = { id: hit, moved: false };
      setSelectedId(hit);
      map.dragPan.disable();
      e.preventDefault();
    };

    const onMove = (e: MapMouseEvent) => {
      if (!dragging) {
        // Anything under the pointer that can be picked up says so.
        const over = toolRef.current === 'deploy' ? null : unitAt(e);
        canvas.style.cursor =
          toolRef.current === 'deploy' ? 'crosshair' : over ? 'grab' : toolRef.current === 'paint' ? 'copy' : '';
        return;
      }
      dragging.moved = true;
      canvas.style.cursor = 'grabbing';
      const next: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      // Push the drag straight to the source so the icon tracks the pointer at
      // frame rate; React hears about it once, on release.
      const units = boardRef.current.units.map((u) =>
        u.id === dragging?.id ? { ...u, lngLat: next } : u
      );
      setUnits(map, units, boardRef.current.nations);
    };

    const onUp = (e: MapMouseEvent) => {
      if (!dragging) return;
      const { id, moved } = dragging;
      map.dragPan.enable();
      canvas.style.cursor = '';
      if (moved) updateUnit(id, { lngLat: [e.lngLat.lng, e.lngLat.lat] });
      // Let the click handler see the drag before it is cleared.
      const finished = dragging;
      setTimeout(() => {
        if (dragging === finished) dragging = null;
      }, 0);
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'Escape') setTool('select');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeUnit(selectedId);
      }
    };

    map.on('click', onClick);
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    window.addEventListener('keydown', onKey);

    return () => {
      map.off('click', onClick);
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      map.dragPan.enable();
      canvas.style.cursor = '';
    };
  }, [active, mapReady, mapRef, deploy, applyColor, updateUnit, removeUnit, selectedId]);

  // The cursor is the clearest statement of which tool is armed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !active) return;
    map.getCanvas().style.cursor = tool === 'deploy' ? 'crosshair' : tool === 'paint' ? 'copy' : '';
  }, [tool, active, mapRef]);

  const selectedUnit = useMemo(
    () => board.units.find((u) => u.id === selectedId) ?? null,
    [board.units, selectedId]
  );

  return {
    ready: Boolean(world),
    loading,
    error,
    board,
    countries,
    tool,
    setTool,
    activeIso,
    activeNation: activeIso ? (board.nations[activeIso] ?? null) : null,
    chooseNation,
    color,
    setColor,
    applyColor,
    typeId,
    setTypeId,
    echelonId,
    setEchelonId,
    selectedUnit,
    selectUnit: setSelectedId,
    updateUnit,
    removeUnit,
    flyToUnit,
    clearUnits,
    clearNations,
    resetBoard,
    hydrate,
  };
}
