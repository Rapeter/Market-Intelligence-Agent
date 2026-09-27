import { REDACTION_POLICY } from './redact.ts';
import type { DiagnosticsBundle, DiagnosticsInput, ErrorLogEntry } from './types.ts';

/**
 * Assemble a diagnostics bundle from main-process inputs (spec §35).
 *
 * Pure and JSON-stable: the result contains no `undefined` fields and no
 * secret material. Diagnostics never probe external providers or invoke CLIs.
 */
export async function collectDiagnostics(input: DiagnosticsInput): Promise<DiagnosticsBundle> {
  return {
    collectedAt: new Date().toISOString(),
    app: {
      version: input.version,
      platform: {
        os: input.os,
        arch: input.arch,
        electron: input.electronVersion,
      },
    },
    runtime: {
      agent: {
        providerId: input.agentProviderId,
        state: input.agentState,
      },
    },
    providers: {
      llm: {
        id: input.llmProviderId,
        model: input.llmModel,
      },
    },
    capabilities: {
      available: [...input.capabilities],
    },
    pi: {
      status: input.pi.status,
      command: input.pi.command,
      cwd: input.pi.cwd,
      extensions: [...input.pi.extensions],
      providersConfigured: [...input.pi.providersConfigured],
      model: input.pi.model,
      lastExitCode: input.pi.lastExitCode,
      lastExitSignal: input.pi.lastExitSignal,
      stderrTail: input.pi.stderrTail,
    },
    resources: {
      dev: input.resources.dev,
      root: input.resources.root,
    },
    errors: input.errors.map(cloneErrorEntry),
    redaction: {
      policy: REDACTION_POLICY,
      applied: false,
    },
  };
}

function cloneErrorEntry(entry: ErrorLogEntry): ErrorLogEntry {
  return {
    at: entry.at,
    source: entry.source ?? null,
    message: entry.message,
    stack: entry.stack ?? null,
  };
}
