import type { ApiResult, CustomProviderConfig } from '@finagent/core';
import { fallbackClient, type FinagentClient } from '@finagent/ui';

function ipcResult<T>(promise: Promise<unknown>): Promise<ApiResult<T>> {
  return promise as Promise<ApiResult<T>>;
}

function createElectronClient(): FinagentClient {
  if (!window.electronAPI) return fallbackClient;

  return {
    ...fallbackClient,
    window: {
      minimize: () => window.electronAPI.window.minimize(),
      maximize: () => window.electronAPI.window.maximize(),
      close: () => window.electronAPI.window.close(),
      isMaximized: () => window.electronAPI.window.isMaximized(),
    },
    businessResearch: {
      createProject: (input) => ipcResult(window.electronAPI.businessResearch.createProject(input)),
      listProjects: () => ipcResult(window.electronAPI.businessResearch.listProjects()),
      getCredentialStatus: () => ipcResult(window.electronAPI.businessResearch.getCredentialStatus()),
      setBraveKey: (apiKey) => ipcResult(window.electronAPI.businessResearch.setBraveKey({ apiKey })),
      removeBraveKey: () => ipcResult(window.electronAPI.businessResearch.removeBraveKey()),
      start: (task, mode, projectId, parentRunId) => ipcResult(window.electronAPI.businessResearch.start({ task, mode, projectId, parentRunId })),
      cancel: (runId) => ipcResult(window.electronAPI.businessResearch.cancel({ runId })),
      listRuns: () => ipcResult(window.electronAPI.businessResearch.listRuns()),
      getRun: (runId) => ipcResult(window.electronAPI.businessResearch.getRun({ runId })),
      listEvents: (runId) => ipcResult(window.electronAPI.businessResearch.listEvents({ runId })),
      listReports: () => ipcResult(window.electronAPI.businessResearch.listReports()),
      getReport: (reportId) => ipcResult(window.electronAPI.businessResearch.getReport({ reportId })),
      evaluate: () => ipcResult(window.electronAPI.businessResearch.evaluate()),
      subscribe: (task, intervalMs, projectId) => ipcResult(window.electronAPI.businessResearch.subscribe({ task, intervalMs, projectId })),
      unsubscribe: (subscriptionId) => ipcResult(window.electronAPI.businessResearch.unsubscribe({ subscriptionId })),
      resumeSubscription: (subscriptionId) => ipcResult(window.electronAPI.businessResearch.resumeSubscription({ subscriptionId })),
      removeSubscription: (subscriptionId) => ipcResult(window.electronAPI.businessResearch.removeSubscription({ subscriptionId })),
      listSubscriptions: () => ipcResult(window.electronAPI.businessResearch.listSubscriptions()),
      listChecks: (subscriptionId) => ipcResult(window.electronAPI.businessResearch.listChecks({ subscriptionId })),
      checkDue: () => ipcResult(window.electronAPI.businessResearch.checkDue()),
    },
    llm: {
      getState: () => ipcResult(window.electronAPI.llm.getState()),
      listModels: () => ipcResult(window.electronAPI.llm.listModels()),
      setModel: (provider, modelId) => ipcResult(window.electronAPI.llm.setModel({ provider, modelId })),
      listThinkingLevels: () => ipcResult(window.electronAPI.llm.listThinkingLevels()),
      setThinkingLevel: (level) => ipcResult(window.electronAPI.llm.setThinkingLevel({ level })),
      getProviders: () => ipcResult(window.electronAPI.llm.getProviders()),
      listCredentials: () => ipcResult(window.electronAPI.llm.listCredentials()),
      setCredential: (provider, apiKey) => ipcResult(window.electronAPI.llm.setCredential({ provider, apiKey })),
      removeCredential: (provider) => ipcResult(window.electronAPI.llm.removeCredential({ provider })),
      setCustomProvider: (config: CustomProviderConfig) => ipcResult(window.electronAPI.llm.setCustomProvider(config)),
      removeCustomProvider: (name) => ipcResult(window.electronAPI.llm.removeCustomProvider({ name })),
      testProvider: (provider, modelId) => ipcResult(window.electronAPI.llm.testProvider({ provider, modelId })),
    },
    about: { get: () => ipcResult(window.electronAPI.about.get()) },
    diagnostics: {
      collect: () => ipcResult(window.electronAPI.diagnostics.collect()),
      export: () => ipcResult(window.electronAPI.diagnostics.export()),
      restartRuntime: () => ipcResult(window.electronAPI.diagnostics.restartRuntime()),
    },
    openExternal: (url) => ipcResult(window.electronAPI.openExternal(url)),
    prefs: {
      get: () => ipcResult(window.electronAPI.appPreferences.get()),
      update: (locale) => ipcResult(window.electronAPI.appPreferences.update({ locale })),
    },
  };
}

export const finagentClient: FinagentClient = createElectronClient();
