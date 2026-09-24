import { describe, expect, it } from 'bun:test';
import {
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchEvidence,
  type BusinessResearchTaskInput,
} from '@finagent/core';
import { createBusinessResearchEventLog } from './events.ts';
import { replayBusinessResearchEvents } from './replay.ts';

function id<Kind extends Parameters<typeof parseBusinessResearchId>[0]>(kind: Kind, value: string) {
  const parsed = parseBusinessResearchId(kind, value);
  if (parsed === undefined) throw new Error(`Invalid test id: ${value}`);
  return parsed;
}

function taskInput(): BusinessResearchTaskInput {
  const result = normalizeBusinessResearchInput({
    industry: 'Electric vehicles',
    question: 'Compare public vehicle specifications',
    competitors: ['Tesla', 'BYD'],
    strategyId: 'industry_overview',
  });
  if (!result.ok) throw new Error('Test input should be valid');
  return result.value;
}

function evidence(): BusinessResearchEvidence {
  return {
    id: id('evidence', 'evidence-1'),
    sourceId: id('source', 'source-1'),
    title: 'Public product specification',
    url: 'https://example.com/specification',
    sourceKind: 'company_site',
    grade: 'search_excerpt',
    query: 'public EV product specification',
    excerpt: 'The manufacturer lists a 500 km range.',
    retrievedAt: '2026-09-24T00:00:00.000Z',
  };
}

describe('business research event log and replay', () => {
  it('assigns monotonic sequence numbers and removes secret-like fields before recording', () => {
    const log = createBusinessResearchEventLog(id('run', 'run-replay'), () => 1_000);
    const started = log.append({ type: 'run_started', task: taskInput() });
    const decision = log.append({
      type: 'decision_made',
      action: { kind: 'search_web', query: 'EV products', taskId: 'competitor_products' },
      details: {
        apiKey: 'private-key-value',
        safe: 'kept',
        nested: { authorization: 'Bearer private-token', note: 'visible' },
      },
    });

    expect([started.sequence, decision.sequence]).toEqual([1, 2]);
    expect(decision.details).toEqual({ safe: 'kept', nested: { note: 'visible' } });
    expect(log.snapshot()).toHaveLength(2);
  });

  it('does not expose mutable event payloads through append results or snapshots', () => {
    const log = createBusinessResearchEventLog(id('run', 'run-immutable-events'), () => 1_500);
    const originalTask = taskInput();
    const returned = log.append({ type: 'run_started', task: originalTask });
    if (returned.type !== 'run_started') throw new Error('Expected a run_started event');
    returned.task.question = 'tampered through append result';

    const snapshot = log.snapshot();
    const snapshotEvent = snapshot[0];
    if (snapshotEvent === undefined || snapshotEvent.type !== 'run_started') {
      throw new Error('Expected a run_started snapshot');
    }
    snapshotEvent.task.competitors.push('Injected competitor');

    const stored = log.snapshot()[0];
    if (stored === undefined || stored.type !== 'run_started') throw new Error('Expected a stored start event');
    expect(stored.task).toEqual(originalTask);
  });

  it('reconstructs the input, action, observation, and terminal outcome from ordered events', () => {
    const log = createBusinessResearchEventLog(id('run', 'run-replay-full'), () => 2_000);
    const expectedTask = taskInput();
    const expectedEvidence = evidence();
    const expectedObservation = {
      kind: 'search_results' as const,
      query: 'public EV product specification',
      evidence: [expectedEvidence],
    };
    log.append({ type: 'run_started', task: expectedTask });
    log.append({
      type: 'decision_made',
      action: { kind: 'search_web', query: expectedObservation.query, taskId: 'industry_landscape' },
    });
    log.append({ type: 'observation_recorded', observation: expectedObservation });
    log.append({ type: 'run_terminal', outcome: { status: 'completed' } });

    const replayed = replayBusinessResearchEvents(log.snapshot());

    expect(replayed).toEqual({
      ok: true,
      state: {
        task: expectedTask,
        actions: [{ kind: 'search_web', query: expectedObservation.query, taskId: 'industry_landscape' }],
        observations: [expectedObservation],
        outcome: { status: 'completed' },
        lastSequence: 4,
      },
    });
  });

  it('fails replay closed when persisted event sequence is missing or reordered', () => {
    const log = createBusinessResearchEventLog(id('run', 'run-bad-replay'), () => 3_000);
    log.append({ type: 'run_started', task: taskInput() });
    log.append({ type: 'run_terminal', outcome: { status: 'cancelled' } });
    const [started, terminal] = log.snapshot();
    if (started === undefined || terminal === undefined) throw new Error('Expected two test events');

    expect(replayBusinessResearchEvents([started, { ...terminal, sequence: 4 }])).toEqual({
      ok: false,
      code: 'invalid_sequence',
    });
    expect(replayBusinessResearchEvents([terminal, started])).toEqual({
      ok: false,
      code: 'invalid_sequence',
    });
  });
});
