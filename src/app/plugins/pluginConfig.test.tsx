// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { isPluginEnabled, usePluginConfig } from './pluginConfig';

/** A config.json with this `plugins` section. */
const withPlugins = (plugins: unknown): ClientConfig => ({ plugins } as unknown as ClientConfig);

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
