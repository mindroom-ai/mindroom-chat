// @ts-check
// Maps a calendar release tag `vYYYY.M.N` (scripts/calver.mjs) to Android `versionCode` and
// `versionName`. Encodes `YYYY.M.N` as `(year - 2000) * 1_000_000 + month * 10_000 + n`, which
// stays strictly monotonic across n, month, and year rollovers and stays between the highest
// legacy Google Play versionCode (4_120_899) and Google Play's maximum (2_100_000_000).
import { pathToFileURL } from 'node:url';
import { formatVersion, parseReleaseTag } from './calver.mjs';

export const LEGACY_MAX_ANDROID_VERSION_CODE = 4_120_899;
export const MAX_PLAY_VERSION_CODE = 2_100_000_000;

const MIN_YEAR = 2026;
const MAX_YEAR = 4099;
const MAX_MONTHLY_RELEASE_INDEX = 9999;

/**
 * @typedef {{
 *   versionCode: number;
 *   versionName: string;
 * }} AndroidVersionMetadata
 */

/**
 * @param {string} tag
 * @returns {AndroidVersionMetadata}
 */
export const resolveAndroidVersionMetadata = (tag) => {
  const cleaned = typeof tag === 'string' ? tag.trim() : '';
  const parsed = parseReleaseTag(cleaned);
  if (!parsed) {
    throw new Error(`Release tag '${cleaned}' is not a valid calendar release tag vYYYY.M.N.`);
  }
  const { year, month, n } = parsed;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(
      `Release tag '${cleaned}' year ${year} is out of range (${MIN_YEAR}..${MAX_YEAR}).`
    );
  }
  if (n < 0 || n > MAX_MONTHLY_RELEASE_INDEX) {
    throw new Error(
      `Release tag '${cleaned}' release index ${n} is out of range (0..${MAX_MONTHLY_RELEASE_INDEX}).`
    );
  }
  const versionCode = (year - 2000) * 1_000_000 + month * 10_000 + n;
  if (versionCode <= LEGACY_MAX_ANDROID_VERSION_CODE || versionCode > MAX_PLAY_VERSION_CODE) {
    throw new Error(
      `Computed Android versionCode ${versionCode} for '${cleaned}' is outside (${LEGACY_MAX_ANDROID_VERSION_CODE}, ${MAX_PLAY_VERSION_CODE}].`
    );
  }
  return { versionCode, versionName: formatVersion(parsed) };
};

// `node scripts/android-ci-version.mjs <vYYYY.M.N>` prints `key=value` lines for `$GITHUB_OUTPUT`.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !args[0]?.trim()) {
      throw new Error('Usage: node scripts/android-ci-version.mjs <vYYYY.M.N>');
    }
    const { versionCode, versionName } = resolveAndroidVersionMetadata(args[0]);
    process.stdout.write(`version_code=${versionCode}\nversion_name=${versionName}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
