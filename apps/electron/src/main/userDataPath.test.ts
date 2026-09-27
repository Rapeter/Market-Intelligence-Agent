import { describe, expect, it } from 'bun:test';
import { legacyEnterpriseResearchUserDataPath } from './userDataPath.ts';

describe('stable Windows user-data location', () => {
  it('preserves the previous profile directory after rebranding', () => {
    expect(legacyEnterpriseResearchUserDataPath('C:\\Users\\sample\\AppData\\Roaming'))
      .toBe('C:\\Users\\sample\\AppData\\Roaming\\Market Intelligence Agent');
  });
});
