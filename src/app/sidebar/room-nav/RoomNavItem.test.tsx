// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { EventEmitter } from 'node:events';
import { Provider, createStore } from 'jotai';
import { JoinRule, Room, RoomEvent, RoomStateEvent } from 'matrix-js-sdk';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../composer/roomInputDrafts';
import { BlockType } from '../../editor/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeCallAtom, type ActiveCall } from '../../calls/callStore';
import type { CallState } from '../../calls/RoomCall';
import { RoomNavItem } from './RoomNavItem';
import { RoomNotificationMode } from '../../matrix/hooks/useRoomsNotificationPreferences';

const testState = vi.hoisted(() => ({
  avatarMxc: undefined as string | undefined,
  directAvatarMxc: undefined as string | undefined,
  roomAvatarMxc: undefined as string | undefined,
  backgroundJobs: [] as { jobId: string }[],
  unread: undefined as { total: number; highlight: number } | undefined,
  mDirectContent: undefined as Record<string, string[]> | undefined,
  useRelativeTime: vi.fn((ts: number, format?: string) => `${format}:${ts}`),
  activeCall: undefined as ActiveCall | undefined,
  setHover: undefined as ((hovering: boolean) => void) | undefined,
  setFocusWithin: undefined as ((focused: boolean) => void) | undefined,
  matrixMxcUrlToHttp: vi.fn((mxc: string) =>
    mxc.startsWith('mxc://example.org/')
      ? `https://media.example.org/${mxc.slice('mxc://example.org/'.length)}`
      : null
  ),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const Container = ({ children, ...props }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', props, children);

  return {
    Avatar: Container,
    Badge: Container,
    Box: Container,
    Icon: ({ ref, ...props }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }) =>
      reactModule.createElement('i', { ...props, ref }),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('button', props, children),
    Icons: {
      ArrowGoLeft: 'ArrowGoLeft',
      Clock: 'Clock',
      Link: 'Link',
      Message: 'Message',
      Pencil: 'Pencil',
      Phone: 'Phone',
      Setting: 'Setting',
      UserPlus: 'UserPlus',
      VerticalDots: 'VerticalDots',
    },
    Line: Container,
    Menu: Container,
    MenuItem: Container,
    PopOut: Container,
    Spinner: Container,
    Tooltip: Container,
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', props, children),
    color: {
      SurfaceVariant: { Container: '#eee', OnContainer: '#111' },
    },
    config: {
      fontWeight: { W400: 400 },
      opacity: { P300: 0.3, P500: 0.5 },
      space: { S100: '4px' },
    },
    toRem: (value: number) => `${value}rem`,
  };
});

vi.mock('react-aria', () => ({
  useFocusWithin: ({
    onFocusWithinChange,
  }: {
    onFocusWithinChange: (focused: boolean) => void;
  }) => {
    testState.setFocusWithin = onFocusWithinChange;
    return { focusWithinProps: {} };
  },
  useHover: ({ onHoverChange }: { onHoverChange: (hovering: boolean) => void }) => {
    testState.setHover = onHoverChange;
    return { hoverProps: {} };
  },
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  return {
    ...actual,
    useAtom: () => [false, vi.fn()],
    useAtomValue: (atom: unknown) =>
      atom === activeCallAtom ? testState.activeCall : actual.useAtomValue(atom as never),
  };
});

vi.mock('../../ui/nav/NavItem', async () => {
  const reactModule = await import('react');
  const Container = ({ children, ...props }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', props, children);

  return {
    NavItem: Container,
    NavItemContent: Container,
    NavItemOptions: Container,
    NavLink: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) =>
      reactModule.createElement('a', { href: to, ...props }, children),
  };
});

vi.mock('../../ui/UnreadBadge', async () => {
  const reactModule = await import('react');
  return {
    UnreadBadge: () => reactModule.createElement('span', { 'data-testid': 'unread-badge' }),
    UnreadBadgeCenter: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', { 'data-testid': 'unread-badge-center' }, children),
  };
});

vi.mock('../../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));

vi.mock('../../members/invite/InviteUserPrompt', () => ({
  InviteUserPrompt: () => null,
}));

vi.mock('../../rooms/LeaveRoomPrompt', () => ({
  LeaveRoomPrompt: () => null,
}));

vi.mock('../../notifications/MarkRoomReadMenuItem', () => ({
  MarkRoomReadMenuItem: () => null,
}));

vi.mock('../../avatars/RoomAvatar', async () => {
  const reactModule = await import('react');

  const RoomAvatar = ({
    src,
    alt,
    renderFallback,
  }: {
    src?: string;
    alt?: string;
    renderFallback: () => React.ReactNode;
  }) => {
    const [failedSrc, setFailedSrc] = reactModule.useState<string>();
    return !src || failedSrc === src
      ? renderFallback()
      : reactModule.createElement('img', {
          alt,
          'data-testid': 'room-avatar-image',
          onError: () => setFailedSrc(src),
          src,
        });
  };

  return {
    RoomAvatar,
    RoomIcon: (props: Record<string, unknown>) =>
      reactModule.createElement('i', { ...props, 'data-testid': 'room-icon' }),
  };
});

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://media.example.org',
    getUserId: () => '@me:example.org',
    getAccountData: (type: string) =>
      type === 'm.direct' && testState.mDirectContent
        ? { getContent: () => testState.mDirectContent }
        : undefined,
    mxcUrlToHttp: testState.matrixMxcUrlToHttp,
  }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('../../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: (_room: Room, direct?: boolean) =>
    direct ? testState.directAvatarMxc : testState.avatarMxc,
  useRoomName: vi.fn(() => 'Agent Room'),
}));

vi.mock('../../matrix/state/useUnread', () => ({
  useRoomUnread: () => testState.unread,
}));

vi.mock('../../i18n/useRelativeTime', () => ({
  useRelativeTime: (ts: number, format?: string) => testState.useRelativeTime(ts, format),
}));

vi.mock('../../timeline/typing/useRoomTypingMembers', () => ({
  useRoomTypingMember: () => [],
}));

vi.mock('../../matrix/hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => undefined,
}));

vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

vi.mock('../../matrix/hooks/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({
    jobs: testState.backgroundJobs,
    total: testState.backgroundJobs.length,
  }),
}));

vi.mock('../../matrix/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
  isRoomAlias: () => false,
  mxcUrlToHttp: (_mx: unknown, mxc: string) =>
    mxc.startsWith('mxc://example.org/avatar')
      ? `https://media.example.org/${mxc.slice('mxc://example.org/'.length)}`
      : undefined,
}));

const room = {
  roomId: '!room:example.org',
  getJoinRule: () => JoinRule.Public,
  getMxcAvatarUrl: () => testState.roomAvatarMxc,
  getType: () => undefined,
} as unknown as Room;

const renderRoomNavItem = (
  props: {
    room?: Room;
    direct?: boolean;
    showAvatar?: boolean;
    nameOverride?: string;
    fallbackAvatarMxc?: string;
    avatarBadge?: React.ComponentProps<typeof RoomNavItem>['avatarBadge'];
    subRoom?: boolean;
    activityTimestamp?: number;
    notificationMode?: RoomNotificationMode;
  } = {},
  store?: ReturnType<typeof createStore>
) => {
  const element = (
    <RoomNavItem
      room={props.room ?? room}
      selected={false}
      linkPath="/room"
      notificationMode={RoomNotificationMode.Unset}
      {...props}
    />
  );
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(store ? <Provider store={store}>{element}</Provider> : element);
  });
  renders.push(renderer);
  return renderer;
};

const renders: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renders.splice(0).forEach((renderer) => renderer.unmount()));
});

const findByTestId = (renderer: ReactTestRenderer, testId: string) =>
  renderer.root.findAll((node) => node.props['data-testid'] === testId);

const markCall = (
  callRoomId: string,
  originRoomId?: string,
  phase: CallState['phase'] = 'connected'
) => {
  const subscribe = vi.fn(() => () => undefined);
  testState.activeCall = {
    kind: originRoomId ? 'agent' : 'room',
    origin: originRoomId ? { roomId: originRoomId } : undefined,
    call: {
      room: { roomId: callRoomId },
      subscribe,
      getState: () => ({ phase }),
    },
  } as unknown as ActiveCall;
  return subscribe;
};

describe('RoomNavItem call badge', () => {
  afterEach(() => {
    testState.activeCall = undefined;
  });
  const badge = (renderer: ReactTestRenderer) =>
    renderer.root.findAll((node) => node.type === 'i' && node.props.src === 'Phone');

  it('marks a live call in this room and describes it without renaming the link', () => {
    const subscribe = markCall(room.roomId);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = renderRoomNavItem();
    });
    expect(subscribe).toHaveBeenCalledOnce();
    expect(badge(renderer)).toHaveLength(1);
    expect(badge(renderer)[0]?.props['aria-hidden']).toBe(true);
    const id = renderer.root.findByType('a').props['aria-describedby'];
    const description = renderer.root.find((node) => node.type === 'span' && node.props.id === id);
    expect(description.children).toEqual(['In the call']);
  });

  it('marks the originating room of an agent call, not its internal call room', () => {
    markCall('!agent:example.org', room.roomId);
    expect(badge(renderRoomNavItem())).toHaveLength(1);
    markCall(room.roomId, '!origin:example.org');
    expect(badge(renderRoomNavItem())).toHaveLength(0);
  });

  it('does not subscribe to a call in another room', () => {
    const subscribe = markCall('!elsewhere:example.org');
    act(() => {
      renderRoomNavItem();
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('does not mark other rooms or calls that are not live', () => {
    expect(badge(renderRoomNavItem())).toHaveLength(0);
    markCall('!elsewhere:example.org');
    expect(badge(renderRoomNavItem())).toHaveLength(0);
    markCall(room.roomId, undefined, 'failed');
    expect(badge(renderRoomNavItem())).toHaveLength(0);
  });
});

describe('RoomNavItem avatar', () => {
  afterEach(() => {
    testState.avatarMxc = undefined;
    testState.directAvatarMxc = undefined;
    testState.roomAvatarMxc = undefined;
    testState.matrixMxcUrlToHttp.mockClear();
  });

  it('frames the icon of a row shown under the room it is a sub-room of', () => {
    expect(findByTestId(renderRoomNavItem(), 'room-icon')[0]!.props.subRoom).toBe(false);
    expect(findByTestId(renderRoomNavItem({ subRoom: true }), 'room-icon')[0]!.props.subRoom).toBe(
      true
    );
  });

  it('upgrades the privacy icon to the room avatar when avatar state appears', () => {
    const renderer = renderRoomNavItem();

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);

    testState.avatarMxc = 'mxc://example.org/avatar';
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    const images = findByTestId(renderer, 'room-avatar-image');
    expect(images).toHaveLength(1);
    expect(images[0]!.props).toMatchObject({
      alt: 'Agent Room',
      src: 'https://media.example.org/avatar',
    });
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);

    testState.avatarMxc = undefined;
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);
  });

  it('keeps the privacy icon when avatar conversion fails', () => {
    testState.avatarMxc = 'mxc://example.org/invalid';

    const renderer = renderRoomNavItem();

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);
  });

  it('falls back to the privacy icon when the room avatar image fails', () => {
    testState.avatarMxc = 'mxc://example.org/avatar';

    const renderer = renderRoomNavItem();

    act(() => {
      findByTestId(renderer, 'room-avatar-image')[0]!.props.onError();
    });

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);

    testState.avatarMxc = 'mxc://example.org/avatar-2';
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    expect(findByTestId(renderer, 'room-avatar-image')[0]!.props.src).toBe(
      'https://media.example.org/avatar-2'
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('preserves direct-message initials when no avatar is available', () => {
    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(renderer.root.findAllByType('span').some((node) => node.children.includes('A'))).toBe(
      true
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('lazily prefers the direct member avatar and keeps initials on image failure', () => {
    testState.directAvatarMxc = 'mxc://example.org/avatar';
    testState.roomAvatarMxc = 'mxc://example.org/room-avatar';

    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(testState.matrixMxcUrlToHttp).not.toHaveBeenCalled();
    expect(findByTestId(renderer, 'room-avatar-image')[0]!.props.src).toBe(
      'https://media.example.org/avatar'
    );

    act(() => {
      findByTestId(renderer, 'room-avatar-image')[0]!.props.onError();
    });

    expect(renderer.root.findAllByType('span').some((node) => node.children.includes('A'))).toBe(
      true
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('uses the room avatar when a direct member has no avatar', () => {
    testState.roomAvatarMxc = 'mxc://example.org/room-avatar';

    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(testState.matrixMxcUrlToHttp).toHaveBeenCalledTimes(1);
    expect(findByTestId(renderer, 'room-avatar-image')[0]!.props.src).toBe(
      'https://media.example.org/room-avatar'
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });
});

describe('RoomNavItem background jobs', () => {
  afterEach(() => {
    testState.backgroundJobs = [];
  });

  const jobsIndicators = (renderer: ReactTestRenderer) =>
    renderer.root.findAll((node) => node.type === 'i' && node.props.src === 'Clock');

  it('marks a room while an agent has background jobs in it', () => {
    expect(jobsIndicators(renderRoomNavItem())).toHaveLength(0);

    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const indicators = jobsIndicators(renderRoomNavItem());

    expect(indicators).toHaveLength(1);
    expect(indicators[0]!.props['aria-label']).toBe('Background jobs running');
  });

  it('keeps the mark while the row is hovered, so its tooltip can name it', () => {
    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const renderer = renderRoomNavItem();
    act(() => testState.setHover?.(true));

    expect(jobsIndicators(renderer)).toHaveLength(1);
  });
});

describe('RoomNavItem trailing status slot', () => {
  afterEach(() => {
    testState.backgroundJobs = [];
    testState.unread = undefined;
    testState.activeCall = undefined;
  });

  const statusSlots = (renderer: ReactTestRenderer) =>
    findByTestId(renderer, 'unread-badge-center');

  it('omits the status slot on a plain quiet row', () => {
    expect(statusSlots(renderRoomNavItem())).toHaveLength(0);
  });

  it('reserves the status slot on a read row with background jobs and drops it on hover', () => {
    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const renderer = renderRoomNavItem();
    expect(statusSlots(renderer)).toHaveLength(1);
    expect(statusSlots(renderer)[0]!.children).toEqual([]);

    act(() => testState.setHover?.(true));
    expect(statusSlots(renderer)).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.type === 'i' && n.props.src === 'Clock')).toHaveLength(1);
  });

  it('reserves the status slot on a read row in a call and drops it on hover', () => {
    markCall(room.roomId);
    const renderer = renderRoomNavItem();
    expect(statusSlots(renderer)).toHaveLength(1);

    act(() => testState.setHover?.(true));
    expect(statusSlots(renderer)).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.type === 'i' && n.props.src === 'Phone')).toHaveLength(1);
  });

  it('keeps one status slot with the unread badge on an unread row with jobs and drops it on hover', () => {
    testState.unread = { total: 4, highlight: 0 };
    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const renderer = renderRoomNavItem();
    expect(statusSlots(renderer)).toHaveLength(1);
    expect(
      statusSlots(renderer)[0]!.findAll((n) => n.props['data-testid'] === 'unread-badge')
    ).toHaveLength(1);

    act(() => testState.setHover?.(true));
    expect(statusSlots(renderer)).toHaveLength(0);
    expect(findByTestId(renderer, 'unread-badge')).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.type === 'i' && n.props.src === 'Clock')).toHaveLength(1);
  });
});

describe('RoomNavItem activity timestamp', () => {
  afterEach(() => {
    testState.unread = undefined;
    testState.useRelativeTime.mockClear();
  });

  const timeNodes = (renderer: ReactTestRenderer) =>
    renderer.root.findAll(
      (node) => node.type === 'span' && 'data-room-activity-time' in node.props
    );

  it('shows compact relative time on quiet rows and skips the hook when omitted', () => {
    const withoutTime = renderRoomNavItem();
    expect(timeNodes(withoutTime)).toHaveLength(0);
    expect(testState.useRelativeTime).not.toHaveBeenCalled();

    const withTime = renderRoomNavItem({ activityTimestamp: 1700000000000 });
    expect(testState.useRelativeTime).toHaveBeenCalledWith(1700000000000, 'compact');
    expect(timeNodes(withTime)).toHaveLength(1);
    expect(timeNodes(withTime)[0]!.children).toEqual(['compact:1700000000000']);
  });

  it('hides the activity timestamp when unread, muted, or hovered', () => {
    testState.unread = { total: 2, highlight: 0 };
    expect(timeNodes(renderRoomNavItem({ activityTimestamp: 1700000000000 }))).toHaveLength(0);

    testState.unread = undefined;
    expect(
      timeNodes(
        renderRoomNavItem({
          activityTimestamp: 1700000000000,
          notificationMode: RoomNotificationMode.Mute,
        })
      )
    ).toHaveLength(0);

    const quiet = renderRoomNavItem({ activityTimestamp: 1700000000000 });
    expect(timeNodes(quiet)).toHaveLength(1);
    act(() => testState.setHover?.(true));
    expect(timeNodes(quiet)).toHaveLength(0);
  });
});

describe('RoomNavItem direct group count, self-DM tag, draft pencil, and agent chrome', () => {
  afterEach(() => {
    testState.unread = undefined;
    testState.directAvatarMxc = undefined;
    testState.roomAvatarMxc = undefined;
    testState.mDirectContent = undefined;
    testState.matrixMxcUrlToHttp.mockClear();
  });

  const makeDirectRoom = (joined: number, invited = 0, roomId = '!dm-room:example.org') => {
    const emitter = new EventEmitter();
    let joinedCount = joined;
    let invitedCount = invited;
    const mockRoom = Object.assign(emitter, {
      roomId,
      myUserId: '@me:example.org',
      getJoinRule: () => JoinRule.Invite,
      getMxcAvatarUrl: () => testState.roomAvatarMxc,
      getType: () => undefined,
      getJoinedMemberCount: () => joinedCount,
      getInvitedMemberCount: () => invitedCount,
    }) as unknown as Room & {
      setCounts: (nextJoined: number, nextInvited: number) => void;
      setSummaryCounts: (nextJoined: number, nextInvited: number) => void;
    };
    mockRoom.setCounts = (nextJoined: number, nextInvited: number) => {
      joinedCount = nextJoined;
      invitedCount = nextInvited;
      emitter.emit(RoomStateEvent.Members);
    };
    mockRoom.setSummaryCounts = (nextJoined: number, nextInvited: number) => {
      joinedCount = nextJoined;
      invitedCount = nextInvited;
      emitter.emit(RoomEvent.Summary);
    };
    return mockRoom;
  };

  const groupCountNodes = (renderer: ReactTestRenderer) =>
    renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props['data-direct-group-count'] !== undefined
    );
  const selfDmTags = (renderer: ReactTestRenderer) =>
    renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props['data-self-dm-tag'] === 'true'
    );
  const activeDescriptions = (renderer: ReactTestRenderer) => {
    const ids =
      (renderer.root.findByType('a').props['aria-describedby'] as string | undefined)?.split(' ') ??
      [];
    return ids
      .flatMap((id) =>
        renderer.root.findAll((node) => node.type === 'span' && node.props.id === id)
      )
      .filter((node) => node.children.length > 0);
  };

  it('renders an accessible group count avatar (> 2 active members) and updates on Members and Summary events', () => {
    const dm = makeDirectRoom(2, 1);
    const renderer = renderRoomNavItem({ room: dm, direct: true, showAvatar: true });

    const counts = groupCountNodes(renderer);
    expect(counts).toHaveLength(1);
    expect(counts[0]!.props['data-direct-group-count']).toBe(3);
    expect(counts[0]!.props['aria-hidden']).toBe('true');
    expect(renderer.root.findAllByType('span').some((n) => n.children.includes('3'))).toBe(true);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);

    const initialDescriptions = activeDescriptions(renderer);
    expect(initialDescriptions).toHaveLength(1);
    expect(initialDescriptions[0]!.props.hidden).toBe(true);
    expect(initialDescriptions[0]!.children).toEqual(['3 members']);

    // Dropping back to 2 members switches back to the person avatar and drops the group description.
    act(() => dm.setCounts(2, 0));
    expect(groupCountNodes(renderer)).toHaveLength(0);
    expect(activeDescriptions(renderer)).toHaveLength(0);

    // Sync summary updates (lazy-loaded rooms without full member events) also refresh the count.
    act(() => dm.setSummaryCounts(4, 0));
    expect(groupCountNodes(renderer).map((n) => n.props['data-direct-group-count'])).toEqual([4]);
    expect(activeDescriptions(renderer).flatMap((node) => node.children)).toEqual(['4 members']);
  });

  it('formats the group DM count avatar with locale-native digits', async () => {
    const i18n = (await import('../../i18n/i18n')).default;
    const prevLang = i18n.language;
    await act(async () => {
      await i18n.changeLanguage('bn');
    });
    try {
      const renderer = renderRoomNavItem({
        room: makeDirectRoom(3, 0),
        direct: true,
        showAvatar: true,
      });
      expect(groupCountNodes(renderer)[0]!.findByType('span').children).toEqual(['৩']);
    } finally {
      await act(async () => {
        await i18n.changeLanguage(prevLang);
      });
    }
  });

  it('renders a muted "you" tag only for verified self-DMs listed under myUserId in m.direct', () => {
    testState.mDirectContent = { '@me:example.org': ['!dm-self:example.org'] };
    const selfTags = selfDmTags(
      renderRoomNavItem({
        room: makeDirectRoom(1, 0, '!dm-self:example.org'),
        direct: true,
        showAvatar: true,
      })
    );
    expect(selfTags).toHaveLength(1);
    expect(selfTags[0]!.children).toEqual(['you']);

    // Abandoned 1:1 DM (1 active member, mapped to a former partner in m.direct) must NOT show "you".
    testState.mDirectContent = { '@liam:example.org': ['!dm-abandoned:example.org'] };
    expect(
      selfDmTags(
        renderRoomNavItem({
          room: makeDirectRoom(1, 0, '!dm-abandoned:example.org'),
          direct: true,
          showAvatar: true,
        })
      )
    ).toHaveLength(0);

    testState.mDirectContent = { '@me:example.org': ['!dm-1to1:example.org'] };
    expect(
      selfDmTags(
        renderRoomNavItem({
          room: makeDirectRoom(2, 0, '!dm-1to1:example.org'),
          direct: true,
          showAvatar: true,
        })
      )
    ).toHaveLength(0);

    expect(
      selfDmTags(
        renderRoomNavItem({
          room: makeDirectRoom(3, 0, '!dm-group:example.org'),
          direct: true,
          showAvatar: true,
        })
      )
    ).toHaveLength(0);
  });

  it('shows the draft pencil for meaningful text or inline void nodes, ignores whitespace, and never re-renders RoomNavItem', async () => {
    const { useRoomName } = await import('../../matrix/hooks/useRoomMeta');
    const useRoomNameMock = vi.mocked(useRoomName);
    const store = createStore();
    const dm = makeDirectRoom(2, 0, '!draft-dm:example.org');
    const draftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', dm.roomId)
    );
    store.set(draftAtom, []);

    testState.unread = { total: 1, highlight: 0 };
    useRoomNameMock.mockClear();
    const renderer = renderRoomNavItem({ room: dm, direct: true, showAvatar: true }, store);

    const pencils = () =>
      renderer.root.findAll(
        (node) => node.type === 'i' && node.props['data-draft-indicator'] === 'true'
      );
    const draftText = () => activeDescriptions(renderer).flatMap((node) => node.children);

    expect(pencils()).toHaveLength(0);
    const rendersAfterMount = useRoomNameMock.mock.calls.length;

    // Whitespace-only paragraph does not trigger the pencil.
    act(() => {
      store.set(draftAtom, [{ type: 'paragraph', children: [{ text: '   \n\t ' }] }] as never);
    });
    expect(pencils()).toHaveLength(0);

    // Inline void nodes (mention, emoticon, paste marker) count as meaningful drafts even with empty text.
    for (const voidType of [BlockType.Mention, BlockType.Emoticon, BlockType.PasteMarker]) {
      act(() => {
        store.set(draftAtom, [
          {
            type: 'paragraph',
            children: [{ text: '' }, { type: voidType, children: [{ text: '' }] }, { text: '' }],
          },
        ] as never);
      });
      expect(pencils()).toHaveLength(1);
    }

    // Non-whitespace text renders the pencil without re-rendering RoomNavItem itself.
    act(() => {
      store.set(draftAtom, [{ type: 'paragraph', children: [{ text: 'Hello Maya' }] }] as never);
    });
    expect(pencils()).toHaveLength(1);
    expect(pencils()[0]!.props.src).toBe('Pencil');
    expect(pencils()[0]!.props['aria-hidden']).toBe(true);
    expect(useRoomNameMock.mock.calls.length).toBe(rendersAfterMount);
    expect(draftText()).toEqual(['Draft']);

    // Hovering or focusing the row hides the visual pencil for options, while keeping "Draft" in aria-describedby.
    for (const toggle of [testState.setHover, testState.setFocusWithin]) {
      act(() => toggle?.(true));
      expect(pencils()).toHaveLength(0);
      expect(draftText()).toEqual(['Draft']);
      act(() => toggle?.(false));
      expect(pencils()).toHaveLength(1);
    }

    // Clearing the draft removes both the pencil and the hidden description without re-rendering RoomNavItem.
    const rendersBeforeClear = useRoomNameMock.mock.calls.length;
    act(() => {
      store.set(draftAtom, []);
    });
    expect(pencils()).toHaveLength(0);
    expect(draftText()).toEqual([]);
    expect(useRoomNameMock.mock.calls.length).toBe(rendersBeforeClear);
  });

  it('supports nameOverride, fallbackAvatarMxc, and function-form avatarBadge wired to aria-describedby', () => {
    const renderer = renderRoomNavItem({
      room: makeDirectRoom(2, 0, '!agent-dm:example.org'),
      direct: true,
      showAvatar: true,
      nameOverride: 'DevAgent',
      fallbackAvatarMxc: 'mxc://example.org/avatar-dev',
      avatarBadge: (descriptionId) =>
        React.createElement(
          React.Fragment,
          null,
          React.createElement('span', { 'data-agent-active-run': 'true', 'aria-hidden': 'true' }),
          React.createElement('span', { id: descriptionId, hidden: true }, 'Agent active')
        ),
    });

    expect(renderer.root.findAllByType('span').some((n) => n.children.includes('DevAgent'))).toBe(
      true
    );
    expect(findByTestId(renderer, 'room-avatar-image')[0]!.props.src).toBe(
      'https://media.example.org/avatar-dev'
    );
    expect(
      renderer.root.findAll((node) => node.props['data-agent-active-run'] === 'true')
    ).toHaveLength(1);
    const badgeDescs = activeDescriptions(renderer);
    expect(badgeDescs).toHaveLength(1);
    expect(badgeDescs[0]!.props.hidden).toBe(true);
    expect(badgeDescs[0]!.children).toEqual(['Agent active']);
  });

  it('places the draft pencil before background-job and call marks so hiding it on hover/focus does not shift them', () => {
    const store = createStore();
    const room = makeDirectRoom(2, 0, '!draft-clock-dm:example.org');
    const draftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!draft-clock-dm:example.org')
    );
    store.set(draftAtom, [{ type: 'paragraph', children: [{ text: 'Draft note' }] }] as never);
    testState.backgroundJobs = [{ jobId: 'job-1' }];
    markCall(room.roomId);

    try {
      const renderer = renderRoomNavItem({ room, direct: true, showAvatar: true }, store);
      const trailingIcons = () =>
        renderer.root
          .findAll(
            (node) => node.type === 'i' && ['Pencil', 'Clock', 'Phone'].includes(node.props.src)
          )
          .map((node) => node.props.src);

      expect(trailingIcons()).toEqual(['Pencil', 'Clock', 'Phone']);
      expect(findByTestId(renderer, 'unread-badge-center')).toHaveLength(1);

      for (const toggle of [testState.setHover, testState.setFocusWithin]) {
        act(() => toggle?.(true));
        expect(trailingIcons()).toEqual(['Clock', 'Phone']);
        expect(findByTestId(renderer, 'unread-badge-center')).toHaveLength(0);
        act(() => toggle?.(false));
        expect(trailingIcons()).toEqual(['Pencil', 'Clock', 'Phone']);
        expect(findByTestId(renderer, 'unread-badge-center')).toHaveLength(1);
      }
    } finally {
      testState.backgroundJobs = [];
      testState.activeCall = undefined;
    }
  });
});
