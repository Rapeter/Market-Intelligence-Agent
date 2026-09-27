import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { resolveBundledPiCliEntry } from './piRuntime.ts';

describe('bundled Pi runtime', () => {
  it('resolves the Pi CLI from the Electron app dependency tree', () => {
    const appPath = resolve(import.meta.dir, '../..');
    const entry = resolveBundledPiCliEntry(appPath);

    expect(entry).toBe(resolve(appPath, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'));
  });

  it('fails with a reinstall hint when the packaged Pi runtime is missing', () => {
    expect(() => resolveBundledPiCliEntry(resolve(import.meta.dir, '../../missing-app')))
      .toThrow('The bundled Pi runtime is missing from this installation. Reinstall Enterprise Research Workbench.');
  });
});
