import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { assertLiveProfile, createEphemeralLogDirectory } from './business-research-live-profile.mjs';
import { reserveCdpPort, spawnElectron, waitForCdp } from './electron-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');
const artifactDirectory = resolve(repoRoot, 'docs/demos/business-research');
const artifactPath = join(artifactDirectory, 'live-verification.json');
const profileDirectory = process.env.FINAGENT_LIVE_E2E_USER_DATA_DIR;
const acceptanceTask = {
  industry: 'Electric vehicles',
  question: 'Identify one currently published public product or pricing fact for either Tesla or Rivian. If supplied page evidence contains a relevant fact, finish; if no evidence is supplied, search for a public source.',
  competitors: ['Tesla', 'Rivian'],
  strategyId: 'competitor_deep_dive',
};

function ipcError(result, method) {
  const code = result?.error?.code;
  const message = result?.error?.message;
  return new Error(`${method} failed${code ? ` (${code})` : ''}${message ? `: ${message}` : '.'}`);
}

async function invokeBusinessResearch(page, method, input = {}) {
  const result = await page.evaluate(async ({ method, input }) => {
    const api = window.electronAPI?.businessResearch;
    const operation = api?.[method];
    if (typeof operation !== 'function') return { ok: false, error: { code: 'BRIDGE_UNAVAILABLE' } };
    return operation(input);
  }, { method, input });
  if (result?.ok !== true) throw ipcError(result, method);
  return result.data;
}

async function invokeLiveE2e(page, method, input = {}) {
  const result = await page.evaluate(async ({ method, input }) => {
    const api = window.electronAPI?.businessResearchLiveE2e;
    const operation = api?.[method];
    if (typeof operation !== 'function') return { ok: false, error: { code: 'LIVE_E2E_BRIDGE_UNAVAILABLE' } };
    return operation(input);
  }, { method, input });
  if (result?.ok !== true) throw ipcError(result, method);
  return result.data;
}

async function readConfiguredModel(page) {
  const result = await page.evaluate(() => window.electronAPI?.llm?.getState());
  if (result?.ok !== true) throw ipcError(result, 'llm.getState');
  const model = result.data?.model;
  if (typeof model?.provider !== 'string' || typeof model?.id !== 'string') {
    throw new Error('Select a model in Settings in the dedicated live profile before acceptance.');
  }
  return { provider: model.provider, id: model.id };
}

async function completeFirstRunSetup(page) {
  const overlay = page.getByTestId('onboarding-overlay');
  if (await overlay.isVisible()) {
    throw new Error('Complete the first-run onboarding in the dedicated profile, then rerun live acceptance.');
  }
}

function buildAcceptanceArtifact({ model, counterfactual, monitor, elapsedMs }) {
  return {
    schemaVersion: 1,
    status: 'passed',
    recordedAt: new Date().toISOString(),
    model,
    counterfactual: {
      requiredPairs: 2,
      observedPairs: counterfactual.pairs.length,
      divergentPairs: counterfactual.pairs.filter((pair) => pair.diverged).length,
      pairs: counterfactual.pairs,
    },
    liveMonitor: {
      checkDecision: {
        kind: monitor.check.decision.kind,
        reason: monitor.check.decision.reason,
      },
      checkCompletedAt: monitor.check.completedAt,
      followUpRun: monitor.followUpRun,
    },
    totalElapsedMs: elapsedMs,
    safety: {
      credentialsIncluded: false,
      rawPageTextIncluded: false,
      networkMode: 'real public Brave Search and configured model provider',
    },
  };
}

async function main() {
  if (!profileDirectory) {
    throw new Error('Set FINAGENT_LIVE_E2E_USER_DATA_DIR to the marked dedicated profile path.');
  }
  const profile = assertLiveProfile(profileDirectory, repoRoot).profileDirectory;
  execFileSync('bun', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });

  const startedAt = Date.now();
  const logDirectory = createEphemeralLogDirectory(profile, tmpdir(), repoRoot);
  const logPath = join(logDirectory, 'electron.log');
  const port = await reserveCdpPort();
  const { proc, log } = spawnElectron({
    appRoot,
    repoRoot,
    port,
    userDataDir: profile,
    logPath,
    visible: true,
    agentProvider: 'pi-runtime',
    liveE2e: true,
  });

  let browser;
  let page;
  let subscriptionId;
  let primaryError;
  let cleanupError;
  let acceptanceArtifact;
  try {
    await waitForCdp({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000, proc, logPath });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearchLiveE2e), null, { timeout: 30_000 });
    await completeFirstRunSetup(page);

    const model = await readConfiguredModel(page);
    const braveStatus = await invokeBusinessResearch(page, 'getCredentialStatus');
    assert.equal(braveStatus.configured, true, 'Configure Brave Search in Market Intelligence before acceptance.');

    const counterfactual = await invokeLiveE2e(page, 'runCounterfactualProbes', { task: acceptanceTask });
    assert.equal(counterfactual.pairs?.length, 2, 'Two evidence counterfactual pairs are required.');
    assert.equal(counterfactual.pairs.filter((pair) => pair.diverged).length, 2,
      'Both same-task pairs must produce a different valid next decision or search direction.');

    const subscription = await invokeBusinessResearch(page, 'subscribe', {
      task: acceptanceTask,
      intervalMs: 60 * 60 * 1_000,
    });
    subscriptionId = subscription.id;
    const monitor = await invokeLiveE2e(page, 'checkSubscriptionNow', { subscriptionId });
    assert.equal(monitor.check?.decision?.kind, 'trigger', 'The real public probe did not trigger follow-up research.');
    assert.equal(monitor.followUpRun?.mode, 'live', 'Monitor follow-up was not a live research run.');
    assert.ok(['completed', 'partial'].includes(monitor.followUpRun?.status),
      `Live monitor follow-up did not produce a report: ${monitor.followUpRun?.status ?? 'missing run'}`);
    assert.equal(typeof monitor.followUpRun?.reportId, 'string', 'Live monitor follow-up did not persist a report.');

    acceptanceArtifact = buildAcceptanceArtifact({ model, counterfactual, monitor, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    primaryError = error;
  } finally {
    if (subscriptionId && page) {
      try {
        await invokeBusinessResearch(page, 'unsubscribe', { subscriptionId });
      } catch {
        cleanupError = new Error('Could not pause the temporary acceptance subscription.');
      }
    }
    await browser?.close().catch(() => undefined);
    if (proc.exitCode == null && proc.signalCode == null) {
      const exited = once(proc, 'exit');
      proc.kill();
      await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))]);
    }
    log.end();
    if (!log.closed) await once(log, 'close');
    rmSync(logDirectory, { recursive: true, force: true });
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  if (!acceptanceArtifact) throw new Error('Live acceptance completed without a result artifact.');

  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(acceptanceArtifact, null, 2)}\n`, { encoding: 'utf8' });
  console.log(`Live business-research acceptance passed; redacted evidence saved to ${artifactPath}`);
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? ` (${error.code})` : '';
  console.error(`Live business-research acceptance failed${code}: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
