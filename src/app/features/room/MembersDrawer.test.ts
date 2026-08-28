import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import { MembersDrawer } from './MembersDrawer';

const { permissionState } = vi.hoisted(() => ({
  permissionState: {
    canInvite: true,
    canKick: true,
  },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const reactModule = await import('react');

  return {
    ...actual,
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Badge: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: reactModule.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
      ({ children }, ref) => reactModule.createElement('div', { ref }, children)
    ),
    Chip: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      reactModule.createElement('button', { type: 'button', ...props }, children),
    Header: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    IconButton: reactModule.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
    >(({ children, ...props }, ref) =>
      reactModule.createElement('button', { ref, type: 'button', ...props }, children)
    ),
    Icons: {
      ChevronTop: 'ChevronTop',
      Cross: 'Cross',
      Filter: 'Filter',
      Search: 'Search',
      Sort: 'Sort',
      User: 'User',
      UserPlus: 'UserPlus',
    },
    Input: reactModule.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => reactModule.createElement('input', { ref, ...props })
    ),
    MenuItem: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      reactModule.createElement('button', { type: 'button', ...props }, children),
    PopOut: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children, content),
    Scroll: reactModule.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
      ({ children }, ref) => reactModule.createElement('div', { ref }, children)
    ),
    Spinner: () => reactModule.createElement('div'),
    Text: ({
      as,
      children,
      ...props
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      children?: React.ReactNode;
    }) => reactModule.createElement(as ?? 'span', props, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<HTMLButtonElement>) => React.ReactNode;
    }) =>
      reactModule.createElement(
        reactModule.Fragment,
        null,
        children(() => undefined)
      ),
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S200: '8px',
        S300: '12px',
      },
    },
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollToOffset: vi.fn(),
  }),
}));

vi.mock('./MembersDrawer.css', () => ({
  DrawerGroup: 'DrawerGroup',
  DrawerScrollTop: 'DrawerScrollTop',
  DrawerVirtualItem: 'DrawerVirtualItem',
  MemberDrawerContent: 'MemberDrawerContent',
  MemberDrawerContentBase: 'MemberDrawerContentBase',
  MembersDrawer: 'MembersDrawer',
  MembersDrawerHeader: 'MembersDrawerHeader',
  MembersGroup: 'MembersGroup',
  MembersGroupLabel: 'MembersGroupLabel',
}));

vi.mock('../../components/invite-user-prompt', () => ({
  InviteUserPrompt: () => React.createElement('div', { 'data-testid': 'invite-user-prompt' }),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:example.org',
  }),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useAsyncSearch', () => ({
  useAsyncSearch: () => [undefined, vi.fn(), vi.fn()],
}));

vi.mock('../../hooks/useDebounce', () => ({
  useDebounce: (callback: unknown) => callback,
}));

vi.mock('../../hooks/useRoomTypingMembers', () => ({
  useRoomTypingMember: () => [],
}));

vi.mock('../../hooks/useMemberFilter', () => ({
  MembershipFilter: {
    filterKnocked: (member: { membership: string }) => member.membership === 'knock',
  },
  useMembershipFilter: (
    index: number,
    items: Array<{ name: string; filterFn: (member: { membership: string }) => boolean }>
  ) => items[index] ?? items[0],
  useMembershipFilterMenu: () => [
    { name: 'Joined', filterFn: (member: { membership: string }) => member.membership === 'join' },
  ],
}));

vi.mock('../../hooks/useMemberSort', () => ({
  MemberSort: {
    NewestFirst: () => 0,
  },
  useMemberPowerSort: () => () => 0,
  useMemberSort: () => ({ name: 'A-Z', sortFn: () => 0 }),
  useMemberSortMenu: () => [],
}));

vi.mock('../../hooks/useMemberPowerTag', () => ({
  useFlattenPowerTagMembers: (members: unknown[]) => members,
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  useGetMemberPowerLevel: () => () => 0,
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set<string>(),
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: (action: string) =>
      action === 'invite' ? permissionState.canInvite : permissionState.canKick,
  }),
}));

vi.mock('../../hooks/useMemberPowerCompare', () => ({
  useMemberPowerCompare: () => ({ hasMorePower: () => true }),
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetSetting: () => vi.fn(),
  useSetting: () => [0, vi.fn()],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../state/hooks/userRoomProfile', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
  useUserRoomProfileState: () => undefined,
}));

vi.mock('../../hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../components/scroll-top-container', () => ({
  ScrollTopContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/typing-indicator', () => ({
  TypingIndicator: () => React.createElement('div'),
}));

vi.mock('../../components/user-avatar', () => ({
  UserAvatar: () => React.createElement('div'),
}));

vi.mock('../../components/MembershipFilterMenu', () => ({
  MembershipFilterMenu: ({
    items,
    onSelect,
  }: {
    items: Array<{ name: string }>;
    onSelect: (index: number) => void;
  }) =>
    React.createElement(
      'div',
      null,
      items.map((item, index) =>
        React.createElement(
          'button',
          {
            'data-testid': `membership-filter-${index}`,
            key: item.name,
            onClick: () => onSelect(index),
            type: 'button',
          },
          item.name
        )
      )
    ),
}));

vi.mock('../../components/MemberSortMenu', () => ({
  MemberSortMenu: () => React.createElement('div'),
}));

vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../styles/Text.css', () => ({
  BreakWord: 'BreakWord',
}));

vi.mock('../../utils/room', () => ({
  getMemberDisplayName: () => undefined,
  getMemberSearchStr: () => '',
}));

vi.mock('../../utils/matrix', () => ({
  getMxIdLocalPart: (mxId: string) => mxId.split(':')[0]?.replace('@', '') ?? mxId,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../plugins/millify', () => ({
  millify: (value: number) => String(value),
}));

const createRoom = (): Room =>
  ({
    roomId: '!room:example.org',
    getJoinedMemberCount: () => 3,
  } as Room);

describe('MembersDrawer', () => {
  beforeEach(() => {
    permissionState.canInvite = true;
    permissionState.canKick = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the standard invite prompt from the member drawer header invite button', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(), members: [] }));
    });

    const inviteButton = renderer?.root.findByProps({ 'aria-label': 'Invite people' });
    expect(renderer?.root.findAllByProps({ 'data-testid': 'invite-user-prompt' })).toHaveLength(0);

    act(() => {
      inviteButton?.props.onClick();
    });

    expect(renderer?.root.findAllByProps({ 'data-testid': 'invite-user-prompt' })).toHaveLength(1);
  });

  it('disables the member drawer invite button when the current user cannot invite', () => {
    permissionState.canInvite = false;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(), members: [] }));
    });

    const inviteButton = renderer?.root.findByProps({ 'aria-label': 'Invite people' });
    expect(inviteButton?.props.disabled).toBe(true);
  });

  it('offers a counted requests filter to moderators and selects it without changing the default', () => {
    const members = [
      { membership: 'knock', userId: '@alice:example.org' },
      { membership: 'knock', userId: '@bob:example.org' },
    ];
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members,
        })
      );
    });

    expect(renderer?.root.findAllByProps({ children: 'Joined' }).length).toBeGreaterThan(0);
    const requestsFilter = renderer?.root.findByProps({
      'data-testid': 'membership-filter-1',
    });
    expect(requestsFilter?.children).toEqual(['Requests (2)']);

    act(() => {
      requestsFilter?.props.onClick();
    });

    expect(renderer?.root.findAllByProps({ children: 'Requests (2)' }).length).toBeGreaterThan(0);
  });

  it('does not expose join requests when the current user cannot approve or decline them', () => {
    permissionState.canInvite = false;
    permissionState.canKick = false;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(renderer?.root.findAllByProps({ 'data-testid': 'membership-filter-1' })).toHaveLength(0);
  });
});
