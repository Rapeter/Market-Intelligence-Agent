import { describe, expect, it } from 'bun:test';
import { collectDiagnostics } from './collector.ts';
import type { DiagnosticsInput } from './types.ts';

function baseInput(): DiagnosticsInput {
  return {
    version: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    electronVersion: '33.0.0',
    agentProviderId: 'local',
    agentState: 'idle',
    llmProviderId: 'anthropic',
    llmModel: 'claude-3-5-sonnet-20241022',
    capabilities: ['business-research.projects', 'business-research.reports'],
    resources: { dev: true, root: '/repo' },
    pi: {
      status: 'running',
      command: 'bunx pi --mode rpc',
      cwd: '/repo',
      extensions: ['.pi/extensions/finagent/index.ts'],
      providersConfigured: ['anthropic'],
      model: 'claude-3-5-sonnet-20241022',
      lastExitCode: null,
      lastExitSignal: null,
      stderrTail: null,
    },
    errors: [],
  };
}

describe('collectDiagnostics', () => {
  it('assembles a JSON-stable bundle with no undefined fields', async () => {
    const bundle = await collectDiagnostics(baseInput());

    // JSON round-trip must not drop or add any field.
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
    expect(bundle.app.version).toBe('0.1.0');
    expect(bundle.app.platform).toEqual({ os: 'darwin', arch: 'arm64', electron: '33.0.0' });
    expect(bundle.providers).toEqual({ llm: { id: 'anthropic', model: 'claude-3-5-sonnet-20241022' } });
    expect(bundle.capabilities.available).toEqual(['business-research.projects', 'business-research.reports']);
    expect(JSON.stringify(bundle)).not.toMatch(/longbridge|broker|portfolio|market\.quote/i);
    expect(bundle.redaction.applied).toBe(false);
  });

  it('copies research capabilities and errors without shared references', async () => {
    const input = {
      ...baseInput(),
      errors: [{ at: 1, source: 'main', message: 'boom', stack: 'stack' }],
    };
    const bundle = await collectDiagnostics(input);
    expect(bundle.errors).toEqual(input.errors);
    expect(bundle.capabilities.available).toEqual(input.capabilities);
    // Mutating the source afterwards must not affect the collected bundle.
    input.errors[0].message = 'changed';
    expect(bundle.errors[0].message).toBe('boom');
  });
});
