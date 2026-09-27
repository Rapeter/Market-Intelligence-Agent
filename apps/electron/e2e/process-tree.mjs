import { spawn } from 'node:child_process';

/** Stop a disposable Electron test process and every process it launched. */
export async function terminateProcessTree(child, timeoutMs = 10_000) {
  if (hasExited(child)) return;
  if (!child.pid) throw new Error('Cannot terminate a process tree without its root PID.');

  if (process.platform === 'win32') {
    const result = await runProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
    if (result.code !== 0) {
      throw new Error(`Windows could not terminate the packaged smoke process tree (exit=${result.code ?? result.signal}).`);
    }
  } else {
    child.kill('SIGTERM');
  }

  await waitForExit(child, timeoutMs);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    process.once('error', reject);
    process.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Packaged smoke process did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    timeout.unref?.();

    function onExit() {
      clearTimeout(timeout);
      resolve();
    }

    child.once('exit', onExit);
    if (hasExited(child)) onExit();
  });
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
