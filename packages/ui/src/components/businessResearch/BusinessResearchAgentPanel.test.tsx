import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { Provider, createStore } from 'jotai';
import { parseBusinessResearchId } from '@finagent/core';
import {
  businessResearchProjectsAtom,
  businessResearchRunsAtom,
  selectedBusinessResearchProjectIdAtom,
  selectedBusinessResearchRunIdAtom,
} from '../../atoms/businessResearchAtoms';
import type { FinagentClient } from '../../client';
import { fallbackClient, FinagentClientProvider } from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';

let restore: () => void;
let createRoot: typeof import('react-dom/client')['createRoot'];
let BusinessResearchAgentPanel: typeof import('./BusinessResearchAgentPanel')['BusinessResearchAgentPanel'];

beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ createRoot } = await import('react-dom/client'));
  ({ BusinessResearchAgentPanel } = await import('./BusinessResearchAgentPanel'));
});

afterAll(() => restore());

it('starts a project-scoped follow-up linked to the selected research run', async () => {
  const projectId = parseBusinessResearchId('project', 'project-agent-panel')!;
  const parentRunId = parseBusinessResearchId('run', 'run-agent-parent')!;
  const nextRunId = parseBusinessResearchId('run', 'run-agent-followup')!;
  const project = {
    id: projectId,
    title: 'EV market review',
    industry: 'Electric vehicles',
    competitors: ['Northstar', 'Southwind'],
    createdAt: 1,
    updatedAt: 1,
  };
  const parentRun = {
    id: parentRunId,
    projectId,
    task: { industry: project.industry, question: 'Compare public launch activity.', competitors: project.competitors, strategyId: 'industry_overview' as const },
    mode: 'fixture' as const,
    state: { status: 'completed' as const, completedAt: new Date(2).toISOString() },
    createdAt: 1,
    updatedAt: 2,
  };
  const nextRun = { ...parentRun, id: nextRunId, parentRunId, task: { ...parentRun.task, question: 'Assess the latest regulatory change.' }, createdAt: 3, updatedAt: 3 };
  const starts: Array<{ task: unknown; mode: unknown; projectId: unknown; parentRunId: unknown }> = [];
  const api = {
    ...fallbackClient.businessResearch,
    start: async (task: unknown, mode: unknown, scope: unknown, parent: unknown) => {
      starts.push({ task, mode, projectId: scope, parentRunId: parent });
      return { ok: true as const, data: nextRun };
    },
  };
  const client = { ...fallbackClient, businessResearch: api } as unknown as FinagentClient;
  const store = createStore();
  store.set(businessResearchProjectsAtom, [project]);
  store.set(selectedBusinessResearchProjectIdAtom, projectId);
  store.set(businessResearchRunsAtom, [parentRun]);
  store.set(selectedBusinessResearchRunIdAtom, parentRunId);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestI18n><Provider store={store}><FinagentClientProvider client={client}>
      <BusinessResearchAgentPanel />
    </FinagentClientProvider></Provider></TestI18n>);
  });

  try {
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="business-research-agent-input"]')!;
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="business-research-agent-submit"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, 'Assess the latest regulatory change.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      submit.click();
    });

    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      task: {
        industry: 'Electric vehicles',
        question: 'Assess the latest regulatory change.',
        competitors: ['Northstar', 'Southwind'],
      },
      projectId,
      parentRunId,
    });
    expect(store.get(businessResearchRunsAtom).map((run) => run.id)).toEqual([nextRunId, parentRunId]);
    expect(store.get(selectedBusinessResearchRunIdAtom)).toBe(nextRunId);
    expect(container.textContent).toContain('Assess the latest regulatory change.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
