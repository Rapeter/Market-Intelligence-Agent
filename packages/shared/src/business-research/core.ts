import {
  isBusinessResearchTaskId,
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchEvidenceId,
  type BusinessResearchEvidence,
  type BusinessResearchObservation,
  type BusinessResearchTaskInput,
} from '@finagent/core';

export interface DecisionModelPort {
  decide(
    input: {
      task: BusinessResearchTaskInput;
      observations: readonly BusinessResearchObservation[];
      allowedActions: readonly BusinessResearchAction['kind'][];
    },
    signal: AbortSignal,
  ): Promise<BusinessResearchAction>;
}

export interface BusinessResearchToolPort {
  searchWeb(query: string, signal: AbortSignal): Promise<BusinessResearchEvidence[]>;
  openSource(evidenceId: BusinessResearchEvidenceId, signal: AbortSignal): Promise<BusinessResearchEvidence>;
}

export type BusinessResearchActionRejectionCode =
  | 'malformed_action'
  | 'unknown_action'
  | 'invalid_argument'
  | 'unknown_evidence'
  | 'duplicate_no_progress';

export interface BusinessResearchActionValidationContext {
  knownEvidenceIds: readonly BusinessResearchEvidenceId[];
  previousActions: readonly BusinessResearchAction[];
}

export type BusinessResearchActionValidationResult =
  | { ok: true; action: BusinessResearchAction }
  | { ok: false; code: BusinessResearchActionRejectionCode; path?: string };

/** Validates a single untrusted model action before it can reach a research tool. */
export function parseBusinessResearchAction(
  value: unknown,
  context: BusinessResearchActionValidationContext,
): BusinessResearchActionValidationResult {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return { ok: false, code: 'malformed_action' };
  }

  switch (value.kind) {
    case 'search_web': {
      if (!hasExactKeys(value, ['kind', 'query', 'taskId'])) {
        return { ok: false, code: 'malformed_action' };
      }
      if (typeof value.query !== 'string' || !isBusinessResearchTaskId(value.taskId)) {
        return { ok: false, code: 'invalid_argument', path: typeof value.query !== 'string' ? 'query' : 'taskId' };
      }
      const query = normalizeQuery(value.query);
      if (query.length === 0 || query.length > 500 || /[\u0000-\u001f\u007f]/u.test(query)) {
        return { ok: false, code: 'invalid_argument', path: 'query' };
      }
      const duplicate = context.previousActions.some(
        (action) =>
          action.kind === 'search_web' &&
          action.taskId === value.taskId &&
          normalizeQuery(action.query).toLocaleLowerCase('en-US') === query.toLocaleLowerCase('en-US'),
      );
      if (duplicate) return { ok: false, code: 'duplicate_no_progress' };
      return {
        ok: true,
        action: { kind: 'search_web', query, taskId: value.taskId },
      };
    }
    case 'open_source': {
      if (!hasExactKeys(value, ['kind', 'evidenceId'])) {
        return { ok: false, code: 'malformed_action' };
      }
      const evidenceId = parseBusinessResearchId('evidence', value.evidenceId);
      if (evidenceId === undefined) {
        return { ok: false, code: 'invalid_argument', path: 'evidenceId' };
      }
      if (!context.knownEvidenceIds.includes(evidenceId)) {
        return { ok: false, code: 'unknown_evidence', path: 'evidenceId' };
      }
      if (
        context.previousActions.some(
          (action) => action.kind === 'open_source' && action.evidenceId === evidenceId,
        )
      ) {
        return { ok: false, code: 'duplicate_no_progress' };
      }
      return { ok: true, action: { kind: 'open_source', evidenceId } };
    }
    case 'finish': {
      if (!hasExactKeys(value, ['kind', 'rationale'])) {
        return { ok: false, code: 'malformed_action' };
      }
      if (typeof value.rationale !== 'string') {
        return { ok: false, code: 'invalid_argument', path: 'rationale' };
      }
      const rationale = value.rationale.trim();
      if (rationale.length === 0 || rationale.length > 500) {
        return { ok: false, code: 'invalid_argument', path: 'rationale' };
      }
      return { ok: true, action: { kind: 'finish', rationale } };
    }
    default:
      return { ok: false, code: 'unknown_action' };
  }
}

function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
