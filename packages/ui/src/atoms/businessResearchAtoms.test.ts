import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { parseBusinessResearchId } from '@finagent/core';
import {
  businessResearchFormAtom,
  businessResearchModeAtom,
  businessResearchRunsAtom,
  selectedBusinessResearchRunAtom,
  selectedBusinessResearchRunIdAtom,
} from './businessResearchAtoms';

describe('business research workspace state', () => {
  it('starts in a safe fixture mode with an empty, editable research form', () => {
    const store = createStore();

    expect(store.get(businessResearchModeAtom)).toBe('fixture');
    expect(store.get(businessResearchFormAtom)).toEqual({
      industry: '',
      question: '',
      competitorsText: '',
      strategyId: 'industry_overview',
    });
    expect(store.get(businessResearchRunsAtom)).toEqual([]);
  });

  it('derives the selected run from the persisted run list and selection id', () => {
    const store = createStore();
    const runId = parseBusinessResearchId('run', 'run-visible')!;
    const run = {
      id: runId,
      task: {
        industry: 'Renewable energy',
        question: 'What changed?',
        competitors: ['North', 'South'],
        strategyId: 'change_risk_tracking' as const,
      },
      mode: 'fixture' as const,
      state: { status: 'gathering' as const, updatedAt: '1970-01-01T00:00:00.010Z' },
      createdAt: 5,
      updatedAt: 10,
    };

    store.set(businessResearchRunsAtom, [run]);
    store.set(selectedBusinessResearchRunIdAtom, runId);

    expect(store.get(selectedBusinessResearchRunAtom)).toEqual(run);
    store.set(selectedBusinessResearchRunIdAtom, parseBusinessResearchId('run', 'run-missing')!);
    expect(store.get(selectedBusinessResearchRunAtom)).toBeUndefined();
  });
});
