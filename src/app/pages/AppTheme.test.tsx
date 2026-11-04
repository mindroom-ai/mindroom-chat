// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DarkTheme, LightTheme, MidnightTheme, SilverTheme, useTheme } from '../hooks/useTheme';
import { getSettings, settingsAtom } from '../state/settings';
import { putSession, removeSession } from '../state/sessions';
import { applyThemeToDom } from '../theme/themeBootstrap';
import { AppTheme } from './App';

vi.mock('../../colors.css', () => ({
  lightTheme: 'light-palette',
  silverTheme: 'silver-palette',
  darkTheme: 'dark-palette',
  midnightTheme: 'midnight-palette',
  butterTheme: 'butter-palette',
}));

vi.mock('../theme/themeBootstrap', () => ({
  applyThemeToDom: vi.fn(),
}));

vi.mock('./Router', () => ({
  createRouter: vi.fn(),
}));

vi.mock('../components/ClientConfigLoader', () => ({
  ClientConfigLoader: () => null,
}));

vi.mock('../mindroom/notices/NoticeBanners', () => ({
  NoticeLayout: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../components/app-update/NewVersionNotice', () => ({
  NewVersionNotice: () => null,
}));

vi.mock('../components/app-error/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('./ConfigConfig', () => ({
  ConfigConfigError: () => null,
  ConfigConfigLoading: () => null,
}));

/** A `prefers-color-scheme: dark` query whose answer the test changes. */
const installColorScheme = (dark: boolean) => {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
  return (nextDark: boolean) => {
    dark = nextDark;
    listeners.forEach((listener) => listener());
  };
};

function ProvidedTheme() {
  return <div data-theme={useTheme().id} />;
}

const renderTheme = (store = createStore()): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <JotaiProvider store={store}>
        <AppTheme>
          <ProvidedTheme />
        </AppTheme>
      </JotaiProvider>
    );
  });
  return renderer;
};

const providedTheme = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.props['data-theme'] !== undefined).props['data-theme'];

const lastApplied = () => vi.mocked(applyThemeToDom).mock.calls.at(-1)?.[0];

const signIn = () =>
  putSession({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    deviceId: 'DEVICE',
    accessToken: 'token',
  });

describe('AppTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(applyThemeToDom).mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('applies a changed theme setting without a reload', () => {
    installColorScheme(false);
    signIn();
    const store = createStore();
    store.set(settingsAtom, { ...getSettings(), useSystemTheme: false, themeId: DarkTheme.id });
    const renderer = renderTheme(store);
    expect(lastApplied()).toBe(DarkTheme);
    expect(providedTheme(renderer)).toBe(DarkTheme.id);

    act(() => {
      store.set(settingsAtom, { ...store.get(settingsAtom), themeId: SilverTheme.id });
    });
    expect(lastApplied()).toBe(SilverTheme);
    expect(providedTheme(renderer)).toBe(SilverTheme.id);
  });

  it('follows the system switching between light and dark', () => {
    const changeScheme = installColorScheme(false);
    signIn();
    const store = createStore();
    store.set(settingsAtom, {
      ...getSettings(),
      useSystemTheme: true,
      darkThemeId: MidnightTheme.id,
    });
    renderTheme(store);
    expect(lastApplied()).toBe(LightTheme);

    act(() => changeScheme(true));
    expect(lastApplied()).toBe(MidnightTheme);
  });

  it('uses the system theme signed out and the settings theme once signed in', () => {
    installColorScheme(true);
    const store = createStore();
    store.set(settingsAtom, { ...getSettings(), useSystemTheme: false, themeId: SilverTheme.id });
    const renderer = renderTheme(store);
    expect(lastApplied()).toBe(DarkTheme);

    let sessionId = '';
    act(() => {
      sessionId = signIn().sessionId;
    });
    expect(lastApplied()).toBe(SilverTheme);
    expect(providedTheme(renderer)).toBe(SilverTheme.id);

    act(() => {
      removeSession(sessionId);
    });
    expect(lastApplied()).toBe(DarkTheme);
  });
});
