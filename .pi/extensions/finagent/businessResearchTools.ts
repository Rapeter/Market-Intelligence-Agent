import {
  parseBusinessResearchId,
  type BusinessResearchEvidenceId,
  type BusinessResearchRunId,
} from '@finagent/core';
import {
  createBraveBusinessResearchTools,
  type BusinessResearchToolPort,
} from '../../../packages/shared/src/business-research/index.ts';

export interface BusinessResearchPiTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface BusinessResearchPiAgent {
  registerTool(tool: BusinessResearchPiTool): void;
  on?: (event: string, handler: (event?: { prompt?: string }) => unknown) => void;
  getActiveTools?: () => string[];
  setActiveTools?: (tools: string[]) => void;
}

export interface BusinessResearchPiToolOptions {
  apiKey?: string;
  createToolPort?: (apiKey: string) => BusinessResearchToolPort;
}

export type BusinessResearchPiToolFactory = (runId: BusinessResearchRunId) => BusinessResearchToolPort;
export const BUSINESS_RESEARCH_PI_TOOL_NAMES = [
  'business_research_search',
  'business_research_open',
] as const;
export const BUSINESS_RESEARCH_DECISION_MARKER = 'BUSINESS_RESEARCH_DECISION_V1';
export const BUSINESS_RESEARCH_SYNTHESIS_MARKER = 'BUSINESS_RESEARCH_SYNTHESIS_V1';

/** Creates the two research-only Pi tools, with one evidence registry per run. */
export function createBusinessResearchPiTools(
  factory?: BusinessResearchPiToolFactory,
  options: BusinessResearchPiToolOptions = {},
): BusinessResearchPiTool[] {
  const toolsByRun = new Map<BusinessResearchRunId, BusinessResearchToolPort>();
  const createForRun: BusinessResearchPiToolFactory = factory ?? (() => {
    const apiKey = options.apiKey ?? process.env.FINAGENT_BRAVE_SEARCH_API_KEY ?? '';
    const createToolPort = options.createToolPort ?? ((key: string) => createBraveBusinessResearchTools({ apiKey: key }));
    return createToolPort(apiKey);
  });
  const portFor = (runId: BusinessResearchRunId) => {
    let port = toolsByRun.get(runId);
    if (!port) {
      port = createForRun(runId);
      toolsByRun.set(runId, port);
    }
    return port;
  };

  return [
    {
      name: 'business_research_search',
      label: 'Search public sources',
      description: 'Search public web sources for one bounded business-research query.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['runId', 'query'],
        properties: {
          runId: { type: 'string', minLength: 1, maxLength: 128 },
          query: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      execute: async (_toolCallId, params, signal) => {
        const input = parseInput(params, ['runId', 'query']);
        if (!input || typeof input.query !== 'string' || !validQuery(input.query)) {
          return toolFailure('INVALID_ARGUMENT');
        }
        try {
          const result = await portFor(input.runId).searchWeb(input.query, signal);
          return toolSuccess(result);
        } catch (error) {
          return toolFailure(safeToolErrorCode(error));
        }
      },
    },
    {
      name: 'business_research_open',
      label: 'Open a discovered source',
      description: 'Read a public source previously discovered during this research run.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['runId', 'evidenceId'],
        properties: {
          runId: { type: 'string', minLength: 1, maxLength: 128 },
          evidenceId: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      execute: async (_toolCallId, params, signal) => {
        const input = parseInput(params, ['runId', 'evidenceId']);
        const evidenceId = input && parseBusinessResearchId('evidence', input.evidenceId) as BusinessResearchEvidenceId | undefined;
        if (!input || !evidenceId) return toolFailure('INVALID_ARGUMENT');
        try {
          const result = await portFor(input.runId).openSource(evidenceId, signal);
          return toolSuccess(result);
        } catch (error) {
          return toolFailure(safeToolErrorCode(error));
        }
      },
    },
  ];
}

export function registerBusinessResearchTools(
  agent: BusinessResearchPiAgent,
  factory?: BusinessResearchPiToolFactory,
  options?: BusinessResearchPiToolOptions,
): void {
  for (const tool of createBusinessResearchPiTools(factory, options)) agent.registerTool(tool);
}

/** Restricts workflow prompts to the public research allow-list and blocks model-side execution. */
export function registerBusinessResearchPromptGuard(agent: BusinessResearchPiAgent): void {
  let previousTools: string[] | undefined;
  let guarded = false;
  agent.on?.('before_agent_start', (event) => {
    if (guarded) {
      if (previousTools !== undefined) agent.setActiveTools?.(previousTools);
      previousTools = undefined;
      guarded = false;
    }
    const prompt = event?.prompt ?? '';
    if (!prompt.includes(BUSINESS_RESEARCH_DECISION_MARKER) && !prompt.includes(BUSINESS_RESEARCH_SYNTHESIS_MARKER)) {
      return;
    }
    previousTools = agent.getActiveTools?.();
    agent.setActiveTools?.(prompt.includes(BUSINESS_RESEARCH_DECISION_MARKER)
      ? [...BUSINESS_RESEARCH_PI_TOOL_NAMES]
      : []);
    guarded = true;
  });
  agent.on?.('tool_call', () => guarded
    ? { block: true, reason: 'The trusted research runtime executes validated actions outside the model prompt.' }
    : undefined);
  agent.on?.('agent_end', () => {
    if (previousTools !== undefined) agent.setActiveTools?.(previousTools);
    previousTools = undefined;
    guarded = false;
  });
}

function parseInput(value: unknown, allowedKeys: readonly string[]):
  | { runId: BusinessResearchRunId; query?: string; evidenceId?: unknown }
  | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) return undefined;
  if (Object.keys(value).length !== allowedKeys.length) return undefined;
  const runId = parseBusinessResearchId('run', value.runId);
  if (runId === undefined) return undefined;
  return { runId, query: value.query as string | undefined, evidenceId: value.evidenceId };
}

function validQuery(value: string): boolean {
  const query = value.trim();
  return query.length > 0 && query.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(query);
}

function toolSuccess(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolFailure(code: string) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code } }) }] };
}

function safeToolErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'PROVIDER_ERROR';
  return /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'PROVIDER_ERROR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
