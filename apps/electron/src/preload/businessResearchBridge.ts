export interface BusinessResearchBridgeApi {
  getCredentialStatus: () => Promise<unknown>;
  setBraveKey: (input: { apiKey: string }) => Promise<unknown>;
  removeBraveKey: () => Promise<unknown>;
  start: (input: { task: unknown }) => Promise<unknown>;
  cancel: (input: { runId: string }) => Promise<unknown>;
  listRuns: () => Promise<unknown>;
  getRun: (input: { runId: string }) => Promise<unknown>;
  listEvents: (input: { runId: string }) => Promise<unknown>;
  listReports: () => Promise<unknown>;
  getReport: (input: { reportId: string }) => Promise<unknown>;
  evaluate: () => Promise<unknown>;
  subscribe: (input: { task: unknown; intervalMs?: number }) => Promise<unknown>;
  unsubscribe: (input: { subscriptionId: string }) => Promise<unknown>;
  listSubscriptions: () => Promise<unknown>;
  listChecks: (input: { subscriptionId: string }) => Promise<unknown>;
  checkDue: () => Promise<unknown>;
}

export type BusinessResearchIpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** Fixed, typed IPC surface; renderer code cannot choose arbitrary channels. */
export function createBusinessResearchBridge(invoke: BusinessResearchIpcInvoke): BusinessResearchBridgeApi {
  return {
    getCredentialStatus: () => invoke('businessResearch:getCredentialStatus'),
    setBraveKey: (input) => invoke('businessResearch:setBraveKey', input),
    removeBraveKey: () => invoke('businessResearch:removeBraveKey'),
    start: (input) => invoke('businessResearch:start', input),
    cancel: (input) => invoke('businessResearch:cancel', input),
    listRuns: () => invoke('businessResearch:listRuns'),
    getRun: (input) => invoke('businessResearch:getRun', input),
    listEvents: (input) => invoke('businessResearch:listEvents', input),
    listReports: () => invoke('businessResearch:listReports'),
    getReport: (input) => invoke('businessResearch:getReport', input),
    evaluate: () => invoke('businessResearch:evaluate'),
    subscribe: (input) => invoke('businessResearch:subscribe', input),
    unsubscribe: (input) => invoke('businessResearch:unsubscribe', input),
    listSubscriptions: () => invoke('businessResearch:listSubscriptions'),
    listChecks: (input) => invoke('businessResearch:listChecks', input),
    checkDue: () => invoke('businessResearch:checkDue'),
  };
}
