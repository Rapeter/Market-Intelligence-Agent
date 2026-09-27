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
  const checksBySubscription = new Map<string, Array<Record<string, unknown>>>();
  const runId = parseBusinessResearchId('run', 'run-ui-live')!;
  const reportId = parseBusinessResearchId('report', 'report-ui-live')!;
  const subscriptionId = parseBusinessResearchId('subscription', 'subscription-ui')!;
  const projectId = parseBusinessResearchId('project', 'project-ui-ev')!;
  const project = { id: projectId, title: 'EV public market review', industry: 'Electric vehicles', competitors: ['Northstar', 'Southwind'], createdAt: 1, updatedAt: 1 };
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
  const subscribeCalls: Array<{ task: typeof task; intervalMs: number; projectId: typeof projectId }> = [];
  const run = {
    id: runId,
    projectId,
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
    listProjects: async () => ({ ok: true, data: [project] }),
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
    subscribe: async (input: typeof task, intervalMs = 24 * 60 * 60 * 1_000, inputProjectId: typeof projectId = projectId) => {
      subscribeCalls.push({ task: input, intervalMs, projectId: inputProjectId });
      monitorActions.push(`subscribe:${intervalMs}`);
      const subscription = { id: subscriptionId, projectId: inputProjectId, task: input, intervalMs, enabled: true, createdAt: 5, updatedAt: 5, nextCheckAt: 10 };
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
    listSubscriptions: async () => ({ ok: true, data: [...subscriptions] }),
    listChecks: async (input: string) => ({ ok: true, data: checksBySubscription.get(input) ?? [] }),
    checkDue: async () => { monitorActions.push('probe'); return { ok: true, data: [] }; },
  };
  const client = { ...fallbackClient, businessResearch: api } as unknown as FinagentClient;
  return { calls, client, monitorActions, projectId, subscribeCalls, subscriptions, checksBySubscription, task };
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

it('opens on a selected project and leaves new research questions to the Agent panel', async () => {
  const { client } = setup();
  const view = await renderWorkspace(client);
  try {
    expect(view.container.textContent).toContain('publicly accessible information only');
    expect(view.container.textContent).toContain('biased signal');
    expect(view.container.textContent).toContain('illustrative records');
    expect(view.container.textContent).toContain('EV public market review');
    expect(view.container.querySelector('[data-testid="business-research-start"]')).toBeNull();
  } finally {
    await view.cleanup();
  }
});

it('hydrates a project run with its task, evidence grade, and cited report', async () => {
  const { client } = setup();
  const view = await renderWorkspace(client);
  try {
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    expect(view.container.textContent).toContain('Compare public launch activity.');
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

it('shows each topic’s own latest monitor check and refreshes newly completed checks', async () => {
  const { client, subscriptions, checksBySubscription } = setup();
  const firstId = parseBusinessResearchId('subscription', 'subscription-ui-first')!;
  const secondId = parseBusinessResearchId('subscription', 'subscription-ui-second')!;
  const firstCheckId = parseBusinessResearchId('event', 'event-ui-monitor-first')!;
  const secondCheckId = parseBusinessResearchId('event', 'event-ui-monitor-second')!;
  const monitorTask = (industry: string) => ({
    industry,
    question: `Track public changes in ${industry}.`,
    competitors: ['Northstar', 'Southwind'],
    strategyId: 'change_risk_tracking',
  });
  subscriptions.push(
    { id: firstId, projectId: parseBusinessResearchId('project', 'project-ui-ev')!, task: monitorTask('Electric vehicles'), intervalMs: 3_600_000, enabled: true, createdAt: 1, updatedAt: 1, nextCheckAt: 2 },
    { id: secondId, projectId: parseBusinessResearchId('project', 'project-ui-ev')!, task: monitorTask('Battery storage'), intervalMs: 3_600_000, enabled: true, createdAt: 1, updatedAt: 1, nextCheckAt: 2 },
  );
  checksBySubscription.set(secondId, [{
    id: secondCheckId,
    subscriptionId: secondId,
    startedAt: 1_699_999_999_000,
    completedAt: 1_700_000_000_000,
    decision: { kind: 'skip', reason: 'no_change' },
  }]);

  const view = await renderWorkspace(client);
  try {
    const monitorPanel = Array.from(view.container.querySelectorAll('section'))
      .find((section) => section.querySelector('h2')?.textContent === 'Topic monitoring');
    const monitorRow = (industry: string) => {
      const topicButton = Array.from(monitorPanel?.querySelectorAll('button[aria-pressed]') ?? [])
        .find((button) => button instanceof HTMLButtonElement && button.textContent?.includes(industry));
      return topicButton?.parentElement?.parentElement;
    };
    const firstRow = monitorRow('Electric vehicles');
    const secondRow = monitorRow('Battery storage');
    expect(firstRow?.textContent).toContain('No checks yet');
    expect(secondRow?.textContent).toContain('no change');
    expect(secondRow?.textContent).not.toContain('No checks yet');

    checksBySubscription.set(firstId, [{
      id: firstCheckId,
      subscriptionId: firstId,
      startedAt: 1_700_000_001_000,
      completedAt: 1_700_000_002_000,
      decision: { kind: 'skip', reason: 'duplicate_signal' },
    }]);
    await view.click('[aria-label="Refresh records"]');
    expect(monitorRow('Electric vehicles')?.textContent).toContain('duplicate signal');
  } finally {
    await view.cleanup();
  }
});

it('subscribes to the selected run within its project and persists monitor controls without probing on mount', async () => {
  const { client, monitorActions, projectId, subscribeCalls, task } = setup();
  const view = await renderWorkspace(client);
  try {
    expect(view.container.textContent).toContain('No topics are being tracked.');
    expect(monitorActions).toEqual([]);
    await act(async () => {
      view.store.set(businessResearchFormAtom, {
        strategyId: 'change_risk_tracking',
        question: '',
      });
    });
    await view.click('[data-testid="business-research-subscribe-monitor"]');
    expect(monitorActions[0]).toBe('subscribe:86400000');
    expect(subscribeCalls[0]).toEqual({
      task,
      intervalMs: 24 * 60 * 60 * 1_000,
      projectId,
    });
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
