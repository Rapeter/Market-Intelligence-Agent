import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const electronPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  build?: { appId?: string; productName?: string };
  marketIntelligenceAgent?: { channel?: string };
};
const rootPackage = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
) as { name?: string };
const releasePackageScript = readFileSync(
  new URL('../../../../scripts/release-package.mjs', import.meta.url),
  'utf8',
);
const packageSmokeScript = readFileSync(new URL('../../e2e/package-smoke.mjs', import.meta.url), 'utf8');
const freshInstallScript = readFileSync(new URL('../../e2e/fresh-install.mjs', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../../../../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('Market Intelligence Agent product identity', () => {
  it('uses a separate package and desktop identity from the inherited app', () => {
    expect(rootPackage.name).toBe('market-intelligence-agent');
    expect(electronPackage.build?.productName).toBe('Market Intelligence Agent');
    expect(electronPackage.build?.appId).toBe('com.rapeter.marketintelligenceagent');
    expect(electronPackage.marketIntelligenceAgent?.channel).toBe('alpha');
    expect(releasePackageScript).toContain('extraMetadata.marketIntelligenceAgent.buildSha');
    expect(releasePackageScript).toContain('extraMetadata.marketIntelligenceAgent.channel');
    expect(releasePackageScript).not.toContain('extraMetadata.folio.');
  });

  it('keeps packaged smoke and release notes aligned with the desktop product name', () => {
    expect(packageSmokeScript).toContain('packageMetadata.build.productName');
    expect(packageSmokeScript).not.toContain('Folio.app');
    expect(freshInstallScript).toContain('packageMetadata.build.productName');
    expect(freshInstallScript).not.toContain('Folio.app');
    expect(releaseWorkflow).toContain('# Market Intelligence Agent ${{ github.ref_name }}');
    expect(releaseWorkflow).not.toContain('# Folio ${{ github.ref_name }}');
  });
});
