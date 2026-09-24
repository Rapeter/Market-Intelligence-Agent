import { describe, expect, it } from 'bun:test';
import { BUSINESS_RESEARCH_EVALUATION_CORPUS } from './cases.ts';
import { evaluateBusinessResearchEvaluationCorpus, median, nearestRankPercentile } from './metrics.ts';

describe('business research evaluation metrics', () => {
  it('executes the 24-case corpus through the runtime, synthesis, and signal evaluator', async () => {
    const result = await evaluateBusinessResearchEvaluationCorpus({ evaluatedAt: '2026-09-24T12:00:00.000Z' });

    expect(result.metadata).toEqual({
      mode: 'fixture',
      corpusVersion: 1,
      modelVersion: 'scripted-fixture-v1',
      sourceVersion: 'fixed-public-snapshot-v1',
      evaluatedAt: '2026-09-24T12:00:00.000Z',
    });
    expect(result.cases).toEqual({ total: 24, passed: 24, failed: 0, excluded: 0 });
    expect(result.researchRuns).toEqual({
      expected: 22,
      actual: 22,
      unstarted: 0,
      completed: 17,
      partial: 4,
      failed: 1,
      cancelled: 0,
    });
    expect(result.monitoringChecks).toEqual({ total: 4, triggered: 2, notTriggered: 2, duplicateSignals: 0 });
    expect(result.reports).toEqual({ accepted: 19, rejected: 2, notAttempted: 1 });
    expect(result.taskCompletion).toEqual({ numerator: 6, denominator: 6, rate: 1 });
    expect(result.expectedOutcomeAccuracy).toEqual({ numerator: 24, denominator: 24, rate: 1 });
    expect(result.toolSelectionAccuracy.rate).toBe(1);
    expect(result.toolSelectionAccuracy.denominator).toBeGreaterThan(0);
    expect(result.citations.validity).toEqual({ numerator: 17, denominator: 17, rate: 1 });
    expect(result.citations.factualClaimCoverage).toEqual({ numerator: 14, denominator: 14, rate: 1 });
    expect(result.conflictDetection).toEqual({ numerator: 3, denominator: 3, rate: 1 });
    expect(result.recovery).toEqual({ numerator: 3, denominator: 3, rate: 1 });
    expect(result.automaticTrigger.precision).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(result.automaticTrigger.recall).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(result.latency.run.sampleCount).toBe(22);
    expect(result.latency.run.p50).toBeGreaterThan(0);
    expect(result.latency.run.p95).toBeGreaterThan(0);
    expect(result.latency.run.p95).toBeLessThanOrEqual(30_000);
    expect(result.latency.run.max).toBeLessThanOrEqual(60_000);
    expect(result.latency.tool.sampleCount).toBeGreaterThan(0);
    expect(result.latency.tool.p95).toBeGreaterThan(0);
    expect(result.caseResults.every((entry) => entry.passed)).toBe(true);
  });

  it('uses the nearest-rank percentile rule for p95', () => {
    expect(nearestRankPercentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220], 0.95)).toBe(210);
  });

  it('uses the arithmetic midpoint for p50 with an even sample count', () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it('reports zero-denominator ratios as not applicable for an empty corpus', async () => {
    const result = await evaluateBusinessResearchEvaluationCorpus({
      evaluatedAt: '2026-09-24T12:00:00.000Z',
      corpus: { version: 1, cases: [] },
    });

    expect(result.cases).toEqual({ total: 0, passed: 0, failed: 0, excluded: 0 });
    expect(result.taskCompletion.rate).toBeNull();
    expect(result.expectedOutcomeAccuracy.rate).toBeNull();
    expect(result.toolSelectionAccuracy.rate).toBeNull();
    expect(result.citations.validity.rate).toBeNull();
    expect(result.citations.factualClaimCoverage.rate).toBeNull();
    expect(result.conflictDetection.rate).toBeNull();
    expect(result.recovery.rate).toBeNull();
    expect(result.automaticTrigger.precision.rate).toBeNull();
    expect(result.automaticTrigger.recall.rate).toBeNull();
    expect(result.latency.run.p50).toBeNull();
    expect(result.latency.run.p95).toBeNull();
    expect(result.latency.tool.p95).toBeNull();
  });

  it('counts a trigger as correct only when its reason and source match the annotation', async () => {
    const corpus = {
      ...BUSINESS_RESEARCH_EVALUATION_CORPUS,
      cases: BUSINESS_RESEARCH_EVALUATION_CORPUS.cases.map((entry) =>
        entry.kind === 'monitor' && entry.id === 'BR-EVAL-21' && entry.expected.kind === 'trigger'
          ? { ...entry, expected: { ...entry.expected, reason: 'source_updated' as const } }
          : entry,
      ),
    };
    const result = await evaluateBusinessResearchEvaluationCorpus({
      evaluatedAt: '2026-09-24T12:00:00.000Z',
      corpus,
    });

    expect(result.caseResults.find((entry) => entry.id === 'BR-EVAL-21')?.passed).toBe(false);
    expect(result.automaticTrigger.precision).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.automaticTrigger.recall).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it('does not count a repeated query as a recovered retry', async () => {
    const corpus = {
      ...BUSINESS_RESEARCH_EVALUATION_CORPUS,
      cases: BUSINESS_RESEARCH_EVALUATION_CORPUS.cases.map((entry) => {
        if (entry.kind !== 'research' || entry.id !== 'BR-EVAL-14') return entry;
        const firstStep = entry.steps[0]!;
        const retryQuery = firstStep.action.kind === 'search_web' ? firstStep.action.query : '';
        const steps = entry.steps.map((step, index) => {
          if (index !== 1 || step.action.kind !== 'search_web' || step.result?.kind !== 'evidence') return step;
          return {
            ...step,
            action: { ...step.action, query: retryQuery },
            permittedActions: step.permittedActions.map((action) =>
              action.kind === 'search_web' ? { ...action, query: retryQuery } : action,
            ),
            result: { kind: 'evidence' as const, evidence: step.result.evidence.map((item) => ({ ...item, query: retryQuery })) },
          };
        });
        return { ...entry, steps };
      }),
    };
    const result = await evaluateBusinessResearchEvaluationCorpus({
      evaluatedAt: '2026-09-24T12:00:00.000Z',
      corpus,
    });

    expect(result.caseResults.find((entry) => entry.id === 'BR-EVAL-14')?.passed).toBe(false);
    expect(result.recovery).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 });
  });
});
