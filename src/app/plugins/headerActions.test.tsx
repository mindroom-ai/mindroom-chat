// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { Icons } from 'folds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { LocaleTree } from '../i18n/englishResources';
import type { HeaderAction } from './headerActions';
import type { RegisteredPlugin } from './registry';

const plugins = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('./pluginEntries', () => ({ pluginEntries: plugins.entries }));

const action = (fields: Partial<HeaderAction> = {}): HeaderAction => ({
  id: 'wave',
  label: 'wave',
  icon: Icons.Smile,
  run: vi.fn(),
  ...fields,
});

const plugin = (id: string, headerActions: HeaderAction[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions,
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
});

describe('usePluginHeaderActions', () => {
  beforeEach(async () => {
    vi.resetModules();
    // i18next keeps one instance for the process: each test sets up its own.
    vi.doMock('i18next', async (importOriginal) => {
      const actual = await importOriginal<typeof import('i18next')>();
      return { ...actual, default: actual.default.createInstance() };
    });
    vi.stubGlobal('fetch', async () => Response.json({}));
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.doUnmock('i18next');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the actions of the plugins config.json leaves on, each named <plugin>/<id>, in the menu by default, and logs a run that throws or rejects with the plugin's tag", async () => {
    const { usePluginHeaderActions } = await import('./headerActions');
    const failure = new Error('no');
    const thrown = action({
      id: 'throw',
      placement: 'auto',
      run: () => {
        throw failure;
      },
    });
    const rejected = action({ id: 'reject', run: () => Promise.reject(failure) });
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const { result } = renderHook(() =>
      usePluginHeaderActions(
        [
          plugin('off', [action()]),
          plugin('demo', [action(), thrown, rejected]),
          plugin('none', []),
        ],
        config
      )
    );
    expect(result.current.map(({ id, placement }) => [id, placement])).toEqual([
      ['demo/wave', 'menu'],
      ['demo/throw', 'auto'],
      ['demo/reject', 'menu'],
    ]);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    result.current[1]?.run({ roomId: '!room:example.org' });
    expect(logged).toHaveBeenCalledWith('[plugin demo@1.0.0] its header action failed', failure);
    logged.mockClear();
    result.current[2]?.run({ roomId: '!room:example.org' });
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('[plugin demo@1.0.0] its header action failed', failure)
    );
  });

  it("names the actions in the app's language, also with strings that arrive later", async () => {
    vi.stubGlobal('navigator', { language: 'de', languages: ['de'] });
    let release: () => void = () => undefined;
    const german = new Promise<LocaleTree>((resolve) => {
      release = () => resolve({ wave: 'Winken' });
    });
    plugins.entries.splice(0, plugins.entries.length, {
      id: 'demo',
      version: '1.0.0',
      plugin: {
        headerActions: [action()],
        translations: {
          en: { wave: 'Wave' },
          load: async (language: string) => (language === 'de' ? german : undefined),
        },
      },
    });
    const { default: i18n } = await import('../i18n/i18n');
    const { usePluginHeaderActions } = await import('./headerActions');
    const { registeredPlugins } = await import('./registry');
    const { result } = renderHook(() => usePluginHeaderActions(registeredPlugins, undefined));
    const labels = () => result.current.map(({ label }) => label);

    expect(labels()).toEqual(['Wave']);
    release();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(labels()).toEqual(['Winken']);

    await act(() => i18n.changeLanguage('en'));
    expect(labels()).toEqual(['Wave']);
  });
});
