// @ts-check
// Chooses the iOS marketing version (CFBundleShortVersionString) and build number
// (CFBundleVersion) for a build: explicit overrides first, then Xcode Cloud's build counter,
// then the release tag (`v<version>-mindroom.<n>` gives build number n), then the values
// checked in to the Xcode project.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSingleAppTargetBuildSettingValue } from './ios-xcode-project.mjs';

const CHECKED_IN = 'checked-in Xcode project';
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)-mindroom\.(\d+)$/;
const MARKETING_OVERRIDES = ['IOS_MARKETING_VERSION', 'APP_STORE_MARKETING_VERSION'];

/** @param {string | undefined} value */
const clean = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * @param {string} version
 * @returns {[number, number, number]}
 */
const parseVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new Error(`Version ${version} must have the form major.minor.patch`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * @param {string} a
 * @param {string} b
 */
const compareVersions = (a, b) => {
  const [left, right] = [parseVersion(a), parseVersion(b)];
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

/**
 * @param {string | undefined} ref
 * @returns {string | undefined}
 */
const tagFromRef = (ref) => {
  const value = clean(ref);
  if (!value) return undefined;
  return value.startsWith('refs/tags/') ? value.slice('refs/tags/'.length) : value;
};

/**
 * The release iteration of the newest release tag among `tags`.
 * @param {string[]} tags
 * @returns {{ tag: string; iteration: string } | undefined}
 */
const newestReleaseTag = (tags) =>
  tags
    .map((tag) => ({ tag, match: RELEASE_TAG.exec(tag.trim()) }))
    .filter((entry) => entry.match)
    .map(({ tag, match }) => ({
      tag: tag.trim(),
      iteration: /** @type {RegExpExecArray} */ (match)[2],
    }))
    .sort((a, b) => Number(b.iteration) - Number(a.iteration))[0];

/**
 * @typedef {{
 *   marketingVersion: string;
 *   marketingVersionSource: string;
 *   buildNumber: string;
 *   buildNumberSource: string;
 * }} IosVersionMetadata
 */

/**
 * @param {{
 *   env: Record<string, string | undefined>;
 *   packageVersion: string;
 *   checkedInMarketingVersion: string;
 *   checkedInBuildNumber: string;
 *   headTags: string[];
 * }} input
 * @returns {IosVersionMetadata}
 */
export const resolveIosCiVersionMetadata = ({
  env,
  packageVersion,
  checkedInMarketingVersion,
  checkedInBuildNumber,
  headTags,
}) => {
  const ciCounter = clean(env.CI) && clean(env.CI_BUILD_NUMBER);

  /** @type {[string, string]} */
  let build = [checkedInBuildNumber, CHECKED_IN];
  const envTag = [env.CI_TAG, env.GITHUB_REF_NAME, env.GITHUB_REF]
    .map(tagFromRef)
    .find((tag) => tag && RELEASE_TAG.test(tag));
  const headTag = newestReleaseTag(headTags);
  if (clean(env.IOS_BUILD_NUMBER)) {
    build = [/** @type {string} */ (clean(env.IOS_BUILD_NUMBER)), 'IOS_BUILD_NUMBER'];
  } else if (ciCounter) {
    build = [ciCounter, 'CI_BUILD_NUMBER'];
  } else if (envTag) {
    build = [/** @type {RegExpExecArray} */ (RELEASE_TAG.exec(envTag))[2], `env-tag:${envTag}`];
  } else if (headTag) {
    build = [headTag.iteration, `head-tag:${headTag.tag}`];
  }

  /** @type {[string, string]} */
  let marketing = [checkedInMarketingVersion, CHECKED_IN];
  const overrideKey = MARKETING_OVERRIDES.find((key) => clean(env[key]));
  if (overrideKey) {
    marketing = [/** @type {string} */ (clean(env[overrideKey])), overrideKey];
  } else if (ciCounter) {
    // Xcode Cloud's counter only grows, so adding it to the patch of the newer of the package
    // and checked-in versions keeps App Store versions increasing across releases.
    const base =
      compareVersions(checkedInMarketingVersion, packageVersion) >= 0
        ? checkedInMarketingVersion
        : packageVersion;
    const [major, minor, patch] = parseVersion(base);
    marketing = [`${major}.${minor}.${patch + Number(ciCounter)}`, 'build-counter:CI_BUILD_NUMBER'];
  }

  return {
    marketingVersion: marketing[0],
    marketingVersionSource: marketing[1],
    buildNumber: build[0],
    buildNumberSource: build[1],
  };
};

/**
 * The App Store marketing version may run ahead of package.json, never behind it.
 * @param {string} marketingVersion
 * @param {string} packageVersion
 */
export const assertMarketingVersionNotBehindPackage = (marketingVersion, packageVersion) => {
  if (compareVersions(marketingVersion, packageVersion) < 0) {
    throw new Error(
      `iOS marketing version ${marketingVersion} must not be lower than package.json version ${packageVersion}`
    );
  }
};

// `node scripts/ios-ci-version.mjs` prints the metadata for this checkout as shell assignments.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const project = readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const packageVersion = String(
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
  );
  const checkedInMarketingVersion = getSingleAppTargetBuildSettingValue(
    project,
    'MARKETING_VERSION'
  );
  assertMarketingVersionNotBehindPackage(checkedInMarketingVersion, packageVersion);
  /** @type {string[]} */
  let headTags = [];
  try {
    headTags = execFileSync('git', ['tag', '--points-at', 'HEAD'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    headTags = [];
  }
  const metadata = resolveIosCiVersionMetadata({
    env: process.env,
    packageVersion,
    checkedInMarketingVersion,
    checkedInBuildNumber: getSingleAppTargetBuildSettingValue(project, 'CURRENT_PROJECT_VERSION'),
    headTags,
  });
  process.stdout.write(
    `MARKETING_VERSION=${metadata.marketingVersion}\nCURRENT_PROJECT_VERSION=${metadata.buildNumber}\n`
  );
}
