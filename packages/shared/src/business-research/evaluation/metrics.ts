import {
  isBusinessResearchEvidenceGrade,
  isBusinessResearchSourceKind,
  parseBusinessResearchId,
  type BusinessResearchAction,
  type BusinessResearchClaim,
  type BusinessResearchEvidence,
  type BusinessResearchEvidenceId,
  type BusinessResearchReportId,
  type BusinessResearchRunId,
} from '@finagent/core';
import type { BusinessResearchToolPort, DecisionModelPort } from '../core.ts';
import { evaluateBusinessResearchMonitorSignal } from '../monitor-signals.ts';
import { synthesizeBusinessResearchReport, type BusinessResearchReport, type BusinessResearchSynthesisResult } from '../synthesis.ts';
import { runBusinessResearch, type BusinessResearchRuntimeResult } from '../runtime.ts';
import {
  BUSINESS_RESEARCH_EVALUATION_CORPUS,
  type BusinessResearchEvaluationActionStep,
  type BusinessResearchEvaluationCase,
  type BusinessResearchEvaluationCorpus,
  type BusinessResearchMonitorEvaluationCase,
  type BusinessResearchResearchEvaluationCase,
} from './cases.ts';

const FIXTURE_DECISION_LATENCY_MS = 2;
const FIXTURE_TOOL_LATENCY_MS = 5;

export interface BusinessResearchRatio {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface BusinessResearchEvaluationRunOptions {
  evaluatedAt?: string;
  corpus?: BusinessResearchEvaluationCorpus;
}

export interface BusinessResearchEvaluationMetrics {
  metadata: {
    mode: 'fixture';
    corpusVersion: number;
    modelVersion: 'scripted-fixture-v1';
    sourceVersion: 'fixed-public-snapshot-v1';
    evaluatedAt: string;
  };
  cases: { total: number; passed: number; failed: number; excluded: number };
  caseResults: Array<{
    id: string;
    passed: boolean;
    actualOutcome: string;
    expectedOutcome: string;
  }>;
  researchRuns: {
    expected: number;
    actual: number;
    unstarted: number;
    completed: number;
    partial: number;
    failed: number;
    cancelled: number;
  };
  monitoringChecks: { total: number; triggered: number; notTriggered: number; duplicateSignals: number };
  reports: { accepted: number; rejected: number; notAttempted: number };
  taskCompletion: BusinessResearchRatio;
  expectedOutcomeAccuracy: BusinessResearchRatio;
  toolSelectionAccuracy: BusinessResearchRatio;
  citations: {
    validity: BusinessResearchRatio;
    factualClaimCoverage: BusinessResearchRatio;
  };
  conflictDetection: BusinessResearchRatio;
  recovery: BusinessResearchRatio;
  automaticTrigger: { precision: BusinessResearchRatio; recall: BusinessResearchRatio };
  latency: {
    run: { sampleCount: number; p50: number | null; p95: number | null; max: number | null };
    tool: { sampleCount: number; p95: number | null };
  };
}

interface ResearchExecution {
  runtime: BusinessResearchRuntimeResult;
  runId: BusinessResearchRunId;
  elapsedMs: number;
  toolLatencySamples: number[];
  actionMatches: number;
  actionSamples: number;
  synthesis?: BusinessResearchSynthesisResult;
  reportDisposition: 'accepted' | 'rejected' | 'not_attempted';
  report?: BusinessResearchReport;
  passed: boolean;
}

/** Executes every fixture case against the real bounded runtime, report validator, and monitor evaluator. */
export async function evaluateBusinessResearchEvaluationCorpus(
  options: BusinessResearchEvaluationRunOptions = {},
): Promise<BusinessResearchEvaluationMetrics> {
  const corpus = options.corpus ?? BUSINESS_RESEARCH_EVALUATION_CORPUS;
  const evaluatedAt = normalizeTimestamp(options.evaluatedAt ?? new Date().toISOString());
  const clock = { value: Date.parse(evaluatedAt) };
  const toolLatencySamples: number[] = [];
  const runLatencySamples: number[] = [];
  const runStatuses = { completed: 0, partial: 0, failed: 0, cancelled: 0 };
  const reports = { accepted: 0, rejected: 0, notAttempted: 0 };
  const checks = { total: 0, triggered: 0, notTriggered: 0, duplicateSignals: 0 };
  const caseResults: BusinessResearchEvaluationMetrics['caseResults'] = [];
  const researchCases = corpus.cases.filter(isResearchCase);
  const expectedTriggers = corpus.cases.filter(isMonitorCase).filter((entry) => entry.expected.kind === 'trigger').length;
  const expectedResearchRuns = researchCases.length + expectedTriggers;
  let actualResearchRuns = 0;
  let normalTaskCompletionNumerator = 0;
  let normalTaskCompletionDenominator = 0;
  let expectedOutcomeNumerator = 0;
  let toolChoiceNumerator = 0;
  let toolChoiceDenominator = 0;
  let citationValidityNumerator = 0;
  let citationValidityDenominator = 0;
  let factualClaimCoverageNumerator = 0;
  let factualClaimCoverageDenominator = 0;
  let conflictNumerator = 0;
  let conflictDenominator = 0;
  let recoveryNumerator = 0;
  let recoveryDenominator = 0;
  let actualTriggerTruePositive = 0;

  for (const entry of corpus.cases) {
    if (isResearchCase(entry)) {
      const execution = await executeResearchCase(entry, clock);
      actualResearchRuns += 1;
      runStatuses[execution.runtime.outcome.status] += 1;
      runLatencySamples.push(execution.elapsedMs);
      toolLatencySamples.push(...execution.toolLatencySamples);
      toolChoiceNumerator += execution.actionMatches;
      toolChoiceDenominator += execution.actionSamples;
      recordReportDisposition(reports, execution.reportDisposition);
      if (execution.report !== undefined) {
        const citationMetrics = measureCitations(entry, execution.runtime.evidence, execution.report);
        citationValidityNumerator += citationMetrics.validCitationCount;
        citationValidityDenominator += citationMetrics.citationCount;
        factualClaimCoverageNumerator += citationMetrics.coveredFactCount;
        factualClaimCoverageDenominator += citationMetrics.factCount;
      }

      const outcomeMatches = researchOutcomeMatches(entry, execution);
      if (outcomeMatches) expectedOutcomeNumerator += 1;
      if (entry.expected.normalTaskCompletion) {
        normalTaskCompletionDenominator += 1;
        if (normalCompletionMatches(execution)) normalTaskCompletionNumerator += 1;
      }
      if (entry.expected.conflictExpected) {
        conflictDenominator += 1;
        if (hasExpectedConflict(execution)) conflictNumerator += 1;
      }
      if (entry.expected.recovery !== undefined) {
        recoveryDenominator += 1;
        if (recoveryMatches(entry, execution.runtime)) recoveryNumerator += 1;
      }

      caseResults.push({
        id: entry.id,
        passed: execution.passed,
        actualOutcome: `${execution.runtime.outcome.status}/${execution.reportDisposition}`,
        expectedOutcome: `${entry.expected.terminalStatus}/${entry.expected.report}`,
      });
      continue;
    }

    checks.total += 1;
    const decision = await evaluateBusinessResearchMonitorSignal(entry.input);
    const checkMatches = monitorDecisionMatches(entry, decision);
    let triggeredRunMatches = false;
    if (decision.kind === 'trigger') {
      checks.triggered += 1;
      if (entry.expected.kind === 'trigger' && checkMatches) {
        actualTriggerTruePositive += 1;
      }
      if (entry.triggeredRun !== undefined) {
        const followup = await executeResearchCase(entry.triggeredRun, clock);
        actualResearchRuns += 1;
        runStatuses[followup.runtime.outcome.status] += 1;
        runLatencySamples.push(followup.elapsedMs);
        toolLatencySamples.push(...followup.toolLatencySamples);
        toolChoiceNumerator += followup.actionMatches;
        toolChoiceDenominator += followup.actionSamples;
        recordReportDisposition(reports, followup.reportDisposition);
        if (followup.report !== undefined) {
          const citationMetrics = measureCitations(entry.triggeredRun, followup.runtime.evidence, followup.report);
          citationValidityNumerator += citationMetrics.validCitationCount;
          citationValidityDenominator += citationMetrics.citationCount;
          factualClaimCoverageNumerator += citationMetrics.coveredFactCount;
          factualClaimCoverageDenominator += citationMetrics.factCount;
        }
        const followupMatches = researchOutcomeMatches(entry.triggeredRun, followup);
        triggeredRunMatches = followupMatches;
        if (!followupMatches) {
          caseResults.push({
            id: entry.id,
            passed: false,
            actualOutcome: `${decision.kind}/${decision.reason}; follow-up ${followup.runtime.outcome.status}/${followup.reportDisposition}`,
            expectedOutcome: `${entry.expected.kind}/${entry.expected.reason}; follow-up ${entry.triggeredRun.expected.terminalStatus}/${entry.triggeredRun.expected.report}`,
          });
          continue;
        }
      }
    } else {
      checks.notTriggered += 1;
      if (decision.reason === 'duplicate_signal') checks.duplicateSignals += 1;
    }

    const followupMatches = entry.expected.kind === 'trigger'
      ? decision.kind === 'trigger' && entry.triggeredRun !== undefined && triggeredRunMatches
      : decision.kind === 'skip' && entry.triggeredRun === undefined;
    const passed = checkMatches && followupMatches;
    if (passed) expectedOutcomeNumerator += 1;
    caseResults.push({
      id: entry.id,
      passed,
      actualOutcome: decision.kind === 'trigger'
        ? `${decision.kind}/${decision.reason}`
        : `${decision.kind}/${decision.reason}`,
      expectedOutcome: entry.expected.kind === 'trigger'
        ? `${entry.expected.kind}/${entry.expected.reason}`
        : `${entry.expected.kind}/${entry.expected.reason}`,
    });
  }

  const passedCases = caseResults.filter((entry) => entry.passed).length;
  return {
    metadata: {
      mode: 'fixture',
      corpusVersion: corpus.version,
      modelVersion: 'scripted-fixture-v1',
      sourceVersion: 'fixed-public-snapshot-v1',
      evaluatedAt,
    },
    cases: { total: corpus.cases.length, passed: passedCases, failed: corpus.cases.length - passedCases, excluded: 0 },
    caseResults,
    researchRuns: {
      expected: expectedResearchRuns,
      actual: actualResearchRuns,
      unstarted: Math.max(0, expectedResearchRuns - actualResearchRuns),
      ...runStatuses,
    },
    monitoringChecks: checks,
    reports,
    taskCompletion: ratio(normalTaskCompletionNumerator, normalTaskCompletionDenominator),
    expectedOutcomeAccuracy: ratio(expectedOutcomeNumerator, corpus.cases.length),
    toolSelectionAccuracy: ratio(toolChoiceNumerator, toolChoiceDenominator),
    citations: {
      validity: ratio(citationValidityNumerator, citationValidityDenominator),
      factualClaimCoverage: ratio(factualClaimCoverageNumerator, factualClaimCoverageDenominator),
    },
    conflictDetection: ratio(conflictNumerator, conflictDenominator),
    recovery: ratio(recoveryNumerator, recoveryDenominator),
    automaticTrigger: {
      precision: ratio(actualTriggerTruePositive, checks.triggered),
      recall: ratio(actualTriggerTruePositive, expectedTriggers),
    },
    latency: {
      run: {
        sampleCount: runLatencySamples.length,
        p50: median(runLatencySamples),
        p95: nearestRankPercentile(runLatencySamples, 0.95),
        max: maximum(runLatencySamples),
      },
      tool: {
        sampleCount: toolLatencySamples.length,
        p95: nearestRankPercentile(toolLatencySamples, 0.95),
      },
    },
  };
}

/** Returns the arithmetic median (p50); empty samples are not applicable. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = sortedFinite(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Uses the nearest-rank definition: sorted[ceil(p * N) - 1]. */
export function nearestRankPercentile(values: readonly number[], percentile: number): number | null {
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError('Percentile must be greater than zero and no greater than one.');
  }
  if (values.length === 0) return null;
  const sorted = sortedFinite(values);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

async function executeResearchCase(
  entry: BusinessResearchResearchEvaluationCase,
  clock: { value: number },
): Promise<ResearchExecution> {
  const runId = requiredRunId(`evaluation-${entry.id.toLowerCase()}`);
  const reportId = requiredReportId(`evaluation-${entry.id.toLowerCase()}`);
  const toolLatencySamples: number[] = [];
  let decisionIndex = 0;
  let activeStep: BusinessResearchEvaluationActionStep | undefined;
  const decisionModel: DecisionModelPort = {
    async decide() {
      clock.value += FIXTURE_DECISION_LATENCY_MS;
      activeStep = entry.steps[decisionIndex];
      decisionIndex += 1;
      if (activeStep === undefined) throw new Error('Evaluation action script exhausted.');
      return activeStep.action;
    },
  };
  const tools: BusinessResearchToolPort = {
    async searchWeb(query) {
      const startedAt = clock.value;
      clock.value += FIXTURE_TOOL_LATENCY_MS;
      toolLatencySamples.push(clock.value - startedAt);
      if (activeStep?.action.kind !== 'search_web' || activeStep.action.query !== query) {
        throw fixtureError('FIXTURE_MISMATCH');
      }
      const result = activeStep.result;
      if (result === undefined || result.kind === 'failure') {
        throw fixtureError(result?.kind === 'failure' ? result.code : 'FIXTURE_MISSING_RESULT');
      }
      return [...result.evidence];
    },
    async openSource(evidenceId) {
      const startedAt = clock.value;
      clock.value += FIXTURE_TOOL_LATENCY_MS;
      toolLatencySamples.push(clock.value - startedAt);
      if (activeStep?.action.kind !== 'open_source' || activeStep.action.evidenceId !== evidenceId) {
        throw fixtureError('FIXTURE_MISMATCH');
      }
      const result = activeStep.result;
      if (result === undefined || result.kind === 'failure' || result.evidence.length !== 1) {
        throw fixtureError(result?.kind === 'failure' ? result.code : 'FIXTURE_MISSING_RESULT');
      }
      return result.evidence[0]!;
    },
  };

  const startedAt = clock.value;
  const runtime = await runBusinessResearch({
    runId,
    task: entry.input,
    decisionModel,
    tools,
    signal: new AbortController().signal,
    now: () => clock.value,
  });
  const elapsedMs = clock.value - startedAt;
  const actionSamples = Math.max(entry.steps.length, runtime.actions.length);
  let actionMatches = 0;
  for (let index = 0; index < entry.steps.length; index += 1) {
    const actual = runtime.actions[index];
    if (actual !== undefined && entry.steps[index]!.permittedActions.some((permitted) => sameAction(actual, permitted))) {
      actionMatches += 1;
    }
  }

  let synthesis: BusinessResearchSynthesisResult | undefined;
  if (runtime.outcome.status === 'completed' || runtime.outcome.status === 'partial') {
    synthesis = synthesizeBusinessResearchReport({
      reportId,
      runId,
      generatedAt: new Date(clock.value).toISOString(),
      outcome: runtime.outcome,
      evidence: runtime.evidence,
      draft: entry.reportDraft,
      allowedEvidenceIdsByClaim: entry.allowedEvidenceIdsByClaim,
    });
  }
  const reportDisposition = synthesis === undefined
    ? 'not_attempted'
    : synthesis.ok ? 'accepted' : 'rejected';
  const report = synthesis?.ok ? synthesis.report : undefined;
  const syntheticMatch = synthesisMatchesExpectation(entry, runtime, synthesis);
  const passed =
    runtime.outcome.status === entry.expected.terminalStatus &&
    reportDisposition === entry.expected.report &&
    syntheticMatch &&
    (!entry.expected.normalTaskCompletion || normalCompletionReport(report)) &&
    (entry.expected.conflictExpected === hasExpectedConflict({ runtime, report })) &&
    (entry.expected.expectedCitationGrade === undefined || reportHasGrade(report, entry.expected.expectedCitationGrade)) &&
    (entry.expected.recovery === undefined || recoveryMatches(entry, runtime)) &&
    actionMatches === actionSamples;

  return {
    runtime,
    runId,
    elapsedMs,
    toolLatencySamples,
    actionMatches,
    actionSamples,
    synthesis,
    reportDisposition,
    report,
    passed,
  };
}

function synthesisMatchesExpectation(
  entry: BusinessResearchResearchEvaluationCase,
  runtime: BusinessResearchRuntimeResult,
  synthesis: BusinessResearchSynthesisResult | undefined,
): boolean {
  if (entry.expected.report === 'not_attempted') return synthesis === undefined;
  if (entry.expected.report === 'rejected') {
    return synthesis !== undefined && !synthesis.ok &&
      (entry.expected.reportOutcome === undefined || runtime.outcome.status === entry.expected.reportOutcome);
  }
  if (synthesis === undefined || !synthesis.ok) return false;
  return entry.expected.reportOutcome === undefined || synthesis.report.status === entry.expected.reportOutcome;
}

function researchOutcomeMatches(entry: BusinessResearchResearchEvaluationCase, execution: ResearchExecution): boolean {
  return execution.runtime.outcome.status === entry.expected.terminalStatus && execution.passed;
}

function normalCompletionMatches(execution: ResearchExecution): boolean {
  return execution.runtime.outcome.status === 'completed' &&
    execution.reportDisposition === 'accepted' &&
    normalCompletionReport(execution.report);
}

function normalCompletionReport(report: BusinessResearchReport | undefined): boolean {
  return report !== undefined && report.status === 'completed' && report.title.length > 0 &&
    report.evidence.length > 0 && report.monitoringActions.length > 0 &&
    report.claims.some((claim) => claim.kind === 'supported' && claim.evidenceIds.length > 0);
}

function reportHasGrade(report: BusinessResearchReport | undefined, grade: 'search_excerpt' | 'page_text'): boolean {
  return report !== undefined && report.evidence.length > 0 && report.evidence.every((item) => item.grade === grade);
}

function hasExpectedConflict(execution: { runtime: BusinessResearchRuntimeResult; report?: BusinessResearchReport }): boolean {
  return execution.report?.claims.some((claim) =>
    claim.kind === 'conflicted' &&
    claim.supportingEvidenceIds.length > 0 &&
    claim.contradictingEvidenceIds.length > 0 &&
    claim.supportingEvidenceIds.every((id) => !claim.contradictingEvidenceIds.includes(id)) &&
    claim.supportingEvidenceIds.every((id) => execution.runtime.evidence.some((item) => item.id === id)) &&
    claim.contradictingEvidenceIds.every((id) => execution.runtime.evidence.some((item) => item.id === id)),
  ) ?? false;
}

function recoveryMatches(entry: BusinessResearchResearchEvaluationCase, runtime: BusinessResearchRuntimeResult): boolean {
  const failureCount = runtime.observations.filter((observation) => observation.kind === 'tool_failure').length;
  const hasUniqueEvidence = new Set(runtime.evidence.map((item) => item.id)).size === runtime.evidence.length;
  if (!hasUniqueEvidence || failureCount === 0) return false;
  if (entry.expected.recovery === 'recovered') {
    const toolActions = runtime.actions.filter((action) => action.kind !== 'finish');
    const failedIndex = runtime.observations.findIndex((observation) =>
      observation.kind === 'tool_failure' && observation.actionKind === 'search_web',
    );
    const recoveredIndex = runtime.observations.findIndex((observation, index) =>
      index > failedIndex && observation.kind === 'search_results' && observation.evidence.length > 0,
    );
    const failedAction = toolActions[failedIndex];
    const recoveredAction = toolActions[recoveredIndex];
    return runtime.outcome.status === 'completed' &&
      failedIndex >= 0 &&
      recoveredIndex > failedIndex &&
      failedAction?.kind === 'search_web' &&
      recoveredAction?.kind === 'search_web' &&
      failedAction.query !== recoveredAction.query;
  }
  if (entry.expected.recovery === 'partial') {
    return runtime.outcome.status === 'partial' && runtime.evidence.length > 0 && failureCount >= 3;
  }
  return runtime.outcome.status === 'failed' && runtime.evidence.length === 0 && failureCount >= 3;
}

function measureCitations(
  entry: BusinessResearchResearchEvaluationCase,
  persistedEvidence: readonly BusinessResearchEvidence[],
  report: BusinessResearchReport,
): { citationCount: number; validCitationCount: number; factCount: number; coveredFactCount: number } {
  const evidenceById = new Map(persistedEvidence.map((item) => [item.id, item]));
  let citationCount = 0;
  let validCitationCount = 0;
  let factCount = 0;
  let coveredFactCount = 0;

  for (const claim of report.claims) {
    if (claim.kind === 'unresolved') continue;
    factCount += 1;
    const evidenceIds = claimEvidenceIds(claim);
    let allValid = evidenceIds.length > 0;
    for (const evidenceId of evidenceIds) {
      citationCount += 1;
      const item = evidenceById.get(evidenceId);
      const allowedIds = entry.allowedEvidenceIdsByClaim[claim.id] ?? [];
      const valid = item !== undefined &&
        isValidPublicEvidenceUrl(item.url) &&
        isBusinessResearchSourceKind(item.sourceKind) &&
        isBusinessResearchEvidenceGrade(item.grade) &&
        allowedIds.includes(evidenceId);
      if (valid) validCitationCount += 1;
      else allValid = false;
    }
    if (allValid) coveredFactCount += 1;
  }

  return { citationCount, validCitationCount, factCount, coveredFactCount };
}

function claimEvidenceIds(claim: BusinessResearchClaim): BusinessResearchEvidenceId[] {
  if (claim.kind === 'supported') return [...claim.evidenceIds];
  if (claim.kind === 'conflicted') return [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds];
  return [];
}

function isValidPublicEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0 && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function monitorDecisionMatches(
  entry: BusinessResearchMonitorEvaluationCase,
  decision: Awaited<ReturnType<typeof evaluateBusinessResearchMonitorSignal>>,
): boolean {
  if (decision.kind !== entry.expected.kind || decision.kind !== 'trigger' && 'reason' in entry.expected && decision.reason !== entry.expected.reason) {
    return false;
  }
  if (decision.kind === 'trigger') {
    return entry.expected.kind === 'trigger' &&
      decision.reason === entry.expected.reason &&
      decision.url === entry.expected.url &&
      /^signal-[a-f0-9]{64}$/u.test(decision.fingerprint);
  }
  return entry.expected.kind === 'skip' && decision.reason === entry.expected.reason;
}

function isResearchCase(entry: BusinessResearchEvaluationCase): entry is BusinessResearchResearchEvaluationCase {
  return entry.kind === 'research';
}

function isMonitorCase(entry: BusinessResearchEvaluationCase): entry is BusinessResearchMonitorEvaluationCase {
  return entry.kind === 'monitor';
}

function sameAction(left: BusinessResearchAction, right: BusinessResearchAction): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'search_web' && right.kind === 'search_web') {
    return left.taskId === right.taskId && left.query === right.query;
  }
  if (left.kind === 'open_source' && right.kind === 'open_source') {
    return left.evidenceId === right.evidenceId;
  }
  return left.kind === 'finish' && right.kind === 'finish' && left.rationale === right.rationale;
}

function ratio(numerator: number, denominator: number): BusinessResearchRatio {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator };
}

function recordReportDisposition(
  counts: BusinessResearchEvaluationMetrics['reports'],
  disposition: ResearchExecution['reportDisposition'],
): void {
  if (disposition === 'not_attempted') counts.notAttempted += 1;
  else counts[disposition] += 1;
}

function sortedFinite(values: readonly number[]): number[] {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError('Metric samples must be finite numbers.');
  return [...values].sort((left, right) => left - right);
}

function maximum(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError('Evaluation timestamp must be a valid date.');
  return new Date(timestamp).toISOString();
}

function requiredRunId(value: string): BusinessResearchRunId {
  const id = parseBusinessResearchId('run', value);
  if (id === undefined) throw new Error('Invalid evaluation run identifier.');
  return id;
}

function requiredReportId(value: string): BusinessResearchReportId {
  const id = parseBusinessResearchId('report', value);
  if (id === undefined) throw new Error('Invalid evaluation report identifier.');
  return id;
}

function fixtureError(code: string): Error & { code: string } {
  return Object.assign(new Error('Evaluation fixture did not match the requested tool action.'), { code });
}
