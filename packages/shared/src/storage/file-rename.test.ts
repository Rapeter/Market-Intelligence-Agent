import { describe, expect, it } from 'bun:test';
import { renameWithTransientRetry } from './json-file-store.ts';

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('Windows atomic file replacement', () => {
  it('retries transient Windows rename locks and then succeeds', async () => {
    let calls = 0;
    const delays: number[] = [];

    await renameWithTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw filesystemError('EPERM');
      },
      'staged.json',
      'record.json',
      'win32',
      async (milliseconds) => { delays.push(milliseconds); },
    );

    expect(calls).toBe(3);
    expect(delays).toEqual([25, 50]);
  });

  it('does not retry permanent Windows rename failures forever', async () => {
    let calls = 0;
    const delays: number[] = [];
    const operation = async () => {
      calls += 1;
      throw filesystemError('EPERM');
    };

    await expect(renameWithTransientRetry(
      operation,
      'staged.json',
      'record.json',
      'win32',
      async (milliseconds) => { delays.push(milliseconds); },
    )).rejects.toMatchObject({ code: 'EPERM' });

    expect(calls).toBe(6);
    expect(delays).toEqual([25, 50, 100, 200, 400]);
  });

  it('does not add retries to rename failures on other platforms', async () => {
    let calls = 0;
    const operation = async () => {
      calls += 1;
      throw filesystemError('EPERM');
    };

    await expect(renameWithTransientRetry(operation, 'staged.json', 'record.json', 'linux'))
      .rejects.toMatchObject({ code: 'EPERM' });
    expect(calls).toBe(1);
  });
});
