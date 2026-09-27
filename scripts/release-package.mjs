#!/usr/bin/env node
// Windows-only release packaging for Enterprise Research Workbench.
// Builds the app, creates an unsigned NSIS installer, and stages SHA-256 sums.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('Windows is the only supported desktop packaging target. Run this script on Windows.');
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const electronRoot = join(repoRoot, 'apps', 'electron');
const electronDist = join(repoRoot, 'dist', 'electron');
const releaseDirectory = join(repoRoot, 'dist', 'release');

function run(command, args, cwd, env = process.env) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

run('bun', ['run', 'build'], repoRoot);
run('bun', ['run', 'build:extension'], electronRoot);

const builderArgs = ['run', 'package:builder', '--win', 'nsis'];
if (process.env.FINAGENT_SKIP_WIN_RESOURCE_EDIT === '1') {
  // Restricted Windows accounts may be unable to unpack electron-builder's
  // legacy winCodeSign bundle because it contains macOS symlinks. Keep the
  // normal branded build as the default; allow an explicit runtime-equivalent
  // unsigned package smoke that skips PE icon/version metadata editing.
  builderArgs.push('--config.win.signAndEditExecutable=false');
  console.warn('FINAGENT_SKIP_WIN_RESOURCE_EDIT=1: skipping Windows executable icon/version metadata editing for this build.');
}
if (process.env.FINAGENT_BUILD_SHA) {
  builderArgs.push(`--config.extraMetadata.enterpriseResearchWorkbench.buildSha=${process.env.FINAGENT_BUILD_SHA}`);
}
if (process.env.FINAGENT_CHANNEL) {
  builderArgs.push(`--config.extraMetadata.enterpriseResearchWorkbench.channel=${process.env.FINAGENT_CHANNEL}`);
}
run('bun', builderArgs, electronRoot);

mkdirSync(releaseDirectory, { recursive: true });
const installers = readdirSync(electronDist, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
  .map((entry) => entry.name);
if (installers.length === 0) throw new Error(`No Windows installer .exe was produced in ${electronDist}.`);

const manifest = [];
for (const installer of installers) {
  const source = join(electronDist, installer);
  if (!statSync(source).isFile()) continue;
  const target = join(releaseDirectory, installer);
  copyFileSync(source, target);
  const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
  manifest.push(`${digest}  ${installer}`);
}
if (manifest.length === 0) throw new Error('No Windows installer was staged for release.');

const sums = `${manifest.sort().join('\n')}\n`;
writeFileSync(join(releaseDirectory, 'SHA256SUMS.txt'), sums, 'utf8');
console.log(`\nrelease:package OK — ${installers.join(', ')} staged in ${releaseDirectory}`);
console.log('Windows installers are unsigned. Verify SHA256SUMS.txt before distributing.');
console.log(`Checksums:\n${sums}`);
