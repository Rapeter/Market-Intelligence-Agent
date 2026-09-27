import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
const userDataDirectory = mkdtempSync(join(tmpdir(), 'market-intelligence-business-research-e2e-'));
assertSafeTemporaryPath(userDataDirectory);
mkdirSync(artifactDirectory, { recursive: true });
seedLocale(userDataDirectory, 'en-US');

class BusinessResearchPage {
  constructor(page) {
    this.page = page;
    this.workspace = page.getByTestId('business-research-workspace');
    this.agent = page.getByTestId('business-research-agent-panel');
    this.agentInput = page.getByTestId('business-research-agent-input');
    this.agentSubmit = page.getByTestId('business-research-agent-submit');
    this.report = page.getByTestId('business-research-report');
    this.subscribeButton = page.getByTestId('business-research-subscribe-monitor');
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

  async createProject() {
    await this.page.getByRole('button', { name: 'New project', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Northstar enterprise research');
    await this.page.getByRole('textbox', { name: 'Industry', exact: true }).fill('Electric vehicles');
    await this.page.getByRole('textbox', { name: 'Competitors', exact: true }).fill('Northstar Motors\nHarbor Auto');
    await this.page.getByRole('button', { name: 'Create project', exact: true }).click();
    const project = await waitForValue(
      () => this.api('listProjects'),
      (projects) => projects.find((item) => item.title === 'Northstar enterprise research'),
      15_000,
      'the newly created research project',
    );
    await this.workspace.waitFor({ state: 'visible', timeout: 15_000 });
    await this.agent.waitFor({ state: 'visible', timeout: 15_000 });
    return project;
  }

  async startFixtureRun(question, expectedProjectId, parentRunId) {
    const before = await this.api('listRuns');
    const beforeIds = new Set(before.map((run) => run.id));
    const startedAt = Date.now();
    await this.agentInput.fill(question);
    await this.agent.getByRole('combobox', { name: 'Run mode', exact: true }).selectOption('fixture');
    await this.agentSubmit.click();
    const queuedRun = await waitForValue(
      () => this.api('listRuns'),
      (runs) => runs.find((item) => !beforeIds.has(item.id)),
      30_000,
      'a newly persisted Agent research run',
    );
    let run;
    try {
      run = await waitForValue(
        () => this.api('getRun', { runId: queuedRun.id }),
        (candidate) => candidate && ['completed', 'partial', 'failed', 'cancelled'].includes(candidate.state.status) ? candidate : false,
        60_000,
        `terminal state for ${queuedRun.id}`,
      );
    } catch (error) {
      const [lastRun, events] = await Promise.all([
        this.api('getRun', { runId: queuedRun.id }),
        this.api('listEvents', { runId: queuedRun.id }),
      ]);
      const diagnostic = {
        id: lastRun?.id,
        mode: lastRun?.mode,
        status: lastRun?.state?.status,
        state: lastRun?.state,
        reportId: lastRun?.reportId,
        eventTypes: events.map((event) => event.type),
        lastEvent: events.at(-1),
      };
      throw new Error(`${error instanceof Error ? error.message : 'Run wait failed'} Persisted run diagnosis: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    assert.equal(run.mode, 'fixture');
    assert.equal(run.projectId, expectedProjectId, 'Agent run was not attributed to the active project.');
    assert.equal(run.parentRunId ?? null, parentRunId ?? null, 'Agent follow-up did not retain its parent run link.');
    assert.equal(run.state.status, 'completed', `Fixture run did not complete with a report: ${JSON.stringify({ state: run.state, reportId: run.reportId })}`);
    assert.ok(run.reportId, 'Completed fixture run did not persist a report.');
    const report = await this.api('getReport', { reportId: run.reportId });
    await this.report.getByText(/Fixture-only example/).waitFor({ state: 'visible', timeout: 15_000 });
    return { run, report, elapsedMs: Date.now() - startedAt };
  }

  async waitForProject() {
    await this.workspace.waitFor({ state: 'visible', timeout: 30_000 });
    await this.agent.waitFor({ state: 'visible', timeout: 30_000 });
  }
}

let electron;
let browser;
let log;
let electronLogPath;
let primaryError;
let cleanupError;

try {
  execFileSync('bun', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
  const port = await reserveCdpPort();
  const logPath = join(userDataDirectory, 'electron.log');
  electronLogPath = logPath;
  const visible = !process.argv.includes('--hidden');
  ({ proc: electron, log } = spawnElectron({ appRoot, repoRoot, port, userDataDir: userDataDirectory, logPath, visible }));
  await waitForCdp({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000, proc: electron, logPath });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearch), null, { timeout: 30_000 });
  for (const control of ['Minimize window', 'Maximize window', 'Close window']) {
    await page.getByRole('button', { name: control, exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const bridgeKeys = await page.evaluate(() => Object.keys(window.electronAPI));
  assert.doesNotMatch(bridgeKeys.join(' '), /market|longbridge|portfolio|screening|thesis|stock|quote|security/iu,
    'The renderer preload still exposes a finance-specific IPC surface.');

  const workspace = new BusinessResearchPage(page);
  const project = await workspace.createProject();
  const initialText = await page.locator('body').innerText();
  assert.match(initialText, /Research uses publicly accessible information only/);
  assert.match(initialText, /Public feedback is a biased signal/);
  assertNoFinanceProductCopy(initialText);
  const evaluation = await workspace.api('evaluate');
  assert.equal(evaluation.cases.total, 24);
  assert.equal(evaluation.cases.passed, 24);
  assert.equal(evaluation.cases.failed, 0);
  assert.equal(evaluation.cases.excluded, 0);

  const first = await workspace.startFixtureRun(
    'Compare recent public product launch evidence for Northstar Motors and Harbor Auto.',
    project.id,
  );
  const firstEvents = await workspace.api('listEvents', { runId: first.run.id });
  assert.equal(first.report.status, 'completed');
  assert.equal(first.report.evidence.length, 2);
  assert.ok(first.report.evidence.every((item) => item.sourceKind === 'fixture' && item.grade === 'fixture_data'));
  assert.ok(firstEvents.some((event) => event.type === 'decision_made'));
  assert.ok(firstEvents.some((event) => event.type === 'observation_recorded'));
  assert.deepEqual(firstEvents.map((event) => event.sequence), firstEvents.map((event) => event.sequence).toSorted((a, b) => a - b));
  assert.equal(await workspace.report.getByRole('link').count(), 0, 'Fixture source URLs must not be navigable.');
  assert.match(await workspace.report.innerText(), /Illustrative fixture · not a public source/);
  await page.screenshot({ path: join(artifactDirectory, 'fixture-first-report.png'), animations: 'disabled' });

  await page.reload();
  await workspace.waitForProject();
  const reloadedRun = await workspace.api('getRun', { runId: first.run.id });
  assert.equal(reloadedRun.projectId, project.id);
  assert.equal(reloadedRun.reportId, first.run.reportId, 'The fixture report did not survive renderer reload.');
  assert.equal((await workspace.api('getReport', { reportId: first.run.reportId })).id, first.report.id);
  assert.equal((await workspace.api('listEvents', { runId: first.run.id })).length, firstEvents.length);
  await workspace.report.getByText(/Fixture-only example/).waitFor({ state: 'visible', timeout: 15_000 });

  const followUp = await workspace.startFixtureRun(
    'Follow up by checking which claims have the strongest public source evidence.',
    project.id,
    first.run.id,
  );
  assert.equal(followUp.run.parentRunId, first.run.id);
  assert.ok(followUp.report.evidence.length > 0);
  await page.screenshot({ path: join(artifactDirectory, 'fixture-follow-up-report.png'), animations: 'disabled' });

  await page.getByRole('combobox', { name: 'Check interval', exact: true }).selectOption('3600000');
  await workspace.subscribeButton.click();
  const subscription = await waitForValue(
    () => workspace.api('listSubscriptions'),
    (subscriptions) => subscriptions.find((item) => item.projectId === project.id),
    15_000,
    'a project-scoped monitoring subscription',
  );
  assert.equal(subscription.projectId, project.id);
  assert.equal(subscription.task.question, followUp.run.task.question, 'Monitoring did not use the selected follow-up research topic.');
  const monitorRow = page.getByTestId(`business-research-monitor-${subscription.id}`);
  await monitorRow.getByRole('button', { name: 'Pause' }).click();
  await page.waitForFunction(async (subscriptionId) => {
    const result = await window.electronAPI.businessResearch.listSubscriptions();
    return result?.ok && result.data?.find((item) => item.id === subscriptionId)?.enabled === false;
  }, subscription.id, { timeout: 15_000 });

  await page.reload();
  await workspace.waitForProject();
  const persistedRuns = await workspace.api('listRuns');
  const persistedSubscription = (await workspace.api('listSubscriptions')).find((item) => item.id === subscription.id);
  assert.ok(persistedRuns.some((item) => item.id === followUp.run.id && item.projectId === project.id && item.parentRunId === first.run.id));
  assert.equal(persistedSubscription?.enabled, false, 'Paused monitor state did not persist after reload.');
  assert.equal(persistedSubscription?.projectId, project.id, 'Monitor project attribution did not persist after reload.');
  await page.getByTestId(`business-research-monitor-${subscription.id}`).getByRole('button', { name: 'Resume' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(artifactDirectory, 'fixture-monitor-paused.png'), animations: 'disabled' });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settingsText = await page.locator('body').innerText();
  assertNoFinanceProductCopy(settingsText);
  assert.match(settingsText, /\bModels\b/);

  execFileSync('bun', ['e2e/business-research-monitor-fixture.ts', artifactDirectory], { cwd: appRoot, stdio: 'inherit' });
  const { readFile, writeFile } = await import('node:fs/promises');
  const monitor = JSON.parse(await readFile(join(artifactDirectory, 'monitor-fixture-verification.json'), 'utf8'));
  assert.equal(monitor.verificationMode, 'deterministic-fixture-only');
  assert.equal(monitor.researchRunsPersisted, 2);
  assert.equal(monitor.triggeredRunsRetainProject, true);
  assert.equal(monitor.duplicateSuppressed, true);
  assert.deepEqual(monitor.checks.map((check) => check.reason), ['new_source', 'source_updated', 'duplicate_signal']);

  const report = {
    schemaVersion: 2,
    verificationMode: 'deterministic-fixture-only',
    verificationPlatform: process.platform,
    generatedAt: new Date().toISOString(),
    evaluationMetrics: evaluation,
    electronUi: {
      projectCreated: true,
      projectScopedRuns: 2,
      followUpLinkedToParent: followUp.run.parentRunId === first.run.id,
      fixtureEvaluation: { passed: evaluation.cases.passed, total: evaluation.cases.total },
      firstRunElapsedMs: first.elapsedMs,
      followUpRunElapsedMs: followUp.elapsedMs,
      evidenceRecordsPerRun: [first.report.evidence.length, followUp.report.evidence.length],
      reloadPersistence: true,
      subscriptionCreatedForProject: true,
      pausedSubscriptionAndProjectPersistedAfterReload: true,
      financeProductCopyAbsentFromWorkspaceAndSettings: true,
    },
    monitorIntegration: monitor,
    liveModelCounterfactuals: 'not verified by this fixture-only run',
    livePublicChangeTrigger: 'not verified by this fixture-only run',
  };
  const artifactPath = join(artifactDirectory, 'fixture-verification.json');
  await writeFile(artifactPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  const persistedReport = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.deepEqual(persistedReport.evaluationMetrics, evaluation, 'Persisted metric report must match measured evaluation result.');
  assert.equal(persistedReport.verificationPlatform, process.platform);
  console.log(`PASS enterprise research Electron flow: project, 2 linked fixture runs, ${evaluation.cases.passed}/${evaluation.cases.total} cases, reload, and project-scoped monitoring verified.`);
} catch (error) {
  primaryError = error;
} finally {
  await browser?.close().catch(() => {});
  if (electron && electron.exitCode == null && electron.signalCode == null) {
    const exited = once(electron, 'exit');
    electron.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))]);
  }
  if (log) {
    log.end();
    if (!log.closed) await once(log, 'close');
  }
  if (primaryError && electronLogPath) {
    try {
      console.error('Electron diagnostic log:\n' + readFileSync(electronLogPath, 'utf8'));
    } catch (error) {
      console.error('Could not read Electron diagnostic log:', error);
    }
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

function assertNoFinanceProductCopy(text) {
  assert.doesNotMatch(text, /\b(?:stocks?|quotes?|portfolio|longbridge|investment thesis|screening)\b/iu,
    'A finance-product feature is visible in the enterprise research workspace.');
}

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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
