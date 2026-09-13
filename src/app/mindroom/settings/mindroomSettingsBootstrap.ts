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
 *
 * CINNY-207 P7.2 audit finding #4 — scrub-before-init guarantee is
 * enforced by MODULE EVALUATION, not by a statement in src/index.tsx.
 * ES module imports are hoisted: every static import in `index.tsx` —
 * including the transitive graph that reaches `state/settings.ts` via
 * `themeBootstrap` and `App` — evaluates before any top-level
 * statement runs. A `dropLegacyMindroomSettings()` CALL at the top of
 * `index.tsx` therefore ran AFTER `state/settings.ts`'s
 * `const baseSettings = atom(getSettings())` had already read the
 * pre-scrub blob. The atom then held the contaminated value for the
 * whole session, and any settings write via `settingsAtom` spread it
 * back to localStorage (the D4 invariant "stored legacy values are
 * dropped" never converged).
 *
 * Fix: run the scrub as a module-scope side effect at the bottom of
 * THIS file. `src/index.tsx` imports this module first (before
 * themeBootstrap, sessions, or App), and this module has no
 * transitive import of `state/settings.ts` (verified by the arch
 * test in `settingsExtensions.architecture.test.ts`), so evaluating
 * the scrub as a side effect guarantees it runs before the settings
 * atom initializes regardless of how imports are hoisted downstream.
 *
 * The `dropLegacyMindroomSettings` export is retained so the existing
 * unit tests can invoke it explicitly without relying on module
 * evaluation ordering inside a test runner.
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

// CINNY-207 P7.2 audit finding #4: module-scope side effect. See the
// header for why this MUST live inside module evaluation of this leaf
// module and cannot be a call from `src/index.tsx`.
dropLegacyMindroomSettings();
