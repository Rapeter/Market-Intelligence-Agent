import { createStore } from 'jotai';
import { describe, expect, it } from 'bun:test';
import { agentPanelVisibleAtom, navSectionAtom, settingsTabAtom } from './workspaceAtoms';

describe('enterprise workspace atoms', () => {
  it('opens on projects with the Agent panel visible', () => {
    const store = createStore();
    expect(store.get(navSectionAtom)).toBe('projects');
    expect(store.get(agentPanelVisibleAtom)).toBe(true);
  });

  it('limits navigation to projects and settings', () => {
    const store = createStore();
    store.set(navSectionAtom, 'settings');
    store.set(settingsTabAtom, 'llm');
    expect(store.get(navSectionAtom)).toBe('settings');
    expect(store.get(settingsTabAtom)).toBe('llm');
    store.set(navSectionAtom, 'projects');
    expect(store.get(navSectionAtom)).toBe('projects');
  });

  it('allows the right Agent panel to be collapsed', () => {
    const store = createStore();
    store.set(agentPanelVisibleAtom, false);
    expect(store.get(agentPanelVisibleAtom)).toBe(false);
  });
});
