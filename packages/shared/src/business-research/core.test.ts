import { describe, expect, it } from 'bun:test';
import {
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchEvidenceId,
} from '@finagent/core';
import { parseBusinessResearchAction } from './core.ts';

const parsedEvidenceId = parseBusinessResearchId('evidence', 'evidence-1');
if (parsedEvidenceId === undefined) throw new Error('Test evidence id should be valid');
const evidenceId: BusinessResearchEvidenceId = parsedEvidenceId;

describe('parseBusinessResearchAction', () => {
  it('accepts exactly one allowed search action and normalizes its query', () => {
    expect(
      parseBusinessResearchAction(
        { kind: 'search_web', query: '  EV product launch  ', taskId: 'competitor_products' },
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({
      ok: true,
      action: { kind: 'search_web', query: 'EV product launch', taskId: 'competitor_products' },
    });
  });

  it('rejects batches, extra action fields, and unknown tool kinds', () => {
    expect(
      parseBusinessResearchAction(
        [{ kind: 'search_web', query: 'EV range', taskId: 'industry_landscape' }],
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'malformed_action' });
    expect(
      parseBusinessResearchAction(
        { kind: 'search_web', query: 'EV range', taskId: 'industry_landscape', actions: [] },
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'malformed_action' });
    expect(
      parseBusinessResearchAction(
        { kind: 'call_private_api', arguments: {} },
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'unknown_action' });
  });

  it('rejects invalid and unavailable evidence ids before opening a source', () => {
    expect(
      parseBusinessResearchAction(
        { kind: 'open_source', evidenceId: '../other-run/evidence.json' },
        { knownEvidenceIds: [evidenceId], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'invalid_argument', path: 'evidenceId' });
    expect(
      parseBusinessResearchAction(
        { kind: 'open_source', evidenceId: 'evidence-2' },
        { knownEvidenceIds: [evidenceId], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'unknown_evidence', path: 'evidenceId' });
  });

  it('rejects a repeated query/task pair that made no progress', () => {
    const previousAction: BusinessResearchAction = {
      kind: 'search_web',
      query: 'EV range',
      taskId: 'industry_landscape',
    };

    expect(
      parseBusinessResearchAction(
        { kind: 'search_web', query: ' ev RANGE ', taskId: 'industry_landscape' },
        { knownEvidenceIds: [], previousActions: [previousAction] },
      ),
    ).toEqual({ ok: false, code: 'duplicate_no_progress' });
  });

  it('rejects malformed searches and blank finish rationales', () => {
    expect(
      parseBusinessResearchAction(
        { kind: 'search_web', query: ' ', taskId: 'industry_landscape' },
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'invalid_argument', path: 'query' });
    expect(
      parseBusinessResearchAction(
        { kind: 'finish', rationale: '  ' },
        { knownEvidenceIds: [], previousActions: [] },
      ),
    ).toEqual({ ok: false, code: 'invalid_argument', path: 'rationale' });
  });
});
