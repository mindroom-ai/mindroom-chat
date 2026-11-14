// @ts-check
// Builds the client config bundled into the iOS app: the shared web config
// (config/mindroom.json) with the iOS settings (config/mindroom.ios.json) merged over it, and
// optionally an operator's computer service URL.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Objects merge key by key; anything else in `override` replaces the base value.
 * @param {unknown} base
 * @param {unknown} override
 * @returns {unknown}
 */
const deepMerge = (base, override) => {
  if (!isRecord(base) || !isRecord(override)) return override === undefined ? base : override;
  /** @type {Record<string, unknown>} */
  const merged = { .../** @type {Record<string, unknown>} */ (base) };
  Object.entries(/** @type {Record<string, unknown>} */ (override)).forEach(([key, value]) => {
    merged[key] = deepMerge(merged[key], value);
  });
  return merged;
};

/**
 * @param {string} source the text of config/mindroom.json
 * @param {Record<string, unknown>} settings the iOS overrides
 * @param {string} [computerApiUrl] the computer service origin; an empty string clears the shared
 *   config's value, which the app reads as unset (it then uses the origin the room's agents publish)
 * @returns {string}
 */
export const iosClientConfig = (source, settings, computerApiUrl) => {
  const config = /** @type {Record<string, any>} */ (deepMerge(JSON.parse(source), settings));
  if (computerApiUrl !== undefined) {
    config.mindroom = {
      ...(config.mindroom ?? {}),
      computers: { ...(config.mindroom?.computers ?? {}), apiUrl: computerApiUrl.trim() },
    };
  }
  return `${JSON.stringify(config, null, 2)}\n`;
};

// `node scripts/ios-client-config.mjs <output>` writes the iOS config; MINDROOM_COMPUTER_API_URL
// selects the computer service.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = path.resolve(process.argv[2] ?? path.join(root, 'dist/config.json'));
  const source = readFileSync(path.join(root, 'config/mindroom.json'), 'utf8');
  const settings = JSON.parse(readFileSync(path.join(root, 'config/mindroom.ios.json'), 'utf8'));
  writeFileSync(output, iosClientConfig(source, settings, process.env.MINDROOM_COMPUTER_API_URL));
}
