import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PI_CLI_RELATIVE_PATH = join('node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');

/** Resolve the Pi CLI shipped as an app dependency, including inside app.asar. */
export function resolveBundledPiCliEntry(appPath: string): string {
  const entry = join(appPath, PI_CLI_RELATIVE_PATH);
  if (!existsSync(entry)) {
    throw new Error('The bundled Pi runtime is missing from this installation. Reinstall Enterprise Research Workbench.');
  }
  return entry;
}
