import { describe, expect, it } from 'bun:test';
import { createBusinessResearchLiveE2eBridge } from './businessResearchLiveE2eBridge';

describe('live business-research E2E preload bridge', () => {
  it('does not expose test-only operations unless live E2E mode is explicitly enabled', () => {
    const bridge = createBusinessResearchLiveE2eBridge(async () => undefined, false);

    expect(bridge).toBeUndefined();
  });

  it('exposes only fixed counterfactual and monitor-check operations when enabled', async () => {
    const calls: Array<{ channel: string; input: unknown }> = [];
    const bridge = createBusinessResearchLiveE2eBridge(async (channel, input) => {
      calls.push({ channel, input });
      return { ok: true };
    }, true);

    expect(Object.keys(bridge ?? {}).sort()).toEqual(['checkSubscriptionNow', 'runCounterfactualProbes']);
    await bridge?.runCounterfactualProbes({ task: { question: 'same task' } });
    await bridge?.checkSubscriptionNow({ subscriptionId: 'subscription-live-e2e' });
    expect(calls).toEqual([
      { channel: 'businessResearch:e2e:counterfactualProbes', input: { task: { question: 'same task' } } },
      { channel: 'businessResearch:e2e:checkSubscriptionNow', input: { subscriptionId: 'subscription-live-e2e' } },
    ]);
  });
});
