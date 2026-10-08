const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { buildSync } = require('esbuild');

const output = path.resolve('.cache/warsim-phase7/joint-batch.cjs');
mkdirSync(path.dirname(output), { recursive: true });
buildSync({ entryPoints: [path.resolve('scripts/benchmark-warsim-joint.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'warning' });
require(output);
