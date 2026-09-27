import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import { Building2, CirclePlus, Settings2 } from 'lucide-react';
import { navSectionAtom } from '../../atoms';
import {
  businessResearchProjectsAtom,
  selectedBusinessResearchProjectIdAtom,
} from '../../atoms/businessResearchAtoms';
import { useFinagentClient } from '../../client';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [projects, setProjects] = useAtom(businessResearchProjectsAtom);
  const [selectedProjectId, setSelectedProjectId] = useAtom(selectedBusinessResearchProjectIdAtom);
  const [navSection, setNavSection] = useAtom(navSectionAtom);
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = client.businessResearch;
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createProject({
        title,
        industry,
        competitors: competitors.split(/[\n,，]/u).map((item) => item.trim()).filter(Boolean),
      });
      if (!result.ok) throw new Error(result.error.message);
      setProjects((current) => [result.data, ...current.filter((project) => project.id !== result.data.id)]);
      setSelectedProjectId(result.data.id);
      setNavSection('projects');
      setTitle('');
      setIndustry('');
      setCompetitors('');
      setIsCreating(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('research.projects.createError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="research-sidebar flex h-full w-full flex-col overflow-hidden bg-surface px-3 py-5" data-testid="sidebar">
      <div className="mb-6 px-2">
        <div className="text-[17px] font-semibold tracking-[-0.035em] text-foreground">Enterprise Research</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-foreground/45">Decision workspace</div>
      </div>

      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">{t('research.projects.title')}</span>
        <button
          type="button"
          aria-label={t('research.projects.create')}
          title={t('research.projects.create')}
          onClick={() => { setIsCreating((current) => !current); setError(null); }}
          className="flex h-7 w-7 items-center justify-center rounded-[4px] text-foreground/55 hover:bg-surface-muted hover:text-foreground"
        >
          <CirclePlus className="h-4 w-4" />
        </button>
      </div>

      {isCreating && (
        <form onSubmit={(event) => void createProject(event)} className="mb-3 space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <label className="block text-[10px] font-medium text-foreground/65">
            {t('research.projects.name')}
            <input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.currentTarget.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" />
          </label>
          <label className="block text-[10px] font-medium text-foreground/65">
            {t('research.projects.industry')}
            <input required maxLength={120} value={industry} onChange={(event) => setIndustry(event.currentTarget.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" />
          </label>
          <label className="block text-[10px] font-medium text-foreground/65">
            {t('research.projects.competitors')}
            <textarea required rows={2} value={competitors} onChange={(event) => setCompetitors(event.currentTarget.value)} className="mt-1 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" />
          </label>
          <p className="text-[9px] leading-4 text-foreground/45">{t('research.projects.competitorsHint')}</p>
          {error && <p role="alert" className="text-[10px] text-negative">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded bg-foreground px-2 py-1.5 text-[10px] font-semibold text-background disabled:opacity-50">
            {busy ? t('research.projects.creating') : t('research.projects.createAction')}
          </button>
        </form>
      )}

      <nav aria-label={t('research.projects.title')} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {projects.map((project) => {
          const active = project.id === selectedProjectId;
          return (
            <button
              key={project.id}
              type="button"
              aria-pressed={active}
              onClick={() => { setSelectedProjectId(project.id); setNavSection('projects'); }}
              className={`flex w-full items-start gap-2 rounded-[4px] px-2.5 py-2 text-left ${active ? 'bg-surface-muted text-foreground' : 'text-foreground/65 hover:bg-surface-muted'}`}
            >
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={active ? 2 : 1.7} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">{project.title}</span>
                <span className="mt-0.5 block truncate text-[9px] text-foreground/42">{project.industry}</span>
              </span>
            </button>
          );
        })}
        {projects.length === 0 && !isCreating && (
          <button type="button" onClick={() => setIsCreating(true)} className="px-2 py-2 text-left text-[10px] leading-4 text-foreground/45 hover:text-foreground/70">
            {t('research.projects.empty')}
          </button>
        )}
      </nav>

      <div className="mt-3 border-t border-border pt-3">
        <button type="button" onClick={() => setNavSection('settings')} aria-pressed={navSection === 'settings'} className={`flex h-9 w-full items-center gap-2 rounded-[4px] px-3 text-[11px] ${navSection === 'settings' ? 'bg-surface-muted text-foreground' : 'text-foreground/55 hover:bg-surface-muted hover:text-foreground'}`}>
          <Settings2 className="h-4 w-4" />{t('navigation.settings')}
        </button>
      </div>
    </aside>
  );
};
