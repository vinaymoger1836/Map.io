'use client';

/**
 * A system's figures, with where each one came from.
 *
 * Open sources disagree about the same missile, and some numbers are estimates
 * of things nobody publishes. Showing the source and a confidence next to the
 * figure is the difference between a reference and a claim — and it tells you
 * which numbers are worth arguing with before you build a plan on them.
 */

import { specLines, type SystemSpec } from '@/lib/specs';

const CONFIDENCE_TITLE = {
  high: 'Published figure, broadly agreed',
  medium: 'Open sources vary',
  low: 'Estimate',
} as const;

export function SpecSheet({ spec, compact = false }: { spec: SystemSpec; compact?: boolean }) {
  const lines = specLines(spec);
  if (!lines.length) {
    return <p className="wg-empty">No specifications recorded for this system yet.</p>;
  }

  return (
    <dl className={`wg-spec${compact ? ' compact' : ''}`}>
      {lines.map((line) => {
        const provenance = spec.provenance?.[line.path];
        return (
          <div className="wg-spec-row" key={line.path}>
            <dt>{line.label}</dt>
            <dd>
              {line.value}
              {provenance && (
                <span
                  className={`wg-conf ${provenance.confidence}`}
                  title={`${provenance.source} — ${CONFIDENCE_TITLE[provenance.confidence]}`}
                  aria-label={`Confidence: ${provenance.confidence}`}
                />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
