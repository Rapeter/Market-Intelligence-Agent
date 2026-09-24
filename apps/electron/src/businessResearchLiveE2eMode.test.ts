import { describe, expect, it } from 'bun:test';
import { isBusinessResearchLiveE2eEnabled } from './businessResearchLiveE2eMode';

describe('business-research live E2E mode gate', () => {
  it('requires both explicit test flags and an unpackaged app', () => {
    expect(isBusinessResearchLiveE2eEnabled({ isPackaged: false, e2e: '1', liveE2e: '1' })).toBe(true);
    expect(isBusinessResearchLiveE2eEnabled({ isPackaged: true, e2e: '1', liveE2e: '1' })).toBe(false);
    expect(isBusinessResearchLiveE2eEnabled({ isPackaged: false, e2e: '1', liveE2e: '0' })).toBe(false);
    expect(isBusinessResearchLiveE2eEnabled({ isPackaged: false, e2e: '0', liveE2e: '1' })).toBe(false);
    expect(isBusinessResearchLiveE2eEnabled({ isPackaged: false })).toBe(false);
  });
});
