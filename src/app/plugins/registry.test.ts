// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// The registry as this file's load built it, at the default address.
import { registeredPlugins } from './registry';

const entries = vi.hoisted(() => {
  const Component = (): null => null;
  const renderer = { match: () => true, Component };
  const icon = () => null;
  const panel = { id: 'notes', label: 'Notes', Component };
  const autoPanel = { id: 'tasks', label: 'Tasks', Component, icon, placement: 'auto' };
  const run = () => undefined;
  const action = { id: 'wave', label: 'wave', icon, run };
  const autoAction = { id: 'auto', label: 'auto', icon, run, placement: 'auto' };
  const command = { name: 'greet', description: 'greet', run };
  const roomAction = { id: 'about', label: 'about', icon, run };
  const spacesAction = { ...roomAction, id: 'spaces', shows: () => true };
  const criticalAction = { ...roomAction, id: 'remove', critical: true };
  const banner = (): null => null;
  const headerSlot = [banner];
  const cover = { covers: () => false, subscribe: () => () => undefined, Component };
  const forgotten: string[] = [];
  const page = { path: 'board', Component: (): null => null };
  return {
    renderer,
    page,
    forgotten,
    panels: [panel, autoPanel],
    actions: [action, autoAction],
    command,
    roomActions: [roomAction, spacesAction, criticalAction],
    banner,
    headerSlot,
    cover,
    list: [
      {
        id: 'alpha',
        version: '1.0.0',
        plugin: {
          messageRenderers: 'not a list',
          pages: {},
          sidePanels: 'not a list',
          headerActions: 'not a list',
          slashCommands: 'not a list',
          roomActions: roomAction,
          roomHeaderSlot: banner,
          conversationCovers: cover,
          forgetAccount: 'not a function',
        },
      },
      {
        id: 'beta',
        version: '2.1.0',
        plugin: {
          messageRenderers: [renderer, null, { Component }],
          pages: [page, null, { path: 'other' }, { path: 7, Component: (): null => null }],
          sidePanels: [
            panel,
            null,
            { id: '', label: 'No id', Component },
            { id: 'unnamed', label: 1, Component },
            { id: 'empty', label: 'Empty' },
            { id: 'plain', label: 'Plain', Component, icon: 'Bulb' },
            // Its toggle, like a plugin's header action, stays off a phone's header row.
            { id: 'row', label: 'Row', Component, placement: 'row' },
            autoPanel,
          ],
          headerActions: [
            action,
            null,
            { id: '', label: 'none', icon, run },
            { id: 'unnamed', label: 1, icon, run },
            { id: 'plain', label: 'plain', icon: 'Smile', run },
            { id: 'idle', label: 'idle', icon },
            // A phone's header keeps its row to Back, the name and the room menu.
            { id: 'row', label: 'row', icon, run, placement: 'row' },
            autoAction,
          ],
          slashCommands: [
            command,
            null,
            { name: '', description: 'none', run },
            // The composer reads a command's name as letters a to z only.
            { name: 'Greet', description: 'upper', run },
            { name: 'greet-all', description: 'dash', run },
            { name: 'wave', description: 2, run },
            { name: 'idle', description: 'idle' },
          ],
          roomActions: [
            roomAction,
            null,
            { ...roomAction, id: '' },
            { ...roomAction, label: 1 },
            { ...roomAction, icon: 'Info' },
            { ...roomAction, run: undefined },
            { ...roomAction, shows: true },
            { ...roomAction, critical: 'yes' },
            { ...roomAction, critical: false },
            spacesAction,
            criticalAction,
          ],
          roomHeaderSlot: headerSlot,
          conversationCovers: [
            cover,
            null,
            { ...cover, covers: true },
            { ...cover, subscribe: undefined },
            { ...cover, Component: undefined },
            { ...cover, close: 'not a function' },
          ],
          forgotten,
          // A method of the plugin object, which it calls with the plugin as `this`.
          forgetAccount(this: { forgotten: string[] }, userId: string) {
            this.forgotten.push(userId);
          },
        },
      },
    ],
  };
});
vi.mock('./pluginEntries', () => ({ pluginEntries: entries.list }));

/** The registry as a fresh page load builds it, at the address a case set. */
const loadRegistry = async () => (await import('./registry')).registeredPlugins;

afterEach(() => {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
});

describe('registeredPlugins', () => {
  it("lists the build's plugins in their order, tagged with id and version", async () => {
    const plugins = registeredPlugins;
    expect(plugins.map(({ id, tag }) => [id, tag])).toEqual([
      ['alpha', 'alpha@1.0.0'],
      ['beta', 'beta@2.1.0'],
    ]);
    // A contribution that is not a list counts as none, and so does a renderer without `match`.
    expect(plugins[0]?.messageRenderers).toEqual([]);
    expect(plugins[1]?.messageRenderers).toEqual([entries.renderer]);
    // So does a page without a path or a component.
    expect(plugins[0]?.pages).toEqual([]);
    expect(plugins[1]?.pages).toEqual([entries.page]);
    // A side panel needs an id, a label, a component, and no icon or one folds draws, and no
    // placement, `auto` or `menu`.
    expect(plugins[0]?.sidePanels).toEqual([]);
    expect(plugins[1]?.sidePanels).toEqual(entries.panels);
    // A header action needs an id, a label, an icon, a run, and no placement, `auto` or `menu`.
    expect(plugins[0]?.headerActions).toEqual([]);
    expect(plugins[1]?.headerActions).toEqual(entries.actions);
    // A slash command needs a name of letters a to z, a description and a run.
    expect(plugins[0]?.slashCommands).toEqual([]);
    expect(plugins[1]?.slashCommands).toEqual([entries.command]);
    // A room action needs an id, a label, an icon and a run, its shows is a function, and its
    // critical is `true` or absent.
    expect(plugins[0]?.roomActions).toEqual([]);
    expect(plugins[1]?.roomActions).toEqual(entries.roomActions);
    expect(plugins[0]?.roomHeaderSlot).toEqual([]);
    expect(plugins[1]?.roomHeaderSlot).toEqual([entries.banner]);
    // A cover needs its condition, a subscription and a component, and Escape's close is a function.
    expect(plugins[0]?.conversationCovers).toEqual([]);
    expect(plugins[1]?.conversationCovers).toEqual([entries.cover]);
    // So does a `forgetAccount` that is not a function.
    expect(plugins[0]?.forgetAccount).toBeUndefined();
    await plugins[1]?.forgetAccount?.('@alice:example.org');
    expect(entries.forgotten).toEqual(['@alice:example.org']);
  });

  it('is frozen when its module loads', () => {
    const plugins = registeredPlugins;
    expect(Object.isFrozen(plugins)).toBe(true);
    for (const plugin of plugins) {
      expect(Object.isFrozen(plugin)).toBe(true);
      expect(Object.isFrozen(plugin.messageRenderers)).toBe(true);
      expect(Object.isFrozen(plugin.pages)).toBe(true);
      expect(Object.isFrozen(plugin.sidePanels)).toBe(true);
      expect(Object.isFrozen(plugin.headerActions)).toBe(true);
      expect(Object.isFrozen(plugin.slashCommands)).toBe(true);
      expect(Object.isFrozen(plugin.roomActions)).toBe(true);
      expect(Object.isFrozen(plugin.roomHeaderSlot)).toBe(true);
      expect(Object.isFrozen(plugin.conversationCovers)).toBe(true);
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
