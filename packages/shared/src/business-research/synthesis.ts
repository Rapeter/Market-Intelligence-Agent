import {
  isBusinessResearchEvidenceGrade,
  isBusinessResearchSourceKind,
  parseBusinessResearchId,
  type BusinessResearchClaim,
  type BusinessResearchClaimId,
  type BusinessResearchEvidence,
  type BusinessResearchEvidenceId,
  type BusinessResearchReportId,
  type BusinessResearchRunId,
} from '@finagent/core';
import { canonicalizeEvidenceUrl, cleanEvidenceText } from './evidence.ts';

export interface BusinessResearchReport {
  id: BusinessResearchReportId;
  runId: BusinessResearchRunId;
  generatedAt: string;
  status: 'completed' | 'partial';
  partialReason?: string;
  title: string;
  claims: BusinessResearchClaim[];
  evidence: BusinessResearchEvidence[];
  monitoringActions: string[];
}

export interface BusinessResearchSynthesisIssue {
  path: string;
  code:
    | 'invalid_report_id'
    | 'invalid_run_id'
    | 'invalid_timestamp'
    | 'unsupported_outcome'
    | 'invalid_evidence'
    | 'invalid_draft'
    | 'invalid_title'
    | 'invalid_claim'
    | 'duplicate_claim_id'
    | 'missing_evidence'
    | 'unsupported_citation'
    | 'invalid_monitoring_actions'
    | 'completed_without_supported_claim';
}

export type BusinessResearchSynthesisResult =
  | { ok: true; report: BusinessResearchReport }
  | { ok: false; issues: BusinessResearchSynthesisIssue[] };

/** Validates an untrusted synthesis against the persisted evidence available to the run. */
export function synthesizeBusinessResearchReport(input: unknown): BusinessResearchSynthesisResult {
  if (!isRecord(input)) return { ok: false, issues: [{ path: 'input', code: 'invalid_draft' }] };

  const issues: BusinessResearchSynthesisIssue[] = [];
  const id = parseBusinessResearchId('report', input.reportId);
  const runId = parseBusinessResearchId('run', input.runId);
  if (id === undefined) issues.push({ path: 'reportId', code: 'invalid_report_id' });
  if (runId === undefined) issues.push({ path: 'runId', code: 'invalid_run_id' });

  const generatedAt = typeof input.generatedAt === 'string' && Number.isFinite(Date.parse(input.generatedAt))
    ? new Date(input.generatedAt).toISOString()
    : undefined;
  if (generatedAt === undefined) issues.push({ path: 'generatedAt', code: 'invalid_timestamp' });

  const outcome = parseOutcome(input.outcome);
  let reportOutcome = outcome;
  if (outcome === undefined) issues.push({ path: 'outcome', code: 'unsupported_outcome' });

  const persistedEvidence = parseEvidence(input.evidence);
  if (persistedEvidence === undefined) issues.push({ path: 'evidence', code: 'invalid_evidence' });

  if (!isRecord(input.draft)) issues.push({ path: 'draft', code: 'invalid_draft' });
  const draft = isRecord(input.draft) ? input.draft : undefined;
  const title = draft === undefined ? undefined : cleanEvidenceText(draft.title, 300);
  if (title === undefined || title.length === 0) issues.push({ path: 'draft.title', code: 'invalid_title' });

  const evidenceById = new Map<BusinessResearchEvidenceId, BusinessResearchEvidence>();
  for (const item of persistedEvidence ?? []) {
    if (evidenceById.has(item.id)) {
      issues.push({ path: 'evidence', code: 'invalid_evidence' });
      break;
    }
    evidenceById.set(item.id, item);
  }

  const claims: BusinessResearchClaim[] = [];
  const claimIds = new Set<BusinessResearchClaimId>();
  let claimHasEvidence = false;
  let claimValidationFailed = false;
  const citedIds = new Set<BusinessResearchEvidenceId>();
  if (draft === undefined || !Array.isArray(draft.claims)) {
    issues.push({ path: 'draft.claims', code: 'invalid_draft' });
  } else {
    for (const [index, rawClaim] of draft.claims.entries()) {
      const parsed = parseClaim(
        rawClaim,
        index,
        evidenceById,
        input.allowedEvidenceIdsByClaim,
      );
      if (parsed.issue !== undefined) {
        issues.push(parsed.issue);
        claimValidationFailed = true;
        continue;
      }
      const claim = parsed.claim;
      if (claimIds.has(claim.id)) {
        issues.push({ path: `draft.claims[${index}].id`, code: 'duplicate_claim_id' });
        claimValidationFailed = true;
        continue;
      }
      claimIds.add(claim.id);
      claims.push(claim);
      const refs = referencedEvidenceIds(claim);
      if (refs.length > 0) claimHasEvidence = true;
      for (const evidenceId of refs) citedIds.add(evidenceId);
    }
  }

  const monitoringActions: string[] = [];
  if (draft !== undefined && draft.monitoringActions !== undefined) {
    if (!Array.isArray(draft.monitoringActions) || draft.monitoringActions.length > 10) {
      issues.push({ path: 'draft.monitoringActions', code: 'invalid_monitoring_actions' });
    } else {
      for (const [index, value] of draft.monitoringActions.entries()) {
        const action = cleanEvidenceText(value, 500);
        if (action.length === 0) {
          issues.push({ path: `draft.monitoringActions[${index}]`, code: 'invalid_monitoring_actions' });
          continue;
        }
        if (!monitoringActions.includes(action)) monitoringActions.push(action);
      }
    }
  }

  if (outcome?.status === 'completed' && !claimHasEvidence && !claimValidationFailed) {
    if (claims.length > 0 && claims.every((claim) => claim.kind === 'unresolved')) {
      reportOutcome = {
        status: 'partial',
        reason: 'No evidence-backed factual claims were available.',
      };
    } else {
      issues.push({ path: 'draft.claims', code: 'completed_without_supported_claim' });
    }
  }

  if (
    issues.length > 0 || id === undefined || runId === undefined || generatedAt === undefined ||
    outcome === undefined || persistedEvidence === undefined || title === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    report: {
      id,
      runId,
      generatedAt,
      status: reportOutcome!.status,
      ...(reportOutcome!.status === 'partial' ? { partialReason: reportOutcome!.reason } : {}),
      title,
      claims,
      evidence: persistedEvidence.filter((item) => citedIds.has(item.id)),
      monitoringActions,
    },
  };
}

function parseOutcome(value: unknown): { status: 'completed' } | { status: 'partial'; reason: string } | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === 'completed') return { status: 'completed' };
  if (value.status !== 'partial') return undefined;
  const reason = cleanEvidenceText(value.reason, 500);
  return reason.length > 0 ? { status: 'partial', reason } : undefined;
}

function parseEvidence(value: unknown): BusinessResearchEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: BusinessResearchEvidence[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return undefined;
    const id = parseBusinessResearchId('evidence', item.id);
    const sourceId = parseBusinessResearchId('source', item.sourceId);
    const url = canonicalizeEvidenceUrl(item.url);
    const title = cleanEvidenceText(item.title, 500);
    const query = cleanEvidenceText(item.query, 500);
    const excerpt = cleanEvidenceText(item.excerpt, 4_000);
    const fixtureGradeMatchesSource = (item.sourceKind === 'fixture') === (item.grade === 'fixture_data');
    if (
      id === undefined || sourceId === undefined || url === undefined || title.length === 0 ||
      query.length === 0 || excerpt.length === 0 || !isBusinessResearchSourceKind(item.sourceKind) ||
      !isBusinessResearchEvidenceGrade(item.grade) || !fixtureGradeMatchesSource || typeof item.retrievedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.retrievedAt))
    ) {
      return undefined;
    }
    result.push({
      id,
      sourceId,
      title,
      url,
      sourceKind: item.sourceKind,
      grade: item.grade,
      query,
      excerpt,
      retrievedAt: new Date(item.retrievedAt).toISOString(),
    });
  }
  return result;
}

function parseClaim(
  value: unknown,
  index: number,
  evidenceById: ReadonlyMap<BusinessResearchEvidenceId, BusinessResearchEvidence>,
  allowedEvidenceByClaim: unknown,
): { claim: BusinessResearchClaim; issue?: never } | { claim?: never; issue: BusinessResearchSynthesisIssue } {
  const path = `draft.claims[${index}]`;
  if (!isRecord(value)) return { issue: { path, code: 'invalid_claim' } };
  const id = parseBusinessResearchId('claim', value.id);
  if (id === undefined) return { issue: { path: `${path}.id`, code: 'invalid_claim' } };

  if (value.kind === 'supported' || value.kind === 'conflicted') {
    const statement = cleanEvidenceText(value.statement, 1_000);
    if (statement.length === 0) return { issue: { path: `${path}.statement`, code: 'invalid_claim' } };
    const fields = value.kind === 'supported'
      ? [{ key: 'evidenceIds', raw: value.evidenceIds }]
      : [
          { key: 'supportingEvidenceIds', raw: value.supportingEvidenceIds },
          { key: 'contradictingEvidenceIds', raw: value.contradictingEvidenceIds },
        ];
    const references: BusinessResearchEvidenceId[][] = [];
    for (const field of fields) {
      const parsed = parseEvidenceReferences(
        field.raw,
        `${path}.${field.key}`,
        id,
        evidenceById,
        allowedEvidenceByClaim,
      );
      if (parsed.issue !== undefined) return { issue: parsed.issue };
      references.push(parsed.ids);
    }
    if (
      value.kind === 'conflicted' &&
      references[0]!.some((evidenceId) => references[1]!.includes(evidenceId))
    ) {
      return { issue: { path, code: 'invalid_claim' } };
    }
    return value.kind === 'supported'
      ? { claim: { kind: 'supported', id, statement, evidenceIds: references[0] as [BusinessResearchEvidenceId, ...BusinessResearchEvidenceId[]] } }
      : {
          claim: {
            kind: 'conflicted',
            id,
            statement,
            supportingEvidenceIds: references[0] as [BusinessResearchEvidenceId, ...BusinessResearchEvidenceId[]],
            contradictingEvidenceIds: references[1] as [BusinessResearchEvidenceId, ...BusinessResearchEvidenceId[]],
          },
        };
  }

  if (value.kind === 'unresolved') {
    const question = cleanEvidenceText(value.question, 1_000);
    const reason = cleanEvidenceText(value.reason, 1_000);
    if (question.length === 0 || reason.length === 0) return { issue: { path, code: 'invalid_claim' } };
    return { claim: { kind: 'unresolved', id, question, reason } };
  }
  return { issue: { path, code: 'invalid_claim' } };
}

function parseEvidenceReferences(
  value: unknown,
  path: string,
  claimId: BusinessResearchClaimId,
  evidenceById: ReadonlyMap<BusinessResearchEvidenceId, BusinessResearchEvidence>,
  allowedEvidenceByClaim: unknown,
): { ids: BusinessResearchEvidenceId[]; issue?: never } | { ids?: never; issue: BusinessResearchSynthesisIssue } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    return { issue: { path, code: 'invalid_claim' } };
  }
  const allowedIds = isRecord(allowedEvidenceByClaim)
    ? asStringSet(allowedEvidenceByClaim[claimId])
    : undefined;
  const seen = new Set<BusinessResearchEvidenceId>();
  const ids: BusinessResearchEvidenceId[] = [];
  for (const [index, rawId] of value.entries()) {
    const evidenceId = parseBusinessResearchId('evidence', rawId);
    if (evidenceId === undefined) return { issue: { path: `${path}[${index}]`, code: 'invalid_claim' } };
    if (!evidenceById.has(evidenceId)) return { issue: { path: `${path}[${index}]`, code: 'missing_evidence' } };
    if (allowedEvidenceByClaim !== undefined && (allowedIds === undefined || !allowedIds.has(evidenceId))) {
      return { issue: { path: `${path}[${index}]`, code: 'unsupported_citation' } };
    }
    if (seen.has(evidenceId)) return { issue: { path: `${path}[${index}]`, code: 'invalid_claim' } };
    seen.add(evidenceId);
    ids.push(evidenceId);
  }
  return { ids };
}

function referencedEvidenceIds(claim: BusinessResearchClaim): BusinessResearchEvidenceId[] {
  if (claim.kind === 'supported') return [...claim.evidenceIds];
  if (claim.kind === 'conflicted') return [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds];
  return [];
}

function asStringSet(value: unknown): Set<string> | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return new Set(value as string[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
