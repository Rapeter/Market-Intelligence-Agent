import type {
  BusinessResearchAction,
  BusinessResearchEvidenceId,
  BusinessResearchObservation,
  BusinessResearchRunId,
  BusinessResearchTaskInput,
  BusinessResearchTerminalOutcome,
} from '@finagent/core';
import type { BusinessResearchActionRejectionCode } from './core.ts';

interface EventDraftDetails {
  details?: Record<string, unknown>;
}

export type BusinessResearchEventDraft = EventDraftDetails &
  (
    | { type: 'run_started'; task: BusinessResearchTaskInput }
    | { type: 'phase_changed'; status: 'planning' | 'gathering' | 'synthesizing' }
    | { type: 'decision_made'; action: BusinessResearchAction }
    | { type: 'decision_rejected'; code: BusinessResearchActionRejectionCode }
    | { type: 'tool_started'; actionKind: 'search_web' | 'open_source'; evidenceId?: BusinessResearchEvidenceId }
    | { type: 'observation_recorded'; observation: BusinessResearchObservation }
    | { type: 'run_terminal'; outcome: BusinessResearchTerminalOutcome }
  );

interface BusinessResearchEventBase {
  runId: BusinessResearchRunId;
  sequence: number;
  timestamp: number;
}

export type BusinessResearchEvent = BusinessResearchEventBase & BusinessResearchEventDraft;

export interface BusinessResearchEventLog {
  append(draft: BusinessResearchEventDraft): BusinessResearchEvent;
  snapshot(): BusinessResearchEvent[];
}

const SENSITIVE_FIELD = /(?:api[-_]?key|token|authorization|password|secret|credential)/iu;
const BEARER_SECRET = /\bBearer\s+[a-zA-Z0-9._~+/-]+=*/giu;
const API_KEY_SECRET = /\b(?:sk|rk|pk)-[a-zA-Z0-9_-]{16,}\b/giu;

/** Removes secret-like object fields and redacts common inline credential forms recursively. */
export function stripSecretLikeFields(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(BEARER_SECRET, 'Bearer [REDACTED]').replace(API_KEY_SECRET, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => stripSecretLikeFields(item));
  if (isRecord(value)) {
    const clean: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_FIELD.test(key)) continue;
      const safeChild = stripSecretLikeFields(child);
      if (safeChild !== undefined) clean[key] = safeChild;
    }
    return clean;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

/** The event log is the persistence boundary: sequence is assigned here and payloads are scrubbed first. */
export function createBusinessResearchEventLog(
  runId: BusinessResearchRunId,
  now: () => number = Date.now,
): BusinessResearchEventLog {
  const events: BusinessResearchEvent[] = [];

  return {
    append(draft) {
      const cleanDraft = stripSecretLikeFields(draft);
      if (!isRecord(cleanDraft) || typeof cleanDraft.type !== 'string') {
        throw new Error('Invalid business research event draft');
      }
      const event = {
        ...cleanDraft,
        runId,
        sequence: events.length + 1,
        timestamp: now(),
      } as BusinessResearchEvent;
      events.push(structuredClone(event));
      return structuredClone(event);
    },
    snapshot() {
      return structuredClone(events);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
