// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { clearToolCallOverrides } from '../messages/toolCallVisibility';
import { getSettings, settingsAtom } from '../preferences/settings';
import { MenuEntry } from '../ui/MenuEntry';
import { getSpaceSearchPath, withSearchParam } from '../routes/pathUtils';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { registerPluginTranslations } from '../plugins/pluginTranslations';
import type { RegisteredPlugin } from '../plugins/registry';
import type { PluginRoomAction } from '../plugins/roomActions';
import { ROOM_ACTIONS } from './roomActions';
import { RoomActionsMenu, useRoomActionDialog } from './RoomActionsMenu';

const SESSION = 'me-session';

const state = vi.hoisted(() => ({
  canInvite: true,
  canListRooms: true,
  encrypted: false,
  notificationMode: 'unset',
  notificationChanging: false,
  members: [] as Array<{ userId: string; membership: string }>,
  navigate: vi.fn(),
  openSettings: vi.fn(),
  sendStateEvent: vi.fn(() => Promise.resolve({})),
  removeSpaceChild: vi.fn(() => Promise.resolve()),
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  rooms: {} as Record<string, unknown>,
  plugins: [] as RegisteredPlugin[],
  reportBoundaryError: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => state.navigate,
}));
vi.mock('../spaces/lobby/spaceChildren', () => ({
  removeSpaceChild: state.removeSpaceChild,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:example.org',
    getRoom: (roomId: string) => state.rooms[roomId] ?? null,
    sendStateEvent: state.sendStateEvent,
  }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/session/useSessionStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/session/useSessionStore')>()),
  useActiveSession: () => ({ sessionId: SESSION }),
}));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => state.canInvite,
    event: () => false,
    stateEvent: (type: string) => type === 'm.space.child' && state.canListRooms,
  }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({
  useStateEvent: () => (state.encrypted ? {} : undefined),
}));
vi.mock('../matrix/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/matrix')>()),
  getCanonicalAliasOrRoomId: (_client: unknown, roomId: string) => roomId,
  isRoomAlias: () => false,
}));
vi.mock('../navigation/useRoomSettingsState', () => ({
  useOpenRoomSettings: () => state.openSettings,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => state.notificationMode,
  getRoomNotificationModeIcon: () => Icons.Bell,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
// The rows that need the app's stores stand in as plain rows with their labels.
vi.mock('../notifications/MarkRoomReadMenuItem', async () => {
  const { MenuEntry: Row } = await import('../ui/MenuEntry');
  const { Icons: icons } = await import('folds');
  return {
    MarkRoomReadMenuItem: () => (
      <Row label="Mark as Read" icon={icons.Check} onSelect={() => undefined} />
    ),
  };
});
vi.mock('../rooms/archive/ArchiveRoomMenuItem', async () => {
  const { MenuEntry: Row } = await import('../ui/MenuEntry');
  const { Icons: icons } = await import('folds');
  return {
    ArchiveRoomMenuItem: () => (
      <Row label="Archive Room" icon={icons.Check} onSelect={() => undefined} />
    ),
  };
});
vi.mock('../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: ({
    children,
  }: {
    children: (open: () => void, opened: boolean, changing: boolean) => React.ReactNode;
  }) => children(vi.fn(), false, state.notificationChanging),
}));
vi.mock('../members/invite/InviteUserPrompt', () => ({
  InviteUserPrompt: () => <div role="dialog" aria-label="Invite" />,
}));
vi.mock('../rooms/LeaveRoomPrompt', () => ({
  LeaveRoomPrompt: ({ onLeft }: { onLeft: () => void }) => (
    <div role="dialog" aria-label="Leave Room">
      <button type="button" onClick={onLeft}>
        Confirm leave
      </button>
    </div>
  ),
}));
vi.mock('../rooms/create/CreateSubRoomDialog', () => ({
  CreateSubRoomDialog: ({ spaceId }: { spaceId?: string }) => (
    <div role="dialog" aria-label="New Sub-room" data-space={spaceId} />
  ),
}));
vi.mock('../timeline/jump-to-time/JumpToTime', () => ({
  JumpToTime: ({ threadId }: { threadId?: string }) => (
    <div role="dialog" aria-label="Jump to Time" data-thread={threadId} />
  ),
}));

// The build's plugins, which each test lists itself.
vi.mock('../plugins/registry', () => ({ registeredPlugins: state.plugins }));
vi.mock('../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: state.reportBoundaryError,
}));

// The real menu and rows, with their roles.
vi.unmock('../ui/glass/GlassPrimitives');

const room = {
  roomId: '!room:example.org',
  name: 'Orchard',
  isSpaceRoom: () => false,
  client: { getRoom: (roomId: string) => state.rooms[roomId] ?? null },
} as unknown as Room;

/** A room menu as an entry point shows it, with its dialog beside it as the entry points do. */
function Harness(props: {
  spaceId?: string;
  removeFromSpaceId?: string;
  threadId?: string;
  roomEntries?: React.ReactNode;
  close?: () => void;
  onLeft?: () => void;
}) {
  const { dialog, showDialog } = useRoomActionDialog();
  return (
    <>
      <RoomActionsMenu
        room={room}
        submenuSide="Right"
        close={props.close ?? vi.fn()}
        showDialog={showDialog}
        spaceId={props.spaceId}
        removeFromSpaceId={props.removeFromSpaceId}
        threadId={props.threadId}
        onLeft={props.onLeft}
        roomEntries={props.roomEntries}
      />
      {dialog}
    </>
  );
}

/** Each row of the menu: its name and, when it cannot be used here, why. */
const rows = () =>
  Array.from(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).map((row) => {
    const copy = row.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    const name = copy.textContent?.trim() ?? '';
    if (row.getAttribute('aria-disabled') !== 'true') return name;
    const reasonId = row.getAttribute('aria-describedby') ?? '';
    return `${name} (${document.getElementById(reasonId)?.textContent ?? 'no reason'})`;
  });

const READING = ['Mark as Read', 'Message Search', 'Jump to Time'];
const ROOM_GROUP = ['Invite', 'New Sub-room', 'Copy Link', 'Room Settings'];
const PREFERENCES = ['Notifications'];
const EXIT = ['Archive Room', 'Leave Room'];
const SHARED = [...READING, ...ROOM_GROUP, ...PREFERENCES, ...EXIT];

/** What the open room's header adds before the room actions. */
const showMembers = <MenuEntry label="Show Members" icon={Icons.User} onSelect={vi.fn()} />;

afterEach(() => {
  cleanup();
  state.canInvite = true;
  state.canListRooms = true;
  state.encrypted = false;
  state.notificationMode = 'unset';
  state.notificationChanging = false;
  state.members = [];
  state.rooms = {};
  state.plugins.length = 0;
  clearToolCallOverrides(SESSION);
  getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: false });
  getDefaultStore().set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() });
  getDefaultStore().set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  vi.clearAllMocks();
});

describe('the shared room actions', () => {
  it('lists every room action in one order, in four structured groups with section headings', () => {
    expect(
      ROOM_ACTIONS.map((group) => ({
        id: group.id,
        labelKey: group.labelKey,
        actions: group.actions.map(({ id }) => id),
      }))
    ).toEqual([
      { id: 'reading', labelKey: undefined, actions: ['markRead', 'search', 'jumpToTime'] },
      {
        id: 'room',
        labelKey: 'featureUi.roomActions.roomSection',
        actions: ['invite', 'newSubRoom', 'copyLink', 'settings'],
      },
      {
        id: 'preferences',
        labelKey: 'featureUi.roomActions.preferencesSection',
        actions: ['notifications', 'toolCalls'],
      },
      { id: 'exit', labelKey: undefined, actions: ['takeOff', 'archive', 'leave'] },
    ]);
    render(<Harness />);
    expect(rows()).toEqual(SHARED);
    expect(screen.getByRole('group', { name: 'Room' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Preferences' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });

  it.each([
    ['unset', 'Default'],
    ['all_messages', 'All'],
    ['special_messages', 'Mentions'],
    ['mute', 'Mute'],
  ] as const)(
    'shows the current notification mode (%s -> %s) beside the bell while keeping accessible name Notifications',
    (mode, expectedLabel) => {
      state.notificationMode = mode;
      render(<Harness />);
      const notifications = screen.getByRole('menuitem', { name: 'Notifications' });
      const modeId = notifications.getAttribute('aria-describedby');
      expect(modeId).toBeTruthy();
      const modeText = document.getElementById(modeId!);
      expect(modeText?.textContent).toBe(expectedLabel);
      expect(modeText?.getAttribute('aria-hidden')).toBe('true');
      expect(rows()).toEqual(SHARED);
    }
  );

  it('replaces the notification mode label with a spinner while changing', () => {
    state.notificationChanging = true;
    render(<Harness />);
    const notifications = screen.getByRole('menuitem', { name: 'Notifications' });
    expect(notifications.getAttribute('aria-describedby')).toBeNull();
    expect(notifications.textContent).toBe('Notifications');
  });

  it('shows Show Tool Calls switch in Preferences for agent rooms and toggles in place via click and keyboard', () => {
    state.members = [{ userId: '@mindroom_agent:example.org', membership: 'join' }];
    const close = vi.fn();
    render(<Harness close={close} />);

    const preferences = screen.getByRole('group', { name: 'Preferences' });
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Show Tool Calls' });
    expect(preferences.contains(toggle)).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(close).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem(`toolCallsShown:${SESSION}`) ?? 'null')).toEqual({
      '!room:example.org': { room: true },
    });

    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(`toolCallsShown:${SESSION}`)).toBeNull();

    fireEvent.keyDown(toggle, { key: ' ' });
    expect(close).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('omits Show Tool Calls in non-agent rooms and includes it for invited agents', () => {
    render(<Harness />);
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show Tool Calls' })).toBeNull();
    cleanup();

    state.members = [{ userId: '@mindroom_agent:example.org', membership: 'invite' }];
    render(<Harness />);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show Tool Calls' })).toBeTruthy();
  });

  it('keeps Invite in its place, disabled with the reason, for someone who may not invite', async () => {
    state.canInvite = false;
    render(<Harness />);
    expect(rows()).toEqual(
      SHARED.map((name) =>
        name === 'Invite' ? "Invite (You don't have permission to invite)" : name
      )
    );
    const invite = screen.getByRole('menuitem', { name: 'Invite' });
    expect(invite.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(invite);
    // A dialog would load lazily; nothing is waiting to load either.
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps Message Search in its place, disabled with the reason, in an encrypted room', () => {
    state.encrypted = true;
    render(<Harness spaceId="!space:example.org" />);
    expect(rows()).toEqual(
      SHARED.map((name) =>
        name === 'Message Search' ? 'Message Search (Not available in encrypted rooms)' : name
      )
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Message Search' }));
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('puts what only the open room offers in a View section before the room actions', () => {
    render(<Harness roomEntries={showMembers} />);
    expect(rows()).toEqual(['Show Members', ...SHARED]);
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });

  it('closes the menu, then searches the room within the space it is listed in, or opens its settings', () => {
    const close = vi.fn();
    render(<Harness spaceId="!space:example.org" close={close} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Message Search' }));
    expect(close).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith(
      withSearchParam(getSpaceSearchPath('!space:example.org'), { rooms: '!room:example.org' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Room Settings' }));
    expect(state.openSettings).toHaveBeenCalledWith('!room:example.org');
  });

  it('opens its dialogs beside the menu: Jump to Time stays in the open thread', async () => {
    render(<Harness threadId="$thread" />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Jump to Time' }));
    const dialog = await screen.findByRole('dialog', { name: 'Jump to Time' });
    expect(dialog.dataset.thread).toBe('$thread');
  });

  it('closes the leave dialog once the room is left and tells the entry point', async () => {
    const onLeft = vi.fn();
    render(<Harness onLeft={onLeft} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave Room' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm leave' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onLeft).toHaveBeenCalledOnce();
  });

  it('opens New Sub-room in the space the room is listed in', async () => {
    const close = vi.fn();
    render(<Harness spaceId="!space:example.org" close={close} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Sub-room' }));
    expect(close).toHaveBeenCalledOnce();
    const dialog = await screen.findByRole('dialog', { name: 'New Sub-room' });
    expect(dialog.dataset.space).toBe('!space:example.org');
  });

  it('keeps New Sub-room in its place, disabled with the reason, for someone who may not list rooms', async () => {
    state.canListRooms = false;
    render(<Harness />);
    expect(rows()).toEqual(
      SHARED.map((name) =>
        name === 'New Sub-room'
          ? "New Sub-room (You can't change the rooms listed under Orchard)"
          : name
      )
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Sub-room' }));
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no New Sub-room in the menu of a space', () => {
    const space = { roomId: '!space:example.org', isSpaceRoom: () => true } as unknown as Room;
    render(
      <RoomActionsMenu room={space} submenuSide="Right" close={vi.fn()} showDialog={vi.fn()} />
    );
    expect(rows()).not.toContain('New Sub-room');
  });

  it('has no New Sub-room in the menu of a direct chat, whose partner could not find it', () => {
    getDefaultStore().set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set([room.roomId]) });
    render(<Harness />);
    expect(rows()).toEqual(SHARED.filter((name) => name !== 'New Sub-room'));
  });

  /** Lists the menu's room under the chat room Garden and the given other parents. */
  const listUnderGarden = (...otherParents: string[]) => {
    state.rooms['!parent:example.org'] = {
      roomId: '!parent:example.org',
      name: 'Garden',
      isSpaceRoom: () => false,
    };
    getDefaultStore().set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([[room.roomId, new Set([...otherParents, '!parent:example.org'])]]),
    });
  };

  it("takes a sub-room off its parent room's list, and leaves its own link to the parent", () => {
    state.rooms['!space:example.org'] = { roomId: '!space:example.org', isSpaceRoom: () => true };
    listUnderGarden('!space:example.org');
    const close = vi.fn();
    render(<Harness close={close} />);
    expect(rows()).toEqual([...SHARED.slice(0, -2), 'Remove from Garden', ...SHARED.slice(-2)]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Garden' }));

    expect(close).toHaveBeenCalledOnce();
    expect(state.sendStateEvent.mock.calls).toEqual([
      ['!parent:example.org', 'm.space.child', {}, '!room:example.org'],
    ]);
  });

  it('keeps Remove from, disabled with the reason, for someone who may not change the parent', () => {
    state.canListRooms = false;
    listUnderGarden();
    render(<Harness />);
    expect(rows()).toContain("Remove from Garden (You can't change the rooms listed under Garden)");
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Garden' }));
    expect(state.sendStateEvent).not.toHaveBeenCalled();
  });

  describe('Remove from <space> parity', () => {
    const spaceId = '!design:example.org';
    const makeJoinedSpace = (overrides: Record<string, unknown> = {}) => ({
      roomId: spaceId,
      name: 'Design Team',
      isSpaceRoom: () => true,
      getMyMembership: () => 'join',
      on: vi.fn(),
      removeListener: vi.fn(),
      ...overrides,
    });
    const linkDirectlyToSpace = (...parents: string[]) => {
      getDefaultStore().set(roomToParentsAtom, {
        type: 'INITIALIZE',
        roomToParents: new Map([[room.roomId, new Set(parents)]]),
      });
    };

    it('offers critical Remove from <space> for a direct child from sidebar row or room header and calls removeSpaceChild', () => {
      state.removeSpaceChild.mockClear();
      state.rooms[spaceId] = makeJoinedSpace();
      linkDirectlyToSpace(spaceId);
      const close = vi.fn();
      render(<Harness removeFromSpaceId={spaceId} close={close} />);

      const entry = screen.getByRole('menuitem', { name: 'Remove from Design Team' });
      expect(rows()).toEqual([
        ...SHARED.slice(0, -2),
        'Remove from Design Team',
        ...SHARED.slice(-2),
      ]);
      expect(entry.className).toBe(screen.getByRole('menuitem', { name: 'Leave Room' }).className);

      fireEvent.click(entry);
      expect(close).toHaveBeenCalledOnce();
      expect(state.removeSpaceChild).toHaveBeenCalledWith(
        expect.anything(),
        spaceId,
        '!room:example.org'
      );

      // Room header menu (passes spaceId without removeFromSpaceId) stays unified for direct children.
      cleanup();
      render(<Harness spaceId={spaceId} />);
      expect(rows()).toEqual([
        ...SHARED.slice(0, -2),
        'Remove from Design Team',
        ...SHARED.slice(-2),
      ]);
    });

    it('omits Remove from <space> for non-direct / orphaned sub-rooms, missing permission, or non-joined spaces', () => {
      state.rooms[spaceId] = makeJoinedSpace();

      // Not directly linked to spaceId (e.g. orphaned chat sub-room under an archived parent).
      linkDirectlyToSpace('!archived-chat:example.org');
      render(<Harness removeFromSpaceId={spaceId} />);
      expect(screen.queryByRole('menuitem', { name: 'Remove from Design Team' })).toBeNull();
      cleanup();

      linkDirectlyToSpace(spaceId);
      state.canListRooms = false;
      render(<Harness removeFromSpaceId={spaceId} />);
      expect(screen.queryByRole('menuitem', { name: 'Remove from Design Team' })).toBeNull();
      cleanup();

      state.canListRooms = true;
      state.rooms[spaceId] = makeJoinedSpace({ getMyMembership: () => 'leave' });
      render(<Harness removeFromSpaceId={spaceId} />);
      expect(screen.queryByRole('menuitem', { name: 'Remove from Design Team' })).toBeNull();
      cleanup();

      delete state.rooms[spaceId];
      render(<Harness removeFromSpaceId={spaceId} />);
      expect(screen.queryByRole('menuitem', { name: 'Remove from Design Team' })).toBeNull();
    });

    it('resolves the unique nested sub-space from room header spaceId and omits when ambiguous', () => {
      const rootId = '!root:example.org';
      const opsId = '!ops:example.org';
      state.removeSpaceChild.mockClear();
      state.rooms[rootId] = makeJoinedSpace({ roomId: rootId, name: 'Field Notes' });
      state.rooms[spaceId] = makeJoinedSpace();
      state.rooms[opsId] = makeJoinedSpace({ roomId: opsId, name: 'Operations' });

      // Root -> Design Team -> room, with only spaceId={rootId} (open room header route).
      getDefaultStore().set(roomToParentsAtom, {
        type: 'INITIALIZE',
        roomToParents: new Map([
          [room.roomId, new Set([spaceId])],
          [spaceId, new Set([rootId])],
        ]),
      });
      const close = vi.fn();
      render(<Harness spaceId={rootId} close={close} />);
      const entry = screen.getByRole('menuitem', { name: 'Remove from Design Team' });
      fireEvent.click(entry);
      expect(close).toHaveBeenCalledOnce();
      expect(state.removeSpaceChild).toHaveBeenCalledWith(
        expect.anything(),
        spaceId,
        '!room:example.org'
      );

      // Ambiguous multi-parent under Root (both Design Team and Operations) omits Remove from.
      cleanup();
      getDefaultStore().set(roomToParentsAtom, {
        type: 'INITIALIZE',
        roomToParents: new Map([
          [room.roomId, new Set([spaceId, opsId])],
          [spaceId, new Set([rootId])],
          [opsId, new Set([rootId])],
        ]),
      });
      render(<Harness spaceId={rootId} />);
      expect(screen.queryByRole('menuitem', { name: /^Remove from / })).toBeNull();
    });
  });
});

describe("plugins' entries", () => {
  registerPluginTranslations('example', {
    en: { about: 'About this room', other: 'Other entry', remove: 'Remove example data' },
  });

  const entry = (fields: Partial<PluginRoomAction> = {}): PluginRoomAction => ({
    id: 'about',
    label: 'about',
    icon: Icons.Info,
    run: vi.fn(),
    ...fields,
  });

  /** Lists the example plugin with these room actions in the build. */
  const buildWith = (...roomActions: PluginRoomAction[]) => {
    state.plugins.push({
      id: 'example',
      tag: 'example@1.0.0',
      displayName: 'Example',
      defaultEnabled: true,
      conversationCovers: [],
      messageRenderers: [],
      pages: [],
      roomHeaderSlot: [],
      threadHeaderSlot: [],
      sidePanels: [],
      headerActions: [],
      slashCommands: [],
      roomActions,
      messageLinks: [],
      threadCardBadges: [],
      threadDetails: [],
    });
  };

  /** The menu's groups, as the names of their rows, and the lines between them as `line`. */
  const layout = () => {
    const first = screen.getByRole('menuitem', { name: 'Mark as Read' }).parentElement;
    return Array.from(first?.parentElement?.children ?? []).map((part) => {
      const items = Array.from(part.querySelectorAll('[role^="menuitem"]'));
      return items.length > 0
        ? items.map((row) => {
            const copy = row.cloneNode(true) as Element;
            copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
            return copy.textContent?.trim() ?? '';
          })
        : 'line';
    });
  };

  /**
   * A menu that goes once an entry closes it, as the entry points' menus do, with a button that
   * opens it again and the dialog beside it.
   */
  function ClosingHarness({ config, onClose }: { config?: ClientConfig; onClose?: () => void }) {
    const [open, setOpen] = useState(true);
    const { dialog, showDialog } = useRoomActionDialog();
    const close = () => {
      onClose?.();
      setOpen(false);
    };
    return (
      <ClientConfigProvider value={config}>
        {open ? (
          <RoomActionsMenu room={room} submenuSide="Right" close={close} showDialog={showDialog} />
        ) : (
          <button type="button" onClick={() => setOpen(true)}>
            Open menu
          </button>
        )}
        {dialog}
      </ClientConfigProvider>
    );
  }

  const choose = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));

  /** A dialog that names the room it was shown for. */
  const exampleDialog = (named: Room) => (close: () => void) => (
    <div role="dialog" aria-label="Example dialog">
      <p>Example dialog of {named.name}</p>
      <button type="button" onClick={close}>
        Close example dialog
      </button>
    </div>
  );

  const coreBeforeExit = [READING, 'line', ROOM_GROUP, 'line', PREFERENCES];

  it('lists them in a group of their own, after Preferences and before Remove from, Archive and Leave, in a row menu and in the room header menu', () => {
    buildWith(entry(), entry({ id: 'other', label: 'other' }));
    const plugins = ['About this room', 'Other entry'];
    render(<Harness />);
    expect(layout()).toEqual([...coreBeforeExit, 'line', plugins, 'line', EXIT]);
    cleanup();

    render(<Harness roomEntries={showMembers} />);
    expect(layout()).toEqual([
      ['Show Members'],
      'line',
      ...coreBeforeExit,
      'line',
      plugins,
      'line',
      EXIT,
    ]);
  });

  it("lists a critical entry at the end of the menu's last group, drawn as Leave is, in a row menu and in the room header menu; the ordinary ones keep their group", () => {
    buildWith(
      entry({ id: 'remove', label: 'remove', icon: Icons.Delete, critical: true }),
      entry(),
      entry({ id: 'other', label: 'other' })
    );
    const last = [...EXIT, 'Remove example data'];
    render(<Harness />);
    expect(layout()).toEqual([
      ...coreBeforeExit,
      'line',
      ['About this room', 'Other entry'],
      'line',
      last,
    ]);
    const style = (name: string) => screen.getByRole('menuitem', { name }).className;
    expect(style('Leave Room')).not.toBe(style('Archive Room'));
    expect(style('Remove example data')).toBe(style('Leave Room'));
    expect(style('About this room')).toBe(style('Archive Room'));
    cleanup();

    render(<Harness roomEntries={showMembers} />);
    expect(layout().at(-1)).toEqual(last);
  });

  it('draws no group of their own when every entry is critical', () => {
    buildWith(entry({ critical: true }));
    render(<Harness />);
    expect(layout()).toEqual([...coreBeforeExit, 'line', [...EXIT, 'About this room']]);
  });

  it('draws no group for plugins when no entry shows for the room', () => {
    buildWith(entry({ shows: (shown) => shown.isSpaceRoom() }));
    render(<Harness />);
    expect(layout()).toEqual([...coreBeforeExit, 'line', EXIT]);
  });

  it("closes the menu, then runs the entry on the menu's room; its dialog stays after the menu has gone, until it closes", async () => {
    const order: string[] = [];
    const run = vi.fn<PluginRoomAction['run']>(({ room: chosen, showDialog }) => {
      order.push('run');
      showDialog(exampleDialog(chosen));
    });
    buildWith(entry({ run }));
    render(<ClosingHarness onClose={() => order.push('close')} />);
    choose('About this room');

    expect(order).toEqual(['close', 'run']);
    expect(run.mock.calls[0]?.[0].room).toBe(room);
    expect(screen.queryByRole('menu')).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: 'Example dialog' });
    expect(dialog.textContent).toContain('Example dialog of Orchard');
    fireEvent.click(screen.getByRole('button', { name: 'Close example dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  function BrokenDialog(): null {
    throw new Error('broken dialog');
  }

  it.each([
    ['whose component throws', () => <BrokenDialog />],
    [
      'that throws as it is drawn',
      () => {
        throw new Error('broken dialog');
      },
    ],
  ])(
    "logs and reports a dialog %s with the plugin's tag and takes it away; the entry's next dialog shows",
    async (_, broken) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let shown = 0;
      buildWith(
        entry({
          run: ({ room: chosen, showDialog }) => {
            shown += 1;
            showDialog(shown === 1 ? broken : exampleDialog(chosen));
          },
        })
      );
      render(<ClosingHarness />);
      choose('About this room');

      await vi.waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          "[plugin example@1.0.0] its room action's dialog failed",
          new Error('broken dialog')
        )
      );
      expect(state.reportBoundaryError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[plugin example@1.0.0] broken dialog' }),
        expect.any(String)
      );
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      choose('About this room');
      expect(await screen.findByRole('dialog', { name: 'Example dialog' })).toBeTruthy();
      logged.mockRestore();
    }
  );

  it("logs a run that throws with the plugin's tag, and the menu keeps working", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('no');
    buildWith(
      entry({
        run: () => {
          throw failure;
        },
      })
    );
    render(<ClosingHarness />);
    choose('About this room');
    expect(logged).toHaveBeenCalledWith('[plugin example@1.0.0] its room action failed', failure);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    choose('Jump to Time');
    expect(await screen.findByRole('dialog', { name: 'Jump to Time' })).toBeTruthy();
    logged.mockRestore();
  });

  it('leaves out the entries of a plugin config.json turns off', () => {
    buildWith(entry());
    const config = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    render(<ClosingHarness config={config} />);
    expect(rows()).toEqual(SHARED);
  });
});
