import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// resource-locator.ts -> resources -> src -> shared -> packages -> repo root.
const REPO_ROOT_OFFSET = 4;

function readResourcesPath(): string | undefined {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  return proc.resourcesPath;
}

function repoRootFromHere(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, ...new Array<string>(REPO_ROOT_OFFSET).fill('..'));
}

/** Resolve shared Pi resources without depending on the launch working directory. */
export function isPackaged(): boolean {
  const resourcesPath = readResourcesPath();
  return process.env.FINAGENT_PACKAGED === '1'
    && typeof resourcesPath === 'string'
    && resourcesPath.length > 0
    && basename(resourcesPath).toLowerCase() === 'resources';
}

export function getRuntimeRoot(): string {
  return isPackaged() ? readResourcesPath() as string : repoRootFromHere();
}

export function getPiExtensionEntry(): string {
  return isPackaged()
    ? join(getRuntimeRoot(), 'extensions', 'finagent', 'index.js')
    : join(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts');
}

/** Working directory used to launch the Pi runtime. */
export function getPiCwd(): string {
  return getRuntimeRoot();
}
