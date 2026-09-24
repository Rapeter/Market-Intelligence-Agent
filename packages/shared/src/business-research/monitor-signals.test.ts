import { describe, expect, it } from 'bun:test';
import { parseBusinessResearchId } from '@finagent/core';
import { evaluateBusinessResearchMonitorSignal } from './monitor-signals.ts';

const subscriptionId = parseBusinessResearchId('subscription', 'subscription-ev-monitor')!;
const knownSource = {
  url: 'https://example.com/a-motors/range',
  title: 'A Motors range update',
  summary: 'A Motors publishes a new electric vehicle range update.',
  contentFingerprint: 'body-v1',
};

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subscriptionId,
    topic: 'battery range',
    industry: 'electric vehicles',
    competitors: ['A Motors', 'B Motors'],
    previousSources: [],
    currentSources: [],
    ...overrides,
  };
}

describe('evaluateBusinessResearchMonitorSignal', () => {
  it('triggers once for a new public source relevant to the subscribed topic', async () => {
    const decision = await evaluateBusinessResearchMonitorSignal(input({
      currentSources: [knownSource],
    }));

    expect(decision).toMatchObject({
      kind: 'trigger',
      reason: 'new_source',
      url: knownSource.url,
    });
    expect((decision as { fingerprint?: unknown }).fingerprint).toMatch(/^signal-[a-f0-9]{64}$/u);
  });

  it('detects a material body change at a known relevant source', async () => {
    const decision = await evaluateBusinessResearchMonitorSignal(input({
      previousSources: [knownSource],
      currentSources: [{ ...knownSource, contentFingerprint: 'body-v2' }],
    }));

    expect(decision).toMatchObject({ kind: 'trigger', reason: 'source_updated', url: knownSource.url });
  });

  it('does not retrigger when only retrieval time changes and source content is unchanged', async () => {
    const decision = await evaluateBusinessResearchMonitorSignal(input({
      previousSources: [knownSource],
      currentSources: [{ ...knownSource, retrievedAt: '2026-09-25T00:00:00.000Z' }],
    }));

    expect(decision).toEqual({ kind: 'skip', reason: 'no_change' });
  });

  it('ignores unrelated search results and failed checks', async () => {
    const unrelated = await evaluateBusinessResearchMonitorSignal(input({
      currentSources: [{ url: 'https://example.com/bread', title: 'Sourdough guide', summary: 'How to bake bread.' }],
    }));
    const failed = await evaluateBusinessResearchMonitorSignal(input({ checkFailed: true, currentSources: [knownSource] }));

    expect(unrelated).toEqual({ kind: 'skip', reason: 'unrelated' });
    expect(failed).toEqual({ kind: 'skip', reason: 'check_failed' });
  });

  it('does not create a second run for a previously seen signal fingerprint', async () => {
    const first = await evaluateBusinessResearchMonitorSignal(input({ currentSources: [knownSource] }));
    const fingerprint = (first as { fingerprint?: string } | undefined)?.fingerprint;
    const repeated = await evaluateBusinessResearchMonitorSignal(input({
      currentSources: [knownSource],
      seenFingerprints: fingerprint === undefined ? [] : [fingerprint],
    }));

    expect(repeated).toEqual({ kind: 'skip', reason: 'duplicate_signal' });
  });

  it('canonicalizes duplicate URLs and chooses one deterministic trigger per check', async () => {
    const duplicateFragment = { ...knownSource, url: `${knownSource.url}#latest`, title: 'Duplicate fragment result' };
    const decision = await evaluateBusinessResearchMonitorSignal(input({ currentSources: [knownSource, duplicateFragment] }));
    const reordered = await evaluateBusinessResearchMonitorSignal(input({ currentSources: [duplicateFragment, knownSource] }));

    expect(decision).toMatchObject({ kind: 'trigger', reason: 'new_source', url: knownSource.url });
    expect(reordered).toEqual(decision);
  });
});
