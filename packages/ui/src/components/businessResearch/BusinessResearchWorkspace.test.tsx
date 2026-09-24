import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { Provider, createStore } from 'jotai';
import { parseBusinessResearchId } from '@finagent/core';
import { businessResearchFormAtom } from '../../atoms/businessResearchAtoms';
import type { FinagentClient } from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { fallbackClient, FinagentClientProvider } from '../../client';

let restore: () => void;
let createRoot: typeof import('react-dom/client')['createRoot'];
let BusinessResearchWorkspace: typeof import('./BusinessResearchWorkspace')['BusinessResearchWorkspace'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ createRoot } = await import('react-dom/client'));
  ({ BusinessResearchWorkspace } = await import('./BusinessResearchWorkspace'));
});
afterAll(() => restore());

function setup() {
  const calls: Array<{ industry: string; question: string; competitors: string[]; strategyId: string; mode: string }> = [];
  const monitorActions: string[] = [];
  const subscriptions: Array<Record<string, unknown>> = [];
  const runId = parseBusinessResearchId('run', 'run-ui-live')!;
  const reportId = parseBusinessResearchId('report', 'report-ui-live')!;
  const subscriptionId = parseBusinessResearchId('subscription', 'subscription-ui')!;
  const evidenceId = parseBusinessResearchId('evidence', 'evidence-ui-live')!;
  const fixtureEvidenceId = parseBusinessResearchId('evidence', 'evidence-ui-fixture')!;
  const sourceId = parseBusinessResearchId('source', 'source-ui-live')!;
  const fixtureSourceId = parseBusinessResearchId('source', 'source-ui-fixture')!;
  const task = {
    industry: 'Electric vehicles',
    question: 'Compare public launch activity.',
    competitors: ['Northstar', 'Southwind'],
    strategyId: 'competitor_deep_dive' as const,
  };
  const run = {
    id: runId,
    task,
    mode: 'live' as const,
    state: { status: 'completed' as const, completedAt: 1_800_000_000_000 },
    createdAt: 1_799_999_000_000,
    updatedAt: 1_800_000_000_000,
    reportId,
  };
  const evidence = {
    id: evidenceId,
    sourceId,
    title: 'Public launch announcement',
    url: 'https://example.com/launch',
    sourceKind: 'company_site' as const,
    grade: 'page_text' as const,
    query: 'Northstar electric vehicle product launch',
    excerpt: 'The company announced a new public product launch.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
  const fixtureEvidence = {
    id: fixtureEvidenceId,
    sourceId: fixtureSourceId,
    title: 'Illustrative fixture record',
    url: 'https://example.invalid/business-research/fixture/1',
    sourceKind: 'fixture' as const,
    grade: 'fixture_data' as const,
    query: 'fixture preview only',
    excerpt: 'A fixture sample, not a verified public fact.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
  const report = {
    id: reportId,
    runId,
    generatedAt: '2026-09-24T00:00:00.000Z',
    status: 'completed' as const,
    title: 'Electric vehicle research',
    claims: [{
      kind: 'supported' as const,
      id: parseBusinessResearchId('claim', 'claim-ui-live')!,
      statement: 'A public launch announcement was found.',
      evidenceIds: [evidenceId] as const,
    }, {
      kind: 'supported' as const,
      id: parseBusinessResearchId('claim', 'claim-ui-fixture')!,
      statement: 'This example is illustrative only.',
      evidenceIds: [fixtureEvidenceId] as const,
    }],
    evidence: [evidence, fixtureEvidence],
    monitoringActions: [],
  };
  const events = [
    { runId, sequence: 1, timestamp: 1, type: 'run_started', task, mode: 'live' },
    {
      runId, sequence: 2, timestamp: 2, type: 'decision_made',
      action: { kind: 'search_web', query: 'Northstar product', taskId: 'competitor_products' },
    },
    {
      runId, sequence: 3, timestamp: 3, type: 'observation_recorded',
      observation: { kind: 'search_results', query: 'Northstar product', evidence: [evidence] },
    },
    { runId, sequence: 4, timestamp: 4, type: 'run_terminal', outcome: { status: 'completed' } },
  ];
  const api = {
    getCredentialStatus: async () => ({ ok: true, data: { configured: false } }),
    setBraveKey: async () => ({ ok: true, data: { configured: true } }),
    removeBraveKey: async () => ({ ok: true, data: { configured: false } }),
    start: async (input: typeof task, mode: 'fixture' | 'live' = 'live') => {
      calls.push({ ...input, mode });
      return { ok: true, data: run };
    },
    cancel: async () => ({ ok: true, data: true }),
    listRuns: async () => ({ ok: true, data: [run] }),
    getRun: async () => ({ ok: true, data: run }),
    listEvents: async () => ({ ok: true, data: events }),
    listReports: async () => ({ ok: true, data: [report] }),
    getReport: async () => ({ ok: true, data: report }),
    evaluate: async () => ({ ok: true, data: {
      metadata: { mode: 'fixture', corpusVersion: 1, modelVersion: 'scripted-fixture-v1', sourceVersion: 'fixed-public-snapshot-v1', evaluatedAt: '2026-09-24T00:00:00.000Z' },
      cases: { total: 24, passed: 22, failed: 2, excluded: 0 },
      caseResults: [], researchRuns: { expected: 22, actual: 22, unstarted: 0, completed: 12, partial: 8, failed: 2, cancelled: 0 },
      monitoringChecks: { total: 4, triggered: 2, notTriggered: 2, duplicateSignals: 0 },
      reports: { accepted: 18, rejected: 4, notAttempted: 0 },
      taskCompletion: { numerator: 6, denominator: 6, rate: 1 },
      expectedOutcomeAccuracy: { numerator: 22, denominator: 24, rate: 22 / 24 },
      toolSelectionAccuracy: { numerator: 30, denominator: 30, rate: 1 },
      citations: { validity: { numerator: 20, denominator: 20, rate: 1 }, factualClaimCoverage: { numerator: 16, denominator: 16, rate: 1 } },
      conflictDetection: { numerator: 3, denominator: 3, rate: 1 },
      recovery: { numerator: 3, denominator: 3, rate: 1 },
      automaticTrigger: { precision: { numerator: 2, denominator: 2, rate: 1 }, recall: { numerator: 2, denominator: 2, rate: 1 } },
      latency: { run: { sampleCount: 22, p50: 140, p95: 240, max: 500 }, tool: { sampleCount: 30, p95: 40 } },
    } }),
    subscribe: async (input: typeof task, intervalMs = 24 * 60 * 60 * 1_000) => {
      monitorActions.push(`subscribe:${intervalMs}`);
      const subscription = { id: subscriptionId, task: input, intervalMs, enabled: true, createdAt: 5, updatedAt: 5, nextCheckAt: 10 };
      const oldIndex = subscriptions.findIndex((item) => item.id === subscriptionId);
      if (oldIndex >= 0) subscriptions.splice(oldIndex, 1);
      subscriptions.unshift(subscription);
      return { ok: true, data: subscription };
    },
    unsubscribe: async () => {
      monitorActions.push('pause');
      const current = subscriptions[0];
      if (current) subscriptions[0] = { ...current, enabled: false };
      return { ok: true, data: subscriptions[0] };
    },
    resumeSubscription: async () => {
      monitorActions.push('resume');
      const current = subscriptions[0];
      if (current) subscriptions[0] = { ...current, enabled: true };
      return { ok: true, data: subscriptions[0] };
    },
    removeSubscription: async () => {
      monitorActions.push('remove');
      subscriptions.splice(0, subscriptions.length);
      return { ok: true, data: undefined };
    },
    listSubscriptions: async () => ({ ok: true, data: subscriptions }),
    listChecks: async () => ({ ok: true, data: [] }),
    checkDue: async () => { monitorActions.push('probe'); return { ok: true, data: [] }; },
  };
  const client = { ...fallbackClient, businessResearch: api } as unknown as FinagentClient;
  return { calls, client, monitorActions };
}

async function renderWorkspace(client: FinagentClient) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const store = createStore();
  await act(async () => {
    root.render(<TestI18n><Provider store={store}><FinagentClientProvider client={client}>
      <div style={{ width: '100%', maxWidth: '900px' }}>
        <BusinessResearchWorkspace />
      </div>
    </FinagentClientProvider></Provider></TestI18n>);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  return {
    container,
    store,
    async click(selector: string) {
      await act(async () => {
        const element = container.querySelector<HTMLButtonElement>(selector);
        if (!element) throw new Error(`Missing button ${selector}`);
        element.click();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    },
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it('labels fixture runs as illustrative and validates the minimum competitor count before starting', async () => {
  const { calls, client } = setup();
  const view = await renderWorkspace(client);
  try {
    expect(view.container.textContent).toContain('publicly accessible information only');
    expect(view.container.textContent).toContain('biased signal');
    expect(view.container.textContent).toContain('illustrative records');
    await view.click('[data-testid="business-research-start"]');
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('2–4 distinct competitors');
    expect(calls).toEqual([]);
  } finally {
    await view.cleanup();
  }
});

it('starts an explicitly live run, then renders its selected task facet, evidence grade, and cited report', async () => {
  const { calls, client } = setup();
  const view = await renderWorkspace(client);
  try {
    await act(async () => {
      view.store.set(businessResearchFormAtom, {
        industry: 'Electric vehicles',
        question: 'Compare public launch activity.',
        competitorsText: 'Northstar\nSouthwind',
        strategyId: 'competitor_deep_dive',
      });
      view.container.querySelector<HTMLButtonElement>('[data-testid="business-research-mode-live"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await view.click('[data-testid="business-research-start"]');

    expect(view.container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ industry: 'Electric vehicles', competitors: ['Northstar', 'Southwind'], mode: 'live' });
    expect(view.container.textContent).toContain('Competitor products');
    expect(view.container.textContent).toContain('Public page text');
    expect(view.container.textContent).toContain('A public launch announcement was found.');
    const report = view.container.querySelector('[data-testid="business-research-report"]')!;
    expect(report.querySelector('a[href="https://example.com/launch"]')).not.toBeNull();
    expect(report.querySelector('a[href*="example.invalid"]')).toBeNull();
    expect(report.textContent).toContain('Illustrative fixture · not a public source');
    const evaluation = view.container.querySelector('[data-testid="business-research-evaluation"]')!;
    expect(evaluation.textContent).toContain('Deterministic fixture corpus');
    expect(evaluation.textContent).toContain('22/24');
    expect(evaluation.textContent).toContain('140 ms');
    expect(evaluation.textContent).toContain('240 ms');
  } finally {
    await view.cleanup();
  }
});

it('subscribes, pauses, resumes, and removes a topic without running a due check on mount', async () => {
  const { client, monitorActions } = setup();
  const view = await renderWorkspace(client);
  try {
    expect(view.container.textContent).toContain('No topics are being tracked.');
    expect(monitorActions).toEqual([]);
    await act(async () => {
      view.store.set(businessResearchFormAtom, {
        industry: 'Electric vehicles',
        question: 'Track public launch activity.',
        competitorsText: 'Northstar\nSouthwind',
        strategyId: 'change_risk_tracking',
      });
    });
    await view.click('[data-testid="business-research-subscribe-monitor"]');
    expect(monitorActions[0]).toBe('subscribe:86400000');
    expect(view.container.textContent).toContain('Electric vehicles · Northstar, Southwind');

    await view.click('[aria-label="Pause"]');
    expect(monitorActions).toContain('pause');
    expect(view.container.textContent).toContain('Paused');
    await view.click('[aria-label="Resume"]');
    expect(monitorActions).toContain('resume');
    expect(view.container.textContent).toContain('Active');
    await view.click('[aria-label="Remove"]');
    expect(monitorActions).toContain('remove');
    expect(view.container.textContent).toContain('No topics are being tracked.');
    expect(monitorActions).not.toContain('probe');
  } finally {
    await view.cleanup();
  }
});
