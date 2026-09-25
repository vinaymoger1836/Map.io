import os from 'node:os';
import { execFileSync } from 'node:child_process';

/** Best-effort benchmark metadata; never changes the machine's power settings. */
export function machineEnvironment() {
  let powerScheme = 'not measured';
  if (process.platform === 'win32') {
    try { powerScheme = execFileSync('powercfg', ['/getactivescheme'], { encoding: 'utf8', timeout: 5000 }).trim(); }
    catch { /* Keep the explicit unknown when the host does not expose it. */ }
  }
  return { os: `${os.platform()} ${os.release()}`, architecture: os.arch(),
    cpu: os.cpus()[0]?.model.trim(), logicalCores: os.cpus().length,
    ramBytes: os.totalmem(), powerScheme };
}
