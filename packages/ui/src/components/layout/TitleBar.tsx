import React, { useEffect, useState } from 'react';
import { Building2, Copy, Info, Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../primitives/Dialog';
import { AboutView } from '../about/AboutView';
import { useFinagentClient } from '../../client';

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const windowControls = useFinagentClient().window;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    if (windowControls) {
      void windowControls.isMaximized().then((value) => { if (active) setMaximized(value); });
    }
    return () => { active = false; };
  }, [windowControls]);

  const toggleMaximize = async () => {
    await windowControls?.maximize();
    setMaximized(await windowControls?.isMaximized() ?? false);
  };

  return (
    <header className="app-titlebar z-titlebar flex items-center justify-between">
      <div data-app-drag-region className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-4">
        <span className="flex h-[19px] w-[19px] items-center justify-center rounded-[5px] bg-accent text-accent-foreground" aria-hidden="true">
          <Building2 className="h-3 w-3" strokeWidth={2.2} />
        </span>
        <span className="truncate text-[12px] font-semibold text-foreground/78">Enterprise Research Workbench</span>
      </div>

      <div className="app-window-controls flex h-full shrink-0 items-stretch">
        <button type="button" aria-label={t('navigation.minimizeWindow')} disabled={!windowControls}
          onClick={() => void windowControls?.minimize()} className="app-window-control" title={t('navigation.minimizeWindow')}>
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label={maximized ? t('navigation.restoreWindow') : t('navigation.maximizeWindow')} disabled={!windowControls}
          onClick={() => void toggleMaximize()} className="app-window-control" title={maximized ? t('navigation.restoreWindow') : t('navigation.maximizeWindow')}>
          {maximized ? <Copy className="h-3 w-3" aria-hidden="true" /> : <Square className="h-3 w-3" aria-hidden="true" />}
        </button>
        <button type="button" aria-label={t('navigation.closeWindow')} disabled={!windowControls}
          onClick={() => void windowControls?.close()} className="app-window-control app-window-control-close" title={t('navigation.closeWindow')}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <div className="app-window-control-divider" aria-hidden="true" />
        <button type="button" onClick={() => setAboutOpen(true)} aria-label={t('navigation.aboutAria')}
          className="app-window-control app-window-control-about" title={t('navigation.aboutAria')}>
          <Info className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title={t('navigation.aboutTitle')}>
        <AboutView />
      </Dialog>
    </header>
  );
};
