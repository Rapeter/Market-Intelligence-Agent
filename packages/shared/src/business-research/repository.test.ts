import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchEvidence,
} from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { createBusinessResearchEventLog } from './events.ts';
import type { BusinessResearchMonitorSourceSnapshot } from './monitor-signals.ts';
import type { BusinessResearchReport } from './synthesis.ts';
import { BusinessResearchRepository, type BusinessResearchRunRecord, type BusinessResearchSubscriptionRecord } from './repository.ts';

function tempStore(): JsonFileStore {
  return new JsonFileStore(mkdtempSync(join(tmpdir(), 'market-research-repository-')));
}

class InterruptingJsonFileStore extends JsonFileStore {
  private interruptNextWrite = false;

  interrupt(): void {
    this.interruptNextWrite = true;
  }

  override async write(file: string, data: unknown): Promise<void> {
    if (this.interruptNextWrite) {
      this.interruptNextWrite = false;
      throw new Error('simulated interrupted write');
    }
    await super.write(file, data);
  }
}

function id<Kind extends Parameters<typeof parseBusinessResearchId>[0]>(kind: Kind, value: string) {
  const parsed = parseBusinessResearchId(kind, value);
  if (parsed === undefined) throw new Error(`Invalid fixture ${kind} id`);
  return parsed;
}

function input() {
  const result = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare public product changes',
    competitors: ['Northstar Motors', 'Harbor Auto'],
    strategyId: 'change_risk_tracking',
  });
  if (!result.ok) throw new Error('Repository fixture input should be valid');
  return result.value;
}

function runRecord(runId = id('run', 'run-repository-one')): BusinessResearchRunRecord {
  return {
    id: runId,
    task: input(),
    state: { status: 'queued', updatedAt: '2026-09-24T00:00:00.000Z' },
    createdAt: 1_790_208_000_000,
    updatedAt: 1_790_208_000_000,
  };
}

function evidence(): BusinessResearchEvidence {
  return {
    id: id('evidence', 'evidence-repository-one'),
    sourceId: id('source', 'source-repository-one'),
    title: 'Public product update',
    url: 'https://public.example/products/update',
    sourceKind: 'company_site',
    grade: 'search_excerpt',
    query: 'Northstar Motors product update',
    excerpt: 'The company announced a new battery configuration.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

function report(): BusinessResearchReport {
  const item = evidence();
  return {
    id: id('report', 'report-repository-one'),
    runId: id('run', 'run-repository-one'),
    generatedAt: '2026-09-24T00:01:00.000Z',
    status: 'completed',
    title: 'Public product comparison',
    claims: [{
      kind: 'supported',
      id: id('claim', 'claim-repository-one'),
      statement: 'A public product configuration change was announced.',
      evidenceIds: [item.id],
    }],
    evidence: [item],
    monitoringActions: ['Check for a later product specification.'],
  };
}

function subscriptionRecord(): BusinessResearchSubscriptionRecord {
  return {
    id: id('subscription', 'subscription-repository-one'),
    task: input(),
    intervalMs: 86_400_000,
    enabled: true,
    createdAt: 1_790_208_000_000,
    updatedAt: 1_790_208_000_000,
    nextCheckAt: 1_790_294_400_000,
  };
}

describe('BusinessResearchRepository', () => {
  it('persists validated run, event, evidence, report, and subscription records across repository instances', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const run = runRecord();
    const eventLog = createBusinessResearchEventLog(run.id, () => 1_790_208_000_000);
    const startEvent = eventLog.append({ type: 'run_started', task: run.task });
    const reportRecord = report();
    const subscription = subscriptionRecord();

    await repository.saveRun(run);
    await repository.appendEvent(startEvent);
    await repository.saveEvidence(run.id, [evidence()]);
    await repository.saveReport(reportRecord);
    await repository.saveSubscription(subscription);

    const reopened = new BusinessResearchRepository(store);
    expect(await reopened.getRun(run.id)).toEqual(run);
    expect(await reopened.listRuns()).toEqual([run]);
    expect(await reopened.getEvents(run.id)).toEqual([startEvent]);
    expect(await reopened.getEvidence(run.id)).toEqual([evidence()]);
    expect(await reopened.getReport(reportRecord.id)).toEqual(reportRecord);
    expect(await reopened.listReports()).toEqual([reportRecord]);
    expect(await reopened.getSubscription(subscription.id)).toEqual(subscription);
    expect(await reopened.listSubscriptions()).toEqual([subscription]);
  });

  it('rejects fixture grades paired with public source kinds', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    const runId = id('run', 'run-fixture-grade-mismatch');
    const invalid = { ...evidence(), grade: 'fixture_data' as const };

    await expect(repository.saveEvidence(runId, [invalid])).rejects.toThrow('Invalid business research evidence.');
  });

  it('only appends the next valid event sequence and preserves the last durable prefix after an interrupted write', async () => {
    const store = new InterruptingJsonFileStore(mkdtempSync(join(tmpdir(), 'market-research-interrupted-write-')));
    const run = runRecord();
    const eventLog = createBusinessResearchEventLog(run.id, () => 1_790_208_000_000);
    const first = eventLog.append({ type: 'run_started', task: run.task });
    const second = eventLog.append({ type: 'phase_changed', status: 'planning' });
    const repository = new BusinessResearchRepository(store);
    await repository.saveRun(run);
    await repository.appendEvent(first);

    store.interrupt();
    const failingRepository = new BusinessResearchRepository(store);
    await expect(failingRepository.appendEvent(second)).rejects.toThrow();
    expect(await new BusinessResearchRepository(store).getEvents(run.id)).toEqual([first]);
    await repository.appendEvent(second);
    await expect(repository.appendEvent(second)).rejects.toThrow();
    expect(await new BusinessResearchRepository(store).getEvents(run.id)).toEqual([first, second]);
  });

  it('deduplicates reservations for the same subscription and signal fingerprint across instances', async () => {
    const store = tempStore();
    const firstRepository = new BusinessResearchRepository(store);
    const secondRepository = new BusinessResearchRepository(store);
    const subscription = subscriptionRecord();
    const subscriptionId = subscription.id;
    await firstRepository.saveSubscription(subscription);
    const fingerprint = `signal-${'a'.repeat(64)}`;
    const runIds = [id('run', 'run-trigger-first'), id('run', 'run-trigger-second')] as const;

    const reservations = await Promise.all([
      firstRepository.reserveFingerprint(subscriptionId, fingerprint, runIds[0]),
      secondRepository.reserveFingerprint(subscriptionId, fingerprint, runIds[1]),
    ]);

    expect(reservations.filter((reservation) => reservation.reserved)).toHaveLength(1);
    expect(reservations.filter((reservation) => !reservation.reserved)).toHaveLength(1);
    const winner = reservations.find((reservation) => reservation.reserved);
    const duplicate = reservations.find((reservation) => !reservation.reserved);
    expect(duplicate?.existingRunId).toBe(winner?.runId);
    expect(await firstRepository.getFingerprintRun(subscriptionId, fingerprint)).toBe(winner?.runId);
  });

  it('persists check outcomes and validates records rather than trusting malformed JSON', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const subscription = subscriptionRecord();
    const check = {
      id: id('event', 'event-check-one'),
      subscriptionId: subscription.id,
      startedAt: 1_790_208_000_000,
      completedAt: 1_790_208_000_010,
      decision: { kind: 'skip', reason: 'no_change' } as const,
    };
    await repository.saveSubscription(subscription);
    await repository.appendCheck(check);
    expect(await repository.listChecks(subscription.id)).toEqual([check]);

    const run = runRecord();
    await repository.saveRun(run);
    const runDirectory = join(store.resolve('business-research'), 'runs');
    const encodedId = readdirSync(runDirectory)[0];
    if (encodedId === undefined) throw new Error('Expected a stored run directory');
    writeFileSync(join(runDirectory, encodedId, 'record.json'), '{broken json');
    await expect(repository.getRun(run.id)).rejects.toThrow();
  });

  it('persists a validated source baseline for material-change checks across restarts', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const subscription = subscriptionRecord();
    const sources: BusinessResearchMonitorSourceSnapshot[] = [{
      url: 'https://public.example/updates',
      title: 'Northstar Motors product update',
      summary: 'Northstar Motors published a new battery configuration.',
      contentFingerprint: 'body-revision-1',
      retrievedAt: '2026-09-24T00:00:00.000Z',
    }];

    await repository.saveSubscription(subscription);
    await repository.saveMonitorSources(subscription.id, sources);
    const reopened = new BusinessResearchRepository(store);

    expect(await reopened.getMonitorSources(subscription.id)).toEqual(sources);
    await expect(reopened.saveMonitorSources(subscription.id, [{
      url: 'http://127.0.0.1/private',
      title: 'Private endpoint',
      summary: 'Must not be persisted.',
    }])).rejects.toThrow();
  });
});
