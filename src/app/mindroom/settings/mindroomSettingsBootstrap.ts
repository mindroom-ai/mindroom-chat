/**
 * CINNY-207 P6.1 / D4 (Commit 4): one-time localStorage scrub of the
 * legacy `paginationLimit` key.
 *
 * Must run BEFORE `state/settings.ts`'s module-scope `getSettings()`
 * reads the blob, so the settings atom initializes on a clean object.
 * Kept in this bootstrap module (NOT `mindroomSettings.ts`) so the
 * app entry can import + invoke it without transitively pulling in
 * `state/settings.ts` — importing `mindroomSettings.ts` would defeat
 * the "before init" guarantee.
 *
 * Idempotent: leaves storage untouched when the key is missing, when
 * the blob is malformed, when the environment lacks localStorage, and
 * when the write itself throws (quota errors are non-fatal — the
 * hydration path in `withMindroomSettings` still drops the field).
 *
 * D4 semantics: stored value is DROPPED, never mapped onto
 * `prefetchDepth`. The two settings have incompatible semantics (see
 * mindroomSettings.ts) and mapping the old value forward would give
 * users a silent behavior change on upgrade.
 */

export const LEGACY_MINDROOM_SETTINGS_STORAGE_KEY = 'settings';

export const dropLegacyMindroomSettings = (): void => {
  if (typeof localStorage === 'undefined') return;
  if (typeof localStorage.getItem !== 'function') return;
  if (typeof localStorage.setItem !== 'function') return;

  const raw = localStorage.getItem(LEGACY_MINDROOM_SETTINGS_STORAGE_KEY);
  if (raw === null) return;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    parsed = value as Record<string, unknown>;
  } catch {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, 'paginationLimit')) return;
  const { paginationLimit: _dropped, ...rest } = parsed;
  void _dropped;
  try {
    localStorage.setItem(LEGACY_MINDROOM_SETTINGS_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Quota errors on a scrub are non-fatal — hydration will still
    // drop `paginationLimit` via `withMindroomSettings`.
  }
};
