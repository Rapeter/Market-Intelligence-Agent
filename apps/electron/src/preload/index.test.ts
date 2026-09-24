import { describe, expect, it } from 'bun:test';
import { createBusinessResearchBridge } from './businessResearchBridge.ts';

describe('business research preload surface', () => {
  it('exposes distinct pause, resume, and removal operations for topic monitors', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createBusinessResearchBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true };
    });
    const resume = Reflect.get(api, 'resumeSubscription') as ((input: { subscriptionId: string }) => Promise<unknown>) | undefined;
    const remove = Reflect.get(api, 'removeSubscription') as ((input: { subscriptionId: string }) => Promise<unknown>) | undefined;
    expect(typeof resume).toBe('function');
    expect(typeof remove).toBe('function');
    if (resume === undefined || remove === undefined) return;

    await resume({ subscriptionId: 'subscription-1' });
    await remove({ subscriptionId: 'subscription-1' });
    expect(calls).toEqual([
      { channel: 'businessResearch:resumeSubscription', args: [{ subscriptionId: 'subscription-1' }] },
      { channel: 'businessResearch:removeSubscription', args: [{ subscriptionId: 'subscription-1' }] },
    ]);
  });

  it('exposes fixed typed operations without a generic IPC or network primitive', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createBusinessResearchBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true };
    });
    await api.start({ task: { industry: 'EV', question: 'Compare updates', competitors: ['A', 'B'] }, mode: 'fixture' });
    await api.listEvents({ runId: 'run-1' });
    await api.setBraveKey({ apiKey: 'brave-secret-value' });

    expect(calls).toEqual([
      { channel: 'businessResearch:start', args: [{ task: { industry: 'EV', question: 'Compare updates', competitors: ['A', 'B'] }, mode: 'fixture' }] },
      { channel: 'businessResearch:listEvents', args: [{ runId: 'run-1' }] },
      { channel: 'businessResearch:setBraveKey', args: [{ apiKey: 'brave-secret-value' }] },
    ]);
    expect(Object.keys(api)).not.toContain('send');
    expect(Object.keys(api)).not.toContain('fetch');
  });
});
