import { describe, expect, it } from 'bun:test';
import { BUSINESS_RESEARCH_CATALOG, rankBusinessResearchTasks, validateBusinessResearchCatalog } from './catalog.ts';

const EXPECTED_TASKS = [
  'industry_landscape',
  'competitor_products',
  'pricing_channels',
  'public_feedback',
  'policy_technology_risk',
  'evidence_change_review',
] as const;

const EXPECTED_STRATEGIES = [
  'industry_overview',
  'competitor_deep_dive',
  'change_risk_tracking',
] as const;

describe('business research catalog', () => {
  it('defines every research task with an objective, evidence needs, and completion signals', () => {
    expect(BUSINESS_RESEARCH_CATALOG.tasks.map(({ id }) => id)).toEqual([...EXPECTED_TASKS]);
    for (const task of BUSINESS_RESEARCH_CATALOG.tasks) {
      expect(task.objective.trim().length).toBeGreaterThan(0);
      expect(task.expectedEvidence.length).toBeGreaterThan(0);
      expect(task.completionSignals.length).toBeGreaterThan(0);
    }
  });

  it('defines all three strategies with a priority for each task and a finite search budget', () => {
    expect(BUSINESS_RESEARCH_CATALOG.strategies.map(({ id }) => id)).toEqual([...EXPECTED_STRATEGIES]);
    for (const strategy of BUSINESS_RESEARCH_CATALOG.strategies) {
      expect(Object.keys(strategy.taskWeights).sort()).toEqual([...EXPECTED_TASKS].sort());
      expect(Object.values(strategy.taskWeights).every((weight) => weight >= 1 && weight <= 3)).toBe(true);
      expect(strategy.maxSearchActions).toBeGreaterThan(0);
    }
  });

  it('ranks different research facets first for each strategy', () => {
    expect(rankBusinessResearchTasks('industry_overview').slice(0, 2)).toEqual([
      'industry_landscape',
      'competitor_products',
    ]);
    expect(rankBusinessResearchTasks('competitor_deep_dive').slice(0, 2)).toEqual([
      'competitor_products',
      'pricing_channels',
    ]);
    expect(rankBusinessResearchTasks('change_risk_tracking').slice(0, 2)).toEqual([
      'policy_technology_risk',
      'evidence_change_review',
    ]);
  });

  it('reports missing required tasks instead of silently accepting an incomplete catalog', () => {
    const incompleteCatalog = {
      ...BUSINESS_RESEARCH_CATALOG,
      tasks: BUSINESS_RESEARCH_CATALOG.tasks.filter((task) => task.id !== 'public_feedback'),
    };

    expect(validateBusinessResearchCatalog(incompleteCatalog)).toContainEqual({
      path: 'tasks',
      code: 'missing_task',
      id: 'public_feedback',
    });
  });
});
