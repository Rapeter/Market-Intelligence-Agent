import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpRight, Check, Clock3, Pause, Play, RefreshCw, Search, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import {
  BUSINESS_RESEARCH_STRATEGY_KEYS,
  normalizeBusinessResearchInput,
  type ApiResult,
  type BusinessResearchAction,
  type BusinessResearchClaim,
  type BusinessResearchEvidence,
  type BusinessResearchRunId,
  type BusinessResearchStrategyId,
} from '@finagent/core';
import type {
  BusinessResearchEvaluationMetrics,
  BusinessResearchReport,
  BusinessResearchSubscriptionRecord,
} from '@finagent/shared/business-research';
import {
  businessResearchChecksAtom,
  businessResearchEventsAtom,
  businessResearchFormAtom,
  businessResearchMetricsAtom,
  businessResearchModeAtom,
  businessResearchReportsAtom,
  businessResearchRunsAtom,
  businessResearchSubscriptionsAtom,
  selectedBusinessResearchReportAtom,
  selectedBusinessResearchReportIdAtom,
  selectedBusinessResearchRunAtom,
  selectedBusinessResearchRunIdAtom,
  selectedBusinessResearchSubscriptionAtom,
  selectedBusinessResearchSubscriptionIdAtom,
} from '../../atoms/businessResearchAtoms';
import { useFinagentClient } from '../../client';

const STRATEGIES: readonly BusinessResearchStrategyId[] = BUSINESS_RESEARCH_STRATEGY_KEYS;
const ACTIVE_STATES = new Set(['queued', 'planning', 'gathering', 'synthesizing']);
const CHECK_INTERVALS = [
  { value: 60 * 60 * 1_000, label: '1 h' },
  { value: 6 * 60 * 60 * 1_000, label: '6 h' },
  { value: 24 * 60 * 60 * 1_000, label: '24 h' },
] as const;

export const BusinessResearchWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const api = client.businessResearch;
  const form = useAtomValue(businessResearchFormAtom);
  const setForm = useSetAtom(businessResearchFormAtom);
  const mode = useAtomValue(businessResearchModeAtom);
  const setMode = useSetAtom(businessResearchModeAtom);
  const runs = useAtomValue(businessResearchRunsAtom);
  const setRuns = useSetAtom(businessResearchRunsAtom);
  const reports = useAtomValue(businessResearchReportsAtom);
  const setReports = useSetAtom(businessResearchReportsAtom);
  const events = useAtomValue(businessResearchEventsAtom);
  const setEvents = useSetAtom(businessResearchEventsAtom);
  const subscriptions = useAtomValue(businessResearchSubscriptionsAtom);
  const setSubscriptions = useSetAtom(businessResearchSubscriptionsAtom);
  const checks = useAtomValue(businessResearchChecksAtom);
  const setChecks = useSetAtom(businessResearchChecksAtom);
  const metrics = useAtomValue(businessResearchMetricsAtom);
  const setMetrics = useSetAtom(businessResearchMetricsAtom);
  const selectedRun = useAtomValue(selectedBusinessResearchRunAtom);
  const selectedRunId = useAtomValue(selectedBusinessResearchRunIdAtom);
  const selectedRunIdRef = useRef(selectedRunId);
  const selectedReport = useAtomValue(selectedBusinessResearchReportAtom);
  const selectedSubscription = useAtomValue(selectedBusinessResearchSubscriptionAtom);
  const setSelectedRunId = useSetAtom(selectedBusinessResearchRunIdAtom);
  const setSelectedReportId = useSetAtom(selectedBusinessResearchReportIdAtom);
  const setSelectedSubscriptionId = useSetAtom(selectedBusinessResearchSubscriptionIdAtom);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'start' | 'subscribe' | 'evaluation' | 'credential' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [credentialUpdatedAt, setCredentialUpdatedAt] = useState<number | undefined>();
  const [credentialDraft, setCredentialDraft] = useState('');
  const [intervalMs, setIntervalMs] = useState<number>(24 * 60 * 60 * 1_000);

  useEffect(() => { selectedRunIdRef.current = selectedRunId; }, [selectedRunId]);

  const normalizedInput = useMemo(() => normalizeBusinessResearchInput({
    industry: form.industry,
    question: form.question,
    competitors: parseCompetitors(form.competitorsText),
    strategyId: form.strategyId,
  }), [form]);

  const refreshRecords = useCallback(async () => {
    if (!api) throw new Error(t('research.businessResearch.errors.unavailable'));
    const [runResult, reportResult, subscriptionResult, credentialResult] = await Promise.all([
      api.listRuns(), api.listReports(), api.listSubscriptions(), api.getCredentialStatus(),
    ]);
    const nextRuns = unwrap(runResult);
    const nextReports = unwrap(reportResult);
    const nextSubscriptions = unwrap(subscriptionResult);
    const credential = unwrap(credentialResult);
    setRuns(nextRuns);
    setReports(nextReports);
    setSubscriptions(nextSubscriptions);
    setCredentialConfigured(credential.configured);
    setCredentialUpdatedAt(credential.updatedAt);
    const currentSelectedRunId = selectedRunIdRef.current;
    const nextSelectedRunId = currentSelectedRunId && nextRuns.some((item) => item.id === currentSelectedRunId)
      ? currentSelectedRunId
      : nextRuns[0]?.id ?? null;
    const nextSelectedRun = nextRuns.find((item) => item.id === nextSelectedRunId);
    setSelectedRunId(nextSelectedRunId);
    setSelectedReportId(nextSelectedRun?.reportId && nextReports.some((item) => item.id === nextSelectedRun.reportId)
      ? nextSelectedRun.reportId
      : null);
    setSelectedSubscriptionId((current) => current && nextSubscriptions.some((item) => item.id === current)
      ? current
      : nextSubscriptions[0]?.id ?? null);
  }, [api, setReports, setRuns, setSelectedReportId, setSelectedRunId, setSelectedSubscriptionId, setSubscriptions, setCredentialConfigured, setCredentialUpdatedAt, t]);

  const refreshEvaluation = useCallback(async () => {
    if (!api) throw new Error(t('research.businessResearch.errors.unavailable'));
    const result = unwrap(await api.evaluate());
    setMetrics(result);
  }, [api, setMetrics, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await refreshRecords();
        if (active) await refreshEvaluation();
      } catch (caught) {
        if (active) setError(errorMessage(caught, t('research.businessResearch.errors.load')));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshEvaluation, refreshRecords, t]);

  useEffect(() => {
    if (!api || selectedRun === undefined) {
      setEvents([]);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const runId = selectedRun.id;
    setEvents([]);
    const poll = async () => {
      try {
        const [runResult, eventResult] = await Promise.all([api.getRun(runId), api.listEvents(runId)]);
        const nextRun = unwrap(runResult);
        const nextEvents = unwrap(eventResult);
        if (!active) return;
        if (nextRun) {
          setRuns((current) => current.map((item) => item.id === runId ? nextRun : item));
          if (nextRun.reportId) {
            const reportResult = unwrap(await api.getReport(nextRun.reportId));
            if (reportResult) {
              setReports((current) => [reportResult, ...current.filter((item) => item.id !== reportResult.id)]);
              setSelectedReportId(nextRun.reportId);
            }
          }
        }
        setEvents(nextEvents);
        if (nextRun && ACTIVE_STATES.has(nextRun.state.status)) {
          timer = setTimeout(() => void poll(), 1_200);
        }
      } catch (caught) {
        if (active) setError(errorMessage(caught, t('research.businessResearch.errors.load')));
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, selectedRun?.id, setEvents, setReports, setRuns, setSelectedReportId, t]);

  useEffect(() => {
    if (!api || !selectedSubscription) {
      setChecks([]);
      return;
    }
    let active = true;
    void api.listChecks(selectedSubscription.id).then((result) => {
      if (active && result.ok) setChecks(result.data);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, selectedSubscription?.id, setChecks]);

  const updateForm = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const handleRefresh = async () => {
    setError(null);
    try {
      await refreshRecords();
      await refreshEvaluation();
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.load')));
    }
  };

  const handleStart = async () => {
    if (!api) { setError(t('research.businessResearch.errors.unavailable')); return; }
    if (!normalizedInput.ok) { setError(t('research.businessResearch.form.invalid')); return; }
    setBusy('start');
    setError(null);
    setNotice(null);
    try {
      const run = unwrap(await api.start(normalizedInput.value, mode));
      setSelectedRunId(run.id);
      setSelectedReportId(run.reportId ?? null);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      await refreshRecords();
      setSelectedRunId(run.id);
      setSelectedReportId(run.reportId ?? null);
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.start')));
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!api || !selectedRun || !ACTIVE_STATES.has(selectedRun.state.status)) return;
    setError(null);
    try {
      unwrap(await api.cancel(selectedRun.id));
      const latest = unwrap(await api.getRun(selectedRun.id));
      if (latest) setRuns((current) => current.map((item) => item.id === latest.id ? latest : item));
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.start')));
    }
  };

  const handleSubscribe = async () => {
    if (!api) { setError(t('research.businessResearch.errors.unavailable')); return; }
    if (!normalizedInput.ok) { setError(t('research.businessResearch.form.invalid')); return; }
    setBusy('subscribe');
    setError(null);
    try {
      const subscription = unwrap(await api.subscribe(normalizedInput.value, intervalMs));
      setSelectedSubscriptionId(subscription.id);
      await refreshRecords();
      setNotice(t('research.businessResearch.monitor.title'));
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.monitor')));
    } finally {
      setBusy(null);
    }
  };

  const handleMonitorAction = async (subscription: BusinessResearchSubscriptionRecord, action: 'pause' | 'resume' | 'remove') => {
    if (!api) return;
    setError(null);
    try {
      if (action === 'pause') unwrap(await api.unsubscribe(subscription.id));
      if (action === 'resume') unwrap(await api.resumeSubscription(subscription.id));
      if (action === 'remove') unwrap(await api.removeSubscription(subscription.id));
      await refreshRecords();
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.monitor')));
    }
  };

  const handleEvaluation = async () => {
    setBusy('evaluation');
    setError(null);
    try { await refreshEvaluation(); }
    catch (caught) { setError(errorMessage(caught, t('research.businessResearch.errors.evaluation'))); }
    finally { setBusy(null); }
  };

  const handleSaveCredential = async () => {
    if (!api || credentialDraft.trim().length === 0) return;
    setBusy('credential');
    setError(null);
    try {
      const result = unwrap(await api.setBraveKey(credentialDraft));
      setCredentialConfigured(result.configured);
      setCredentialUpdatedAt(result.updatedAt);
      setCredentialDraft('');
      setNotice(t('research.businessResearch.credential.saved'));
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.credential')));
    } finally { setBusy(null); }
  };

  const handleRemoveCredential = async () => {
    if (!api) return;
    setBusy('credential');
    setError(null);
    try {
      const result = unwrap(await api.removeBraveKey());
      setCredentialConfigured(result.configured);
      setCredentialUpdatedAt(result.updatedAt);
      setCredentialDraft('');
      setNotice(t('research.businessResearch.credential.removed'));
    } catch (caught) {
      setError(errorMessage(caught, t('research.businessResearch.errors.credential')));
    } finally { setBusy(null); }
  };

  const selectRun = (runId: BusinessResearchRunId) => {
    setSelectedRunId(runId);
    const run = runs.find((item) => item.id === runId);
    setSelectedReportId(run?.reportId ?? null);
  };

  const selectReport = (reportId: string) => {
    const report = reports.find((item) => item.id === reportId);
    if (!report) return;
    setSelectedReportId(report.id);
    setSelectedRunId(report.runId);
  };

  const previousReport = useMemo(
    () => selectedReport ? findPreviousReport(selectedReport, reports, runs) : undefined,
    [reports, runs, selectedReport],
  );
  const reportDiff = useMemo(
    () => selectedReport ? diffReports(selectedReport, previousReport) : undefined,
    [previousReport, selectedReport],
  );

  if (!api) {
    return <WorkspaceMessage>{t('research.businessResearch.errors.unavailable')}</WorkspaceMessage>;
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f4f6f8]" data-testid="business-research-workspace">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6 xl:p-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-sky-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('research.businessResearch.title')}
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.035em] text-slate-900 sm:text-[28px]">
              {t('research.businessResearch.subtitle')}
            </h1>
          </div>
          <button type="button" onClick={() => void handleRefresh()} aria-label={t('research.businessResearch.history.reload')}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('research.businessResearch.history.reload')}
          </button>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          <BoundaryNotice icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
            {t('research.businessResearch.publicOnly')}
          </BoundaryNotice>
          <BoundaryNotice icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
            {t('research.businessResearch.feedbackCaveat')}
          </BoundaryNotice>
        </div>

        {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(270px,340px)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-4">
            <Panel title={t('research.businessResearch.form.title')} eyebrow="01 / SCOPE">
              <div className="space-y-3.5">
                <Field label={t('research.businessResearch.form.industry')}>
                  <input name="industry" value={form.industry} onChange={(event) => updateForm({ industry: event.currentTarget.value })}
                    placeholder={t('research.businessResearch.form.industryPlaceholder')} className={inputClass} />
                </Field>
                <Field label={t('research.businessResearch.form.question')}>
                  <textarea name="question" rows={3} value={form.question} onChange={(event) => updateForm({ question: event.currentTarget.value })}
                    placeholder={t('research.businessResearch.form.questionPlaceholder')} className={`${inputClass} resize-y`} />
                </Field>
                <Field label={t('research.businessResearch.form.competitors')} hint={t('research.businessResearch.form.competitorsHint')}>
                  <textarea name="competitors" rows={3} value={form.competitorsText} onChange={(event) => updateForm({ competitorsText: event.currentTarget.value })}
                    placeholder={t('research.businessResearch.form.competitorsPlaceholder')} className={`${inputClass} resize-y`} />
                </Field>
                <Field label={t('research.businessResearch.form.strategy')}>
                  <select value={form.strategyId} onChange={(event) => updateForm({ strategyId: event.currentTarget.value as BusinessResearchStrategyId })}
                    className={inputClass}>
                    {STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{t(`research.businessResearch.strategy.${strategy}`)}</option>)}
                  </select>
                </Field>
                <fieldset>
                  <legend className="mb-2 text-[11px] font-semibold text-slate-700">{t('research.businessResearch.form.mode')}</legend>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('research.businessResearch.form.mode')}>
                    <ModeButton active={mode === 'fixture'} onClick={() => setMode('fixture')} testId="business-research-mode-fixture">
                      {t('research.businessResearch.mode.fixture')}
                    </ModeButton>
                    <ModeButton active={mode === 'live'} onClick={() => setMode('live')} testId="business-research-mode-live">
                      {t('research.businessResearch.mode.live')}
                    </ModeButton>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">{t(`research.businessResearch.mode.${mode}Hint`)}</p>
                </fieldset>

                {mode === 'live' && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="business-research-credential">
                    <div className="mb-1 text-[11px] font-semibold text-slate-800">{t('research.businessResearch.credential.title')}</div>
                    <p className={`mb-2 text-[11px] ${credentialConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {credentialConfigured ? t('research.businessResearch.credential.configured') : t('research.businessResearch.credential.missing')}
                      {credentialUpdatedAt ? ` · ${formatTimestamp(credentialUpdatedAt)}` : ''}
                    </p>
                    <input type="password" autoComplete="new-password" spellCheck={false} value={credentialDraft}
                      onChange={(event) => setCredentialDraft(event.currentTarget.value)}
                      placeholder={t('research.businessResearch.credential.keyPlaceholder')} aria-label={t('research.businessResearch.credential.keyPlaceholder')}
                      className={inputClass} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={!credentialDraft.trim() || busy === 'credential'} onClick={() => void handleSaveCredential()}
                        className={secondaryButtonClass}>{t('research.businessResearch.credential.save')}</button>
                      {credentialConfigured && <button type="button" disabled={busy === 'credential'} onClick={() => void handleRemoveCredential()}
                        className={secondaryButtonClass}>{t('research.businessResearch.credential.remove')}</button>}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <button type="button" data-testid="business-research-start" disabled={busy === 'start'} onClick={() => void handleStart()}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
                    <Search className="h-3.5 w-3.5" aria-hidden="true" />
                    {busy === 'start' ? t('research.businessResearch.form.starting') : t('research.businessResearch.form.start')}
                  </button>
                  <button type="button" data-testid="business-research-subscribe-form" disabled={busy === 'subscribe'} onClick={() => void handleSubscribe()}
                    className={`${secondaryButtonClass} h-10 flex-1`}>{busy === 'subscribe' ? t('research.businessResearch.form.subscribing') : t('research.businessResearch.form.subscribe')}</button>
                </div>
              </div>
            </Panel>

            <Panel title={t('research.businessResearch.history.title')} eyebrow="02 / ARCHIVE" action={
              loading ? <span className="text-[10px] text-slate-400">{t('common.loading')}</span> : <span className="text-[10px] tabular-nums text-slate-400">{runs.length}</span>
            }>
              {runs.length === 0 ? <EmptyText>{t('research.businessResearch.history.empty')}</EmptyText> : (
                <div className="max-h-[270px] space-y-1 overflow-y-auto pr-1">
                  {runs.map((run) => {
                    const active = selectedRun?.id === run.id;
                    return <button key={run.id} type="button" onClick={() => selectRun(run.id)} aria-pressed={active}
                      className={`w-full rounded-md border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${active ? 'border-sky-300 bg-sky-50/70' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-800">{run.task.industry}</span>
                        <StatusPill value={run.state.status} />
                      </span>
                      <span className="mt-1 block truncate text-[10px] leading-4 text-slate-500">{run.task.question}</span>
                      <span className="mt-1 flex items-center gap-2 text-[9px] uppercase tracking-wide text-slate-400">
                        <span>{t(`research.businessResearch.history.${(run.mode ?? 'live') === 'fixture' ? 'fixture' : 'live'}`)}</span>
                        <span aria-hidden="true">·</span><span>{formatTimestamp(run.createdAt)}</span>
                      </span>
                    </button>;
                  })}
                </div>
              )}
            </Panel>
          </section>

          <section className="flex min-w-0 flex-col gap-4">
            <Panel title={t('research.businessResearch.timeline.title')} eyebrow="03 / DECISION TRACE" action={
              selectedRun && ACTIVE_STATES.has(selectedRun.state.status) ? (
                <button type="button" onClick={() => void handleCancel()} className="inline-flex items-center gap-1.5 rounded border border-rose-200 px-2 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                  <Pause className="h-3 w-3" aria-hidden="true" />{t('research.businessResearch.timeline.cancel')}
                </button>
              ) : null
            }>
              {selectedRun ? <RunTimeline events={events} active={ACTIVE_STATES.has(selectedRun.state.status)} t={t} /> : <EmptyText>{t('research.businessResearch.timeline.empty')}</EmptyText>}
            </Panel>

            <Panel title={t('research.businessResearch.report.title')} eyebrow="04 / FINDINGS" action={
              reports.length > 0 ? <select aria-label={t('research.businessResearch.report.title')} value={selectedReport?.id ?? ''}
                onChange={(event) => selectReport(event.currentTarget.value)} className="max-w-[190px] truncate rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                {reports.map((report) => <option key={report.id} value={report.id}>{report.title}</option>)}
              </select> : null
            }>
              {selectedReport ? <ResearchReportView report={selectedReport} previous={previousReport} diff={reportDiff} t={t} />
                : <EmptyText>{t('research.businessResearch.report.empty')}</EmptyText>}
            </Panel>
          </section>
        </div>

        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <Panel title={t('research.businessResearch.monitor.title')} eyebrow="05 / MONITOR" action={<Clock3 className="h-4 w-4 text-sky-700" aria-hidden="true" />}>
            <p className="mb-3 text-[11px] leading-5 text-slate-500">{t('research.businessResearch.monitor.description')}</p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="business-research-interval" className="text-[10px] font-medium text-slate-600">{t('research.businessResearch.monitor.interval')}</label>
              <select id="business-research-interval" value={intervalMs} onChange={(event) => setIntervalMs(Number(event.currentTarget.value))}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700">
                {CHECK_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <button type="button" data-testid="business-research-subscribe-monitor" onClick={() => void handleSubscribe()} disabled={busy === 'subscribe'} className={secondaryButtonClass}>
                <Play className="mr-1 inline h-3 w-3" aria-hidden="true" />{t('research.businessResearch.monitor.subscribe')}
              </button>
            </div>
            {subscriptions.length === 0 ? <EmptyText>{t('research.businessResearch.monitor.empty')}</EmptyText> : (
              <div className="space-y-2">
                {subscriptions.map((subscription) => {
                  const latestCheck = checks.filter((item) => item.subscriptionId === subscription.id).at(-1);
                  const selected = selectedSubscription?.id === subscription.id;
                  return <div key={subscription.id} className={`rounded-md border p-3 ${selected ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button type="button" onClick={() => setSelectedSubscriptionId(subscription.id)} aria-pressed={selected}
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                        <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-800">
                          <span className="truncate">{subscription.task.industry} · {subscription.task.competitors.join(', ')}</span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${subscription.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                            {subscription.enabled ? t('research.businessResearch.monitor.enabled') : t('research.businessResearch.monitor.paused')}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-slate-500">{subscription.task.question}</span>
                      </button>
                      <div className="flex shrink-0 gap-1">
                        {subscription.enabled ? <SmallAction title={t('research.businessResearch.monitor.pause')} onClick={() => void handleMonitorAction(subscription, 'pause')}><Pause className="h-3 w-3" /></SmallAction>
                          : <SmallAction title={t('research.businessResearch.monitor.resume')} onClick={() => void handleMonitorAction(subscription, 'resume')}><Play className="h-3 w-3" /></SmallAction>}
                        <SmallAction title={t('research.businessResearch.monitor.remove')} onClick={() => void handleMonitorAction(subscription, 'remove')}><Trash2 className="h-3 w-3" /></SmallAction>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
                      <span>{t('research.businessResearch.monitor.nextCheck')}: {formatTimestamp(subscription.nextCheckAt)}</span>
                      <span>{t('research.businessResearch.monitor.lastCheck')}: {latestCheck ? formatTimestamp(latestCheck.completedAt) : t('research.businessResearch.monitor.noCheck')}</span>
                      {latestCheck && <span>{t('research.businessResearch.monitor.checkReason')}: {humanize(latestCheck.decision.reason)}</span>}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">{formatDuration(subscription.intervalMs)}</div>
                  </div>;
                })}
              </div>
            )}
          </Panel>

          <Panel title={t('research.businessResearch.evaluation.title')} eyebrow="06 / MEASUREMENT" action={
            <button type="button" onClick={() => void handleEvaluation()} disabled={busy === 'evaluation'} className={secondaryButtonClass}>
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />{t('research.businessResearch.evaluation.refresh')}
            </button>
          }>
            {metrics ? <EvaluationView metrics={metrics} t={t} /> : <EmptyText>{loading ? t('common.loading') : t('research.businessResearch.errors.evaluation')}</EmptyText>}
          </Panel>
        </div>
      </div>
    </div>
  );
};

const inputClass = 'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100';
const secondaryButtonClass = 'inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

const Panel: React.FC<{ title: string; eyebrow: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, eyebrow, action, children }) => (
  <section className="min-w-0 rounded-lg border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)] sm:p-5">
    <div className="mb-4 flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 pb-3">
      <div className="min-w-0">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">{eyebrow}</div>
        <h2 className="truncate text-[14px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block text-[11px] font-semibold text-slate-700">
    <span className="mb-1.5 block">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[9px] font-normal text-slate-400">{hint}</span>}
  </label>
);

const ModeButton: React.FC<{ active: boolean; onClick: () => void; testId: string; children: React.ReactNode }> = ({ active, onClick, testId, children }) => (
  <button type="button" data-testid={testId} aria-pressed={active} onClick={onClick}
    className={`min-h-9 rounded-md border px-2 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${active ? 'border-sky-400 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
    {children}
  </button>
);

const BoundaryNotice: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white/75 px-3 py-2.5 text-[10px] leading-4 text-slate-600">
    <span className="mt-0.5 shrink-0 text-sky-700">{icon}</span><span>{children}</span>
  </div>
);

const EmptyText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/70 px-3 py-5 text-center text-[11px] leading-5 text-slate-400">{children}</p>
);

const WorkspaceMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full min-h-80 items-center justify-center bg-[#f4f6f8] p-6 text-center text-sm text-slate-600">{children}</div>
);

const StatusPill: React.FC<{ value: string }> = ({ value }) => {
  const { t } = useTranslation();
  const status = value as 'queued' | 'planning' | 'gathering' | 'synthesizing' | 'completed' | 'partial' | 'failed' | 'cancelled';
  const className = value === 'failed' ? 'bg-rose-100 text-rose-700'
    : value === 'partial' || value === 'cancelled' ? 'bg-amber-100 text-amber-800'
      : value === 'completed' ? 'bg-emerald-100 text-emerald-800'
        : 'bg-sky-100 text-sky-800';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${className}`}>{t(`research.businessResearch.state.${status}`)}</span>;
};

const SmallAction: React.FC<{ title: string; onClick: () => void; children: React.ReactNode }> = ({ title, onClick, children }) => (
  <button type="button" title={title} aria-label={title} onClick={onClick}
    className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
    {children}
  </button>
);

const RunTimeline: React.FC<{ events: ReturnType<typeof useAtomValue<typeof businessResearchEventsAtom>>; active: boolean; t: (key: string, options?: Record<string, unknown>) => string }> = ({ events, active, t }) => {
  if (events.length === 0) return <EmptyText>{t('research.businessResearch.timeline.empty')}</EmptyText>;
  const currentDecision = [...events].reverse().find((event) => event.type === 'decision_made');
  return <>
    {active && currentDecision?.type === 'decision_made' && <div className="mb-4 rounded-md border border-sky-100 bg-sky-50/70 px-3 py-2" aria-live="polite" data-testid="business-research-current-action">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-sky-800">{t('research.businessResearch.timeline.currentAction')}</div>
      <DecisionSummary action={currentDecision.action} t={t} />
    </div>}
    <ol className="relative ml-2 space-y-0 border-l border-slate-200 pl-5" aria-label={t('research.businessResearch.timeline.title')}>
      {events.map((event) => <li key={`${event.runId}:${event.sequence}`} className="relative pb-4 last:pb-0">
      <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-sky-600 ring-1 ring-sky-200" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-[11px] font-semibold text-slate-800">{timelineTitle(event, t)}</div>
        <time className="text-[9px] tabular-nums text-slate-400">{formatTimestamp(event.timestamp)}</time>
      </div>
      {event.type === 'decision_made' && <DecisionSummary action={event.action} t={t} />}
      {event.type === 'decision_rejected' && <p className="mt-1 text-[10px] text-amber-700">{humanize(event.code)}</p>}
      {event.type === 'tool_started' && <p className="mt-1 text-[10px] text-slate-500">{event.actionKind === 'search_web' ? t('research.businessResearch.timeline.search') : t('research.businessResearch.timeline.open')}</p>}
      {event.type === 'observation_recorded' && <ObservationView observation={event.observation} t={t} />}
      {event.type === 'run_terminal' && <p className="mt-1 text-[10px] leading-4 text-slate-500">{event.outcome.status === 'failed' ? humanize(event.outcome.code) : event.outcome.status === 'partial' || event.outcome.status === 'cancelled' ? event.outcome.reason ?? '' : ''}</p>}
      </li>)}
    </ol>
  </>;
};

const DecisionSummary: React.FC<{ action: BusinessResearchAction; t: (key: string, options?: Record<string, unknown>) => string }> = ({ action, t }) => {
  if (action.kind === 'search_web') return <p className="mt-1 break-words text-[10px] leading-4 text-slate-500">{t(`research.businessResearch.task.${action.taskId}`)} · “{action.query}”</p>;
  if (action.kind === 'open_source') return <p className="mt-1 break-all text-[10px] leading-4 text-slate-500">{action.evidenceId}</p>;
  return <p className="mt-1 text-[10px] leading-4 text-slate-500">{action.rationale}</p>;
};

const ObservationView: React.FC<{ observation: import('@finagent/core').BusinessResearchObservation; t: (key: string, options?: Record<string, unknown>) => string }> = ({ observation, t }) => {
  if (observation.kind === 'tool_failure') return <p className="mt-1 text-[10px] text-rose-700">{humanize(observation.code)}</p>;
  const evidence = observation.kind === 'search_results' ? observation.evidence : [observation.evidence];
  if (evidence.length === 0) return <p className="mt-1 text-[10px] text-slate-400">{t('research.businessResearch.timeline.noEvidence')}</p>;
  return <div className="mt-2 space-y-1.5">{evidence.map((item) => <EvidenceCard key={item.id} evidence={item} t={t} compact />)}</div>;
};

const EvidenceCard: React.FC<{ evidence: BusinessResearchEvidence; t: (key: string, options?: Record<string, unknown>) => string; compact?: boolean }> = ({ evidence, t, compact = false }) => {
  const href = publicEvidenceUrl(evidence);
  return <article className={`rounded-md border border-slate-100 bg-slate-50/80 ${compact ? 'p-2' : 'p-3'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="min-w-0 flex-1 text-[10px] font-semibold leading-4 text-slate-800">{evidence.title}</h4>
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[9px] font-medium text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
        {t('research.businessResearch.timeline.openLink')}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </a> : <span className="text-[9px] text-slate-400">{t('research.businessResearch.timeline.fixtureLink')}</span>}
    </div>
    <p className="mt-1 text-[9px] leading-4 text-slate-600">{evidence.excerpt}</p>
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] uppercase tracking-wide text-slate-400">
      <span>{t(`research.businessResearch.grade.${evidence.grade}`)}</span><span>{humanize(evidence.sourceKind)}</span><span>{formatTimestamp(evidence.retrievedAt)}</span>
    </div>
  </article>;
};

const ResearchReportView: React.FC<{
  report: BusinessResearchReport;
  previous: BusinessResearchReport | undefined;
  diff: { evidence: BusinessResearchEvidence[]; claims: BusinessResearchClaim[] } | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ report, previous, diff, t }) => (
  <div data-testid="business-research-report">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold text-slate-900">{report.title}</h3>
      <span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${report.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
        {t(`research.businessResearch.report.${report.status}`)} · {formatTimestamp(report.generatedAt)}
      </span>
    </div>
    {report.partialReason && <p className="mb-3 rounded border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">{report.partialReason}</p>}
    <div className="space-y-2.5">
      {report.claims.map((claim) => <ClaimCard key={claim.id} claim={claim} evidence={report.evidence} t={t} />)}
    </div>
    {report.claims.length === 0 && <EmptyText>{t('research.businessResearch.report.unresolvedNote')}</EmptyText>}
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{t('research.businessResearch.report.compare')}</div>
      {previous && diff ? <div className="grid gap-2 sm:grid-cols-2">
        <DiffCell label={t('research.businessResearch.report.newEvidence')} items={diff.evidence.map((item) => item.title)} />
        <DiffCell label={t('research.businessResearch.report.newClaims')} items={diff.claims.map(claimText)} />
      </div> : <p className="text-[10px] text-slate-400">{t('research.businessResearch.report.noPrevious')}</p>}
    </div>
    {report.monitoringActions.length > 0 && <div className="mt-3 rounded-md bg-sky-50/70 px-3 py-2 text-[10px] leading-4 text-sky-900">
      <span className="font-semibold">{t('research.businessResearch.monitor.title')}: </span>{report.monitoringActions.join(' · ')}
    </div>}
  </div>
);

const ClaimCard: React.FC<{ claim: BusinessResearchClaim; evidence: readonly BusinessResearchEvidence[]; t: (key: string, options?: Record<string, unknown>) => string }> = ({ claim, evidence, t }) => {
  const label = claim.kind === 'supported' ? t('research.businessResearch.report.supported')
    : claim.kind === 'conflicted' ? t('research.businessResearch.report.conflicted')
      : t('research.businessResearch.report.unresolved');
  const refs = claim.kind === 'supported' ? claim.evidenceIds
    : claim.kind === 'conflicted' ? [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds]
      : [];
  return <article className={`rounded-md border p-3 ${claim.kind === 'conflicted' ? 'border-amber-200 bg-amber-50/50' : claim.kind === 'unresolved' ? 'border-slate-200 bg-slate-50/60' : 'border-emerald-100 bg-emerald-50/35'}`}>
    <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
      {claim.kind === 'supported' ? <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" /> : claim.kind === 'conflicted' ? <AlertTriangle className="h-3 w-3 text-amber-700" aria-hidden="true" /> : null}
      {label}
    </div>
    <p className="text-[11px] leading-5 text-slate-800">{claim.kind === 'unresolved' ? claim.question : claim.statement}</p>
    {claim.kind === 'unresolved' && <p className="mt-1 text-[10px] leading-4 text-slate-500">{claim.reason} · {t('research.businessResearch.report.unresolvedNote')}</p>}
    {claim.kind === 'conflicted' && <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <EvidenceRefs title={t('research.businessResearch.report.supportingEvidence')} ids={claim.supportingEvidenceIds} evidence={evidence} t={t} />
      <EvidenceRefs title={t('research.businessResearch.report.contraryEvidence')} ids={claim.contradictingEvidenceIds} evidence={evidence} t={t} />
    </div>}
    {claim.kind !== 'conflicted' && refs.length > 0 && <EvidenceRefs title={t('research.businessResearch.report.evidence')} ids={refs} evidence={evidence} t={t} />}
  </article>;
};

const EvidenceRefs: React.FC<{ title: string; ids: readonly import('@finagent/core').BusinessResearchEvidenceId[]; evidence: readonly BusinessResearchEvidence[]; t: (key: string, options?: Record<string, unknown>) => string }> = ({ title, ids, evidence, t }) => {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return <div className="mt-2">
    <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
    <div className="space-y-1">{ids.map((id) => {
      const item = byId.get(id);
      if (!item) return <span key={id} className="block break-all text-[9px] text-rose-700">{id}</span>;
      const href = publicEvidenceUrl(item);
      return href ? <a key={id} href={href} target="_blank" rel="noopener noreferrer" className="block text-[9px] text-sky-700 hover:underline">{item.title} · {t(`research.businessResearch.grade.${item.grade}`)}</a>
        : <span key={id} className="block text-[9px] text-slate-500">{item.title} · {t(`research.businessResearch.grade.${item.grade}`)}</span>;
    })}</div>
  </div>;
};

const DiffCell: React.FC<{ label: string; items: string[] }> = ({ label, items }) => (
  <div className="rounded-md border border-slate-100 bg-slate-50 p-2.5">
    <div className="mb-1 text-[9px] font-semibold text-slate-600">{label} <span className="text-slate-400">({items.length})</span></div>
    {items.length > 0 ? <ul className="space-y-1">{items.slice(0, 4).map((item, index) => <li key={`${item}-${index}`} className="line-clamp-2 text-[9px] leading-4 text-slate-500">{item}</li>)}</ul>
      : <p className="text-[9px] text-slate-400">—</p>}
  </div>
);

const EvaluationView: React.FC<{ metrics: BusinessResearchEvaluationMetrics; t: (key: string, options?: Record<string, unknown>) => string }> = ({ metrics, t }) => (
  <div data-testid="business-research-evaluation">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-1 text-[9px] font-medium text-violet-800"><Sparkles className="h-3 w-3" aria-hidden="true" />{t('research.businessResearch.evaluation.fixtureLabel')}</span>
      <span className="text-[9px] tabular-nums text-slate-400">v{metrics.metadata.corpusVersion} · {formatTimestamp(metrics.metadata.evaluatedAt)}</span>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <MetricTile label={t('research.businessResearch.evaluation.cases')} value={`${metrics.cases.passed}/${metrics.cases.total}`} sub={`n=${metrics.cases.total} · ${metrics.cases.failed} failed`} />
      <MetricTile label={t('research.businessResearch.evaluation.samples')} value={`${metrics.cases.total}`} sub={`run n=${metrics.latency.run.sampleCount}`} />
      <MetricTile label={t('research.businessResearch.evaluation.p50')} value={formatLatency(metrics.latency.run.p50)} sub={`n=${metrics.latency.run.sampleCount}`} />
      <MetricTile label={t('research.businessResearch.evaluation.p95')} value={formatLatency(metrics.latency.run.p95)} sub={`max ${formatLatency(metrics.latency.run.max)}`} />
    </div>
    <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
      <RatioRow label={t('research.businessResearch.evaluation.taskCompletion')} ratio={metrics.taskCompletion} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.expectedOutcome')} ratio={metrics.expectedOutcomeAccuracy} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.tool')} ratio={metrics.toolSelectionAccuracy} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.citations')} ratio={metrics.citations.validity} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.coverage')} ratio={metrics.citations.factualClaimCoverage} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.recovery')} ratio={metrics.recovery} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.conflict')} ratio={metrics.conflictDetection} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.triggerPrecision')} ratio={metrics.automaticTrigger.precision} t={t} />
      <RatioRow label={t('research.businessResearch.evaluation.triggerRecall')} ratio={metrics.automaticTrigger.recall} t={t} />
    </div>
  </div>
);

const MetricTile: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div className="rounded-md border border-slate-100 bg-slate-50/80 p-2.5">
    <div className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-[16px] font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
    <div className="mt-0.5 truncate text-[8px] text-slate-500">{sub}</div>
  </div>
);

const RatioRow: React.FC<{ label: string; ratio: BusinessResearchEvaluationMetrics['taskCompletion']; t: (key: string, options?: Record<string, unknown>) => string }> = ({ label, ratio, t }) => (
  <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-[9px]">
    <span className="min-w-0 truncate text-slate-500">{label}</span>
    <span className="shrink-0 font-medium tabular-nums text-slate-700">{formatRatio(ratio, t)}</span>
  </div>
);

function timelineTitle(event: import('@finagent/shared/business-research').BusinessResearchEvent, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (event.type === 'run_started') return `${t('research.businessResearch.history.' + (event.mode === 'fixture' ? 'fixture' : 'live'))} · ${event.task.industry}`;
  if (event.type === 'phase_changed') return `${t('research.businessResearch.timeline.phase')} · ${t(`research.businessResearch.state.${event.status}`)}`;
  if (event.type === 'decision_made') return t('research.businessResearch.timeline.decision');
  if (event.type === 'decision_rejected') return t('research.businessResearch.timeline.failure');
  if (event.type === 'tool_started') return event.actionKind === 'search_web' ? t('research.businessResearch.timeline.search') : t('research.businessResearch.timeline.open');
  if (event.type === 'observation_recorded') return t('research.businessResearch.timeline.observation');
  return `${t('research.businessResearch.timeline.terminal')} · ${event.outcome.status}`;
}

function findPreviousReport(
  current: BusinessResearchReport,
  reports: readonly BusinessResearchReport[],
  runs: ReturnType<typeof useAtomValue<typeof import('../../atoms/businessResearchAtoms').businessResearchRunsAtom>>,
): BusinessResearchReport | undefined {
  const currentRun = runs.find((run) => run.id === current.runId);
  if (!currentRun) return undefined;
  return reports
    .filter((item) => item.id !== current.id && Date.parse(item.generatedAt) < Date.parse(current.generatedAt))
    .filter((item) => {
      const priorRun = runs.find((run) => run.id === item.runId);
      return priorRun !== undefined && sameTopic(currentRun.task, priorRun.task);
    })
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0];
}

function diffReports(current: BusinessResearchReport, previous: BusinessResearchReport | undefined) {
  if (!previous) return undefined;
  const priorEvidence = new Set(previous.evidence.map((item) => item.id));
  const priorClaims = new Set(previous.claims.map((claim) => `${claim.kind}:${claimText(claim).toLocaleLowerCase()}`));
  return {
    evidence: current.evidence.filter((item) => !priorEvidence.has(item.id)),
    claims: current.claims.filter((claim) => !priorClaims.has(`${claim.kind}:${claimText(claim).toLocaleLowerCase()}`)),
  };
}

function sameTopic(left: import('@finagent/core').BusinessResearchTaskInput, right: import('@finagent/core').BusinessResearchTaskInput): boolean {
  return normalizeText(left.industry) === normalizeText(right.industry)
    && normalizeText(left.question) === normalizeText(right.question)
    && left.competitors.map(normalizeText).sort().join('|') === right.competitors.map(normalizeText).sort().join('|');
}

function claimText(claim: BusinessResearchClaim): string {
  return claim.kind === 'unresolved' ? claim.question : claim.statement;
}

function parseCompetitors(value: string): string[] {
  return value.split(/[\n,，;；]/u).map((item) => item.trim()).filter(Boolean);
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function publicEvidenceUrl(evidence: BusinessResearchEvidence): string | undefined {
  if (evidence.sourceKind === 'fixture' || evidence.grade === 'fixture_data') return undefined;
  try {
    const url = new URL(evidence.url);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch { return undefined; }
}

function formatTimestamp(value: number | string | undefined): string {
  if (value === undefined) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatDuration(value: number): string {
  return value >= 60 * 60 * 1_000 ? `${Math.round(value / (60 * 60 * 1_000))} h` : `${Math.round(value / 60_000)} min`;
}

function formatLatency(value: number | null): string {
  if (value === null) return '—';
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function formatRatio(ratio: BusinessResearchEvaluationMetrics['taskCompletion'], t: (key: string, options?: Record<string, unknown>) => string): string {
  if (ratio.rate === null) return `${ratio.numerator}/${ratio.denominator} · ${t('research.businessResearch.evaluation.notApplicable')}`;
  return `${ratio.numerator}/${ratio.denominator} · ${(ratio.rate * 100).toFixed(1)}%`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/gu, ' ');
}

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim().length > 0 ? caught.message : fallback;
}
