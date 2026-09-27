/** Shared contracts for the enterprise research workbench and Pi model runtime. */
export * from './business-research.ts';
export * from './locale.ts';

export interface ApiError {
  code: string;
  message: string;
  action?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/** Model metadata reported by the configured Pi runtime. */
export interface LlmModel {
  provider: string;
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
}

export interface LlmRuntimeState {
  runtimeProvider: string;
  model?: LlmModel;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  isStreaming: boolean;
  sessionId?: string;
  messageCount?: number;
}

export interface CredentialInfo {
  provider: string;
  configured: boolean;
  updatedAt?: number;
  custom?: boolean;
}

export interface CustomProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface CustomProviderConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: CustomProviderModel[];
}

export type ProviderStatusKind = 'connected' | 'missing_credential' | 'unavailable' | 'runtime_error';

export interface ProviderStatus {
  provider: string;
  displayName?: string;
  status: ProviderStatusKind;
  modelCount?: number;
  message?: string;
  custom?: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  message: string;
  provider: string;
  modelId: string;
  latencyMs?: number;
}

/** Safe display metadata returned from Pi for one tool call. */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  status: 'success' | 'error';
  error?: ApiError;
  result?: unknown;
  trace?: AgentTraceEvent[];
}

export interface AgentTraceEvent {
  id: string;
  type: string;
  timestamp: number;
  message?: string;
  data?: unknown;
}
