import {
  BUSINESS_RESEARCH_STRATEGY_KEYS,
  BUSINESS_RESEARCH_TASK_KEYS,
  type BusinessResearchSourceKind,
  type BusinessResearchStrategyId,
  type BusinessResearchTaskId,
} from '@finagent/core';

export interface BusinessResearchTaskDefinition {
  id: BusinessResearchTaskId;
  objective: string;
  expectedEvidence: readonly BusinessResearchSourceKind[];
  completionSignals: readonly string[];
}

export interface BusinessResearchStrategyDefinition {
  id: BusinessResearchStrategyId;
  objective: string;
  taskWeights: Readonly<Record<BusinessResearchTaskId, number>>;
  maxSearchActions: number;
}

export interface BusinessResearchCatalog {
  tasks: readonly BusinessResearchTaskDefinition[];
  strategies: readonly BusinessResearchStrategyDefinition[];
}

export type BusinessResearchCatalogIssue = {
  path: string;
  code:
    | 'invalid_shape'
    | 'missing_task'
    | 'duplicate_task'
    | 'missing_strategy'
    | 'duplicate_strategy'
    | 'invalid_objective'
    | 'invalid_evidence'
    | 'invalid_completion_signal'
    | 'missing_weight'
    | 'invalid_weight'
    | 'invalid_budget';
  id?: string;
};

const TASKS = [
  {
    id: 'industry_landscape',
    objective: 'Map the publicly documented market structure, segments, and material industry drivers.',
    expectedEvidence: ['public_filing', 'company_site', 'news'],
    completionSignals: ['At least two distinct public sources support the market framing.', 'Material source coverage gaps are listed.'],
  },
  {
    id: 'competitor_products',
    objective: 'Compare competitor products, positioning, and publicly announced capabilities.',
    expectedEvidence: ['company_site', 'public_filing', 'news'],
    completionSignals: ['Each compared competitor has a cited public product observation.', 'Unsupported comparisons are marked unknown.'],
  },
  {
    id: 'pricing_channels',
    objective: 'Observe public prices, offers, and distribution or sales channels without inferring private terms.',
    expectedEvidence: ['company_site', 'public_filing', 'other_public'],
    completionSignals: ['Price and channel observations include their dates and source context.', 'Unavailable or region-specific prices are called out.'],
  },
  {
    id: 'public_feedback',
    objective: 'Summarize public customer-feedback signals as a biased, non-representative sample.',
    expectedEvidence: ['public_feedback', 'news', 'other_public'],
    completionSignals: ['Feedback is labeled as a public signal, not representative research.', 'Sample and platform limitations are stated.'],
  },
  {
    id: 'policy_technology_risk',
    objective: 'Identify public policy, regulatory, and technology developments that may change the outlook.',
    expectedEvidence: ['public_filing', 'company_site', 'news'],
    completionSignals: ['Each material risk has a dated public source.', 'Unconfirmed effects are separated from sourced events.'],
  },
  {
    id: 'evidence_change_review',
    objective: 'Check contradictory or changed public evidence and describe unresolved differences.',
    expectedEvidence: ['company_site', 'public_filing', 'news', 'other_public'],
    completionSignals: ['Contradictory evidence is shown side by side.', 'Changes are distinguished from ordinary retrieval-time differences.'],
  },
] as const satisfies readonly BusinessResearchTaskDefinition[];

const STRATEGIES = [
  {
    id: 'industry_overview',
    objective: 'Start broad with market structure, then deepen the facets needed to answer the question.',
    taskWeights: {
      industry_landscape: 3,
      competitor_products: 2,
      pricing_channels: 2,
      public_feedback: 1,
      policy_technology_risk: 2,
      evidence_change_review: 1,
    },
    maxSearchActions: 8,
  },
  {
    id: 'competitor_deep_dive',
    objective: 'Prioritize product and pricing comparisons while retaining enough industry and risk context.',
    taskWeights: {
      industry_landscape: 1,
      competitor_products: 3,
      pricing_channels: 3,
      public_feedback: 2,
      policy_technology_risk: 1,
      evidence_change_review: 2,
    },
    maxSearchActions: 10,
  },
  {
    id: 'change_risk_tracking',
    objective: 'Prioritize dated changes, conflicting evidence, and public policy or technology risks.',
    taskWeights: {
      industry_landscape: 2,
      competitor_products: 2,
      pricing_channels: 2,
      public_feedback: 2,
      policy_technology_risk: 3,
      evidence_change_review: 3,
    },
    maxSearchActions: 6,
  },
] as const satisfies readonly BusinessResearchStrategyDefinition[];

export const BUSINESS_RESEARCH_CATALOG = {
  tasks: TASKS,
  strategies: STRATEGIES,
} as const satisfies BusinessResearchCatalog;

export function rankBusinessResearchTasks(
  strategyId: BusinessResearchStrategyId,
  catalog: BusinessResearchCatalog = BUSINESS_RESEARCH_CATALOG,
): BusinessResearchTaskId[] {
  const strategy = catalog.strategies.find((candidate) => candidate.id === strategyId);
  if (!strategy) return [];
  return catalog.tasks
    .map((task, index) => ({ id: task.id, index, weight: strategy.taskWeights[task.id] }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index)
    .map(({ id }) => id);
}

/** Checks that runtime-loaded catalog data covers the stable domain keys and is internally usable. */
export function validateBusinessResearchCatalog(
  value: unknown = BUSINESS_RESEARCH_CATALOG,
): BusinessResearchCatalogIssue[] {
  if (!isRecord(value)) return [{ path: 'catalog', code: 'invalid_shape' }];

  const issues: BusinessResearchCatalogIssue[] = [];
  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  const strategies = Array.isArray(value.strategies) ? value.strategies : [];
  const taskIds = collectIds(tasks, 'id');
  const strategyIds = collectIds(strategies, 'id');

  for (const id of BUSINESS_RESEARCH_TASK_KEYS) {
    if (!taskIds.includes(id)) issues.push({ path: 'tasks', code: 'missing_task', id });
  }
  for (const id of duplicateIds(taskIds)) issues.push({ path: 'tasks', code: 'duplicate_task', id });
  for (const id of BUSINESS_RESEARCH_STRATEGY_KEYS) {
    if (!strategyIds.includes(id)) issues.push({ path: 'strategies', code: 'missing_strategy', id });
  }
  for (const id of duplicateIds(strategyIds)) issues.push({ path: 'strategies', code: 'duplicate_strategy', id });

  tasks.forEach((task, index) => {
    if (!isRecord(task)) {
      issues.push({ path: `tasks.${index}`, code: 'invalid_objective' });
      return;
    }
    if (typeof task.objective !== 'string' || task.objective.trim().length === 0) {
      issues.push({ path: `tasks.${index}.objective`, code: 'invalid_objective' });
    }
    if (!Array.isArray(task.expectedEvidence) || task.expectedEvidence.length === 0) {
      issues.push({ path: `tasks.${index}.expectedEvidence`, code: 'invalid_evidence' });
    }
    if (!Array.isArray(task.completionSignals) || task.completionSignals.length === 0) {
      issues.push({ path: `tasks.${index}.completionSignals`, code: 'invalid_completion_signal' });
    }
  });

  strategies.forEach((strategy, index) => {
    if (!isRecord(strategy)) {
      issues.push({ path: `strategies.${index}`, code: 'invalid_objective' });
      return;
    }
    if (typeof strategy.objective !== 'string' || strategy.objective.trim().length === 0) {
      issues.push({ path: `strategies.${index}.objective`, code: 'invalid_objective' });
    }
    if (
      typeof strategy.maxSearchActions !== 'number' ||
      !Number.isInteger(strategy.maxSearchActions) ||
      strategy.maxSearchActions < 1
    ) {
      issues.push({ path: `strategies.${index}.maxSearchActions`, code: 'invalid_budget' });
    }
    if (!isRecord(strategy.taskWeights)) {
      issues.push({ path: `strategies.${index}.taskWeights`, code: 'invalid_weight' });
      return;
    }
    for (const id of BUSINESS_RESEARCH_TASK_KEYS) {
      const weight = strategy.taskWeights[id];
      if (weight === undefined) {
        issues.push({ path: `strategies.${index}.taskWeights`, code: 'missing_weight', id });
      } else if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 3) {
        issues.push({ path: `strategies.${index}.taskWeights.${id}`, code: 'invalid_weight', id });
      }
    }
  });

  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectIds(values: unknown[], key: string): string[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = value[key];
    return typeof id === 'string' ? [id] : [];
  });
}

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}
