import { describe, expect, it } from 'bun:test';
import {
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchEvidence,
  type BusinessResearchTaskInput,
} from '@finagent/core';
import type { BusinessResearchToolPort, DecisionModelPort } from './core.ts';
import type { BusinessResearchEvent } from './events.ts';
import { runBusinessResearch } from './runtime.ts';

const INITIAL_QUERY = 'EV range official specifications 2025';
const CONFLICT_QUERY = 'EV range WLTP EPA certification discrepancy';

function id<Kind extends Parameters<typeof parseBusinessResearchId>[0]>(kind: Kind, value: string) {
  const parsed = parseBusinessResearchId(kind, value);
  if (parsed === undefined) throw new Error(`Invalid test id: ${value}`);
  return parsed;
}

function taskInput(): BusinessResearchTaskInput {
  const result = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare the published range of two vehicles',
    competitors: ['Tesla', 'BYD'],
    strategyId: 'competitor_deep_dive',
  });
  if (!result.ok) throw new Error('Test input should be valid');
  return result.value;
}

function evidence(name: string, excerpt: string, query: string): BusinessResearchEvidence {
  return {
    id: id('evidence', name),
    sourceId: id('source', `source-${name}`),
    title: `Public vehicle specification ${name}`,
    url: `https://example.com/specifications/${name}`,
    sourceKind: 'company_site',
    grade: 'search_excerpt',
    query,
    excerpt,
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

function modelForEvidenceDrivenRun(): DecisionModelPort {
  return {
    async decide({ observations }) {
      const found = observations.flatMap((observation) =>
        observation.kind === 'search_results' ? observation.evidence : [],
      );
      if (found.length === 0) {
        return { kind: 'search_web', query: INITIAL_QUERY, taskId: 'competitor_products' };
      }
      if (found.some(({ excerpt }) => excerpt.includes('WLTP and EPA use different cycles'))) {
        return { kind: 'finish', rationale: 'The source context explains the apparent difference.' };
      }
      const publishedRanges = new Set(
        found.map(({ excerpt }) => excerpt.match(/\b\d{3}\s*km\b/u)?.[0]?.replace(/\s+/gu, ' ')),
      );
      if (publishedRanges.size > 1) {
        return { kind: 'search_web', query: CONFLICT_QUERY, taskId: 'evidence_change_review' };
      }
      if (found.length >= 2) {
        return { kind: 'finish', rationale: 'Two independent sources agree on the published range.' };
      }
      return { kind: 'search_web', query: 'EV range second public source', taskId: 'competitor_products' };
    },
  };
}

async function runEvidenceScenario(conflicting: boolean) {
  const queries: string[] = [];
  const tool: BusinessResearchToolPort = {
    async searchWeb(query) {
      queries.push(query);
      if (query === INITIAL_QUERY) {
        return conflicting
          ? [
              evidence('ev-a', 'The manufacturer lists a range of 500 km.', query),
              evidence('ev-b', 'The comparison table lists a range of 620 km.', query),
            ]
          : [
              evidence('ev-a', 'The manufacturer lists a range of 500 km.', query),
              evidence('ev-b', 'The comparison table lists a range of 500 km.', query),
            ];
      }
      return [
        evidence('ev-c', '500 km WLTP and EPA use different cycles for the published figures.', query),
      ];
    },
    async openSource(evidenceId) {
      const opened = evidence('opened-source', 'Inspected page text.', CONFLICT_QUERY);
      return { ...opened, id: evidenceId, grade: 'page_text' };
    },
  };
  let now = Date.parse('2026-09-24T00:00:00.000Z');
  const result = await runBusinessResearch({
    runId: id('run', conflicting ? 'run-conflict' : 'run-agree'),
    task: taskInput(),
    decisionModel: modelForEvidenceDrivenRun(),
    tools: tool,
    signal: new AbortController().signal,
    now: () => (now += 1_000),
  });
  return { result, queries };
}

describe('runBusinessResearch', () => {
  it('awaits event persistence before asking the model for the next action', async () => {
    const persisted: BusinessResearchEvent[] = [];
    let modelObservedPersistedPlanning = false;
    const options = {
      runId: id('run', 'run-event-persistence'),
      task: taskInput(),
      decisionModel: {
        async decide() {
          modelObservedPersistedPlanning = persisted.some(
            (event) => event.type === 'phase_changed' && event.status === 'planning',
          );
          return { kind: 'finish' as const, rationale: 'No evidence is available in this persistence test.' };
        },
      },
      tools: {
        async searchWeb() { return []; },
        async openSource(evidenceId: BusinessResearchEvidence['id']) {
          return { ...evidence('unused', 'Unused page.', 'unused'), id: evidenceId, grade: 'page_text' as const };
        },
      },
      signal: new AbortController().signal,
      async onEvent(event: BusinessResearchEvent) {
        await Promise.resolve();
        persisted.push(structuredClone(event));
      },
    };

    const result = await runBusinessResearch(
      options as Parameters<typeof runBusinessResearch>[0] & { onEvent: (event: BusinessResearchEvent) => Promise<void> },
    );

    expect(modelObservedPersistedPlanning).toBe(true);
    expect(persisted).toEqual(result.events);
  });

  it('changes the next query after conflicting evidence and finishes when independent evidence agrees', async () => {
    const conflict = await runEvidenceScenario(true);
    const agreement = await runEvidenceScenario(false);

    expect(conflict.queries).toEqual([INITIAL_QUERY, CONFLICT_QUERY]);
    expect(agreement.queries).toEqual([INITIAL_QUERY]);
    expect(conflict.result.state.status).toBe('completed');
    expect(agreement.result.state.status).toBe('completed');
    expect(conflict.result.observations).toHaveLength(2);
    expect(conflict.result.events.map(({ sequence }) => sequence)).toEqual(
      conflict.result.events.map((_, index) => index + 1),
    );
  });

  it('stops at the search budget and preserves a partial result', async () => {
    let searchCalls = 0;
    const result = await runBusinessResearch({
      runId: id('run', 'run-budget'),
      task: taskInput(),
      decisionModel: {
        async decide() {
          return {
            kind: 'search_web',
            query: `new query ${searchCalls + 1}`,
            taskId: 'industry_landscape',
          };
        },
      },
      tools: {
        async searchWeb(query) {
          searchCalls += 1;
          return [evidence(`budget-${searchCalls}`, 'A public source excerpt.', query)];
        },
        async openSource(evidenceId) {
          return { ...evidence('opened-budget', 'Inspected page text.', 'open'), id: evidenceId, grade: 'page_text' };
        },
      },
      signal: new AbortController().signal,
      limits: { maxSearchActions: 1 },
    });

    expect(searchCalls).toBe(1);
    expect(result.state.status).toBe('partial');
  });

  it('records cancellation and does not ask the model for another action', async () => {
    const controller = new AbortController();
    let decisionCalls = 0;
    let searchCalls = 0;
    const result = await runBusinessResearch({
      runId: id('run', 'run-cancelled'),
      task: taskInput(),
      decisionModel: {
        async decide() {
          decisionCalls += 1;
          return { kind: 'search_web', query: INITIAL_QUERY, taskId: 'competitor_products' };
        },
      },
      tools: {
        async searchWeb(query) {
          searchCalls += 1;
          controller.abort();
          return [evidence('cancelled-result', 'This late result must not be used.', query)];
        },
        async openSource(evidenceId) {
          return { ...evidence('opened-cancelled', 'Inspected page text.', 'open'), id: evidenceId, grade: 'page_text' };
        },
      },
      signal: controller.signal,
    });

    expect(result.state.status).toBe('cancelled');
    expect(decisionCalls).toBe(1);
    expect(searchCalls).toBe(1);
  });

  it('enforces the wall-clock budget when the model call never settles', async () => {
    let modelSignalAborted = false;
    const run = runBusinessResearch({
      runId: id('run', 'run-timeout'),
      task: taskInput(),
      decisionModel: {
        decide(_input, signal) {
          signal.addEventListener('abort', () => {
            modelSignalAborted = true;
          });
          return new Promise(() => {});
        },
      },
      tools: {
        async searchWeb() {
          return [];
        },
        async openSource(evidenceId) {
          return { ...evidence('opened-timeout', 'Inspected page text.', 'open'), id: evidenceId, grade: 'page_text' };
        },
      },
      signal: new AbortController().signal,
      limits: { maxDurationMs: 20 },
    });
    const result = await Promise.race([
      run,
      new Promise<'still_running'>((resolve) => setTimeout(() => resolve('still_running'), 100)),
    ]);

    expect(result).not.toBe('still_running');
    if (result !== 'still_running') {
      expect(result.state.status).toBe('failed');
      expect(modelSignalAborted).toBe(true);
    }
  });

  it('fails closed on malformed model output and turns an unsupported finish into partial', async () => {
    const base = {
      runId: id('run', 'run-invalid'),
      task: taskInput(),
      tools: {
        async searchWeb() {
          return [];
        },
        async openSource(evidenceId: BusinessResearchEvidence['id']) {
          return { ...evidence('opened-empty', 'Inspected page text.', 'open'), id: evidenceId, grade: 'page_text' as const };
        },
      },
      signal: new AbortController().signal,
    };
    const malformed = await runBusinessResearch({
      ...base,
      decisionModel: { async decide() { return { kind: 'call_private_api' } as never; } },
    });
    const emptyFinish = await runBusinessResearch({
      ...base,
      runId: id('run', 'run-empty-finish'),
      decisionModel: { async decide() { return { kind: 'finish', rationale: 'finished' }; } },
    });

    expect(malformed.state.status).toBe('failed');
    expect(emptyFinish.state.status).toBe('partial');
  });
});
