import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  getPiCwd,
  getPiExtensionEntry,
  getRuntimeRoot,
  isPackaged,
} from './resource-locator.ts';

const PACKAGED = 'FINAGENT_PACKAGED';
const saved = process.env[PACKAGED];
const resourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

afterEach(() => {
  if (saved === undefined) {
    delete process.env[PACKAGED];
  } else {
    process.env[PACKAGED] = saved;
  }
  if (resourcesPathDescriptor === undefined) {
    Reflect.deleteProperty(process, 'resourcesPath');
  } else {
    Object.defineProperty(process, 'resourcesPath', resourcesPathDescriptor);
  }
});

describe('ResourceLocator (dev mode)', () => {
  it('resolves the repo root from import.meta.url, not process.cwd()', () => {
    delete process.env[PACKAGED];
    // Bun tests run under the repo root; the module must not depend on it.
    const root = getRuntimeRoot();
    expect(getPiCwd()).toBe(root);
  });

  it('resolves the dev Pi extension entry to the source .ts file', () => {
    delete process.env[PACKAGED];
    expect(getPiExtensionEntry()).toBe(resolve(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts'));
  });

  it('lets the source Pi extension resolve its workspace runtime dependencies', () => {
    delete process.env[PACKAGED];
    const result = spawnSync(
      'node',
      [
        '-e',
        "const { createRequire } = require('node:module'); const extensionRequire = createRequire(process.argv[1]); extensionRequire.resolve('@finagent/core'); extensionRequire.resolve('@finagent/shared');",
        getPiExtensionEntry(),
      ],
      {
        cwd: getRuntimeRoot(),
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      },
    );

    expect(result.status).toBe(0);
  });

  it('does not report packaged without a real resourcesPath (non-Electron env)', () => {
    process.env[PACKAGED] = '1';
    // No process.resourcesPath in a bare Node/Bun process -> still dev.
    expect(isPackaged()).toBe(false);
  });
});

describe('ResourceLocator (packaged mode)', () => {
  it('resolves the shipped Pi extension under a Windows resources directory', () => {
    const resourcesPath = 'C:\\Program Files\\Enterprise Research Workbench\\resources';
    process.env[PACKAGED] = '1';
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });

    expect(isPackaged()).toBe(true);
    expect(getRuntimeRoot()).toBe(resourcesPath);
    expect(getPiCwd()).toBe(resourcesPath);
    expect(getPiExtensionEntry()).toBe(join(resourcesPath, 'extensions', 'finagent', 'index.js'));
  });

  it('keeps the macOS resources folder name recognized case-insensitively', () => {
    const resourcesPath = '/Applications/Enterprise Research Workbench.app/Contents/Resources';
    process.env[PACKAGED] = '1';
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });

    expect(isPackaged()).toBe(true);
    expect(getRuntimeRoot()).toBe(resourcesPath);
  });
});
