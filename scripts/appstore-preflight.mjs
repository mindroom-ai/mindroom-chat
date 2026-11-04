// @ts-check
// App Store preflight: before an iOS build is archived or submitted, the version and build
// number of the Xcode App target must be usable and must agree with package.json.
//
// - MARKETING_VERSION (CFBundleShortVersionString) has Apple's three-integer form and is not
//   lower than the package.json version (it may run ahead for closed release trains).
// - CURRENT_PROJECT_VERSION (CFBundleVersion) is a positive integer.
// - Each has one value in every build configuration of the target.
// - The target's Info.plist takes both from those build settings instead of hard-coding them.
// - APP_STORE_VERSION, when set for a submission, is not lower than package.json either.
//
// `node scripts/appstore-preflight.mjs [checkout]` checks the checkout (default: this one),
// prints the versions it accepted and exits 1 with every problem it found otherwise.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertMarketingVersionNotBehindPackage } from './ios-ci-version.mjs';
import { getSingleAppTargetBuildSettingValue } from './ios-xcode-project.mjs';

export const XCODE_PROJECT_PATH = 'ios/App/App.xcodeproj/project.pbxproj';

const APPLE_VERSION = /^\d+\.\d+\.\d+$/;
const BUILD_NUMBER = /^[1-9]\d*$/;

/** @param {string} value a build setting as written in the project */
const unquote = (value) =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The string after `<key>name</key>` in a property list, or undefined.
 * @param {string} plistText
 * @param {string} key
 */
const plistString = (plistText, key) =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plistText)?.[1];

/**
 * @param {string} projectText
 * @param {string} setting
 * @param {string[]} problems collects the reason when the setting cannot be read
 * @returns {string | undefined}
 */
const readSetting = (projectText, setting, problems) => {
  try {
    return unquote(getSingleAppTargetBuildSettingValue(projectText, setting));
  } catch (error) {
    problems.push(messageOf(error));
    return undefined;
  }
};

/**
 * @param {string} label
 * @param {string} version
 * @param {string} packageVersion
 * @param {string[]} problems
 */
const checkMarketingVersion = (label, version, packageVersion, problems) => {
  if (!APPLE_VERSION.test(version)) {
    problems.push(`${label} must use Apple's three-integer format, got '${version}'.`);
    return;
  }
  try {
    assertMarketingVersionNotBehindPackage(version, packageVersion);
  } catch {
    problems.push(
      `${label} ${version} must not be lower than package.json version ${packageVersion}.`
    );
  }
};

/**
 * Every reason the App target's version metadata may not ship; empty when it may.
 * @param {{
 *   packageVersion: string;
 *   projectText: string;
 *   infoPlistText: string;
 *   env?: Record<string, string | undefined>;
 * }} input
 * @returns {string[]}
 */
export const appStoreVersionProblems = ({
  packageVersion,
  projectText,
  infoPlistText,
  env = {},
}) => {
  /** @type {string[]} */
  const problems = [];
  if (!APPLE_VERSION.test(packageVersion)) {
    problems.push(
      `package.json version must have the form major.minor.patch, got '${packageVersion}'.`
    );
    return problems;
  }

  const marketingVersion = readSetting(projectText, 'MARKETING_VERSION', problems);
  if (marketingVersion !== undefined) {
    checkMarketingVersion('iOS MARKETING_VERSION', marketingVersion, packageVersion, problems);
  }

  const buildNumber = readSetting(projectText, 'CURRENT_PROJECT_VERSION', problems);
  if (buildNumber !== undefined && !BUILD_NUMBER.test(buildNumber)) {
    problems.push(`iOS CURRENT_PROJECT_VERSION must be a positive integer, got '${buildNumber}'.`);
  }

  Object.entries({
    CFBundleShortVersionString: 'MARKETING_VERSION',
    CFBundleVersion: 'CURRENT_PROJECT_VERSION',
  }).forEach(([key, setting]) => {
    const value = plistString(infoPlistText, key);
    if (value !== `$(${setting})`) {
      problems.push(`Info.plist ${key} must be $(${setting}), got '${value ?? '(missing)'}'.`);
    }
  });

  const submittedVersion = env.APP_STORE_VERSION?.trim();
  if (submittedVersion) {
    checkMarketingVersion('APP_STORE_VERSION', submittedVersion, packageVersion, problems);
  }

  return problems;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const read = (/** @type {string} */ file) => readFileSync(path.join(root, file), 'utf8');
  const packageVersion = String(JSON.parse(read('package.json')).version);
  const projectText = read(XCODE_PROJECT_PATH);
  // INFOPLIST_FILE is relative to the directory that holds App.xcodeproj.
  const infoPlistFile = unquote(getSingleAppTargetBuildSettingValue(projectText, 'INFOPLIST_FILE'));
  const infoPlistText = read(
    path.join(path.dirname(path.dirname(XCODE_PROJECT_PATH)), infoPlistFile)
  );
  const problems = appStoreVersionProblems({
    packageVersion,
    projectText,
    infoPlistText,
    env: process.env,
  });
  if (problems.length > 0) {
    process.stderr.write(
      `App Store preflight failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}\n`
    );
    process.exit(1);
  }
  const marketingVersion = unquote(
    getSingleAppTargetBuildSettingValue(projectText, 'MARKETING_VERSION')
  );
  const buildNumber = unquote(
    getSingleAppTargetBuildSettingValue(projectText, 'CURRENT_PROJECT_VERSION')
  );
  process.stdout.write(
    `App Store preflight passed: iOS ${marketingVersion} (${buildNumber}), package.json ${packageVersion}\n`
  );
}
