import { describe, expect, it } from 'bun:test';
import { createCodeError } from '@finagent/shared/agent/errors';
import { retryTransientMonitorProbe } from './businessResearchMonitorRetry.ts';

describe('retryTransientMonitorProbe', () => {
  it('retries one transient public-search failure and returns the second result', async () => {
    let attempts = 0;
    const result = await retryTransientMonitorProbe(new AbortController().signal, async () => {
      attempts += 1;
      if (attempts === 1) throw createCodeError('PROVIDER_UNAVAILABLE', 'Search temporarily unavailable.');
      return ['source'];
    });

    expect(attempts).toBe(2);
    expect(result).toEqual(['source']);
  });

  it('does not retry permanent or unrelated errors', async () => {
    let attempts = 0;
    await expect(retryTransientMonitorProbe(new AbortController().signal, async () => {
      attempts += 1;
      throw createCodeError('INVALID_ARGUMENT', 'Bad query.');
    })).rejects.toThrow('Bad query.');

    expect(attempts).toBe(1);
  });

  it('stops rather than retrying when the monitor is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;
    await expect(retryTransientMonitorProbe(controller.signal, async () => {
      attempts += 1;
      throw createCodeError('PROVIDER_UNAVAILABLE', 'Search temporarily unavailable.');
    })).rejects.toThrow('Search temporarily unavailable.');

    expect(attempts).toBe(1);
  });
});
