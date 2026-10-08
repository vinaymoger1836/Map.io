import { describe, expect, it } from 'vitest';
import { featureDiff, interpolateGeometry } from '../../lib/warsim/presentation';

describe('observer presentation', () => {
  it('interpolates shortest longitude across the date line, with no extrapolation', () => {
    const a: GeoJSON.Point = { type: 'Point', coordinates: [179, 0] };
    const b: GeoJSON.Point = { type: 'Point', coordinates: [-179, 2] };
    expect(interpolateGeometry(a, b, .5)).toEqual({ type: 'Point', coordinates: [-180, 1] });
    expect(interpolateGeometry(a, b, 2)).toEqual(b);
    expect(a.coordinates).toEqual([179, 0]);
  });
  it('sends changed geometry separately from properties and explicitly removes lost contacts', () => {
    const a: GeoJSON.Feature = { type: 'Feature', id: 'contact', properties: { label: 'known' }, geometry: { type: 'Point', coordinates: [0, 0] } };
    const b: GeoJSON.Feature = { ...a, geometry: { type: 'Point', coordinates: [1, 0] } };
    expect(featureDiff([a], [b])?.update).toEqual([{ id: 'contact', newGeometry: b.geometry }]);
    expect(featureDiff([a], [])?.remove).toEqual(['contact']);
    expect(featureDiff([a], [a])).toBeNull();
    expect(() => featureDiff([], [{ ...a, id: undefined }])).toThrow(/stable IDs/);
  });
});
