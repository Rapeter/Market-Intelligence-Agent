import React, { createContext, useContext } from 'react';
import type {
  ApiResult,
  AppPreferencesSnapshot,
  BusinessResearchProject,
  BusinessResearchProjectId,
  BusinessResearchReportId,
  BusinessResearchRunId,
  BusinessResearchRunMode,
  BusinessResearchSubscriptionId,
  BusinessResearchTaskInput,
  CredentialInfo,
  CustomProviderConfig,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  LocalePreference,
  ProviderStatus,
} from '@finagent/core';
import type {
  BusinessResearchCheckRecord,
  BusinessResearchEvent,
  BusinessResearchEvaluationMetrics,
  BusinessResearchReport,
  BusinessResearchRunRecord,
  BusinessResearchSubscriptionRecord,
} from '@finagent/shared/business-research';
import type { DiagnosticsBundle, DiagnosticsExportResult } from './client/diagnostics';

export interface WindowControlsClient {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface AboutInfo {
  version: string;
  channel: string;
  build: string;
}

export interface FinagentClient {
  window?: WindowControlsClient;
  businessResearch?: {
    createProject: (input: { title: string; industry: string; competitors: string[] }) => Promise<ApiResult<BusinessResearchProject>>;
    listProjects: () => Promise<ApiResult<BusinessResearchProject[]>>;
    getCredentialStatus: () => Promise<ApiResult<{ configured: boolean; updatedAt?: number }>>;
    setBraveKey: (apiKey: string) => Promise<ApiResult<{ configured: boolean; updatedAt?: number }>>;
    removeBraveKey: () => Promise<ApiResult<{ configured: boolean; updatedAt?: number }>>;
    start: (task: BusinessResearchTaskInput, mode?: BusinessResearchRunMode, projectId?: BusinessResearchProjectId, parentRunId?: BusinessResearchRunId) => Promise<ApiResult<BusinessResearchRunRecord>>;
    cancel: (runId: BusinessResearchRunId) => Promise<ApiResult<boolean>>;
    listRuns: () => Promise<ApiResult<BusinessResearchRunRecord[]>>;
    getRun: (runId: BusinessResearchRunId) => Promise<ApiResult<BusinessResearchRunRecord | undefined>>;
    listEvents: (runId: BusinessResearchRunId) => Promise<ApiResult<BusinessResearchEvent[]>>;
    listReports: () => Promise<ApiResult<BusinessResearchReport[]>>;
    getReport: (reportId: BusinessResearchReportId) => Promise<ApiResult<BusinessResearchReport | undefined>>;
    evaluate: () => Promise<ApiResult<BusinessResearchEvaluationMetrics>>;
    subscribe: (task: BusinessResearchTaskInput, intervalMs?: number, projectId?: BusinessResearchProjectId) => Promise<ApiResult<BusinessResearchSubscriptionRecord>>;
    unsubscribe: (subscriptionId: BusinessResearchSubscriptionId) => Promise<ApiResult<BusinessResearchSubscriptionRecord | undefined>>;
    resumeSubscription: (subscriptionId: BusinessResearchSubscriptionId) => Promise<ApiResult<BusinessResearchSubscriptionRecord | undefined>>;
    removeSubscription: (subscriptionId: BusinessResearchSubscriptionId) => Promise<ApiResult<BusinessResearchSubscriptionRecord | undefined>>;
    listSubscriptions: () => Promise<ApiResult<BusinessResearchSubscriptionRecord[]>>;
    listChecks: (subscriptionId: BusinessResearchSubscriptionId) => Promise<ApiResult<BusinessResearchCheckRecord[]>>;
    checkDue: () => Promise<ApiResult<BusinessResearchCheckRecord[]>>;
  };
  llm: {
    getState: () => Promise<ApiResult<LlmRuntimeState>>;
    listModels: () => Promise<ApiResult<LlmModel[]>>;
    setModel: (provider: string, modelId: string) => Promise<ApiResult<LlmRuntimeState>>;
    listThinkingLevels: () => Promise<ApiResult<string[]>>;
    setThinkingLevel: (level: string) => Promise<ApiResult<LlmRuntimeState>>;
    getProviders: () => Promise<ApiResult<ProviderStatus[]>>;
    listCredentials: () => Promise<ApiResult<CredentialInfo[]>>;
    setCredential: (provider: string, apiKey: string) => Promise<ApiResult<void>>;
    removeCredential: (provider: string) => Promise<ApiResult<void>>;
    setCustomProvider: (config: CustomProviderConfig) => Promise<ApiResult<void>>;
    removeCustomProvider: (name: string) => Promise<ApiResult<void>>;
    testProvider: (provider: string, modelId: string) => Promise<ApiResult<LlmTestResult>>;
  };
  about?: { get: () => Promise<ApiResult<AboutInfo>> };
  diagnostics?: {
    collect: () => Promise<ApiResult<DiagnosticsBundle>>;
    export: () => Promise<ApiResult<DiagnosticsExportResult>>;
    restartRuntime: () => Promise<ApiResult<void>>;
  };
  prefs?: {
    get: () => Promise<ApiResult<AppPreferencesSnapshot>>;
    update: (locale: LocalePreference) => Promise<ApiResult<AppPreferencesSnapshot>>;
  };
  openExternal?: (url: string) => Promise<ApiResult<void>>;
}

const missingClient = (operation: string) => async () => ({
  ok: false as const,
  error: { code: 'CLIENT_UNAVAILABLE', message: `${operation} is unavailable in this environment.` },
});

export const fallbackClient: FinagentClient = {
  window: {
    minimize: async () => undefined,
    maximize: async () => undefined,
    close: async () => undefined,
    isMaximized: async () => false,
  },
  businessResearch: {
    createProject: missingClient('businessResearch.createProject'),
    listProjects: missingClient('businessResearch.listProjects'),
    getCredentialStatus: missingClient('businessResearch.getCredentialStatus'),
    setBraveKey: missingClient('businessResearch.setBraveKey'),
    removeBraveKey: missingClient('businessResearch.removeBraveKey'),
    start: missingClient('businessResearch.start'),
    cancel: missingClient('businessResearch.cancel'),
    listRuns: missingClient('businessResearch.listRuns'),
    getRun: missingClient('businessResearch.getRun'),
    listEvents: missingClient('businessResearch.listEvents'),
    listReports: missingClient('businessResearch.listReports'),
    getReport: missingClient('businessResearch.getReport'),
    evaluate: missingClient('businessResearch.evaluate'),
    subscribe: missingClient('businessResearch.subscribe'),
    unsubscribe: missingClient('businessResearch.unsubscribe'),
    resumeSubscription: missingClient('businessResearch.resumeSubscription'),
    removeSubscription: missingClient('businessResearch.removeSubscription'),
    listSubscriptions: missingClient('businessResearch.listSubscriptions'),
    listChecks: missingClient('businessResearch.listChecks'),
    checkDue: missingClient('businessResearch.checkDue'),
  },
  llm: {
    getState: missingClient('llm.getState'),
    listModels: missingClient('llm.listModels'),
    setModel: missingClient('llm.setModel'),
    listThinkingLevels: missingClient('llm.listThinkingLevels'),
    setThinkingLevel: missingClient('llm.setThinkingLevel'),
    getProviders: missingClient('llm.getProviders'),
    listCredentials: missingClient('llm.listCredentials'),
    setCredential: missingClient('llm.setCredential'),
    removeCredential: missingClient('llm.removeCredential'),
    setCustomProvider: missingClient('llm.setCustomProvider'),
    removeCustomProvider: missingClient('llm.removeCustomProvider'),
    testProvider: missingClient('llm.testProvider'),
  },
  about: { get: missingClient('about.get') },
  diagnostics: {
    collect: missingClient('diagnostics.collect'),
    export: missingClient('diagnostics.export'),
    restartRuntime: missingClient('diagnostics.restartRuntime'),
  },
  prefs: {
    get: async () => ({
      ok: true,
      data: {
        preference: 'system',
        systemLocale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        effectiveLocale: 'en-US',
      },
    }),
    update: async (locale) => ({
      ok: true,
      data: {
        preference: locale,
        systemLocale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        effectiveLocale: locale === 'system' ? 'en-US' : locale,
      },
    }),
  },
  openExternal: missingClient('openExternal'),
};

const FinagentClientContext = createContext<FinagentClient>(fallbackClient);

export function FinagentClientProvider({
  client,
  children,
}: {
  client: FinagentClient;
  children: React.ReactNode;
}) {
  return <FinagentClientContext.Provider value={client}>{children}</FinagentClientContext.Provider>;
}

export function useFinagentClient(): FinagentClient {
  return useContext(FinagentClientContext);
}
