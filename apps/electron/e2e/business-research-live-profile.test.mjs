import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profileModule = await import('./business-research-live-profile.mjs').catch(() => ({}));
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function temporaryRepository(root) {
  const repository = join(root, 'repository');
  mkdirSync(repository, { recursive: true });
  return repository;
}

describe('dedicated live research profile', () => {
  it('prepares an empty external profile with a non-secret purpose marker', () => {
    expect(typeof profileModule.prepareLiveProfile).toBe('function');
    if (typeof profileModule.prepareLiveProfile !== 'function') return;

    const root = temporaryRoot('market-research-profile-test-');
    const repoRoot = temporaryRepository(root);
    const profile = join(root, 'live-profile');
    const result = profileModule.prepareLiveProfile(profile, repoRoot);

    expect(result).toMatchObject({ ready: true, profileDirectory: profile });
    expect(existsSync(result.markerPath)).toBe(true);
    expect(readdirSync(profile)).toEqual([profileModule.LIVE_PROFILE_MARKER_NAME]);
  });

  it('refuses a repository path so live runs cannot contaminate or commit credentials', () => {
    if (typeof profileModule.prepareLiveProfile !== 'function') return;

    const root = temporaryRoot('market-research-profile-test-');
    const repoRoot = temporaryRepository(root);
    expect(() => profileModule.prepareLiveProfile(join(repoRoot, 'profile'), repoRoot))
      .toThrow('outside the repository');
  });

  it('refuses to mark a non-empty unmarked directory as a test profile', () => {
    if (typeof profileModule.prepareLiveProfile !== 'function') return;

    const root = temporaryRoot('market-research-profile-test-');
    const repoRoot = temporaryRepository(root);
    const profile = join(root, 'existing-profile');
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'unrelated.txt'), 'user data');
    expect(() => profileModule.prepareLiveProfile(profile, repoRoot)).toThrow('non-empty');
  });

  it('requires the purpose marker before opening a persistent profile', () => {
    expect(typeof profileModule.assertLiveProfile).toBe('function');
    if (typeof profileModule.assertLiveProfile !== 'function') return;

    const root = temporaryRoot('market-research-profile-test-');
    const repoRoot = temporaryRepository(root);
    const profile = join(root, 'live-profile');
    expect(() => profileModule.assertLiveProfile(profile, repoRoot)).toThrow('not prepared');
    profileModule.prepareLiveProfile(profile, repoRoot);
    expect(profileModule.assertLiveProfile(profile, repoRoot)).toMatchObject({
      ready: true,
      profileDirectory: profile,
    });
  });

  it('keeps Electron logs outside both the persistent profile and repository', () => {
    expect(typeof profileModule.createEphemeralLogDirectory).toBe('function');
    if (typeof profileModule.createEphemeralLogDirectory !== 'function') return;

    const root = temporaryRoot('market-research-profile-test-');
    const repoRoot = temporaryRepository(root);
    const profile = profileModule.prepareLiveProfile(join(root, 'live-profile'), repoRoot);
    const temporaryLogRoot = join(root, 'temporary-logs');
    mkdirSync(temporaryLogRoot);

    const logDirectory = profileModule.createEphemeralLogDirectory(
      profile.profileDirectory,
      temporaryLogRoot,
      repoRoot,
    );

    expect(logDirectory.startsWith(profile.profileDirectory)).toBe(false);
    expect(logDirectory.startsWith(repoRoot)).toBe(false);
    expect(readdirSync(profile.profileDirectory)).toEqual([profileModule.LIVE_PROFILE_MARKER_NAME]);
    expect(readdirSync(logDirectory)).toEqual([]);
  });
});
