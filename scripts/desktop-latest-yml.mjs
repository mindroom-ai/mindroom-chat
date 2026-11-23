#!/usr/bin/env node
// Generate latest-mac.yml for the Electron Mac app from the final verified arm64 and x64 ZIPs.
// Usage:
//   node scripts/desktop-latest-yml.mjs --version <YYYY.M.N> --repo <owner/repo> \
//     --arm64 <path> --x64 <path> --out <path> [--release-date <iso>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const CALVER_RE = /^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$/;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ARM64_ZIP = 'MindRoom-Chat-arm64-mac.zip';
const X64_ZIP = 'MindRoom-Chat-x64-mac.zip';
const REQUIRED_FILES = [ARM64_ZIP, X64_ZIP];

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

function readZipEntry(filePath, repository, version) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(`Missing release archive: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Release archive is not a regular file: ${filePath}`);
  }
  if (stats.size <= 0) {
    throw new Error(`Release archive is empty: ${filePath}`);
  }
  const bytes = readFileSync(filePath);
  const fileName = path.basename(filePath);
  return {
    url: `https://github.com/${repository}/releases/download/v${version}/${fileName}`,
    sha512: sha512Base64(bytes),
    size: bytes.length,
  };
}

/**
 * Build the YAML text of latest-mac.yml from the final verified arm64 and x64 ZIP archives.
 *
 * @param {{
 *   version: string;
 *   releaseDate?: string;
 *   repository: string;
 *   files: string[];
 * }} options
 * @returns {string}
 */
export function buildDesktopLatestYml({ version, releaseDate, repository, files }) {
  if (typeof version !== 'string' || !CALVER_RE.test(version)) {
    throw new Error(
      `Invalid version '${String(version)}': expected YYYY.M.N without a leading 'v'`
    );
  }
  if (typeof repository !== 'string' || !REPO_RE.test(repository)) {
    throw new Error(`Invalid repository '${String(repository)}': expected owner/repo`);
  }
  const resolvedReleaseDate = releaseDate ?? new Date().toISOString();
  if (
    typeof resolvedReleaseDate !== 'string' ||
    resolvedReleaseDate.trim() === '' ||
    Number.isNaN(Date.parse(resolvedReleaseDate))
  ) {
    throw new Error(`Invalid releaseDate '${String(releaseDate)}'`);
  }
  if (!Array.isArray(files)) {
    throw new Error('files must be an array of ZIP archive paths');
  }

  const byName = new Map();
  for (const filePath of files) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Each entry in files must be a non-empty file path');
    }
    const name = path.basename(filePath);
    if (!REQUIRED_FILES.includes(name)) {
      throw new Error(
        `Unexpected archive filename '${name}': expected ${REQUIRED_FILES.join(', ')}`
      );
    }
    if (byName.has(name)) {
      throw new Error(`Duplicate archive filename '${name}'`);
    }
    byName.set(name, filePath);
  }

  for (const required of REQUIRED_FILES) {
    if (!byName.has(required)) {
      throw new Error(`Missing required archive '${required}'`);
    }
  }

  const entries = REQUIRED_FILES.map((name) => readZipEntry(byName.get(name), repository, version));
  const primary = entries[0];

  return stringify(
    {
      version,
      files: entries,
      path: primary.url,
      sha512: primary.sha512,
      releaseDate: resolvedReleaseDate,
    },
    { lineWidth: 0 }
  );
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      ['--version', '--repo', '--arm64', '--x64', '--out', '--release-date'].includes(flag) &&
      value !== undefined
    ) {
      args[flag.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
  }
  for (const required of ['version', 'repo', 'arm64', 'x64', 'out']) {
    if (!args[required]) {
      throw new Error(`Missing required flag --${required}`);
    }
  }
  return args;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = parseCliArgs(process.argv.slice(2));
  const yml = buildDesktopLatestYml({
    version: args.version,
    releaseDate: args['release-date'],
    repository: args.repo,
    files: [args.arm64, args.x64],
  });
  mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  writeFileSync(args.out, yml, 'utf8');
}
