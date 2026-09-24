import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchEvidence,
  type BusinessResearchTaskInput,
} from '@finagent/core';
import { BusinessResearchRepository, type BusinessResearchRunRecord } from './repository.ts';
import { createBusinessResearchEventLog } from './events.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { BusinessResearchService } from './service.ts';

function id<Kind extends Parameters<typeof parseBusinessResearchId>[0]>(kind: Kind, value: string) {
  const parsed = parseBusinessResearchId(kind, value);
  if (parsed === undefined) throw new Error(`Invalid test id: ${value}`);
  return parsed;
}

function taskInput(): BusinessResearchTaskInput {
  const normalized = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare public product updates',
    competitors: ['Northstar Motors', 'Harbor Auto'],
    strategyId: 'competitor_deep_dive',
  });
  if (!normalized.ok) throw new Error('Test input should be valid');
  return normalized.value;
}

function evidence(runId: string, query: string): BusinessResearchEvidence {
  return {
    id: id('evidence', `evidence-${runId}`),
    sourceId: id('source', `source-${runId}`),
    title: 'Public product update',
    url: `https://public.example/products/${runId}`,
    sourceKind: 'company_site',
    grade: 'search_excerpt',
    query,
    excerpt: 'The company publicly announced a revised battery configuration.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

function reportDraft(runId: string, evidenceId: BusinessResearchEvidence['id']) {
  return {
    title: 'Public product update summary',
    claims: [{
      kind: 'supported',
      id: id('claim', `claim-${runId}`),
      statement: 'The company announced a revised battery configuration.',
      evidenceIds: [evidenceId],
    }],
    monitoringActions: ['Check the company product page for a later revision.'],
  };
}

function tempStore(): JsonFileStore {
  return new JsonFileStore(mkdtempSync(join(tmpdir(), 'market-research-service-')));
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('BusinessResearchService', () => {
  it('persists run events and evidence before the next tool or model step, then saves a validated report', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const toolEntered = deferred();
    const releaseTool = deferred();
    let modelSawPersistedStart = false;
    let modelSawPersistedEvidence = false;
    let toolSawPersistedStart = false;
    const service = new BusinessResearchService(repository, {
      createDecisionModel(runId) {
        return {
          async decide({ observations }) {
            const persisted = await repository.getEvents(runId);
            if (observations.length === 0) {
              modelSawPersistedStart = persisted.some((event) => event.type === 'phase_changed' && event.status === 'planning');
              return { kind: 'search_web', query: 'Northstar Motors product update', taskId: 'competitor_products' };
            }
            modelSawPersistedEvidence = (await repository.getEvidence(runId)).length === 1;
            return { kind: 'finish', rationale: 'The saved public source answers the question.' };
          },
        };
      },
      createTools(runId) {
        return {
          async searchWeb(query) {
            toolSawPersistedStart = (await repository.getEvents(runId)).some((event) => event.type === 'tool_started');
            toolEntered.resolve();
            await releaseTool.promise;
            return [evidence(runId, query)];
          },
          async openSource(evidenceId) {
            return { ...evidence(runId, 'opened source'), id: evidenceId, grade: 'page_text' };
          },
        };
      },
      async generateReport({ runId, evidence: items }) {
        return reportDraft(runId, items[0]!.id);
      },
      now: () => Date.parse('2026-09-24T00:00:00.000Z'),
      idFactory: (kind, sequence) => `${kind}-service-${sequence}`,
    });

    const queued = await service.start(taskInput());
    expect(queued.state.status).toBe('queued');
    await toolEntered.promise;
    expect(modelSawPersistedStart).toBe(true);
    expect(toolSawPersistedStart).toBe(true);
    releaseTool.resolve();

    const completedResult = await service.waitForRun(queued.id);
    expect(completedResult).toBeDefined();
    const completed = completedResult!;
    expect(modelSawPersistedEvidence).toBe(true);
    expect(completed.state.status).toBe('completed');
    expect(completed.reportId).toBeDefined();
    expect((await repository.getEvents(queued.id)).at(-1)?.type).toBe('run_terminal');
    expect(await repository.getEvidence(queued.id)).toHaveLength(1);
    const savedReport = await repository.getReport(completed.reportId!);
    expect(savedReport?.claims[0]?.kind).toBe('supported');
    expect(savedReport?.evidence).toHaveLength(1);
  });

  it('rebuilds a missing run checkpoint from events and marks an interrupted process once', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const runId = id('run', 'run-restart-recovery');
    const task = taskInput();
    const eventLog = createBusinessResearchEventLog(runId, () => 1_790_208_000_000);
    await repository.appendEvent(eventLog.append({ type: 'run_started', task }));
    await repository.appendEvent(eventLog.append({ type: 'phase_changed', status: 'planning' }));

    const restartedService = new BusinessResearchService(repository, {
      createDecisionModel: () => { throw new Error('Recovery must not start a new model call.'); },
      createTools: () => { throw new Error('Recovery must not start a new tool call.'); },
      generateReport: async () => { throw new Error('Recovery must not synthesize a new report.'); },
      now: () => 1_790_208_001_000,
    });

    const recovered = await restartedService.getRun(runId);
    expect(recovered?.task).toEqual(task);
    expect(recovered?.state).toEqual({
      status: 'failed',
      completedAt: '2026-09-24T00:00:01.000Z',
      code: 'INTERRUPTED_RESTART',
    });
    const recoveredEvents = await repository.getEvents(runId);
    expect(recoveredEvents.map((event) => event.type)).toEqual(['run_started', 'phase_changed', 'run_terminal']);
    expect(await restartedService.getRun(runId)).toEqual(recovered);
    expect(await repository.getEvents(runId)).toHaveLength(3);
  });

  it('recovers a corrupt run checkpoint only from a valid durable event log', async () => {
    const store = tempStore();
    const repository = new BusinessResearchRepository(store);
    const runId = id('run', 'run-corrupt-checkpoint');
    const task = taskInput();
    const eventLog = createBusinessResearchEventLog(runId, () => 1_790_208_000_000);
    await repository.appendEvent(eventLog.append({ type: 'run_started', task }));
    await repository.saveRun({
      id: runId,
      task,
      state: { status: 'queued', updatedAt: '2026-09-24T00:00:00.000Z' },
      createdAt: 1_790_208_000_000,
      updatedAt: 1_790_208_000_000,
    } satisfies BusinessResearchRunRecord);
    const runDirectory = readdirSync(store.resolve('business-research/runs'))[0]!;
    await store.write(`business-research/runs/${runDirectory}/record.json`, { id: 'wrong-id' });
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => { throw new Error('Recovery must not create a run.'); },
      createTools: () => { throw new Error('Recovery must not create tools.'); },
      generateReport: async () => ({}),
      now: () => 1_790_208_002_000,
    });

    const recovered = await service.getRun(runId);

    expect(recovered?.id).toBe(runId);
    expect(recovered?.state.status).toBe('failed');
    expect(recovered?.state.status === 'failed' && recovered.state.code).toBe('INTERRUPTED_RESTART');
    expect((await repository.getEvents(runId)).at(-1)?.type).toBe('run_terminal');
  });

  it('enforces the minimum subscription interval and preserves a disabled subscription', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    const now = 1_790_208_000_000;
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => { throw new Error('Subscription setup must not start a run.'); },
      createTools: () => { throw new Error('Subscription setup must not start a run.'); },
      generateReport: async () => ({}),
      now: () => now,
      idFactory: (kind, sequence) => `${kind}-service-${sequence}`,
    });

    await expect(service.subscribe(taskInput(), { intervalMs: 60 * 60 * 1_000 - 1 })).rejects.toThrow();
    const subscription = await service.subscribe(taskInput());
    expect(subscription.intervalMs).toBe(24 * 60 * 60 * 1_000);
    expect(subscription.nextCheckAt).toBe(now + 24 * 60 * 60 * 1_000);
    const disabled = await service.unsubscribe(subscription.id);
    expect(disabled).toBeDefined();
    expect(disabled?.enabled).toBe(false);
    expect(await service.listSubscriptions()).toEqual([disabled!]);
  });

  it('keeps a prior successful report when a later run cannot synthesize a validated report', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    let shouldFailSynthesis = false;
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => ({
        async decide({ observations }) {
          return observations.length === 0
            ? { kind: 'search_web', query: 'public product update', taskId: 'competitor_products' }
            : { kind: 'finish', rationale: 'The public source is sufficient.' };
        },
      }),
      createTools(runId) {
        return {
          async searchWeb(query) { return [evidence(runId, query)]; },
          async openSource(evidenceId) { return { ...evidence(runId, 'open'), id: evidenceId, grade: 'page_text' }; },
        };
      },
      async generateReport({ runId, evidence: items }) {
        return shouldFailSynthesis ? { title: '', claims: [] } : reportDraft(runId, items[0]!.id);
      },
      idFactory: (kind, sequence) => `${kind}-report-preservation-${sequence}`,
    });

    const first = await service.start(taskInput());
    const firstResult = await service.waitForRun(first.id);
    expect(firstResult).toBeDefined();
    const firstCompleted = firstResult!;
    shouldFailSynthesis = true;
    const second = await service.start(taskInput());
    const secondResult = await service.waitForRun(second.id);
    expect(secondResult).toBeDefined();
    const secondFailed = secondResult!;

    expect(firstCompleted.state.status).toBe('completed');
    expect(secondFailed.state.status).toBe('failed');
    expect(secondFailed.state.status === 'failed' && secondFailed.state.code).toBe('REPORT_SYNTHESIS_FAILED');
    expect(await repository.getReport(firstCompleted.reportId!)).toBeDefined();
    expect(await repository.listReports()).toHaveLength(1);
    expect((await repository.getEvents(second.id)).at(-1)).toMatchObject({
      type: 'run_terminal',
      outcome: { status: 'failed', code: 'REPORT_SYNTHESIS_FAILED' },
    });
  });

  it('cancels an active run and persists cancellation before any subsequent decision', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    const toolEntered = deferred();
    let modelCalls = 0;
    let toolCalls = 0;
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => ({
        async decide() {
          modelCalls += 1;
          return { kind: 'search_web', query: 'public update', taskId: 'competitor_products' };
        },
      }),
      createTools: () => ({
        searchWeb() {
          toolCalls += 1;
          toolEntered.resolve();
          return new Promise<BusinessResearchEvidence[]>(() => {});
        },
        async openSource(evidenceId) {
          return { ...evidence('unused-cancel', 'unused'), id: evidenceId, grade: 'page_text' };
        },
      }),
      async generateReport() { throw new Error('A cancelled run must not synthesize a report.'); },
      idFactory: (kind, sequence) => `${kind}-cancel-${sequence}`,
    });

    const started = await service.start(taskInput());
    await toolEntered.promise;
    expect(await service.cancel(started.id)).toBe(true);
    const cancelled = await service.waitForRun(started.id);

    expect(cancelled?.state.status).toBe('cancelled');
    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(1);
    expect((await repository.getEvents(started.id)).at(-1)).toMatchObject({
      type: 'run_terminal',
      outcome: { status: 'cancelled' },
    });
  });

  it('aborts and settles active runs when the host is disposed', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    const toolEntered = deferred();
    let modelCalls = 0;
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => ({
        async decide() {
          modelCalls += 1;
          return { kind: 'search_web', query: 'public update', taskId: 'competitor_products' };
        },
      }),
      createTools: () => ({
        searchWeb() {
          toolEntered.resolve();
          return new Promise<BusinessResearchEvidence[]>(() => {});
        },
        async openSource(evidenceId) {
          return { ...evidence('unused-dispose', 'unused'), id: evidenceId, grade: 'page_text' };
        },
      }),
      async generateReport() { throw new Error('An interrupted run must not synthesize a report.'); },
      idFactory: (kind, sequence) => `${kind}-dispose-${sequence}`,
    });

    const started = await service.start(taskInput());
    await toolEntered.promise;
    await service.dispose();

    expect((await service.getRun(started.id))?.state.status).toBe('cancelled');
    expect(modelCalls).toBe(1);
    expect((await repository.getEvents(started.id)).at(-1)).toMatchObject({
      type: 'run_terminal',
      outcome: { status: 'cancelled' },
    });
  });

  it('keeps cancellation as the terminal reason when report generation is interrupted', async () => {
    const repository = new BusinessResearchRepository(tempStore());
    const synthesisEntered = deferred();
    const service = new BusinessResearchService(repository, {
      createDecisionModel: () => ({
        async decide() { return { kind: 'finish', rationale: 'No evidence is available.' }; },
      }),
      createTools: () => ({
        async searchWeb() { return []; },
        async openSource(evidenceId) { throw new Error(`Unexpected source open ${evidenceId}`); },
      }),
      generateReport({ signal }) {
        synthesisEntered.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthesis cancelled')), { once: true });
        });
      },
      idFactory: (kind, sequence) => `${kind}-synthesis-cancel-${sequence}`,
    });

    const started = await service.start(taskInput());
    await synthesisEntered.promise;
    expect(await service.cancel(started.id)).toBe(true);
    const cancelled = await service.waitForRun(started.id);

    expect(cancelled?.state.status).toBe('cancelled');
    expect(cancelled?.state.status === 'cancelled' && cancelled.state.reason).toBeUndefined();
    expect((await repository.getEvents(started.id)).at(-1)).toMatchObject({
      type: 'run_terminal',
      outcome: { status: 'cancelled' },
    });
  });
});
