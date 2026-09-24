import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeBusinessResearchInput, type BusinessResearchTaskInput } from '@finagent/core';
import { JsonFileStore } from '../../../packages/shared/src/storage/json-file-store.ts';
import { createBusinessResearchFixtureDecisionModel, createBusinessResearchFixtureReportDraft, createBusinessResearchFixtureTools } from '../../../packages/shared/src/business-research/fixture.ts';
import { BusinessResearchRepository } from '../../../packages/shared/src/business-research/repository.ts';
import { BusinessResearchScheduler } from '../../../packages/shared/src/business-research/scheduler.ts';
import type { BusinessResearchMonitorSourceSnapshot } from '../../../packages/shared/src/business-research/monitor-signals.ts';
import { BusinessResearchService } from '../../../packages/shared/src/business-research/service.ts';

const HOUR = 60 * 60 * 1_000;
const here = import.meta.dir;
const outputDirectory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the verification artifact directory as the first argument.');

interface MonitorSnapshotFixture {
  mode: 'fixture';
  snapshotId: string;
  sources: BusinessResearchMonitorSourceSnapshot[];
}

const firstSnapshot = readSnapshot('monitor-v1.json');
const changedSnapshot = readSnapshot('monitor-v2.json');
assert.equal(firstSnapshot.mode, 'fixture');
assert.equal(changedSnapshot.mode, 'fixture');
assert.notEqual(firstSnapshot.sources[0]?.contentFingerprint, changedSnapshot.sources[0]?.contentFingerprint);
assert.equal(firstSnapshot.sources[0]?.url, changedSnapshot.sources[0]?.url);

const temporaryStore = mkdtempSync(join(tmpdir(), 'finagent-business-research-monitor-'));
assertSafeTemporaryPath(temporaryStore);
const store = new JsonFileStore(temporaryStore);
const repository = new BusinessResearchRepository(store);
const clock = { now: Date.parse('2026-09-24T00:00:00.000Z') };
let idSequence = 0;
let activeSnapshot = firstSnapshot;
let probeCalls = 0;
let idSuffix = 0;
const taskResult = normalizeBusinessResearchInput({
  industry: 'Electric vehicles',
  question: 'Track illustrative updates from Northstar Motors and Harbor Auto',
  competitors: ['Northstar Motors', 'Harbor Auto'],
  strategyId: 'change_risk_tracking',
});
if (!taskResult.ok) throw new Error('The fixture monitor task input is invalid.');
const task: BusinessResearchTaskInput = taskResult.value;

const service = new BusinessResearchService(repository, {
  createDecisionModel: (_runId, runTask) => createBusinessResearchFixtureDecisionModel(runTask),
  createTools: (runId, runTask) => createBusinessResearchFixtureTools(runId, runTask, () => clock.now),
  async generateReport(input) { return createBusinessResearchFixtureReportDraft(input); },
  now: () => clock.now,
  idFactory: (kind) => `${kind}-monitor-fixture-${++idSequence}`,
});
const scheduler = new BusinessResearchScheduler(repository, service, {
  probe: async () => {
    probeCalls += 1;
    return structuredClone(activeSnapshot.sources);
  },
  runMode: 'fixture',
  now: () => clock.now,
  idFactory: (kind) => `${kind}-monitor-check-${++idSuffix}`,
});

try {
  const subscription = await service.subscribe(task, { intervalMs: HOUR });
  const checks: Array<Record<string, unknown>> = [];
  const elapsed: number[] = [];

  for (const [snapshot, expectedReason, expectedKind] of [
    [firstSnapshot, 'new_source', 'trigger'],
    [changedSnapshot, 'source_updated', 'trigger'],
    [firstSnapshot, 'duplicate_signal', 'skip'],
  ] as const) {
    activeSnapshot = snapshot;
    clock.now += HOUR;
    const startedAt = performance.now();
    const [check] = await scheduler.checkDue();
    assert.ok(check, `No monitor check created for ${snapshot.snapshotId}.`);
    assert.equal(check.decision.kind, expectedKind);
    assert.equal(check.decision.reason, expectedReason);
    if (expectedKind === 'trigger') {
      assert.ok(check.runId, `Expected research run for ${snapshot.snapshotId}.`);
      const run = await service.waitForRun(check.runId);
      assert.ok(run, `Triggered run ${check.runId} was not persisted.`);
      assert.equal(run.mode, 'fixture');
      assert.equal(run.state.status, 'completed', `Unexpected fixture run terminal state: ${JSON.stringify({ state: run.state, events: await service.listEvents(check.runId) })}`);
    } else {
      assert.equal(check.runId, undefined, 'Repeated signal unexpectedly created a run.');
    }
    elapsed.push(Math.round(performance.now() - startedAt));
    checks.push({
      snapshotId: snapshot.snapshotId,
      expectedDecision: expectedKind === 'trigger' ? 'triggered' : 'not_triggered',
      decision: check.decision.kind,
      reason: check.decision.reason,
      runMode: check.runId ? 'fixture' : undefined,
      runId: check.runId,
      elapsedMs: elapsed.at(-1),
    });
  }

  const persistedRepository = new BusinessResearchRepository(new JsonFileStore(temporaryStore));
  const persistedRuns = await persistedRepository.listRuns();
  const persistedChecks = await persistedRepository.listChecks(subscription.id);
  assert.equal(probeCalls, 3);
  assert.equal(persistedRuns.length, 2);
  assert.equal(persistedChecks.length, 3);
  assert.ok(persistedRuns.every((run) => run.mode === 'fixture'));
  assert.ok(persistedRuns.every((run) => run.reportId));

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, 'monitor-fixture-verification.json'), JSON.stringify({
    schemaVersion: 1,
    verificationMode: 'deterministic-fixture-only',
    fixtureFiles: ['monitor-v1.json', 'monitor-v2.json'],
    snapshotSource: 'apps/electron/e2e/fixtures/business-research',
    networkRequests: 0,
    probeCalls,
    researchRunsPersisted: persistedRuns.length,
    checksPersisted: persistedChecks.length,
    duplicateSuppressed: persistedRuns.length === 2 && persistedChecks[2]?.decision.reason === 'duplicate_signal',
    elapsedMs: elapsed,
    checks,
  }, null, 2) + '\n', 'utf8');
  console.log(`PASS monitor fixture snapshots: ${persistedChecks.length} checks, ${persistedRuns.length} fixture runs, repeated signal suppressed.`);
  console.log(`TIMING monitor-check-and-follow-up-ms=${JSON.stringify(elapsed)}`);
} finally {
  await scheduler.dispose();
  await service.dispose();
  assertSafeTemporaryPath(temporaryStore);
  rmSync(temporaryStore, { recursive: true, force: true });
}

function readSnapshot(name: string): MonitorSnapshotFixture {
  const parsed = JSON.parse(readFileSync(join(here, 'fixtures/business-research', name), 'utf8')) as MonitorSnapshotFixture;
  if (parsed.mode !== 'fixture' || !Array.isArray(parsed.sources)) {
    throw new Error(`${name} must contain explicitly labeled fixture sources.`);
  }
  return parsed;
}

function assertSafeTemporaryPath(path: string): void {
  const relativePath = relative(resolve(tmpdir()), resolve(path));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Refusing to clean a monitor store outside its unique OS temporary directory.');
  }
}
