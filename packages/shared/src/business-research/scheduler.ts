import { createHash } from 'node:crypto';
import {
  parseBusinessResearchId,
  type BusinessResearchIdKind,
  type BusinessResearchRunId,
  type BusinessResearchSubscriptionId,
} from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import { BusinessResearchRepository, type BusinessResearchCheckRecord, type BusinessResearchSubscriptionRecord } from './repository.ts';
import {
  evaluateBusinessResearchMonitorSignal,
  type BusinessResearchMonitorSignalDecision,
  type BusinessResearchMonitorSourceSnapshot,
} from './monitor-signals.ts';
import { BusinessResearchService } from './service.ts';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const sharedSubscriptionLocks = new Map<string, Promise<void>>();

export interface BusinessResearchMonitorProbeInput {
  subscription: BusinessResearchSubscriptionRecord;
  query: string;
  signal: AbortSignal;
}

export interface BusinessResearchSchedulerOptions {
  probe: (input: BusinessResearchMonitorProbeInput) => Promise<BusinessResearchMonitorSourceSnapshot[]>;
  now?: () => number;
  idFactory?: (kind: BusinessResearchIdKind, sequence: number) => string;
}

/** Checks due topic subscriptions, persisting every trigger, skip, and failure outcome. */
export class BusinessResearchScheduler {
  private readonly repository: BusinessResearchRepository;
  private readonly service: BusinessResearchService;
  private readonly options: BusinessResearchSchedulerOptions;
  private readonly now: () => number;
  private readonly idFactory: (kind: BusinessResearchIdKind, sequence: number) => string;
  private readonly inFlight = new Map<BusinessResearchSubscriptionId, Promise<BusinessResearchCheckRecord | undefined>>();
  private readonly probeControllers = new Set<AbortController>();
  private sequence = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    repository: BusinessResearchRepository,
    service: BusinessResearchService,
    options: BusinessResearchSchedulerOptions,
  ) {
    this.repository = repository;
    this.service = service;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? ((kind) => `${kind}-monitor-${crypto.randomUUID()}`);
  }

  /** Starts an in-process poller and performs one immediate overdue catch-up. */
  start(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS): void {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_POLL_INTERVAL', 'Monitor poll interval must be at least one second.');
    }
    if (this.timer !== undefined) return;
    void this.checkDue().catch(() => undefined);
    this.timer = setInterval(() => { void this.checkDue().catch(() => undefined); }, pollIntervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.probeControllers) controller.abort();
  }

  async dispose(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  async checkDue(): Promise<BusinessResearchCheckRecord[]> {
    const due = (await this.repository.listSubscriptions())
      .filter((subscription) => subscription.enabled && subscription.nextCheckAt <= this.now());
    const checks = await Promise.all(due.map((subscription) => this.checkSubscription(subscription.id)));
    return checks.filter(isDefined);
  }

  private checkSubscription(
    subscriptionId: BusinessResearchSubscriptionId,
  ): Promise<BusinessResearchCheckRecord | undefined> {
    const existing = this.inFlight.get(subscriptionId);
    if (existing !== undefined) return existing;
    const pending = withSubscriptionLock(subscriptionId, () => this.checkOne(subscriptionId));
    this.inFlight.set(subscriptionId, pending);
    void pending.then(
      () => { if (this.inFlight.get(subscriptionId) === pending) this.inFlight.delete(subscriptionId); },
      () => { if (this.inFlight.get(subscriptionId) === pending) this.inFlight.delete(subscriptionId); },
    );
    return pending;
  }

  private async checkOne(
    subscriptionId: BusinessResearchSubscriptionId,
  ): Promise<BusinessResearchCheckRecord | undefined> {
    const subscription = await this.repository.getSubscription(subscriptionId);
    const startedAt = this.now();
    if (subscription === undefined || !subscription.enabled || subscription.nextCheckAt > startedAt) return undefined;

    const abortController = new AbortController();
    this.probeControllers.add(abortController);
    let sources: BusinessResearchMonitorSourceSnapshot[] = [];
    let probeSucceeded = false;
    try {
      sources = await this.options.probe({
        subscription,
        query: buildMonitorProbeQuery(subscription),
        signal: abortController.signal,
      });
      probeSucceeded = true;
    } catch {
      // Persist a coarse failure reason only; do not serialize remote error bodies.
    } finally {
      this.probeControllers.delete(abortController);
    }
    if (abortController.signal.aborted) return undefined;

    const previousSources = await this.repository.getMonitorSources(subscriptionId);
    let decision: BusinessResearchMonitorSignalDecision = probeSucceeded
      ? await evaluateBusinessResearchMonitorSignal({
          subscriptionId,
          topic: subscription.task.question,
          industry: subscription.task.industry,
          competitors: subscription.task.competitors,
          previousSources,
          currentSources: sources,
        })
      : { kind: 'skip', reason: 'check_failed' };
    let runId: BusinessResearchRunId | undefined;

    if (probeSucceeded && decision.kind === 'trigger') {
      const currentSubscription = await this.repository.getSubscription(subscriptionId);
      if (currentSubscription === undefined || !currentSubscription.enabled) {
        decision = { kind: 'skip', reason: 'subscription_disabled' };
      } else {
        const existingReservation = await this.repository.getFingerprintRun(subscriptionId, decision.fingerprint);
        let reservedRunId: BusinessResearchRunId;
        if (existingReservation === undefined) {
          const candidate = this.createId('run') as BusinessResearchRunId;
          const reservation = await this.repository.reserveFingerprint(subscriptionId, decision.fingerprint, candidate);
          reservedRunId = reservation.reserved ? candidate : reservation.existingRunId;
        } else {
          reservedRunId = existingReservation;
        }
        const existingRun = await this.service.getRun(reservedRunId);
        if (existingRun !== undefined && isTerminal(existingRun.state)) {
          decision = { kind: 'skip', reason: 'duplicate_signal' };
        } else {
          runId = reservedRunId;
          if (existingRun === undefined) {
            try {
              await this.service.start(subscription.task, { runId: reservedRunId });
            } catch {
              decision = { kind: 'skip', reason: 'check_failed' };
              runId = undefined;
            }
          }
        }
      }
    }

    const completedAt = this.now();
    const check: BusinessResearchCheckRecord = {
      id: createCheckId(subscriptionId, subscription.nextCheckAt),
      subscriptionId,
      startedAt,
      completedAt,
      decision,
      ...(runId === undefined ? {} : { runId }),
    };
    await this.repository.appendCheck(check);
    if (probeSucceeded) await this.repository.saveMonitorSources(subscriptionId, sources);
    const latestSubscription = await this.repository.getSubscription(subscriptionId);
    if (latestSubscription !== undefined) {
      await this.repository.saveSubscription({
        ...latestSubscription,
        updatedAt: completedAt,
        lastCheckAt: completedAt,
        nextCheckAt: completedAt + latestSubscription.intervalMs,
      });
    }
    return check;
  }

  private createId<Kind extends BusinessResearchIdKind>(kind: Kind): NonNullable<ReturnType<typeof parseBusinessResearchId<Kind>>> {
    const parsed = parseBusinessResearchId(kind, this.idFactory(kind, ++this.sequence));
    if (parsed === undefined) throw createCodeError('BUSINESS_RESEARCH_INVALID_ID', `Invalid generated ${kind} id.`);
    return parsed;
  }
}

export function buildMonitorProbeQuery(subscription: BusinessResearchSubscriptionRecord): string {
  return [
    subscription.task.question,
    subscription.task.industry,
    ...subscription.task.competitors,
    'latest public update',
  ].join(' ').replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function createCheckId(subscriptionId: BusinessResearchSubscriptionId, dueAt: number): NonNullable<ReturnType<typeof parseBusinessResearchId<'event'>>> {
  const hash = createHash('sha256').update(`${subscriptionId}\u0000${dueAt}`).digest('hex');
  const parsed = parseBusinessResearchId('event', `event-monitor-${hash}`);
  if (parsed === undefined) throw createCodeError('BUSINESS_RESEARCH_INVALID_ID', 'Unable to create monitor check id.');
  return parsed;
}

function isTerminal(state: { status: string }): boolean {
  return state.status === 'completed' || state.status === 'partial' || state.status === 'failed' || state.status === 'cancelled';
}

async function withSubscriptionLock<T>(subscriptionId: BusinessResearchSubscriptionId, action: () => Promise<T>): Promise<T> {
  const key = subscriptionId as string;
  const previous = sharedSubscriptionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  sharedSubscriptionLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (sharedSubscriptionLocks.get(key) === current) sharedSubscriptionLocks.delete(key);
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
