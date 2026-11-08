// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { LocaleTree } from '../i18n/englishResources';
import type { SidePanel } from './sidePanels';

// The plugins' side panels as a room lists them: each `label` that is a key of its plugin's strings
// in the app's language, any other as the plugin gives it.

const plugins = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('./pluginEntries', () => ({ pluginEntries: plugins.entries }));

const panel = (id: string, label: string): SidePanel => ({ id, label, Component: () => null });

describe('usePluginSidePanels', () => {
  beforeEach(() => {
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
  });

  /** The panels of the build's plugins, as the hook gives them for `config`. */
  const renderPanels = async (config?: ClientConfig) => {
    const { usePluginSidePanels } = await import('./sidePanels');
    const { registeredPlugins } = await import('./registry');
    const hook = renderHook(() => usePluginSidePanels(registeredPlugins, config));
    const listed = () => hook.result.current.map(({ id, label, tag }) => [id, label, tag]);
    return { ...hook, listed };
  };

  it("lists the panels of the plugins config.json leaves on, named in the app's language, also with strings that arrive later", async () => {
    vi.stubGlobal('navigator', { language: 'de', languages: ['de'] });
    let release: () => void = () => undefined;
    const german = new Promise<LocaleTree>((resolve) => {
      release = () => resolve({ panel: 'Notizen' });
    });
    plugins.entries.splice(
      0,
      plugins.entries.length,
      {
        id: 'notes',
        version: '1.0.0',
        plugin: {
          sidePanels: [panel('panel', 'panel')],
          translations: {
            en: { panel: 'Notes' },
            load: async (language: string) => (language === 'de' ? german : undefined),
          },
        },
      },
      { id: 'off', version: '1.0.0', plugin: { sidePanels: [panel('panel', 'Off')] } }
    );
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const { default: i18n } = await import('../i18n/i18n');
    const { result, rerender, listed } = await renderPanels(config);

    expect(listed()).toEqual([['notes/panel', 'Notes', 'notes@1.0.0']]);
    release();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(listed()).toEqual([['notes/panel', 'Notizen', 'notes@1.0.0']]);
    // The same list while neither changes, so what depends on it keeps its identity.
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);

    await act(() => i18n.changeLanguage('en'));
    expect(listed()).toEqual([['notes/panel', 'Notes', 'notes@1.0.0']]);
  });

  it("shows a label that is no key of its plugin's strings exactly as given, separators and all", async () => {
    plugins.entries.splice(0, plugins.entries.length, {
      id: 'notes',
      version: '1.0.0',
      plugin: {
        sidePanels: [
          panel('draft', 'Notes: draft'),
          panel('version', 'v1.2 notes'),
          panel('board', 'Board'),
          panel('nested', 'names.panel'),
        ],
        translations: { en: { v1: { x: 'Not this' }, names: { panel: 'Nested notes' } } },
      },
    });
    const { listed } = await renderPanels();
    expect(listed().map(([, label]) => label)).toEqual([
      'Notes: draft',
      'v1.2 notes',
      'Board',
      'Nested notes',
    ]);
  });
});
