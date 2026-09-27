import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFinagentClient } from '../../client';
import {
  collectDiagnosticsSnapshot,
  exportDiagnosticsBundle,
  type DiagnosticsBundle,
  type DiagnosticsErrorEntry,
} from '../../client/diagnostics';
import { Button } from '../primitives/Button';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5">
    <span className="text-[12px] text-foreground/52">{label}</span>
    <span className="text-right font-mono text-[12px] text-foreground">{value}</span>
  </div>
);

function fmtTime(at: number): string {
  return new Date(at).toISOString();
}

export const DiagnosticsTab: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restarting, setRestarting] = useState(false);


  const refresh = useCallback(async () => {
    setError(null);
    const snapshot = await collectDiagnosticsSnapshot(client);
    if (snapshot) {
      setBundle(snapshot);
    } else {
      setBundle(null);
      setError(t('diagnostics.notAvailable'));
    }
  }, [client, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportDiagnosticsBundle(client);
    } finally {
      setExporting(false);
    }
  }, [client]);

  const onRestartRuntime = useCallback(async () => {
    setRestarting(true);
    try {
      await client.diagnostics?.restartRuntime?.();
      await refresh();
    } finally {
      setRestarting(false);
    }
  }, [client, refresh]);

  const onCopySummary = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(buildSummary(bundle, t));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [bundle]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-foreground/72">
          {t('diagnostics.subtitle')}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            {t('diagnostics.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onCopySummary()}>
            {copied ? t('diagnostics.copied') : t('diagnostics.copySummary')}
          </Button>
          <Button variant="default" size="sm" disabled={exporting} onClick={() => void onExport()}>
            {exporting ? t('diagnostics.exporting') : t('diagnostics.exportDiagnostics')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
          {error}
        </div>
      )}

      {bundle && (
        <>
          <Section title={t('diagnostics.sectionApplication')}>
            <Row label={t('diagnostics.version')} value={bundle.app.version} />
            <Row label={t('diagnostics.platform')} value={`${bundle.app.platform.os} / ${bundle.app.platform.arch}`} />
            <Row label={t('diagnostics.electron')} value={bundle.app.platform.electron ?? '—'} />
            <Row label={t('diagnostics.collected')} value={fmtTime(new Date(bundle.collectedAt).getTime())} />
          </Section>

          <Section title={t('diagnostics.sectionAgentRuntime')}>
            <Row label={t('diagnostics.provider')} value={bundle.runtime.agent.providerId ?? '—'} />
            <Row label={t('diagnostics.state')} value={bundle.runtime.agent.state ?? '—'} />
          </Section>

          <Section title={t('diagnostics.sectionProviders')}>
            <Row label={t('diagnostics.llmProvider')} value={bundle.providers.llm.id ?? '—'} />
            <Row label={t('diagnostics.llmModel')} value={bundle.providers.llm.model ?? '—'} />
          </Section>

          <Section title={t('diagnostics.sectionResearchCapabilities')}>
            <Row label={t('diagnostics.capabilitiesAvailable')} value={String(bundle.capabilities.available.length)} />
            <div className="flex flex-wrap gap-1 pt-1">
              {bundle.capabilities.available.map((id) => (
                <span
                  key={id}
                  className="rounded-[6px] bg-surface-hover px-2 py-0.5 font-mono text-[11px] text-foreground/72"
                >
                  {id}
                </span>
              ))}
            </div>
          </Section>

          <Section title={t('diagnostics.sectionResources')}>
            <Row label={t('diagnostics.mode')} value={bundle.resources.dev ? t('diagnostics.development') : t('diagnostics.packaged')} />
            <Row label={t('diagnostics.runtimeRoot')} value={bundle.resources.root} />
          </Section>

          <Section title={t('diagnostics.sectionPiRuntime')}>
            <Row label={t('diagnostics.piStatus')} value={bundle.pi.status ?? '—'} />
            <Row label={t('diagnostics.piCommand')} value={bundle.pi.command ?? '—'} />
            <Row label={t('diagnostics.piProvider')} value={bundle.pi.providersConfigured.join(', ') || '—'} />
            <Row label={t('diagnostics.piModel')} value={bundle.pi.model ?? '—'} />
            <Row label={t('diagnostics.piExtensions')} value={bundle.pi.extensions.join(', ') || '—'} />
            <Row label={t('diagnostics.piLastExit')} value={`${bundle.pi.lastExitCode ?? '—'} ${bundle.pi.lastExitSignal ?? ''}`.trim()} />
            {bundle.pi.stderrTail && (
              <pre className="mt-1 max-h-28 overflow-auto rounded-[8px] bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/60">
                {bundle.pi.stderrTail}
              </pre>
            )}
            <div className="pt-1">
              <Button variant="outline" size="sm" onClick={() => void onRestartRuntime()} disabled={restarting}>
                {restarting ? t('diagnostics.restarting') : t('diagnostics.restartRuntime')}
              </Button>
            </div>
          </Section>

          <Section title={t('diagnostics.sectionLastErrors')}>
            {bundle.errors.length === 0 ? (
              <div className="text-[12px] text-foreground/44">{t('diagnostics.noRecentErrors')}</div>
            ) : (
              <ul className="space-y-2">
                {bundle.errors.map((entry) => (
                  <ErrorRow key={`${entry.at}-${entry.message}`} entry={entry} t={t} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

const ErrorRow: React.FC<{ entry: DiagnosticsErrorEntry; t: (key: string) => string }> = ({
  entry,
  t,
}) => (
  <li className="rounded-[10px] border border-border p-3">
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-[12px] text-foreground">{entry.source ?? t('diagnostics.unknown')}</span>
      <span className="font-mono text-[11px] text-foreground/44">{fmtTime(entry.at)}</span>
    </div>
    <div className="mt-1 text-[12px] text-foreground/78">{entry.message}</div>
    {entry.stack && (
      <pre className="mt-2 max-h-32 overflow-auto rounded-[6px] bg-surface-hover p-2 font-mono text-[10px] text-foreground/60">
        {entry.stack}
      </pre>
    )}
  </li>
);

/** Human-readable one-line-ish summary used by the copy button. */
function buildSummary(bundle: DiagnosticsBundle, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const lines = [
    t('diagnostics.summaryApplication', {
      version: bundle.app.version,
      os: bundle.app.platform.os,
      arch: bundle.app.platform.arch,
    }),
    t('diagnostics.summaryAgentRuntime', {
      provider: bundle.runtime.agent.providerId ?? '—',
      state: bundle.runtime.agent.state ?? '—',
    }),
    t('diagnostics.summaryLlm', {
      provider: bundle.providers.llm.id ?? '—',
      model: bundle.providers.llm.model ?? '—',
    }),
    t('diagnostics.summaryCapabilities', { count: bundle.capabilities.available.length }),
    t('diagnostics.summaryResources', {
      mode: bundle.resources.dev ? t('diagnostics.resourceModeDev') : t('diagnostics.resourceModePackaged'),
      root: bundle.resources.root,
    }),
    t('diagnostics.summaryRecentErrors', { count: bundle.errors.length }),
  ];
  return lines.join('\n');
}
