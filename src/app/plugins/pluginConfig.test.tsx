// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { accountSettingsAtom } from '../matrix/hooks/useAccountSettings';
import type { PluginEntry } from './pluginEntries';
import {
  isPluginEnabled,
  isPluginPreferredEnabled,
  usePluginClientConfig,
  usePluginConfig,
  withDisabledPlugins,
  withPluginPreferences,
} from './pluginConfig';

const mocks = vi.hoisted(() => ({
  plugins: [] as Pick<PluginEntry, 'id' | 'defaultEnabled'>[],
}));
vi.mock('./pluginEntries', () => ({ pluginEntries: mocks.plugins }));

afterEach(() => {
  mocks.plugins.length = 0;
});

/** A config.json with this `plugins` section. */
const withPlugins = (plugins: unknown): ClientConfig => ({ plugins }) as unknown as ClientConfig;

describe('isPluginEnabled', () => {
  it('turns a plugin off only where its section sets enabled to false', () => {
    expect(isPluginEnabled(undefined, 'example')).toBe(true);
    expect(isPluginEnabled({}, 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins('off'), 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins({ other: { enabled: false } }), 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins({ example: { label: 'Hi' } }), 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins({ example: { enabled: true } }), 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins({ example: { enabled: 'false' } }), 'example')).toBe(true);
    expect(isPluginEnabled(withPlugins({ example: { enabled: false } }), 'example')).toBe(false);
  });
});

describe('usePluginConfig', () => {
  it('reads the plugin its own section of the configuration the app shows', () => {
    let config = withPlugins({ example: { label: 'First' } });
    const { result, rerender } = renderHook(({ id }: { id: string }) => usePluginConfig(id), {
      initialProps: { id: 'example' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <ClientConfigProvider value={config}>{children}</ClientConfigProvider>
      ),
    });
    expect(result.current).toEqual({ label: 'First' });

    // A refreshed config.json reaches the plugin while the app runs.
    config = withPlugins({ example: { label: 'Second' } });
    rerender({ id: 'example' });
    expect(result.current).toEqual({ label: 'Second' });

    rerender({ id: 'other' });
    expect(result.current).toBeUndefined();
    // A valid plugin id that names a property every object inherits.
    rerender({ id: 'constructor' });
    expect(result.current).toBeUndefined();
  });

  it('reads nothing outside a configuration provider', () => {
    const { result } = renderHook(() => usePluginConfig('example'));
    expect(result.current).toBeUndefined();
  });
});

describe('withDisabledPlugins', () => {
  it('returns the exact same reference when disabledPlugins is empty', () => {
    const config = withPlugins({ example: { label: 'Hi' } });
    expect(withDisabledPlugins(undefined, [])).toBeUndefined();
    expect(withDisabledPlugins(config, [])).toBe(config);
  });

  it('disables listed plugins without mutating config or dropping other keys', () => {
    const original = {
      hashRouter: true,
      plugins: { example: { label: 'Hi', enabled: true }, other: { enabled: true } },
    } as unknown as ClientConfig;
    const updated = withDisabledPlugins(original, ['example', 'added']);

    expect(updated).not.toBe(original);
    expect(isPluginEnabled(original, 'example')).toBe(true);
    expect(isPluginEnabled(updated, 'example')).toBe(false);
    expect(isPluginEnabled(updated, 'added')).toBe(false);
    expect(isPluginEnabled(updated, 'other')).toBe(true);
    expect(updated).toEqual({
      hashRouter: true,
      plugins: {
        example: { label: 'Hi', enabled: false },
        other: { enabled: true },
        added: { enabled: false },
      },
    });
  });

  it('handles undefined config and non-record plugins section', () => {
    expect(isPluginEnabled(withDisabledPlugins(undefined, ['example']), 'example')).toBe(false);
    expect(isPluginEnabled(withDisabledPlugins(undefined, ['example']), 'other')).toBe(true);
    expect(isPluginEnabled(withDisabledPlugins(withPlugins('bad'), ['example']), 'example')).toBe(
      false
    );
  });
});

describe('isPluginPreferredEnabled', () => {
  it('applies precedence disabledPlugins > enabledPlugins > defaultEnabled', () => {
    const on = { id: 'on', defaultEnabled: true };
    const off = { id: 'off', defaultEnabled: false };
    const empty = { disabledPlugins: [], enabledPlugins: [] };

    expect(isPluginPreferredEnabled(on, empty)).toBe(true);
    expect(isPluginPreferredEnabled(off, empty)).toBe(false);
    expect(isPluginPreferredEnabled(off, { disabledPlugins: [], enabledPlugins: ['off'] })).toBe(
      true
    );
    expect(isPluginPreferredEnabled(on, { disabledPlugins: ['on'], enabledPlugins: [] })).toBe(
      false
    );
    expect(
      isPluginPreferredEnabled(off, { disabledPlugins: ['off'], enabledPlugins: ['off'] })
    ).toBe(false);
  });
});

describe('withPluginPreferences', () => {
  it('disables default-off plugins unless opted in and never overrides deployment enabled: false', () => {
    const plugins = [
      { id: 'example', defaultEnabled: true },
      { id: 'opt-in', defaultEnabled: false },
      { id: 'locked', defaultEnabled: false },
    ];
    const deployment = withPlugins({
      locked: { enabled: false },
      'opt-in': { label: 'Opt' },
    });

    const initial = withPluginPreferences(deployment, plugins, {
      disabledPlugins: [],
      enabledPlugins: [],
    });
    expect(isPluginEnabled(initial, 'example')).toBe(true);
    expect(isPluginEnabled(initial, 'opt-in')).toBe(false);
    expect(isPluginEnabled(initial, 'locked')).toBe(false);

    const optedIn = withPluginPreferences(deployment, plugins, {
      disabledPlugins: [],
      enabledPlugins: ['opt-in', 'locked'],
    });
    expect(optedIn).toBe(deployment);
    expect(isPluginEnabled(optedIn, 'opt-in')).toBe(true);
    expect(isPluginEnabled(optedIn, 'locked')).toBe(false);

    const disabledUnlisted = withPluginPreferences(deployment, [], {
      disabledPlugins: ['extra'],
      enabledPlugins: [],
    });
    expect(isPluginEnabled(disabledUnlisted, 'extra')).toBe(false);
  });
});

describe('usePluginClientConfig', () => {
  it('reacts live to accountSettingsAtom disabledPlugins and enabledPlugins updates', () => {
    mocks.plugins.push(
      { id: 'example', defaultEnabled: true },
      { id: 'opt-in', defaultEnabled: false },
      { id: 'locked', defaultEnabled: false }
    );
    const store = createStore();
    const deploymentConfig = withPlugins({ locked: { enabled: false }, example: { label: 'Hi' } });
    const { result } = renderHook(() => usePluginClientConfig(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <ClientConfigProvider value={deploymentConfig}>{children}</ClientConfigProvider>
        </Provider>
      ),
    });

    expect(isPluginEnabled(result.current, 'example')).toBe(true);
    expect(isPluginEnabled(result.current, 'opt-in')).toBe(false);
    expect(isPluginEnabled(result.current, 'locked')).toBe(false);

    act(() => {
      store.set(accountSettingsAtom, {
        disabledPlugins: ['example'],
        enabledPlugins: ['opt-in', 'locked'],
      });
    });
    expect(isPluginEnabled(result.current, 'example')).toBe(false);
    expect(isPluginEnabled(result.current, 'opt-in')).toBe(true);
    expect(isPluginEnabled(result.current, 'locked')).toBe(false);

    act(() => {
      store.set(accountSettingsAtom, {
        disabledPlugins: [],
        enabledPlugins: ['opt-in', 'locked'],
      });
    });
    expect(result.current).toBe(deploymentConfig);
    expect(isPluginEnabled(result.current, 'example')).toBe(true);
    expect(isPluginEnabled(result.current, 'opt-in')).toBe(true);
    expect(isPluginEnabled(result.current, 'locked')).toBe(false);
  });
});
