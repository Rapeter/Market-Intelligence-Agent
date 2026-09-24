import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { reserveCdpPort, spawnElectron, waitForCdp } from './electron-harness.mjs';

export const LIVE_PROFILE_MARKER_NAME = '.market-intelligence-live-e2e.json';
const LIVE_PROFILE_MARKER = Object.freeze({ purpose: 'market-intelligence-agent-live-e2e', schemaVersion: 1 });
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');

export function prepareLiveProfile(profileDirectory, repositoryRoot = repoRoot) {
  const profile = resolveSafeProfilePath(profileDirectory, repositoryRoot);
  const markerPath = join(profile, LIVE_PROFILE_MARKER_NAME);
  if (existsSync(profile)) {
    if (!statSync(profile).isDirectory()) throw new Error('The live profile path must be a directory.');
    const entries = readdirSync(profile);
    if (entries.length > 0) {
      if (entries.length !== 1 || entries[0] !== LIVE_PROFILE_MARKER_NAME) {
        throw new Error('Refusing to mark a non-empty directory as a live test profile.');
      }
      assertMarker(markerPath);
      return { ready: true, profileDirectory: profile, markerPath };
    }
  } else {
    mkdirSync(profile, { recursive: true });
    resolveSafeProfilePath(profile, repositoryRoot);
  }

  writeFileSync(markerPath, `${JSON.stringify(LIVE_PROFILE_MARKER, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
  return { ready: true, profileDirectory: profile, markerPath };
}

export function assertLiveProfile(profileDirectory, repositoryRoot = repoRoot) {
  const profile = resolveSafeProfilePath(profileDirectory, repositoryRoot);
  if (!existsSync(profile) || !statSync(profile).isDirectory()) {
    throw new Error('The live profile is not prepared; run the profile prepare command first.');
  }
  const markerPath = join(profile, LIVE_PROFILE_MARKER_NAME);
  assertMarker(markerPath);
  return { ready: true, profileDirectory: profile, markerPath };
}

export function createEphemeralLogDirectory(profileDirectory, temporaryRoot = tmpdir(), repositoryRoot = repoRoot) {
  const profile = assertLiveProfile(profileDirectory, repositoryRoot).profileDirectory;
  if (typeof temporaryRoot !== 'string' || !isAbsolute(temporaryRoot)) {
    throw new Error('The temporary log root must be absolute.');
  }

  const actualTemporaryRoot = realpathSync(temporaryRoot);
  const repository = realpathSync(repositoryRoot);
  if (isSameOrChildPath(actualTemporaryRoot, profile) || isSameOrChildPath(actualTemporaryRoot, repository)) {
    throw new Error('The temporary log root must be outside the profile and repository.');
  }

  const logDirectory = mkdtempSync(join(actualTemporaryRoot, 'market-intelligence-live-e2e-'));
  const actualLogDirectory = realpathSync(logDirectory);
  if (isSameOrChildPath(actualLogDirectory, profile) || isSameOrChildPath(actualLogDirectory, repository)) {
    rmSync(logDirectory, { recursive: true, force: true });
    throw new Error('The temporary log directory resolved inside the profile or repository.');
  }
  return actualLogDirectory;
}

function resolveSafeProfilePath(profileDirectory, repositoryRoot) {
  if (typeof profileDirectory !== 'string' || !isAbsolute(profileDirectory)) {
    throw new Error('The live profile path must be absolute.');
  }
  if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot)) {
    throw new Error('The repository root must be absolute.');
  }

  const profile = resolve(profileDirectory);
  const repo = realpathSync(repositoryRoot);
  const existingAncestor = nearestExistingAncestor(profile);
  const actualProfile = resolve(realpathSync(existingAncestor), relative(existingAncestor, profile));
  if (isSameOrChildPath(actualProfile, repo)) {
    throw new Error('The live profile must be outside the repository.');
  }
  return profile;
}

function nearestExistingAncestor(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error('The live profile path has no existing parent directory.');
    current = parent;
  }
  return current;
}

function isSameOrChildPath(candidate, parent) {
  const childPath = relative(parent, candidate);
  return childPath === '' || (!childPath.startsWith(`..${sep}`) && childPath !== '..' && !isAbsolute(childPath));
}

function assertMarker(markerPath) {
  if (!existsSync(markerPath)) throw new Error('The live profile is not prepared; run the profile prepare command first.');
  let value;
  try {
    value = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch {
    throw new Error('The live profile marker is invalid.');
  }
  if (value?.purpose !== LIVE_PROFILE_MARKER.purpose || value?.schemaVersion !== LIVE_PROFILE_MARKER.schemaVersion) {
    throw new Error('The live profile marker is invalid.');
  }
}

async function openLiveProfile(profileDirectory) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('The profile setup command requires an interactive terminal.');
  const profile = assertLiveProfile(profileDirectory).profileDirectory;
  execFileSync('bun', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });

  const port = await reserveCdpPort();
  const logDirectory = createEphemeralLogDirectory(profile);
  const logPath = join(logDirectory, 'electron.log');
  const { proc, log } = spawnElectron({
    appRoot,
    repoRoot,
    port,
    userDataDir: profile,
    logPath,
    visible: true,
    agentProvider: 'pi-runtime',
  });
  let browser;
  let prompt;
  try {
    await waitForCdp({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000, proc, logPath });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
    const page = browser.contexts()[0].pages()[0];
    if (!page) throw new Error('The business-research window did not open.');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI?.businessResearch), null, { timeout: 30_000 });
    console.log('Configure the model provider in Settings and the Brave key in Market Intelligence.');
    console.log('Credentials are stored by the app in this dedicated profile, not in the marker or repository.');
    prompt = createInterface({ input: stdin, output: stdout });
    await prompt.question('When configuration is saved, press Enter here to close the setup window. ');
  } finally {
    prompt?.close();
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
}

async function main() {
  const [mode, profileDirectory] = process.argv.slice(2);
  if (!profileDirectory) throw new Error('Pass an absolute live-profile path.');
  if (mode === 'prepare') {
    const result = prepareLiveProfile(profileDirectory);
    console.log(`Dedicated live profile prepared at ${result.profileDirectory}`);
    return;
  }
  if (mode === 'open') {
    await openLiveProfile(profileDirectory);
    return;
  }
  throw new Error('Mode must be prepare or open.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Live profile setup failed.');
    process.exitCode = 1;
  });
}
