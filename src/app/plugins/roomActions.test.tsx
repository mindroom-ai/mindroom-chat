// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { LocaleTree } from '../i18n/englishResources';
import type { RegisteredPlugin } from './registry';
import type { PluginRoomAction } from './roomActions';

const plugins = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('./pluginEntries', () => ({ pluginEntries: plugins.entries }));

const action = (fields: Partial<PluginRoomAction> = {}): PluginRoomAction => ({
  id: 'about',
  label: 'about',
  icon: Icons.Info,
  run: vi.fn(),
  ...fields,
});

const plugin = (id: string, roomActions: PluginRoomAction[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions,
});

const room = { roomId: '!room:example.org', isSpaceRoom: () => false } as unknown as Room;

describe('usePluginRoomActions', () => {
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

  it("lists the entries of the plugins config.json leaves on, in build order, each named <plugin>/<id>, for the rooms their shows takes; a shows that throws leaves out only its entry, logged with the plugin's tag", async () => {
    const { usePluginRoomActions } = await import('./roomActions');
    const failure = new Error('no');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const { result } = renderHook(() =>
      usePluginRoomActions(
        [
          plugin('off', [action()]),
          plugin('demo', [
            action(),
            action({ id: 'spaces', shows: (shown) => shown.isSpaceRoom() }),
            action({
              id: 'broken',
              shows: () => {
                throw failure;
              },
            }),
            action({ id: 'rooms', shows: (shown) => !shown.isSpaceRoom() }),
          ]),
          plugin('none', []),
          plugin('later', [action()]),
        ],
        config,
        room
      )
    );
    expect(result.current.map(({ id, tag }) => [id, tag])).toEqual([
      ['demo/about', 'demo@1.0.0'],
      ['demo/rooms', 'demo@1.0.0'],
      ['later/about', 'later@1.0.0'],
    ]);
    expect(logged).toHaveBeenCalledWith(
      "[plugin demo@1.0.0] its room action's shows failed",
      failure
    );
  });

  it("runs an entry on the menu's room with the dialog it was given, and logs a run that throws or rejects with the plugin's tag", async () => {
    const { usePluginRoomActions } = await import('./roomActions');
    const failure = new Error('no');
    const run = vi.fn();
    const { result } = renderHook(() =>
      usePluginRoomActions(
        [
          plugin('demo', [
            action({ run }),
            action({
              id: 'throw',
              run: () => {
                throw failure;
              },
            }),
            action({ id: 'reject', run: () => Promise.reject(failure) }),
          ]),
        ],
        undefined,
        room
      )
    );
    const showDialog = vi.fn();
    result.current[0]?.run(showDialog);
    expect(run).toHaveBeenCalledWith({ room, showDialog });

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    result.current[1]?.run(showDialog);
    expect(logged).toHaveBeenCalledWith('[plugin demo@1.0.0] its room action failed', failure);
    logged.mockClear();
    result.current[2]?.run(showDialog);
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('[plugin demo@1.0.0] its room action failed', failure)
    );
  });

  it("names the entries in the app's language, also with strings that arrive later", async () => {
    vi.stubGlobal('navigator', { language: 'de', languages: ['de'] });
    let release: () => void = () => undefined;
    const german = new Promise<LocaleTree>((resolve) => {
      release = () => resolve({ about: 'Über diesen Raum' });
    });
    plugins.entries.splice(0, plugins.entries.length, {
      id: 'demo',
      version: '1.0.0',
      plugin: {
        roomActions: [action()],
        translations: {
          en: { about: 'About this room' },
          load: async (language: string) => (language === 'de' ? german : undefined),
        },
      },
    });
    const { default: i18n } = await import('../i18n/i18n');
    const { usePluginRoomActions } = await import('./roomActions');
    const { registeredPlugins } = await import('./registry');
    const { result } = renderHook(() => usePluginRoomActions(registeredPlugins, undefined, room));
    const labels = () => result.current.map(({ label }) => label);

    expect(labels()).toEqual(['About this room']);
    release();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(labels()).toEqual(['Über diesen Raum']);

    await act(() => i18n.changeLanguage('en'));
    expect(labels()).toEqual(['About this room']);
  });
});
