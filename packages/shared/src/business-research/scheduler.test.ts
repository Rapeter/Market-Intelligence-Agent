import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeBusinessResearchInput, type BusinessResearchTaskInput } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { BusinessResearchRepository } from './repository.ts';
import { BusinessResearchService } from './service.ts';
import { BusinessResearchScheduler, type BusinessResearchMonitorProbeInput } from './scheduler.ts';
import type { BusinessResearchMonitorSourceSnapshot } from './monitor-signals.ts';

const HOUR = 60 * 60 * 1_000;

function taskInput(): BusinessResearchTaskInput {
  const normalized = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare public product updates',
    competitors: ['Northstar Motors', 'Harbor Auto'],
    strategyId: 'change_risk_tracking',
  });
  if (!normalized.ok) throw new Error('Scheduler input should be valid');
  return normalized.value;
}

function source(contentFingerprint: string, summary = 'Northstar Motors announced an electric vehicle product update.') {
  return {
    url: 'https://public.example/northstar/updates',
    title: 'Northstar Motors public product update',
    summary,
    contentFingerprint,
    retrievedAt: '2026-09-24T00:00:00.000Z',
  } satisfies BusinessResearchMonitorSourceSnapshot;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(
  probe: (input: BusinessResearchMonitorProbeInput) => Promise<BusinessResearchMonitorSourceSnapshot[]>,
) {
  const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'market-research-scheduler-')));
  const repository = new BusinessResearchRepository(store);
  const clock = { now: Date.parse('2026-09-24T00:00:00.000Z') };
  let idSequence = 0;
  const service = new BusinessResearchService(repository, {
    createDecisionModel: () => ({
      async decide() { return { kind: 'finish', rationale: 'A monitor run records the new public signal.' }; },
    }),
    createTools: () => ({
      async searchWeb() { return []; },
      async openSource(evidenceId) { throw new Error(`Unexpected source open ${evidenceId}`); },
    }),
    async generateReport({ runId }) {
      return {
        title: 'Public signal follow-up',
        claims: [{
          kind: 'unresolved',
          id: `claim-${runId}`,
          question: 'What is the downstream effect of this signal?',
          reason: 'The public source does not establish the business impact.',
        }],
        monitoringActions: ['Recheck the source for a more specific announcement.'],
      };
    },
    now: () => clock.now,
    idFactory: (kind) => `${kind}-scheduler-${++idSequence}`,
  });
  const scheduler = new BusinessResearchScheduler(repository, service, {
    probe,
    now: () => clock.now,
    idFactory: (kind) => `${kind}-scheduler-${++idSequence}`,
  });
  return { repository, service, scheduler, clock };
}

describe('BusinessResearchScheduler', () => {
  it('starts one research run for a new relevant public source and persists the check', async () => {
    let probeQuery = '';
    const app = harness(async ({ query }) => {
      probeQuery = query;
      return [source('body-v1')];
    });
    const subscription = await app.service.subscribe(taskInput(), { intervalMs: HOUR });
    app.clock.now += HOUR;

    const checks = await app.scheduler.checkDue();

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ decision: { kind: 'trigger', reason: 'new_source' } });
    expect(checks[0]?.runId).toBeDefined();
    expect(probeQuery).toContain('Electric vehicles');
    expect(await app.repository.listChecks(subscription.id)).toEqual(checks);
    expect((await app.service.waitForRun(checks[0]!.runId!))?.state.status).toBe('partial');
    expect((await app.repository.getMonitorSources(subscription.id))[0]?.contentFingerprint).toBe('body-v1');
    expect((await app.repository.getSubscription(subscription.id))?.nextCheckAt).toBe(app.clock.now + HOUR);
  });

  it('triggers for material updates to a known page but never reruns a previously reserved fingerprint', async () => {
    let current = source('body-v2');
    const app = harness(async () => [current]);
    const subscription = await app.service.subscribe(taskInput(), { intervalMs: HOUR });
    await app.repository.saveMonitorSources(subscription.id, [source('body-v1')]);
    app.clock.now += HOUR;

    const first = await app.scheduler.checkDue();
    expect(first[0]?.decision).toMatchObject({ kind: 'trigger', reason: 'source_updated' });
    expect(first[0]?.runId).toBeDefined();
    await app.service.waitForRun(first[0]!.runId!);

    app.clock.now += HOUR;
    current = source('body-v1');
    const second = await app.scheduler.checkDue();
    expect(second[0]?.decision).toMatchObject({ kind: 'trigger', reason: 'source_updated' });
    expect(second[0]?.runId).toBeDefined();
    await app.service.waitForRun(second[0]!.runId!);

    app.clock.now += HOUR;
    current = source('body-v2');
    const repeated = await app.scheduler.checkDue();
    expect(repeated[0]?.decision).toEqual({ kind: 'skip', reason: 'duplicate_signal' });
    expect(repeated[0]?.runId).toBeUndefined();
    expect((await app.repository.listRuns()).filter((run) => run.id !== first[0]?.runId && run.id !== second[0]?.runId)).toHaveLength(0);
  });

  it('persists no-change, unrelated, and failed probe outcomes while ignoring disabled subscriptions', async () => {
    const results = new Map<string, BusinessResearchMonitorSourceSnapshot[]>();
    const app = harness(async ({ subscription, signal }) => {
      if (signal.aborted) throw new Error('Probe was cancelled');
      if (subscription.task.question === 'failed probe') throw new Error('Network token must not be persisted');
      return results.get(subscription.task.question) ?? [];
    });
    const noChange = await app.service.subscribe({ ...taskInput(), question: 'no change topic' }, { intervalMs: HOUR });
    const unrelated = await app.service.subscribe({ ...taskInput(), question: 'unrelated topic' }, { intervalMs: HOUR });
    const failed = await app.service.subscribe({ ...taskInput(), question: 'failed probe' }, { intervalMs: HOUR });
    const disabled = await app.service.subscribe(taskInput(), { intervalMs: HOUR });
    await app.repository.saveMonitorSources(noChange.id, [source('body-v1', 'Known Northstar Motors electric vehicle update.')]);
    results.set('no change topic', [source('body-v1', 'Known Northstar Motors electric vehicle update.')]);
    results.set('unrelated topic', [{
      url: 'https://public.example/bread',
      title: 'Sourdough baking guide',
      summary: 'How to bake bread at home.',
    }]);
    await app.service.unsubscribe(disabled.id);
    app.clock.now += HOUR;

    const checks = await app.scheduler.checkDue();

    expect(checks).toHaveLength(3);
    expect(checks.find(({ subscriptionId }) => subscriptionId === noChange.id)?.decision).toEqual({ kind: 'skip', reason: 'no_change' });
    expect(checks.find(({ subscriptionId }) => subscriptionId === unrelated.id)?.decision).toEqual({ kind: 'skip', reason: 'unrelated' });
    expect(checks.find(({ subscriptionId }) => subscriptionId === failed.id)?.decision).toEqual({ kind: 'skip', reason: 'check_failed' });
    expect(await app.repository.listChecks(disabled.id)).toEqual([]);
    expect((await app.repository.getSubscription(failed.id))?.nextCheckAt).toBe(app.clock.now + HOUR);
    expect(JSON.stringify(await app.repository.listChecks(failed.id))).not.toContain('Network token');
  });

  it('does not launch a newly discovered signal after its subscription is disabled mid-check', async () => {
    const entered = deferred();
    const release = deferred();
    const app = harness(async () => {
      entered.resolve();
      await release.promise;
      return [source('body-v1')];
    });
    const subscription = await app.service.subscribe(taskInput(), { intervalMs: HOUR });
    app.clock.now += HOUR;
    const checkPromise = app.scheduler.checkDue();
    await entered.promise;
    await app.service.unsubscribe(subscription.id);
    release.resolve();

    const checks = await checkPromise;

    expect(checks[0]?.decision).toEqual({ kind: 'skip', reason: 'subscription_disabled' });
    expect(checks[0]?.runId).toBeUndefined();
    expect(await app.service.listRuns()).toEqual([]);
  });

  it('catches up one overdue check per subscription after restart and coalesces concurrent checkDue calls', async () => {
    const entered = deferred();
    const release = deferred();
    let probeCount = 0;
    const app = harness(async () => {
      probeCount += 1;
      entered.resolve();
      await release.promise;
      return [source('body-v1')];
    });
    const subscription = await app.service.subscribe(taskInput(), { intervalMs: HOUR });
    app.clock.now += 7 * 24 * HOUR;
    let restartedSequence = 0;
    const restartedService = new BusinessResearchService(app.repository, {
      createDecisionModel: () => ({
        async decide() { return { kind: 'finish', rationale: 'The monitor discovered a new public source.' }; },
      }),
      createTools: () => ({
        async searchWeb() { return []; },
        async openSource(evidenceId) { throw new Error(`Unexpected source open ${evidenceId}`); },
      }),
      async generateReport({ runId }) {
        return {
          title: 'Restarted monitor follow-up',
          claims: [{ kind: 'unresolved', id: `claim-${runId}`, question: 'What changed?', reason: 'The probe alone does not establish impact.' }],
        };
      },
      now: () => app.clock.now,
      idFactory: (kind) => `${kind}-restarted-${++restartedSequence}`,
    });
    const restartedScheduler = new BusinessResearchScheduler(app.repository, restartedService, {
      probe: async () => {
        probeCount += 1;
        entered.resolve();
        await release.promise;
        return [source('body-v1')];
      },
      now: () => app.clock.now,
      idFactory: (kind) => `${kind}-restarted-${++restartedSequence}`,
    });

    const firstCall = restartedScheduler.checkDue();
    const concurrentCall = restartedScheduler.checkDue();
    await entered.promise;
    release.resolve();
    const [first, concurrent] = await Promise.all([firstCall, concurrentCall]);

    expect(probeCount).toBe(1);
    expect(first).toHaveLength(1);
    expect(concurrent).toEqual(first);
    expect(await app.repository.listChecks(subscription.id)).toHaveLength(1);
    await restartedService.waitForRun(first[0]!.runId!);
    expect((await app.repository.getSubscription(subscription.id))?.nextCheckAt).toBe(app.clock.now + HOUR);
    expect(await restartedScheduler.checkDue()).toEqual([]);
  });
});
