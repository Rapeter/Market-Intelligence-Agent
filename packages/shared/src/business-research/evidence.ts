import {
  parseBusinessResearchId,
  type BusinessResearchId,
  type BusinessResearchEvidence,
  type BusinessResearchSourceKind,
} from '@finagent/core';

export interface SearchEvidenceInput {
  url: string;
  title: string;
  excerpt: string;
  query: string;
  retrievedAt: string;
  sourceKind: BusinessResearchSourceKind;
}

/** Canonicalizes a candidate URL without treating syntax checks as a substitute for DNS safety. */
export function canonicalizeEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4_096) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.port.length > 0 && url.port !== '443') ||
      url.hostname.length === 0 ||
      isDisallowedLocalHostname(url.hostname)
    ) {
      return undefined;
    }
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** Converts markup and HTML entities into bounded, inert text for evidence display and prompts. */
export function cleanEvidenceText(value: unknown, maxLength = 4_000): string {
  if (typeof value !== 'string' || !Number.isInteger(maxLength) || maxLength <= 0) return '';
  const withoutExecutableRegions = value
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/giu, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote)\s*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ');
  const decoded = decodeHtmlEntities(withoutExecutableRegions)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return decoded.slice(0, maxLength).trimEnd();
}

/** Creates deterministic source/evidence ids from the canonical public URL. */
export async function createSearchEvidence(
  input: SearchEvidenceInput,
): Promise<BusinessResearchEvidence | undefined> {
  const url = canonicalizeEvidenceUrl(input.url);
  const title = cleanEvidenceText(input.title, 500);
  const excerpt = cleanEvidenceText(input.excerpt, 4_000);
  const query = cleanEvidenceText(input.query, 500);
  if (
    url === undefined ||
    title.length === 0 ||
    excerpt.length === 0 ||
    query.length === 0 ||
    !Number.isFinite(Date.parse(input.retrievedAt))
  ) {
    return undefined;
  }

  const [sourceId, id] = await Promise.all([
    createId('source', url),
    createId('evidence', url),
  ]);
  return {
    id,
    sourceId,
    title,
    url,
    sourceKind: input.sourceKind,
    grade: 'search_excerpt',
    query,
    excerpt,
    retrievedAt: new Date(input.retrievedAt).toISOString(),
  };
}

/** Upgrades one search citation in place while keeping its stable evidence id. */
export async function upgradeEvidenceToPageText(
  existing: BusinessResearchEvidence,
  pageText: string,
  retrievedAt: string,
  finalUrl = existing.url,
): Promise<BusinessResearchEvidence> {
  const excerpt = cleanEvidenceText(pageText, 4_000);
  const url = canonicalizeEvidenceUrl(finalUrl);
  if (excerpt.length === 0 || url === undefined || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error('Invalid verified page evidence');
  }
  return {
    ...existing,
    sourceId: url === existing.url ? existing.sourceId : await createId('source', url),
    url,
    grade: 'page_text',
    excerpt,
    retrievedAt: new Date(retrievedAt).toISOString(),
  };
}

async function createId<Kind extends 'source' | 'evidence'>(
  kind: Kind,
  value: string,
): Promise<BusinessResearchId<Kind>> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const parsed = parseBusinessResearchId(kind, `${kind}-${hex}`);
  if (parsed === undefined) throw new Error('Failed to create a stable public evidence id');
  return parsed;
}

function isDisallowedLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.test') ||
    normalized.endsWith('.invalid') ||
    normalized.includes(':') ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(normalized)
  );
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity: string) => {
    switch (entity.toLowerCase()) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'nbsp': return ' ';
      default: {
        const numeric = entity.startsWith('#x') || entity.startsWith('#X')
          ? Number.parseInt(entity.slice(2), 16)
          : entity.startsWith('#')
            ? Number.parseInt(entity.slice(1), 10)
            : Number.NaN;
        if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff)) {
          return match;
        }
        return String.fromCodePoint(numeric);
      }
    }
  });
}
