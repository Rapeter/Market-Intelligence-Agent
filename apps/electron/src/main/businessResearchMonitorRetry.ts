import { createCodeError } from '@finagent/shared/agent/errors';

export async function retryTransientMonitorProbe<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (signal.aborted || !isErrorWithCode(error) || error.code !== 'PROVIDER_UNAVAILABLE') throw error;
    await waitForMonitorRetry(signal);
    return action();
  }
}

function waitForMonitorRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createCodeError('BUSINESS_RESEARCH_CANCELLED', 'Monitoring check cancelled.'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 200);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(createCodeError('BUSINESS_RESEARCH_CANCELLED', 'Monitoring check cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}
