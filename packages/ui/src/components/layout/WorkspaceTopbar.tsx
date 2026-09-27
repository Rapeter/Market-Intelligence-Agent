import React from 'react';
import { Building2, Settings2 } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { navSectionAtom } from '../../atoms';
import { selectedBusinessResearchProjectAtom } from '../../atoms/businessResearchAtoms';

export const WorkspaceTopbar: React.FC = () => {
  const { t } = useTranslation();
  const navSection = useAtomValue(navSectionAtom);
  const project = useAtomValue(selectedBusinessResearchProjectAtom);
  const isSettings = navSection === 'settings';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5" data-testid="workspace-topbar">
      <div className="flex min-w-0 items-center gap-2.5">
        {isSettings ? <Settings2 className="h-4 w-4 text-foreground/45" /> : <Building2 className="h-4 w-4 text-foreground/45" />}
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {isSettings ? t('navigation.settings') : project?.title ?? t('research.projects.title')}
          </div>
          {!isSettings && project && <div className="truncate text-[9px] text-foreground/45">{project.industry}</div>}
        </div>
      </div>
      <div className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-foreground/40">{t('navigation.agentPanel')}</div>
    </header>
  );
};
