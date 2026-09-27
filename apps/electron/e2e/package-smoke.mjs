import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildElectronEnvironment, reserveCdpPort, waitForCdp } from './electron-harness.mjs';
import { terminateProcessTree } from './process-tree.mjs';
import { seedLocale } from './seed-locale.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = new URL('.', import.meta.url);
const appRoot = fileURLToPath(new URL('..', here));
const repoRoot = resolve(appRoot, '../..');
const packageMetadata = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(appRoot, 'package.json'), 'utf8')));
const distDirectory = join(repoRoot, 'dist', 'electron');
const requestedAppBinary = process.env.FINAGENT_PACKAGE_SMOKE_BINARY;
if (requestedAppBinary && !isAbsolute(requestedAppBinary)) {
  throw new Error('FINAGENT_PACKAGE_SMOKE_BINARY must be an absolute path.');
}
const appBinary = requestedAppBinary ?? join(distDirectory, 'win-unpacked', `${packageMetadata.build.productName}.exe`);
if (process.platform !== 'win32') throw new Error('Packaged smoke acceptance must run on Windows.');
if (!existsSync(appBinary)) throw new Error(`Packaged Windows app not found at ${appBinary}. Run bun run release:package first.`);

const userDataDirectory = mkdtempSync(join(tmpdir(), 'market-intelligence-packaged-smoke-'));
assertSafeTemporaryPath(userDataDirectory);
seedLocale(userDataDirectory, 'en-US');
const port = await reserveCdpPort();
const logPath = join(userDataDirectory, 'electron.log');
const appEnvironment = buildElectronEnvironment({ userDataDir: userDataDirectory, agentProvider: 'pi-runtime' });
delete appEnvironment.FINAGENT_PI_COMMAND;
const appProcess = spawn(appBinary, [
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  '--no-sandbox',
  '--disable-gpu',
], {
  cwd: tmpdir(),
  stdio: 'ignore',
  env: { ...appEnvironment, FINAGENT_PACKAGED: '1' },
});

let browser;
let primaryError;
let cleanupError;
const rendererDiagnostics = [];
try {
  await waitForCdp({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000, proc: appProcess, logPath });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30_000 });
  page.on('pageerror', (error) => rendererDiagnostics.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') rendererDiagnostics.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearch), null, { timeout: 30_000 });
  const runtimeState = await page.evaluate(() => window.electronAPI.llm.getState());
  assert.equal(runtimeState?.ok, true, `The packaged Pi runtime did not start: ${runtimeState?.error?.message ?? 'unknown IPC error'}`);
  assert.equal(runtimeState?.data?.runtimeProvider, 'pi-runtime');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Packaged desktop smoke');
  await page.getByRole('textbox', { name: 'Industry', exact: true }).fill('Enterprise software');
  await page.getByRole('textbox', { name: 'Competitors', exact: true }).fill('Northstar Systems\nHarbor Cloud');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByTestId('business-research-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  const result = await page.evaluate(() => window.electronAPI.businessResearch.listProjects());
  assert.equal(result?.ok, true, 'Packaged preload could not access the project API.');
  const project = result.data.find((item) => item.title === 'Packaged desktop smoke');
  assert.ok(project, 'The packaged app did not persist a newly created project.');
  const visibleText = await page.locator('body').innerText();
  assert.doesNotMatch(visibleText, /\b(?:stocks?|quotes?|portfolio|longbridge|investment thesis|screening)\b/iu);
  console.log(`PASS packaged Windows app: created project ${project.id} through the bundled UI and preload.`);
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  const pageState = page
    ? await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        text: document.body?.innerText?.slice(0, 4000) ?? '',
        buttons: [...document.querySelectorAll('button')].map((button) => button.innerText.trim()).filter(Boolean),
      })).catch((diagnosticError) => ({ evaluationError: diagnosticError.message }))
    : null;
  primaryError = new Error(`${error instanceof Error ? error.message : error}. Packaged renderer state: ${JSON.stringify({ pageState, rendererDiagnostics })}`, { cause: error });
} finally {
  await browser?.close().catch(() => undefined);
  try {
    await terminateProcessTree(appProcess);
  } catch (error) {
    cleanupError = error;
  }
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
    assertSafeTemporaryPath(userDataDirectory);
    try {
      rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      cleanupError ??= error;
    }
  } else {
    cleanupError ??= new Error('The packaged smoke app is still running; refusing to delete its temporary profile.');
  }
}
if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;

function assertSafeTemporaryPath(path) {
  const relativePath = relative(resolve(tmpdir()), resolve(path));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Refusing to clean a packaged smoke profile outside its unique OS temporary directory.');
  }
}
