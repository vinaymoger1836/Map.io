'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';

import ControlPanel from './ControlPanel';
import DetailPanel, { type Selection } from './DetailPanel';
import ReadoutRail from './ReadoutRail';
import WarGamesPanel from './WarGamesPanel';
import { EnvelopeTip } from './wargames/EnvelopeTip';

import { loadMapData, type MapData } from '@/lib/data';
import {
  ARCTIC_KEYS,
  DEFAULT_VISIBILITY,
  KEY_LAYERS,
} from '@/lib/layerSpec';
import { INTERACTIVE_LAYERS, applyVisibility, installLayers } from '@/lib/mapLayers';
import { WORLD_VIEW, useWarGames } from '@/lib/useWarGames';
import { PlaybackHUD } from './wargames/PlaybackHUD';
import { ConfigurationSuite } from './wargames/ConfigurationSuite';
import { WarSimLauncher } from './wargames/WarSimLauncher';
import { WarSimConsole } from './wargames/WarSimConsole';
import { WarSimAarModal } from './wargames/WarSimAarModal';
import { useWarSim } from '@/lib/useWarSim';
import { renderWarSimStateToMap, removeWarSimLayers, updateWarSimPatrolPreview } from '@/lib/warSimLayers';
import { type WarSimSession } from '@/lib/warSimTypes';

/**
 * Two modes share one map. The situation map is the published assessment;
 * War Games is the sandbox on top of the same globe. Both keep their layers
 * installed and swap visibility, so switching is instant and neither mode has
 * to rebuild the world to be looked at.
 */
type Mode = 'situation' | 'wargames';

/**
 * The only situation-map layers War Games keeps. Ocean and sea names are
 * geography rather than assessment, and the board silences the basemap's own
 * labels — without these the water would be anonymous.
 */
const WARGAMES_VISIBILITY: Record<string, boolean> = { 'wt-ocean': true, 'wt-sea': true };

const BASEMAPS = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://tiles.openfreemap.org/styles/positron',
  detail: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

type BasemapId = keyof typeof BASEMAPS;

type Projection = 'mercator' | 'globe';

/** MapLibre's setProjection is version- and GPU-dependent; never call it bare. */
function rawSetProjection(map: MLMap, type: Projection): boolean {
  const setProj = (map as unknown as { setProjection?: (p: unknown) => void }).setProjection;
  if (typeof setProj !== 'function') return false;
  try {
    setProj.call(map, { type });
    return true;
  } catch (err) {
    console.error(`[map] setProjection({ type: '${type}' }) threw.`, err);
    return false;
  }
}

/**
 * Probe globe once at load: if the call is missing or throws we stay on
 * Mercator rather than handing the user a projection that blanks the canvas.
 */
function globeIsUsable(map: MLMap): boolean {
  if (!rawSetProjection(map, 'globe')) return false;
  const restored = rawSetProjection(map, 'mercator');
  if (!restored) console.error('[map] could not restore mercator after globe probe.');
  return restored;
}

const HOME = { center: [24, 52] as [number, number], zoom: 3.1 };
const ARCTIC_VIEW = { center: [60, 78] as [number, number], zoom: 2.2 };
const WAR_VIEW = { center: [36.2, 47.9] as [number, number], zoom: 6.2 };

export default function EurasiaMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const dataRef = useRef<MapData | null>(null);
  const visibilityRef = useRef(DEFAULT_VISIBILITY);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY);
  const [basemap, setBasemap] = useState<BasemapId>('dark');
  const [projection, setProjection] = useState<'mercator' | 'globe'>('mercator');
  const [projectionNote, setProjectionNote] = useState<string | null>(null);
  const [globeSupported, setGlobeSupported] = useState(true);
  const [errorBurst, setErrorBurst] = useState<string | null>(null);
  const [zoom, setZoom] = useState(HOME.zoom);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mode, setMode] = useState<Mode>('situation');
  const [configOpen, setConfigOpen] = useState(false);
  const [warSimLauncherOpen, setWarSimLauncherOpen] = useState(false);
  const [activeWarSimSession, setActiveWarSimSession] = useState<WarSimSession | null>(null);
  const [warSimAarOpen, setWarSimAarOpen] = useState(false);

  const modeRef = useRef(mode);
  const warHydrateRef = useRef<((map: MLMap) => void) | null>(null);

  visibilityRef.current = visibility;
  modeRef.current = mode;

  const war = useWarGames({
    mapRef,
    mapReady: ready,
    active: mode === 'wargames',
    simulationActive: Boolean(activeWarSimSession),
    darkBasemap: basemap === 'dark',
  });
  warHydrateRef.current = war.hydrate;

  const warSim = useWarSim({
    initialSession: activeWarSimSession,
    systemsLibrary: war.systems,
    mapRef,
    onClose: () => setActiveWarSimSession(null),
  });

  // Sync War Sim state to MapLibre layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || mode !== 'wargames' || !warSim.session) return;
    renderWarSimStateToMap(
      map,
      warSim.session,
      warSim.session.activeFaction,
      warSim.targetPicking,
      warSim.selectedEntityId,
      war.systems,
      warSim.activeWeaponIndex,
      warSim.showAllEnvelopes
    );
  }, [ready, mode, warSim.session, warSim.targetPicking, warSim.selectedEntityId, war.systems, warSim.activeWeaponIndex, warSim.showAllEnvelopes]);

  // Real-time Cursor Patrol Orbit Preview
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || mode !== 'wargames' || !warSim.session) return;
    updateWarSimPatrolPreview(map, warSim.targetPicking, cursor);
  }, [cursor, warSim.targetPicking, ready, mode, warSim.session]);

  // War Sim Map Click & Interaction
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || mode !== 'wargames' || !warSim.session) return;

    const onSimClick = (e: maplibregl.MapMouseEvent) => {
      // If currently designating a target (sortie, autonomous battery, base placement)
      if (warSim.targetPicking) {
        warSim.confirmTargetPick([e.lngLat.lng, e.lngLat.lat]);
        return;
      }

      const layers = ['warsim-bases-circle', 'warsim-entities-symbol', 'warsim-contacts-circle', 'warsim-contacts-label'].filter(
        (id) => map.getLayer(id)
      );
      const hits = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      if (hits.length > 0) {
        const props = (hits[0].properties || {}) as Record<string, string>;
        const layerId = hits[0].layer.id;

        if (layerId === 'warsim-bases-circle' && props.id) {
          warSim.setSelectedBaseId(props.id);
        } else if (layerId === 'warsim-entities-symbol' && props.id) {
          warSim.setSelectedEntityId(props.id);
          warSim.setSelectedContactId(null);
        } else if ((layerId === 'warsim-contacts-circle' || layerId === 'warsim-contacts-label') && props.id) {
          warSim.setSelectedContactId(props.id);
          warSim.setSelectedEntityId(null);
        }
      } else {
        warSim.setSelectedBaseId(null);
        warSim.setSelectedEntityId(null);
        warSim.setSelectedContactId(null);
      }
    };

    map.on('click', onSimClick);
    return () => {
      map.off('click', onSimClick);
    };
  }, [
    ready,
    mode,
    warSim.session,
    warSim.targetPicking,
    warSim.confirmTargetPick,
    warSim.setSelectedBaseId,
    warSim.setSelectedEntityId,
    warSim.setSelectedContactId,
  ]);

  /** Re-adds every source and layer. Safe to call after a basemap swap. */
  const hydrate = useCallback((map: MLMap) => {
    if (!dataRef.current) return;
    installLayers(map, dataRef.current);
    // War Games owns the screen when it is open, so the situation layers stay
    // dark rather than bleeding a Ukraine front line across a global board.
    applyVisibility(map, KEY_LAYERS, modeRef.current === 'wargames' ? WARGAMES_VISIBILITY : visibilityRef.current);
    warHydrateRef.current?.(map);
  }, []);

/** Tear the map down a tick late so a StrictMode remount can cancel it. */
  const scheduleDispose = useCallback(() => {
    disposeTimer.current = setTimeout(() => {
      disposeRef.current?.();
      disposeRef.current = null;
      mapRef.current = null;
      disposeTimer.current = null;
      setReady(false);
    }, 0);
  }, []);

  /* ---------------- map bootstrap ---------------- */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React StrictMode runs cleanup and setup in the same tick, so the old code
    // built a WebGL map, destroyed it, and built another one on every dev mount.
    // Deferring disposal by a tick lets the re-setup cancel it and reuse the
    // instance instead, which avoids that churn entirely.
    if (disposeTimer.current !== null) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }

    if (mapRef.current) return scheduleDispose;

    const map = new maplibregl.Map({
      container,
      style: BASEMAPS.dark,
      center: HOME.center,
      zoom: HOME.zoom,
      minZoom: 1.4,
      maxZoom: 12,
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;

    // A handle on the map in development, so layer and source state can be
    // inspected from the console without instrumenting the component.
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __map?: MLMap }).__map = map;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    // Every map error gets logged. A blank canvas with a silent console was the
    // hardest part of the last outage to diagnose — tile, source and WebGL
    // failures used to be swallowed here.
    const recentErrors: number[] = [];
    map.on('error', (e) => {
      const message = e?.error?.message ?? String(e?.error ?? 'unknown map error');
      console.error('[map]', message, e?.error ?? e);

      if (message.includes('style')) setBootError(message);

      const now = Date.now();
      recentErrors.push(now);
      while (recentErrors.length && now - recentErrors[0] > 5000) recentErrors.shift();
      if (recentErrors.length > 5) {
        setErrorBurst(`${recentErrors.length} map errors in the last few seconds — latest: ${message}`);
      }
    });

    map.on('zoom', () => setZoom(map.getZoom()));
    map.on('mousemove', (e) => setCursor([e.lngLat.lng, e.lngLat.lat]));
    map.on('mouseout', () => setCursor(null));
    // Only so a tooltip near the right edge knows to sit on the other side.
    map.on('resize', () => setCanvasWidth(map.getCanvas().clientWidth));

    let disposed = false;
    disposeRef.current = () => {
      disposed = true;
      map.remove();
    };

    // The style load and the data fetch race in either order, so whichever
    // lands last starts the map. Registering the `load` listener synchronously
    // means it can never be missed while the fetch is in flight — the old code
    // registered it after the await and checked isStyleLoaded(), which reports
    // false whenever a tile request is still outstanding, so it could wait
    // forever on a `load` that had already fired.
    let styleLoaded = false;
    let data: MapData | null = null;

    const startWhenReady = () => {
      if (disposed || !styleLoaded || !data) return;
      dataRef.current = data;
      setCanvasWidth(map.getCanvas().clientWidth);
      hydrate(map);
      if (!globeIsUsable(map)) {
        setGlobeSupported(false);
        setProjection('mercator');
        setProjectionNote(
          'Globe projection unavailable here — the Arctic view stays on Mercator, so the pole is distorted.'
        );
      }
      setReady(true);
    };

    map.once('load', () => {
      styleLoaded = true;
      startWhenReady();
    });

    (async () => {
      const loaded = await loadMapData();
      if (disposed) return;
      data = loaded;
      if (loaded.countriesFailed) {
        setDataWarning('Country geometry unavailable — border and alliance layers are empty.');
      }
      startWhenReady();
    })();

    return scheduleDispose;
  }, [hydrate, scheduleDispose]);

  /* ---------------- interaction ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || mode !== 'situation') return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const live = INTERACTIVE_LAYERS.filter((id) => {
        if (!map.getLayer(id)) return false;
        return map.getLayoutProperty(id, 'visibility') !== 'none';
      });
      const hits = map.queryRenderedFeatures(e.point, { layers: live });
      if (!hits.length) {
        setSelection(null);
        return;
      }
      const props = (hits[0].properties ?? {}) as Record<string, string>;
      if (!props.name) return;
      setSelection({
        name: props.name,
        kind: props.kind,
        status: props.status,
        note: props.note,
        claimant: props.claimant,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      });
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const live = INTERACTIVE_LAYERS.filter(
        (id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none'
      );
      const hits = live.length ? map.queryRenderedFeatures(e.point, { layers: live }) : [];
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
    };

    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.getCanvas().style.cursor = '';
    };
  }, [ready, mode]);

  /* ---------------- toggles ---------------- */

  const toggle = useCallback((id: string) => {
    setVisibility((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const map = mapRef.current;
      if (map) applyVisibility(map, KEY_LAYERS, next);
      return next;
    });
  }, []);

  const arcticOn = ARCTIC_KEYS.every((k) => visibility[k]);

  const toggleArctic = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const turningOn = !ARCTIC_KEYS.every((k) => visibilityRef.current[k]);

    setVisibility((prev) => {
      const next = { ...prev };
      for (const k of ARCTIC_KEYS) next[k] = turningOn;
      applyVisibility(map, KEY_LAYERS, next);
      return next;
    });

    // The Arctic only reads properly on a sphere — Mercator tears the pole apart.
    // If globe is unavailable we still show the layers, just flattened.
    if (turningOn && globeSupported) {
      if (rawSetProjection(map, 'globe')) {
        setProjection('globe');
        setProjectionNote(null);
      } else {
        rawSetProjection(map, 'mercator');
        setProjection('mercator');
        setGlobeSupported(false);
        setProjectionNote('Globe projection failed — showing the Arctic on Mercator, so the pole is distorted.');
      }
    } else if (!turningOn) {
      rawSetProjection(map, 'mercator');
      setProjection('mercator');
    }

    map.flyTo(turningOn ? { ...ARCTIC_VIEW, duration: 1400 } : { ...HOME, duration: 1200 });
  }, [globeSupported]);

  const changeBasemap = useCallback(
    (id: BasemapId) => {
      const map = mapRef.current;
      if (!map || id === basemap) return;
      setBasemap(id);
      map.setStyle(BASEMAPS[id]);
      map.once('styledata', () => hydrate(map));
    },
    [basemap, hydrate]
  );

  const flyTo = useCallback((view: { center: [number, number]; zoom: number }) => {
    mapRef.current?.flyTo({ ...view, duration: 1200 });
  }, []);

  /**
   * Reset returns the whole view to its initial state — camera, layers and
   * projection. Previously it only flew home, which stranded anyone who reset
   * while on the globe with no way back to Mercator except re-toggling Arctic.
   */
  const reset = useCallback(() => {
    const map = mapRef.current;
    setVisibility(DEFAULT_VISIBILITY);
    if (map) {
      applyVisibility(map, KEY_LAYERS, DEFAULT_VISIBILITY);
      rawSetProjection(map, 'mercator');
      map.flyTo({ ...HOME, duration: 1200 });
    }
    setProjection('mercator');
    setSelection(null);
  }, []);

  const activeLayers = useMemo(
    () => Object.values(visibility).filter(Boolean).length,
    [visibility]
  );

  /**
   * Switching modes is a visibility change, not a rebuild. Leaving War Games
   * also returns the camera and projection to the situation map's home, because
   * arriving back on the far side of the Pacific with the front line switched
   * on reads as a bug even though nothing is broken.
   */
  const switchMode = useCallback(
    (next: Mode) => {
      const map = mapRef.current;
      if (next === mode) return;
      setSelection(null);
      setMode(next);
      if (!map) return;

      applyVisibility(map, KEY_LAYERS, next === 'wargames' ? WARGAMES_VISIBILITY : visibilityRef.current);
      if (next === 'situation') {
        rawSetProjection(map, 'mercator');
        setProjection('mercator');
        map.flyTo({ ...HOME, duration: 1200 });
      }
    },
    [mode]
  );

  /* ---------------- render ---------------- */

  return (
    <div className="shell">
      <div className="map-stage">
        <div className="map-canvas" ref={containerRef} />

        {!ready && (
          <div className="map-boot">
            {bootError ? `Basemap failed to load — ${bootError}` : 'Loading map'}
          </div>
        )}

        {errorBurst && (
          <div className="map-alert" role="alert">
            {errorBurst}
            <br />
            See the console for the full list.
          </div>
        )}

        {!warSim.session && (
          <header className={`masthead${mode === 'wargames' ? ' wargames' : ''}`}>
            <h1>{mode === 'wargames' ? 'War Games' : 'Eurasia'}</h1>
            <div className="sub">
              {mode === 'wargames'
                ? 'Paint nations · deploy forces · the whole board'
                : 'Borders · blocs · energy · the front'}
            </div>
          </header>
        )}

        {!warSim.session && (
          <div className="actions">
            {mode === 'situation' ? (
              <>
                <button className="action" onClick={() => flyTo(WAR_VIEW)}>
                  The front
                </button>
                <button
                  className={`action${arcticOn ? ' active' : ''}`}
                  aria-pressed={arcticOn}
                  onClick={toggleArctic}
                  title={
                    globeSupported ? undefined : 'Globe projection unavailable — polar view will be distorted'
                  }
                >
                  {globeSupported ? 'Arctic' : 'Arctic (flat)'}
                </button>
                <button className="action" onClick={reset}>
                  Reset
                </button>
              </>
            ) : (
              <>
                <button className="action" onClick={() => flyTo(WORLD_VIEW)}>
                  World view
                </button>
                <button className="action" onClick={() => switchMode('situation')}>
                  Situation map
                </button>
                <button
                  className="action"
                  style={{ color: '#4FA85F', borderColor: 'rgba(79, 168, 95, 0.6)', fontWeight: 600 }}
                  onClick={() => setWarSimLauncherOpen(true)}
                >
                  ⚔️ War Sim
                </button>
                <button className="action accent" onClick={() => setConfigOpen(true)}>
                  ⚙️ Configuration
                </button>
              </>
            )}
            <button
              className="action"
              onClick={() =>
                changeBasemap(basemap === 'dark' ? 'light' : basemap === 'light' ? 'detail' : 'dark')
              }
            >
              {basemap}
            </button>
            {mode === 'situation' && (
              <button className="action accent" onClick={() => switchMode('wargames')}>
                War games
              </button>
            )}
          </div>
        )}

        {!warSim.session && (
          panelOpen ? (
            <div className={`panel${mode === 'wargames' ? ' panel-wide' : ''}`}>
              {mode === 'wargames' ? (
                <WarGamesPanel
                  {...war}
                  onOpenConfiguration={() => setConfigOpen(true)}
                  onOpenWarSim={() => setWarSimLauncherOpen(true)}
                />
              ) : (
                <ControlPanel
                  state={visibility}
                  onToggle={toggle}
                  asOf="1 Aug 2026"
                  warning={dataWarning}
                  note={projectionNote}
                />
              )}
              <button
                className="panel-toggle"
                style={{ position: 'static', borderLeft: 0, borderRight: 0, borderBottom: 0 }}
                onClick={() => setPanelOpen(false)}
              >
                {mode === 'wargames' ? 'Hide console' : 'Hide layers'}
              </button>
            </div>
          ) : (
            <button className="panel-toggle" onClick={() => setPanelOpen(true)}>
              {mode === 'wargames' ? `Console · ${war.board.units.length} units` : `Layers · ${activeLayers} on`}
            </button>
          )
        )}

        {mode === 'wargames' && war.loading && <div className="wg-loading">Loading world roster…</div>}

        {mode === 'wargames' && war.hoveredEnvelope && (
          <EnvelopeTip hover={war.hoveredEnvelope} width={canvasWidth} />
        )}

        {mode === 'wargames' && war.playbackActive && war.playbackModel && war.playbackFrame && (
          <PlaybackHUD
            model={war.playbackModel}
            frame={war.playbackFrame}
            isPlaying={war.playbackPlaying}
            playbackSpeed={war.playbackSpeed}
            onTogglePlay={war.togglePlayPlayback}
            onSeek={war.seekPlayback}
            onSetSpeed={war.setPlaybackSpeed}
            onClose={war.stopPlayback}
          />
        )}

        {configOpen && (
          <ConfigurationSuite
            wg={war}
            onClose={() => setConfigOpen(false)}
          />
        )}

        {warSimLauncherOpen && (
          <WarSimLauncher
            wg={war}
            isOpen={warSimLauncherOpen}
            onClose={() => setWarSimLauncherOpen(false)}
            onLaunchSimulation={(session) => {
              // 1. Atomically reset board to only the 2 selected simulation nations in their colors
              war.setSimulationNations(session.playerIso, session.playerColor, session.enemyIso, session.enemyColor);
              // 2. Launch the simulation session
              setActiveWarSimSession(session);
              setWarSimLauncherOpen(false);
            }}
            onOpenConfiguration={(sysId) => {
              setWarSimLauncherOpen(false);
              setConfigOpen(true);
            }}
          />
        )}

        {mode === 'wargames' && warSim.session && (
          <WarSimConsole
            session={warSim.session}
            isPlaying={warSim.isPlaying}
            onTogglePlay={warSim.togglePlay}
            speedMultiplier={warSim.speedMultiplier}
            onSetSpeed={warSim.setSpeedMultiplier}
            onSwitchFaction={warSim.switchActiveFaction}
            friendlyBases={warSim.friendlyBases}
            friendlyEntities={warSim.friendlyEntities}
            visibleContacts={warSim.visibleContacts}
            selectedBase={warSim.selectedBase}
            onSelectBase={warSim.setSelectedBaseId}
            selectedEntity={warSim.selectedEntity}
            onSelectEntity={warSim.setSelectedEntityId}
            selectedContact={warSim.selectedContact}
            onSelectContact={warSim.setSelectedContactId}
            onOrderStrike={(params) => {
              warSim.orderStrike(
                params.attackerEntityId,
                params.targetEntityId,
                params.targetLngLat,
                params.weaponIndex,
                params.postStrikeAction,
                params.customPostLngLat
              );
            }}
            activeWeaponIndex={warSim.activeWeaponIndex}
            onToggleWeapon={(idx) => {
              warSim.setActiveWeaponIndex(warSim.activeWeaponIndex === idx ? null : idx);
            }}
            showAllEnvelopes={warSim.showAllEnvelopes}
            onToggleShowAllEnvelopes={() => {
              warSim.setShowAllEnvelopes((prev) => !prev);
            }}
            onDeployUnitToBase={warSim.deployUnitToBase}
            onDeployAutonomous={(sysId, count) => {
              warSim.startAutonomousPicking(sysId, count);
            }}
            onStartSortie={(entity, options) => {
              warSim.startSortiePicking(entity, options);
            }}
            onOrderRtb={warSim.orderRtb}
            onStartBasePlacement={warSim.startBasePlacement}
            onRenameBase={warSim.renameBase}
            targetPicking={warSim.targetPicking}
            onCancelTargetPicking={warSim.cancelTargetPicking}
            onConfirmCustomRoute={warSim.confirmCustomRoute}
            onUndoLastWaypoint={warSim.undoLastWaypoint}
            onOpenAar={() => setWarSimAarOpen(true)}
            onExitSim={() => {
              if (mapRef.current) removeWarSimLayers(mapRef.current);
              setActiveWarSimSession(null);
            }}
            systemsLibrary={war.systems}
            countries={war.countries}
            onFlyToBase={(lngLat) => {
              mapRef.current?.flyTo({ center: lngLat, zoom: 6, duration: 1200 });
            }}
          />
        )}

        {warSimAarOpen && warSim.session && (
          <WarSimAarModal
            isOpen={warSimAarOpen}
            onClose={() => setWarSimAarOpen(false)}
            session={warSim.session}
          />
        )}

        {selection && <DetailPanel selection={selection} onClose={() => setSelection(null)} />}
      </div>

      <ReadoutRail
        lngLat={cursor}
        zoom={zoom}
        projection={projection}
        activeLayers={activeLayers}
        mode={mode}
        unitCount={war.board.units.length}
        nationCount={Object.keys(war.board.nations).length}
      />
    </div>
  );
}
