import { afterEach, describe, expect, it } from 'bun:test';
import { registerProviderOverrides } from './index.ts';

afterEach(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.FINAGENT_PROVIDER_OVERRIDES;
});

describe('Pi runtime provider configuration', () => {
  it('does not register a relay when no provider override is configured', () => {
    const calls: Array<{ name: string; config: { baseUrl?: string } }> = [];
    registerProviderOverrides({
      registerProvider: (name, config) => calls.push({ name, config }),
    });
    expect(calls).toEqual([]);
  });

  it('applies a custom endpoint from the desktop host', () => {
    process.env.FINAGENT_PROVIDER_OVERRIDES = JSON.stringify([{
      provider: 'custom-provider',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      models: [{ id: 'model-a', name: 'Model A' }],
    }]);
    const calls: Array<{ name: string; config: { baseUrl?: string; apiKey?: string } }> = [];
    registerProviderOverrides({
      registerProvider: (name, config) => calls.push({ name, config }),
    });
    expect(calls).toEqual([{
      name: 'custom-provider',
      config: expect.objectContaining({ baseUrl: 'https://example.test/v1', apiKey: 'test-key' }),
    }]);
  });

  it('prefers an explicit provider override to the legacy Anthropic base URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://legacy.example.test';
    process.env.FINAGENT_PROVIDER_OVERRIDES = JSON.stringify([{
      provider: 'anthropic',
      baseUrl: 'https://configured.example.test',
    }]);
    const calls: Array<{ name: string; config: { baseUrl?: string } }> = [];
    registerProviderOverrides({
      registerProvider: (name, config) => calls.push({ name, config }),
    });
    expect(calls).toEqual([{
      name: 'anthropic',
      config: { baseUrl: 'https://configured.example.test' },
    }]);
  });
});
