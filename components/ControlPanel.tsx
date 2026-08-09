'use client';

import { useState } from 'react';
import { GROUPS, type Swatch } from '@/lib/layerSpec';

function KeySwatch({ swatch }: { swatch: Swatch }) {
  const { shape, color, edge } = swatch;
  const base: React.CSSProperties = { width: 22, height: 12, position: 'relative' };

  if (shape === 'fill') {
    return (
      <span
        className="key-swatch"
        style={{
          ...base,
          background: `color-mix(in srgb, ${color} 42%, transparent)`,
          border: `1px solid ${color}`,
        }}
      />
    );
  }

  if (shape === 'line' || shape === 'dash') {
    return (
      <span className="key-swatch" style={base}>
        <span
          style={{
            position: 'absolute',
            top: 5,
            left: 0,
            right: 0,
            height: 2,
            background:
              shape === 'dash'
                ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`
                : color,
          }}
        />
      </span>
    );
  }

  if (shape === 'band') {
    return (
      <span className="key-swatch" style={base}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: `color-mix(in srgb, ${color} 26%, transparent)`,
            filter: 'blur(1.5px)',
          }}
        />
        <span
          style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 2, background: color }}
        />
      </span>
    );
  }

  // Label-only layers have no mark on the map, so the key shows the type itself.
  if (shape === 'text') {
    return (
      <span className="key-swatch" style={base}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color,
            fontSize: 9,
            letterSpacing: '0.14em',
            lineHeight: 1,
          }}
        >
          Aa
        </span>
      </span>
    );
  }

  if (shape === 'ring') {
    return (
      <span className="key-swatch" style={base}>
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: 6,
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: `1.6px solid ${color}`,
          }}
        />
      </span>
    );
  }

  return (
    <span className="key-swatch" style={base}>
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: 8,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
        }}
      />
      {edge ? (
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: 0,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: edge,
          }}
        />
      ) : null}
    </span>
  );
}

export default function ControlPanel({
  state,
  onToggle,
  asOf,
  warning,
  note,
}: {
  state: Record<string, boolean>;
  onToggle: (id: string) => void;
  asOf: string;
  /** Data-loading failure — something on the map is missing. */
  warning?: string | null;
  /** Capability notice, e.g. a projection the GPU would not render. */
  note?: string | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map((g) => [g.id, g.open]))
  );

  return (
    <>
      <div className="panel-scroll">
        {GROUPS.map((group) => {
          const activeCount = group.keys.filter((k) => state[k.id]).length;
          const isOpen = open[group.id];
          return (
            <section className="group" key={group.id}>
              <button
                className="group-head"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [group.id]: !o[group.id] }))}
              >
                <span className={`chevron${isOpen ? '' : ' closed'}`} aria-hidden />
                <span className="group-title">{group.title}</span>
                <span className="group-count">
                  {activeCount}/{group.keys.length}
                </span>
              </button>

              {isOpen && (
                <div className="group-body">
                  {group.keys.map((key) => (
                    <button
                      key={key.id}
                      className={`key${state[key.id] ? ' on' : ''}`}
                      aria-pressed={!!state[key.id]}
                      onClick={() => onToggle(key.id)}
                    >
                      <KeySwatch swatch={key.swatch} />
                      <span className="key-label">{key.label}</span>
                      <span className="key-switch" aria-hidden />
                    </button>
                  ))}
                  {group.note && <p className="group-note">{group.note}</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="stamp">
        Situation snapshot <b>{asOf}</b>
        <br />
        Approximate. Edit <b>public/data/*.geojson</b> to update.
        {warning ? (
          <>
            <br />
            {warning}
          </>
        ) : null}
        {note ? (
          <>
            <br />
            {note}
          </>
        ) : null}
      </p>
    </>
  );
}
