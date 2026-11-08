// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { LocaleTree } from '../i18n/englishResources';
import type { RegisteredPlugin } from './registry';
import type { PluginSlashCommand } from './slashCommands';

const plugins = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('./pluginEntries', () => ({ pluginEntries: plugins.entries }));

const command = (fields: Partial<PluginSlashCommand> = {}): PluginSlashCommand => ({
  name: 'greet',
  description: 'greet',
  run: vi.fn(),
  ...fields,
});

const plugin = (id: string, slashCommands: PluginSlashCommand[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands,
});

const room = { roomId: '!room:example.org' } as Room;

describe('usePluginSlashCommands', () => {
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

  it('lists the commands of the plugins config.json leaves on, each run with the room and the text after its name', async () => {
    const { usePluginSlashCommands } = await import('./slashCommands');
    const greet = command();
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const { result } = renderHook(() =>
      usePluginSlashCommands(
        [
          plugin('off', [command({ name: 'hidden' })]),
          plugin('demo', [greet, command({ name: 'wave', description: 'wave' })]),
          plugin('none', []),
        ],
        config
      )
    );
    expect(result.current.map(({ name }) => name)).toEqual(['greet', 'wave']);

    await result.current[0]?.run(room, 'hello  there');
    expect(greet.run).toHaveBeenCalledWith({ room, args: 'hello  there' });
  });

  it('refuses a name two plugins both claim, for both, and warns about it once', async () => {
    const { usePluginSlashCommands } = await import('./slashCommands');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = command();
    const second = command();
    const { result, rerender } = renderHook(
      ({ config }: { config?: ClientConfig }) =>
        usePluginSlashCommands(
          [plugin('one', [first, command({ name: 'solo' })]), plugin('two', [second])],
          config
        ),
      { initialProps: {} }
    );
    expect(result.current.map(({ name }) => name)).toEqual(['solo']);

    rerender({ config: { plugins: {} } as unknown as ClientConfig });
    expect(result.current.map(({ name }) => name)).toEqual(['solo']);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(
      '[plugins one@1.0.0, two@1.0.0] each add the slash command /greet, so none runs it'
    );
  });

  it('turns a command that throws into one that rejects, as the composer shows its error', async () => {
    const { usePluginSlashCommands } = await import('./slashCommands');
    const failure = new Error('no greeting');
    const throwing = command({
      run: () => {
        throw failure;
      },
    });
    const { result } = renderHook(() =>
      usePluginSlashCommands([plugin('demo', [throwing])], undefined)
    );
    await expect(result.current[0]?.run(room, '')).rejects.toBe(failure);
  });

  it("describes the commands in the app's language, also with strings that arrive later", async () => {
    vi.stubGlobal('navigator', { language: 'de', languages: ['de'] });
    let release: () => void = () => undefined;
    const german = new Promise<LocaleTree>((resolve) => {
      release = () => resolve({ greet: 'Grüßt' });
    });
    plugins.entries.splice(0, plugins.entries.length, {
      id: 'demo',
      version: '1.0.0',
      plugin: {
        slashCommands: [command()],
        translations: {
          en: { greet: 'Greets' },
          load: async (language: string) => (language === 'de' ? german : undefined),
        },
      },
    });
    const { default: i18n } = await import('../i18n/i18n');
    const { usePluginSlashCommands } = await import('./slashCommands');
    const { registeredPlugins } = await import('./registry');
    const { result } = renderHook(() => usePluginSlashCommands(registeredPlugins, undefined));
    const descriptions = () => result.current.map(({ description }) => description);

    expect(descriptions()).toEqual(['Greets']);
    release();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(descriptions()).toEqual(['Grüßt']);

    await act(() => i18n.changeLanguage('en'));
    expect(descriptions()).toEqual(['Greets']);
  });
});
