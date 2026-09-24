import { describe, expect, it } from 'bun:test';
import type {
  BusinessResearchAction,
  BusinessResearchEvidence,
  BusinessResearchRunId,
  BusinessResearchTaskInput,
} from '@finagent/core';
import type { BusinessResearchToolPort, DecisionModelPort } from '@finagent/shared/business-research';
import { runBusinessResearchLiveCounterfactuals } from './businessResearchLiveE2e';

const task: BusinessResearchTaskInput = {
  industry: 'Electric vehicles',
  question: 'Identify one public product or pricing fact for either competitor.',
  competitors: ['Tesla', 'Rivian'],
  strategyId: 'competitor_deep_dive',
};

function evidence(index: number, grade: BusinessResearchEvidence['grade'] = 'page_text'): BusinessResearchEvidence {
  return {
    id: `evidence-live-${index}` as BusinessResearchEvidence['id'],
    sourceId: `source-live-${index}` as BusinessResearchEvidence['sourceId'],
    title: `Public product page ${index}`,
    url: `https://example${index}.com/product?tracking=discarded#pricing`,
    sourceKind: 'company_site',
    grade,
    query: `competitor ${index} product page`,
    excerpt: `Public product details for competitor ${index}.`,
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

describe('live business-research counterfactual probes', () => {
  it('compares the same task with empty versus opened public page evidence for two competitors', async () => {
    const searched: string[] = [];
    const opened: string[] = [];
    const decisionInputs: Array<{ task: BusinessResearchTaskInput; observations: unknown[]; allowedActions: string[] }> = [];
    let idSequence = 0;
    const tools: BusinessResearchToolPort = {
      async searchWeb(query) {
        searched.push(query);
        const index = searched.length;
        return [evidence(index, 'search_excerpt')];
      },
      async openSource(evidenceId) {
        opened.push(evidenceId);
        return evidence(opened.length);
      },
    };
    const createDecisionModel = (_runId: BusinessResearchRunId): DecisionModelPort => ({
      async decide(input) {
        decisionInputs.push({
          task: input.task,
          observations: [...input.observations],
          allowedActions: [...input.allowedActions],
        });
        const action: BusinessResearchAction = input.observations.length === 0
          ? { kind: 'search_web', query: 'find current public product details', taskId: 'competitor_products' }
          : { kind: 'finish', rationale: 'The opened public page supplies a fact.' };
        return action;
      },
    });

    const result = await runBusinessResearchLiveCounterfactuals({
      task,
      tools,
      createDecisionModel,
      createRunId: () => `run-live-probe-${++idSequence}` as BusinessResearchRunId,
      sanitizeText: (value) => value,
      signal: new AbortController().signal,
      now: (() => { let value = 0; return () => ++value; })(),
    });

    expect(result.pairs).toHaveLength(2);
    expect(result.pairs.every((pair) => pair.diverged)).toBe(true);
    expect(result.pairs.map((pair) => pair.source.grade)).toEqual(['page_text', 'page_text']);
    expect(result.pairs[0]?.source.url).toBe('https://example1.com/product');
    expect(result.pairs[0]?.source.excerptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.pairs[0]?.evidencePresentAction).toEqual({ kind: 'finish' });
    expect(result.pairs[0]?.evidenceMissingAction).toEqual({
      kind: 'search_web',
      query: 'find current public product details',
    });
    expect(searched).toHaveLength(2);
    expect(opened).toHaveLength(2);
    expect(decisionInputs).toHaveLength(4);
    expect(decisionInputs[0]?.task).toEqual(decisionInputs[1]?.task);
    expect(decisionInputs[0]?.allowedActions).toEqual(['search_web', 'finish']);
    expect(decisionInputs[1]?.observations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Public product details');
  });

  it('requires a real page-text observation before calling the model', async () => {
    let modelCalls = 0;
    let searchIndex = 0;
    const tools: BusinessResearchToolPort = {
      async searchWeb() { return [evidence(++searchIndex, 'search_excerpt')]; },
      async openSource(evidenceId) { return { ...evidence(searchIndex, 'search_excerpt'), id: evidenceId }; },
    };

    await expect(runBusinessResearchLiveCounterfactuals({
      task,
      tools,
      createDecisionModel: () => ({ decide: async () => { modelCalls += 1; return { kind: 'finish', rationale: 'x' }; } }),
      createRunId: () => 'run-live-probe-no-page-text' as BusinessResearchRunId,
      sanitizeText: (value) => value,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_LIVE_EVIDENCE_UNAVAILABLE' });

    expect(modelCalls).toBe(0);
  });

  it('recognizes a changed search direction even when the selected tool kind stays the same', async () => {
    let idSequence = 0;
    const tools: BusinessResearchToolPort = {
      async searchWeb() { return [evidence(++idSequence)]; },
      async openSource(evidenceId) { return { ...evidence(idSequence), id: evidenceId }; },
    };
    let call = 0;
    const result = await runBusinessResearchLiveCounterfactuals({
      task,
      tools,
      createDecisionModel: () => ({
        async decide() {
          call += 1;
          return { kind: 'search_web', query: call % 2 === 1 ? 'Tesla official price update' : 'Rivian public product update', taskId: 'competitor_products' };
        },
      }),
      createRunId: () => `run-live-probe-${++idSequence}` as BusinessResearchRunId,
      sanitizeText: (value) => value,
      signal: new AbortController().signal,
    });

    expect(result.pairs.every((pair) => pair.diverged)).toBe(true);
    expect(result.pairs[0]?.evidenceMissingAction.kind).toBe('search_web');
    expect(result.pairs[0]?.evidencePresentAction.kind).toBe('search_web');
  });

  it('rejects a model action outside the live probe allowlist instead of misreporting it', async () => {
    const tools: BusinessResearchToolPort = {
      async searchWeb() { return [evidence(1)]; },
      async openSource(evidenceId) { return { ...evidence(1), id: evidenceId }; },
    };

    await expect(runBusinessResearchLiveCounterfactuals({
      task,
      tools,
      createDecisionModel: () => ({
        async decide() { return { kind: 'open_source', evidenceId: 'evidence-live-1' as BusinessResearchEvidence['id'] }; },
      }),
      createRunId: () => 'run-live-probe-invalid-action' as BusinessResearchRunId,
      sanitizeText: (value) => value,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_LIVE_INVALID_DECISION' });
  });
});
