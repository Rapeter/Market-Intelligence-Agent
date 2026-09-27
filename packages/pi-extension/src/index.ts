interface ProviderModelConfig {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ProviderModelConfig[];
}

interface AgentApi {
  registerProvider?: (name: string, config: ProviderConfig) => void;
}

interface ProviderOverride extends ProviderConfig {
  provider: string;
}

/** Apply credentials and custom model endpoints supplied by the desktop host. */
export function registerProviderOverrides(agent: AgentApi): void {
  if (typeof agent.registerProvider !== 'function') return;

  const overrides = readProviderOverrides();
  const hasAnthropicOverride = overrides.some((entry) => entry.provider === 'anthropic');
  if (!hasAnthropicOverride && process.env.ANTHROPIC_BASE_URL) {
    agent.registerProvider('anthropic', { baseUrl: process.env.ANTHROPIC_BASE_URL });
  }

  for (const { provider, ...config } of overrides) agent.registerProvider(provider, config);
}

function readProviderOverrides(): ProviderOverride[] {
  const raw = process.env.FINAGENT_PROVIDER_OVERRIDES;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ProviderOverride =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      && typeof (entry as { provider?: unknown }).provider === 'string');
  } catch {
    return [];
  }
}
