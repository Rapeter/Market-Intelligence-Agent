import {
  isBusinessResearchSourceKind,
  type BusinessResearchEvidence,
  type BusinessResearchEvidenceId,
  type BusinessResearchSourceKind,
} from '@finagent/core';
import {
  canonicalizeEvidenceUrl,
  createSearchEvidence,
  upgradeEvidenceToPageText,
} from './evidence.ts';
import { createPublicPageReader, type PublicPageReader } from './public-page.ts';
import type { BusinessResearchToolPort } from './core.ts';

const BRAVE_WEB_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_RESULT_COUNT = 10;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

export type BraveBusinessResearchErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_QUERY'
  | 'CANCELLED'
  | 'UNKNOWN_EVIDENCE';

export class BraveBusinessResearchError extends Error {
  readonly code: BraveBusinessResearchErrorCode;

  constructor(code: BraveBusinessResearchErrorCode) {
    super(braveErrorMessage(code));
    this.name = 'BraveBusinessResearchError';
    this.code = code;
  }
}

export interface BraveBusinessResearchToolsOptions {
  apiKey: string;
  fetchImpl?: BraveFetchLike;
  readPage?: PublicPageReader;
  now?: () => Date;
  resultCount?: number;
  maxResponseBytes?: number;
  classifySourceKind?: (url: URL) => BusinessResearchSourceKind;
}

/** Minimal fetch contract keeps Bun-specific helper methods out of the adapter API. */
export type BraveFetchLike = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Creates one run-scoped pair of tools. Search excerpts remain explicitly unverified;
 * `openSource` only accepts evidence IDs this instance actually discovered.
 */
export function createBraveBusinessResearchTools(
  options: BraveBusinessResearchToolsOptions,
): BusinessResearchToolPort {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const pageReader = options.readPage ?? createPublicPageReader();
  const now = options.now ?? (() => new Date());
  const resultCount = options.resultCount ?? DEFAULT_RESULT_COUNT;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  const evidenceById = new Map<BusinessResearchEvidenceId, BusinessResearchEvidence>();
  const evidenceIdByUrl = new Map<string, BusinessResearchEvidenceId>();

  return {
    async searchWeb(query, signal) {
      if (signal.aborted) throw new BraveBusinessResearchError('CANCELLED');
      if (apiKey.length === 0) throw new BraveBusinessResearchError('AUTHENTICATION_FAILED');
      if (!validSearchQuery(query)) throw new BraveBusinessResearchError('INVALID_QUERY');
      if (
        !Number.isInteger(resultCount) || resultCount < 1 || resultCount > 20 ||
        !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1
      ) {
        throw new BraveBusinessResearchError('INVALID_RESPONSE');
      }

      const endpoint = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('count', String(resultCount));
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'x-subscription-token': apiKey,
          },
          redirect: 'error',
          signal,
        });
      } catch {
        if (signal.aborted) throw new BraveBusinessResearchError('CANCELLED');
        throw new BraveBusinessResearchError('PROVIDER_UNAVAILABLE');
      }

      if (response.status === 401 || response.status === 403) {
        throw new BraveBusinessResearchError('AUTHENTICATION_FAILED');
      }
      if (response.status === 429) throw new BraveBusinessResearchError('RATE_LIMITED');
      if (response.status >= 500) throw new BraveBusinessResearchError('PROVIDER_UNAVAILABLE');
      if (response.status < 200 || response.status >= 300) {
        throw new BraveBusinessResearchError('PROVIDER_ERROR');
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
        throw new BraveBusinessResearchError('INVALID_RESPONSE');
      }

      const body = await readBoundedText(response, maxResponseBytes, signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new BraveBusinessResearchError('INVALID_RESPONSE');
      }
      const results = readWebResults(parsed);
      if (results === undefined) throw new BraveBusinessResearchError('INVALID_RESPONSE');

      const retrievedAt = now().toISOString();
      const found: BusinessResearchEvidence[] = [];
      const seenUrls = new Set<string>();
      for (const result of results) {
        const fields = readSearchResult(result);
        if (fields === undefined) continue;
        const url = canonicalizeEvidenceUrl(fields.url);
        if (url === undefined || seenUrls.has(url)) continue;
        seenUrls.add(url);
        let sourceKind: BusinessResearchSourceKind = 'other_public';
        try {
          const candidate = options.classifySourceKind?.(new URL(url)) ?? sourceKind;
          if (isBusinessResearchSourceKind(candidate)) sourceKind = candidate;
        } catch {
          sourceKind = 'other_public';
        }
        const created = await createSearchEvidence({
          url,
          title: fields.title,
          excerpt: fields.description,
          query,
          retrievedAt,
          sourceKind,
        });
        if (created === undefined) continue;
        const previousId = evidenceIdByUrl.get(url);
        const evidence = previousId === undefined ? created : { ...created, id: previousId };
        evidenceById.set(evidence.id, evidence);
        evidenceIdByUrl.set(url, evidence.id);
        found.push(evidence);
      }
      return found;
    },

    async openSource(evidenceId, signal) {
      if (signal.aborted) throw new BraveBusinessResearchError('CANCELLED');
      const existing = evidenceById.get(evidenceId);
      if (existing === undefined) throw new BraveBusinessResearchError('UNKNOWN_EVIDENCE');
      const page = await pageReader.read(existing.url, signal);
      const upgraded = await upgradeEvidenceToPageText(existing, page.text, now().toISOString(), page.finalUrl);
      evidenceById.set(evidenceId, upgraded);
      const finalUrl = canonicalizeEvidenceUrl(page.finalUrl);
      if (finalUrl !== undefined) evidenceIdByUrl.set(finalUrl, evidenceId);
      return upgraded;
    },
  };
}

function validSearchQuery(query: unknown): query is string {
  return (
    typeof query === 'string' &&
    query.trim().length > 0 &&
    query.length <= 600 &&
    !/[\u0000-\u001f\u007f]/u.test(query) &&
    query.trim().split(/\s+/u).length <= 75
  );
}

function readWebResults(value: unknown): unknown[] | undefined {
  if (!isRecord(value) || !isRecord(value.web)) return undefined;
  return Array.isArray(value.web.results) ? value.web.results : undefined;
}

function readSearchResult(value: unknown): { title: string; url: string; description: string } | undefined {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.description !== 'string'
  ) {
    return undefined;
  }
  return { title: value.title, url: value.url, description: value.description };
}

async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new BraveBusinessResearchError('RESPONSE_TOO_LARGE');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new BraveBusinessResearchError('CANCELLED');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BraveBusinessResearchError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BraveBusinessResearchError) throw error;
    if (signal.aborted) throw new BraveBusinessResearchError('CANCELLED');
    throw new BraveBusinessResearchError('PROVIDER_UNAVAILABLE');
  }
  const text = new TextDecoder('utf-8', { fatal: false });
  return chunks.map((chunk) => text.decode(chunk, { stream: true })).join('') + text.decode();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function braveErrorMessage(code: BraveBusinessResearchErrorCode): string {
  switch (code) {
    case 'AUTHENTICATION_FAILED': return 'Brave Search credentials are missing or were rejected.';
    case 'RATE_LIMITED': return 'Brave Search rate limit or quota was reached.';
    case 'PROVIDER_UNAVAILABLE': return 'Brave Search is temporarily unavailable.';
    case 'PROVIDER_ERROR': return 'Brave Search rejected the request.';
    case 'INVALID_RESPONSE': return 'Brave Search returned an invalid response.';
    case 'RESPONSE_TOO_LARGE': return 'Brave Search returned more data than the response budget allows.';
    case 'INVALID_QUERY': return 'The research query is outside the supported limits.';
    case 'CANCELLED': return 'The Brave Search request was cancelled.';
    case 'UNKNOWN_EVIDENCE': return 'The requested source was not discovered in this research run.';
  }
}
