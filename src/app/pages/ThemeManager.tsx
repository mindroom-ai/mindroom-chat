import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  DarkTheme,
  LightTheme,
  ThemeContextProvider,
  ThemeKind,
  useActiveTheme,
  useSystemThemeKind,
} from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

const THEME_BG_COLORS: Record<string, string> = {
  'light-theme': '#F2F2F2',
  'silver-theme': '#DEDEDE',
  'dark-theme': '#1A1A1A',
  'butter-theme': '#1A1916',
};

function updateThemeMeta(themeId: string, kind: ThemeKind): void {
  const bgColor = THEME_BG_COLORS[themeId] ?? '#1A1A1A';
  const colorScheme = kind === ThemeKind.Dark ? 'dark' : 'light';

  document.documentElement.style.setProperty('--app-bg-color', bgColor);
  document.documentElement.style.backgroundColor = bgColor;
  document.body.style.backgroundColor = bgColor;

  const metaThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.content = bgColor;
  }

  const metaColorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (metaColorScheme) {
    metaColorScheme.content = colorScheme;
  }
}

export function UnAuthRouteThemeManager() {
  const systemThemeKind = useSystemThemeKind();

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    if (systemThemeKind === ThemeKind.Dark) {
      document.body.classList.add(...DarkTheme.classNames);
      updateThemeMeta(DarkTheme.id, DarkTheme.kind);
    }
    if (systemThemeKind === ThemeKind.Light) {
      document.body.classList.add(...LightTheme.classNames);
      updateThemeMeta(LightTheme.id, LightTheme.kind);
    }
  }, [systemThemeKind]);

  return null;
}

export function AuthRouteThemeManager({ children }: { children: ReactNode }) {
  const activeTheme = useActiveTheme();
  const [monochromeMode] = useSetting(settingsAtom, 'monochromeMode');

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);

    document.body.classList.add(...activeTheme.classNames);
    updateThemeMeta(activeTheme.id, activeTheme.kind);

    if (monochromeMode) {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = '';
    }
  }, [activeTheme, monochromeMode]);

  return <ThemeContextProvider value={activeTheme}>{children}</ThemeContextProvider>;
}
