import { spawn, spawnSync } from 'node:child_process';
import { it, expect } from 'bun:test';
import { terminateProcessTree } from './process-tree.mjs';

it('terminates a Windows test app together with its Pi-like child process', async () => {
  if (process.platform !== 'win32') return;

  const childTreeRoot = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    process.stdout.write(String(child.pid));
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

  try {
    const [childPidText] = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the child PID.')), 5_000);
      childTreeRoot.stdout?.once('data', (chunk) => {
        clearTimeout(timeout);
        resolve([chunk.toString()]);
      });
      childTreeRoot.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const childPid = Number(childPidText);
    expect(Number.isInteger(childPid)).toBe(true);
    expect(isWindowsProcessRunning(childPid)).toBe(true);

    await terminateProcessTree(childTreeRoot);

    expect(childTreeRoot.exitCode !== null || childTreeRoot.signalCode !== null).toBe(true);
    expect(isWindowsProcessRunning(childPid)).toBe(false);
  } finally {
    if (childTreeRoot.exitCode === null && childTreeRoot.signalCode === null && childTreeRoot.pid) {
      spawnSync('taskkill.exe', ['/PID', String(childTreeRoot.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  }
});

function isWindowsProcessRunning(pid: number): boolean {
  const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tasklist failed with exit code ${result.status}.`);
  return result.stdout.split(/\r?\n/).some((line) => /^"[^"]+","(\d+)"/.exec(line)?.[1] === String(pid));
}
