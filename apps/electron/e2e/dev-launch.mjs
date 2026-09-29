import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { reserveCdpPort, waitForCdp } from './electron-harness.mjs';
import { terminateProcessTree } from './process-tree.mjs';
import { seedLocale } from './seed-locale.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const tempRoot = resolve(tmpdir());
const userDataDirectory = mkdtempSync(join(tempRoot, 'enterprise-research-dev-launch-'));
assert.ok(userDataDirectory.startsWith(`${tempRoot}${process.platform === 'win32' ? '\\' : '/'}`), 'Temporary user data must remain under the OS temp directory.');
seedLocale(userDataDirectory, 'en-US');

const cdpPort = await reserveCdpPort();
const logPath = join(userDataDirectory, 'dev-launch.log');
const log = createWriteStream(logPath, { flags: 'w' });
const heldVitePort = await holdDefaultVitePortIfAvailable();
let dev;
let browser;
let primaryError;

try {
  dev = spawn('bun', ['run', 'dev'], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FINAGENT_E2E_CDP_PORT: String(cdpPort),
      FINAGENT_E2E_HIDDEN: '0',
      FINAGENT_E2E_VISIBLE: '1',
      FINAGENT_USER_DATA_DIR: userDataDirectory,
      FINAGENT_FORCE_PROD_LOAD: '0',
    },
  });
  dev.stdout.on('data', (chunk) => log.write(chunk));
  dev.stderr.on('data', (chunk) => log.write(chunk));

  await waitForCdp({
    url: `http://127.0.0.1:${cdpPort}`,
    timeoutMs: 60_000,
    proc: dev,
    logPath,
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 30_000 });
  const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page', { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearch), null, { timeout: 30_000 });
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'New project', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  const visibleWindowPid = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "$window = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Enterprise Research Workbench' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($null -eq $window) { exit 1 }; $window.Id",
  ], { encoding: 'utf8' }).trim();
  assert.match(visibleWindowPid, /^\d+$/, 'The Electron BrowserWindow must be visible to the user.');

  const rendererUrl = new URL(page.url());
  assert.equal(rendererUrl.hostname, '127.0.0.1', 'The development renderer must bind to loopback only.');
  assert.notEqual(rendererUrl.port, '5173', 'The development launcher must select a local port instead of relying on 5173.');
  await page.evaluate(() => window.electronAPI.window.close());
  await waitForProcessExit(dev, 20_000);
  const rendererStillResponds = await fetch(rendererUrl).then((response) => response.ok).catch(() => false);
  assert.equal(rendererStillResponds, false, 'The Vite server must stop when the Electron window closes.');
  console.log(`PASS desktop dev launcher: Electron loaded ${rendererUrl.origin} with its business-research bridge.`);
} catch (error) {
  primaryError = error;
} finally {
  await browser?.close().catch(() => {});
  if (dev && dev.exitCode == null && dev.signalCode == null) {
    await terminateProcessTree(dev).catch((error) => {
      primaryError ??= error;
    });
  }
  await new Promise((resolve, reject) => log.end((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => heldVitePort?.close((error) => error ? reject(error) : resolve()) ?? resolve());
  if (primaryError) {
    console.error('Desktop launcher output:\n' + readFileSync(logPath, 'utf8'));
  }
  rmSync(userDataDirectory, { recursive: true, force: true });
}

if (primaryError) {
  console.error(`Desktop dev launcher regression failed. Log: ${logPath}`);
  throw primaryError;
}

async function holdDefaultVitePortIfAvailable() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 5173 }, resolve);
    });
    return server;
  } catch (error) {
    await new Promise((resolve) => server.close(() => resolve()));
    if (error?.code === 'EADDRINUSE') return null;
    throw error;
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Desktop dev launcher did not stop within ${timeoutMs}ms after the window closed.`));
    }, timeoutMs);
    timeout.unref?.();

    function onExit() {
      clearTimeout(timeout);
      resolve();
    }

    child.once('exit', onExit);
  });
}
