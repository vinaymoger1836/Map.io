'use client';

/**
 * A system's figures, with where each one came from.
 *
 * Open sources disagree about the same missile, and some numbers are estimates
 * of things nobody publishes. Showing the source next to the figure is the
 * difference between a reference and a claim — and it tells you which numbers
 * are worth arguing with before you build a plan on them. Where a citation has
 * a link, the dot is the link.
 */

import { sourceRef, specLines, type Provenance, type SystemSpec } from '@/lib/specs';

const CONFIDENCE_TITLE = {
  high: 'Published and broadly agreed',
  medium: 'Published but conditional or contested',
  low: 'Estimate',
} as const;

/** Everything known about where a figure came from, as one hover string. */
function describe(provenance: Provenance): string {
  const ref = sourceRef(provenance);
  const parts = [ref.title, CONFIDENCE_TITLE[provenance.confidence]];
  if (ref.kind === 'placeholder') parts.push('No published figure — a model input, not data');
  if (ref.note) parts.push(ref.note);
  return parts.join(' — ');
}

export function SpecSheet({ spec, compact = false }: { spec: SystemSpec; compact?: boolean }) {
  const lines = specLines(spec);
  if (!lines.length) {
    return <p className="wg-empty">No specifications recorded for this system yet.</p>;
  }

  return (
    <dl className={`wg-spec${compact ? ' compact' : ''}`}>
      {lines.map((line) => {
        const provenance = spec.provenance?.[line.path];
        const ref = provenance ? sourceRef(provenance) : null;
        return (
          <div className="wg-spec-row" key={line.path}>
            <dt>{line.label}</dt>
            <dd>
              {line.value}
              {provenance && ref && (
                ref.url ? (
                  <a
                    className={`wg-conf ${provenance.confidence} linked`}
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    title={describe(provenance)}
                    aria-label={`Source: ${ref.title}`}
                  />
                ) : (
                  <span
                    className={`wg-conf ${provenance.confidence}`}
                    title={describe(provenance)}
                    aria-label={`Confidence: ${provenance.confidence}`}
                  />
                )
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
