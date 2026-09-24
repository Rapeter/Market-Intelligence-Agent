import { describe, expect, it } from 'bun:test';
import { createBusinessResearchBridge } from './businessResearchBridge.ts';

describe('business research preload surface', () => {
  it('exposes fixed typed operations without a generic IPC or network primitive', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createBusinessResearchBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true };
    });
    await api.start({ task: { industry: 'EV', question: 'Compare updates', competitors: ['A', 'B'] } });
    await api.listEvents({ runId: 'run-1' });
    await api.setBraveKey({ apiKey: 'brave-secret-value' });

    expect(calls).toEqual([
      { channel: 'businessResearch:start', args: [{ task: { industry: 'EV', question: 'Compare updates', competitors: ['A', 'B'] } }] },
      { channel: 'businessResearch:listEvents', args: [{ runId: 'run-1' }] },
      { channel: 'businessResearch:setBraveKey', args: [{ apiKey: 'brave-secret-value' }] },
    ]);
    expect(Object.keys(api)).not.toContain('send');
    expect(Object.keys(api)).not.toContain('fetch');
  });
});
