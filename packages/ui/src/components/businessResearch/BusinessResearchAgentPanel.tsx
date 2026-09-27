import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, LoaderCircle, Send, Sparkles } from 'lucide-react';
import { BUSINESS_RESEARCH_STRATEGY_KEYS, normalizeBusinessResearchInput, type BusinessResearchStrategyId } from '@finagent/core';
import {
  businessResearchFormAtom,
  businessResearchModeAtom,
  businessResearchProjectsAtom,
  businessResearchRunsAtom,
  selectedBusinessResearchProjectIdAtom,
  selectedBusinessResearchRunIdAtom,
  selectedBusinessResearchReportIdAtom,
} from '../../atoms/businessResearchAtoms';
import { useFinagentClient } from '../../client';

const STRATEGIES: readonly BusinessResearchStrategyId[] = BUSINESS_RESEARCH_STRATEGY_KEYS;

export const BusinessResearchAgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const api = useFinagentClient().businessResearch;
  const projects = useAtomValue(businessResearchProjectsAtom);
  const projectId = useAtomValue(selectedBusinessResearchProjectIdAtom);
  const project = projects.find((item) => item.id === projectId);
  const runs = useAtomValue(businessResearchRunsAtom);
  const selectedRunId = useAtomValue(selectedBusinessResearchRunIdAtom);
  const projectRuns = useMemo(() => runs
    .filter((run) => run.projectId === project?.id)
    .sort((left, right) => right.createdAt - left.createdAt), [project?.id, runs]);
  const selectedRun = projectRuns.find((run) => run.id === selectedRunId) ?? projectRuns[0];
  const form = useAtomValue(businessResearchFormAtom);
  const setForm = useSetAtom(businessResearchFormAtom);
  const mode = useAtomValue(businessResearchModeAtom);
  const setMode = useSetAtom(businessResearchModeAtom);
  const setRuns = useSetAtom(businessResearchRunsAtom);
  const setSelectedRunId = useSetAtom(selectedBusinessResearchRunIdAtom);
  const setSelectedReportId = useSetAtom(selectedBusinessResearchReportIdAtom);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = project ? normalizeBusinessResearchInput({
    industry: project.industry,
    question,
    competitors: project.competitors,
    strategyId: form.strategyId,
  }) : undefined;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!api || !project || !normalized?.ok) {
      setError(t('research.businessResearch.form.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.start(normalized.value, mode, project.id, selectedRun?.id);
      if (!result.ok) throw new Error(result.error.message);
      const run = result.data;
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setSelectedReportId(run.reportId ?? null);
      setQuestion('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('research.businessResearch.errors.start'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-surface" data-testid="business-research-agent-panel">
      <header className="shrink-0 border-b border-border px-4 py-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('research.projects.agent.title')}
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-foreground/48">{t('research.projects.agent.description')}</p>
        {project && <div className="mt-3 rounded-md bg-surface-muted px-2.5 py-2">
          <div className="truncate text-[10px] font-medium text-foreground/75">{project.title}</div>
          <div className="mt-0.5 truncate text-[9px] text-foreground/45">{project.industry} · {project.competitors.join(', ')}</div>
        </div>}
      </header>

      {!project ? <div className="flex flex-1 items-center justify-center p-5 text-center text-[11px] leading-5 text-foreground/45">{t('research.projects.agent.noProject')}</div> : <>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label={t('research.projects.agent.history')}>
          {projectRuns.length === 0 ? <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[10px] leading-4 text-foreground/40">{t('research.projects.agent.empty')}</div> : (
            <ol className="space-y-2">
              {projectRuns.map((run) => {
                const active = selectedRun?.id === run.id;
                return <li key={run.id}>
                  <button type="button" aria-pressed={active} onClick={() => { setSelectedRunId(run.id); setSelectedReportId(run.reportId ?? null); }}
                    className={`group w-full rounded-md border px-2.5 py-2 text-left transition ${active ? 'border-accent/30 bg-accent/5' : 'border-transparent hover:border-border hover:bg-surface-muted'}`}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="line-clamp-3 text-[10px] leading-4 text-foreground/78">{run.task.question}</span>
                      <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-foreground/30 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-[8px] uppercase tracking-wide text-foreground/40">
                      <span>{t(`research.businessResearch.state.${run.state.status}`)}</span>
                      <span aria-hidden="true">·</span>
                      <time>{new Date(run.createdAt).toLocaleString()}</time>
                      {run.parentRunId && <span className="ml-auto rounded bg-surface-muted px-1.5 py-0.5 normal-case">{t('research.projects.agent.followUp')}</span>}
                    </span>
                  </button>
                </li>;
              })}
            </ol>
          )}
        </div>

        <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-border p-3">
          <label className="sr-only" htmlFor="business-research-agent-question">{t('research.projects.agent.placeholder')}</label>
          <textarea id="business-research-agent-question" data-testid="business-research-agent-input" rows={4} value={question}
            onChange={(event) => setQuestion(event.currentTarget.value)} maxLength={4_000}
            placeholder={t('research.projects.agent.placeholder')}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-5 text-foreground placeholder:text-foreground/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15" />
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="sr-only" htmlFor="business-research-agent-strategy">{t('research.businessResearch.form.strategy')}</label>
            <select id="business-research-agent-strategy" value={form.strategyId} onChange={(event) => setForm((current) => ({ ...current, strategyId: event.currentTarget.value as BusinessResearchStrategyId }))}
              className="min-w-0 rounded border border-border bg-background px-2 py-1.5 text-[9px] text-foreground/65">
              {STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{t(`research.businessResearch.strategy.${strategy}`)}</option>)}
            </select>
            <select aria-label={t('research.businessResearch.form.mode')} value={mode} onChange={(event) => setMode(event.currentTarget.value as 'fixture' | 'live')}
              className="rounded border border-border bg-background px-2 py-1.5 text-[9px] text-foreground/65">
              <option value="fixture">{t('research.businessResearch.mode.fixture')}</option>
              <option value="live">{t('research.businessResearch.mode.live')}</option>
            </select>
          </div>
          {error && <p role="alert" className="mt-2 text-[10px] leading-4 text-negative">{error}</p>}
          <button type="submit" data-testid="business-research-agent-submit" disabled={busy || question.trim().length === 0}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 text-[10px] font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
            {busy ? t('research.projects.agent.sending') : selectedRun ? t('research.projects.agent.followUp') : t('research.projects.agent.send')}
          </button>
        </form>
      </>}
    </aside>
  );
};
