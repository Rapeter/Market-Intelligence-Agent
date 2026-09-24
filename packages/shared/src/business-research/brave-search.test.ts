import { describe, expect, it } from 'bun:test';
import { createBraveBusinessResearchTools } from './brave-search.ts';
import { createPublicPageReader, type PublicPageResponse } from './public-page.ts';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected Brave adapter error ${code}`);
}

describe('Brave business research tools', () => {
  it('uses the documented endpoint and token header, parses web results, sanitizes snippets, and deduplicates URLs', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const tools = createBraveBusinessResearchTools({
      apiKey: 'brave-test-secret-value',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          type: 'search',
          web: {
            results: [
              {
                title: 'EV <strong>launch</strong>',
                url: 'https://example.com/update#top',
                description: '<p>New <b>battery</b> platform &amp; pricing.</p>',
              },
              {
                title: 'Duplicate URL',
                url: 'https://example.com/update',
                description: 'Duplicate result',
              },
              { title: 'Insecure source', url: 'http://example.org', description: 'Must be ignored' },
              { title: '', url: 'https://example.net', description: 'Missing title' },
            ],
          },
        });
      },
      readPage: { async read() { return { finalUrl: 'https://example.com/update', text: 'Verified public page text', contentType: 'text/html' }; } },
      now: () => new Date('2026-09-24T00:00:00.000Z'),
      classifySourceKind: () => 'company_site',
    });

    const results = await tools.searchWeb('EV battery launch', new AbortController().signal);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.search.brave.com/res/v1/web/search?q=EV+battery+launch&count=10');
    expect(new Headers(calls[0]?.init?.headers).get('X-Subscription-Token')).toBe('brave-test-secret-value');
    expect(calls[0]?.init?.redirect).toBe('error');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'EV launch',
      url: 'https://example.com/update',
      excerpt: 'New battery platform & pricing.',
      grade: 'search_excerpt',
      sourceKind: 'company_site',
    });
  });

  it('opens only evidence discovered by this tool instance and preserves the stable evidence id', async () => {
    const pageResponse: PublicPageResponse = {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: new TextEncoder().encode('Verified range: 500 km.'),
    };
    const reader = createPublicPageReader({
      resolveHost: async () => ['93.184.216.34'],
      request: async () => pageResponse,
    });
    const tools = createBraveBusinessResearchTools({
      apiKey: 'brave-test-secret-value',
      fetchImpl: async () => jsonResponse({ web: { results: [{ title: 'Range', url: 'https://example.com/range', description: 'Claimed range.' }] } }),
      readPage: reader,
      now: () => new Date('2026-09-24T00:00:00.000Z'),
    });
    const [discovered] = await tools.searchWeb('EV range', new AbortController().signal);
    if (discovered === undefined) throw new Error('Expected one search result');

    const opened = await tools.openSource(discovered.id, new AbortController().signal);

    expect(opened).toMatchObject({
      id: discovered.id,
      sourceId: discovered.sourceId,
      grade: 'page_text',
      excerpt: 'Verified range: 500 km.',
    });
    await expectCode(
      tools.openSource('evidence-not-discovered' as typeof discovered.id, new AbortController().signal),
      'UNKNOWN_EVIDENCE',
    );
  });

  it('maps authentication, rate-limit, provider, and malformed-response failures to safe stable codes', async () => {
    for (const [status, expectedCode] of [
      [401, 'AUTHENTICATION_FAILED'],
      [429, 'RATE_LIMITED'],
      [503, 'PROVIDER_UNAVAILABLE'],
    ] as const) {
      const tools = createBraveBusinessResearchTools({
        apiKey: 'brave-test-secret-value',
        fetchImpl: async () => new Response('{"error":{"detail":"do not echo provider body"}}', { status }),
      });
      await expectCode(tools.searchWeb('EV research', new AbortController().signal), expectedCode);
    }

    const malformed = createBraveBusinessResearchTools({
      apiKey: 'brave-test-secret-value',
      fetchImpl: async () => new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    await expectCode(malformed.searchWeb('EV research', new AbortController().signal), 'INVALID_RESPONSE');
  });

  it('rejects an empty key without contacting Brave and bounds provider response bodies', async () => {
    let called = false;
    const noKey = createBraveBusinessResearchTools({
      apiKey: '  ',
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    await expectCode(noKey.searchWeb('EV research', new AbortController().signal), 'AUTHENTICATION_FAILED');
    expect(called).toBe(false);

    const tooLarge = createBraveBusinessResearchTools({
      apiKey: 'brave-test-secret-value',
      maxResponseBytes: 8,
      fetchImpl: async () => jsonResponse({ web: { results: [] } }),
    });
    await expectCode(tooLarge.searchWeb('EV research', new AbortController().signal), 'RESPONSE_TOO_LARGE');
  });
});
