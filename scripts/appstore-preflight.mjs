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
// And App Store Connect must take the watch app the archive embeds; it refused the first two
// builds that had one (ITMS-90733, ITMS-90362):
//
// - The watch targets, which are built without arm64_32, have watchOS 27.0 or newer as their
//   minimum.
// - The watch app's Info.plist has no WKBackgroundModes.
//
// `node scripts/appstore-preflight.mjs [checkout]` checks the checkout (default: this one),
// prints the versions it accepted and exits 1 with every problem it found otherwise.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSingleAppTargetBuildSettingValue } from './ios-xcode-project.mjs';

export const XCODE_PROJECT_PATH = 'ios/App/App.xcodeproj/project.pbxproj';
export const WATCH_INFO_PLIST_PATH = 'ios/Watch/MindRoomWatch/Info.plist';

const WATCH_TARGETS = ['MindRoomWatch', 'MindRoomWatchWidgets'];

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
 * @param {string} [target] the App target when left out
 * @returns {string | undefined}
 */
const readSetting = (projectText, setting, problems, target) => {
  try {
    return unquote(getSingleAppTargetBuildSettingValue(projectText, setting, target));
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

/**
 * Every reason App Store Connect refuses an upload over the watch app it embeds; empty when it
 * takes it.
 * @param {{ projectText: string; watchInfoPlistText: string }} input
 * @returns {string[]}
 */
export const watchAppUploadProblems = ({ projectText, watchInfoPlistText }) => {
  /** @type {string[]} */
  const problems = [];
  // The watch SDK has no arm64_32 build (scripts/watch/build-sdk.sh).
  WATCH_TARGETS.forEach((target) => {
    const minimum = readSetting(projectText, 'WATCHOS_DEPLOYMENT_TARGET', problems, target);
    if (minimum !== undefined && !(Number.parseFloat(minimum) >= 27)) {
      problems.push(
        `Target ${target} is built without arm64_32, which App Store Connect takes only from watchOS 27.0 on, but its WATCHOS_DEPLOYMENT_TARGET is ${minimum}.`
      );
    }
  });

  if (watchInfoPlistText.replace(/<!--[\s\S]*?-->/g, '').includes('<key>WKBackgroundModes</key>')) {
    problems.push(
      "The watch app's Info.plist has WKBackgroundModes, none of whose services the app uses; background audio is 'audio' in UIBackgroundModes."
    );
  }

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
  const problems = [
    ...appStoreVersionProblems({ projectText, infoPlistText }),
    ...watchAppUploadProblems({ projectText, watchInfoPlistText: read(WATCH_INFO_PLIST_PATH) }),
  ];
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
