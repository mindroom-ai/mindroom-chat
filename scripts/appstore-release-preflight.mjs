// @ts-check
// Checks an App Store release before fastlane submits it: the version, build number, release
// notes and typed confirmation, and the screenshot set.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The scenes e2e/diagnostics/app-store-screenshots.spec.ts captures, in upload order, named the way
// src/app/native/appStoreScreenshots.ts names its files: `<order>_<device>_<theme>_<scene>.png`.
// Fastlane sorts each device's files by name, so the order prefix keeps the scenes in sequence.
const SCENES = [
  'light_personal-workspace',
  'dark_mindroom-explained',
  'light_campground-monitor',
  'dark_car-search',
  'light_home-reminders',
];

/** @param {string} deviceId */
const sceneFiles = (deviceId) => SCENES.map((scene, order) => `${order}_${deviceId}_${scene}.png`);

/** Required screenshot sizes: 6.9-inch iPhone and 13-inch iPad, portrait. */
export const APP_STORE_SCREENSHOT_SETS = [
  { device: 'iPhone 6.9-inch', width: 1320, height: 2868, filenames: sceneFiles('iphone-6-9') },
  { device: 'iPad 13-inch', width: 2064, height: 2752, filenames: sceneFiles('ipad-13') },
];

/**
 * The text the operator types to confirm a submission; approved versions publish at once.
 * @param {string} appVersion
 * @param {string} buildNumber
 */
export const expectedReleaseConfirmation = (appVersion, buildNumber) =>
  `submit ${appVersion} (${buildNumber}) for review and release`;

/**
 * @param {{
 *   appVersion?: string;
 *   buildNumber?: string;
 *   confirmation?: string;
 *   releaseNotes?: string;
 * }} [input]
 */
export const validateReleaseInput = (input = {}) => {
  const appVersion = input.appVersion?.trim() ?? '';
  const buildNumber = input.buildNumber?.trim() ?? '';
  /** @type {string[]} */
  const errors = [];
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
    errors.push('APP_STORE_VERSION must use the three-integer format, such as 4.12.145.');
  }
  if (!/^[1-9]\d*$/.test(buildNumber)) {
    errors.push('APP_STORE_BUILD_NUMBER must be a positive integer.');
  }
  const expected = expectedReleaseConfirmation(appVersion, buildNumber);
  if (input.confirmation !== expected) {
    errors.push(`APP_STORE_RELEASE_CONFIRMATION must exactly equal "${expected}".`);
  }
  if (!input.releaseNotes?.trim()) {
    errors.push('APP_STORE_RELEASE_NOTES must not be empty.');
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
};

/**
 * The width and height in a PNG's IHDR chunk, or undefined for something else.
 * @param {Buffer} bytes
 */
const pngSize = (bytes) => {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return undefined;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

/**
 * Every expected screenshot exists at its device size, nothing else is there, and no two files
 * are the same image.
 * @param {string} directory
 */
export const validateScreenshotSet = (directory) => {
  const present = new Set(
    readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.png'))
  );
  const expected = new Set(APP_STORE_SCREENSHOT_SETS.flatMap((set) => set.filenames));
  /** @type {string[]} */
  const errors = [];

  const missing = [...expected].filter((name) => !present.has(name));
  if (missing.length > 0) errors.push(`Missing screenshots: ${missing.join(', ')}`);
  const unexpected = [...present].filter((name) => !expected.has(name));
  if (unexpected.length > 0) errors.push(`Unexpected screenshots: ${unexpected.join(', ')}`);

  /** @type {Map<string, string>} */
  const hashes = new Map();
  APP_STORE_SCREENSHOT_SETS.forEach(({ device, width, height, filenames }) => {
    filenames
      .filter((name) => present.has(name))
      .forEach((name) => {
        const bytes = readFileSync(path.join(directory, name));
        const size = pngSize(bytes);
        if (!size || size.width !== width || size.height !== height) {
          errors.push(`${name} (${device}) must be ${width} x ${height} pixels.`);
        }
        const hash = createHash('sha256').update(bytes).digest('hex');
        const duplicate = hashes.get(hash);
        if (duplicate) errors.push(`${name} is byte-identical to ${duplicate}.`);
        else hashes.set(hash, name);
      });
  });

  if (errors.length > 0) throw new Error(errors.join('\n'));
};

// `node scripts/appstore-release-preflight.mjs <screenshot directory>` checks the release that
// the APP_STORE_* variables describe.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  validateReleaseInput({
    appVersion: process.env.APP_STORE_VERSION,
    buildNumber: process.env.APP_STORE_BUILD_NUMBER,
    confirmation: process.env.APP_STORE_RELEASE_CONFIRMATION,
    releaseNotes: process.env.APP_STORE_RELEASE_NOTES,
  });
  if (process.argv[2]) validateScreenshotSet(path.resolve(process.argv[2]));
  process.stdout.write('App Store release preflight passed.\n');
}
