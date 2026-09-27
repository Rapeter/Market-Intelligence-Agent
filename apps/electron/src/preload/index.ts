import { contextBridge, ipcRenderer } from 'electron';
import { createBusinessResearchBridge, type BusinessResearchBridgeApi } from './businessResearchBridge.ts';
import {
  createBusinessResearchLiveE2eBridge,
  type BusinessResearchLiveE2eBridgeApi,
} from './businessResearchLiveE2eBridge.ts';
import { isBusinessResearchLiveE2eEnabled } from '../businessResearchLiveE2eMode.ts';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  businessResearch: BusinessResearchBridgeApi;
  businessResearchLiveE2e?: BusinessResearchLiveE2eBridgeApi;
  llm: {
    getState: () => Promise<unknown>;
    listModels: () => Promise<unknown>;
    setModel: (input: { provider: string; modelId: string }) => Promise<unknown>;
    listThinkingLevels: () => Promise<unknown>;
    setThinkingLevel: (input: { level: string }) => Promise<unknown>;
    getProviders: () => Promise<unknown>;
    listCredentials: () => Promise<unknown>;
    setCredential: (input: { provider: string; apiKey: string }) => Promise<unknown>;
    removeCredential: (input: { provider: string }) => Promise<unknown>;
    setCustomProvider: (input: unknown) => Promise<unknown>;
    removeCustomProvider: (input: { name: string }) => Promise<unknown>;
    testProvider: (input: { provider: string; modelId: string }) => Promise<unknown>;
  };
  about: { get: () => Promise<unknown> };
  diagnostics: {
    collect: () => Promise<unknown>;
    export: () => Promise<unknown>;
    restartRuntime: () => Promise<unknown>;
  };
  appPreferences: {
    get: () => Promise<unknown>;
    update: (input: { locale: unknown }) => Promise<unknown>;
  };
  openExternal: (url: string) => Promise<unknown>;
}

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const electronAPI: ElectronAPI = {
  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
  },
  businessResearch: createBusinessResearchBridge(invoke),
  businessResearchLiveE2e: createBusinessResearchLiveE2eBridge(
    (channel, input) => invoke(channel, input),
    isBusinessResearchLiveE2eEnabled({
      isPackaged: process.env.FINAGENT_PACKAGED === '1',
      e2e: process.env.FINAGENT_E2E,
      liveE2e: process.env.FINAGENT_LIVE_E2E,
    }),
  ),
  llm: {
    getState: () => invoke('llm:getState'),
    listModels: () => invoke('llm:listModels'),
    setModel: (input) => invoke('llm:setModel', input),
    listThinkingLevels: () => invoke('llm:listThinkingLevels'),
    setThinkingLevel: (input) => invoke('llm:setThinkingLevel', input),
    getProviders: () => invoke('llm:getProviders'),
    listCredentials: () => invoke('llm:listCredentials'),
    setCredential: (input) => invoke('llm:setCredential', input),
    removeCredential: (input) => invoke('llm:removeCredential', input),
    setCustomProvider: (input) => invoke('llm:setCustomProvider', input),
    removeCustomProvider: (input) => invoke('llm:removeCustomProvider', input),
    testProvider: (input) => invoke('llm:testProvider', input),
  },
  about: { get: () => invoke('app:about') },
  diagnostics: {
    collect: () => invoke('diagnostics:collect'),
    export: () => invoke('diagnostics:export'),
    restartRuntime: () => invoke('runtime:restart'),
  },
  appPreferences: {
    get: () => invoke('appPreferences:get'),
    update: (input) => invoke('appPreferences:update', input),
  },
  openExternal: (url) => invoke('openExternal', url),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
