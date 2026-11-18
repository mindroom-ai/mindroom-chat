// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsModalAtom } from '../navigation/settingsModal';
import type { RoomCommand } from '../navigation/roomCommands';
import { MessageLayout, settingsAtom } from '../preferences/settings';
import type { SettingsContext } from '../preferences/settingsRegistry';
import type { SettingsSearchValues } from '../settings/settingsSearchIndex';
import { THEMES, themePreviewAtom } from '../theme/useTheme';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { commandPaletteSearchConfig, matchCommandPaletteSection } from './commandPaletteSearch';
import type { CommandPaletteActionItem, Executable } from './commandPaletteTypes';
import { useCommandPaletteCommands } from './useCommandPaletteCommands';

const mocks = vi.hoisted(() => ({
  candidates: [] as { userId: string; displayName: string }[],
  /** What the deployment's call service discovery answered. */
  support: 'supported' as 'checking' | 'supported' | 'unsupported',
  /** The room whose call panel shows the active call, if any. */
  callShownIn: undefined as string | undefined,
  call: vi.fn(),
  roomCommands: [] as RoomCommand[],
  handlers: new Set<string>(),
  runShortcut: vi.fn(),
  changeLanguage: vi.fn(),
}));

const CONTEXT: SettingsContext = {
  native: false,
  nativeIOS: false,
  diagnostics: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: true,
  railButtons: { threads: true, explore: true, createSpace: true, search: true },
  macApp: false,
};

const SEARCH_VALUES: SettingsSearchValues = {
  userId: '@alice:example.org',
  username: 'alice',
  sendKey: 'Ctrl',
  shortcut: 'Ctrl+K',
};

vi.mock('react-i18next', async (importOriginal) => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  const i18n = { language: 'en', resolvedLanguage: 'en', changeLanguage: mocks.changeLanguage };
  return {
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: translateFromEn, i18n }),
  };
});
// A new object on every render, as the real hook returns.
vi.mock('../settings/useSettingsContext', () => ({
  useSettingsContext: () => ({ ...CONTEXT, railButtons: { ...CONTEXT.railButtons } }),
}));
vi.mock('../settings/useSettingsSearchValues', () => ({
  useSettingsSearchValues: () => SEARCH_VALUES,
}));
// The room's voice agents are the candidates given here; the rule for offering them is real.
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../calls/agent/agentPresence', () => ({ usePresenceStatuses: () => new Map() }));
vi.mock('../calls/agent/agentCallCandidates', () => ({
  getAgentCallCandidates: () => mocks.candidates,
  keepThreadSenders: (candidates: unknown[]) => candidates,
}));
vi.mock('../calls/callSupport', () => ({ useCallSupport: () => mocks.support }));
vi.mock('../calls/callStore', () => ({
  useActiveCall: () => mocks.callShownIn,
  isActiveCallShownIn: (shownIn: string | undefined, roomId: string) => shownIn === roomId,
}));
vi.mock('../calls/agent/agentCaller', () => ({
  useAgentCaller: () => ({ call: mocks.call }),
}));
vi.mock('../theme/useTheme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../theme/useTheme')>();
  return { ...actual, useChosenTheme: () => actual.MidnightTheme };
});
vi.mock('../navigation/roomCommands', () => ({ getRoomCommands: () => mocks.roomCommands }));
vi.mock('../shortcuts/useShortcut', () => ({
  hasShortcutHandler: (id: string) => mocks.handlers.has(id),
  runShortcut: mocks.runShortcut,
}));

const makeRoom = ({ callRoom = false } = {}) =>
  ({
    roomId: '!general:example.org',
    name: 'General',
    isCallRoom: () => callRoom,
  } as unknown as Room);

const render = ({
  room = makeRoom(),
  inRoom = true,
  threadId = '$thread' as string | undefined,
} = {}) => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => useCommandPaletteCommands({ room, inRoom, threadId }), {
    wrapper,
  });
  return { store, ...hook };
};

const find = (
  rows: readonly Executable<CommandPaletteActionItem>[],
  id: string
): Executable<CommandPaletteActionItem> => {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

/** The commands typed text finds, best first, as the palette searches them. */
const search = (
  commands: readonly Executable<CommandPaletteActionItem>[],
  text: string
): Executable<CommandPaletteActionItem>[] =>
  matchCommandPaletteSection({
    items: commands,
    query: text,
    config: { ...commandPaletteSearchConfig.actions, limit: 50 },
  }).map(({ item }) => item);

afterEach(() => {
  localStorage.clear();
  mocks.candidates = [];
  mocks.support = 'supported';
  mocks.callShownIn = undefined;
  mocks.roomCommands = [];
  mocks.handlers.clear();
  mocks.call.mockReset();
  mocks.runShortcut.mockReset();
  mocks.changeLanguage.mockReset();
});

describe('useCommandPaletteCommands settings', () => {
  it('flips a switch setting, and the row shows its new state', () => {
    const { store, result } = render();
    const before = store.get(settingsAtom).isMarkdown;
    const row = find(search(result.current.commands, 'markdown'), 'setting:markdown');
    expect(row.state).toBe(before ? 'on' : 'off');

    act(() => row.onSelect?.());

    expect(store.get(settingsAtom).isMarkdown).toBe(!before);
    expect(find(search(result.current.commands, 'markdown'), 'setting:markdown').state).toBe(
      before ? 'off' : 'on'
    );
  });

  it('opens Settings at a setting that is no switch', () => {
    const { store, result } = render();

    act(() => find(search(result.current.commands, 'page zoom'), 'setting:pageZoom').onSelect?.());

    expect(store.get(settingsModalAtom)).toEqual({
      initialPage: 'appearance',
      initialSetting: 'pageZoom',
      requestId: 'palette:pageZoom',
    });
  });
});

describe('useCommandPaletteCommands search', () => {
  // Without text the palette does not search the commands at all.
  const ids = (text: string) =>
    text.trim() ? search(render().result.current.commands, text).map((item) => item.id) : [];

  it.each(['john', 'lisa', 'emma'])('finds nothing for a name like %s', (name) => {
    expect(ids(name)).toEqual([]);
  });

  it('finds a setting with a typo in its name, and a name with one finds none', () => {
    expect(ids('markdwon')[0]).toBe('setting:markdown');
    expect(ids('jhon')).toEqual([]);
    expect(ids('emmma')).toEqual([]);
  });

  it('finds a setting and a choice by their names', () => {
    expect(ids('markdown')[0]).toBe('setting:markdown');
    expect(ids('dracula')).toContain('theme:dracula-theme');
  });

  it("finds a choice by its title alone, so the page's name finds only System Theme", () => {
    const themeChoices = ids('theme').filter((id) => id.startsWith('theme:'));
    expect(themeChoices).toEqual(['theme:system']);
  });
});

describe('useCommandPaletteCommands pages', () => {
  it('lists System Theme first, then every theme, the one showing now current', () => {
    const { result } = render();
    const { items } = result.current.pages.theme;

    expect(items.map((item) => item.id)).toEqual([
      'theme:system',
      ...THEMES.map((theme) => `theme:${theme.id}`),
    ]);
    expect(items.filter((item) => item.current).map((item) => item.id)).toEqual([
      'theme:midnight-theme',
    ]);
    expect(items[0]).toMatchObject({ title: 'System Theme', keepOpen: true });
    // Each row carries the page row's icon.
    expect(new Set(items.map((item) => item.icon))).toEqual(new Set([Icons.Sun]));
    const ranks = items.map((item) => item.sortRank ?? 0);
    expect(ranks).toEqual([...ranks].sort((left, right) => right - left));
  });

  it('makes a chosen theme the fixed one, and System Theme turns it on again', () => {
    const { store, result } = render();

    act(() => find(result.current.pages.theme.items, 'theme:dracula-theme').onSelect?.());

    expect(store.get(settingsAtom)).toMatchObject({
      themeId: 'dracula-theme',
      useSystemTheme: false,
    });
    expect(find(result.current.pages.theme.items, 'theme:system').state).toBe('off');

    act(() => find(result.current.pages.theme.items, 'theme:system').onSelect?.());

    expect(store.get(settingsAtom).useSystemTheme).toBe(true);
    expect(find(result.current.pages.theme.items, 'theme:system').state).toBe('on');
  });

  it('a theme row shows its theme for a look and takes it back, storing nothing', () => {
    const { store, result } = render();
    const before = store.get(settingsAtom);

    let undo: (() => void) | undefined;
    act(() => {
      undo = find(result.current.pages.theme.items, 'theme:dracula-theme').preview?.();
    });
    expect(store.get(themePreviewAtom)).toBe('dracula-theme');
    expect(store.get(settingsAtom)).toBe(before);

    act(() => undo?.());
    expect(store.get(themePreviewAtom)).toBeUndefined();
    // System Theme is a switch: it shows nothing until it is flipped.
    expect(find(result.current.pages.theme.items, 'theme:system').preview).toBeUndefined();
  });

  it('lists the three message layouts, and the check mark follows the stored one', () => {
    const { store, result } = render();
    const titles = () => result.current.pages['message-layout'].items.map((item) => item.title);
    expect(titles()).toEqual(['Modern', 'Compact', 'Bubble']);
    expect(new Set(result.current.pages['message-layout'].items.map((item) => item.icon))).toEqual(
      new Set([Icons.Message])
    );

    act(() =>
      find(
        result.current.pages['message-layout'].items,
        `message-layout:${MessageLayout.Bubble}`
      ).onSelect?.()
    );

    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Bubble);
    expect(
      result.current.pages['message-layout'].items
        .filter((item) => item.current)
        .map((item) => item.title)
    ).toEqual(['Bubble']);
  });

  it('lists every app language by its own name, and choosing one changes the language', () => {
    const { result } = render();
    const { items } = result.current.pages.language;

    expect(items).toHaveLength(17);
    expect(new Set(items.map((item) => item.icon))).toEqual(new Set([Icons.Globe]));
    // Each name is in its own language.
    expect(find(items, 'language:nl')).toMatchObject({ title: 'Nederlands', lang: 'nl' });
    expect(items.every((item) => item.lang === item.id.slice('language:'.length))).toBe(true);
    expect(items.filter((item) => item.current).map((item) => item.id)).toEqual(['language:en']);

    act(() => find(items, 'language:nl').onSelect?.());

    expect(mocks.changeLanguage).toHaveBeenCalledWith('nl');
  });

  it("finds a page's choices by typing, tagged with the page's title", () => {
    const { result } = render();

    expect(find(search(result.current.commands, 'dracula'), 'theme:dracula-theme').tag).toBe(
      result.current.pages.theme.title
    );
    expect(result.current.pages.theme.title).toBe('Theme');
  });

  it('keeps its lists while nothing they show changes', () => {
    const { result, rerender } = render();
    const { actions, commands, pages } = result.current;

    rerender();

    expect(result.current.actions).toBe(actions);
    expect(result.current.commands).toBe(commands);
    expect(result.current.pages).toBe(pages);
  });
});

describe('useCommandPaletteCommands agent calls', () => {
  const research = { userId: '@mindroom_research:example.org', displayName: 'Research' };

  it('offers a call to each voice agent of the open room, about the open thread', () => {
    mocks.candidates = [research];
    const room = makeRoom();
    const { result } = render({ room });
    const row = find(result.current.actions, `call-agent:${research.userId}`);

    expect(row).toMatchObject({
      title: 'Call Research',
      description: 'General',
      icon: Icons.Phone,
      sortRank: 75,
      keywords: ['voice', 'agent'],
    });
    act(() => row.onSelect?.());
    expect(mocks.call).toHaveBeenCalledWith({
      agentUserId: research.userId,
      displayName: 'Research',
      roomId: room.roomId,
      threadId: '$thread',
    });
  });

  it('offers no call without an open room, or in a call room', () => {
    mocks.candidates = [research];
    const ids = (options: Parameters<typeof render>[0]) =>
      render(options).result.current.actions.map((item) => item.id);

    expect(ids({ inRoom: false })).not.toContain(`call-agent:${research.userId}`);
    expect(ids({ room: makeRoom({ callRoom: true }) })).not.toContain(
      `call-agent:${research.userId}`
    );
  });

  it.each(['checking', 'unsupported'] as const)(
    'offers no call while the call service is %s, as the header offers none',
    (support) => {
      mocks.candidates = [research];
      mocks.support = support;

      expect(render().result.current.actions.map((item) => item.id)).not.toContain(
        `call-agent:${research.userId}`
      );
    }
  );

  it('offers no call while a call shows in the room, as the header offers none', () => {
    mocks.candidates = [research];
    mocks.callShownIn = makeRoom().roomId;

    expect(render().result.current.actions.map((item) => item.id)).not.toContain(
      `call-agent:${research.userId}`
    );
  });
});

describe('useCommandPaletteCommands room commands and shortcuts', () => {
  it("lists the open room's header commands, a toggle with its state, closing when chosen", () => {
    const run = vi.fn();
    mocks.roomCommands = [
      { id: 'viewSwitch', label: 'Compact view', pressed: true, icon: Icons.Message, run },
    ];
    const { result } = render();
    const row = find(result.current.actions, 'room-command:viewSwitch');

    expect(row).toMatchObject({
      title: 'Compact view',
      description: 'General',
      icon: Icons.Message,
      state: 'on',
      sortRank: 45,
    });
    expect(row.keepOpen).toBeUndefined();
    act(() => row.onSelect?.());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('lists no header command while no room is open', () => {
    mocks.roomCommands = [
      { id: 'viewSwitch', label: 'Compact view', pressed: true, icon: Icons.Message, run: vi.fn() },
    ];

    expect(render({ inRoom: false }).result.current.actions.map((item) => item.id)).not.toContain(
      'room-command:viewSwitch'
    );
  });

  it("runs the header's command as it is at that moment, and nothing once it is gone", () => {
    const opened = vi.fn();
    const now = vi.fn();
    const command = { id: 'viewSwitch', label: 'Compact view', icon: Icons.Message };
    mocks.roomCommands = [{ ...command, run: opened }];
    const { result } = render();
    const row = find(result.current.actions, 'room-command:viewSwitch');

    // Another room's header took the place of the one the palette opened over.
    mocks.roomCommands = [{ ...command, run: now }];
    act(() => row.onSelect?.());
    expect(opened).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledTimes(1);

    mocks.roomCommands = [];
    act(() => row.onSelect?.());
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('offers the steps to an unread room only while a room is unread', () => {
    mocks.handlers.add('nextUnread');
    mocks.handlers.add('previousUnread');
    const { result, store } = render();
    const ids = () => result.current.actions.map((item) => item.id);

    expect(ids()).not.toContain('shortcut:nextUnread');
    expect(ids()).not.toContain('shortcut:previousUnread');

    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!other:example.org', highlight: 0, total: 1 },
      })
    );
    expect(ids()).toContain('shortcut:nextUnread');
    expect(ids()).toContain('shortcut:previousUnread');
  });

  it('offers a shortcut as a command only while it has a handler', () => {
    expect(render().result.current.actions.map((item) => item.id)).not.toContain('shortcut:help');

    mocks.handlers.add('help');
    const row = find(render().result.current.actions, 'shortcut:help');

    expect(row).toMatchObject({ title: 'Show keyboard shortcuts', shortcut: 'help' });
    act(() => row.onSelect?.());
    expect(mocks.runShortcut).toHaveBeenCalledWith('help', expect.any(KeyboardEvent));
  });
});
