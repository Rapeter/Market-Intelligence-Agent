export interface BusinessResearchLiveE2eModeConfig {
  isPackaged: boolean;
  e2e?: string;
  liveE2e?: string;
}

/** A second opt-in flag prevents general fixture E2E runs from exposing live-only operations. */
export function isBusinessResearchLiveE2eEnabled(config: BusinessResearchLiveE2eModeConfig): boolean {
  return !config.isPackaged && config.e2e === '1' && config.liveE2e === '1';
}
