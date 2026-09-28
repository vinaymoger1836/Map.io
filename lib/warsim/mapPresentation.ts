import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import { featureDiff, interpolateGeometry } from './presentation';
import { measureWarSim } from './diagnostics';

type SourceState = { source: GeoJSONSource; signature: string; drawn: GeoJSON.Feature[];
  from: Map<string | number, GeoJSON.Feature>; target: GeoJSON.Feature[]; started: number; duration: number };
type MapState = { scope: string; playing: boolean; sources: Map<string, SourceState>; raf: number; lastDraw: number };
const states = new WeakMap<MLMap, MapState>();
const moving = new Set(['warsim-entities-src', 'warsim-missiles-src']);
const incremental = new Set([...moving, 'warsim-contacts-src']);

export function beginPresentation(map: MLMap, scope: string, playing: boolean) {
  let state = states.get(map);
  if (state && state.scope !== scope) { stopPresentation(map); state = undefined; }
  if (!state) { state = { scope, playing, sources: new Map(), raf: 0, lastDraw: 0 }; states.set(map, state); }
  state.playing = playing;
  if (!playing) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    for (const [id, source] of state.sources) {
      if (incremental.has(id) && map.getSource(id) === source.source) { source.duration = 0; flush(source, source.target); }
    }
  }
}
function flush(state: SourceState, features: GeoJSON.Feature[]) {
  const diff = featureDiff(state.drawn, features);
  if (diff) measureWarSim('map.updateData.ms', () => state.source.updateData(diff));
  state.drawn = features;
}
function animate(map: MLMap, state: MapState) {
  if (state.raf || !state.playing) return;
  const frame = (now: number) => {
    state.raf = 0;
    if (!state.playing || states.get(map) !== state) return;
    let pending = false;
    for (const [id, source] of state.sources) {
      if (!moving.has(id) || source.duration === 0 || map.getSource(id) !== source.source) continue;
      const alpha = Math.min(1, (now - source.started) / source.duration);
      pending ||= alpha < 1;
      if (now - state.lastDraw < 32 && alpha < 1) continue;
      const features = source.target.map(f => {
        const previous = source.from.get(f.id!);
        return previous ? { ...f, geometry: interpolateGeometry(previous.geometry, f.geometry, alpha) } : f;
      });
      flush(source, features);
      if (alpha === 1) source.duration = 0;
    }
    if (now - state.lastDraw >= 32) state.lastDraw = now;
    if (pending) state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

/** Static source submissions are skipped when unchanged; motion updates carry stable IDs. */
export function presentSource(map: MLMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  const state = states.get(map);
  if (!source || !state) return;
  const signature = JSON.stringify(data);
  const previous = state.sources.get(id);
  if (previous?.source === source && previous.signature === signature) return;
  const now = performance.now();
  if (!previous || previous.source !== source || !incremental.has(id)) {
    measureWarSim('map.setData.ms', () => source.setData(data));
    state.sources.set(id, { source, signature, drawn: data.features, target: data.features,
      from: new Map(), started: now, duration: 0 });
    return;
  }
  previous.from = new Map(previous.drawn.map(f => [f.id!, f]));
  previous.target = data.features;
  previous.signature = signature;
  previous.duration = state.playing && moving.has(id) ? Math.min(1000, Math.max(100, now - previous.started)) : 0;
  previous.started = now;
  if (previous.duration) animate(map, state);
  else flush(previous, data.features);
}
export function stopPresentation(map: MLMap) {
  const state = states.get(map);
  if (state) { cancelAnimationFrame(state.raf); states.delete(map); }
}
