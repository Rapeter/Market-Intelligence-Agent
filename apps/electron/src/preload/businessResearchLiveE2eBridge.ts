export interface BusinessResearchLiveE2eBridgeApi {
  runCounterfactualProbes: (input: { task: unknown }) => Promise<unknown>;
  checkSubscriptionNow: (input: { subscriptionId: string }) => Promise<unknown>;
}

export type BusinessResearchLiveE2eIpcInvoke = (channel: string, input: unknown) => Promise<unknown>;

/** Test-only fixed IPC surface; the preload omits it for normal app launches. */
export function createBusinessResearchLiveE2eBridge(
  invoke: BusinessResearchLiveE2eIpcInvoke,
  enabled: boolean,
): BusinessResearchLiveE2eBridgeApi | undefined {
  if (!enabled) return undefined;
  return {
    runCounterfactualProbes: (input) => invoke('businessResearch:e2e:counterfactualProbes', input),
    checkSubscriptionNow: (input) => invoke('businessResearch:e2e:checkSubscriptionNow', input),
  };
}
