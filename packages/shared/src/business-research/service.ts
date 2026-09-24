import { randomUUID } from 'node:crypto';
import {
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchEvidence,
  type BusinessResearchIdKind,
  type BusinessResearchObservation,
  type BusinessResearchReportId,
  type BusinessResearchRunId,
  isBusinessResearchRunMode,
  type BusinessResearchRunMode,
  type BusinessResearchRunState,
  type BusinessResearchSubscriptionId,
  type BusinessResearchTaskInput,
  type BusinessResearchTerminalOutcome,
} from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import { BusinessResearchRepository, type BusinessResearchRunRecord, type BusinessResearchSubscriptionRecord } from './repository.ts';
import { createBusinessResearchEventLog, type BusinessResearchEvent } from './events.ts';
import { replayBusinessResearchEvents } from './replay.ts';
import { runBusinessResearch, type BusinessResearchRuntimeLimits } from './runtime.ts';
import type { BusinessResearchToolPort, DecisionModelPort } from './core.ts';
import { synthesizeBusinessResearchReport, type BusinessResearchReport } from './synthesis.ts';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_SUBSCRIPTION_INTERVAL_MS = 60 * 60 * 1_000;

export interface BusinessResearchReportGenerationInput {
  runId: BusinessResearchRunId;
  task: BusinessResearchTaskInput;
  mode: BusinessResearchRunMode;
  evidence: readonly BusinessResearchEvidence[];
  outcome: BusinessResearchTerminalOutcome;
  signal: AbortSignal;
}

export interface BusinessResearchServiceOptions {
  createDecisionModel: (runId: BusinessResearchRunId, task: BusinessResearchTaskInput, mode: BusinessResearchRunMode) => DecisionModelPort;
  createTools: (runId: BusinessResearchRunId, task: BusinessResearchTaskInput, mode: BusinessResearchRunMode) => BusinessResearchToolPort;
  generateReport: (input: BusinessResearchReportGenerationInput) => Promise<unknown>;
  now?: () => number;
  idFactory?: (kind: BusinessResearchIdKind, sequence: number) => string;
  runtimeLimits?: Partial<BusinessResearchRuntimeLimits>;
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<void>;
}

/** Owns run lifecycle and recovery while keeping model, tools, and persistence replaceable. */
export class BusinessResearchService {
  private readonly repository: BusinessResearchRepository;
  private readonly options: BusinessResearchServiceOptions;
  private readonly now: () => number;
  private readonly idFactory: (kind: BusinessResearchIdKind, sequence: number) => string;
  private readonly activeRuns = new Map<BusinessResearchRunId, ActiveRun>();
  private sequence = 0;
  private recoveryPromise?: Promise<void>;

  constructor(repository: BusinessResearchRepository, options: BusinessResearchServiceOptions) {
    this.repository = repository;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? ((kind) => `${kind}-${randomUUID()}`);
  }

  async start(
    value: unknown,
    options: { runId?: BusinessResearchRunId; mode?: BusinessResearchRunMode } = {},
  ): Promise<BusinessResearchRunRecord> {
    await this.ensureRecovered();
    const normalized = normalizeBusinessResearchInput(value);
    if (!normalized.ok) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_INPUT', 'Invalid business research input.');
    }
    const mode = options.mode ?? 'live';
    if (!isBusinessResearchRunMode(mode)) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_MODE', 'Business research mode must be live or fixture.');
    }
    const runId = options.runId ?? this.createId('run');
    const active = this.activeRuns.get(runId);
    if (active !== undefined) {
      const current = await this.repository.getRun(runId);
      if (current !== undefined) return current;
    }
    const existing = await this.repository.getRun(runId);
    if (existing !== undefined) return existing;

    const timestamp = this.now();
    const record: BusinessResearchRunRecord = {
      id: runId,
      task: normalized.value,
      mode,
      state: { status: 'queued', updatedAt: isoTime(timestamp) },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveRun(record);
    const controller = new AbortController();
    const promise = this.execute(record, controller.signal).finally(() => {
      this.activeRuns.delete(runId);
    });
    this.activeRuns.set(runId, { controller, promise });
    void promise.catch(() => undefined);
    return structuredClone(record);
  }

  async cancel(runId: BusinessResearchRunId): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return false;
    active.controller.abort();
    await active.promise;
    return true;
  }

  async waitForRun(runId: BusinessResearchRunId): Promise<BusinessResearchRunRecord | undefined> {
    await this.activeRuns.get(runId)?.promise;
    return this.repository.getRun(runId);
  }

  async listEvents(runId: BusinessResearchRunId): Promise<BusinessResearchEvent[]> {
    await this.ensureRecovered();
    return this.repository.getEvents(runId);
  }

  /** Stop all active work before the owning application shuts down. */
  async dispose(): Promise<void> {
    const active = [...this.activeRuns.values()];
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
  }

  async getRun(runId: BusinessResearchRunId): Promise<BusinessResearchRunRecord | undefined> {
    await this.ensureRecovered();
    return this.repository.getRun(runId);
  }

  async listRuns(): Promise<BusinessResearchRunRecord[]> {
    await this.ensureRecovered();
    return this.repository.listRuns();
  }

  async getReport(reportId: BusinessResearchReportId): Promise<BusinessResearchReport | undefined> {
    await this.ensureRecovered();
    return this.repository.getReport(reportId);
  }

  async listReports(): Promise<BusinessResearchReport[]> {
    await this.ensureRecovered();
    return this.repository.listReports();
  }

  async subscribe(
    value: unknown,
    options: { intervalMs?: number } = {},
  ): Promise<BusinessResearchSubscriptionRecord> {
    const normalized = normalizeBusinessResearchInput(value);
    if (!normalized.ok) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_INPUT', 'Invalid business research subscription input.');
    }
    const intervalMs = options.intervalMs ?? DAY_MS;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_SUBSCRIPTION_INTERVAL_MS) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_INTERVAL', 'Monitoring interval must be at least one hour.');
    }
    const now = this.now();
    const record: BusinessResearchSubscriptionRecord = {
      id: this.createId('subscription') as BusinessResearchSubscriptionId,
      task: normalized.value,
      intervalMs,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextCheckAt: now + intervalMs,
    };
    await this.repository.saveSubscription(record);
    return structuredClone(record);
  }

  async unsubscribe(subscriptionId: BusinessResearchSubscriptionId): Promise<BusinessResearchSubscriptionRecord | undefined> {
    const current = await this.repository.getSubscription(subscriptionId);
    if (current === undefined) return undefined;
    if (current.removedAt !== undefined) return current;
    if (!current.enabled) return current;
    const disabled = { ...current, enabled: false, updatedAt: this.now() };
    await this.repository.saveSubscription(disabled);
    return structuredClone(disabled);
  }

  async resumeSubscription(subscriptionId: BusinessResearchSubscriptionId): Promise<BusinessResearchSubscriptionRecord | undefined> {
    const current = await this.repository.getSubscription(subscriptionId);
    if (current === undefined || current.removedAt !== undefined) return undefined;
    if (current.enabled) return current;
    const now = this.now();
    const resumed = { ...current, enabled: true, updatedAt: now, nextCheckAt: now + current.intervalMs };
    await this.repository.saveSubscription(resumed);
    return structuredClone(resumed);
  }

  async removeSubscription(subscriptionId: BusinessResearchSubscriptionId): Promise<BusinessResearchSubscriptionRecord | undefined> {
    const current = await this.repository.getSubscription(subscriptionId);
    if (current === undefined) return undefined;
    if (current.removedAt !== undefined) return current;
    const now = this.now();
    const removed = { ...current, enabled: false, updatedAt: now, removedAt: now };
    await this.repository.saveSubscription(removed);
    return structuredClone(removed);
  }

  async listSubscriptions(): Promise<BusinessResearchSubscriptionRecord[]> {
    return (await this.repository.listSubscriptions()).filter((subscription) => subscription.removedAt === undefined);
  }

  private async execute(record: BusinessResearchRunRecord, signal: AbortSignal): Promise<void> {
    let current = record;
    let pendingTerminal: BusinessResearchEvent | undefined;
    let reportId: BusinessResearchReportId | undefined;
    let finalOutcome: BusinessResearchTerminalOutcome | undefined;
    try {
      const runtimeResult = await runBusinessResearch({
        runId: record.id,
        task: record.task,
        decisionModel: this.options.createDecisionModel(record.id, record.task, record.mode ?? 'live'),
        tools: this.options.createTools(record.id, record.task, record.mode ?? 'live'),
        signal,
        now: this.now,
        limits: this.options.runtimeLimits,
        onEvent: async (event) => {
          if (event.type === 'run_terminal') {
            pendingTerminal = event;
            return;
          }
          await this.persistRuntimeEvent(current, event, (updated) => { current = updated; });
        },
      });

      await this.repository.saveEvidence(record.id, runtimeResult.evidence);
      finalOutcome = runtimeResult.outcome;
      if (finalOutcome.status === 'completed' || finalOutcome.status === 'partial') {
        try {
          const draft = await this.options.generateReport({
          runId: record.id,
          task: record.task,
          mode: record.mode ?? 'live',
            evidence: runtimeResult.evidence,
            outcome: finalOutcome,
            signal,
          });
          const generatedId = this.createId('report') as BusinessResearchReportId;
          const result = synthesizeBusinessResearchReport({
            reportId: generatedId,
            runId: record.id,
            generatedAt: isoTime(this.now()),
            outcome: finalOutcome,
            evidence: runtimeResult.evidence,
            draft,
          });
          if (!result.ok) throw new Error('Report synthesis did not pass evidence validation.');
          await this.repository.saveReport(result.report);
          reportId = result.report.id;
          if (result.report.status === 'partial' && finalOutcome.status === 'completed') {
            finalOutcome = {
              status: 'partial',
              reason: result.report.partialReason ?? 'The report contains unresolved findings.',
            };
          }
        } catch {
          finalOutcome = signal.aborted
            ? { status: 'cancelled' }
            : { status: 'failed', code: 'REPORT_SYNTHESIS_FAILED' };
          reportId = undefined;
        }
      }

      const terminal = pendingTerminal ?? runtimeResult.events[runtimeResult.events.length - 1];
      if (terminal?.type === 'run_terminal') {
        await this.repository.appendEvent({ ...terminal, outcome: finalOutcome ?? terminal.outcome });
      }
      current = {
        ...current,
        state: stateFromOutcome(finalOutcome ?? runtimeResult.outcome, this.now()),
        updatedAt: this.now(),
        ...(reportId === undefined ? {} : { reportId }),
      };
      await this.repository.saveRun(current);
    } catch (error) {
      const failure = { status: 'failed', code: safeErrorCode(error) } as const;
      try {
        const events = await this.repository.getEvents(record.id);
        const last = events[events.length - 1];
        if (last?.type !== 'run_terminal') {
          if (events.length === 0) {
            const log = createBusinessResearchEventLog(record.id, this.now);
            await this.repository.appendEvent(log.append({ type: 'run_started', task: record.task, mode: record.mode ?? 'live' }));
          }
          const prefix = await this.repository.getEvents(record.id);
          await this.repository.appendEvent({
            runId: record.id,
            sequence: prefix.length + 1,
            timestamp: this.now(),
            type: 'run_terminal',
            outcome: failure,
          });
        }
        const terminalEvents = await this.repository.getEvents(record.id);
        const terminal = terminalEvents[terminalEvents.length - 1];
        const outcome = terminal?.type === 'run_terminal' ? terminal.outcome : failure;
        current = {
          ...current,
          state: stateFromOutcome(outcome, this.now()),
          updatedAt: this.now(),
          ...(reportId === undefined ? {} : { reportId }),
        };
        await this.repository.saveRun(current);
      } catch {
        // The atomic store retains its last good checkpoint; startup recovery will reconcile it later.
      }
    }
  }

  private async persistRuntimeEvent(
    current: BusinessResearchRunRecord,
    event: BusinessResearchEvent,
    update: (record: BusinessResearchRunRecord) => void,
  ): Promise<void> {
    const persistedEvent = event.type === 'run_started'
      ? { ...event, mode: current.mode ?? 'live' }
      : event;
    await this.repository.appendEvent(persistedEvent);
    if (event.type === 'observation_recorded') {
      const evidence = evidenceFromObservation(event.observation);
      if (evidence.length > 0) await this.repository.saveEvidence(current.id, evidence);
    }
    const timestamp = event.timestamp;
    const nextState = event.type === 'phase_changed'
      ? { status: event.status, updatedAt: isoTime(timestamp) } as BusinessResearchRunState
      : { ...current.state, updatedAt: isoTime(timestamp) } as BusinessResearchRunState;
    const next = { ...current, state: nextState, updatedAt: timestamp };
    await this.repository.saveRun(next);
    update(next);
  }

  private async ensureRecovered(): Promise<void> {
    if (this.recoveryPromise === undefined) {
      this.recoveryPromise = this.recoverRuns().catch((error: unknown) => {
        this.recoveryPromise = undefined;
        throw error;
      });
    }
    await this.recoveryPromise;
  }

  private async recoverRuns(): Promise<void> {
    for (const runId of await this.repository.listRunIds()) {
      if (this.activeRuns.has(runId)) continue;
      let record: BusinessResearchRunRecord | undefined;
      try {
        record = await this.repository.getRun(runId);
      } catch (error) {
        if (!hasErrorCode(error, 'BUSINESS_RESEARCH_CORRUPT_RECORD')) throw error;
      }
      let events = await this.repository.getEvents(runId);
      if (events.length === 0 && record !== undefined) {
        const log = createBusinessResearchEventLog(runId, this.now);
        await this.repository.appendEvent(log.append({ type: 'run_started', task: record.task, mode: record.mode ?? 'live' }));
        events = await this.repository.getEvents(runId);
      }
      const replay = replayBusinessResearchEvents(events);
      if (!replay.ok) throw createCodeError('BUSINESS_RESEARCH_CORRUPT_EVENT_LOG', 'The business research event log cannot be recovered.');
      const task = replay.state.task ?? record?.task;
      if (task === undefined) continue;
      const startedAt = events.find((event) => event.type === 'run_started')?.timestamp ?? record?.createdAt ?? this.now();
      const mode = events.find((event) => event.type === 'run_started')?.mode ?? record?.mode ?? 'live';
      const recordedReport = (await this.repository.listReports()).find((candidate) => candidate.runId === runId);
      let outcome = replay.state.outcome ?? (record !== undefined && isTerminalState(record.state)
        ? outcomeFromState(record.state)
        : { status: 'failed', code: 'INTERRUPTED_RESTART' as const });
      if (replay.state.outcome === undefined) {
        const prefix = await this.repository.getEvents(runId);
        if (prefix[prefix.length - 1]?.type !== 'run_terminal') {
          await this.repository.appendEvent({
            runId,
            sequence: prefix.length + 1,
            timestamp: this.now(),
            type: 'run_terminal',
            outcome,
          });
        }
      }
      const allEvents = await this.repository.getEvents(runId);
      const finalReplay = replayBusinessResearchEvents(allEvents);
      if (finalReplay.ok && finalReplay.state.outcome !== undefined) outcome = finalReplay.state.outcome;
      const evidence = finalReplay.ok ? evidenceFromObservations(finalReplay.state.observations) : [];
      if (evidence.length > 0) await this.repository.saveEvidence(runId, evidence);
      const finalTimestamp = allEvents[allEvents.length - 1]?.timestamp ?? this.now();
      const recovered: BusinessResearchRunRecord = {
        id: runId,
        task,
        mode,
        state: stateFromOutcome(outcome, finalTimestamp),
        createdAt: startedAt,
        updatedAt: finalTimestamp,
        ...(recordedReport === undefined ? record?.reportId === undefined ? {} : { reportId: record.reportId } : { reportId: recordedReport.id }),
      };
      await this.repository.saveRun(recovered);
    }
  }

  private createId<Kind extends BusinessResearchIdKind>(kind: Kind): NonNullable<ReturnType<typeof parseBusinessResearchId<Kind>>> {
    const value = this.idFactory(kind, ++this.sequence);
    const parsed = parseBusinessResearchId(kind, value);
    if (parsed === undefined) throw createCodeError('BUSINESS_RESEARCH_INVALID_ID', `Invalid generated ${kind} id.`);
    return parsed;
  }
}

function evidenceFromObservation(observation: BusinessResearchObservation): BusinessResearchEvidence[] {
  if (observation.kind === 'search_results') return observation.evidence;
  if (observation.kind === 'source_opened') return [observation.evidence];
  return [];
}

function evidenceFromObservations(observations: readonly BusinessResearchObservation[]): BusinessResearchEvidence[] {
  const byId = new Map<string, BusinessResearchEvidence>();
  for (const observation of observations) {
    for (const item of evidenceFromObservation(observation)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function stateFromOutcome(outcome: BusinessResearchTerminalOutcome, timestamp: number): BusinessResearchRunState {
  const completedAt = isoTime(timestamp);
  if (outcome.status === 'completed') return { status: 'completed', completedAt };
  if (outcome.status === 'partial') return { status: 'partial', completedAt, reason: outcome.reason };
  if (outcome.status === 'failed') return { status: 'failed', completedAt, code: outcome.code };
  return { status: 'cancelled', completedAt, reason: outcome.reason };
}

function outcomeFromState(state: BusinessResearchRunState): BusinessResearchTerminalOutcome {
  if (state.status === 'completed') return { status: 'completed' };
  if (state.status === 'partial') return { status: 'partial', reason: state.reason };
  if (state.status === 'failed') return { status: 'failed', code: state.code };
  if (state.status === 'cancelled') return { status: 'cancelled', reason: state.reason };
  return { status: 'failed', code: 'INTERRUPTED_RESTART' };
}

function isTerminalState(state: BusinessResearchRunState): boolean {
  return state.status === 'completed' || state.status === 'partial' || state.status === 'failed' || state.status === 'cancelled';
}

function isoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === 'object' && error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    /^[A-Z0-9_]{1,64}$/u.test((error as { code: string }).code)
  ) return (error as { code: string }).code;
  return 'RUN_EXECUTION_FAILED';
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
