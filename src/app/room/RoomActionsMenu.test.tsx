// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { MenuEntry } from '../ui/MenuEntry';
import { getSpaceSearchPath, withSearchParam } from '../routes/pathUtils';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { registerPluginTranslations } from '../plugins/pluginTranslations';
import type { RegisteredPlugin } from '../plugins/registry';
import type { PluginRoomAction } from '../plugins/roomActions';
import { ROOM_ACTIONS } from './roomActions';
import { RoomActionsMenu, useRoomActionDialog } from './RoomActionsMenu';

const state = vi.hoisted(() => ({
  canInvite: true,
  canListRooms: true,
  encrypted: false,
  navigate: vi.fn(),
  openSettings: vi.fn(),
  sendStateEvent: vi.fn(() => Promise.resolve({})),
  rooms: {} as Record<string, unknown>,
  plugins: [] as RegisteredPlugin[],
  reportBoundaryError: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => state.navigate,
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
vi.mock('../matrix/matrix', () => ({
  getCanonicalAliasOrRoomId: (_client: unknown, roomId: string) => roomId,
  isRoomAlias: () => false,
}));
vi.mock('../navigation/useRoomSettingsState', () => ({
  useOpenRoomSettings: () => state.openSettings,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'unset',
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
  }) => children(vi.fn(), false, false),
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
} as unknown as Room;

/** A room menu as an entry point shows it, with its dialog beside it as the entry points do. */
function Harness(props: {
  spaceId?: string;
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

const SHARED = [
  'Mark as Read',
  'Notifications',
  'Invite',
  'New Sub-room',
  'Copy Link',
  'Room Settings',
  'Message Search',
  'Jump to Time',
  'Archive Room',
  'Leave Room',
];

afterEach(() => {
  cleanup();
  state.canInvite = true;
  state.canListRooms = true;
  state.encrypted = false;
  state.rooms = {};
  state.plugins.length = 0;
  getDefaultStore().set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() });
  getDefaultStore().set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  vi.clearAllMocks();
});

describe('the shared room actions', () => {
  it('lists every room action in one order, in two groups', () => {
    expect(ROOM_ACTIONS.map((group) => group.map(({ id }) => id))).toEqual([
      [
        'markRead',
        'notifications',
        'invite',
        'newSubRoom',
        'copyLink',
        'settings',
        'search',
        'jumpToTime',
      ],
      ['takeOff', 'archive', 'leave'],
    ]);
    render(<Harness />);
    expect(rows()).toEqual(SHARED);
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

  it('puts what only the open room offers in a section before the room actions', () => {
    render(
      <Harness
        roomEntries={<MenuEntry label="Show Members" icon={Icons.User} onSelect={vi.fn()} />}
      />
    );
    expect(rows()).toEqual(['Show Members', ...SHARED]);
  });

  it('closes the menu, then searches the room within the space it is listed in', () => {
    const close = vi.fn();
    render(<Harness spaceId="!space:example.org" close={close} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Message Search' }));
    expect(close).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith(
      withSearchParam(getSpaceSearchPath('!space:example.org'), { rooms: '!room:example.org' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Room Settings' }));
    expect(state.openSettings).toHaveBeenCalledWith('!room:example.org', '!space:example.org');
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
});

describe("plugins' entries", () => {
  registerPluginTranslations('example', { en: { about: 'About this room', other: 'Other entry' } });

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
      conversationCovers: [],
      messageRenderers: [],
      pages: [],
      roomHeaderSlot: [],
      sidePanels: [],
      headerActions: [],
      slashCommands: [],
      roomActions,
    });
  };

  /** The menu's groups, as the names of their rows, and the lines between them as `—`. */
  const layout = () => {
    const first = screen.getByRole('menuitem', { name: 'Mark as Read' }).parentElement;
    return Array.from(first?.parentElement?.children ?? []).map((part) => {
      const rows = Array.from(part.querySelectorAll('[role^="menuitem"]'));
      return rows.length > 0 ? rows.map((row) => row.textContent?.trim() ?? '') : '—';
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
  const exampleDialog = (named: Room) => (close: () => void) =>
    (
      <div role="dialog" aria-label="Example dialog">
        <p>Example dialog of {named.name}</p>
        <button type="button" onClick={close}>
          Close example dialog
        </button>
      </div>
    );

  it('lists them in a group of their own, after the first group and before Remove from, Archive and Leave, in a row menu and in the room header menu', () => {
    buildWith(entry(), entry({ id: 'other', label: 'other' }));
    const plugins = ['About this room', 'Other entry'];
    render(<Harness />);
    expect(layout()).toEqual([SHARED.slice(0, -2), '—', plugins, '—', SHARED.slice(-2)]);
    cleanup();

    render(
      <Harness
        roomEntries={<MenuEntry label="Show Members" icon={Icons.User} onSelect={vi.fn()} />}
      />
    );
    expect(layout()).toEqual([
      ['Show Members'],
      '—',
      SHARED.slice(0, -2),
      '—',
      plugins,
      '—',
      SHARED.slice(-2),
    ]);
  });

  it('draws no group for plugins when no entry shows for the room', () => {
    buildWith(entry({ shows: (shown) => shown.isSpaceRoom() }));
    render(<Harness />);
    expect(layout()).toEqual([SHARED.slice(0, -2), '—', SHARED.slice(-2)]);
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
