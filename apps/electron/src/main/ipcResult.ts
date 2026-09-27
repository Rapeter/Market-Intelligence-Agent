import { ErrorLog } from '@finagent/shared/diagnostics';
import { redactSecrets } from './credentialStore.ts';

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; action?: string } };

/** Main-process error ring buffer; user-facing text is redacted at insertion. */
export const mainErrorLog = new ErrorLog();

export function toIpcError(error: unknown): NonNullable<Extract<IpcResult<never>, { ok: false }>['error']> {
  if (isErrorWithCode(error)) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
      action: error.action,
    };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: redactSecrets(error.message) };
  }
  return { code: 'INTERNAL_ERROR', message: redactSecrets(String(error)) };
}

function isErrorWithCode(error: unknown): error is Error & { code: string; action?: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

export async function toIpcResult<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const ipcError = toIpcError(error);
    mainErrorLog.push({
      at: Date.now(),
      source: 'main',
      message: ipcError.message,
      stack: error instanceof Error ? (error.stack ?? null) : null,
    });
    return { ok: false, error: ipcError };
  }
}
