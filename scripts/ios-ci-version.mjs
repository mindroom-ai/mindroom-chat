// @ts-check
// Chooses the iOS marketing version (CFBundleShortVersionString) and build number
// (CFBundleVersion) for a build. The marketing version is a calendar version
// (scripts/calver.mjs): an explicit override, else the release tag being built (Xcode Cloud's
// CI_TAG, else a release tag on HEAD), else the version the next release will get. The build
// number is an explicit override, else Xcode Cloud's build counter, else the value checked in to
// the Xcode project.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatVersion, latestReleaseTag, nextVersion, parseReleaseTag } from './calver.mjs';
import { getSingleAppTargetBuildSettingValue } from './ios-xcode-project.mjs';

const CHECKED_IN = 'checked-in Xcode project';
const MARKETING_OVERRIDES = ['IOS_MARKETING_VERSION', 'APP_STORE_MARKETING_VERSION'];

/** @param {string | undefined} value */
const clean = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * @typedef {{
 *   marketingVersion: string;
 *   marketingVersionSource: string;
 *   buildNumber: string;
 *   buildNumberSource: string;
 * }} IosVersionMetadata
 */

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} tags every tag of the checkout
 * @param {readonly string[]} headTags the tags on HEAD
 * @param {Date} date
 * @returns {[string, string]} the version and where it came from
 */
const marketingVersionOf = (env, tags, headTags, date) => {
  const overrideKey = MARKETING_OVERRIDES.find((key) => clean(env[key]));
  if (overrideKey) return [/** @type {string} */ (clean(env[overrideKey])), overrideKey];

  const ciTag = clean(env.CI_TAG);
  if (ciTag) {
    const version = parseReleaseTag(ciTag);
    if (!version) throw new Error(`CI_TAG ${ciTag} is not a release tag vYYYY.M.N.`);
    return [formatVersion(version), `tag:${ciTag}`];
  }
  const headTag = latestReleaseTag(headTags);
  if (headTag) return [formatVersion(headTag.version), `head-tag:${headTag.tag}`];

  return [
    formatVersion(nextVersion(tags, date)),
    `next-after:${latestReleaseTag(tags)?.tag ?? 'none'}`,
  ];
};

/**
 * @param {{
 *   env: Record<string, string | undefined>;
 *   checkedInBuildNumber: string;
 *   tags: readonly string[];
 *   headTags: readonly string[];
 *   date: Date;
 * }} input
 * @returns {IosVersionMetadata}
 */
export const resolveIosCiVersionMetadata = ({
  env,
  checkedInBuildNumber,
  tags,
  headTags,
  date,
}) => {
  /** @type {[string, string]} */
  let build = [checkedInBuildNumber, CHECKED_IN];
  const ciCounter = clean(env.CI) && clean(env.CI_BUILD_NUMBER);
  if (clean(env.IOS_BUILD_NUMBER)) {
    build = [/** @type {string} */ (clean(env.IOS_BUILD_NUMBER)), 'IOS_BUILD_NUMBER'];
  } else if (ciCounter) {
    build = [ciCounter, 'CI_BUILD_NUMBER'];
  }

  const [marketingVersion, marketingVersionSource] = marketingVersionOf(env, tags, headTags, date);
  return {
    marketingVersion,
    marketingVersionSource,
    buildNumber: build[0],
    buildNumberSource: build[1],
  };
};

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string[]}
 */
const gitLines = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

// `node scripts/ios-ci-version.mjs` prints the metadata for this checkout as `key=value` lines
// (ios/App/ci_scripts/ci_pre_xcodebuild.sh reads them, after fetching the tags).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const project = readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const metadata = resolveIosCiVersionMetadata({
    env: process.env,
    checkedInBuildNumber: getSingleAppTargetBuildSettingValue(project, 'CURRENT_PROJECT_VERSION'),
    tags: gitLines(['tag', '--list', 'v*'], root),
    headTags: gitLines(['tag', '--points-at', 'HEAD'], root),
    date: new Date(),
  });
  process.stdout.write(
    [
      `marketing_version=${metadata.marketingVersion}`,
      `marketing_version_source=${metadata.marketingVersionSource}`,
      `build_number=${metadata.buildNumber}`,
      `build_number_source=${metadata.buildNumberSource}`,
    ].join('\n') + '\n'
  );
}
