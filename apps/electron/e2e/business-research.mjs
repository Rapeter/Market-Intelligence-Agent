import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { reserveCdpPort, spawnElectron, waitForCdp } from './electron-harness.mjs';
import { seedLocale } from './seed-locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');
const artifactDirectory = resolve(repoRoot, 'docs/demos/business-research');
const userDataDirectory = mkdtempSync(join(tmpdir(), 'finagent-business-research-e2e-'));
assertSafeTemporaryPath(userDataDirectory);
mkdirSync(userDataDirectory, { recursive: true });
mkdirSync(artifactDirectory, { recursive: true });
seedLocale(userDataDirectory, 'en-US');

class BusinessResearchPage {
  constructor(page) {
    this.page = page;
    this.industry = page.getByRole('textbox', { name: 'Industry', exact: true });
    this.question = page.getByRole('textbox', { name: 'Research question', exact: true });
    this.competitors = page.getByRole('textbox', { name: /^Competitors/ });
    this.strategy = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Competitor deep dive', exact: true }) });
    this.fixtureMode = page.getByTestId('business-research-mode-fixture');
    this.startButton = page.getByTestId('business-research-start');
    this.subscribeButton = page.getByTestId('business-research-subscribe-monitor');
    this.workspace = page.getByTestId('business-research-workspace');
    this.report = page.getByTestId('business-research-report');
  }

  async api(method, input) {
    const result = await this.page.evaluate(async ({ method, input }) => {
      const surface = window.electronAPI?.businessResearch;
      if (!surface || typeof surface[method] !== 'function') return { ok: false, error: { message: 'Business research bridge is unavailable.' } };
      return surface[method](input);
    }, { method, input });
    assert.equal(result?.ok, true, `${method} failed: ${result?.error?.message ?? 'unknown IPC error'}`);
    return result.data;
  }

  async fillBrief() {
    await this.industry.fill('Electric vehicles');
    await this.question.fill('Compare public product and pricing updates for Northstar Motors and Harbor Auto');
    await this.competitors.fill('Northstar Motors\nHarbor Auto');
    await this.strategy.selectOption('competitor_deep_dive');
  }

  async startFixtureRun() {
    const before = await this.api('listRuns');
    const beforeIds = new Set(before.map((run) => run.id));
    const startedAt = Date.now();
    await this.fixtureMode.click();
    await this.startButton.click();
    const queuedRun = await waitForValue(
      () => this.api('listRuns'),
      (runs) => Array.isArray(runs) && runs.find((item) => !beforeIds.has(item.id)),
      30_000,
      'a newly persisted business research run',
    );
    const run = await waitForValue(
      () => this.api('getRun', { runId: queuedRun.id }),
      (candidate) => candidate && ['completed', 'partial', 'failed', 'cancelled'].includes(candidate.state.status) && candidate.reportId ? candidate : false,
      60_000,
      `terminal state for ${queuedRun.id}`,
    );
    assert.equal(run.mode, 'fixture', `Fixture mode was not persisted: ${JSON.stringify({ queuedRun, run })}`);
    assert.equal(run.state.status, 'completed');
    await this.report.getByText(/Fixture-only example/).waitFor({ state: 'visible', timeout: 15_000 });
    return { run, elapsedMs: Date.now() - startedAt };
  }

  async waitForWorkspace() {
    await this.workspace.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async completeFirstRunSetup() {
    await this.page.getByTestId('onboarding-overlay').waitFor({ state: 'visible', timeout: 30_000 });
    await this.page.getByTestId('disclaimer-accept').check();
    await this.page.getByTestId('onboarding-continue').click();
    await this.page.getByTestId('onboarding-skip').click();
    await this.page.getByTestId('onboarding-overlay').waitFor({ state: 'detached', timeout: 15_000 });
  }
}

let electron;
let browser;
let log;
let primaryError;
let cleanupError;
const timings = [];

try {
  execFileSync('bun', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
  const port = await reserveCdpPort();
  const logPath = join(userDataDirectory, 'electron.log');
  ({ proc: electron, log } = spawnElectron({ appRoot, repoRoot, port, userDataDir: userDataDirectory, logPath, visible: true }));
  await waitForCdp({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000, proc: electron, logPath });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearch), null, { timeout: 30_000 });
  const workspace = new BusinessResearchPage(page);
  await workspace.completeFirstRunSetup();
  await page.getByTestId('finance-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Market Intelligence', exact: true }).click();
  await workspace.waitForWorkspace();
  const initialText = await workspace.workspace.innerText();
  assert.match(initialText, /Research uses publicly accessible information only/);
  assert.match(initialText, /Public feedback is a biased signal/);
  await page.getByTestId('business-research-evaluation').getByText('Deterministic fixture corpus · not live-model performance').waitFor({ state: 'visible' });
  const evaluation = await workspace.api('evaluate');
  assert.equal(evaluation.cases.total, 24);
  assert.equal(evaluation.cases.passed, 24);

  await workspace.fillBrief();
  const first = await workspace.startFixtureRun();
  timings.push({ run: 1, elapsedMs: first.elapsedMs });
  const firstReport = await workspace.api('getReport', { reportId: first.run.reportId });
  assert.equal(firstReport.status, 'completed');
  assert.equal(firstReport.evidence.length, 2);
  assert.ok(firstReport.evidence.every((item) => item.sourceKind === 'fixture' && item.grade === 'fixture_data'));
  const firstEvents = await workspace.api('listEvents', { runId: first.run.id });
  assert.ok(firstEvents.some((event) => event.type === 'decision_made'));
  assert.ok(firstEvents.some((event) => event.type === 'observation_recorded'));
  assert.deepEqual(firstEvents.map((event) => event.sequence), firstEvents.map((event) => event.sequence).toSorted((a, b) => a - b));
  assert.equal(await workspace.report.getByRole('link').count(), 0, 'Fixture source URLs must not be navigable.');
  assert.match(await workspace.report.innerText(), /Illustrative fixture · not a public source/);
  await workspace.report.screenshot({ path: join(artifactDirectory, 'fixture-first-report.png') });

  await page.reload();
  await workspace.waitForWorkspace();
  const reloadedRun = await workspace.api('getRun', { runId: first.run.id });
  assert.equal(reloadedRun.reportId, first.run.reportId, 'The fixture report did not survive renderer reload.');
  assert.equal((await workspace.api('getReport', { reportId: first.run.reportId })).id, firstReport.id);
  assert.equal((await workspace.api('listEvents', { runId: first.run.id })).length, firstEvents.length);
  await workspace.report.getByText(/Fixture-only example/).waitFor({ state: 'visible', timeout: 15_000 });

  await workspace.fillBrief();
  const second = await workspace.startFixtureRun();
  timings.push({ run: 2, elapsedMs: second.elapsedMs });
  const secondReport = await workspace.api('getReport', { reportId: second.run.reportId });
  assert.equal(secondReport.evidence.length, 2);
  await page.getByTestId('business-research-report').getByText('New evidence (2)').waitFor({ state: 'visible', timeout: 15_000 });
  await workspace.report.screenshot({ path: join(artifactDirectory, 'fixture-rerun-diff.png') });

  await page.getByRole('combobox', { name: 'Check interval', exact: true }).selectOption('3600000');
  await workspace.subscribeButton.click();
  const subscribed = await page.waitForFunction(async () => {
    const result = await window.electronAPI.businessResearch.listSubscriptions();
    return result?.ok && result.data?.length ? result.data[0] : false;
  }, null, { timeout: 15_000 });
  const subscription = await subscribed.jsonValue();
  const monitorRow = page.getByTestId(`business-research-monitor-${subscription.id}`);
  await monitorRow.getByRole('button', { name: 'Pause' }).click();
  await page.waitForFunction(async (subscriptionId) => {
    const result = await window.electronAPI.businessResearch.listSubscriptions();
    return result?.ok && result.data?.find((item) => item.id === subscriptionId)?.enabled === false;
  }, subscription.id, { timeout: 15_000 });

  await page.reload();
  await workspace.waitForWorkspace();
  const pausedSubscription = (await workspace.api('listSubscriptions')).find((item) => item.id === subscription.id);
  assert.equal(pausedSubscription?.enabled, false, 'Paused monitor state did not persist after reload.');
  await page.getByTestId(`business-research-monitor-${subscription.id}`).getByRole('button', { name: 'Resume' }).waitFor({ state: 'visible' });
  await monitorRow.screenshot({ path: join(artifactDirectory, 'fixture-monitor-paused.png') });

  execFileSync('bun', ['e2e/business-research-monitor-fixture.ts', artifactDirectory], { cwd: appRoot, stdio: 'inherit' });
  mkdirSync(artifactDirectory, { recursive: true });
  const monitorVerification = await import('node:fs/promises').then(({ readFile }) => readFile(join(artifactDirectory, 'monitor-fixture-verification.json'), 'utf8'));
  const monitor = JSON.parse(monitorVerification);
  assert.equal(monitor.verificationMode, 'deterministic-fixture-only');
  assert.equal(monitor.researchRunsPersisted, 2);
  assert.equal(monitor.duplicateSuppressed, true);
  assert.deepEqual(monitor.checks.map((check) => check.reason), ['new_source', 'source_updated', 'duplicate_signal']);

  const report = {
    schemaVersion: 1,
    verificationMode: 'deterministic-fixture-only',
    generatedAt: new Date().toISOString(),
    electronUi: {
      fixtureRunCount: 2,
      fixtureEvaluation: { passed: evaluation.cases.passed, total: evaluation.cases.total },
      firstRunElapsedMs: first.elapsedMs,
      secondRunElapsedMs: second.elapsedMs,
      evidenceRecordsPerRun: 2,
      citationGrade: 'fixture_data',
      reloadPersistence: true,
      rerunDiffNewEvidence: 2,
      subscriptionCreated: true,
      pausePersistedAfterReload: true,
    },
    monitorIntegration: monitor,
    liveModelCounterfactuals: 'not verified by this fixture-only run',
    livePublicChangeTrigger: 'not verified by this fixture-only run',
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(artifactDirectory, 'fixture-verification.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`PASS business-research Electron fixture flow: 2 persisted UI runs, ${evaluation.cases.passed}/${evaluation.cases.total} fixture cases, reload/diff/monitor pause verified.`);
  console.log(`TIMING fixture-ui-runs-ms=${JSON.stringify(timings.map((item) => item.elapsedMs))}`);
} catch (error) {
  primaryError = error;
} finally {
  await browser?.close().catch(() => {});
  if (electron && electron.exitCode == null && electron.signalCode == null) {
    const exited = once(electron, 'exit');
    electron.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  if (log) {
    log.end();
    if (!log.closed) await once(log, 'close');
  }
  assertSafeTemporaryPath(userDataDirectory);
  try {
    rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    cleanupError = error;
  }
}
if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;

function assertSafeTemporaryPath(path) {
  const relativePath = relative(resolve(tmpdir()), resolve(path));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Refusing to clean an E2E profile outside its unique OS temporary directory.');
  }
}

async function waitForValue(read, matches, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    const matched = matches(value);
    if (matched) return matched === true ? value : matched;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
