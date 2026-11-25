#!/usr/bin/env node
// @ts-check
// Fetch and verify the pinned arm64 MindRoom Desktop Helper.app bundle, or stage a local .app.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HELPER_APP_NAME = 'MindRoom Desktop Helper.app';
const HELPER_EXEC_REL = path.join('Contents', 'MacOS', 'MindRoom Desktop Helper');
const DEFAULT_PIN = 'scripts/desktop-helper-pin.json';
const DEFAULT_OUT = path.join('build', 'electron', HELPER_APP_NAME);
// Pending sentinel used before the upstream release publishes the tarball SHA-256; rejected in download mode.
const PENDING_SHA256 = '0'.repeat(64);
const PENDING_MSG =
  'Desktop helper pin sha256 is set to the pending all-zeros sentinel; update scripts/desktop-helper-pin.json.';
const SHA256_RE = /^[0-9a-f]{64}$/;
const PIN_RULES = /** @type {const} */ ([
  ['repo', /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/],
  ['tag', /^[A-Za-z0-9._-]+$/],
  ['asset', /^[A-Za-z0-9._-]+$/],
  ['sha256', SHA256_RE],
  ['bundleId', /^[A-Za-z0-9.-]+$/],
  ['teamId', /^[A-Z0-9]{10}$/],
]);

/** @param {unknown} ok @param {string} message */
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};

/** @param {string} appDir */
function assertHelperApp(appDir) {
  const stats = fs.statSync(path.join(appDir, HELPER_EXEC_REL), { throwIfNoEntry: false });
  check(
    stats?.isFile(),
    `Invalid ${HELPER_APP_NAME} bundle at ${appDir}: missing ${HELPER_EXEC_REL}`
  );
}

/** @param {string} [pinPath] */
export function readHelperPin(pinPath = DEFAULT_PIN) {
  const raw = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  check(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    `Invalid helper pin JSON: ${pinPath}`
  );
  for (const [key, pattern] of PIN_RULES) {
    check(
      typeof raw[key] === 'string' && pattern.test(raw[key]),
      `Invalid helper pin field '${key}' in ${pinPath}`
    );
  }
  return /** @type {{ repo: string; tag: string; asset: string; sha256: string; bundleId: string; teamId: string }} */ ({
    repo: raw.repo,
    tag: raw.tag,
    asset: raw.asset,
    sha256: raw.sha256,
    bundleId: raw.bundleId,
    teamId: raw.teamId,
  });
}

/** @param {string} tarballPath @param {string} expectedSha256 */
export function verifyTarballSha256(tarballPath, expectedSha256) {
  check(
    typeof expectedSha256 === 'string' && SHA256_RE.test(expectedSha256),
    'Invalid expected sha256'
  );
  check(expectedSha256 !== PENDING_SHA256, PENDING_MSG);
  const actual = createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex');
  check(
    actual === expectedSha256,
    `SHA-256 mismatch for ${tarballPath}: expected ${expectedSha256}, got ${actual}`
  );
  return actual;
}

/** @param {string} url @param {string} destPath */
async function defaultDownloadTarball(url, destPath) {
  const response = await fetch(url, {
    headers: { Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  check(response.ok, `Failed to download ${url}: HTTP ${response.status}`);
  fs.writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
}

/** @param {string} resolvedOut @param {(workDir: string) => Promise<string> | string} buildStaged */
async function stageAndReplace(resolvedOut, buildStaged) {
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(path.dirname(resolvedOut), '.desktop-helper-tmp-'));
  fs.chmodSync(workDir, 0o700);
  try {
    const staged = await buildStaged(workDir);
    assertHelperApp(staged);
    const hadDest = Boolean(fs.lstatSync(resolvedOut, { throwIfNoEntry: false }));
    const backup = path.join(workDir, 'previous.app');
    if (hadDest) fs.renameSync(resolvedOut, backup);
    try {
      fs.renameSync(staged, resolvedOut);
    } catch (err) {
      if (hadDest && fs.existsSync(backup)) fs.renameSync(backup, resolvedOut);
      throw err;
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** @param {{ pinPath?: string; outDir?: string; localAppPath?: string; downloadTarball?: (url: string, destPath: string) => Promise<void> }} [options] */
export async function fetchDesktopHelper({
  pinPath = DEFAULT_PIN,
  outDir = DEFAULT_OUT,
  localAppPath = process.env.MINDROOM_DESKTOP_HELPER_APP ?? '',
  downloadTarball = defaultDownloadTarball,
} = {}) {
  const resolvedOut = path.resolve(outDir);
  const localSrc = localAppPath.trim();
  if (localSrc) {
    const resolvedLocal = path.resolve(localSrc);
    assertHelperApp(resolvedLocal);
    if (
      fs.existsSync(resolvedOut) &&
      fs.realpathSync(resolvedLocal) === fs.realpathSync(resolvedOut)
    )
      return;
    await stageAndReplace(resolvedOut, (workDir) => {
      const staged = path.join(workDir, HELPER_APP_NAME);
      fs.cpSync(resolvedLocal, staged, { recursive: true, verbatimSymlinks: true });
      return staged;
    });
    return;
  }

  const pin = readHelperPin(pinPath);
  check(pin.sha256 !== PENDING_SHA256, PENDING_MSG);
  const url = `https://github.com/${pin.repo}/releases/download/${pin.tag}/${pin.asset}`;
  await stageAndReplace(resolvedOut, async (workDir) => {
    const tarballPath = path.join(workDir, pin.asset);
    const extractDir = path.join(workDir, 'extract');
    fs.mkdirSync(extractDir);
    await downloadTarball(url, tarballPath);
    verifyTarballSha256(tarballPath, pin.sha256);
    execFileSync('tar', ['-xzf', tarballPath, '-C', extractDir], { stdio: 'pipe' });
    return path.join(extractDir, HELPER_APP_NAME);
  });
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
) {
  const { values } = parseArgs({
    options: { pin: { type: 'string' }, out: { type: 'string' }, 'local-app': { type: 'string' } },
  });
  await fetchDesktopHelper({
    pinPath: values.pin,
    outDir: values.out,
    localAppPath: values['local-app'] ?? process.env.MINDROOM_DESKTOP_HELPER_APP,
  });
}
