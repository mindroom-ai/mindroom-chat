// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const entries = vi.hoisted(() => {
  const renderer = { match: () => true, Component: (): null => null };
  const banner = (): null => null;
  const headerSlot = [banner];
  return {
    renderer,
    banner,
    headerSlot,
    list: [
      {
        id: 'alpha',
        version: '1.0.0',
        plugin: { messageRenderers: 'not a list', roomHeaderSlot: banner },
      },
      {
        id: 'beta',
        version: '2.1.0',
        plugin: {
          messageRenderers: [renderer, null, { Component: (): null => null }],
          roomHeaderSlot: headerSlot,
        },
      },
    ],
  };
});
vi.mock('./pluginEntries', () => ({ pluginEntries: entries.list }));

/** The registry as a fresh page load builds it. */
const loadRegistry = async () => (await import('./registry')).registeredPlugins;

afterEach(() => {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
});

describe('registeredPlugins', () => {
  it("lists the build's plugins in their order, tagged with id and version", async () => {
    const plugins = await loadRegistry();
    expect(plugins.map(({ id, tag }) => [id, tag])).toEqual([
      ['alpha', 'alpha@1.0.0'],
      ['beta', 'beta@2.1.0'],
    ]);
    // A contribution that is not a list counts as none, and so does a renderer without `match`.
    expect(plugins[0]?.messageRenderers).toEqual([]);
    expect(plugins[1]?.messageRenderers).toEqual([entries.renderer]);
    expect(plugins[0]?.roomHeaderSlot).toEqual([]);
    expect(plugins[1]?.roomHeaderSlot).toEqual([entries.banner]);
  });

  it('is frozen when its module loads', async () => {
    const plugins = await loadRegistry();
    expect(Object.isFrozen(plugins)).toBe(true);
    for (const plugin of plugins) {
      expect(Object.isFrozen(plugin)).toBe(true);
      expect(Object.isFrozen(plugin.messageRenderers)).toBe(true);
      expect(Object.isFrozen(plugin.roomHeaderSlot)).toBe(true);
    }
    // The plugin's own list stays as it was.
    expect(Object.isFrozen(entries.headerSlot)).toBe(false);
  });

  it('lists none for a load whose address says ?plugins=off', async () => {
    window.history.replaceState(null, '', '/login/?plugins=off');
    expect(await loadRegistry()).toEqual([]);
  });

  it('keeps the plugins for another value of the parameter', async () => {
    window.history.replaceState(null, '', '/?plugins=on');
    expect(await loadRegistry()).toHaveLength(2);
  });
});
