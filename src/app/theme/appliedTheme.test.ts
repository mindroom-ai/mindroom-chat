// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppTheme, subscribeAppliedTheme } from './appliedTheme';
import { resolveInitialTheme } from './themeBootstrap';
import { MidnightTheme, SilverTheme } from './useTheme';

const root = document.documentElement;
const kindOnRoot = () => root.getAttribute('data-theme-kind');

describe('applyAppTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks the root element light or dark after the theme it applies', () => {
    applyAppTheme(MidnightTheme);
    expect(kindOnRoot()).toBe('dark');

    applyAppTheme(SilverTheme);
    expect(kindOnRoot()).toBe('light');
  });

  it('marks the root element for the startup theme as well', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    applyAppTheme(SilverTheme);

    applyAppTheme(resolveInitialTheme('/login/'));
    expect(root.classList.contains('dark-theme')).toBe(true);
    expect(kindOnRoot()).toBe('dark');
  });

  it('tells each subscriber the kind once the theme is on the page, until it unsubscribes', () => {
    applyAppTheme(SilverTheme);
    const heard: Array<[string, boolean, string | null]> = [];
    const unsubscribe = subscribeAppliedTheme((kind) => {
      heard.push([kind, root.classList.contains('midnight-theme'), kindOnRoot()]);
    });

    applyAppTheme(MidnightTheme);
    unsubscribe();
    applyAppTheme(SilverTheme);

    expect(heard).toEqual([['dark', true, 'dark']]);
  });
});
