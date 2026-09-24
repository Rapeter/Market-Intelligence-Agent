import { createHash } from 'node:crypto';
import type {
  BusinessResearchAction,
  BusinessResearchEvidence,
  BusinessResearchRunId,
  BusinessResearchTaskInput,
} from '@finagent/core';
import type { BusinessResearchToolPort, DecisionModelPort } from '@finagent/shared/business-research';

const ALLOWED_PROBE_ACTIONS: readonly BusinessResearchAction['kind'][] = ['search_web', 'finish'];
const MAX_RESULTS_TO_OPEN_PER_COMPETITOR = 3;

export interface LiveCounterfactualAction {
  kind: 'search_web' | 'finish';
  query?: string;
}

export interface LiveCounterfactualPair {
  competitor: string;
  source: {
    evidenceId: string;
    title: string;
    url: string;
    sourceKind: string;
    grade: 'page_text';
    retrievedAt: string;
    excerptSha256: string;
  };
  evidenceMissingAction: LiveCounterfactualAction;
  evidencePresentAction: LiveCounterfactualAction;
  elapsedMs: { evidenceMissing: number; evidencePresent: number };
  diverged: boolean;
}

export interface RunBusinessResearchLiveCounterfactualsOptions {
  task: BusinessResearchTaskInput;
  tools: BusinessResearchToolPort;
  createDecisionModel: (runId: BusinessResearchRunId) => DecisionModelPort;
  createRunId: () => BusinessResearchRunId;
  sanitizeText: (value: string) => string;
  signal: AbortSignal;
  now?: () => number;
}

/** Calls the real decision model with a fixed task and only the evidence changed per pair. */
export async function runBusinessResearchLiveCounterfactuals(
  options: RunBusinessResearchLiveCounterfactualsOptions,
): Promise<{ pairs: LiveCounterfactualPair[] }> {
  const now = options.now ?? Date.now;
  const pairs: LiveCounterfactualPair[] = [];

  for (const competitor of options.task.competitors.slice(0, 2)) {
    throwIfAborted(options.signal);
    const query = buildProbeQuery(options.task, competitor);
    const searchResults = await options.tools.searchWeb(query, options.signal);
    const openedEvidence = await openFirstPageTextEvidence(options.tools, searchResults, options.signal);
    if (openedEvidence === undefined) throw liveEvidenceUnavailableError();

    const missingStartedAt = now();
    const evidenceMissing = await options.createDecisionModel(options.createRunId()).decide({
      task: options.task,
      observations: [],
      allowedActions: ALLOWED_PROBE_ACTIONS,
    }, options.signal);
    const evidenceMissingElapsedMs = elapsedSince(missingStartedAt, now);

    const presentStartedAt = now();
    const evidencePresent = await options.createDecisionModel(options.createRunId()).decide({
      task: options.task,
      observations: [{ kind: 'source_opened', evidence: openedEvidence }],
      allowedActions: ALLOWED_PROBE_ACTIONS,
    }, options.signal);
    const evidencePresentElapsedMs = elapsedSince(presentStartedAt, now);

    const evidenceMissingAction = summarizeAction(evidenceMissing, options.sanitizeText);
    const evidencePresentAction = summarizeAction(evidencePresent, options.sanitizeText);
    pairs.push({
      competitor,
      source: summarizeEvidence(openedEvidence),
      evidenceMissingAction,
      evidencePresentAction,
      elapsedMs: {
        evidenceMissing: evidenceMissingElapsedMs,
        evidencePresent: evidencePresentElapsedMs,
      },
      diverged: actionSignature(evidenceMissingAction) !== actionSignature(evidencePresentAction),
    });
  }

  return { pairs };
}

async function openFirstPageTextEvidence(
  tools: BusinessResearchToolPort,
  candidates: readonly BusinessResearchEvidence[],
  signal: AbortSignal,
): Promise<BusinessResearchEvidence | undefined> {
  for (const candidate of candidates.slice(0, MAX_RESULTS_TO_OPEN_PER_COMPETITOR)) {
    throwIfAborted(signal);
    try {
      const opened = await tools.openSource(candidate.id, signal);
      if (opened.id === candidate.id && opened.grade === 'page_text' && opened.excerpt.trim().length > 0) {
        return opened;
      }
    } catch {
      if (signal.aborted) throw signal.reason;
      // An inaccessible page is not promoted to verified evidence; try the next public result.
    }
  }
  return undefined;
}

function buildProbeQuery(task: BusinessResearchTaskInput, competitor: string): string {
  const question = task.question.trim().split(/\s+/u).slice(0, 50).join(' ');
  return `${competitor} ${task.industry} ${question} public product pricing`.slice(0, 500);
}

function summarizeEvidence(evidence: BusinessResearchEvidence): LiveCounterfactualPair['source'] {
  let url = evidence.url;
  try {
    const parsed = new URL(evidence.url);
    parsed.search = '';
    parsed.hash = '';
    url = parsed.href;
  } catch {
    url = 'invalid-public-source-url';
  }
  return {
    evidenceId: evidence.id,
    title: evidence.title.slice(0, 240),
    url,
    sourceKind: evidence.sourceKind,
    grade: 'page_text',
    retrievedAt: evidence.retrievedAt,
    excerptSha256: createHash('sha256').update(evidence.excerpt).digest('hex'),
  };
}

function summarizeAction(
  action: BusinessResearchAction,
  sanitizeText: (value: string) => string,
): LiveCounterfactualAction {
  if (action.kind === 'search_web') return { kind: 'search_web', query: sanitizeText(action.query) };
  if (action.kind === 'finish') return { kind: 'finish' };
  throw Object.assign(
    new Error('The live counterfactual model selected an action outside its allowed set.'),
    { code: 'BUSINESS_RESEARCH_LIVE_INVALID_DECISION' },
  );
}

function actionSignature(action: LiveCounterfactualAction): string {
  if (action.kind !== 'search_web') return action.kind;
  return `${action.kind}:${(action.query ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')}`;
}

function elapsedSince(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Live research acceptance was cancelled.');
}

function liveEvidenceUnavailableError(): Error & { code: string } {
  return Object.assign(
    new Error('Live counterfactual acceptance requires opened public page evidence for both competitors.'),
    { code: 'BUSINESS_RESEARCH_LIVE_EVIDENCE_UNAVAILABLE' },
  );
}
