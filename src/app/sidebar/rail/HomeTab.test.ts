import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeTab } from './HomeTab';
import { ScreenSize } from '../../lib/hooks/useScreenSize';

const state = vi.hoisted(() => ({
  selected: false,
  mobile: false,
  directShown: true,
  homeRooms: [] as string[],
  directRooms: [] as string[],
  roomsUnreadCalls: [] as string[][],
}));
vi.mock('../../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => (state.mobile ? ScreenSize.Mobile : ScreenSize.Desktop),
}));

const { navigate, navToActivePathAtom, mDirectAtomToken, roomToParentsAtomToken } = vi.hoisted(
  () => ({
    navigate: vi.fn(),
    navToActivePathAtom: {},
    mDirectAtomToken: {},
    roomToParentsAtomToken: {},
  })
);

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Icon: () => reactModule.createElement('i'),
    Icons: {
      Home: 'Home',
      CheckTwice: 'CheckTwice',
    },
    Menu: ({ children, ref }: { children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) =>
      reactModule.createElement('div', { ref }, children),
    MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
      reactModule.createElement('button', { type: 'button', onClick }, children),
    PopOut: ({ content }: { content: React.ReactNode }) =>
      reactModule.createElement('div', null, content),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    config: { space: { S100: '8px' } },
    toRem: () => '10rem',
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: vi.fn((atom: unknown) => {
      if (atom === navToActivePathAtom) {
        return new Map([
          [
            'home',
            {
              pathname: '/home/%23room%3Amindroom.chat',
              search: '?threadId=%24thread',
              hash: '',
            },
          ],
        ]);
      }
      if (atom === mDirectAtomToken) {
        return new Set();
      }
      if (atom === roomToParentsAtomToken) {
        return new Map();
      }

      return undefined;
    }),
  };
});

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../matrix/state/mDirectList', () => ({
  mDirectAtom: mDirectAtomToken,
}));

vi.mock('../../matrix/state/roomToParents', () => ({
  roomToParentsAtom: roomToParentsAtomToken,
}));

vi.mock('../../matrix/state/roomList', () => ({
  allRoomsAtom: {},
}));

vi.mock('../../matrix/state/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../matrix/state/useUnread', () => ({
  useRoomsUnread: (rooms: string[]) => {
    state.roomsUnreadCalls.push(rooms);
    return undefined;
  },
}));

vi.mock('../../settings/railButtons', () => ({
  useRailButtons: () => ({ direct: state.directShown }),
}));

vi.mock('../direct/useDirectRooms', () => ({
  useDirectRoomIds: () => state.directRooms,
}));

vi.mock('../../ui/sidebar/SidebarItem', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarItemTooltip: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
    React.createElement(
      'div',
      null,
      children(() => undefined)
    ),
  SidebarItemBadge: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarAvatar: ({
    children,
    ref,
    ...props
  }: React.ComponentPropsWithRef<'button'> & {
    children: React.ReactNode;
  }) => React.createElement('button', { ref, type: 'button', ...props }, children),
}));

vi.mock('../../routes/useHomeSelected', () => ({
  useHomeSelected: () => state.selected,
}));

vi.mock('../../ui/UnreadBadge', () => ({
  UnreadBadge: () => React.createElement('div'),
}));

vi.mock('../../routes/useNavToActivePath', () => ({
  useNavToActivePathAtom: () => navToActivePathAtom,
}));

vi.mock('../../matrix/state/useHomeRooms', () => ({
  useHomeRooms: () => state.homeRooms,
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
}));

vi.mock('../../lib/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../preferences/useSetting', () => ({
  useSetting: () => [false],
}));

vi.mock('../../preferences/settings', () => ({
  settingsAtom: {},
}));

describe('HomeTab', () => {
  afterEach(() => {
    navigate.mockReset();
    state.selected = false;
    state.mobile = false;
    state.directShown = true;
    state.homeRooms = [];
    state.directRooms = [];
    state.roomsUnreadCalls = [];
  });

  it('restores the saved home path when the home tab is clicked', async () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(HomeTab));
    });

    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });

    expect(navigate).toHaveBeenCalledWith('/home/%23room%3Amindroom.chat?threadId=%24thread');
  });

  it('preserves the current route when the navigation panel handles the click', async () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(HomeTab, { onSelect: () => true }));
    });
    await act(() => renderer.root.findByType('button').props.onClick());
    expect(navigate).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it.each([false, true])(
    'shows the home list on mobile unless already selected: %s',
    async (selected) => {
      state.mobile = true;
      state.selected = selected;
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(React.createElement(HomeTab));
      });
      await act(() => renderer.root.findByType('button').props.onClick());
      expect(navigate).toHaveBeenCalledWith(
        selected ? '/home/%23room%3Amindroom.chat?threadId=%24thread' : '/home/'
      );
      act(() => renderer.unmount());
    }
  );

  it('keeps direct rooms out of Home unread counts while the Direct Messages rail button is shown', () => {
    state.directShown = true;
    state.homeRooms = ['!general:example.org'];
    state.directRooms = ['!dm-maya:example.org'];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(HomeTab));
    });
    expect(state.roomsUnreadCalls.at(-1)).toEqual(['!general:example.org']);
    act(() => renderer.unmount());
  });

  it('rolls direct room unreads into Home when the Direct Messages rail button is hidden', () => {
    state.directShown = false;
    state.homeRooms = ['!general:example.org'];
    state.directRooms = ['!dm-maya:example.org', '!dm-dev:example.org'];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(HomeTab));
    });
    expect(state.roomsUnreadCalls.at(-1)).toEqual([
      '!general:example.org',
      '!dm-maya:example.org',
      '!dm-dev:example.org',
    ]);
    act(() => renderer.unmount());
  });
});
