import { readdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import {
  isBusinessResearchEvidenceGrade,
  isBusinessResearchRunStatus,
  isBusinessResearchRunMode,
  isBusinessResearchSourceKind,
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
  type BusinessResearchClaim,
  type BusinessResearchEvidence,
  type BusinessResearchEvidenceId,
  type BusinessResearchEventId,
  type BusinessResearchIdKind,
  type BusinessResearchReportId,
  type BusinessResearchRunId,
  type BusinessResearchRunMode,
  type BusinessResearchRunState,
  type BusinessResearchSourceId,
  type BusinessResearchSubscriptionId,
  type BusinessResearchTaskInput,
} from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import type { JsonFileStore } from '../storage/json-file-store.ts';
import { canonicalizeEvidenceUrl, cleanEvidenceText } from './evidence.ts';
import { replayBusinessResearchEvents, type BusinessResearchReplayResult } from './replay.ts';
import type { BusinessResearchEvent } from './events.ts';
import type {
  BusinessResearchMonitorSignalDecision,
  BusinessResearchMonitorSourceSnapshot,
} from './monitor-signals.ts';
import type { BusinessResearchReport as SynthesizedBusinessResearchReport } from './synthesis.ts';

const ROOT = 'business-research';
const RECORD_FILE = 'record.json';
const EVENTS_FILE = 'events.json';
const EVIDENCE_FILE = 'evidence.json';
const CHECKS_FILE = 'checks.json';
const FINGERPRINTS_FILE = 'fingerprints.json';
const SOURCES_FILE = 'sources.json';
const MIN_INTERVAL_MS = 60 * 60 * 1_000;

type ParsedBusinessResearchId<Kind extends BusinessResearchIdKind> = NonNullable<
  ReturnType<typeof parseBusinessResearchId<Kind>>
>;

const fileLocks = new Map<string, Promise<void>>();

export interface BusinessResearchRunRecord {
  id: BusinessResearchRunId;
  task: BusinessResearchTaskInput;
  /** Absent only on records created before run modes were introduced. */
  mode?: BusinessResearchRunMode;
  state: BusinessResearchRunState;
  createdAt: number;
  updatedAt: number;
  reportId?: BusinessResearchReportId;
}

export interface BusinessResearchSubscriptionRecord {
  id: BusinessResearchSubscriptionId;
  task: BusinessResearchTaskInput;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextCheckAt: number;
  lastCheckAt?: number;
  /** Soft removal keeps the run and check audit trail intact. */
  removedAt?: number;
}

export interface BusinessResearchCheckRecord {
  id: BusinessResearchEventId;
  subscriptionId: BusinessResearchSubscriptionId;
  startedAt: number;
  completedAt: number;
  decision: BusinessResearchMonitorSignalDecision;
  runId?: BusinessResearchRunId;
}

export type BusinessResearchFingerprintReservation =
  | { reserved: true; runId: BusinessResearchRunId }
  | { reserved: false; existingRunId: BusinessResearchRunId };

interface EventFile {
  runId: BusinessResearchRunId;
  events: BusinessResearchEvent[];
}

interface EvidenceFile {
  runId: BusinessResearchRunId;
  evidence: BusinessResearchEvidence[];
}

interface CheckFile {
  subscriptionId: BusinessResearchSubscriptionId;
  checks: BusinessResearchCheckRecord[];
}

interface FingerprintFile {
  subscriptionId: BusinessResearchSubscriptionId;
  reservations: Record<string, BusinessResearchRunId>;
}

interface SourceFile {
  subscriptionId: BusinessResearchSubscriptionId;
  sources: BusinessResearchMonitorSourceSnapshot[];
}

/** Persists each run artifact as an independently validated atomic JSON record under userData. */
export class BusinessResearchRepository {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async saveRun(record: BusinessResearchRunRecord): Promise<void> {
    assertRunRecord(record);
    await this.store.write(this.runFile(record.id, RECORD_FILE), structuredClone(record));
  }

  async getRun(runId: BusinessResearchRunId): Promise<BusinessResearchRunRecord | undefined> {
    assertId('run', runId);
    const value = await this.store.read<unknown>(this.runFile(runId, RECORD_FILE), null);
    if (value === null) return undefined;
    if (!isRunRecord(value) || value.id !== runId) throw corruptRecord('run', runId);
    return structuredClone(value);
  }

  async listRunIds(): Promise<BusinessResearchRunId[]> {
    return this.listIds('run', `${ROOT}/runs`);
  }

  async listRuns(): Promise<BusinessResearchRunRecord[]> {
    const runs = await Promise.all((await this.listRunIds()).map((runId) => this.getRun(runId)));
    return runs.filter(isDefined).sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  }

  /** Adds exactly the next event to a run's immutable sequence; failed writes keep the prior prefix. */
  async appendEvent(event: BusinessResearchEvent): Promise<void> {
    assertEvent(event);
    const path = this.runFile(event.runId, EVENTS_FILE);
    await withFileLock(this.store.resolve(path), async () => {
      const current = await this.readEvents(event.runId);
      if (event.sequence !== current.length + 1) {
        throw createCodeError('BUSINESS_RESEARCH_EVENT_SEQUENCE', 'Business research events must be appended in order.');
      }
      const next = [...current, structuredClone(event)];
      const replay: BusinessResearchReplayResult = replayBusinessResearchEvents(next);
      if (!replay.ok) throw createCodeError('BUSINESS_RESEARCH_INVALID_EVENT', `Invalid event sequence: ${replay.code}`);
      await this.store.write(path, { runId: event.runId, events: next } satisfies EventFile);
    });
  }

  async getEvents(runId: BusinessResearchRunId): Promise<BusinessResearchEvent[]> {
    assertId('run', runId);
    return structuredClone(await this.readEvents(runId));
  }

  /** Upserts evidence by stable id so a verified page can upgrade its search excerpt in place. */
  async saveEvidence(runId: BusinessResearchRunId, evidence: readonly BusinessResearchEvidence[]): Promise<void> {
    assertId('run', runId);
    for (const item of evidence) assertEvidence(item);
    const path = this.runFile(runId, EVIDENCE_FILE);
    await withFileLock(this.store.resolve(path), async () => {
      const current = await this.readEvidence(runId);
      const byId = new Map<BusinessResearchEvidenceId, BusinessResearchEvidence>(current.map((item) => [item.id, item]));
      for (const item of evidence) byId.set(item.id, structuredClone(item));
      await this.store.write(path, { runId, evidence: [...byId.values()] } satisfies EvidenceFile);
    });
  }

  async getEvidence(runId: BusinessResearchRunId): Promise<BusinessResearchEvidence[]> {
    assertId('run', runId);
    return structuredClone(await this.readEvidence(runId));
  }

  async saveReport(report: SynthesizedBusinessResearchReport): Promise<void> {
    assertReport(report);
    await this.store.write(this.reportFile(report.id), structuredClone(report));
  }

  async getReport(reportId: BusinessResearchReportId): Promise<SynthesizedBusinessResearchReport | undefined> {
    assertId('report', reportId);
    const value = await this.store.read<unknown>(this.reportFile(reportId), null);
    if (value === null) return undefined;
    if (!isReport(value) || value.id !== reportId) throw corruptRecord('report', reportId);
    return structuredClone(value);
  }

  async listReports(): Promise<SynthesizedBusinessResearchReport[]> {
    const reports = await Promise.all((await this.listIds('report', `${ROOT}/reports`)).map((id) => this.getReport(id)));
    return reports.filter(isDefined).sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt) || left.id.localeCompare(right.id));
  }

  async saveSubscription(subscription: BusinessResearchSubscriptionRecord): Promise<void> {
    assertSubscription(subscription);
    await this.store.write(this.subscriptionFile(subscription.id, RECORD_FILE), structuredClone(subscription));
  }

  async getSubscription(
    subscriptionId: BusinessResearchSubscriptionId,
  ): Promise<BusinessResearchSubscriptionRecord | undefined> {
    assertId('subscription', subscriptionId);
    const value = await this.store.read<unknown>(this.subscriptionFile(subscriptionId, RECORD_FILE), null);
    if (value === null) return undefined;
    if (!isSubscription(value) || value.id !== subscriptionId) throw corruptRecord('subscription', subscriptionId);
    return structuredClone(value);
  }

  async listSubscriptionIds(): Promise<BusinessResearchSubscriptionId[]> {
    return this.listIds('subscription', `${ROOT}/subscriptions`);
  }

  async listSubscriptions(): Promise<BusinessResearchSubscriptionRecord[]> {
    const subscriptions = await Promise.all((await this.listSubscriptionIds()).map((id) => this.getSubscription(id)));
    return subscriptions.filter(isDefined).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  async appendCheck(check: BusinessResearchCheckRecord): Promise<void> {
    assertCheck(check);
    const path = this.subscriptionFile(check.subscriptionId, CHECKS_FILE);
    await withFileLock(this.store.resolve(path), async () => {
      const current = await this.readChecks(check.subscriptionId);
      if (current.some((entry) => entry.id === check.id)) return;
      await this.store.write(path, {
        subscriptionId: check.subscriptionId,
        checks: [...current, structuredClone(check)],
      } satisfies CheckFile);
    });
  }

  async listChecks(subscriptionId: BusinessResearchSubscriptionId): Promise<BusinessResearchCheckRecord[]> {
    assertId('subscription', subscriptionId);
    return structuredClone(await this.readChecks(subscriptionId));
  }

  async saveMonitorSources(
    subscriptionId: BusinessResearchSubscriptionId,
    sources: readonly BusinessResearchMonitorSourceSnapshot[],
  ): Promise<void> {
    assertId('subscription', subscriptionId);
    const validated = parseMonitorSources(sources);
    if (validated === undefined) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_MONITOR_SOURCES', 'Invalid public source snapshots.');
    }
    const path = this.subscriptionFile(subscriptionId, SOURCES_FILE);
    await withFileLock(this.store.resolve(path), async () => {
      await this.store.write(path, { subscriptionId, sources: validated } satisfies SourceFile);
    });
  }

  async getMonitorSources(
    subscriptionId: BusinessResearchSubscriptionId,
  ): Promise<BusinessResearchMonitorSourceSnapshot[]> {
    assertId('subscription', subscriptionId);
    const value = await this.store.read<unknown>(this.subscriptionFile(subscriptionId, SOURCES_FILE), {
      subscriptionId,
      sources: [],
    });
    if (!isSourceFile(value, subscriptionId)) throw corruptRecord('monitor source snapshots', subscriptionId);
    return structuredClone(value.sources);
  }

  /** Reserves one signal fingerprint once; concurrent or restarted checks receive the original run id. */
  async reserveFingerprint(
    subscriptionId: BusinessResearchSubscriptionId,
    fingerprint: string,
    runId: BusinessResearchRunId,
  ): Promise<BusinessResearchFingerprintReservation> {
    assertId('subscription', subscriptionId);
    assertId('run', runId);
    if (!isSignalFingerprint(fingerprint)) throw createCodeError('BUSINESS_RESEARCH_INVALID_FINGERPRINT', 'Invalid monitor signal fingerprint.');
    const path = this.subscriptionFile(subscriptionId, FINGERPRINTS_FILE);
    return withFileLock(this.store.resolve(path), async () => {
      const current = await this.readFingerprints(subscriptionId);
      const existingRunId = current.reservations[fingerprint];
      if (existingRunId !== undefined) return { reserved: false, existingRunId };
      const next: FingerprintFile = {
        subscriptionId,
        reservations: { ...current.reservations, [fingerprint]: runId },
      };
      await this.store.write(path, next);
      return { reserved: true, runId };
    });
  }

  async getFingerprintRun(
    subscriptionId: BusinessResearchSubscriptionId,
    fingerprint: string,
  ): Promise<BusinessResearchRunId | undefined> {
    assertId('subscription', subscriptionId);
    if (!isSignalFingerprint(fingerprint)) return undefined;
    return (await this.readFingerprints(subscriptionId)).reservations[fingerprint];
  }

  private runFile(runId: BusinessResearchRunId, file: string): string {
    assertId('run', runId);
    return `${ROOT}/runs/${storageKey(runId)}/${file}`;
  }

  private reportFile(reportId: BusinessResearchReportId): string {
    assertId('report', reportId);
    return `${ROOT}/reports/${storageKey(reportId)}/${RECORD_FILE}`;
  }

  private subscriptionFile(subscriptionId: BusinessResearchSubscriptionId, file: string): string {
    assertId('subscription', subscriptionId);
    return `${ROOT}/subscriptions/${storageKey(subscriptionId)}/${file}`;
  }

  private async readEvents(runId: BusinessResearchRunId): Promise<BusinessResearchEvent[]> {
    const file = await this.store.read<unknown>(this.runFile(runId, EVENTS_FILE), { runId, events: [] });
    if (!isEventFile(file, runId)) throw corruptRecord('event log', runId);
    return file.events;
  }

  private async readEvidence(runId: BusinessResearchRunId): Promise<BusinessResearchEvidence[]> {
    const file = await this.store.read<unknown>(this.runFile(runId, EVIDENCE_FILE), { runId, evidence: [] });
    if (!isEvidenceFile(file, runId)) throw corruptRecord('evidence', runId);
    return file.evidence;
  }

  private async readChecks(subscriptionId: BusinessResearchSubscriptionId): Promise<BusinessResearchCheckRecord[]> {
    const file = await this.store.read<unknown>(this.subscriptionFile(subscriptionId, CHECKS_FILE), { subscriptionId, checks: [] });
    if (!isCheckFile(file, subscriptionId)) throw corruptRecord('monitor check log', subscriptionId);
    return file.checks;
  }

  private async readFingerprints(subscriptionId: BusinessResearchSubscriptionId): Promise<FingerprintFile> {
    const file = await this.store.read<unknown>(this.subscriptionFile(subscriptionId, FINGERPRINTS_FILE), {
      subscriptionId,
      reservations: {},
    });
    if (!isFingerprintFile(file, subscriptionId)) throw corruptRecord('signal fingerprints', subscriptionId);
    return file;
  }

  private async listIds<Kind extends 'run' | 'report' | 'subscription'>(
    kind: Kind,
    directory: string,
  ): Promise<ParsedBusinessResearchId<Kind>[]> {
    let names: string[];
    try {
      const entries = await readdir(this.store.resolve(directory), { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw error;
    }
    const result: ParsedBusinessResearchId<Kind>[] = [];
    for (const name of names) {
      const decoded = decodeStorageKey(name);
      const id = parseBusinessResearchId(kind, decoded);
      if (id !== undefined) result.push(id);
    }
    return result.sort((left, right) => String(left).localeCompare(String(right)));
  }
}

function storageKey(value: string): string {
  return `v1-${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function decodeStorageKey(value: string): string {
  if (!value.startsWith('v1-')) return '';
  try {
    const decoded = Buffer.from(value.slice(3), 'base64url').toString('utf8');
    return storageKey(decoded) === value ? decoded : '';
  } catch {
    return '';
  }
}

async function withFileLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  fileLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (fileLocks.get(key) === current) fileLocks.delete(key);
  }
}

function assertId<Kind extends BusinessResearchIdKind>(kind: Kind, value: unknown): asserts value is ReturnType<typeof parseBusinessResearchId<Kind>> & string {
  if (parseBusinessResearchId(kind, value) === undefined) {
    throw createCodeError('BUSINESS_RESEARCH_INVALID_ID', `Invalid business research ${kind} id.`);
  }
}

function assertRunRecord(record: BusinessResearchRunRecord): void {
  if (!isRunRecord(record)) throw createCodeError('BUSINESS_RESEARCH_INVALID_RUN', 'Invalid business research run record.');
}

function isRunRecord(value: unknown): value is BusinessResearchRunRecord {
  if (!isRecord(value)) return false;
  return parseBusinessResearchId('run', value.id) !== undefined &&
    isValidTaskInput(value.task) &&
    (value.mode === undefined || isBusinessResearchRunMode(value.mode)) &&
    isRunState(value.state) &&
    isEpoch(value.createdAt) &&
    isEpoch(value.updatedAt) &&
    (value.reportId === undefined || parseBusinessResearchId('report', value.reportId) !== undefined);
}

function isRunState(value: unknown): value is BusinessResearchRunState {
  if (!isRecord(value) || !isBusinessResearchRunStatus(value.status)) return false;
  if (value.status === 'queued' || value.status === 'planning' || value.status === 'gathering' || value.status === 'synthesizing') {
    return isIsoTime(value.updatedAt);
  }
  if (value.status === 'completed') return isIsoTime(value.completedAt);
  if (value.status === 'partial') return isIsoTime(value.completedAt) && typeof value.reason === 'string';
  if (value.status === 'failed') return isIsoTime(value.completedAt) && typeof value.code === 'string';
  return value.status === 'cancelled' && isIsoTime(value.completedAt) &&
    (value.reason === undefined || typeof value.reason === 'string');
}

function isSubscription(value: unknown): value is BusinessResearchSubscriptionRecord {
  if (!isRecord(value)) return false;
  return parseBusinessResearchId('subscription', value.id) !== undefined &&
    isValidTaskInput(value.task) &&
    Number.isInteger(value.intervalMs) && Number(value.intervalMs) >= MIN_INTERVAL_MS &&
    typeof value.enabled === 'boolean' &&
    isEpoch(value.createdAt) && isEpoch(value.updatedAt) && isEpoch(value.nextCheckAt) &&
    (value.lastCheckAt === undefined || isEpoch(value.lastCheckAt)) &&
    (value.removedAt === undefined || isEpoch(value.removedAt));
}

function assertSubscription(record: BusinessResearchSubscriptionRecord): void {
  if (!isSubscription(record)) throw createCodeError('BUSINESS_RESEARCH_INVALID_SUBSCRIPTION', 'Invalid business research subscription record.');
}

function isCheck(value: unknown): value is BusinessResearchCheckRecord {
  if (!isRecord(value) || parseBusinessResearchId('event', value.id) === undefined ||
    parseBusinessResearchId('subscription', value.subscriptionId) === undefined ||
    !isEpoch(value.startedAt) || !isEpoch(value.completedAt) || value.completedAt < value.startedAt ||
    !isMonitorDecision(value.decision)) return false;
  return value.runId === undefined || parseBusinessResearchId('run', value.runId) !== undefined;
}

function assertCheck(check: BusinessResearchCheckRecord): void {
  if (!isCheck(check)) throw createCodeError('BUSINESS_RESEARCH_INVALID_CHECK', 'Invalid business research monitor check.');
}

function isMonitorDecision(value: unknown): value is BusinessResearchMonitorSignalDecision {
  if (!isRecord(value)) return false;
  if (value.kind === 'trigger') {
    return (value.reason === 'new_source' || value.reason === 'source_updated') &&
      typeof value.url === 'string' && canonicalizeEvidenceUrl(value.url) !== undefined &&
      isSignalFingerprint(value.fingerprint);
  }
  return value.kind === 'skip' && [
    'invalid_input', 'check_failed', 'unrelated', 'no_change', 'duplicate_signal', 'subscription_disabled',
  ].includes(String(value.reason));
}

function assertEvent(event: BusinessResearchEvent): void {
  if (!isEvent(event)) throw createCodeError('BUSINESS_RESEARCH_INVALID_EVENT', 'Invalid business research event.');
}

function isEvent(value: unknown): value is BusinessResearchEvent {
  if (!isRecord(value) || parseBusinessResearchId('run', value.runId) === undefined ||
    !Number.isInteger(value.sequence) || Number(value.sequence) < 1 || !isEpoch(value.timestamp)) return false;
  if (value.type === 'run_started') return isValidTaskInput(value.task) &&
    (value.mode === undefined || isBusinessResearchRunMode(value.mode));
  if (value.type === 'phase_changed') return ['planning', 'gathering', 'synthesizing'].includes(String(value.status));
  if (value.type === 'decision_made') return isAction(value.action);
  if (value.type === 'decision_rejected') return typeof value.code === 'string' && value.code.length <= 64;
  if (value.type === 'tool_started') {
    return (value.actionKind === 'search_web' || value.actionKind === 'open_source') &&
      (value.evidenceId === undefined || parseBusinessResearchId('evidence', value.evidenceId) !== undefined);
  }
  if (value.type === 'observation_recorded') return isObservation(value.observation);
  if (value.type === 'run_terminal') return isTerminalOutcome(value.outcome);
  return false;
}

function isEventFile(value: unknown, runId: BusinessResearchRunId): value is EventFile {
  if (!isRecord(value) || value.runId !== runId || !Array.isArray(value.events)) return false;
  const events = value.events as unknown[];
  if (!events.every(isEvent)) return false;
  return replayBusinessResearchEvents(events as BusinessResearchEvent[]).ok;
}

function isEvidenceFile(value: unknown, runId: BusinessResearchRunId): value is EvidenceFile {
  if (!isRecord(value) || value.runId !== runId || !Array.isArray(value.evidence)) return false;
  const evidence = value.evidence as unknown[];
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!isEvidence(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function isCheckFile(value: unknown, subscriptionId: BusinessResearchSubscriptionId): value is CheckFile {
  if (!isRecord(value) || value.subscriptionId !== subscriptionId || !Array.isArray(value.checks)) return false;
  return (value.checks as unknown[]).every(isCheck);
}

function isFingerprintFile(value: unknown, subscriptionId: BusinessResearchSubscriptionId): value is FingerprintFile {
  if (!isRecord(value) || value.subscriptionId !== subscriptionId || !isRecord(value.reservations)) return false;
  return Object.entries(value.reservations).every(([fingerprint, runId]) =>
    isSignalFingerprint(fingerprint) && parseBusinessResearchId('run', runId) !== undefined,
  );
}

function isSourceFile(value: unknown, subscriptionId: BusinessResearchSubscriptionId): value is SourceFile {
  return isRecord(value) && value.subscriptionId === subscriptionId && parseMonitorSources(value.sources) !== undefined;
}

function parseMonitorSources(value: unknown): BusinessResearchMonitorSourceSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const sourcesByUrl = new Map<string, BusinessResearchMonitorSourceSnapshot>();
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
    ) return undefined;
    if (!sourcesByUrl.has(url)) {
      sourcesByUrl.set(url, {
        url,
        title,
        summary,
        ...(contentFingerprint === undefined ? {} : { contentFingerprint }),
        ...(typeof retrievedAt === 'string' ? { retrievedAt: new Date(retrievedAt).toISOString() } : {}),
      });
    }
  }
  return [...sourcesByUrl.values()];
}

function assertReport(report: SynthesizedBusinessResearchReport): void {
  if (!isReport(report)) throw createCodeError('BUSINESS_RESEARCH_INVALID_REPORT', 'Invalid business research report.');
}

function isReport(value: unknown): value is SynthesizedBusinessResearchReport {
  if (!isRecord(value) || parseBusinessResearchId('report', value.id) === undefined ||
    parseBusinessResearchId('run', value.runId) === undefined || !isIsoTime(value.generatedAt) ||
    (value.status !== 'completed' && value.status !== 'partial') ||
    (value.status === 'partial' && typeof value.partialReason !== 'string') ||
    typeof value.title !== 'string' || cleanEvidenceText(value.title, 300).length === 0 ||
    !Array.isArray(value.claims) || !value.claims.every(isClaim) ||
    !Array.isArray(value.evidence) || !value.evidence.every(isEvidence) ||
    !Array.isArray(value.monitoringActions) || !value.monitoringActions.every((action) => typeof action === 'string')) return false;
  return true;
}

function isClaim(value: unknown): value is BusinessResearchClaim {
  if (!isRecord(value) || parseBusinessResearchId('claim', value.id) === undefined) return false;
  if (value.kind === 'supported') return typeof value.statement === 'string' && isEvidenceIdArray(value.evidenceIds);
  if (value.kind === 'conflicted') {
    return typeof value.statement === 'string' && isEvidenceIdArray(value.supportingEvidenceIds) &&
      isEvidenceIdArray(value.contradictingEvidenceIds);
  }
  return value.kind === 'unresolved' && typeof value.question === 'string' && typeof value.reason === 'string';
}

function isEvidenceIdArray(value: unknown): value is [BusinessResearchEvidenceId, ...BusinessResearchEvidenceId[]] {
  return Array.isArray(value) && value.length > 0 && value.every((id) => parseBusinessResearchId('evidence', id) !== undefined);
}

function assertEvidence(evidence: BusinessResearchEvidence): void {
  if (!isEvidence(evidence)) throw createCodeError('BUSINESS_RESEARCH_INVALID_EVIDENCE', 'Invalid business research evidence.');
}

function isEvidence(value: unknown): value is BusinessResearchEvidence {
  if (!isRecord(value)) return false;
  const fixtureGradeMatchesSource = (value.sourceKind === 'fixture') === (value.grade === 'fixture_data');
  return parseBusinessResearchId('evidence', value.id) !== undefined &&
    parseBusinessResearchId('source', value.sourceId) !== undefined &&
    typeof value.title === 'string' && cleanEvidenceText(value.title, 500).length > 0 &&
    typeof value.url === 'string' && canonicalizeEvidenceUrl(value.url) !== undefined &&
    isBusinessResearchSourceKind(value.sourceKind) && isBusinessResearchEvidenceGrade(value.grade) && fixtureGradeMatchesSource &&
    typeof value.query === 'string' && cleanEvidenceText(value.query, 500).length > 0 &&
    typeof value.excerpt === 'string' && cleanEvidenceText(value.excerpt, 4_000).length > 0 && isIsoTime(value.retrievedAt);
}

function isObservation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'search_results') {
    return typeof value.query === 'string' && Array.isArray(value.evidence) && value.evidence.every(isEvidence);
  }
  if (value.kind === 'source_opened') return isEvidence(value.evidence);
  return value.kind === 'tool_failure' &&
    (value.actionKind === 'search_web' || value.actionKind === 'open_source') && typeof value.code === 'string';
}

function isAction(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'search_web') return typeof value.query === 'string' && typeof value.taskId === 'string';
  if (value.kind === 'open_source') return parseBusinessResearchId('evidence', value.evidenceId) !== undefined;
  return value.kind === 'finish' && typeof value.rationale === 'string';
}

function isTerminalOutcome(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.status === 'completed') return true;
  if (value.status === 'partial') return typeof value.reason === 'string';
  if (value.status === 'failed') return typeof value.code === 'string';
  return value.status === 'cancelled' && (value.reason === undefined || typeof value.reason === 'string');
}

function isValidTaskInput(value: unknown): value is BusinessResearchTaskInput {
  return normalizeBusinessResearchInput(value).ok;
}

function isSignalFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^signal-[a-f0-9]{64}$/u.test(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function corruptRecord(kind: string, id: string): Error {
  return createCodeError('BUSINESS_RESEARCH_CORRUPT_RECORD', `Stored business research ${kind} record is invalid (${id}).`);
}
