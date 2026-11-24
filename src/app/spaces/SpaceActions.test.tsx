// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { IPowerLevels } from '../matrix/hooks/usePowerLevels';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSpaceShareLink,
  SpaceAddMenuEntries,
  SpaceMenuGroups,
  type SpaceQuickDialogs,
  type SpaceQuickPermissions,
  useSpaceQuickDialogs,
  useSpaceQuickPermissions,
} from './SpaceActions';

const mocks = vi.hoisted(() => {
  const powerLevels: IPowerLevels = {
    state_default: 50,
    invite: 50,
    users: { '@alice:example.org': 0 },
  };
  return {
    navigate: vi.fn(),
    copyToClipboard: vi.fn(async () => true),
    openCreateRoom: vi.fn(),
    openCreateSpace: vi.fn(),
    openRoomSettings: vi.fn(),
    removeSpaceChild: vi.fn(async () => undefined),
    pinSpaceToSidebar: vi.fn(async () => undefined),
    unpinSpaceFromSidebar: vi.fn(async () => undefined),
    savedSidebarItems: [] as string[],
    topLevelSpaces: ['!root:example.org'],
    creators: new Set<string>(),
    powerLevels,
    latestLeaveProps: undefined as { onLeft?: () => void; requestClose?: () => void } | undefined,
    latestAddExistingProps: undefined as
      { kind: string; into: string; requestClose: () => void } | undefined,
    latestInviteProps: undefined as { room: Room; requestClose: () => void } | undefined,
  };
});

const mockClient = {
  getUserId: () => '@alice:example.org',
  getRoom: () => null,
} as unknown as MatrixClient;

const makeSpace = (roomId = '!space:example.org', name = 'Field Notes'): Room =>
  ({
    roomId,
    name,
    getCanonicalAlias: () => null,
    currentState: { getStateEvents: () => [] },
    getMembersWithMembership: () => [],
    getLiveTimeline: () => ({ getState: () => null }),
  }) as unknown as Room;

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock('folds', () => ({
  Icons: {
    ArrowGoLeft: 'ArrowGoLeft',
    Category: 'Category',
    Delete: 'Delete',
    Hash: 'Hash',
    HashPlus: 'HashPlus',
    Link: 'Link',
    Pin: 'Pin',
    Setting: 'Setting',
    Space: 'Space',
    SpacePlus: 'SpacePlus',
    UserPlus: 'UserPlus',
  },
  Line: (props: Record<string, unknown>) => <hr data-line {...props} />,
}));

vi.mock('../lib/dom', () => ({ copyToClipboard: mocks.copyToClipboard }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mockClient }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => mocks.creators }));
vi.mock('../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: () => mocks.powerLevels,
}));
vi.mock('../navigation/useCreateRoomModal', () => ({
  useOpenCreateRoomModal: () => mocks.openCreateRoom,
}));
vi.mock('../navigation/useCreateSpaceModal', () => ({
  useOpenCreateSpaceModal: () => mocks.openCreateSpace,
}));
vi.mock('../navigation/useRoomSettingsState', () => ({
  useOpenRoomSettings: () => mocks.openRoomSettings,
}));
vi.mock('./lobby/spaceChildren', () => ({ removeSpaceChild: mocks.removeSpaceChild }));
vi.mock('./sidebarSpaces', () => ({
  isSpaceInSidebar: (items: string[], id: string) => items.includes(id),
  pinSpaceToSidebar: mocks.pinSpaceToSidebar,
  unpinSpaceFromSidebar: mocks.unpinSpaceFromSidebar,
  useSavedSidebarItems: () => mocks.savedSidebarItems,
  useTopLevelSpaceIds: () => mocks.topLevelSpaces,
}));
vi.mock('../ui/MenuEntry', () => ({
  MenuGroup: ({ children }: { children?: React.ReactNode }) => (
    <div data-menu-group>{children}</div>
  ),
  MenuEntry: ({
    label,
    icon,
    critical,
    onSelect,
  }: {
    label: string;
    icon?: string;
    critical?: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      data-menu-entry={label}
      data-icon={icon}
      data-critical={critical ? 'true' : undefined}
      onClick={onSelect}
    >
      {label}
    </button>
  ),
}));
vi.mock('./AddExistingModal', () => ({
  AddExistingModal: (props: { kind: string; into: string; requestClose: () => void }) => {
    mocks.latestAddExistingProps = props;
    return <div data-dialog={`addExisting:${props.kind}:${props.into}`} />;
  },
}));
vi.mock('../members/invite/InviteUserPrompt', () => ({
  InviteUserPrompt: (props: { room: Room; requestClose: () => void }) => {
    mocks.latestInviteProps = props;
    return <div data-dialog={`invite:${props.room.roomId}`} />;
  },
}));
vi.mock('../rooms/LeaveRoomPrompt', () => ({
  LeaveRoomPrompt: (props: { roomId: string; onLeft: () => void; requestClose: () => void }) => {
    mocks.latestLeaveProps = props;
    return <div data-dialog={`leave:${props.roomId}`} />;
  },
}));

describe('SpaceActions', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mocks.navigate.mockReset();
    mocks.copyToClipboard.mockReset();
    mocks.openCreateRoom.mockReset();
    mocks.openCreateSpace.mockReset();
    mocks.openRoomSettings.mockReset();
    mocks.removeSpaceChild.mockReset();
    mocks.pinSpaceToSidebar.mockReset();
    mocks.unpinSpaceFromSidebar.mockReset();
    mocks.savedSidebarItems = [];
    mocks.creators = new Set();
    mocks.powerLevels = { state_default: 50, invite: 50, users: { '@alice:example.org': 0 } };
    mocks.latestLeaveProps = undefined;
    mocks.latestAddExistingProps = undefined;
    mocks.latestInviteProps = undefined;
  });

  const render = (element: React.ReactElement) => {
    act(() => {
      renderer = create(element);
    });
    return renderer!;
  };

  it('computes reactive canAdd and canInvite permissions from power levels and creators', () => {
    const space = makeSpace();
    let captured: SpaceQuickPermissions | undefined;
    function Probe() {
      captured = useSpaceQuickPermissions(space);
      return null;
    }

    // Regular member with state_default=50, invite=50 -> neither allowed.
    render(<Probe />);
    expect(captured).toEqual({ canAdd: false, canInvite: false });

    // Member when invite=0 -> canInvite only.
    act(() => renderer!.unmount());
    mocks.powerLevels = { state_default: 50, invite: 0, users: { '@alice:example.org': 0 } };
    render(<Probe />);
    expect(captured).toEqual({ canAdd: false, canInvite: true });

    // Moderator (level 50) -> both allowed.
    act(() => renderer!.unmount());
    mocks.powerLevels = { state_default: 50, invite: 50, users: { '@alice:example.org': 50 } };
    render(<Probe />);
    expect(captured).toEqual({ canAdd: true, canInvite: true });

    // Room v12 creator -> both allowed regardless of power levels.
    act(() => renderer!.unmount());
    mocks.powerLevels = { state_default: 100, invite: 100, users: {} };
    mocks.creators = new Set(['@alice:example.org']);
    render(<Probe />);
    expect(captured).toEqual({ canAdd: true, canInvite: true });
  });

  it('renders 4 add entries normally and 2 entries when roomsOnly is true', () => {
    const onClose = vi.fn();
    const onAddRooms = vi.fn();
    const onAddSpaces = vi.fn();

    render(
      <SpaceAddMenuEntries
        spaceId="!sub:example.org"
        onClose={onClose}
        onAddRooms={onAddRooms}
        onAddSpaces={onAddSpaces}
      />
    );
    const buttons = renderer!.root.findAll((node) => node.type === 'button');
    expect(buttons.map((node) => node.props['data-menu-entry'])).toEqual([
      'New Room',
      'Add Existing Room',
      'New Sub-space',
      'Add Existing Sub-space',
    ]);

    act(() => {
      buttons[0]!.props.onClick();
    });
    expect(mocks.openCreateRoom).toHaveBeenCalledWith('!sub:example.org');
    act(() => {
      buttons[1]!.props.onClick();
    });
    expect(onAddRooms).toHaveBeenCalledTimes(1);
    act(() => {
      buttons[2]!.props.onClick();
    });
    expect(mocks.openCreateSpace).toHaveBeenCalledWith('!sub:example.org');
    act(() => {
      buttons[3]!.props.onClick();
    });
    expect(onAddSpaces).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(4);

    // roomsOnly omits both sub-space entries.
    act(() => renderer!.unmount());
    render(
      <SpaceAddMenuEntries
        spaceId="!root:example.org"
        onClose={onClose}
        onAddRooms={onAddRooms}
        roomsOnly
      />
    );
    const roomOnlyButtons = renderer!.root.findAll((node) => node.type === 'button');
    expect(roomOnlyButtons.map((node) => node.props['data-menu-entry'])).toEqual([
      'New Room',
      'Add Existing Room',
    ]);
  });

  it('composes grouped sections with dividers only between non-empty groups and wires actions', () => {
    const space = makeSpace('!sub:example.org', 'Design Team');
    const onClose = vi.fn();
    const dialogs = {
      openAddRooms: vi.fn(),
      openAddSpaces: vi.fn(),
      openInvite: vi.fn(),
      openLeave: vi.fn(),
    };

    // With canAdd=true and canInvite=true: 3 groups and 2 dividers.
    render(
      <SpaceMenuGroups
        space={space}
        permissions={{ canAdd: true, canInvite: true }}
        dialogs={dialogs}
        onClose={onClose}
        showOverview
        pinMode="toggle"
        removeFromParent={{ parentSpaceId: '!ops:example.org', parentName: 'Operations' }}
      />
    );
    expect(renderer!.root.findAll((node) => 'data-menu-group' in node.props)).toHaveLength(3);
    expect(renderer!.root.findAll((node) => 'data-line' in node.props)).toHaveLength(2);

    const clickEntry = (label: string) => {
      const button = renderer!.root.find(
        (node) => node.type === 'button' && node.props['data-menu-entry'] === label
      );
      act(() => {
        button.props.onClick();
      });
    };

    clickEntry('Space overview');
    expect(mocks.navigate).toHaveBeenCalledWith('/!sub%3Aexample.org/lobby');

    clickEntry('Invite');
    expect(dialogs.openInvite).toHaveBeenCalledTimes(1);

    clickEntry('Copy Link');
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(getSpaceShareLink(mockClient, space));

    clickEntry('Space Settings');
    expect(mocks.openRoomSettings).toHaveBeenCalledWith('!sub:example.org');

    clickEntry('Pin to Sidebar');
    expect(mocks.pinSpaceToSidebar).toHaveBeenCalledWith(
      mockClient,
      '!sub:example.org',
      mocks.topLevelSpaces
    );

    clickEntry('Remove from Operations');
    expect(mocks.removeSpaceChild).toHaveBeenCalledWith(
      mockClient,
      '!ops:example.org',
      '!sub:example.org'
    );

    clickEntry('Leave Space');
    expect(dialogs.openLeave).toHaveBeenCalledTimes(1);

    // With canAdd=false and canInvite=false: Add group omitted, only 2 groups and 1 divider.
    act(() => renderer!.unmount());
    mocks.savedSidebarItems = ['!sub:example.org'];
    render(
      <SpaceMenuGroups
        space={space}
        permissions={{ canAdd: false, canInvite: false }}
        dialogs={dialogs}
        onClose={onClose}
        pinMode="toggle"
      />
    );
    expect(renderer!.root.findAll((node) => 'data-menu-group' in node.props)).toHaveLength(2);
    expect(renderer!.root.findAll((node) => 'data-line' in node.props)).toHaveLength(1);
    const labels = renderer!.root
      .findAll((node) => node.type === 'button')
      .map((node) => node.props['data-menu-entry']);
    expect(labels).toEqual(['Copy Link', 'Space Settings', 'Unpin from Sidebar', 'Leave Space']);

    clickEntry('Unpin from Sidebar');
    expect(mocks.unpinSpaceFromSidebar).toHaveBeenCalledWith(mockClient, '!sub:example.org');

    // Rail pinned tab uses pinMode="unpin" with the concise "Unpin" label.
    act(() => renderer!.unmount());
    mocks.unpinSpaceFromSidebar.mockReset();
    render(
      <SpaceMenuGroups
        space={space}
        permissions={{ canAdd: false, canInvite: false }}
        dialogs={dialogs}
        onClose={onClose}
        pinMode="unpin"
      />
    );
    clickEntry('Unpin');
    expect(mocks.unpinSpaceFromSidebar).toHaveBeenCalledWith(mockClient, '!sub:example.org');

    // showAdd={false} omits the Add group even when permissions.canAdd is true.
    act(() => renderer!.unmount());
    render(
      <SpaceMenuGroups
        space={space}
        permissions={{ canAdd: true, canInvite: true }}
        dialogs={dialogs}
        onClose={onClose}
        showAdd={false}
        pinMode="toggle"
      />
    );
    expect(renderer!.root.findAll((node) => 'data-menu-group' in node.props)).toHaveLength(2);
    expect(renderer!.root.findAll((node) => 'data-line' in node.props)).toHaveLength(1);
    const noAddLabels = renderer!.root
      .findAll((node) => node.type === 'button')
      .map((node) => node.props['data-menu-entry']);
    expect(noAddLabels).toEqual([
      'Invite',
      'Copy Link',
      'Space Settings',
      'Unpin from Sidebar',
      'Leave Space',
    ]);
  });

  it('opens and closes lazy dialogs cleanly and triggers onLeft when leaving', async () => {
    const space = makeSpace('!field:example.org', 'Field Notes');
    const onLeft = vi.fn();
    let api!: SpaceQuickDialogs;

    function DialogHost() {
      api = useSpaceQuickDialogs(space, { onLeft });
      return <div>{api.dialog}</div>;
    }

    render(<DialogHost />);
    expect(renderer!.root.findAll((node) => 'data-dialog' in node.props)).toHaveLength(0);

    await act(async () => {
      api.openAddRooms();
    });
    expect(
      renderer!.root.find(
        (node) => node.props['data-dialog'] === 'addExisting:rooms:!field:example.org'
      )
    ).toBeDefined();
    act(() => {
      mocks.latestAddExistingProps?.requestClose();
    });
    expect(renderer!.root.findAll((node) => 'data-dialog' in node.props)).toHaveLength(0);

    await act(async () => {
      api.openAddSpaces();
    });
    expect(
      renderer!.root.find(
        (node) => node.props['data-dialog'] === 'addExisting:spaces:!field:example.org'
      )
    ).toBeDefined();

    await act(async () => {
      api.openInvite();
    });
    expect(
      renderer!.root.find((node) => node.props['data-dialog'] === 'invite:!field:example.org')
    ).toBeDefined();

    await act(async () => {
      api.openLeave();
    });
    expect(
      renderer!.root.find((node) => node.props['data-dialog'] === 'leave:!field:example.org')
    ).toBeDefined();

    act(() => {
      mocks.latestLeaveProps?.onLeft?.();
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAll((node) => 'data-dialog' in node.props)).toHaveLength(0);
  });
});
