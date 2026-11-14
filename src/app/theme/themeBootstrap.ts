import { configClass, varsClass } from 'folds';
import {
  DarkTheme,
  LightTheme,
  THEMES,
  type Theme,
  type ThemeKind,
  deploymentDefaultTheme,
  effectiveThemeSettings,
  getThemeById,
} from './useTheme';
import { readCachedClientConfig } from '../config/ClientConfigLoader';
import { MINDROOM_SESSION_STORE_KEY } from '../lib/sessionStoreConfig';
import { syncNativeStatusBarTheme } from './statusBarTheme';
import { getSettings } from '../preferences/settings';

const UNAUTH_ROUTE_PATH_PATTERN = /(?:^|\/)(login|register|reset-password)(?:\/[^/]+)?\/?$/;

export type ResolvedTheme = {
  themeId: string;
  themeKind: ThemeKind;
  bgColor: string;
  scheme: ThemeKind;
  classNames: string[];
};

declare global {
  interface Window {
    __INITIAL_THEME__?: string;
  }
}

/** A theme as the document shows it. */
const resolveTheme = (theme: Theme): ResolvedTheme => ({
  themeId: theme.id,
  themeKind: theme.kind,
  bgColor: theme.pageColor,
  scheme: theme.kind,
  classNames: [configClass, varsClass, ...theme.classNames],
});

const stripSearchAndHash = (raw: string | undefined): string => {
  if (typeof raw !== 'string') return '';

  let normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex);
  }

  return normalized;
};

const pathLooksLikeUnauthRoute = (path: string | undefined): boolean =>
  typeof path === 'string' && UNAUTH_ROUTE_PATH_PATTERN.test(path);

const isUnauthRouteUrl = (pathname: string | undefined, hash: string | undefined): boolean =>
  pathLooksLikeUnauthRoute(stripSearchAndHash(pathname)) ||
  pathLooksLikeUnauthRoute(stripSearchAndHash(hash));

const prefersDarkMode = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

const hasActiveStoredSession = (): boolean => {
  try {
    if (
      typeof window === 'undefined' ||
      !window.localStorage ||
      typeof window.localStorage.getItem !== 'function'
    ) {
      return false;
    }

    const rawSessionStore = window.localStorage.getItem(MINDROOM_SESSION_STORE_KEY);
    if (!rawSessionStore) return false;

    const parsed = JSON.parse(rawSessionStore) as {
      sessions?: Array<{ sessionId?: unknown }>;
      activeSessionId?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') return false;

    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    if (sessions.length === 0) return false;

    const activeSessionId =
      typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : undefined;
    if (!activeSessionId) return false;

    return sessions.some((session) => session && session.sessionId === activeSessionId);
  } catch {
    return false;
  }
};

const resolveStoredThemeSettings = (deploymentTheme: Theme | undefined): ResolvedTheme => {
  const settings = effectiveThemeSettings(getSettings(), deploymentTheme);

  if (!settings.useSystemTheme) return resolveTheme(getThemeById(settings.themeId) ?? LightTheme);
  if (prefersDarkMode()) return resolveTheme(getThemeById(settings.darkThemeId) ?? DarkTheme);
  return resolveTheme(getThemeById(settings.lightThemeId) ?? LightTheme);
};

const setMetaContent = (name: string, content: string): void => {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (meta && meta.content !== content) {
    meta.content = content;
  }
};

// ISSUE-087: the startup theme, which src/index.tsx applies through applyAppTheme() before the
// app first renders. The deployment's default theme comes from the configuration this browser
// loaded last, as the app's first render has it (`deploymentThemeAtom`).
export const resolveInitialTheme = (
  pathname = typeof window !== 'undefined' ? window.location.pathname : undefined,
  hash = typeof window !== 'undefined' ? window.location.hash : undefined
): ResolvedTheme => {
  const deploymentTheme = deploymentDefaultTheme(readCachedClientConfig());
  if (isUnauthRouteUrl(pathname, hash) || !hasActiveStoredSession()) {
    return resolveTheme(deploymentTheme ?? (prefersDarkMode() ? DarkTheme : LightTheme));
  }

  const initialTheme =
    typeof window !== 'undefined' ? getThemeById(window.__INITIAL_THEME__) : undefined;
  return initialTheme ? resolveTheme(initialTheme) : resolveStoredThemeSettings(deploymentTheme);
};

export const applyThemeToDom = (theme: Pick<Theme, 'id'> | ResolvedTheme): void => {
  if (typeof document === 'undefined') return;

  const resolvedTheme = resolveTheme(
    getThemeById('themeId' in theme ? theme.themeId : theme.id) ?? DarkTheme
  );
  const html = document.documentElement;
  const body = document.body;

  if (!html || !body) return;

  body.className = '';
  body.classList.add(...resolvedTheme.classNames);

  html.classList.remove(...THEMES.map(({ id }) => id));
  html.classList.add(resolvedTheme.themeId);
  html.style.setProperty('--app-bg-color', resolvedTheme.bgColor);
  html.style.backgroundColor = resolvedTheme.bgColor;
  body.style.backgroundColor = resolvedTheme.bgColor;

  setMetaContent('theme-color', resolvedTheme.bgColor);
  setMetaContent('color-scheme', resolvedTheme.scheme);
  syncNativeStatusBarTheme(resolvedTheme.scheme);
};
