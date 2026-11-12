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

vi.mock('../ui/page/style.css', () => ({
  PageNavHeader: 'nav-header',
  PageNavHeaderScroll: 'nav-scroll',
  PageNavContent: 'nav-content',
  PageNavScrollbar: 'nav-scrollbar',
}));

vi.mock('./MembersDrawer.css', () => ({
  DrawerVirtualItem: 'DrawerVirtualItem',
  MemberDrawerContentBase: 'MemberDrawerContentBase',
  MembersHeaderControl: 'MembersHeaderControl',
  MembersHeaderCount: 'MembersHeaderCount',
  MembersHeaderInvited: 'MembersHeaderInvited',
  MembersDrawer: 'MembersDrawer',
  MembersGroupLabel: 'MembersGroupLabel',
}));

vi.mock('./MembersInviteSection', () => ({
  MembersInviteSection: ({ query }: { query: string }) =>
    React.createElement('div', { 'data-testid': 'invite-section', 'data-query': query }),
}));

vi.mock('./invite/InviteUserPrompt', () => ({
  InviteUserPrompt: () => React.createElement('div', { 'data-testid': 'invite-user-prompt' }),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:example.org',
  }),
}));

vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../lib/hooks/useAsyncSearch', () => ({
  useAsyncSearch: () => [undefined, vi.fn(), vi.fn()],
}));

vi.mock('../lib/hooks/useDebounce', () => ({
  useDebounce: (callback: unknown) => callback,
}));

vi.mock('../timeline/typing/useRoomTypingMembers', () => ({
  useRoomTypingMember: () => [],
}));

vi.mock('./useMemberFilter', () => {
  const filterInvited = (member: { membership: string }) => member.membership === 'invite';
  return {
    MembershipFilter: {
      filterInvited,
      filterKnocked: (member: { membership: string }) => member.membership === 'knock',
    },
    useMembershipFilterMenu: () => [
      {
        name: 'Joined',
        filterFn: (member: { membership: string }) => member.membership === 'join',
      },
      { name: 'Invited', filterFn: filterInvited },
    ],
  };
});

vi.mock('./useMemberSort', () => ({
  MemberSort: {
    NewestFirst: () => 0,
  },
  useMemberSort: () => ({ name: 'A-Z', sortFn: () => 0 }),
  useMemberSortMenu: () => [],
}));

vi.mock('./useMemberPowerTag', () => ({
  useFlattenPowerTagMembers: (members: unknown[]) => members,
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../matrix/hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set<string>(),
}));

vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: (action: string) =>
      action === 'invite' ? permissionState.canInvite : permissionState.canKick,
  }),
}));

vi.mock('../preferences/useSetting', () => ({
  useSetting: () => [0, vi.fn()],
}));

vi.mock('./useMembersDrawer', () => ({
  useMembersDrawer: () => [true, vi.fn()],
}));

vi.mock('../preferences/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../navigation/useUserRoomProfileState', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
  useUserRoomProfileState: () => undefined,
}));

vi.mock('../matrix/hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../ui/ScrollTopContainer', () => ({
  ScrollTopContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../avatars/UserAvatar', () => ({
  UserAvatar: () => React.createElement('div'),
}));

vi.mock('./MembershipFilterMenu', () => ({
  MembershipFilterMenu: ({
    items,
    onSelect,
    selected,
  }: {
    items: Array<{ name: string }>;
    onSelect: (index: number) => void;
    selected: number;
  }) =>
    React.createElement(
      'div',
      { 'data-selected': selected, 'data-testid': 'membership-filter-menu' },
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

vi.mock('./MemberSortMenu', () => ({
  MemberSortMenu: () => React.createElement('div'),
}));

vi.mock('../ui/styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../ui/styles/Text.css', () => ({
  BreakWord: 'BreakWord',
}));

vi.mock('../matrix/room', () => ({
  getMemberDisplayName: () => undefined,
}));

vi.mock('../matrix/matrix', () => ({
  getMxIdLocalPart: (mxId: string) => mxId.split(':')[0]?.replace('@', '') ?? mxId,
  mxcUrlToHttp: () => undefined,
}));

const createRoom = (invitedCount = 0): Room =>
  ({
    roomId: '!room:example.org',
    getJoinedMemberCount: () => 3,
    getInvitedMemberCount: () => invitedCount,
  } as Room);

const hasVisibleFilterLabel = (renderer: ReactTestRenderer | undefined, label: string): boolean =>
  renderer?.root.findAllByType('span').some((element) => element.children.includes(label)) ?? false;

const findButtonsWithLabel = (renderer: ReactTestRenderer | undefined, label: string) =>
  renderer?.root
    .findAllByType('button')
    .filter((button) =>
      button.findAllByType('span').some((element) => element.children.includes(label))
    ) ?? [];

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

  it('opens on the counted requests filter when a moderator has pending requests', () => {
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

    expect(hasVisibleFilterLabel(renderer, 'Requests (2)')).toBe(true);
  });

  it('opens on Joined when a moderator has no pending requests', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members: [{ membership: 'join', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);
  });

  it('shows pending requests that load before a moderator chooses a filter', () => {
    const room = createRoom();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room, members: [] }));
    });
    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);

    act(() => {
      renderer?.update(
        React.createElement(MembersDrawer, {
          room,
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Requests (1)')).toBe(true);
  });

  it('keeps a manual Joined selection when pending requests update', () => {
    const room = createRoom();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(MembersDrawer, {
          room,
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });
    expect(hasVisibleFilterLabel(renderer, 'Requests (1)')).toBe(true);

    act(() => {
      renderer?.root.findByProps({ 'data-testid': 'membership-filter-0' }).props.onClick();
    });
    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);

    act(() => {
      renderer?.update(
        React.createElement(MembersDrawer, {
          room,
          members: [
            { membership: 'knock', userId: '@alice:example.org' },
            { membership: 'knock', userId: '@bob:example.org' },
          ],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);
  });

  it('shows pending invites next to the member count and opens the Invited filter on click', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(1), members: [] }));
    });
    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);

    const invitedButtons = findButtonsWithLabel(renderer, '1 Invited');
    expect(invitedButtons).toHaveLength(1);

    act(() => {
      invitedButtons[0].props.onClick();
    });

    expect(hasVisibleFilterLabel(renderer, 'Invited')).toBe(true);
  });

  it('keeps the Invited filter chosen from the header when join requests arrive', () => {
    const room = createRoom(2);
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room, members: [] }));
    });
    act(() => {
      findButtonsWithLabel(renderer, '2 Invited')[0].props.onClick();
    });
    expect(hasVisibleFilterLabel(renderer, 'Invited')).toBe(true);

    act(() => {
      renderer?.update(
        React.createElement(MembersDrawer, {
          room,
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Invited')).toBe(true);
  });

  it('shows only the member count when there are no pending invites', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(), members: [] }));
    });

    expect(hasVisibleFilterLabel(renderer, '3 Members')).toBe(true);
    expect(
      renderer?.root
        .findAllByType('span')
        .some((element) =>
          element.children.some((child) => typeof child === 'string' && /Invited|·/.test(child))
        )
    ).toBe(false);
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

    expect(renderer?.root.findAllByProps({ 'data-testid': 'membership-filter-2' })).toHaveLength(0);
  });

  it('resets the selected filter when request-review permission is removed', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Requests (1)')).toBe(true);

    permissionState.canInvite = false;
    permissionState.canKick = false;
    act(() => {
      renderer?.update(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);

    permissionState.canInvite = true;
    act(() => {
      renderer?.update(
        React.createElement(MembersDrawer, {
          room: createRoom(),
          members: [{ membership: 'knock', userId: '@alice:example.org' }],
        })
      );
    });

    expect(hasVisibleFilterLabel(renderer, 'Joined')).toBe(true);
  });

  it('lists people to invite under the search for someone who may invite', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(), members: [] }));
    });

    const search = renderer?.root.findByType('input');
    expect(search?.props.placeholder).toBe('Search or invite people...');
    // Mounted without a search, for an invitation still going when the search was cleared.
    const section = () => renderer?.root.findByProps({ 'data-testid': 'invite-section' });
    expect(section()?.props['data-query']).toBe('');

    act(() => {
      search?.props.onChange({ target: { value: 'ma' } });
    });

    expect(section()?.props['data-query']).toBe('ma');
    // People outside the room may match under the section's line, so the empty line is for members.
    expect(hasVisibleFilterLabel(renderer, 'No matching members')).toBe(true);
  });

  it('only searches members for someone who may not invite', () => {
    permissionState.canInvite = false;
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(MembersDrawer, { room: createRoom(), members: [] }));
    });

    const search = renderer?.root.findByType('input');
    expect(search?.props.placeholder).toBe('Type name...');
    act(() => {
      search?.props.onChange({ target: { value: 'ma' } });
    });

    expect(renderer?.root.findAllByProps({ 'data-testid': 'invite-section' })).toHaveLength(0);
    expect(hasVisibleFilterLabel(renderer, 'No Results')).toBe(true);
  });
});
