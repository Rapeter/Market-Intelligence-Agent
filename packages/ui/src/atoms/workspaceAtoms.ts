import { atom } from 'jotai';
import { persistedAtom } from '../lib/persistedPrefs';

/** The only top-level destinations in the enterprise research workbench. */
export type NavSection = 'projects' | 'settings';
export const navSectionAtom = persistedAtom<NavSection>('navSection', 'projects');

/** The right-hand project Agent can be collapsed without changing project state. */
export const agentPanelVisibleAtom = persistedAtom<boolean>('agentPanelVisible', true);

export type SettingsTab = 'general' | 'llm' | 'diagnostics';
export const settingsTabAtom = atom<SettingsTab>('general');
