import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type {
  BusinessResearchObservation,
  BusinessResearchRunId,
  BusinessResearchTaskInput,
} from '@finagent/core';
import { createPiBusinessResearchAdapter, type PiBusinessResearchRpc } from './pi-adapter.ts';

const runId = 'run-pi-test' as BusinessResearchRunId;
const task: BusinessResearchTaskInput = {
  industry: 'electric vehicles',
  question: 'Compare public charging plans',
  competitors: ['Acme', 'Globex'],
  strategyId: 'competitor_deep_dive',
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeRpc implements PiBusinessResearchRpc {
  readonly sessions: string[] = [];
  readonly prompts: string[] = [];
  readonly activeToolsSeen: string[][] = [];
  answer = '{"kind":"finish","rationale":"Evidence is sufficient."}';
  toolCalls: unknown[] = [];
  switchSessionDelay?: () => Promise<void>;
  promptGate?: Promise<void>;
  onPromptStarted?: () => void;
  abortCount = 0;
  active = 0;
  maxActive = 0;

  async switchSession(sessionPath: string) {
    await this.switchSessionDelay?.();
    this.sessions.push(sessionPath);
  }

  promptStreaming(prompt: string) {
    this.prompts.push(prompt);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const self = this;
    let aborted = false;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          self.onPromptStarted?.();
          await (self.promptGate ?? Promise.resolve());
          yield {
            kind: 'end' as const,
            result: { answer: aborted ? '' : self.answer, toolCalls: self.toolCalls, aborted },
          };
        } finally {
          self.active -= 1;
        }
      },
      async abort() {
        aborted = true;
        self.abortCount += 1;
      },
    };
  }
}

describe('Pi business research adapter', () => {
  it('uses one isolated session per run and validates the returned action', async () => {
    const rpc = new FakeRpc();
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const action = await adapter.createDecisionModel(runId).decide({
      task,
      observations: [],
      allowedActions: ['search_web', 'open_source', 'finish'],
    }, new AbortController().signal);

    expect(action).toEqual({ kind: 'finish', rationale: 'Evidence is sufficient.' });
    expect(rpc.sessions).toEqual([join('/research-sessions', 'run-pi-test.jsonl')]);
    expect(rpc.prompts[0]).toContain('BUSINESS_RESEARCH_DECISION_V1');
    expect(rpc.prompts[0]).toContain('Compare public charging plans');
  });

  it('serializes prompts while preserving distinct run sessions', async () => {
    const rpc = new FakeRpc();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let first = true;
    rpc.switchSessionDelay = async () => {
      if (!first) return;
      first = false;
      await firstGate;
    };
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const firstDecision = adapter.createDecisionModel(runId).decide({
      task,
      observations: [],
      allowedActions: ['finish'],
    }, new AbortController().signal);
    const secondDecision = adapter.createDecisionModel('run-pi-second' as BusinessResearchRunId).decide({
      task,
      observations: [],
      allowedActions: ['finish'],
    }, new AbortController().signal);
    await Promise.resolve();
    releaseFirst();
    await Promise.all([firstDecision, secondDecision]);
    expect(rpc.sessions).toEqual([
      join('/research-sessions', 'run-pi-test.jsonl'),
      join('/research-sessions', 'run-pi-second.jsonl'),
    ]);
    expect(rpc.maxActive).toBe(1);
  });

  it('normalizes malformed actions and unexpected model tool calls', async () => {
    const rpc = new FakeRpc();
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const model = adapter.createDecisionModel(runId);
    rpc.answer = '{not json';
    await expect(model.decide({ task, observations: [], allowedActions: ['finish'] }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_INVALID_DECISION' });

    rpc.answer = '{"kind":"finish","rationale":"done"}';
    rpc.toolCalls = [{ toolName: 'get_quote' }];
    await expect(model.decide({ task, observations: [], allowedActions: ['finish'] }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_TOOL_NOT_ALLOWED' });
  });

  it('does not accept actions outside the runtime allow list', async () => {
    const rpc = new FakeRpc();
    rpc.answer = '{"kind":"search_web","query":"latest charging plans","taskId":"pricing_channels"}';
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    await expect(adapter.createDecisionModel(runId).decide({
      task,
      observations: [],
      allowedActions: ['finish'],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_INVALID_DECISION' });
  });

  it('aborts active Pi work and reports cancellation without leaking prompt contents', async () => {
    const rpc = new FakeRpc();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    rpc.switchSessionDelay = async () => gate;
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const controller = new AbortController();
    const pending = adapter.createDecisionModel(runId).decide({
      task,
      observations: [],
      allowedActions: ['finish'],
    }, controller.signal);
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_CANCELLED' });
    expect(rpc.abortCount).toBe(0);
  });

  it('aborts an active Pi prompt and maps provider authentication and rate-limit failures', async () => {
    const rpc = new FakeRpc();
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const entered = deferred();
    const release = deferred();
    rpc.promptGate = release.promise;
    rpc.onPromptStarted = () => entered.resolve();
    const controller = new AbortController();
    const pending = adapter.createDecisionModel(runId).decide({
      task,
      observations: [],
      allowedActions: ['finish'],
    }, controller.signal);
    await entered.promise;
    controller.abort();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_CANCELLED' });
    expect(rpc.abortCount).toBe(1);

    for (const [message, code] of [
      ['HTTP 401 unauthorized', 'BUSINESS_RESEARCH_AUTHENTICATION_FAILED'],
      ['HTTP 429 rate limit reached', 'BUSINESS_RESEARCH_RATE_LIMITED'],
    ]) {
      rpc.promptStreaming = () => ({
        async *[Symbol.asyncIterator]() {
          throw Object.assign(new Error(message), { code: 'PI_RUNTIME_ERROR' });
        },
        async abort() {},
      });
      await expect(adapter.createDecisionModel(runId).decide({
        task,
        observations: [],
        allowedActions: ['finish'],
      }, new AbortController().signal)).rejects.toMatchObject({ code });
    }
  });

  it('parses a report draft as data and maps provider errors to stable codes', async () => {
    const rpc = new FakeRpc();
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    rpc.answer = '```json\n{"title":"Public research","claims":[],"monitoringActions":[]}\n```';
    expect(await adapter.generateReport({
      runId,
      task,
      mode: 'live',
      evidence: [],
      outcome: { status: 'partial', reason: 'No usable sources.' },
      signal: new AbortController().signal,
    })).toEqual({ title: 'Public research', claims: [], monitoringActions: [] });

    rpc.promptStreaming = () => ({
      async *[Symbol.asyncIterator]() {
        throw Object.assign(new Error('api key sk-this-is-not-public'), { code: 'PI_RUNTIME_NOT_FOUND' });
      },
      async abort() {},
    });
    await expect(adapter.generateReport({
      runId,
      task,
      mode: 'live',
      evidence: [],
      outcome: { status: 'partial', reason: 'No usable sources.' },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'BUSINESS_RESEARCH_PI_UNAVAILABLE' });
    expect(rpc.prompts.join('\n')).not.toContain('api key sk-this-is-not-public');
  });

  it('bounds evidence summaries sent to the model', async () => {
    const rpc = new FakeRpc();
    const adapter = createPiBusinessResearchAdapter({ rpc, sessionDirectory: '/research-sessions' });
    const oversized = {
      kind: 'search_results',
      evidence: Array.from({ length: 20 }, (_, index) => ({
        id: `evidence-${index}`,
        title: `title-${index}`,
        url: `https://example.com/${index}`,
        excerpt: 'x'.repeat(5_000),
        grade: 'search_excerpt',
        sourceKind: 'other_public',
        sourceId: 'source-a',
        query: 'query',
        retrievedAt: '2026-09-24T00:00:00.000Z',
      })),
    } as unknown as BusinessResearchObservation;
    await adapter.createDecisionModel(runId).decide({
      task,
      observations: [oversized],
      allowedActions: ['finish'],
    }, new AbortController().signal);
    expect(rpc.prompts[0]!.length).toBeLessThan(20_000);
  });
});
