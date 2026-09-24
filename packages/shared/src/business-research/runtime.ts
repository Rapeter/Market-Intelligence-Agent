import {
  isBusinessResearchEvidenceGrade,
  isBusinessResearchSourceKind,
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchEvidence,
  type BusinessResearchEvidenceId,
  type BusinessResearchObservation,
  type BusinessResearchRunId,
  type BusinessResearchRunState,
  type BusinessResearchTaskInput,
  type BusinessResearchTerminalOutcome,
} from '@finagent/core';
import { BUSINESS_RESEARCH_CATALOG } from './catalog.ts';
import { parseBusinessResearchAction, type BusinessResearchToolPort, type DecisionModelPort } from './core.ts';
import { createBusinessResearchEventLog, type BusinessResearchEvent } from './events.ts';

export interface BusinessResearchRuntimeLimits {
  maxIterations: number;
  maxSearchActions: number;
  maxOpenActions: number;
  maxDurationMs: number;
  maxNoProgressSteps: number;
}

export interface RunBusinessResearchOptions {
  runId: BusinessResearchRunId;
  task: BusinessResearchTaskInput;
  decisionModel: DecisionModelPort;
  tools: BusinessResearchToolPort;
  signal: AbortSignal;
  limits?: Partial<BusinessResearchRuntimeLimits>;
  now?: () => number;
}

export interface BusinessResearchRuntimeResult {
  state: BusinessResearchRunState;
  outcome: BusinessResearchTerminalOutcome;
  actions: BusinessResearchAction[];
  observations: BusinessResearchObservation[];
  evidence: BusinessResearchEvidence[];
  events: BusinessResearchEvent[];
}

const DEFAULT_LIMITS: Omit<BusinessResearchRuntimeLimits, 'maxSearchActions'> = {
  maxIterations: 20,
  maxOpenActions: 8,
  maxDurationMs: 180_000,
  maxNoProgressSteps: 3,
};

const ALLOWED_ACTIONS: readonly BusinessResearchAction['kind'][] = [
  'search_web',
  'open_source',
  'finish',
];

/** Runs one decision at a time; all actions, observations, budgets, and terminal states are explicit. */
export async function runBusinessResearch(
  options: RunBusinessResearchOptions,
): Promise<BusinessResearchRuntimeResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const strategy = BUSINESS_RESEARCH_CATALOG.strategies.find(
    (candidate) => candidate.id === options.task.strategyId,
  );
  const limits: BusinessResearchRuntimeLimits = {
    ...DEFAULT_LIMITS,
    maxSearchActions: strategy?.maxSearchActions ?? 0,
    ...options.limits,
  };
  const eventLog = createBusinessResearchEventLog(options.runId, now);
  const actions: BusinessResearchAction[] = [];
  const observations: BusinessResearchObservation[] = [];
  const evidenceById = new Map<BusinessResearchEvidenceId, BusinessResearchEvidence>();
  let noProgressSteps = 0;
  let searchActions = 0;
  let openActions = 0;
  let timedOut = false;
  let runSignal: AbortSignal = options.signal;
  let cleanupRun = () => {};
  let state: BusinessResearchRunState = {
    status: 'queued',
    updatedAt: isoTime(startedAt),
  };

  eventLog.append({ type: 'run_started', task: options.task });

  const complete = (outcome: BusinessResearchTerminalOutcome): BusinessResearchRuntimeResult => {
    cleanupRun();
    const completedAt = isoTime(now());
    if (outcome.status === 'completed') state = { status: 'completed', completedAt };
    else if (outcome.status === 'partial') state = { status: 'partial', completedAt, reason: outcome.reason };
    else if (outcome.status === 'failed') state = { status: 'failed', completedAt, code: outcome.code };
    else state = { status: 'cancelled', completedAt, reason: outcome.reason };
    eventLog.append({ type: 'run_terminal', outcome });
    return {
      state,
      outcome,
      actions: [...actions],
      observations: [...observations],
      evidence: [...evidenceById.values()],
      events: eventLog.snapshot(),
    };
  };

  const stopForLimit = (code: string, reason: string): BusinessResearchRuntimeResult =>
    evidenceById.size > 0
      ? complete({ status: 'partial', reason })
      : complete({ status: 'failed', code });

  if (!validLimits(limits) || strategy === undefined) {
    return complete({ status: 'failed', code: 'INVALID_BUDGET' });
  }

  const runController = new AbortController();
  const abortFromCaller = () => runController.abort();
  if (options.signal.aborted) runController.abort();
  else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  runSignal = runController.signal;
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    runController.abort();
  }, limits.maxDurationMs);
  cleanupRun = () => {
    clearTimeout(deadlineTimer);
    options.signal.removeEventListener('abort', abortFromCaller);
  };

  for (let iteration = 0; iteration < limits.maxIterations; iteration += 1) {
    if (runSignal.aborted) {
      return timedOut
        ? stopForLimit('TIME_BUDGET_EXHAUSTED', 'Total run time budget exhausted.')
        : complete({ status: 'cancelled' });
    }
    if (now() - startedAt >= limits.maxDurationMs) {
      return stopForLimit('TIME_BUDGET_EXHAUSTED', 'Time budget exhausted before a complete run.');
    }

    state = { status: 'planning', updatedAt: isoTime(now()) };
    eventLog.append({ type: 'phase_changed', status: 'planning' });

    let proposal: unknown;
    try {
      proposal = await awaitWithAbort(
        options.decisionModel.decide(
          { task: options.task, observations, allowedActions: ALLOWED_ACTIONS },
          runSignal,
        ),
        runSignal,
      );
    } catch {
      if (timedOut) return stopForLimit('TIME_BUDGET_EXHAUSTED', 'Total run time budget exhausted.');
      if (runSignal.aborted) return complete({ status: 'cancelled' });
      return complete({ status: 'failed', code: 'MODEL_ERROR' });
    }
    if (timedOut) return stopForLimit('TIME_BUDGET_EXHAUSTED', 'Total run time budget exhausted.');
    if (runSignal.aborted) return complete({ status: 'cancelled' });

    const validation = parseBusinessResearchAction(proposal, {
      knownEvidenceIds: [...evidenceById.keys()],
      previousActions: actions,
    });
    if (!validation.ok) {
      eventLog.append({ type: 'decision_rejected', code: validation.code });
      return complete({ status: 'failed', code: `INVALID_DECISION_${validation.code.toUpperCase()}` });
    }

    const action = validation.action;
    actions.push(action);
    eventLog.append({ type: 'decision_made', action });

    if (action.kind === 'finish') {
      state = { status: 'synthesizing', updatedAt: isoTime(now()) };
      eventLog.append({ type: 'phase_changed', status: 'synthesizing' });
      return evidenceById.size > 0
        ? complete({ status: 'completed' })
        : complete({ status: 'partial', reason: 'The agent finished without collecting any evidence.' });
    }

    if (action.kind === 'search_web' && searchActions >= limits.maxSearchActions) {
      return stopForLimit('SEARCH_BUDGET_EXHAUSTED', 'Search action budget exhausted.');
    }
    if (action.kind === 'open_source' && openActions >= limits.maxOpenActions) {
      return stopForLimit('OPEN_BUDGET_EXHAUSTED', 'Source-opening budget exhausted.');
    }

    if (action.kind === 'search_web') searchActions += 1;
    else openActions += 1;
    state = { status: 'gathering', updatedAt: isoTime(now()) };
    eventLog.append({
      type: 'phase_changed',
      status: 'gathering',
    });
    eventLog.append({
      type: 'tool_started',
      actionKind: action.kind,
      ...(action.kind === 'open_source' ? { evidenceId: action.evidenceId } : {}),
    });

    let returnedEvidence: BusinessResearchEvidence[];
    try {
      returnedEvidence = await awaitWithAbort(
        action.kind === 'search_web'
          ? options.tools.searchWeb(action.query, runSignal)
          : options.tools.openSource(action.evidenceId, runSignal).then((evidence) => [evidence]),
        runSignal,
      );
    } catch (error) {
      if (timedOut) return stopForLimit('TIME_BUDGET_EXHAUSTED', 'Total run time budget exhausted.');
      if (runSignal.aborted) return complete({ status: 'cancelled' });
      const observation: BusinessResearchObservation = {
        kind: 'tool_failure',
        actionKind: action.kind,
        code: safeErrorCode(error),
      };
      observations.push(observation);
      eventLog.append({ type: 'observation_recorded', observation });
      noProgressSteps += 1;
      if (noProgressSteps >= limits.maxNoProgressSteps) {
        return stopForLimit('NO_PROGRESS', 'Repeated tool failures made no research progress.');
      }
      continue;
    }
    if (timedOut) return stopForLimit('TIME_BUDGET_EXHAUSTED', 'Total run time budget exhausted.');
    if (runSignal.aborted) return complete({ status: 'cancelled' });

    const normalized = normalizeReturnedEvidence(returnedEvidence, action);
    if (!normalized.ok) {
      const observation: BusinessResearchObservation = {
        kind: 'tool_failure',
        actionKind: action.kind,
        code: 'INVALID_EVIDENCE',
      };
      observations.push(observation);
      eventLog.append({ type: 'observation_recorded', observation });
      noProgressSteps += 1;
      if (noProgressSteps >= limits.maxNoProgressSteps) {
        return stopForLimit('NO_PROGRESS', 'Repeated invalid tool results made no research progress.');
      }
      continue;
    }

    let madeProgress = false;
    for (const item of normalized.evidence) {
      const existing = evidenceById.get(item.id);
      if (existing === undefined || evidenceChanged(existing, item)) {
        evidenceById.set(item.id, item);
        madeProgress = true;
      }
    }
    noProgressSteps = madeProgress ? 0 : noProgressSteps + 1;
    const observation: BusinessResearchObservation =
      action.kind === 'search_web'
        ? { kind: 'search_results', query: action.query, evidence: normalized.evidence }
        : { kind: 'source_opened', evidence: normalized.evidence[0]! };
    observations.push(observation);
    eventLog.append({ type: 'observation_recorded', observation });
    if (noProgressSteps >= limits.maxNoProgressSteps) {
      return stopForLimit('NO_PROGRESS', 'Repeated observations added no new evidence.');
    }
  }

  return stopForLimit('ITERATION_BUDGET_EXHAUSTED', 'Decision iteration budget exhausted.');
}

function validLimits(limits: BusinessResearchRuntimeLimits): boolean {
  return Object.values(limits).every((value) => Number.isInteger(value) && value > 0);
}

function normalizeReturnedEvidence(
  values: unknown,
  action: Extract<BusinessResearchAction, { kind: 'search_web' | 'open_source' }>,
): { ok: true; evidence: BusinessResearchEvidence[] } | { ok: false } {
  if (!Array.isArray(values)) return { ok: false };
  const evidence: BusinessResearchEvidence[] = [];
  const seen = new Set<BusinessResearchEvidenceId>();
  for (const value of values as unknown[]) {
    if (!isRecord(value)) return { ok: false };
    const id = parseBusinessResearchId('evidence', value.id);
    const sourceId = parseBusinessResearchId('source', value.sourceId);
    if (
      id === undefined ||
      sourceId === undefined ||
      typeof value.title !== 'string' ||
      value.title.trim().length === 0 ||
      value.title.length > 500 ||
      typeof value.url !== 'string' ||
      !isPublicHttpsUrl(value.url) ||
      !isBusinessResearchSourceKind(value.sourceKind) ||
      !isBusinessResearchEvidenceGrade(value.grade) ||
      typeof value.query !== 'string' ||
      value.query.length > 500 ||
      typeof value.excerpt !== 'string' ||
      value.excerpt.length > 4_000 ||
      typeof value.retrievedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.retrievedAt))
    ) {
      return { ok: false };
    }
    if (action.kind === 'open_source' && (id !== action.evidenceId || value.grade !== 'page_text')) {
      return { ok: false };
    }
    if (action.kind === 'search_web' && value.grade !== 'search_excerpt') return { ok: false };
    if (seen.has(id)) continue;
    seen.add(id);
    evidence.push({
      id,
      sourceId,
      title: value.title.trim(),
      url: value.url,
      sourceKind: value.sourceKind,
      grade: value.grade,
      query: value.query,
      excerpt: value.excerpt,
      retrievedAt: value.retrievedAt,
    });
  }
  if (action.kind === 'open_source' && evidence.length !== 1) return { ok: false };
  return { ok: true, evidence };
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

function evidenceChanged(previous: BusinessResearchEvidence, next: BusinessResearchEvidence): boolean {
  return (
    previous.grade !== next.grade ||
    previous.excerpt !== next.excerpt ||
    previous.title !== next.title ||
    previous.url !== next.url
  );
}

function safeErrorCode(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,64}$/u.test(error.code)
  ) {
    return error.code;
  }
  return 'TOOL_ERROR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function makeAbortError(): Error {
  const error = new Error('Business research run cancelled');
  error.name = 'AbortError';
  return error;
}
