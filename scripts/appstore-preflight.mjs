// @ts-check
// App Store preflight: before an iOS build is archived or submitted, the version and build
// number of the Xcode App target must be usable.
//
// - MARKETING_VERSION (CFBundleShortVersionString) has Apple's three-integer form. Xcode Cloud
//   builds set it to a calendar version (scripts/ios-ci-version.mjs); package.json's version
//   plays no part.
// - CURRENT_PROJECT_VERSION (CFBundleVersion) is a positive integer.
// - Each has one value in every build configuration of the target.
// - The target's Info.plist takes both from those build settings instead of hard-coding them.
//
// `node scripts/appstore-preflight.mjs [checkout]` checks the checkout (default: this one),
// prints the versions it accepted and exits 1 with every problem it found otherwise.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 * Every reason the App target's version metadata may not ship; empty when it may.
 * @param {{ projectText: string; infoPlistText: string }} input
 * @returns {string[]}
 */
export const appStoreVersionProblems = ({ projectText, infoPlistText }) => {
  /** @type {string[]} */
  const problems = [];
  const marketingVersion = readSetting(projectText, 'MARKETING_VERSION', problems);
  if (marketingVersion !== undefined && !APPLE_VERSION.test(marketingVersion)) {
    problems.push(
      `iOS MARKETING_VERSION must use Apple's three-integer format, got '${marketingVersion}'.`
    );
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

  return problems;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const read = (/** @type {string} */ file) => readFileSync(path.join(root, file), 'utf8');
  const projectText = read(XCODE_PROJECT_PATH);
  // INFOPLIST_FILE is relative to the directory that holds App.xcodeproj.
  const infoPlistFile = unquote(getSingleAppTargetBuildSettingValue(projectText, 'INFOPLIST_FILE'));
  const infoPlistText = read(
    path.join(path.dirname(path.dirname(XCODE_PROJECT_PATH)), infoPlistFile)
  );
  const problems = appStoreVersionProblems({ projectText, infoPlistText });
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
  process.stdout.write(`App Store preflight passed: iOS ${marketingVersion} (${buildNumber})\n`);
}
