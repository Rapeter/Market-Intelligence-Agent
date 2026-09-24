import { describe, expect, it } from 'bun:test';
import { normalizeBusinessResearchInput, parseBusinessResearchId, type BusinessResearchEvidence, type BusinessResearchTaskInput } from '@finagent/core';

function taskInput(): BusinessResearchTaskInput {
  const result = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare public product updates',
    competitors: ['Northstar Motors', 'Harbor Auto'],
    strategyId: 'competitor_deep_dive',
  });
  if (!result.ok) throw new Error('Expected fixture input to be valid');
  return result.value;
}

function evidence(): BusinessResearchEvidence {
  const id = parseBusinessResearchId('evidence', 'evidence-fixture-seed');
  const sourceId = parseBusinessResearchId('source', 'source-fixture-seed');
  if (id === undefined || sourceId === undefined) throw new Error('Expected fixture ids to be valid');
  return {
    id,
    sourceId,
    title: 'Illustrative fixture evidence',
    url: 'https://example.invalid/fixture/seed',
    sourceKind: 'fixture',
    grade: 'fixture_data',
    query: 'fixture seed',
    excerpt: 'Illustrative fixture content only; no real-world claim is asserted.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

describe('business research fixtures', () => {
  it('changes the next facet based on evidence and keeps the saved report explicitly illustrative', async () => {
    const fixture = await import('./fixture.ts').catch(() => null);
    expect(fixture).not.toBeNull();
    if (fixture === null) return;

    const task = taskInput();
    const model = fixture.createBusinessResearchFixtureDecisionModel(task);
    const initial = await model.decide({ task, observations: [], allowedActions: ['search_web', 'finish'] }, new AbortController().signal);
    expect(initial).toMatchObject({ kind: 'search_web', taskId: 'competitor_products' });

    const evidenceItem = evidence();
    const afterEvidence = await model.decide({
      task,
      observations: [{ kind: 'search_results', query: 'fixture seed', evidence: [evidenceItem] }],
      allowedActions: ['search_web', 'finish'],
    }, new AbortController().signal);
    expect(afterEvidence).toMatchObject({ kind: 'search_web', taskId: 'pricing_channels' });

    const tools = fixture.createBusinessResearchFixtureTools(
      parseBusinessResearchId('run', 'run-fixture-test')!, task, () => Date.parse('2026-09-24T00:00:00.000Z'),
    );
    const found = await tools.searchWeb('Northstar Motors pricing', new AbortController().signal);
    expect(found[0]).toMatchObject({ sourceKind: 'fixture', grade: 'fixture_data' });
    expect(found[0]?.excerpt).toContain('no verified market facts');
    const opened = await tools.openSource(found[0]!.id, new AbortController().signal);
    expect(opened.grade).toBe('fixture_data');

    const draft = fixture.createBusinessResearchFixtureReportDraft({ task, evidence: found });
    expect(draft.claims).toContainEqual(expect.objectContaining({ kind: 'unresolved', question: task.question }));
    expect(JSON.stringify(draft)).toContain('Fixture-only');
  });
});
