import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');

describe('release checks', () => {
  it('runs the repository isolated unit-test script before release gates', () => {
    const releaseCheck = resolve(repositoryRoot, 'scripts/release-check.mjs');
    const probe = `
      const childProcess = require('node:child_process');
      childProcess.spawnSync = (command, args, options) => {
        console.log('__GATE__' + JSON.stringify({ command, args, cwd: options.cwd }));
        return { status: 0 };
      };
      require('node:module').syncBuiltinESMExports();
      await import(require('node:url').pathToFileURL(process.argv[1]).href);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, releaseCheck], {
      encoding: 'utf8',
    });
    const invocations = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith('__GATE__'))
      .map((line) => JSON.parse(line.slice('__GATE__'.length)));

    expect(result.status).toBe(0);
    expect(invocations[0]).toEqual({
      command: 'bun',
      args: ['run', 'test:unit'],
      cwd: repositoryRoot,
    });
  });

  it('uses the same isolated unit-test script in the macOS release workflow', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
    const unitStep = workflow.match(/- name: Unit\/integration tests\r?\n\s+run: ([^\r\n]+)/);

    expect(unitStep?.[1]).toBe('bun run test:unit');
  });
});
