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
  reviveBoard,
  LEGACY_BOARD_KEY,
  nextUnitId,
  unitLabel,
  unitLook,
  type BoardState,
  type Component,
  type DeployedUnit,
  type Formation,
  type LoadoutItem,
  type Nation,
} from './warGames';
import {
  BALLISTIC_CLASSES,
  mergeSystems,
  nextSystemId,
  tidySpec,
  type EnvelopeKind,
  type SystemSpec,
  type TargetClass,
} from './specs';
import { buildMunitions, type MunitionCatalogue } from './munitions';
import {
  assess,
  canRaid,
  defendersFrom,
  raidFrom,
  type Assessment,
  type BoardContext,
} from './engagement';
import {
  assessTheaterRaid,
  discoverAttackerAssets,
  discoverDefensiveUmbrella,
  specOf,
  type CandidateAttacker,
  type DefensiveUmbrella,
  type StrikePhaseTask,
  type TheaterAssessment,
} from './theaterEngagement';
import {
  calculateBalanceOfPower,
  generateAutoRetaliation,
  type BalanceOfPower,
  type CampaignTurn,
} from './campaign';
import {
  assessNavalCombat,
  isNavalCombatant,
  type NavalAssessment,
} from './navalEngagement';
import {
  assessBallisticMissileDefense,
  type BallisticDefenseAssessment,
} from './ballisticEngagement';
import {
  calculateRadarAvoidanceDogleg,
  greatCirclePath,
  multiLegGreatCirclePath,
  splitRouteAtDistance,
} from './geo';
import {
  EMPTY_FORCES,
  canAfford,
  costOf,
  holdingKey,
  keyOf,
  remaining,
  reviveForces,
  tally,
  type Forces,
  type Holding,
  type Tally,
} from './forces';
import {
  EMPTY_SCENARIOS,
  buildBundle,
  mergeImported,
  mergeImportedForces,
  nextScenarioId,
  readBundle,
  reviveScenarios,
  type Bundle,
  type ImportReport,
  type Scenario,
  type ScenarioDoc,
} from './scenarios';
import { getStore, readDoc, readWithLegacyFallback, writeDoc } from './store';
import { ensureIcons, type IconSpec } from './unitIcons';
import {
  applyCoverage,
  envelopeAt,
  hideBasemapSymbols,
  highlightEnvelope,
  highlightUnit,
  installWarLayers,
  paintNations,
  renderPlaybackFrame,
  restoreBasemapSymbols,
  setEnvelopes,
  setRaidPath,
  setUnits,
  setWarVisible,
  type CoverageState,
  type EnvelopeHover,
} from './warLayers';
import {
  buildRaidPlaybackModel,
  buildTheaterPlaybackModel,
  calculatePlaybackFrame,
  type PlaybackModel,
  type PlaybackFrame,
} from './playback';

export type Tool = 'select' | 'paint' | 'deploy';

/** Mouse and touch both carry the two things dragging needs. */
type PointerLike = MapMouseEvent | MapTouchEvent;

/**
 * What the Deploy tool is holding: one class of unit at an echelon, or a
 * special unit with a composition. Keeping the two in one tagged value means
 * the panel and the deploy handler cannot disagree about which is armed.
 */
export type Pick =
  | { kind: 'unit'; typeId: string; systemId?: string }
  | { kind: 'formation'; formationId: string };

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
  chooseSystem: (systemId: string | undefined) => void;
  chooseFormation: (formationId: string) => void;
  echelonId: string;
  setEchelonId: (id: string) => void;
  /** How many the next deployment places, and draws from stock. */
  deployCount: number;
  setDeployCount: (n: number) => void;

  /** What each nation owns. Empty for a nation means no limit. */
  forces: Forces;
  /** Held, deployed and remaining for one nation, board included. */
  nationTally: (iso: string) => Tally[];
  setHolding: (iso: string, holding: Holding) => void;
  removeHolding: (iso: string, key: string) => void;
  /** How many of the current pick the active nation can still deploy; null = untracked. */
  stockLeft: number | null;

  systems: SystemSpec[];
  /** Every munition any system carries, keyed by id — the re-arming list. */
  munitions: MunitionCatalogue;
  saveSystem: (spec: SystemSpec) => void;
  importSystems: (specs: unknown[]) => { count: number; ids: string[]; error?: string };
  clearCustomSystems: () => void;
  deleteSystem: (id: string) => void;
  /** Where configuration is being kept, so the interface can say so. */
  storageKind: 'files' | 'browser' | 'unknown';

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
  setUnitSystem: (id: string, systemId: string | undefined) => void;
  /** Re-arm one deployment. `undefined` puts it back on its system's own fit. */
  setUnitLoadout: (id: string, loadout: LoadoutItem[] | undefined) => void;
  setUnitCount: (id: string, count: number) => void;
  setUnitComposition: (id: string, composition: Component[]) => void;
  removeUnit: (id: string) => void;
  flyToUnit: (id: string) => void;

  clearUnits: () => void;
  clearNations: () => void;
  setSimulationNations: (playerIso: string, playerColor: string, enemyIso: string, enemyColor: string) => void;

  /** Boards kept under a name on this machine, newest first. */
  scenarios: Scenario[];
  /** Which one the working board came from, if any — a label, not ownership. */
  activeScenario: Scenario | null;
  /** Files the working board under a new name, and makes it the active one. */
  saveScenario: (name: string, note?: string) => void;
  /** Writes the working board back over a scenario it has drifted from. */
  updateScenario: (id: string) => void;
  /** Puts a scenario on the map. Undoable, like any other board change. */
  loadScenario: (id: string) => void;
  renameScenario: (id: string, name: string, note?: string) => void;
  duplicateScenario: (id: string) => void;
  deleteScenario: (id: string) => void;

  /** A portable bundle of a scenario, or of the working board when id is null. */
  exportBundle: (id: string | null) => Bundle | null;
  /** Reads a bundle, files it as a scenario and loads it. Non-destructive
      everywhere the undo stack cannot reach — see `lib/scenarios.ts`. */
  importBundle: (text: string) => { ok: true; report: ImportReport } | { ok: false; error: string };

  /** Which deployment is flying the raid, and what it is flying at. */
  raidFromId: string | null;
  raidToId: string | null;
  setRaidFrom: (id: string | null) => void;
  setRaidTo: (id: string | null) => void;
  /** Deployments that could fly a raid — a unit or formation with strike capability. */
  raidCandidates: DeployedUnit[];
  /** What the defence does to it. Null until both ends are chosen. */
  assessment: Assessment | null;

  /* Enhanced Engagement & Multi-Waypoint Flight Planning */
  standoffEnabled: boolean;
  setStandoffEnabled: (v: boolean) => void;
  selectedWeaponIndex: number;
  setSelectedWeaponIndex: (idx: number) => void;
  salvoSize: number | null;
  setSalvoSize: (n: number | null) => void;
  selectedEwEscortId: string | null;
  setSelectedEwEscortId: (id: string | null) => void;
  selectedSeadEscortId: string | null;
  setSelectedSeadEscortId: (id: string | null) => void;
  raidWaypoints: [number, number][];
  setRaidWaypoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  addRaidWaypoint: (coord: [number, number]) => void;
  removeRaidWaypoint: (index: number) => void;
  clearRaidWaypoints: () => void;
  autoAvoidanceWaypoints: () => void;
  waypointPlacingActive: boolean;
  waypointPlacingMode: 'raid' | 'theater';
  setWaypointPlacingActive: (active: boolean, mode?: 'raid' | 'theater') => void;

  /* Theater Multi-Phase Raid Operations */
  theaterTargetId: string | null;
  setTheaterTargetId: (id: string | null) => void;
  theaterAttackerIso: string | null;
  setTheaterAttackerIso: (iso: string | null) => void;
  theaterPhases: StrikePhaseTask[];
  setTheaterPhases: React.Dispatch<React.SetStateAction<StrikePhaseTask[]>>;
  addTheaterPhase: (phase: Omit<StrikePhaseTask, 'id' | 'order'>) => void;
  removeTheaterPhase: (id: string) => void;
  reorderTheaterPhase: (fromIndex: number, toIndex: number) => void;
  theaterTaskWaypoints: [number, number][];
  setTheaterTaskWaypoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  addTheaterTaskWaypoint: (coord: [number, number]) => void;
  removeTheaterTaskWaypoint: (index: number) => void;
  clearTheaterTaskWaypoints: () => void;
  theaterDraftingAttackerId: string | null;
  setTheaterDraftingAttackerId: (id: string | null) => void;
  theaterDraftingTargetId: string | null;
  setTheaterDraftingTargetId: (id: string | null) => void;
  theaterUmbrella: DefensiveUmbrella | null;
  theaterAttackers: CandidateAttacker[];
  theaterAssessment: TheaterAssessment | null;

  /* 4D Battle Playback & Animation */
  playbackActive: boolean;
  playbackPlaying: boolean;
  playbackTimeSec: number;
  playbackSpeed: number;
  playbackModel: PlaybackModel | null;
  playbackFrame: PlaybackFrame | null;
  startPlayback: () => void;
  stopPlayback: () => void;
  togglePlayPlayback: () => void;
  seekPlayback: (timeSec: number) => void;
  setPlaybackSpeed: (speed: number) => void;

  /* Two-Sided Campaign & Retaliatory Exchange */
  campaignTurns: CampaignTurn[];
  campaignBalance: BalanceOfPower;
  executeCampaignTurn: () => void;
  autoGenerateRetaliationPlan: () => void;
  resetCampaign: () => void;

  /* Multi-Layered Naval ASuW & Subsurface ASW Combat */
  navalAssessment: NavalAssessment | null;
  /* Multi-Tier Ballistic Missile Defense (BMD) & Hypersonic Simulation */
  bmdAssessment: BallisticDefenseAssessment | null;

  /** Which reaches are drawn, and what they are judged against. */
  coverage: CoverageState;
  setCoverageMode: (mode: CoverageState['mode']) => void;
  toggleCoverageKind: (kind: EnvelopeKind) => void;
  toggleCoverageTarget: (target: TargetClass) => void;
  setBallisticTargets: (on: boolean) => void;
  setTargetAltitude: (metres: number) => void;
  /** The ring the pointer is on, for the tooltip the map draws. */
  hoveredEnvelope: EnvelopeHover | null;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /** Re-installs layers and icons — call after a basemap swap. */
  hydrate: (map: MLMap) => void;
}

const BOARD_DOC = 'board';
const SYSTEMS_DOC = 'systems';
const FORCES_DOC = 'forces';
const SCENARIOS_DOC = 'scenarios';
/** How many board states undo remembers. Enough for a session's mistakes. */
const HISTORY_LIMIT = 50;

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
  const [deployCount, setDeployCountState] = useState(1);
  const [pendingComposition, setPendingComposition] = useState<Component[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [coverage, setCoverage] = useState<CoverageState>({
    // One unit's reach is legible and forty units' is not, so the default is the
    // selected unit rather than nothing at all — you see coverage the moment you
    // click something, without having to know the control exists.
    mode: 'selected',
    kinds: { engagement: true, detection: true, strike: true, 'strike-refuelled': false },
    // All threats on: the pills subtract from the full picture rather than
    // requiring you to build one before anything appears.
    targets: {
      air: true,
      'ballistic-short': true,
      'ballistic-medium': true,
      'ballistic-imrbm': true,
      surface: true,
      ground: true,
      subsurface: true,
    },
    // Medium rather than high: 10,000 m flatters every ground radar by giving it
    // most of its brochure range back, which is the least informative default.
    targetAltM: 3_000,
  });
  const [hoveredEnvelope, setHoveredEnvelope] = useState<EnvelopeHover | null>(null);

  const [raidFromId, setRaidFromId] = useState<string | null>(null);
  const [raidToId, setRaidToId] = useState<string | null>(null);
  const [standoffEnabled, setStandoffEnabled] = useState<boolean>(true);
  const [selectedWeaponIndex, setSelectedWeaponIndex] = useState<number>(0);
  const [salvoSize, setSalvoSize] = useState<number | null>(null);
  const [selectedEwEscortId, setSelectedEwEscortId] = useState<string | null>(null);
  const [selectedSeadEscortId, setSelectedSeadEscortId] = useState<string | null>(null);
  const [raidWaypoints, setRaidWaypoints] = useState<[number, number][]>([]);
  const [waypointPlacingActive, setWaypointPlacingActiveState] = useState<boolean>(false);
  const [waypointPlacingMode, setWaypointPlacingMode] = useState<'raid' | 'theater'>('raid');

  const waypointPlacingRef = useRef(waypointPlacingActive);
  waypointPlacingRef.current = waypointPlacingActive;
  const waypointPlacingModeRef = useRef(waypointPlacingMode);
  waypointPlacingModeRef.current = waypointPlacingMode;

  /* Theater Raid State */
  const [theaterTargetId, setTheaterTargetId] = useState<string | null>(null);
  const theaterTargetIdRef = useRef(theaterTargetId);
  theaterTargetIdRef.current = theaterTargetId;

  const [theaterAttackerIso, setTheaterAttackerIso] = useState<string | null>(null);
  const theaterAttackerIsoRef = useRef(theaterAttackerIso);
  theaterAttackerIsoRef.current = theaterAttackerIso;

  const [theaterPhases, setTheaterPhases] = useState<StrikePhaseTask[]>([]);
  const [theaterTaskWaypoints, setTheaterTaskWaypoints] = useState<[number, number][]>([]);
  const [theaterDraftingAttackerId, setTheaterDraftingAttackerId] = useState<string | null>(null);
  const [theaterDraftingTargetId, setTheaterDraftingTargetId] = useState<string | null>(null);

  const setWaypointPlacingActive = useCallback((active: boolean, mode: 'raid' | 'theater' = 'raid') => {
    setWaypointPlacingMode(mode);
    setWaypointPlacingActiveState(active);
  }, []);

  /* 4D Battle Playback State */
  const [playbackActive, setPlaybackActive] = useState<boolean>(false);
  const [playbackPlaying, setPlaybackPlaying] = useState<boolean>(false);
  const [playbackTimeSec, setPlaybackTimeSec] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2);

  /* Two-Sided Campaign State */
  const [campaignTurns, setCampaignTurns] = useState<CampaignTurn[]>([]);

  const [library, setLibrary] = useState<SystemSpec[]>([]);
  const [customSystems, setCustomSystems] = useState<SystemSpec[]>([]);
  const [forces, setForces] = useState<Forces>(EMPTY_FORCES);
  const [scenarioDoc, setScenarioDoc] = useState<ScenarioDoc>(EMPTY_SCENARIOS);
  const [storageKind, setStorageKind] = useState<'files' | 'browser' | 'unknown'>('unknown');

  const boardRef = useRef(board);
  const toolRef = useRef(tool);
  const activeIsoRef = useRef(activeIso);
  const colorRef = useRef(color);
  const pickRef = useRef(pick);
  const echelonRef = useRef(echelonId);
  const countRef = useRef(deployCount);
  const compositionRef = useRef(pendingComposition);
  const coverageRef = useRef(coverage);
  const forcesRef = useRef(forces);
  const customSystemsRef = useRef(customSystems);
  const scenarioRef = useRef(scenarioDoc);
  const countriesRef = useRef<Map<string, CountryOption>>(new Map());
  const hydratedRef = useRef(false);

  boardRef.current = board;
  toolRef.current = tool;
  activeIsoRef.current = activeIso;
  colorRef.current = color;
  pickRef.current = pick;
  echelonRef.current = echelonId;
  countRef.current = deployCount;
  compositionRef.current = pendingComposition;
  coverageRef.current = coverage;
  forcesRef.current = forces;
  customSystemsRef.current = customSystems;
  scenarioRef.current = scenarioDoc;

  /* ---------------- persistence and history ---------------- */

  // The board is edited through `commit`, never through setBoard directly, so
  // that every change lands in the undo stack and boardRef stays truthful
  // between renders — two commits in one tick must not read the same "before".
  const historyRef = useRef<BoardState[]>([]);
  const futureRef = useRef<BoardState[]>([]);
  const [historyMark, setHistoryMark] = useState(0);
  const loadedRef = useRef(false);

  const commit = useCallback((next: (prev: BoardState) => BoardState) => {
    const prev = boardRef.current;
    const value = next(prev);
    if (value === prev) return;
    historyRef.current = [...historyRef.current, prev].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    boardRef.current = value;
    setBoard(value);
    setHistoryMark((n) => n + 1);
  }, []);

  const setCoverageMode = useCallback(
    (mode: CoverageState['mode']) => setCoverage((prev) => ({ ...prev, mode })),
    []
  );

  const toggleCoverageKind = useCallback(
    (kind: EnvelopeKind) =>
      setCoverage((prev) => ({ ...prev, kinds: { ...prev.kinds, [kind]: !prev.kinds[kind] } })),
    []
  );

  const toggleCoverageTarget = useCallback(
    (target: TargetClass) =>
      setCoverage((prev) => ({ ...prev, targets: { ...prev.targets, [target]: !prev.targets[target] } })),
    []
  );

  /** All ballistic tiers at once — the common case is on or off, not a tier. */
  const setBallisticTargets = useCallback(
    (on: boolean) =>
      setCoverage((prev) => ({
        ...prev,
        targets: { ...prev.targets, ...Object.fromEntries(BALLISTIC_CLASSES.map((t) => [t, on])) },
      })),
    []
  );

  const setTargetAltitude = useCallback(
    (metres: number) => setCoverage((prev) => ({ ...prev, targetAltM: metres })),
    []
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    futureRef.current.push(boardRef.current);
    boardRef.current = prev;
    setBoard(prev);
    setHistoryMark((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(boardRef.current);
    boardRef.current = next;
    setBoard(next);
    setHistoryMark((n) => n + 1);
  }, []);

  // Load everything the board needs before the first save can fire, so an empty
  // initial state never overwrites a good document on disk.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore();
      const [saved, custom, heldForces, savedScenarios, shipped] = await Promise.all([
        readWithLegacyFallback<unknown>(BOARD_DOC, LEGACY_BOARD_KEY),
        readDoc<SystemSpec[]>(SYSTEMS_DOC),
        readDoc<unknown>(FORCES_DOC),
        readDoc<unknown>(SCENARIOS_DOC),
        fetch('/data/systems.json')
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);
      if (cancelled) return;

      const revived = reviveBoard(saved);
      boardRef.current = revived;
      setBoard(revived);
      setCustomSystems(Array.isArray(custom) ? custom : []);
      setForces(reviveForces(heldForces));
      setScenarioDoc(reviveScenarios(savedScenarios));
      setLibrary(Array.isArray(shipped) ? shipped : []);
      setStorageKind(store.kind);
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Saves are debounced: painting a country runs through several colours on the
  // way to the one you wanted, and none of the intermediate ones deserve a write.
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => void writeDoc(BOARD_DOC, board), 400);
    return () => clearTimeout(timer);
  }, [board]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => void writeDoc(SYSTEMS_DOC, customSystems), 400);
    return () => clearTimeout(timer);
  }, [customSystems]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => void writeDoc(FORCES_DOC, forces), 400);
    return () => clearTimeout(timer);
  }, [forces]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => void writeDoc(SCENARIOS_DOC, scenarioDoc), 400);
    return () => clearTimeout(timer);
  }, [scenarioDoc]);

  /* ---------------- national forces ---------------- */

  /** Writes one holding, replacing the line for that item or adding it. */
  const setHolding = useCallback((iso: string, holding: Holding) => {
    const key = keyOf(holding);
    const count = Math.max(0, Math.round(holding.count) || 0);
    setForces((prev) => {
      const held = prev[iso] ?? [];
      const next = held.some((h) => keyOf(h) === key)
        ? held.map((h) => (keyOf(h) === key ? { ...holding, count } : h))
        : [...held, { ...holding, count }];
      return { ...prev, [iso]: next };
    });
  }, []);

  const removeHolding = useCallback((iso: string, key: string) => {
    setForces((prev) => {
      const held = prev[iso];
      if (!held) return prev;
      const next = held.filter((h) => keyOf(h) !== key);
      // A nation with no holdings left keeps no inventory at all, which is
      // meaningfully different from one holding zero of everything: it goes back
      // to deploying without limit.
      if (!next.length) {
        const { [iso]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [iso]: next };
    });
  }, []);

  const nationTally = useCallback(
    (iso: string): Tally[] => tally(forces, board, iso),
    [forces, board]
  );

  /** What the palette can still place of whatever is picked. */
  const stockLeft = useMemo(() => {
    if (pick.kind === 'formation') {
      // A special unit is only as available as its scarcest component.
      const formation = findFormation(pick.formationId, board.formations);
      if (!formation || !activeIso) return null;
      const limits = pendingComposition
        .filter((part) => part.count > 0)
        .map((part) => {
          const left = remaining(forces, board, activeIso, part.typeId, part.systemId);
          return left === null ? null : Math.floor(left / part.count);
        })
        .filter((n): n is number => n !== null);
      return limits.length ? Math.max(0, Math.min(...limits)) : null;
    }
    return remaining(forces, board, activeIso, pick.typeId, pick.systemId);
  }, [forces, board, activeIso, pick, pendingComposition]);

  const systems = useMemo(() => mergeSystems(library, customSystems), [library, customSystems]);
  /* Derived from the systems rather than authored, so a weapon added in the
     editor is immediately available to arm a deployed unit with. */
  const munitions = useMemo(() => buildMunitions(systems), [systems]);
  const systemsRef = useRef(systems);
  systemsRef.current = systems;

  const saveSystem = useCallback((spec: SystemSpec) => {
    const tidied = tidySpec({ ...spec, custom: true, id: spec.id || nextSystemId(spec.name) });
    setCustomSystems((prev) => {
      const without = prev.filter((s) => s.id !== tidied.id);
      const next = [...without, tidied];
      void writeDoc(SYSTEMS_DOC, next);
      return next;
    });
  }, []);

  const importSystems = useCallback((items: unknown[]): { count: number; ids: string[]; error?: string } => {
    if (!Array.isArray(items)) {
      return { count: 0, ids: [], error: 'Expected an array of weapon system specifications.' };
    }

    const validSpecs: SystemSpec[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Partial<SystemSpec>;
      if (!raw.name && !raw.id) continue;
      const name = String(raw.name || raw.id || 'Custom System');
      const id = String(raw.id || nextSystemId(name));
      const spec: SystemSpec = {
        ...raw,
        id,
        name,
        typeId: raw.typeId || 'fighter',
        custom: true,
      };
      validSpecs.push(tidySpec(spec));
    }

    if (validSpecs.length === 0) {
      return { count: 0, ids: [], error: 'No valid weapon system specifications found in the data.' };
    }

    setCustomSystems((prev) => {
      const map = new Map<string, SystemSpec>();
      for (const s of prev) {
        map.set(s.id, s);
      }
      for (const s of validSpecs) {
        map.set(s.id, s);
      }
      const next = Array.from(map.values());
      void writeDoc(SYSTEMS_DOC, next);
      return next;
    });

    return { count: validSpecs.length, ids: validSpecs.map((s) => s.id) };
  }, []);

  const clearCustomSystems = useCallback(() => {
    setCustomSystems([]);
    void writeDoc(SYSTEMS_DOC, []);
  }, []);

  const deleteSystem = useCallback((id: string) => {
    setCustomSystems((prev) => {
      const next = prev.filter((s) => s.id !== id);
      void writeDoc(SYSTEMS_DOC, next);
      return next;
    });
  }, []);

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
      setUnits(map, boardRef.current.units, boardRef.current.nations, boardRef.current.formations, systemsRef.current);
      setEnvelopes(
        map,
        boardRef.current.units,
        boardRef.current.nations,
        boardRef.current.formations,
        systemsRef.current,
        coverageRef.current.targetAltM
      );
      applyCoverage(map, coverageRef.current, selectedId, activeIsoRef.current);
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
    setUnits(map, board.units, board.nations, board.formations, systems);
    setEnvelopes(map, board.units, board.nations, board.formations, systems, coverage.targetAltM);
  }, [board, iconSpecs, systems, coverage.targetAltM, mapRef]);

  // Showing or hiding a category is a filter, not a rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;
    applyCoverage(map, coverage, selectedId, activeIso);
  }, [coverage, selectedId, activeIso, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;
    highlightUnit(map, selectedId);
  }, [selectedId, mapRef]);

  /* ---------------- mutations ---------------- */

  const applyColor = useCallback((iso: string, hex: string) => {
    const meta = countriesRef.current.get(iso);
    commit((prev) => ({
      ...prev,
      nations: {
        ...prev.nations,
        [iso]: { iso, name: meta?.name ?? prev.nations[iso]?.name ?? iso, color: hex },
      },
    }));
  }, [commit]);

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
    // Keep the system only while it still belongs to the type being picked.
    setPick((prev) => {
      const held = prev.kind === 'unit' ? prev.systemId : undefined;
      const stillFits = systemsRef.current.find((sp) => sp.id === held)?.typeId === typeId;
      return { kind: 'unit', typeId, systemId: stillFits ? held : undefined };
    });
    // Keep the current echelon when the new type supports it, so switching
    // between, say, armour and infantry does not reset you to battalion.
    setEchelonId((prev) => (type.echelons.includes(prev) ? prev : type.defaultEchelon));
  }, []);

  const chooseSystem = useCallback((systemId: string | undefined) => {
    const spec = systemsRef.current.find((sp) => sp.id === systemId);
    setPick((prev) =>
      prev.kind === 'unit'
        ? { kind: 'unit', typeId: spec?.typeId ?? prev.typeId, systemId }
        : prev
    );
  }, []);

  const setDeployCount = useCallback(
    (n: number) => {
      const wanted = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
      // Never let the box ask for more than the nation holds; typing 50 when
      // there are 6 should land on 6, not be silently refused on the map.
      setDeployCountState(stockLeft === null ? wanted : Math.max(1, Math.min(wanted, stockLeft)));
    },
    [stockLeft]
  );

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
            systemId: current.systemId,
            count: countRef.current,
          };

    // A nation cannot field what it does not own. Nations keeping no inventory
    // are unaffected: canAfford returns ok for anything it is not tracking.
    const afford = canAfford(forcesRef.current, boardRef.current, iso, costOf(unit));
    if (!afford.ok) {
      setError(
        unit.kind === 'formation'
          ? 'Not enough in stock for every part of that special unit — check Forces.'
          : 'None of those left in stock — check Forces.'
      );
      return;
    }
    setError(null);

    commit((prev) => ({ ...prev, units: [...prev.units, unit] }));
  }, [commit]);

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
      commit((prev) => ({ ...prev, formations: [...prev.formations, formation] }));
      setPick({ kind: 'formation', formationId: formation.id });
      setPendingComposition(formation.composition.map((part) => ({ ...part })));
    },
    [commit]
  );

  const deleteFormation = useCallback((id: string) => {
    // Units already on the board keep their own composition, so deleting the
    // template does not disband what it was used to deploy — but they would
    // lose their name and icon, so they go with it.
    commit((prev) => ({
      ...prev,
      formations: prev.formations.filter((f) => f.id !== id),
      units: prev.units.filter((u) => !(u.kind === 'formation' && u.formationId === id)),
    }));
    setPick((prev) => (prev.kind === 'formation' && prev.formationId === id ? { kind: 'unit', typeId: 'infantry' } : prev));
  }, [commit]);

  const patchUnit = useCallback(
    (id: string, patch: (u: DeployedUnit) => DeployedUnit) => {
      commit((prev) => ({
        ...prev,
        units: prev.units.map((u) => (u.id === id ? patch(u) : u)),
      }));
    },
    [commit]
  );

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

  const setUnitSystem = useCallback(
    (id: string, systemId: string | undefined) =>
      patchUnit(id, (u) => (u.kind === 'unit' ? { ...u, systemId } : u)),
    [patchUnit]
  );

  const setUnitLoadout = useCallback(
    (id: string, loadout: LoadoutItem[] | undefined) =>
      patchUnit(id, (u) => (u.kind === 'unit' ? { ...u, loadout } : u)),
    [patchUnit]
  );

  const setUnitCount = useCallback(
    (id: string, count: number) =>
      patchUnit(id, (u) => {
        if (u.kind !== 'unit') return u;
        const wanted = Math.max(1, Math.round(count) || 1);
        // Raising the count spends stock the same way deploying does, so the
        // ceiling is what is left plus what this unit already holds.
        const left = remaining(forcesRef.current, boardRef.current, u.iso, u.typeId, u.systemId);
        const cap = left === null ? wanted : u.count + left;
        return { ...u, count: Math.max(1, Math.min(wanted, cap)) };
      }),
    [patchUnit]
  );

  const setUnitComposition = useCallback(
    (id: string, composition: Component[]) =>
      patchUnit(id, (u) =>
        u.kind === 'formation' ? { ...u, composition: composition.filter((p) => p.count > 0) } : u
      ),
    [patchUnit]
  );

  const removeUnit = useCallback(
    (id: string) => {
      commit((prev) => ({ ...prev, units: prev.units.filter((u) => u.id !== id) }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commit]
  );

  const clearUnits = useCallback(() => {
    commit((prev) => ({ ...prev, units: [] }));
    setSelectedId(null);
  }, [commit]);

  const clearNations = useCallback(() => {
    commit((prev) => ({ ...prev, nations: {} }));
  }, [commit]);

  const setSimulationNations = useCallback(
    (playerIso: string, playerColor: string, enemyIso: string, enemyColor: string) => {
      const metaPlayer = countriesRef.current.get(playerIso);
      const metaEnemy = countriesRef.current.get(enemyIso);
      commit((prev) => ({
        ...prev,
        units: [],
        formations: [],
        nations: {
          [playerIso]: { iso: playerIso, name: metaPlayer?.name ?? playerIso, color: playerColor },
          [enemyIso]: { iso: enemyIso, name: metaEnemy?.name ?? enemyIso, color: enemyColor },
        },
      }));
    },
    [commit]
  );

  /* ---------------- scenarios ---------------- */

  // A scenario holds the board object it was saved from, not a copy of it. The
  // board is only ever replaced, never mutated in place — every edit here goes
  // through `commit`, which builds a new one — so sharing the reference is free
  // and a deep clone would be ceremony.

  const saveScenario = useCallback((name: string, note?: string) => {
    const scenario: Scenario = {
      id: nextScenarioId(),
      name: name.trim() || 'Untitled board',
      note: note?.trim() || undefined,
      savedAt: new Date().toISOString(),
      board: boardRef.current,
    };
    setScenarioDoc((prev) => ({ active: scenario.id, items: [scenario, ...prev.items] }));
  }, []);

  const updateScenario = useCallback((id: string) => {
    setScenarioDoc((prev) => ({
      active: id,
      items: prev.items.map((s) =>
        s.id === id ? { ...s, board: boardRef.current, savedAt: new Date().toISOString() } : s
      ),
    }));
  }, []);

  const loadScenario = useCallback(
    (id: string) => {
      const scenario = scenarioRef.current.items.find((s) => s.id === id);
      if (!scenario) return;
      // Through `commit`, so putting the wrong board on the map costs one
      // Ctrl+Z rather than an evening.
      commit(() => scenario.board);
      setScenarioDoc((prev) => ({ ...prev, active: id }));
      // The ids in the incoming board are not the ids that were selected.
      setSelectedId(null);
    },
    [commit]
  );

  const renameScenario = useCallback((id: string, name: string, note?: string) => {
    setScenarioDoc((prev) => ({
      ...prev,
      items: prev.items.map((s) =>
        s.id === id ? { ...s, name: name.trim() || s.name, note: note?.trim() || undefined } : s
      ),
    }));
  }, []);

  const duplicateScenario = useCallback((id: string) => {
    setScenarioDoc((prev) => {
      const source = prev.items.find((s) => s.id === id);
      if (!source) return prev;
      const copy: Scenario = {
        ...source,
        id: nextScenarioId(),
        name: `${source.name} (copy)`,
        savedAt: new Date().toISOString(),
      };
      // Beside the one it came from, not at the top: a copy is a variant of
      // that scenario, and the list reads better with the pair together.
      const at = prev.items.indexOf(source);
      return { ...prev, items: [...prev.items.slice(0, at + 1), copy, ...prev.items.slice(at + 1)] };
    });
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setScenarioDoc((prev) => ({
      // The working board stays exactly as it is; only its name is forgotten.
      active: prev.active === id ? null : prev.active,
      items: prev.items.filter((s) => s.id !== id),
    }));
  }, []);

  const exportBundle = useCallback((id: string | null): Bundle | null => {
    const scenario = id ? scenarioRef.current.items.find((s) => s.id === id) : null;
    if (id && !scenario) return null;
    const board = scenario ? scenario.board : boardRef.current;
    return buildBundle({
      name: scenario?.name ?? 'Working board',
      note: scenario?.note,
      board,
      systems: customSystemsRef.current,
      forces: forcesRef.current,
    });
  }, []);

  const importBundle = useCallback(
    (text: string): { ok: true; report: ImportReport } | { ok: false; error: string } => {
      const read = readBundle(text);
      if (!read.ok) return read;
      const { bundle } = read;

      const systems = mergeImported(customSystemsRef.current, bundle.systems, (s) => s.id);
      const heldForces = mergeImportedForces(forcesRef.current, bundle.forces);
      if (systems.added) setCustomSystems(systems.merged);
      if (heldForces.added) setForces(heldForces.merged);

      // Filed under its own name and loaded, in that order, so that an import
      // is never a board you cannot get back to.
      const scenario: Scenario = {
        id: nextScenarioId(),
        name: bundle.name,
        note: bundle.note,
        savedAt: new Date().toISOString(),
        board: bundle.board,
      };
      setScenarioDoc((prev) => ({ active: scenario.id, items: [scenario, ...prev.items] }));
      commit(() => bundle.board);
      setSelectedId(null);

      return {
        ok: true,
        report: {
          name: bundle.name,
          units: bundle.board.units.length,
          systemsAdded: systems.added,
          systemsKept: systems.kept,
          nationsAdded: heldForces.added,
          nationsKept: heldForces.kept,
        },
      };
    },
    [commit]
  );

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

      if (waypointPlacingRef.current) {
        if (waypointPlacingModeRef.current === 'theater' || theaterTargetIdRef.current) {
          setTheaterTaskWaypoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
        } else {
          setRaidWaypoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
        }
        return;
      }

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

    const clearHover = () => {
      setHoveredEnvelope(null);
      highlightEnvelope(map, null);
    };

    const beginDrag = (e: PointerLike) => {
      if (toolRef.current === 'deploy') return;
      const hit = unitAt(e);
      if (!hit) return;
      // The rings are about to move with the unit; a tooltip pinned to where one
      // used to be is worse than none.
      clearHover();
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

        // A unit under the pointer wins: you are reaching for the unit, not for
        // whichever of its own rings happens to pass under it.
        const ring = over ? null : envelopeAt(map, e.point);
        setHoveredEnvelope((prev) => {
          if (!ring) return prev ? null : prev;
          // Same ring, new pointer position — replace, so the tooltip follows.
          return prev && prev.key === ring.key && prev.point[0] === ring.point[0] && prev.point[1] === ring.point[1]
            ? prev
            : ring;
        });
        highlightEnvelope(map, ring?.key ?? null);
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
      setUnits(map, units, boardRef.current.nations, boardRef.current.formations, systemsRef.current);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
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
    map.on('mouseout', clearHover);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
    window.addEventListener('keydown', onKey);

    return () => {
      clearHover();
      map.off('click', onClick);
      map.off('mousedown', beginDrag);
      map.off('mousemove', continueDrag);
      map.off('mouseup', endDrag);
      map.off('touchstart', beginDrag);
      map.off('touchmove', continueDrag);
      map.off('touchend', endDrag);
      map.off('touchcancel', endDrag);
      map.off('mouseout', clearHover);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchend', endDrag);
      window.removeEventListener('keydown', onKey);
      map.dragPan.enable();
      canvas.style.cursor = '';
    };
  }, [active, mapReady, mapRef, deploy, applyColor, moveUnit, removeUnit, selectedId, undo, redo]);

  // The cursor is the clearest statement of which tool is armed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !active) return;
    map.getCanvas().style.cursor =
      waypointPlacingActive || tool === 'deploy' ? 'crosshair' : tool === 'paint' ? 'copy' : '';
  }, [tool, waypointPlacingActive, active, mapRef]);

  const selectedUnit = useMemo(
    () => board.units.find((u) => u.id === selectedId) ?? null,
    [board.units, selectedId]
  );

  // The stacks live in refs so a drag does not re-render on every frame;
  // historyMark is the render trigger that keeps these two honest.
  const canUndo = useMemo(() => historyRef.current.length > 0, [historyMark]);
  const canRedo = useMemo(() => futureRef.current.length > 0, [historyMark]);

  /* ---------------- engagement ---------------- */

  const boardContext = useMemo<BoardContext>(
    () => ({ systems, munitions, formations: allFormations(board.formations) }),
    [systems, munitions, board.formations]
  );

  const raidCandidates = useMemo(
    () => board.units.filter((u) => canRaid(u, boardContext)),
    [board.units, boardContext]
  );

  const addRaidWaypoint = useCallback((coord: [number, number]) => {
    setRaidWaypoints((prev) => [...prev, coord]);
  }, []);

  const removeRaidWaypoint = useCallback((index: number) => {
    setRaidWaypoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearRaidWaypoints = useCallback(() => {
    setRaidWaypoints([]);
  }, []);

  const autoAvoidanceWaypoints = useCallback(() => {
    const attacker = board.units.find((u) => u.id === raidFromId);
    const target = board.units.find((u) => u.id === raidToId);
    if (!attacker || !target) return;

    const defenders = defendersFrom(board.units, attacker.iso, boardContext);
    const threatZones: { at: [number, number]; radiusKm: number }[] = [];

    for (const def of defenders) {
      const maxReach = Math.max(
        def.spec.sensor?.detectionKm ?? 0,
        ...(def.spec.weapons ?? []).map((w) => w.rangeKm ?? 0)
      );
      if (maxReach > 30) {
        threatZones.push({ at: def.at, radiusKm: maxReach });
      }
    }

    const attackerSpec = specOf(attacker, boardContext);
    const weaponRange = standoffEnabled && attackerSpec?.weapons?.[selectedWeaponIndex]?.rangeKm;
    const maxReach = weaponRange || attackerSpec?.platform?.combatRadiusKm;

    const doglegs = calculateRadarAvoidanceDogleg(attacker.lngLat, target.lngLat, threatZones, maxReach);
    if (doglegs.length > 0) {
      setRaidWaypoints(doglegs);
    }
  }, [board.units, raidFromId, raidToId, boardContext, standoffEnabled, selectedWeaponIndex]);

  const assessment = useMemo(() => {
    const attacker = board.units.find((u) => u.id === raidFromId);
    const target = board.units.find((u) => u.id === raidToId);
    if (!attacker || !target) return null;
    // The raid flies at the altitude the coverage panel is asking about, because
    // they are the same quantity: a detection ring is drawn against the height of
    // the thing being looked for. Sharing it means the rings on the map are the
    // rings the raid is assessed through.
    const raid = raidFrom(
      attacker,
      target.lngLat,
      coverage.targetAltM,
      boardContext,
      board.units,
      {
        standoffEnabled,
        weaponIndex: selectedWeaponIndex,
        salvoSize: salvoSize ?? undefined,
        ewUnitId: selectedEwEscortId,
        seadUnitId: selectedSeadEscortId,
        waypoints: raidWaypoints.length > 0 ? raidWaypoints : undefined,
      }
    );
    if (!raid) return null;
    return assess(raid, defendersFrom(board.units, attacker.iso, boardContext));
  }, [
    board.units,
    raidFromId,
    raidToId,
    raidWaypoints,
    boardContext,
    coverage.targetAltM,
    standoffEnabled,
    selectedWeaponIndex,
    salvoSize,
    selectedEwEscortId,
    selectedSeadEscortId,
  ]);

  /* ---------------- theater raid ---------------- */

  const theaterUmbrella = useMemo(() => {
    if (!theaterTargetId) return null;
    const target = board.units.find((u) => u.id === theaterTargetId);
    if (!target) return null;
    return discoverDefensiveUmbrella(target, board.units, boardContext);
  }, [theaterTargetId, board.units, boardContext]);

  const theaterAttackers = useMemo(() => {
    if (!theaterAttackerIso || !theaterUmbrella) return [];
    const target = board.units.find((u) => u.id === theaterTargetId);
    if (!target) return [];
    return discoverAttackerAssets(theaterAttackerIso, target, theaterUmbrella, board.units, boardContext);
  }, [theaterAttackerIso, theaterTargetId, theaterUmbrella, board.units, boardContext]);

  const theaterAssessment = useMemo(() => {
    if (!theaterTargetId || !theaterAttackerIso || theaterPhases.length === 0) return null;
    return assessTheaterRaid(theaterTargetId, theaterAttackerIso, theaterPhases, board.units, boardContext);
  }, [theaterTargetId, theaterAttackerIso, theaterPhases, board.units, boardContext]);

  const addTheaterPhase = useCallback(
    (phase: Omit<StrikePhaseTask, 'id' | 'order'>) => {
      setTheaterPhases((prev) => [
        ...prev,
        {
          ...phase,
          id: `phase-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          order: prev.length + 1,
        },
      ]);
    },
    []
  );

  const removeTheaterPhase = useCallback((id: string) => {
    setTheaterPhases((prev) =>
      prev.filter((p) => p.id !== id).map((p, idx) => ({ ...p, order: idx + 1 }))
    );
  }, []);

  const reorderTheaterPhase = useCallback((fromIndex: number, toIndex: number) => {
    setTheaterPhases((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((p, idx) => ({ ...p, order: idx + 1 }));
    });
  }, []);

  const addTheaterTaskWaypoint = useCallback((coord: [number, number]) => {
    setTheaterTaskWaypoints((prev) => [...prev, coord]);
  }, []);

  const removeTheaterTaskWaypoint = useCallback((index: number) => {
    setTheaterTaskWaypoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearTheaterTaskWaypoints = useCallback(() => {
    setTheaterTaskWaypoints([]);
  }, []);

  /* ---------------- 4D battle playback ---------------- */

  const playbackModel = useMemo<PlaybackModel | null>(() => {
    if (theaterAssessment && theaterAssessment.phases.length > 0) {
      return buildTheaterPlaybackModel(theaterAssessment);
    }
    if (assessment && !assessment.blocked) {
      return buildRaidPlaybackModel(assessment, board.units);
    }
    return null;
  }, [theaterAssessment, assessment, board.units]);

  const playbackFrame = useMemo<PlaybackFrame | null>(() => {
    if (!playbackModel || !playbackActive) return null;
    return calculatePlaybackFrame(playbackModel, playbackTimeSec);
  }, [playbackModel, playbackActive, playbackTimeSec]);

  const startPlayback = useCallback(() => {
    setPlaybackTimeSec(0);
    setPlaybackPlaying(true);
    setPlaybackActive(true);
  }, []);

  const stopPlayback = useCallback(() => {
    setPlaybackPlaying(false);
    setPlaybackActive(false);
    setPlaybackTimeSec(0);
  }, []);

  const togglePlayPlayback = useCallback(() => {
    setPlaybackPlaying((prev) => !prev);
  }, []);

  const seekPlayback = useCallback((timeSec: number) => {
    setPlaybackTimeSec(timeSec);
  }, []);

  // Playback requestAnimationFrame animation loop
  useEffect(() => {
    if (!playbackActive || !playbackPlaying || !playbackModel) return;

    let animId: number;
    let lastTimestamp = performance.now();

    const loop = (timestamp: number) => {
      const deltaMs = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      setPlaybackTimeSec((prev) => {
        const next = prev + (deltaMs / 1000) * playbackSpeed;
        if (next >= playbackModel.totalDurationSec) {
          setPlaybackPlaying(false);
          return playbackModel.totalDurationSec;
        }
        return next;
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [playbackActive, playbackPlaying, playbackModel, playbackSpeed]);

  // Feed frame to MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;
    renderPlaybackFrame(map, playbackFrame);
  }, [playbackFrame, mapRef]);

  /* ---------------- two-sided campaign ---------------- */

  const campaignBalance = useMemo<BalanceOfPower>(() => {
    const nationA = theaterAttackerIso ?? Object.keys(board.nations)[0] ?? 'USA';
    const targetUnit = board.units.find((u) => u.id === theaterTargetId);
    const nationB = targetUnit?.iso ?? Object.keys(board.nations)[1] ?? 'RUS';
    const states = theaterAssessment?.unitFinalStates ?? new Map();
    return calculateBalanceOfPower(nationA, nationB, board.units, states, boardContext);
  }, [theaterAttackerIso, theaterTargetId, board.nations, board.units, theaterAssessment, boardContext]);

  const executeCampaignTurn = useCallback(() => {
    if (!theaterAssessment || !theaterTargetId || !theaterAttackerIso) return;
    const targetUnit = board.units.find((u) => u.id === theaterTargetId);
    if (!targetUnit) return;

    const turnNum = campaignTurns.length + 1;
    const prevTurn = campaignTurns[campaignTurns.length - 1];
    const isRetaliatory = Boolean(prevTurn && prevTurn.initiatorIso !== theaterAttackerIso);

    const balanceBefore = prevTurn ? prevTurn.balanceAfter : campaignBalance;
    const balanceAfter = calculateBalanceOfPower(
      theaterAttackerIso,
      targetUnit.iso,
      board.units,
      theaterAssessment.unitFinalStates,
      boardContext
    );

    const newTurn: CampaignTurn = {
      turnNumber: turnNum,
      initiatorIso: theaterAttackerIso,
      defenderIso: targetUnit.iso,
      turnType: isRetaliatory ? 'retaliatory' : 'offensive',
      title: isRetaliatory
        ? `Turn ${turnNum}: Retaliatory Counter-Strike by ${board.nations[theaterAttackerIso]?.name ?? theaterAttackerIso}`
        : `Turn ${turnNum}: Strategic Offensive Strike by ${board.nations[theaterAttackerIso]?.name ?? theaterAttackerIso}`,
      targetUnitId: theaterTargetId,
      targetLabel: unitLabel(targetUnit, allFormations(board.formations), systems),
      phases: [...theaterPhases],
      assessment: theaterAssessment,
      balanceBefore,
      balanceAfter,
    };

    setCampaignTurns((prev) => [...prev, newTurn]);
  }, [
    theaterAssessment,
    theaterTargetId,
    theaterAttackerIso,
    board.units,
    board.nations,
    campaignTurns,
    campaignBalance,
    boardContext,
    board.formations,
    systems,
    theaterPhases,
  ]);

  const autoGenerateRetaliationPlan = useCallback(() => {
    if (!theaterTargetId || !theaterAttackerIso) return;
    const targetUnit = board.units.find((u) => u.id === theaterTargetId);
    if (!targetUnit) return;

    const defenderIso = targetUnit.iso;
    const attackerIso = theaterAttackerIso;
    const states = theaterAssessment?.unitFinalStates ?? new Map();

    const plan = generateAutoRetaliation(
      defenderIso,
      attackerIso,
      theaterAssessment,
      board.units,
      states,
      boardContext
    );

    if (plan.targetUnit) {
      setTheaterAttackerIso(defenderIso);
      setTheaterTargetId(plan.targetUnit.id);
      setTheaterPhases(plan.phases);
    }
  }, [theaterTargetId, theaterAttackerIso, board.units, theaterAssessment, boardContext]);

  const resetCampaign = useCallback(() => {
    setCampaignTurns([]);
  }, []);

  /* ---------------- naval ASuW & subsurface ASW combat ---------------- */

  const navalAssessment = useMemo<NavalAssessment | null>(() => {
    if (!raidFromId || !raidToId) return null;
    const attacker = board.units.find((u) => u.id === raidFromId);
    const target = board.units.find((u) => u.id === raidToId);
    if (!attacker || !target) return null;

    const targetSpec = specOf(target, boardContext);
    if (!targetSpec || !isNavalCombatant(targetSpec.typeId)) return null;

    const unitCount = attacker.kind === 'unit' ? attacker.count : 1;
    const salvo = salvoSize ?? (unitCount * 4);
    const states = theaterAssessment?.unitFinalStates ?? new Map();

    return assessNavalCombat(
      attacker,
      target,
      selectedWeaponIndex,
      salvo,
      board.units,
      states,
      boardContext
    );
  }, [
    raidFromId,
    raidToId,
    board.units,
    salvoSize,
    selectedWeaponIndex,
    theaterAssessment,
    boardContext,
  ]);

  /* ---------------- ballistic missile defense (BMD) ---------------- */

  const bmdAssessment = useMemo<BallisticDefenseAssessment | null>(() => {
    if (!raidFromId || !raidToId) return null;
    const attacker = board.units.find((u) => u.id === raidFromId);
    const target = board.units.find((u) => u.id === raidToId);
    if (!attacker || !target) return null;

    const attackerSpec = specOf(attacker, boardContext);
    const weapon = attackerSpec?.weapons?.[selectedWeaponIndex];
    const weaponName = weapon?.name ?? '';
    const isBallisticWeapon =
      attackerSpec?.typeId === 'silo' ||
      attackerSpec?.typeId === 'missile' ||
      weaponName.toLowerCase().includes('ballistic') ||
      weaponName.toLowerCase().includes('iskander') ||
      weaponName.toLowerCase().includes('atacms') ||
      weaponName.toLowerCase().includes('df-') ||
      weaponName.toLowerCase().includes('hgv') ||
      weaponName.toLowerCase().includes('kinzhal') ||
      weaponName.toLowerCase().includes('zircon') ||
      (weapon?.engages ?? []).some((c) => c.startsWith('ballistic'));

    if (!isBallisticWeapon) return null;

    const unitCount = attacker.kind === 'unit' ? attacker.count : 1;
    const salvo = salvoSize ?? (unitCount * (weapon?.salvo ?? 2));

    return assessBallisticMissileDefense(
      attacker,
      target,
      selectedWeaponIndex,
      salvo,
      board.units,
      boardContext
    );
  }, [
    raidFromId,
    raidToId,
    board.units,
    salvoSize,
    selectedWeaponIndex,
    boardContext,
  ]);

  // The drawn path is the assessed path — same great circle, same resolution —
  // so a belt the line visibly crosses is a belt the numbers counted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydratedRef.current) return;

    if (theaterAssessment && theaterAssessment.pathSpecs.length > 0) {
      let allSpecs = [...theaterAssessment.pathSpecs];
      if (theaterTaskWaypoints.length > 0) {
        const targetUnit = board.units.find((u) => u.id === (theaterDraftingTargetId || theaterTargetId));
        const attackerUnit =
          board.units.find((u) => u.id === theaterDraftingAttackerId) ??
          board.units.find((u) => u.iso === theaterAttackerIso);
        if (targetUnit && attackerUnit) {
          const previewRoute: [number, number][] = [attackerUnit.lngLat, ...theaterTaskWaypoints, targetUnit.lngLat];
          allSpecs.push({
            ingress: multiLegGreatCirclePath(previewRoute, 32),
            targetPoint: targetUnit.lngLat,
            waypoints: theaterTaskWaypoints,
            color: '#FFB020',
          });
        }
      }
      setRaidPath(map, allSpecs);
      return;
    } else if ((theaterTargetId || theaterDraftingTargetId) && theaterTaskWaypoints.length > 0) {
      const targetUnit = board.units.find((u) => u.id === (theaterDraftingTargetId || theaterTargetId));
      const attackerUnit =
        board.units.find((u) => u.id === theaterDraftingAttackerId) ??
        board.units.find((u) => u.iso === theaterAttackerIso);
      if (targetUnit && attackerUnit) {
        const previewRoute: [number, number][] = [attackerUnit.lngLat, ...theaterTaskWaypoints, targetUnit.lngLat];
        setRaidPath(map, [
          {
            ingress: multiLegGreatCirclePath(previewRoute, 32),
            targetPoint: targetUnit.lngLat,
            waypoints: theaterTaskWaypoints,
            color: '#FFB020',
          },
        ]);
        return;
      }
    }

    if (!assessment || assessment.blocked) {
      setRaidPath(map, null);
      return;
    }
    const { from, to } = assessment.raid;
    const color = board.nations[board.units.find((u) => u.id === raidFromId)?.iso ?? '']?.color ?? '#E4B363';
    const waypoints = assessment.raid.waypoints ?? [];

    const fullRoute: [number, number][] =
      assessment.routePoints ?? (waypoints.length > 0 ? [from, ...waypoints, to] : [from, to]);

    if (assessment.releaseLngLat && assessment.releaseKm && assessment.releaseKm > 0 && assessment.releaseKm < assessment.distanceKm) {
      const split = splitRouteAtDistance(fullRoute, assessment.releaseKm);
      const ingress = multiLegGreatCirclePath(split.before, 32);
      const munition = multiLegGreatCirclePath(split.after, 32);
      setRaidPath(map, {
        ingress,
        munition,
        releasePoint: assessment.releaseLngLat,
        targetPoint: to,
        waypoints,
        color,
        munitionColor: '#FFB020',
      });
    } else {
      const ingress = multiLegGreatCirclePath(fullRoute, 32);
      setRaidPath(map, {
        ingress,
        targetPoint: to,
        waypoints,
        color,
        munitionColor: '#FFB020',
      });
    }
  }, [
    assessment,
    theaterAssessment,
    theaterTaskWaypoints,
    theaterTargetId,
    theaterAttackerIso,
    theaterDraftingAttackerId,
    theaterDraftingTargetId,
    raidFromId,
    raidWaypoints,
    board.nations,
    board.units,
    mapRef,
  ]);

  // A raid whose ends have left the board is not a raid — and neither is one
  // aimed at its own side, which is what changing the raider to a unit of the
  // target's nation would otherwise leave selected but invisible in the list.
  useEffect(() => {
    if (raidFromId && !board.units.some((u) => u.id === raidFromId)) setRaidFromId(null);
    if (!raidToId) return;
    const attacker = board.units.find((u) => u.id === raidFromId);
    const target = board.units.find((u) => u.id === raidToId);
    if (!target || (attacker && target.iso === attacker.iso)) setRaidToId(null);
  }, [board.units, raidFromId, raidToId]);

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
    chooseSystem,
    chooseFormation,
    echelonId,
    setEchelonId,
    deployCount,
    setDeployCount,
    forces,
    nationTally,
    setHolding,
    removeHolding,
    stockLeft,
    systems,
    munitions,
    saveSystem,
    importSystems,
    clearCustomSystems,
    deleteSystem,
    storageKind,
    pendingComposition,
    setPendingComposition,
    formations: allFormations(board.formations),
    createFormation,
    deleteFormation,
    selectedUnit,
    selectUnit: setSelectedId,
    renameUnit,
    setUnitEchelon,
    setUnitSystem,
    setUnitLoadout,
    setUnitCount,
    setUnitComposition,
    removeUnit,
    flyToUnit,
    clearUnits,
    clearNations,
    setSimulationNations,
    scenarios: scenarioDoc.items,
    activeScenario: scenarioDoc.items.find((s) => s.id === scenarioDoc.active) ?? null,
    saveScenario,
    updateScenario,
    loadScenario,
    renameScenario,
    duplicateScenario,
    deleteScenario,
    exportBundle,
    importBundle,
    raidFromId,
    raidToId,
    setRaidFrom: setRaidFromId,
    setRaidTo: setRaidToId,
    raidCandidates,
    assessment,
    standoffEnabled,
    setStandoffEnabled,
    selectedWeaponIndex,
    setSelectedWeaponIndex,
    salvoSize,
    setSalvoSize,
    selectedEwEscortId,
    setSelectedEwEscortId,
    selectedSeadEscortId,
    setSelectedSeadEscortId,
    raidWaypoints,
    setRaidWaypoints,
    addRaidWaypoint,
    removeRaidWaypoint,
    clearRaidWaypoints,
    autoAvoidanceWaypoints,
    waypointPlacingActive,
    waypointPlacingMode,
    setWaypointPlacingActive,
    theaterTargetId,
    setTheaterTargetId,
    theaterAttackerIso,
    setTheaterAttackerIso,
    theaterPhases,
    setTheaterPhases,
    addTheaterPhase,
    removeTheaterPhase,
    reorderTheaterPhase,
    theaterTaskWaypoints,
    setTheaterTaskWaypoints,
    addTheaterTaskWaypoint,
    removeTheaterTaskWaypoint,
    clearTheaterTaskWaypoints,
    theaterDraftingAttackerId,
    setTheaterDraftingAttackerId,
    theaterDraftingTargetId,
    setTheaterDraftingTargetId,
    theaterUmbrella,
    theaterAttackers,
    theaterAssessment,
    playbackActive,
    playbackPlaying,
    playbackTimeSec,
    playbackSpeed,
    playbackModel,
    playbackFrame,
    startPlayback,
    stopPlayback,
    togglePlayPlayback,
    seekPlayback,
    setPlaybackSpeed,
    campaignTurns,
    campaignBalance,
    executeCampaignTurn,
    autoGenerateRetaliationPlan,
    resetCampaign,
    navalAssessment,
    bmdAssessment,
    coverage,
    setCoverageMode,
    toggleCoverageKind,
    toggleCoverageTarget,
    setBallisticTargets,
    setTargetAltitude,
    hoveredEnvelope,
    undo,
    redo,
    canUndo,
    canRedo,
    hydrate,
  };
}
