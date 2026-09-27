import { join } from 'node:path';

/** Windows userData directory used before the product display name changed. */
export function legacyEnterpriseResearchUserDataPath(appDataPath: string): string {
  return join(appDataPath, 'Market Intelligence Agent');
}
