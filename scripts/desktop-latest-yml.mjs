#!/usr/bin/env node
// Generate latest-mac.yml or latest-linux*.yml for the Electron desktop app.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { stringify } from 'yaml';

const CALVER_RE = /^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$/;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const REQUIRED_MAC_FILES = ['MindRoom-Chat-arm64-mac.zip', 'MindRoom-Chat-x64-mac.zip'];
const LINUX_ARCH_FILES = {
  x64: 'MindRoom-Chat-x86_64.AppImage',
  arm64: 'MindRoom-Chat-arm64.AppImage',
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function validateCommon({ version, releaseDate, repository }) {
  check(
    typeof version === 'string' && CALVER_RE.test(version),
    `Invalid version '${String(version)}'`
  );
  check(
    typeof repository === 'string' && REPO_RE.test(repository),
    `Invalid repository '${String(repository)}'`
  );
  const date = releaseDate ?? new Date().toISOString();
  check(
    typeof date === 'string' && date.trim() && !Number.isNaN(Date.parse(date)),
    `Invalid releaseDate '${String(releaseDate)}'`
  );
  return date;
}

function readEmbeddedBlockMapSize(bytes, filePath) {
  const invalidMessage = `Invalid or missing embedded blockmap in AppImage: ${filePath}`;
  check(bytes.length > 4, invalidMessage);
  const blockMapSize = bytes.readUInt32BE(bytes.length - 4);
  check(blockMapSize > 0 && blockMapSize <= bytes.length - 4, invalidMessage);
  let parsed;
  try {
    const compressed = bytes.subarray(bytes.length - 4 - blockMapSize, bytes.length - 4);
    parsed = JSON.parse(inflateRawSync(compressed).toString('utf8'));
  } catch (error) {
    throw new Error(
      `${invalidMessage} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error }
    );
  }
  check(
    parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.files) &&
      parsed.files.length > 0,
    invalidMessage
  );
  return blockMapSize;
}

function readFileEntry(filePath, repository, version, { includeBlockMapSize = false } = {}) {
  const stats = statSync(filePath, { throwIfNoEntry: false });
  check(stats, `Missing release archive: ${filePath}`);
  check(stats.isFile(), `Release archive is not a regular file: ${filePath}`);
  check(stats.size > 0, `Release archive is empty: ${filePath}`);
  const bytes = readFileSync(filePath);
  const entry = {
    url: `https://github.com/${repository}/releases/download/v${version}/${path.basename(filePath)}`,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    size: bytes.length,
  };
  if (includeBlockMapSize) {
    entry.blockMapSize = readEmbeddedBlockMapSize(bytes, filePath);
  }
  return entry;
}

/** @param {{ version: string; releaseDate?: string; repository: string; files: string[] }} options */
export function buildDesktopLatestYml({ version, releaseDate, repository, files }) {
  const date = validateCommon({ version, releaseDate, repository });
  check(Array.isArray(files), 'files must be an array of ZIP archive paths');

  const byName = new Map();
  for (const filePath of files) {
    check(typeof filePath === 'string' && filePath.trim(), 'Each file path must be non-empty');
    const name = path.basename(filePath);
    check(REQUIRED_MAC_FILES.includes(name), `Unexpected archive filename '${name}'`);
    check(!byName.has(name), `Duplicate archive filename '${name}'`);
    byName.set(name, filePath);
  }
  for (const required of REQUIRED_MAC_FILES) {
    check(byName.has(required), `Missing required archive '${required}'`);
  }

  const entries = REQUIRED_MAC_FILES.map((name) =>
    readFileEntry(byName.get(name), repository, version)
  );
  const [primary] = entries;
  return stringify(
    { version, files: entries, path: primary.url, sha512: primary.sha512, releaseDate: date },
    { lineWidth: 0 }
  );
}

/**
 * @param {{
 *   version: string;
 *   releaseDate?: string;
 *   repository: string;
 *   arch: 'x64' | 'arm64';
 *   file: string;
 * }} options
 */
export function buildLinuxLatestYml({ version, releaseDate, repository, arch, file }) {
  const date = validateCommon({ version, releaseDate, repository });
  check(
    typeof arch === 'string' && Object.hasOwn(LINUX_ARCH_FILES, arch),
    `Invalid Linux arch '${String(arch)}'`
  );
  check(typeof file === 'string' && file.trim(), 'file path must be non-empty');
  const expectedName = LINUX_ARCH_FILES[arch];
  const name = path.basename(file);
  check(
    name === expectedName,
    `Unexpected AppImage filename '${name}' for arch '${arch}' (expected '${expectedName}')`
  );

  const entry = readFileEntry(file, repository, version, { includeBlockMapSize: true });
  return stringify(
    { version, files: [entry], path: entry.url, sha512: entry.sha512, releaseDate: date },
    { lineWidth: 0 }
  );
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  const options = Object.fromEntries(
    ['platform', 'version', 'repo', 'arm64', 'x64', 'arch', 'file', 'out', 'release-date'].map(
      (k) => [k, { type: 'string' }]
    )
  );
  const { values } = parseArgs({ options });
  const platform = values.platform ?? 'mac';
  let yml;
  if (platform === 'mac') {
    for (const flag of ['version', 'repo', 'arm64', 'x64', 'out']) {
      check(values[flag], `Missing required flag --${flag}`);
    }
    for (const unexpected of ['arch', 'file']) {
      check(!values[unexpected], `Unexpected flag --${unexpected} for mac platform`);
    }
    yml = buildDesktopLatestYml({
      version: values.version,
      releaseDate: values['release-date'],
      repository: values.repo,
      files: [values.arm64, values.x64],
    });
  } else if (platform === 'linux') {
    for (const flag of ['version', 'repo', 'arch', 'file', 'out']) {
      check(values[flag], `Missing required flag --${flag}`);
    }
    for (const unexpected of ['arm64', 'x64']) {
      check(!values[unexpected], `Unexpected flag --${unexpected} for linux platform`);
    }
    yml = buildLinuxLatestYml({
      version: values.version,
      releaseDate: values['release-date'],
      repository: values.repo,
      arch: values.arch,
      file: values.file,
    });
  } else {
    throw new Error(`Invalid platform '${platform}'`);
  }
  mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  writeFileSync(values.out, yml, 'utf8');
}
