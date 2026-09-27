import React from 'react';
import { TitleBar } from './TitleBar';
import { WorkbenchShell } from './WorkbenchShell';
import { ThemeProvider } from './ThemeProvider';
import { TooltipProvider } from '../ui/tooltip';
import { Toaster } from 'sonner';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import { I18nProvider } from '../../i18n/I18nProvider';

interface AppShellProps {
  client?: FinagentClient;
}

export const AppShell: React.FC<AppShellProps> = ({ client = fallbackClient }) => {
  return (
    <FinagentClientProvider client={client}>
      <I18nProvider>
        <ThemeProvider>
          <TooltipProvider delayDuration={450} skipDelayDuration={100}>
            <div className="app-window flex h-screen flex-col overflow-hidden bg-background text-foreground">
              <TitleBar />
              <WorkbenchShell />
            </div>
            <Toaster closeButton richColors={false} />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </FinagentClientProvider>
  );
};
