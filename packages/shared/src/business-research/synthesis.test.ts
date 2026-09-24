import { describe, expect, it } from 'bun:test';
import {
  parseBusinessResearchId,
  type BusinessResearchEvidence,
} from '@finagent/core';
import { synthesizeBusinessResearchReport } from './synthesis.ts';

const reportId = parseBusinessResearchId('report', 'report-case-1')!;
const runId = parseBusinessResearchId('run', 'run-case-1')!;
const sourceId = parseBusinessResearchId('source', 'source-company')!;
const excerptId = parseBusinessResearchId('evidence', 'evidence-excerpt')!;
const pageId = parseBusinessResearchId('evidence', 'evidence-page')!;
const claimId = parseBusinessResearchId('claim', 'claim-range')!;
const conflictId = parseBusinessResearchId('claim', 'claim-delivery')!;
const unresolvedId = parseBusinessResearchId('claim', 'claim-price')!;

const evidence: BusinessResearchEvidence[] = [
  {
    id: excerptId,
    sourceId,
    title: 'Company launch page',
    url: 'https://example.com/range',
    sourceKind: 'company_site',
    grade: 'search_excerpt',
    query: 'EV range company launch',
    excerpt: 'The search result says the range is 500 km.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  },
  {
    id: pageId,
    sourceId,
    title: 'Company delivery update',
    url: 'https://example.com/delivery',
    sourceKind: 'company_site',
    grade: 'page_text',
    query: 'EV delivery company',
    excerpt: 'The company reports deliveries began in September.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  },
];

const reportInput = {
  reportId,
  runId,
  generatedAt: '2026-09-24T00:01:00.000Z',
  outcome: { status: 'completed' as const },
  evidence,
  draft: {
    title: 'EV market findings',
    claims: [
      { kind: 'supported', id: claimId, statement: 'The cited launch page reports a 500 km range.', evidenceIds: [excerptId] },
      { kind: 'conflicted', id: conflictId, statement: 'Delivery timing differs across sources.', supportingEvidenceIds: [pageId], contradictingEvidenceIds: [excerptId] },
      { kind: 'unresolved', id: unresolvedId, question: 'What is the final regional price?', reason: 'No public price source was collected.' },
    ],
    monitoringActions: ['Check the next public delivery update.'],
  },
};

describe('synthesizeBusinessResearchReport', () => {
  it('preserves supported, conflicted, and unresolved claims with only their cited evidence and grades', async () => {
    const result = synthesizeBusinessResearchReport(reportInput);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Expected report synthesis to succeed');
    expect(result.report).toMatchObject({
      id: reportId,
      runId,
      status: 'completed',
      title: 'EV market findings',
      claims: reportInput.draft.claims,
      monitoringActions: ['Check the next public delivery update.'],
    });
    expect(result.report.evidence).toEqual([evidence[0], evidence[1]]);
    expect(result.report.evidence.map((item) => item.grade)).toEqual(['search_excerpt', 'page_text']);
  });

  it('rejects a claim citing evidence absent from the persisted evidence set', async () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      draft: {
        ...reportInput.draft,
        claims: [{
          kind: 'supported',
          id: claimId,
          statement: 'This price is confirmed.',
          evidenceIds: [parseBusinessResearchId('evidence', 'evidence-not-persisted')!],
        }],
      },
    });

    expect(result).toEqual({ ok: false, issues: [{ path: 'draft.claims[0].evidenceIds[0]', code: 'missing_evidence' }] });
  });

  it('rejects citations not permitted by the evaluation case annotation', async () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      draft: {
        ...reportInput.draft,
        claims: [{
          kind: 'supported',
          id: claimId,
          statement: 'The cited source confirms a range.',
          evidenceIds: [pageId],
        }],
      },
      allowedEvidenceIdsByClaim: { [claimId]: [excerptId] },
    });

    expect(result).toEqual({ ok: false, issues: [{ path: 'draft.claims[0].evidenceIds[0]', code: 'unsupported_citation' }] });
  });

  it('rejects a citable claim that has no support annotation when case validation is enabled', () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      draft: {
        ...reportInput.draft,
        claims: [{
          kind: 'supported',
          id: claimId,
          statement: 'The cited source confirms a range.',
          evidenceIds: [excerptId],
        }],
      },
      allowedEvidenceIdsByClaim: { 'claim-other': [excerptId] },
    });

    expect(result).toEqual({ ok: false, issues: [{ path: 'draft.claims[0].evidenceIds[0]', code: 'unsupported_citation' }] });
  });

  it('does not label a report completed without at least one evidence-backed claim', async () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      draft: { ...reportInput.draft, claims: [] },
    });

    expect(result).toEqual({ ok: false, issues: [{ path: 'draft.claims', code: 'completed_without_supported_claim' }] });
  });

  it('allows a partial report to expose the information gap without inventing evidence', async () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      outcome: { status: 'partial' as const, reason: 'Only a public search excerpt was available.' },
      draft: {
        title: 'Incomplete pricing check',
        claims: [{
          kind: 'unresolved',
          id: unresolvedId,
          question: 'What is the final regional price?',
          reason: 'No public price source was collected.',
        }],
        monitoringActions: [],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      report: { status: 'partial', claims: [{ kind: 'unresolved' }], evidence: [] },
    });
  });

  it('downgrades an otherwise completed run to a partial report when all findings remain unresolved', () => {
    const result = synthesizeBusinessResearchReport({
      ...reportInput,
      draft: {
        title: 'Incomplete competitor comparison',
        claims: [{
          kind: 'unresolved',
          id: unresolvedId,
          question: 'How does the second competitor price this product?',
          reason: 'No comparable public price source was found.',
        }],
        monitoringActions: ['Check for a comparable public disclosure next time.'],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      report: {
        status: 'partial',
        partialReason: 'No evidence-backed factual claims were available.',
        claims: [{ kind: 'unresolved' }],
        evidence: [],
      },
    });
  });
});
