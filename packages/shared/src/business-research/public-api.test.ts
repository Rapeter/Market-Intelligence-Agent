import { describe, expect, it } from 'bun:test';
import {
  BusinessResearchRepository,
  BusinessResearchScheduler,
  BusinessResearchService,
  createPiBusinessResearchAdapter,
  runBusinessResearch,
} from './index.ts';

describe('business research public barrel', () => {
  it('exposes the runtime, persistence, service, and scheduler from the package subpath', () => {
    expect(runBusinessResearch).toBeFunction();
    expect(BusinessResearchRepository).toBeFunction();
    expect(BusinessResearchService).toBeFunction();
    expect(BusinessResearchScheduler).toBeFunction();
    expect(createPiBusinessResearchAdapter).toBeFunction();
  });
});
