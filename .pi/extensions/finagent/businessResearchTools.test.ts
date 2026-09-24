import { describe, expect, it } from 'bun:test';
import type { BusinessResearchEvidence } from '@finagent/core';
import {
  createBusinessResearchPiTools,
  registerBusinessResearchPromptGuard,
  registerBusinessResearchTools,
  type BusinessResearchPiTool,
} from './businessResearchTools.ts';

const evidence = {
  id: 'evidence-a',
  sourceId: 'source-a',
  title: 'Public update',
  url: 'https://example.com/update',
  sourceKind: 'news',
  grade: 'search_excerpt',
  query: 'Acme update',
  excerpt: 'A short public excerpt',
  retrievedAt: '2026-09-24T00:00:00.000Z',
} as BusinessResearchEvidence;

function fakePort() {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
      searchWeb: async (query: string, signal: AbortSignal) => {
        calls.push({ kind: 'search', query, aborted: signal.aborted });
        return [evidence];
      },
      openSource: async (id: string, signal: AbortSignal) => {
        calls.push({ kind: 'open', id, aborted: signal.aborted });
        return { ...evidence, grade: 'page_text' as const };
      },
    },
  };
}

describe('business research Pi tools', () => {
  it('registers only the two namespaced public-research tools', () => {
    const registered: BusinessResearchPiTool[] = [];
    registerBusinessResearchTools({ registerTool: (tool) => registered.push(tool) }, () => fakePort().port);
    expect(registered.map((tool) => tool.name)).toEqual([
      'business_research_search',
      'business_research_open',
    ]);
  });

  it('validates arguments and forwards the Pi cancellation signal', async () => {
    const perRun = new Map<string, ReturnType<typeof fakePort>>();
    const tools = createBusinessResearchPiTools((id) => {
      const entry = fakePort();
      perRun.set(id, entry);
      return entry.port;
    });
    const controller = new AbortController();
    const result = await tools[0]!.execute('call-a', { runId: 'run-a', query: 'Acme update' }, controller.signal);
    expect(JSON.parse(result.content[0]!.text)).toEqual([evidence]);
    expect(perRun.get('run-a')?.calls).toEqual([
      { kind: 'search', query: 'Acme update', aborted: false },
    ]);

    const invalid = await tools[0]!.execute('call-b', { runId: 'run-a', query: 'x', apiKey: 'secret-value' }, controller.signal);
    expect(invalid.content[0]!.text).toContain('INVALID_ARGUMENT');
    expect(invalid.content[0]!.text).not.toContain('secret-value');
    expect(perRun.get('run-a')?.calls).toHaveLength(1);
  });

  it('opens only evidence ids through the matching run-scoped tool port', async () => {
    const entries = new Map<string, ReturnType<typeof fakePort>>();
    const tools = createBusinessResearchPiTools((id) => {
      let entry = entries.get(id);
      if (!entry) {
        entry = fakePort();
        entries.set(id, entry);
      }
      return entry.port;
    });
    const result = await tools[1]!.execute('call-open', { runId: 'run-a', evidenceId: 'evidence-a' }, new AbortController().signal);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ id: 'evidence-a', grade: 'page_text' });
    expect(entries.get('run-a')?.calls).toEqual([
      { kind: 'open', id: 'evidence-a', aborted: false },
    ]);
  });

  it('redacts provider exceptions and rejects invalid run ids', async () => {
    const tools = createBusinessResearchPiTools(() => ({
      searchWeb: async () => { throw new Error('request failed with x-subscription-token secret-key-value'); },
      openSource: async () => evidence,
    }));
    const failure = await tools[0]!.execute('call-a', { runId: 'run-a', query: 'Acme' }, new AbortController().signal);
    expect(failure.content[0]!.text).toContain('PROVIDER_ERROR');
    expect(failure.content[0]!.text).not.toContain('secret-key-value');

    const invalid = await tools[0]!.execute('call-b', { runId: '../escape', query: 'Acme' }, new AbortController().signal);
    expect(invalid.content[0]!.text).toContain('INVALID_ARGUMENT');
  });

  it('uses the dedicated Brave key only inside the trusted extension adapter', async () => {
    let receivedKey = '';
    const [search] = createBusinessResearchPiTools(undefined, {
      apiKey: 'brave-secret-value',
      createToolPort: (key) => {
        receivedKey = key;
        return fakePort().port;
      },
    });
    await search!.execute('call-key', { runId: 'run-key', query: 'Acme' }, new AbortController().signal);
    expect(receivedKey).toBe('brave-secret-value');
  });

  it('limits research prompts to the research tool allow-list and restores prior tools', () => {
    const handlers = new Map<string, (event?: { prompt?: string }) => unknown>();
    let active = ['get_quote', 'read_skill_resource'];
    registerBusinessResearchPromptGuard({
      registerTool: () => undefined,
      on: (event, handler) => { handlers.set(event, handler); },
      getActiveTools: () => [...active],
      setActiveTools: (tools) => { active = [...tools]; },
    });

    handlers.get('before_agent_start')?.({ prompt: 'BUSINESS_RESEARCH_DECISION_V1 return JSON' });
    expect(active).toEqual(['business_research_search', 'business_research_open']);
    expect(handlers.get('tool_call')?.()).toMatchObject({ block: true });
    handlers.get('agent_end')?.();
    expect(active).toEqual(['get_quote', 'read_skill_resource']);

    handlers.get('before_agent_start')?.({ prompt: 'BUSINESS_RESEARCH_SYNTHESIS_V1 use saved evidence' });
    expect(active).toEqual([]);
    handlers.get('agent_end')?.();
    expect(active).toEqual(['get_quote', 'read_skill_resource']);
  });
});
