import { describe, expect, it } from 'bun:test';
import {
  BUSINESS_RESEARCH_STRATEGY_KEYS,
  BUSINESS_RESEARCH_TASK_KEYS,
  isBusinessResearchEvidenceGrade,
  isBusinessResearchSourceKind,
  isBusinessResearchStrategyId,
  isBusinessResearchTaskId,
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchClaim,
  type BusinessResearchEvidenceId,
  type BusinessResearchSourceId,
  type BusinessResearchRunState,
  type BusinessResearchTerminalOutcome,
} from './business-research.ts';

describe('business research contracts', () => {
  it('marks deterministic demonstration evidence separately from public evidence', () => {
    expect(isBusinessResearchSourceKind('fixture')).toBe(true);
    expect(isBusinessResearchEvidenceGrade('fixture_data')).toBe(true);
    expect(isBusinessResearchSourceKind('unknown')).toBe(false);
    expect(isBusinessResearchEvidenceGrade('unknown')).toBe(false);
  });

  it('exposes six unique task keys and three valid strategy keys', () => {
    expect(BUSINESS_RESEARCH_TASK_KEYS).toHaveLength(6);
    expect(new Set(BUSINESS_RESEARCH_TASK_KEYS).size).toBe(6);
    expect(BUSINESS_RESEARCH_STRATEGY_KEYS).toHaveLength(3);
    expect(new Set(BUSINESS_RESEARCH_STRATEGY_KEYS).size).toBe(3);
    expect(isBusinessResearchTaskId('pricing_channels')).toBe(true);
    expect(isBusinessResearchTaskId('AAPL.US')).toBe(false);
    expect(isBusinessResearchStrategyId('change_risk_tracking')).toBe(true);
    expect(isBusinessResearchStrategyId('unknown')).toBe(false);
  });

  it('parses safe stable ids and keeps different entity ids nominally distinct', () => {
    const sourceId = parseBusinessResearchId('source', 'source-1');
    const evidenceId = parseBusinessResearchId('evidence', 'evidence-1');

    expect(sourceId === 'source-1').toBe(true);
    expect(evidenceId === 'evidence-1').toBe(true);
    expect(parseBusinessResearchId('evidence', '../private')).toBeUndefined();
    expect(parseBusinessResearchId('evidence', '  ')).toBeUndefined();

    if (sourceId !== undefined) {
      const correctlyBranded: BusinessResearchSourceId = sourceId;
      expect(correctlyBranded === 'source-1').toBe(true);
      // @ts-expect-error Source ids must not be accepted where evidence ids are required.
      const wronglyBranded: BusinessResearchEvidenceId = sourceId;
      void wronglyBranded;
    }
  });

  it('trims research input and accepts organization names without security-symbol rules', () => {
    const result = normalizeBusinessResearchInput({
      industry: '  Electric vehicles  ',
      question: '  Compare charging strategies  ',
      competitors: [' Tesla ', 'BYD'],
      strategyId: 'competitor_deep_dive',
      timeRange: { from: '2025-01-01', to: '2025-12-31' },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        industry: 'Electric vehicles',
        question: 'Compare charging strategies',
        competitors: ['Tesla', 'BYD'],
        strategyId: 'competitor_deep_dive',
        timeRange: { from: '2025-01-01', to: '2025-12-31' },
      },
    });
  });

  it('rejects blank questions and unknown strategies with field-specific issues', () => {
    const result = normalizeBusinessResearchInput({
      industry: 'Electric vehicles',
      question: '   ',
      competitors: ['Tesla', 'BYD'],
      strategyId: 'stock_momentum',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ path, code }) => [path, code])).toContainEqual([
        'question',
        'required',
      ]);
      expect(result.issues.map(({ path, code }) => [path, code])).toContainEqual([
        'strategyId',
        'unsupported_value',
      ]);
    }
  });

  it('requires two to four distinct non-empty competitor names', () => {
    const base = {
      industry: 'Electric vehicles',
      question: 'Compare products',
      strategyId: 'industry_overview',
    };

    for (const competitors of [['Tesla'], ['Tesla', 'BYD', 'Rivian', 'Nio', 'Lucid'], ['Tesla', ' tesla '], ['Tesla', '  ']]) {
      const result = normalizeBusinessResearchInput({ ...base, competitors });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some(({ path }) => path === 'competitors')).toBe(true);
      }
    }
  });

  it('rejects impossible, non-ISO, and reversed date ranges', () => {
    const base = {
      industry: 'Electric vehicles',
      question: 'Compare products',
      competitors: ['Tesla', 'BYD'],
      strategyId: 'industry_overview',
    };

    const invalidRanges = [
      { timeRange: { from: '2025-02-30', to: '2025-03-01' }, issue: { path: 'timeRange.from', code: 'invalid_date' } as const },
      { timeRange: { from: '2025/01/01', to: '2025-03-01' }, issue: { path: 'timeRange.from', code: 'invalid_date' } as const },
      { timeRange: { from: '2025-06-01', to: '2025-03-01' }, issue: { path: 'timeRange', code: 'invalid_range' } as const },
    ];
    for (const { timeRange, issue } of invalidRanges) {
      const result = normalizeBusinessResearchInput({ ...base, timeRange });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toContainEqual(issue);
      }
    }
  });

  it('keeps actions, claims, run states, and terminal outcomes discriminated', () => {
    const action = {
      kind: 'search_web',
      query: 'EV market share 2025',
      taskId: 'industry_landscape',
    } satisfies BusinessResearchAction;
    const evidenceId = parseBusinessResearchId('evidence', 'evidence-1');
    if (evidenceId === undefined) throw new Error('Test evidence id should be valid');
    const claimId = parseBusinessResearchId('claim', 'claim-1');
    if (claimId === undefined) throw new Error('Test claim id should be valid');
    const claim: BusinessResearchClaim = {
      kind: 'supported',
      id: claimId,
      statement: 'The company announced a new model.',
      evidenceIds: [evidenceId],
    };
    const state: BusinessResearchRunState = {
      status: 'gathering',
      updatedAt: '2025-04-01T00:00:00.000Z',
    };
    const outcome: BusinessResearchTerminalOutcome = { status: 'cancelled' };

    expect([action.kind, claim.kind, state.status, outcome.status]).toEqual([
      'search_web',
      'supported',
      'gathering',
      'cancelled',
    ]);
  });
});
