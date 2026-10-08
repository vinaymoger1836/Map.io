import type { GeoJSONSourceDiff } from 'maplibre-gl';

function position(a: GeoJSON.Position, b: GeoJSON.Position, alpha: number): GeoJSON.Position {
  const longitudeDelta = ((b[0] - a[0] + 540) % 360) - 180;
  return b.map((value, i) => i === 0 ? ((a[0] + longitudeDelta * alpha + 540) % 360) - 180
    : (a[i] ?? value) + (value - (a[i] ?? value)) * alpha);
}
/** Interpolates only observed endpoints; never predicts an unprocessed outcome. */
export function interpolateGeometry(a: GeoJSON.Geometry, b: GeoJSON.Geometry, alpha: number): GeoJSON.Geometry {
  const t = Math.min(1, Math.max(0, alpha));
  if (t === 1) return b;
  if (a.type === 'Point' && b.type === 'Point') return { type: 'Point', coordinates: position(a.coordinates, b.coordinates, t) };
  if (a.type === 'LineString' && b.type === 'LineString' && a.coordinates.length === b.coordinates.length) {
    return { type: 'LineString', coordinates: b.coordinates.map((p, i) => position(a.coordinates[i], p, t)) };
  }
  return b;
}
export function featureDiff(before: GeoJSON.Feature[], after: GeoJSON.Feature[]): GeoJSONSourceDiff | null {
  const old = new Map(before.map(f => [f.id!, f]));
  const added: GeoJSON.Feature[] = [];
  const updated: NonNullable<GeoJSONSourceDiff['update']> = [];
  for (const f of after) {
    if (f.id === undefined) throw new Error('Moving map features require stable IDs.');
    const previous = old.get(f.id);
    old.delete(f.id);
    if (!previous) { added.push(f); continue; }
    const geometryChanged = JSON.stringify(previous.geometry) !== JSON.stringify(f.geometry);
    const propertiesChanged = JSON.stringify(previous.properties) !== JSON.stringify(f.properties);
    if (geometryChanged || propertiesChanged) updated.push({ id: f.id,
      ...(geometryChanged ? { newGeometry: f.geometry } : {}),
      ...(propertiesChanged ? { removeAllProperties: true,
        addOrUpdateProperties: Object.entries(f.properties ?? {}).map(([key, value]) => ({ key, value })) } : {}),
    });
  }
  if (!old.size && !added.length && !updated.length) return null;
  return { remove: [...old.keys()], add: added, update: updated };
}
