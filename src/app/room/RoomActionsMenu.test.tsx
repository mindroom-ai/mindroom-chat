// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuEntry } from '../ui/MenuEntry';
import { getSpaceSearchPath, withSearchParam } from '../routes/pathUtils';
import { ROOM_ACTIONS } from './roomActions';
import { RoomActionsMenu, useRoomActionDialog } from './RoomActionsMenu';

const state = vi.hoisted(() => ({
  canInvite: true,
  encrypted: false,
  navigate: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => state.navigate,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => state.canInvite, event: () => false }),
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
vi.mock('../timeline/jump-to-time/JumpToTime', () => ({
  JumpToTime: ({ threadId }: { threadId?: string }) => (
    <div role="dialog" aria-label="Jump to Time" data-thread={threadId} />
  ),
}));

// The real menu and rows, with their roles.
vi.unmock('../ui/glass/GlassPrimitives');

const room = { roomId: '!room:example.org' } as unknown as Room;

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
  state.encrypted = false;
  vi.clearAllMocks();
});

describe('the shared room actions', () => {
  it('lists every room action in one order, in two groups', () => {
    expect(ROOM_ACTIONS.map((group) => group.map(({ id }) => id))).toEqual([
      ['markRead', 'notifications', 'invite', 'copyLink', 'settings', 'search', 'jumpToTime'],
      ['archive', 'leave'],
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
});
