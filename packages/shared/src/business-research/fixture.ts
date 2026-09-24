import {
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchClaim,
  type BusinessResearchClaimId,
  type BusinessResearchEvidenceId,
  type BusinessResearchEvidence,
  type BusinessResearchRunId,
  type BusinessResearchTaskInput,
} from '@finagent/core';
import type { BusinessResearchToolPort, DecisionModelPort } from './core.ts';

/** Deterministic decision model for demonstrating the UI without network or model access. */
export function createBusinessResearchFixtureDecisionModel(task: BusinessResearchTaskInput): DecisionModelPort {
  return {
    async decide({ observations }, signal): Promise<BusinessResearchAction> {
      signal.throwIfAborted();
      const searches = observations.filter((observation) => observation.kind === 'search_results');
      const latestSearch = searches.at(-1);
      if (latestSearch === undefined) {
        return {
          kind: 'search_web',
          query: `${task.competitors[0]} ${task.industry} illustrative product research`,
          taskId: 'competitor_products',
        };
      }
      if (latestSearch.evidence.length === 0) {
        return {
          kind: 'search_web',
          query: `${task.industry} illustrative landscape research`,
          taskId: 'industry_landscape',
        };
      }
      if (searches.length === 1) {
        const citedNames = new Set(latestSearch.evidence.map((item) => item.title.toLocaleLowerCase()));
        const nextCompetitor = task.competitors.find((name) =>
          ![...citedNames].some((title) => title.includes(name.toLocaleLowerCase())),
        ) ?? task.competitors[1] ?? task.competitors[0];
        return {
          kind: 'search_web',
          query: `${nextCompetitor} ${task.industry} illustrative pricing research`,
          taskId: 'pricing_channels',
        };
      }
      return { kind: 'finish', rationale: 'The illustrative fixture has shown two evidence steps; use live search for factual research.' };
    },
  };
}

/** Produces explicitly non-public sample records and never performs a network request. */
export function createBusinessResearchFixtureTools(
  runId: BusinessResearchRunId,
  task: BusinessResearchTaskInput,
  now: () => number = Date.now,
): BusinessResearchToolPort {
  const evidenceById = new Map<string, BusinessResearchEvidence>();
  let sequence = 0;

  return {
    async searchWeb(query, signal) {
      signal.throwIfAborted();
      const index = ++sequence;
      const competitor = task.competitors.find((name) => query.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
        ?? task.competitors[0]
        ?? 'Example competitor';
      const id = parseBusinessResearchId('evidence', `evidence-${runId}-${index}`);
      const sourceId = parseBusinessResearchId('source', `source-${runId}-${index}`);
      if (id === undefined || sourceId === undefined) throw new Error('Fixture evidence id could not be created.');
      const evidence: BusinessResearchEvidence = {
        id,
        sourceId,
        title: `Illustrative fixture record ${index}: ${competitor}`,
        url: `https://example.invalid/business-research/fixture/${index}`,
        sourceKind: 'fixture',
        grade: 'fixture_data',
        query,
        excerpt: `This fixture-only sample mentions ${competitor} and ${task.industry} to demonstrate evidence handling; it contains no verified market facts.`,
        retrievedAt: new Date(now()).toISOString(),
      };
      evidenceById.set(id, evidence);
      return [structuredClone(evidence)];
    },
    async openSource(evidenceId, signal) {
      signal.throwIfAborted();
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined) throw new Error('Fixture evidence was not discovered in this run.');
      return structuredClone(evidence);
    },
  };
}

/** Creates a report that demonstrates citations but refuses to answer factual questions from fixtures. */
export function createBusinessResearchFixtureReportDraft(input: {
  task: BusinessResearchTaskInput;
  evidence: readonly BusinessResearchEvidence[];
}): BusinessResearchFixtureReportDraft {
  const citedEvidence = input.evidence.filter((item) => item.sourceKind === 'fixture' && item.grade === 'fixture_data');
  const claimId = parseBusinessResearchId('claim', 'claim-fixture-metadata');
  const unresolvedId = parseBusinessResearchId('claim', 'claim-fixture-unresolved');
  if (claimId === undefined || unresolvedId === undefined) throw new Error('Fixture claim id could not be created.');
  const citedIds = citedEvidence.map((item) => item.id);
  const claims: BusinessResearchClaim[] = [];
  if (citedIds.length > 0) {
    claims.push({
      kind: 'supported',
      id: claimId,
      statement: `This fixture run attached ${citedIds.length} illustrative record${citedIds.length === 1 ? '' : 's'}; they are not verified market findings.`,
      evidenceIds: [citedIds[0]!, ...citedIds.slice(1)],
    });
  }
  claims.push({
    kind: 'unresolved',
    id: unresolvedId,
    question: input.task.question,
    reason: 'Fixture-only data contains no verified public facts. Run live research to answer this question.',
  });
  return {
    title: `Fixture-only example — ${input.task.industry}`,
    claims,
    monitoringActions: ['Run live public-source research before relying on any conclusion.'],
  };
}

export interface BusinessResearchFixtureReportDraft {
  title: string;
  claims: BusinessResearchClaim[];
  monitoringActions: string[];
}
