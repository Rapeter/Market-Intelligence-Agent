import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(repoRoot, 'apps/electron');
const appRequire = createRequire(join(appRoot, 'package.json'));
const vitePackageRoot = dirname(appRequire.resolve('vite/package.json'));
const { createServer: createViteServer } = await import(
  pathToFileURL(join(vitePackageRoot, 'dist/node/index.js')).href
);

let viteServer;
let electronProcess;
let stopping = false;

try {
  runBuild('bun', ['run', 'build:packages'], repoRoot);
  runBuild('bun', ['run', 'build'], appRoot);
  runBuild('bun', ['run', 'build:extension'], appRoot);

  const port = await findAvailablePort();
  viteServer = await createViteServer({
    configFile: join(appRoot, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port,
      strictPort: false,
    },
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not open a TCP loopback listener.');
  }
  const rendererUrl = `http://127.0.0.1:${address.port}`;
  const electronBinary = appRequire('electron');
  const cdpPort = configuredCdpPort();
  const electronArgs = [join(appRoot, 'src/main/index.js')];
  if (cdpPort != null) {
    electronArgs.push(
      `--remote-debugging-port=${cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-sandbox',
      '--disable-gpu',
    );
  }

  console.log(`Starting Enterprise Research Workbench at ${rendererUrl}`);
  electronProcess = spawn(electronBinary, electronArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      FINAGENT_DEV_SERVER_URL: rendererUrl,
      FINAGENT_FORCE_PROD_LOAD: '0',
      FINAGENT_PACKAGED: '0',
    },
  });

  const result = await waitForElectronExit(electronProcess);
  process.exitCode = stopping ? 0 : (result.code ?? (result.signal ? 1 : 0));
} catch (error) {
  console.error('Could not start the desktop development app.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await viteServer?.close().catch((error) => {
    console.error('Could not stop the Vite development server cleanly.', error);
    process.exitCode = 1;
  });
}

function runBuild(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? result.signal}.`);
  }
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error('Could not find an available local port for Vite.');
  return port;
}

function configuredCdpPort() {
  const value = process.env.FINAGENT_E2E_CDP_PORT;
  if (value == null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`FINAGENT_E2E_CDP_PORT must be an integer between 1 and 65535; received ${value}`);
  }
  return port;
}

function waitForElectronExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function stopElectron() {
  if (stopping) return;
  stopping = true;
  if (electronProcess && electronProcess.exitCode == null && electronProcess.signalCode == null) {
    electronProcess.kill();
  }
}

process.once('SIGINT', stopElectron);
process.once('SIGTERM', stopElectron);
