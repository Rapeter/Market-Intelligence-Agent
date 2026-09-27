import React from 'react';
import { useAtomValue } from 'jotai';
import { navSectionAtom } from '../../atoms';
import { BusinessResearchWorkspace } from '../businessResearch/BusinessResearchWorkspace';
import { SettingsView } from '../settings/SettingsView';

export const ProductWorkspace: React.FC = () => {
  const navSection = useAtomValue(navSectionAtom);
  return navSection === 'settings' ? <SettingsView /> : <BusinessResearchWorkspace />;
};
