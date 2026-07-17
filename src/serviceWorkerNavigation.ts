const MAX_EXCLUDE_PATHS = 8;
const MAX_EXCLUDE_PATH_LENGTH = 256;
const NORMALIZATION_ORIGIN = 'https://service-worker.invalid';

export const NAVIGATION_FALLBACK_EXCLUDE_PARAM = 'navigation-fallback-exclude';
export const NON_DISRUPTIVE_UPDATE_PARAM = 'non-disruptive-update';
export const NAVIGATION_FETCH_TIMEOUT_MS = 5 * 1000;

export const normalizeNavigationFallbackExcludePaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const paths = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const path = candidate.trim();
    if (
      path.length === 0 ||
      path.length > MAX_EXCLUDE_PATH_LENGTH ||
      path === '/' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('?') ||
      path.includes('#') ||
      path.includes('\\')
    ) {
      continue;
    }

    const normalizedPath = new URL(path, NORMALIZATION_ORIGIN).pathname.replace(/\/+$/, '');
    if (normalizedPath.length === 0 || normalizedPath.length > MAX_EXCLUDE_PATH_LENGTH) continue;

    paths.add(normalizedPath);
    if (paths.size === MAX_EXCLUDE_PATHS) break;
  }
  return [...paths];
};

export const readNavigationFallbackExcludePaths = (scriptUrl: string): string[] => {
  try {
    const values = new URL(scriptUrl).searchParams.getAll(NAVIGATION_FALLBACK_EXCLUDE_PARAM);
    return normalizeNavigationFallbackExcludePaths(values);
  } catch {
    return [];
  }
};

export const navigationFallbackExcludePathPattern = (path: string): RegExp => {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPath}(?:/|\\?|$)`);
};

export const fetchNavigationWithShellFallback = async (
  request: Request,
  loadCachedShell: () => Promise<Response>,
  timeoutMs = NAVIGATION_FETCH_TIMEOUT_MS
): Promise<Response> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(request, {
      cache: 'no-store',
      signal: abortController.signal,
    });
    // Navigation requests use manual redirect mode. Returning the opaque
    // redirect lets the browser continue the navigation instead of replacing
    // a valid server redirect with the cached SPA shell.
    if (response.ok || response.type === 'opaqueredirect') return response;
  } catch {
    // Offline or stalled navigation falls through to the precached shell.
  } finally {
    clearTimeout(timeoutId);
  }
  return loadCachedShell();
};
