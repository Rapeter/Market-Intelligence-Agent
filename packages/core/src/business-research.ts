declare const idBrand: unique symbol;

type Brand<T extends string, Name extends string> = T & { readonly [idBrand]: Name };

export type BusinessResearchIdKind =
  | 'source'
  | 'evidence'
  | 'run'
  | 'report'
  | 'claim'
  | 'subscription'
  | 'event';

export type BusinessResearchId<Kind extends BusinessResearchIdKind> = Brand<
  string,
  `BusinessResearch${Capitalize<Kind>}Id`
>;

export const BUSINESS_RESEARCH_TASK_KEYS = [
  'industry_landscape',
  'competitor_products',
  'pricing_channels',
  'public_feedback',
  'policy_technology_risk',
  'evidence_change_review',
] as const;

export type BusinessResearchTaskId = (typeof BUSINESS_RESEARCH_TASK_KEYS)[number];

export const BUSINESS_RESEARCH_STRATEGY_KEYS = [
  'industry_overview',
  'competitor_deep_dive',
  'change_risk_tracking',
] as const;

export type BusinessResearchStrategyId = (typeof BUSINESS_RESEARCH_STRATEGY_KEYS)[number];

export type BusinessResearchSourceId = BusinessResearchId<'source'>;
export type BusinessResearchEvidenceId = BusinessResearchId<'evidence'>;
export type BusinessResearchRunId = BusinessResearchId<'run'>;
export type BusinessResearchReportId = BusinessResearchId<'report'>;
export type BusinessResearchClaimId = BusinessResearchId<'claim'>;
export type BusinessResearchSubscriptionId = BusinessResearchId<'subscription'>;
export type BusinessResearchEventId = BusinessResearchId<'event'>;

const BUSINESS_RESEARCH_ID_KINDS = [
  'source',
  'evidence',
  'run',
  'report',
  'claim',
  'subscription',
  'event',
] as const satisfies readonly BusinessResearchIdKind[];

/** Parses a persisted or IPC id without allowing separators that could escape record boundaries. */
export function parseBusinessResearchId<Kind extends BusinessResearchIdKind>(
  kind: Kind,
  value: unknown,
): BusinessResearchId<Kind> | undefined {
  if (!BUSINESS_RESEARCH_ID_KINDS.includes(kind)) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value)
  ) {
    return undefined;
  }
  return value as BusinessResearchId<Kind>;
}

export function isBusinessResearchTaskId(value: unknown): value is BusinessResearchTaskId {
  return typeof value === 'string' && BUSINESS_RESEARCH_TASK_KEYS.some((key) => key === value);
}

export function isBusinessResearchStrategyId(value: unknown): value is BusinessResearchStrategyId {
  return typeof value === 'string' && BUSINESS_RESEARCH_STRATEGY_KEYS.some((key) => key === value);
}

export const BUSINESS_RESEARCH_SOURCE_KINDS = [
  'company_site',
  'public_filing',
  'news',
  'public_feedback',
  'other_public',
] as const;

export type BusinessResearchSourceKind = (typeof BUSINESS_RESEARCH_SOURCE_KINDS)[number];

export const BUSINESS_RESEARCH_EVIDENCE_GRADES = ['search_excerpt', 'page_text'] as const;

export type BusinessResearchEvidenceGrade = (typeof BUSINESS_RESEARCH_EVIDENCE_GRADES)[number];

export function isBusinessResearchSourceKind(value: unknown): value is BusinessResearchSourceKind {
  return typeof value === 'string' && BUSINESS_RESEARCH_SOURCE_KINDS.some((kind) => kind === value);
}

export function isBusinessResearchEvidenceGrade(
  value: unknown,
): value is BusinessResearchEvidenceGrade {
  return typeof value === 'string' && BUSINESS_RESEARCH_EVIDENCE_GRADES.some((grade) => grade === value);
}

export type BusinessResearchAction =
  | { kind: 'search_web'; query: string; taskId: BusinessResearchTaskId }
  | { kind: 'open_source'; evidenceId: BusinessResearchEvidenceId }
  | { kind: 'finish'; rationale: string };

export interface BusinessResearchEvidence {
  id: BusinessResearchEvidenceId;
  sourceId: BusinessResearchSourceId;
  title: string;
  url: string;
  sourceKind: BusinessResearchSourceKind;
  grade: BusinessResearchEvidenceGrade;
  query: string;
  excerpt: string;
  retrievedAt: string;
}

export type BusinessResearchObservation =
  | { kind: 'search_results'; query: string; evidence: BusinessResearchEvidence[] }
  | { kind: 'source_opened'; evidence: BusinessResearchEvidence }
  | { kind: 'tool_failure'; actionKind: 'search_web' | 'open_source'; code: string };

type NonEmpty<T> = readonly [T, ...T[]];

/** Claims cannot be rendered as facts without evidence; unresolved items are explicitly not conclusions. */
export type BusinessResearchClaim =
  | {
      kind: 'supported';
      id: BusinessResearchClaimId;
      statement: string;
      evidenceIds: NonEmpty<BusinessResearchEvidenceId>;
    }
  | {
      kind: 'conflicted';
      id: BusinessResearchClaimId;
      statement: string;
      supportingEvidenceIds: NonEmpty<BusinessResearchEvidenceId>;
      contradictingEvidenceIds: NonEmpty<BusinessResearchEvidenceId>;
    }
  | {
      kind: 'unresolved';
      id: BusinessResearchClaimId;
      question: string;
      reason: string;
    };

export const BUSINESS_RESEARCH_RUN_STATUSES = [
  'queued',
  'planning',
  'gathering',
  'synthesizing',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;

export type BusinessResearchRunStatus = (typeof BUSINESS_RESEARCH_RUN_STATUSES)[number];

export function isBusinessResearchRunStatus(value: unknown): value is BusinessResearchRunStatus {
  return typeof value === 'string' && BUSINESS_RESEARCH_RUN_STATUSES.some((status) => status === value);
}

export type BusinessResearchRunState =
  | { status: 'queued'; updatedAt: string }
  | { status: 'planning'; updatedAt: string }
  | { status: 'gathering'; updatedAt: string }
  | { status: 'synthesizing'; updatedAt: string }
  | { status: 'completed'; completedAt: string }
  | { status: 'partial'; completedAt: string; reason: string }
  | { status: 'failed'; completedAt: string; code: string }
  | { status: 'cancelled'; completedAt: string; reason?: string };

export type BusinessResearchTerminalOutcome =
  | { status: 'completed' }
  | { status: 'partial'; reason: string }
  | { status: 'failed'; code: string }
  | { status: 'cancelled'; reason?: string };

export interface BusinessResearchTaskInput {
  industry: string;
  question: string;
  competitors: string[];
  strategyId: BusinessResearchStrategyId;
  timeRange?: { from?: string; to?: string };
}

export interface BusinessResearchInputIssue {
  path: string;
  code:
    | 'required'
    | 'invalid_shape'
    | 'invalid_value'
    | 'unsupported_value'
    | 'invalid_date'
    | 'invalid_range';
}

export type BusinessResearchInputResult =
  | { ok: true; value: BusinessResearchTaskInput }
  | { ok: false; issues: BusinessResearchInputIssue[] };

const MAX_INDUSTRY_LENGTH = 120;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_COMPETITOR_NAME_LENGTH = 120;

/** Normalizes untrusted UI/persisted input into the domain shape used by research runs. */
export function normalizeBusinessResearchInput(input: unknown): BusinessResearchInputResult {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: 'input', code: 'invalid_shape' }] };
  }

  const issues: BusinessResearchInputIssue[] = [];
  const industry = readRequiredText(input.industry, 'industry', MAX_INDUSTRY_LENGTH, issues);
  const question = readRequiredText(input.question, 'question', MAX_QUESTION_LENGTH, issues);
  const competitors = normalizeCompetitors(input.competitors, issues);
  let strategyId: BusinessResearchStrategyId | undefined;
  if (isBusinessResearchStrategyId(input.strategyId)) {
    strategyId = input.strategyId;
  } else {
    issues.push({ path: 'strategyId', code: 'unsupported_value' });
  }

  const timeRange = normalizeTimeRange(input.timeRange, issues);

  if (
    issues.length > 0 ||
    industry === undefined ||
    question === undefined ||
    competitors === undefined ||
    strategyId === undefined
  ) {
    return { ok: false, issues };
  }

  const value: BusinessResearchTaskInput = { industry, question, competitors, strategyId };
  if (timeRange !== undefined) value.timeRange = timeRange;
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredText(
  value: unknown,
  path: string,
  maxLength: number,
  issues: BusinessResearchInputIssue[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ path, code: 'required' });
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    issues.push({ path, code: 'invalid_value' });
    return undefined;
  }
  return normalized;
}

function normalizeCompetitors(
  value: unknown,
  issues: BusinessResearchInputIssue[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path: 'competitors', code: 'invalid_shape' });
    return undefined;
  }
  const values: unknown[] = value;
  if (values.length < 2 || values.length > 4) {
    issues.push({ path: 'competitors', code: 'invalid_value' });
    return undefined;
  }

  const competitors: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') {
      issues.push({ path: 'competitors', code: 'invalid_value' });
      return undefined;
    }
    competitors.push(item.trim());
  }
  if (
    competitors.some(
      (name) =>
        name.length === 0 ||
        name.length > MAX_COMPETITOR_NAME_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(name),
    )
  ) {
    issues.push({ path: 'competitors', code: 'invalid_value' });
    return undefined;
  }
  const normalizedNames = competitors.map((name) => name.normalize('NFKC').toLocaleLowerCase('en-US'));
  if (new Set(normalizedNames).size !== competitors.length) {
    issues.push({ path: 'competitors', code: 'invalid_value' });
    return undefined;
  }
  return competitors;
}

function normalizeTimeRange(
  value: unknown,
  issues: BusinessResearchInputIssue[],
): BusinessResearchTaskInput['timeRange'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({ path: 'timeRange', code: 'invalid_shape' });
    return undefined;
  }

  const from = readOptionalDate(value.from, 'timeRange.from', issues);
  const to = readOptionalDate(value.to, 'timeRange.to', issues);
  if (from === undefined && to === undefined) return undefined;
  if (from !== undefined && to !== undefined && from > to) {
    issues.push({ path: 'timeRange', code: 'invalid_range' });
    return undefined;
  }
  const range: { from?: string; to?: string } = {};
  if (from !== undefined) range.from = from;
  if (to !== undefined) range.to = to;
  return range;
}

function readOptionalDate(
  value: unknown,
  path: string,
  issues: BusinessResearchInputIssue[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isCalendarDate(value)) return value;
  issues.push({ path, code: 'invalid_date' });
  return undefined;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
