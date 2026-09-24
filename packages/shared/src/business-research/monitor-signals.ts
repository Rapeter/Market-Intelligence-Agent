import {
  parseBusinessResearchId,
  type BusinessResearchSubscriptionId,
} from '@finagent/core';
import { canonicalizeEvidenceUrl, cleanEvidenceText } from './evidence.ts';

export interface BusinessResearchMonitorSourceSnapshot {
  url: string;
  title: string;
  summary: string;
  contentFingerprint?: string;
  retrievedAt?: string;
}

export interface BusinessResearchMonitorSignalInput {
  subscriptionId: BusinessResearchSubscriptionId;
  topic: string;
  industry: string;
  competitors: string[];
  previousSources: BusinessResearchMonitorSourceSnapshot[];
  currentSources: BusinessResearchMonitorSourceSnapshot[];
  seenFingerprints: string[];
  checkFailed?: boolean;
}

export type BusinessResearchMonitorSignalDecision =
  | {
      kind: 'trigger';
      reason: 'new_source' | 'source_updated';
      url: string;
      fingerprint: string;
    }
  | {
      kind: 'skip';
      reason: 'invalid_input' | 'check_failed' | 'unrelated' | 'no_change' | 'duplicate_signal';
    };

const MAX_SNAPSHOTS = 100;

/** Determines whether a public-information check contains one new, relevant, idempotent research trigger. */
export async function evaluateBusinessResearchMonitorSignal(
  value: unknown,
): Promise<BusinessResearchMonitorSignalDecision> {
  const input = parseInput(value);
  if (input === undefined) return { kind: 'skip', reason: 'invalid_input' };
  if (input.checkFailed) return { kind: 'skip', reason: 'check_failed' };

  const previousByUrl = new Map(input.previousSources.map((source) => [source.url, source]));
  const currentByUrl = new Map<string, BusinessResearchMonitorSourceSnapshot>();
  for (const source of input.currentSources) {
    const existing = currentByUrl.get(source.url);
    if (existing === undefined || snapshotOrderKey(source) < snapshotOrderKey(existing)) {
      currentByUrl.set(source.url, source);
    }
  }
  if (currentByUrl.size === 0) return { kind: 'skip', reason: 'unrelated' };

  const terms = [input.topic, input.industry, ...input.competitors].map(normalizeForMatch).filter(Boolean);
  const candidates = [...currentByUrl.values()]
    .filter((source) => isRelevant(source, terms))
    .sort((left, right) => left.url < right.url ? -1 : left.url > right.url ? 1 : 0);
  if (candidates.length === 0) return { kind: 'skip', reason: 'unrelated' };

  let sawDuplicate = false;
  let sawChange = false;
  for (const current of candidates) {
    const previous = previousByUrl.get(current.url);
    const reason = previous === undefined
      ? 'new_source'
      : hasMaterialChange(previous, current)
        ? 'source_updated'
        : undefined;
    if (reason === undefined) continue;
    sawChange = true;
    const fingerprint = await createSignalFingerprint(input.subscriptionId, current);
    if (input.seenFingerprints.includes(fingerprint)) {
      sawDuplicate = true;
      continue;
    }
    return { kind: 'trigger', reason, url: current.url, fingerprint };
  }

  if (sawDuplicate) return { kind: 'skip', reason: 'duplicate_signal' };
  return { kind: 'skip', reason: sawChange ? 'duplicate_signal' : 'no_change' };
}

function parseInput(value: unknown): BusinessResearchMonitorSignalInput | undefined {
  if (!isRecord(value)) return undefined;
  const subscriptionId = parseBusinessResearchId('subscription', value.subscriptionId);
  const topic = cleanEvidenceText(value.topic, 500);
  const industry = cleanEvidenceText(value.industry, 200);
  const competitors = parseTextArray(value.competitors, 4, 120);
  const previousSources = parseSnapshots(value.previousSources);
  const currentSources = parseSnapshots(value.currentSources);
  const seenFingerprints = value.seenFingerprints === undefined ? [] : parseTextArray(value.seenFingerprints, 500, 80);
  if (
    subscriptionId === undefined || topic.length === 0 || industry.length === 0 ||
    competitors === undefined || competitors.length < 2 || previousSources === undefined ||
    currentSources === undefined || seenFingerprints === undefined ||
    (value.checkFailed !== undefined && typeof value.checkFailed !== 'boolean')
  ) {
    return undefined;
  }
  if (seenFingerprints.some((fingerprint) => !/^signal-[a-f0-9]{64}$/u.test(fingerprint))) return undefined;
  return {
    subscriptionId,
    topic,
    industry,
    competitors,
    previousSources,
    currentSources,
    seenFingerprints,
    checkFailed: value.checkFailed === true,
  };
}

function parseSnapshots(value: unknown): BusinessResearchMonitorSourceSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SNAPSHOTS) return undefined;
  const result: BusinessResearchMonitorSourceSnapshot[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return undefined;
    const url = canonicalizeEvidenceUrl(item.url);
    const title = cleanEvidenceText(item.title, 500);
    const summary = cleanEvidenceText(item.summary, 4_000);
    const contentFingerprint = item.contentFingerprint === undefined
      ? undefined
      : cleanEvidenceText(item.contentFingerprint, 256);
    const retrievedAt = item.retrievedAt;
    if (
      url === undefined || title.length === 0 || summary.length === 0 ||
      (item.contentFingerprint !== undefined && contentFingerprint?.length === 0) ||
      (retrievedAt !== undefined && (typeof retrievedAt !== 'string' || !Number.isFinite(Date.parse(retrievedAt))))
    ) {
      return undefined;
    }
    result.push({
      url,
      title,
      summary,
      ...(contentFingerprint === undefined ? {} : { contentFingerprint }),
      ...(typeof retrievedAt === 'string' ? { retrievedAt: new Date(retrievedAt).toISOString() } : {}),
    });
  }
  return result;
}

function parseTextArray(value: unknown, maxCount: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxCount) return undefined;
  const result: string[] = [];
  for (const item of value as unknown[]) {
    const text = cleanEvidenceText(item, maxLength);
    if (text.length === 0 || typeof item !== 'string') return undefined;
    result.push(text);
  }
  return result;
}

function isRelevant(source: BusinessResearchMonitorSourceSnapshot, terms: readonly string[]): boolean {
  const text = normalizeForMatch(`${source.title} ${source.summary}`);
  return terms.some((term) => text.includes(term));
}

function normalizeForMatch(value: string): string {
  return cleanEvidenceText(value, 4_000)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function hasMaterialChange(
  previous: BusinessResearchMonitorSourceSnapshot,
  current: BusinessResearchMonitorSourceSnapshot,
): boolean {
  if (previous.contentFingerprint !== undefined && current.contentFingerprint !== undefined) {
    return previous.contentFingerprint !== current.contentFingerprint;
  }
  return normalizeForMatch(previous.title) !== normalizeForMatch(current.title) ||
    normalizeForMatch(previous.summary) !== normalizeForMatch(current.summary);
}

function snapshotOrderKey(source: BusinessResearchMonitorSourceSnapshot): string {
  return [
    normalizeForMatch(source.title),
    normalizeForMatch(source.summary),
    source.contentFingerprint ?? '',
  ].join('\u0000');
}

async function createSignalFingerprint(
  subscriptionId: BusinessResearchSubscriptionId,
  source: BusinessResearchMonitorSourceSnapshot,
): Promise<string> {
  const canonicalContent = [
    subscriptionId,
    source.url,
    normalizeForMatch(source.title),
    normalizeForMatch(source.summary),
    source.contentFingerprint ?? '',
  ].join('\u0000');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalContent));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `signal-${hex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
