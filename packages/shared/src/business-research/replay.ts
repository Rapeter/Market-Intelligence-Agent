import type {
  BusinessResearchAction,
  BusinessResearchObservation,
  BusinessResearchTaskInput,
  BusinessResearchTerminalOutcome,
} from '@finagent/core';
import type { BusinessResearchEvent } from './events.ts';

export interface BusinessResearchReplayState {
  task?: BusinessResearchTaskInput;
  actions: BusinessResearchAction[];
  observations: BusinessResearchObservation[];
  outcome?: BusinessResearchTerminalOutcome;
  lastSequence: number;
}

export type BusinessResearchReplayResult =
  | { ok: true; state: BusinessResearchReplayState }
  | { ok: false; code: 'invalid_sequence' | 'missing_start' | 'multiple_runs' | 'event_after_terminal' };

/** Rebuilds the model-visible state from append-only, already-scrubbed run events. */
export function replayBusinessResearchEvents(
  events: readonly BusinessResearchEvent[],
): BusinessResearchReplayResult {
  const state: BusinessResearchReplayState = { actions: [], observations: [], lastSequence: 0 };
  if (events.length === 0) return { ok: true, state };

  const runId = events[0]?.runId;
  if (runId === undefined) return { ok: false, code: 'missing_start' };
  let started = false;
  let terminal = false;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || event.sequence !== index + 1) {
      return { ok: false, code: 'invalid_sequence' };
    }
    if (event.runId !== runId) return { ok: false, code: 'multiple_runs' };
    if (terminal) return { ok: false, code: 'event_after_terminal' };

    if (event.type === 'run_started') {
      if (started || index !== 0) return { ok: false, code: 'invalid_sequence' };
      started = true;
      state.task = event.task;
    } else if (!started) {
      return { ok: false, code: 'missing_start' };
    } else {
      switch (event.type) {
        case 'decision_made':
          state.actions.push(event.action);
          break;
        case 'observation_recorded':
          state.observations.push(event.observation);
          break;
        case 'run_terminal':
          state.outcome = event.outcome;
          terminal = true;
          break;
        case 'phase_changed':
        case 'decision_rejected':
        case 'tool_started':
          break;
        default: {
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    }
    state.lastSequence = event.sequence;
  }

  return { ok: true, state };
}
