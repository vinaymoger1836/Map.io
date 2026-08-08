'use client';

export interface Selection {
  name: string;
  kind?: string;
  status?: string;
  note?: string;
  claimant?: string;
  lngLat?: [number, number];
}

const KIND_LABEL: Record<string, string> = {
  occupied: 'Occupied territory',
  'occupied-2014': 'Annexed 2014',
  front: 'Line of contact',
  hotspot: 'Contested',
  'de-facto': 'De facto line',
  disputed: 'Disputed boundary',
  reference: 'Recognised border',
  gas: 'Gas pipeline',
  oil: 'Oil pipeline',
  lng: 'LNG terminal',
  refinery: 'Refining / export',
  base: 'Military base',
  naval: 'Naval base',
  nuclear: 'Nuclear site',
  airdef: 'Missile defence',
  eez: 'Shelf claim',
  nsr: 'Shipping route',
  port: 'Arctic port',
  capital: 'Capital',
  city: 'City',
};

export default function DetailPanel({
  selection,
  onClose,
}: {
  selection: Selection;
  onClose: () => void;
}) {
  const { name, kind, status, note, claimant, lngLat } = selection;

  return (
    <aside className="detail" role="dialog" aria-label={name}>
      <div className="detail-head">
        <h2>
          {name}
          {kind && <span className="detail-kind">{KIND_LABEL[kind] ?? kind}</span>}
        </h2>
        <button className="detail-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <div className="detail-body">
        {note && <p>{note}</p>}
        <dl style={{ margin: 0 }}>
          {status && (
            <div className="detail-row">
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
          )}
          {claimant && (
            <div className="detail-row">
              <dt>Claimant</dt>
              <dd>{claimant}</dd>
            </div>
          )}
          {lngLat && (
            <div className="detail-row">
              <dt>Position</dt>
              <dd>
                {Math.abs(lngLat[1]).toFixed(3)}°{lngLat[1] >= 0 ? 'N' : 'S'}{' '}
                {Math.abs(lngLat[0]).toFixed(3)}°{lngLat[0] >= 0 ? 'E' : 'W'}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </aside>
  );
}
