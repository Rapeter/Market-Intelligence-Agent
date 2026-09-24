import { describe, expect, it } from 'bun:test';
import { BUSINESS_RESEARCH_EVALUATION_CORPUS } from './cases.ts';
import type { BusinessResearchEvaluationCase } from './cases.ts';

describe('business research evaluation corpus', () => {
  it('contains 24 unique, versioned executable scenarios in the specified distribution', () => {
    const corpus = BUSINESS_RESEARCH_EVALUATION_CORPUS;
    expect(corpus.version).toBe(1);
    expect(corpus.cases).toHaveLength(24);
    expect(new Set(corpus.cases.map((entry) => entry.id)).size).toBe(24);
    expect(corpus.cases.every((entry) => entry.version === 1)).toBe(true);
    expect(countBy(corpus.cases, 'category')).toEqual({
      normal: 6,
      missing_data: 4,
      source_conflict: 3,
      tool_failure: 3,
      citation_safety: 4,
      automatic_discovery: 4,
    });
  });

  it('covers each task once and each strategy twice among the six normal cases', () => {
    const normal = BUSINESS_RESEARCH_EVALUATION_CORPUS.cases
      .filter(isResearchCase)
      .filter((entry) => entry.category === 'normal');
    expect(countBy(normal, 'taskId')).toEqual({
      industry_landscape: 1,
      competitor_products: 1,
      pricing_channels: 1,
      public_feedback: 1,
      policy_technology_risk: 1,
      evidence_change_review: 1,
    });
    expect(countBy(normal, (entry) => entry.input?.strategyId)).toEqual({
      industry_overview: 2,
      competitor_deep_dive: 2,
      change_risk_tracking: 2,
    });
  });

  it('annotates every research decision with at least one permitted action and every case with its expected outcome', () => {
    const researchCases = BUSINESS_RESEARCH_EVALUATION_CORPUS.cases.filter(isResearchCase);
    const monitorCases = BUSINESS_RESEARCH_EVALUATION_CORPUS.cases.filter(isMonitorCase);
    expect(researchCases).toHaveLength(20);
    expect(monitorCases).toHaveLength(4);
    for (const entry of researchCases) {
      expect(entry.steps?.length).toBeGreaterThan(0);
      expect(entry.steps?.every((step) => step.action !== undefined && (step.permittedActions?.length ?? 0) > 0)).toBe(true);
    }
  });

  it('provides a follow-up research run only for the two monitor cases that should trigger', () => {
    const monitorCases = BUSINESS_RESEARCH_EVALUATION_CORPUS.cases.filter(isMonitorCase);
    const triggerCases = monitorCases.filter((entry) => entry.expected.kind === 'trigger');
    const skippedCases = monitorCases.filter((entry) => entry.expected.kind === 'skip');

    expect(triggerCases).toHaveLength(2);
    expect(triggerCases.every((entry) => 'triggeredRun' in entry)).toBe(true);
    expect(skippedCases.every((entry) => !('triggeredRun' in entry))).toBe(true);
  });

  it('keeps generated fingerprints out of hand-authored monitor expectations', () => {
    const triggerCases = BUSINESS_RESEARCH_EVALUATION_CORPUS.cases
      .filter(isMonitorCase)
      .filter((entry) => entry.expected.kind === 'trigger');

    expect(triggerCases.every((entry) => !('fingerprint' in entry.expected))).toBe(true);
  });
});

type ResearchCase = Extract<BusinessResearchEvaluationCase, { kind: 'research' }>;
type MonitorCase = Extract<BusinessResearchEvaluationCase, { kind: 'monitor' }>;

function isResearchCase(entry: BusinessResearchEvaluationCase): entry is ResearchCase {
  return entry.kind === 'research';
}

function isMonitorCase(entry: BusinessResearchEvaluationCase): entry is MonitorCase {
  return entry.kind === 'monitor';
}

function countBy<T extends object, K extends keyof T>(
  values: readonly T[],
  key: K | ((value: T) => unknown),
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const selected = typeof key === 'function' ? key(value) : value[key];
    const name = String(selected);
    result[name] = (result[name] ?? 0) + 1;
  }
  return result;
}
