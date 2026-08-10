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
import type { Map as MLMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import { loadWorldData, type WorldData } from './data';
import { detectFont } from './mapLayers';
import {
  EMPTY_BOARD,
  NATION_COLORS,
  UNIT_BY_ID,
  allFormations,
  deriveAbbr,
  findFormation,
  loadBoard,
  nextUnitId,
  saveBoard,
  unitLook,
  type BoardState,
  type Component,
  type DeployedUnit,
  type Formation,
  type Nation,
} from './warGames';
import { ensureIcons, type IconSpec } from './unitIcons';
import {
  hideBasemapSymbols,
  highlightUnit,
  installWarLayers,
  paintNations,
  restoreBasemapSymbols,
  setUnits,
  setWarVisible,
} from './warLayers';

export type Tool = 'select' | 'paint' | 'deploy';

/** Mouse and touch both carry the two things dragging needs. */
type PointerLike = MapMouseEvent | MapTouchEvent;

/**
 * What the Deploy tool is holding: one class of unit at an echelon, or a
 * special unit with a composition. Keeping the two in one tagged value means
 * the panel and the deploy handler cannot disagree about which is armed.
 */
export type Pick = { kind: 'unit'; typeId: string } | { kind: 'formation'; formationId: string };

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

  /** Which catalogue the palette is showing, and what is picked in it. */
  pick: Pick;
  chooseUnit: (typeId: string) => void;
  chooseFormation: (formationId: string) => void;
  echelonId: string;
  setEchelonId: (id: string) => void;

  /** Composition the next special unit will be deployed with. */
  pendingComposition: Component[];
  setPendingComposition: (composition: Component[]) => void;

  formations: Formation[];
  createFormation: (name: string, composition: Component[]) => void;
  deleteFormation: (id: string) => void;

  selectedUnit: DeployedUnit | null;
  selectUnit: (id: string | null) => void;
  renameUnit: (id: string, name: string | undefined) => void;
  setUnitEchelon: (id: string, echelonId: string) => void;
  setUnitComposition: (id: string, composition: Component[]) => void;
  removeUnit: (id: string) => void;
  flyToUnit: (id: string) => void;

  clearUnits: () => void;
  clearNations: () => void;

  /** Re-installs layers and icons — call after a basemap swap. */
  hydrate: (map: MLMap) => void;
}

/** The whole board, which is the point of the mode. */
export const WORLD_VIEW = { center: [18, 26] as [number, number], zoom: 1.9 };

export function useWarGames({
  mapRef,
  mapReady,
  active,
  darkBasemap = true,
}: {
  mapRef: React.MutableRefObject<MLMap | null>;
  mapReady: boolean;
  active: boolean;
  /** Drives label ink: the board should read on whatever it is drawn on. */
  darkBasemap?: boolean;
}): WarGames {
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [world, setWorld] = useState<WorldData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>('paint');
  const [activeIso, setActiveIso] = useState<string | null>(null);
  const [color, setColor] = useState<string>(NATION_COLORS[0]);
  const [pick, setPick] = useState<Pick>({ kind: 'unit', typeId: 'infantry' });
  const [echelonId, setEchelonId] = useState('battalion');
  const [pendingComposition, setPendingComposition] = useState<Component[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const boardRef = useRef(board);
  const toolRef = useRef(tool);
  const activeIsoRef = useRef(activeIso);
  const colorRef = useRef(color);
  const pickRef = useRef(pick);
  const echelonRef = useRef(echelonId);
  const compositionRef = useRef(pendingComposition);
  const countriesRef = useRef<Map<string, CountryOption>>(new Map());
  const hydratedRef = useRef(false);

  boardRef.current = board;
  toolRef.current = tool;
  activeIsoRef.current = activeIso;
  colorRef.current = color;
  pickRef.current = pick;
  echelonRef.current = echelonId;
  compositionRef.current = pendingComposition;

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

  /** Every (symbol, mark, colour) combination the board currently shows. */
  const iconSpecs = useMemo<IconSpec[]>(() => {
    const specs = new Map<string, IconSpec>();
    for (const u of board.units) {
      const look = unitLook(u, board.formations);
      if (!look) continue;
      const color = board.nations[u.iso]?.color ?? '#9AA7B4';
      const key = `${look.key}|${JSON.stringify(look.mark)}|${color}`;
      if (!specs.has(key)) {
        specs.set(key, {
          typeId: look.key,
          glyph: look.glyph,
          domain: look.domain,
          color,
          mark: look.mark,
        });
      }
    }
    return [...specs.values()];
  }, [board]);

  const hydrate = useCallback(
    (map: MLMap) => {
      if (!world) return;
      installWarLayers(map, world, detectFont(map), darkBasemap);
      ensureIcons(map, iconSpecs);
      paintNations(map, boardRef.current.nations);
      setUnits(map, boardRef.current.units, boardRef.current.nations, boardRef.current.formations);
      highlightUnit(map, selectedId);
      setWarVisible(map, active);
      if (active) hideBasemapSymbols(map);
      hydratedRef.current = true;
    },
    [world, iconSpecs, selectedId, active, darkBasemap]
  );

  // Install on entry; the camera only jumps the first time, so leaving and
  // returning does not throw away where the player was looking.
  const enteredOnce = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!active) {
      if (hydratedRef.current) {
        setWarVisible(map, false);
        restoreBasemapSymbols(map);
      }
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
    setUnits(map, board.units, board.nations, board.formations);
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

  const chooseUnit = useCallback((typeId: string) => {
    const type = UNIT_BY_ID.get(typeId);
    if (!type) return;
    setPick({ kind: 'unit', typeId });
    // Keep the current echelon when the new type supports it, so switching
    // between, say, armour and infantry does not reset you to battalion.
    setEchelonId((prev) => (type.echelons.includes(prev) ? prev : type.defaultEchelon));
  }, []);

  const chooseFormation = useCallback((formationId: string) => {
    const formation = findFormation(formationId, boardRef.current.formations);
    if (!formation) return;
    setPick({ kind: 'formation', formationId });
    // The catalogue composition is a starting point, not a rule: it is copied
    // into the pending one so edits before deploying never write back to it.
    setPendingComposition(formation.composition.map((part) => ({ ...part })));
  }, []);

  const deploy = useCallback((lngLat: [number, number]) => {
    const iso = activeIsoRef.current;
    if (!iso) return;
    const current = pickRef.current;

    const unit: DeployedUnit =
      current.kind === 'formation'
        ? {
            kind: 'formation',
            id: nextUnitId(),
            iso,
            lngLat,
            formationId: current.formationId,
            composition: compositionRef.current
              .filter((part) => part.count > 0)
              .map((part) => ({ ...part })),
          }
        : {
            kind: 'unit',
            id: nextUnitId(),
            iso,
            lngLat,
            typeId: current.typeId,
            echelonId: echelonRef.current,
          };

    setBoard((prev) => ({ ...prev, units: [...prev.units, unit] }));
  }, []);

  /* ---------------- special units ---------------- */

  const createFormation = useCallback(
    (name: string, composition: Component[]) => {
      const clean = composition.filter((part) => part.count > 0 && UNIT_BY_ID.has(part.typeId));
      const label = name.trim();
      if (!label || !clean.length) return;
      const formation: Formation = {
        id: `custom-${nextUnitId()}`,
        label,
        abbr: deriveAbbr(label),
        composition: clean.map((part) => ({ ...part })),
        custom: true,
      };
      setBoard((prev) => ({ ...prev, formations: [...prev.formations, formation] }));
      setPick({ kind: 'formation', formationId: formation.id });
      setPendingComposition(formation.composition.map((part) => ({ ...part })));
    },
    []
  );

  const deleteFormation = useCallback((id: string) => {
    // Units already on the board keep their own composition, so deleting the
    // template does not disband what it was used to deploy — but they would
    // lose their name and icon, so they go with it.
    setBoard((prev) => ({
      ...prev,
      formations: prev.formations.filter((f) => f.id !== id),
      units: prev.units.filter((u) => !(u.kind === 'formation' && u.formationId === id)),
    }));
    setPick((prev) => (prev.kind === 'formation' && prev.formationId === id ? { kind: 'unit', typeId: 'infantry' } : prev));
  }, []);

  const patchUnit = useCallback((id: string, patch: (u: DeployedUnit) => DeployedUnit) => {
    setBoard((prev) => ({
      ...prev,
      units: prev.units.map((u) => (u.id === id ? patch(u) : u)),
    }));
  }, []);

  const moveUnit = useCallback(
    (id: string, lngLat: [number, number]) => patchUnit(id, (u) => ({ ...u, lngLat })),
    [patchUnit]
  );

  const renameUnit = useCallback(
    (id: string, name: string | undefined) => patchUnit(id, (u) => ({ ...u, name })),
    [patchUnit]
  );

  const setUnitEchelon = useCallback(
    (id: string, echelonId: string) =>
      patchUnit(id, (u) => (u.kind === 'unit' ? { ...u, echelonId } : u)),
    [patchUnit]
  );

  const setUnitComposition = useCallback(
    (id: string, composition: Component[]) =>
      patchUnit(id, (u) =>
        u.kind === 'formation' ? { ...u, composition: composition.filter((p) => p.count > 0) } : u
      ),
    [patchUnit]
  );

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
    let drag: {
      id: string;
      moved: boolean;
      lngLat: [number, number];
      /** Where the unit sat relative to the pointer when it was picked up. */
      offset: [number, number];
    } | null = null;

    /**
     * What is under the pointer, counting the selection ring as part of the
     * unit it belongs to. The ring is drawn larger than the icon, so a player
     * aiming at the obvious highlight would otherwise grab empty ocean — but
     * an icon under the pointer always wins over a ring around it.
     */
    const unitAt = (e: PointerLike) => {
      const layers = ['wg-unit', 'wg-unit-halo'].filter((id) => map.getLayer(id));
      if (!layers.length) return null;
      const hits = map.queryRenderedFeatures(e.point, { layers });
      const chosen = hits.find((h) => h.layer.id === 'wg-unit') ?? hits[0];
      const id = chosen?.properties?.id;
      return typeof id === 'string' ? id : null;
    };

    const onClick = (e: MapMouseEvent) => {
      // A click that ended a drag is a move, not a selection.
      if (drag?.moved) return;

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

    const beginDrag = (e: PointerLike) => {
      if (toolRef.current === 'deploy') return;
      const hit = unitAt(e);
      if (!hit) return;
      // Grabbing the edge of a unit must not teleport its centre under the
      // pointer: the unit keeps the offset it was picked up by.
      const held = boardRef.current.units.find((u) => u.id === hit);
      const offset: [number, number] = held
        ? [held.lngLat[0] - e.lngLat.lng, held.lngLat[1] - e.lngLat.lat]
        : [0, 0];
      drag = { id: hit, moved: false, lngLat: held?.lngLat ?? [e.lngLat.lng, e.lngLat.lat], offset };
      // Picking a unit up selects it, so the panel is already showing what you
      // are holding by the time you put it down.
      setSelectedId(hit);
      map.dragPan.disable();
      e.preventDefault();
    };

    const continueDrag = (e: PointerLike) => {
      if (!drag) {
        // Anything under the pointer that can be picked up says so.
        const over = toolRef.current === 'deploy' ? null : unitAt(e);
        canvas.style.cursor =
          toolRef.current === 'deploy' ? 'crosshair' : over ? 'grab' : toolRef.current === 'paint' ? 'copy' : '';
        return;
      }
      drag.moved = true;
      drag.lngLat = [e.lngLat.lng + drag.offset[0], e.lngLat.lat + drag.offset[1]];
      canvas.style.cursor = 'grabbing';
      // Push the drag straight to the source so the icon tracks the pointer at
      // frame rate; React hears about it once, on release.
      const units = boardRef.current.units.map((u) =>
        u.id === drag?.id ? { ...u, lngLat: drag.lngLat } : u
      );
      setUnits(map, units, boardRef.current.nations, boardRef.current.formations);
    };

    /**
     * Ends on the last position the drag reported rather than on the release
     * event, so a release the map never sees — off the canvas, off the window —
     * still drops the unit where the player left it instead of stranding the
     * map with panning switched off.
     */
    const endDrag = () => {
      if (!drag) return;
      const { id, moved, lngLat } = drag;
      map.dragPan.enable();
      canvas.style.cursor = '';
      if (moved) moveUnit(id, lngLat);
      // Let the click handler see the drag before it is cleared.
      const finished = drag;
      setTimeout(() => {
        if (drag === finished) drag = null;
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
    map.on('mousedown', beginDrag);
    map.on('mousemove', continueDrag);
    map.on('mouseup', endDrag);
    // Touch gets the same three events, so a unit can be dragged with a finger
    // rather than only with a mouse.
    map.on('touchstart', beginDrag);
    map.on('touchmove', continueDrag);
    map.on('touchend', endDrag);
    map.on('touchcancel', endDrag);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
    window.addEventListener('keydown', onKey);

    return () => {
      map.off('click', onClick);
      map.off('mousedown', beginDrag);
      map.off('mousemove', continueDrag);
      map.off('mouseup', endDrag);
      map.off('touchstart', beginDrag);
      map.off('touchmove', continueDrag);
      map.off('touchend', endDrag);
      map.off('touchcancel', endDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchend', endDrag);
      window.removeEventListener('keydown', onKey);
      map.dragPan.enable();
      canvas.style.cursor = '';
    };
  }, [active, mapReady, mapRef, deploy, applyColor, moveUnit, removeUnit, selectedId]);

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
    pick,
    chooseUnit,
    chooseFormation,
    echelonId,
    setEchelonId,
    pendingComposition,
    setPendingComposition,
    formations: allFormations(board.formations),
    createFormation,
    deleteFormation,
    selectedUnit,
    selectUnit: setSelectedId,
    renameUnit,
    setUnitEchelon,
    setUnitComposition,
    removeUnit,
    flyToUnit,
    clearUnits,
    clearNations,
    hydrate,
  };
}
