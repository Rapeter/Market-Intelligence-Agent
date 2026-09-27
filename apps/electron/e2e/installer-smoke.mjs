import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const appRoot = fileURLToPath(new URL('..', here));
const repoRoot = resolve(appRoot, '../..');
const packageMetadata = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const productName = packageMetadata.build.productName;
const installerName = `${productName} Setup ${packageMetadata.version}.exe`;
const installerPath = join(repoRoot, 'dist', 'electron', installerName);

if (process.platform !== 'win32') throw new Error('Installer acceptance must run on Windows.');
if (!existsSync(installerPath)) throw new Error(`Windows installer not found at ${installerPath}. Run bun run release:package first.`);

const temporaryRoot = mkdtempSync(join(tmpdir(), 'enterprise-research-installer-smoke-'));
const installDirectory = join(temporaryRoot, 'installed-app');
assertSafeTemporaryPath(temporaryRoot, tmpdir());
assertSafeTemporaryPath(installDirectory, temporaryRoot);
const installedBinary = join(installDirectory, `${productName}.exe`);
const uninstaller = join(installDirectory, `Uninstall ${productName}.exe`);
let primaryError;

try {
  const installResult = await runProcess(installerPath, ['/S', `/D=${installDirectory}`]);
  assert.equal(installResult.code, 0, `NSIS installer exited with ${installResult.code ?? installResult.signal}.`);
  assert.ok(existsSync(installedBinary), `NSIS did not install ${productName}.exe into the isolated target.`);

  const smokeScript = join(appRoot, 'e2e', 'package-smoke.mjs');
  const smokeResult = await runProcess(process.execPath, [smokeScript], {
    cwd: repoRoot,
    env: { ...process.env, FINAGENT_PACKAGE_SMOKE_BINARY: installedBinary },
  });
  assert.equal(smokeResult.code, 0, `Installed application smoke exited with ${smokeResult.code ?? smokeResult.signal}.`);
} catch (error) {
  primaryError = error;
} finally {
  if (existsSync(uninstaller)) {
    const uninstallResult = await runProcess(uninstaller, ['/S']).catch((error) => ({ code: null, signal: null, error }));
    if (uninstallResult.code !== 0) {
      primaryError ??= new Error(`Could not silently uninstall the temporary Windows test installation (exit=${uninstallResult.code ?? uninstallResult.signal}).`, { cause: uninstallResult.error });
    }
  } else {
    primaryError ??= new Error(`NSIS installation did not provide the expected uninstaller: ${uninstaller}`);
  }

  try {
    await removeTemporaryDirectory(temporaryRoot, tmpdir());
  } catch (error) {
    primaryError ??= error;
  }
}

if (primaryError) throw primaryError;
console.log(`PASS Windows NSIS install: ${productName} launched Pi and the UI from its isolated install directory, persisted a project, and uninstalled cleanly.`);

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

function assertSafeTemporaryPath(path, parent) {
  const absolute = resolve(path);
  const relativeToParent = relative(resolve(parent), absolute);
  if (!relativeToParent || relativeToParent === '.' || relativeToParent.startsWith('..') || isAbsolute(relativeToParent)) {
    throw new Error('Refusing to install or clean outside the unique isolated temporary directory.');
  }
}

async function removeTemporaryDirectory(path, parent) {
  assertSafeTemporaryPath(path, parent);
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw lastError;
}
