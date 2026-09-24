import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const harness = await import('./electron-harness.mjs');
const userDataDir = join(tmpdir(), 'market-intelligence-profile');

describe('business research Electron harness configuration', () => {
  it('exposes a testable environment builder for local and Pi runtime launches', () => {
    expect(typeof harness.buildElectronEnvironment).toBe('function');
  });

  it('keeps hidden-window behavior by default and only enables Pi when explicitly requested', () => {
    if (typeof harness.buildElectronEnvironment !== 'function') return;

    const sourceEnv = {
      FINAGENT_E2E_VISIBLE: '1', FINAGENT_LIVE_E2E: '1', FINAGENT_PACKAGED: '1', KEEP_ME: 'present',
    };
    const environment = harness.buildElectronEnvironment({
      userDataDir,
    }, sourceEnv);

    expect(environment.FINAGENT_AGENT_PROVIDER).toBe('local');
    expect(environment.FINAGENT_E2E_HIDDEN).toBe('1');
    expect(environment.FINAGENT_E2E_VISIBLE).toBe('0');
    expect(environment.FINAGENT_LIVE_E2E).toBe('0');
    expect(environment.FINAGENT_PACKAGED).toBe('0');
    expect(environment.KEEP_ME).toBe('present');
    expect(sourceEnv.FINAGENT_E2E_VISIBLE).toBe('1');
  });

  it('uses Pi runtime only for an explicit live launch', () => {
    if (typeof harness.buildElectronEnvironment !== 'function') return;

    const environment = harness.buildElectronEnvironment({
      agentProvider: 'pi-runtime',
      visible: true,
      userDataDir,
    }, {});

    expect(environment.FINAGENT_AGENT_PROVIDER).toBe('pi-runtime');
    expect(environment.FINAGENT_E2E_HIDDEN).toBe('0');
    expect(environment.FINAGENT_E2E_VISIBLE).toBe('1');
  });

  it('enables privileged acceptance operations only for an explicitly marked live E2E launch', () => {
    if (typeof harness.buildElectronEnvironment !== 'function') return;

    const environment = harness.buildElectronEnvironment({
      agentProvider: 'pi-runtime',
      liveE2e: true,
      userDataDir,
    }, {});

    expect(environment.FINAGENT_LIVE_E2E).toBe('1');
  });

  it('rejects unknown providers and non-absolute profile paths', () => {
    if (typeof harness.buildElectronEnvironment !== 'function') return;

    expect(() => harness.buildElectronEnvironment({
      agentProvider: 'unknown', userDataDir,
    }, {})).toThrow('agentProvider');
    expect(() => harness.buildElectronEnvironment({
      userDataDir: 'relative/profile',
    }, {})).toThrow('absolute');
  });
});
