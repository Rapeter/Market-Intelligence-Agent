import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const electronPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  build?: { appId?: string; productName?: string };
  enterpriseResearchWorkbench?: { channel?: string };
};
const rootPackage = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
) as { name?: string };
const releasePackageScript = readFileSync(
  new URL('../../../../scripts/release-package.mjs', import.meta.url),
  'utf8',
);
const packageSmokeScript = readFileSync(new URL('../../e2e/package-smoke.mjs', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../../../../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('Enterprise Research Workbench product identity', () => {
  it('uses a separate package and desktop identity from the inherited app', () => {
    expect(rootPackage.name).toBe('market-intelligence-agent');
    expect(electronPackage.build?.productName).toBe('Enterprise Research Workbench');
    expect(electronPackage.build?.appId).toBe('com.rapeter.enterpriseresearchworkbench');
    expect(electronPackage.enterpriseResearchWorkbench?.channel).toBe('alpha');
    expect(releasePackageScript).toContain('extraMetadata.enterpriseResearchWorkbench.buildSha');
    expect(releasePackageScript).toContain('extraMetadata.enterpriseResearchWorkbench.channel');
    expect(releasePackageScript).not.toContain('extraMetadata.folio.');
  });

  it('keeps packaged smoke and release notes aligned with the desktop product name', () => {
    expect(packageSmokeScript).toContain('packageMetadata.build.productName');
    expect(packageSmokeScript).not.toContain('Folio.app');
    expect(packageSmokeScript).toContain('win-unpacked');
    expect(packageSmokeScript).toContain('businessResearch');
    expect(releaseWorkflow).toContain('# Enterprise Research Workbench ${{ github.ref_name }}');
    expect(releaseWorkflow).not.toContain('# Folio ${{ github.ref_name }}');
  });
});
