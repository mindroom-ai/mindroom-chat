// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const entries = vi.hoisted(() => {
  const Component = (): null => null;
  const renderer = { match: () => true, Component };
  const panel = { id: 'notes', label: 'Notes', Component };
  const icon = () => null;
  const run = () => undefined;
  const action = { id: 'wave', label: 'wave', icon, run };
  const autoAction = { id: 'auto', label: 'auto', icon, run, placement: 'auto' };
  return {
    renderer,
    panel,
    actions: [action, autoAction],
    list: [
      {
        id: 'alpha',
        version: '1.0.0',
        plugin: {
          messageRenderers: 'not a list',
          sidePanels: 'not a list',
          headerActions: 'not a list',
        },
      },
      {
        id: 'beta',
        version: '2.1.0',
        plugin: {
          messageRenderers: [renderer, null, { Component }],
          sidePanels: [
            panel,
            null,
            { id: '', label: 'No id', Component },
            { id: 'unnamed', label: 1, Component },
            { id: 'empty', label: 'Empty' },
          ],
          headerActions: [
            action,
            null,
            { id: '', label: 'none', icon, run },
            { id: 'unnamed', label: 1, icon, run },
            { id: 'plain', label: 'plain', icon: 'Smile', run },
            { id: 'idle', label: 'idle', icon },
            { id: 'top', label: 'top', icon, run, placement: 'top' },
            // A phone's header keeps its row to Back, the name and the room menu.
            { id: 'row', label: 'row', icon, run, placement: 'row' },
            autoAction,
          ],
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
    // A side panel needs an id, a label and a component.
    expect(plugins[0]?.sidePanels).toEqual([]);
    expect(plugins[1]?.sidePanels).toEqual([entries.panel]);
    // A header action needs an id, a label, an icon, a run, and no placement, `auto` or `menu`.
    expect(plugins[0]?.headerActions).toEqual([]);
    expect(plugins[1]?.headerActions).toEqual(entries.actions);
  });

  it('is frozen when its module loads', async () => {
    const plugins = await loadRegistry();
    expect(Object.isFrozen(plugins)).toBe(true);
    for (const plugin of plugins) {
      expect(Object.isFrozen(plugin)).toBe(true);
      expect(Object.isFrozen(plugin.messageRenderers)).toBe(true);
      expect(Object.isFrozen(plugin.sidePanels)).toBe(true);
      expect(Object.isFrozen(plugin.headerActions)).toBe(true);
    }
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
