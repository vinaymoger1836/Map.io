import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Additional tripwire: tests must leave all user documents byte-for-byte intact. */
function fingerprint() {
  const files = readdirSync('data').filter((file) => file.endsWith('.json')).map((file) => path.join('data', file));
  files.push('public/data/systems.json', 'pacific-csg-defense.wargames.json');
  return Object.fromEntries(files.sort().map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
}

export default function setup() {
  const before = fingerprint();
  return () => {
    const after = fingerprint();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Protected scenario/data files changed during the browser run. Inspect the changes; the test harness must never edit them.');
    }
  };
}
