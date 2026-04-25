import React from 'react';
import { getDefaultStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { clearRecentThreadsStore } from '../../state/recentThreads';
import { RecentThreadsPageNav, RecentThreadsPanel } from './RecentThreadsPanel';
import { buildVisibleRecentThreadEntries } from './recentThreadsPanelUtils';

vi.mock('./recentThreads.css', () => ({
  EmptyState: 'EmptyState',
  Divider: 'Divider',
  DividerActive: 'DividerActive',
  DividerHandle: 'DividerHandle',
  DividerToggle: 'DividerToggle',
  DividerToggleHandle: 'DividerToggleHandle',
  PageNavSection: 'PageNavSection',
  Panel: 'Panel',
  PanelBody: 'PanelBody',
  PanelHeader: 'PanelHeader',
  PanelList: 'PanelList',
}));

vi.mock('./RecentThreadEntry', () => ({
  RecentThreadEntry: ({ threadId }: { threadId: string }) =>
    React.createElement('button', { 'data-recent-thread-id': threadId }, threadId),
}));

const mxMock = {
  getUserId: vi.fn(() => '@alice:example.org'),
  getRoom: vi.fn(),
};

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mxMock,
}));

const RECENT_THREADS_STORAGE_KEY = 'recentThreads:@alice:example.org';

const createStorage = (): Storage => {
  const state = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
    key: vi.fn(() => null),
    length: 0,
  };
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      clearTimeout,
      innerHeight: 900,
      removeEventListener: vi.fn(),
      setTimeout,
    },
  });
});

describe('buildVisibleRecentThreadEntries', () => {
  it('keeps only joined rooms in the visible panel entries', () => {
    const joinedRoom = {
      roomId: '!joined:example.org',
      getMyMembership: () => 'join',
    } as unknown as Room;
    const leftRoom = {
      roomId: '!left:example.org',
      getMyMembership: () => 'leave',
    } as unknown as Room;

    const visibleEntries = buildVisibleRecentThreadEntries(
      (roomId) =>
        ({
          '!joined:example.org': joinedRoom,
          '!left:example.org': leftRoom,
        }[roomId]),
      [
        { roomId: '!joined:example.org', threadId: '$joined', openedAt: 3 },
        { roomId: '!left:example.org', threadId: '$left', openedAt: 2 },
        { roomId: '!missing:example.org', threadId: '$missing', openedAt: 1 },
      ]
    );

    expect(visibleEntries).toEqual([
      {
        roomId: '!joined:example.org',
        threadId: '$joined',
        openedAt: 3,
        room: joinedRoom,
      },
    ]);
  });
});

describe('RecentThreadsPanel', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    localStorage.removeItem(RECENT_THREADS_STORAGE_KEY);
    clearRecentThreadsStore('@alice:example.org');
    getDefaultStore().set(allRoomsAtom, { type: 'INITIALIZE', rooms: [] });
    mxMock.getRoom.mockReset();
  });

  it('keeps the desktop header as a static h2 heading', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadsPanel, {
          entries: [],
          height: 32,
          collapsed: true,
        })
      );
    });

    const heading = renderer!.root.find(
      (node) => typeof node.type === 'string' && node.type === 'h2'
    );

    expect(heading.children).toContain('Recent Threads');
  });

  it('renders no static header shell for the collapsed mobile toggle variant', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadsPanel, {
          entries: [],
          height: 0,
          collapsed: true,
          showHeader: false,
        })
      );
    });

    expect(renderer!.toJSON()).toBeNull();
  });
});

describe('RecentThreadsPageNav', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    localStorage.removeItem(RECENT_THREADS_STORAGE_KEY);
    clearRecentThreadsStore('@alice:example.org');
    getDefaultStore().set(allRoomsAtom, { type: 'INITIALIZE', rooms: [] });
    mxMock.getRoom.mockReset();
  });

  it('recomputes visible recent threads when the room list arrives after storage hydration', () => {
    const joinedRoom = {
      roomId: '!room:example.org',
      getMyMembership: () => 'join',
    } as unknown as Room;
    let roomAvailable = false;
    mxMock.getRoom.mockImplementation((roomId: string) =>
      roomAvailable && roomId === '!room:example.org' ? joinedRoom : undefined
    );
    localStorage.setItem(
      RECENT_THREADS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entries: [
          {
            roomId: '!room:example.org',
            threadId: '$thread',
            openedAt: 123,
            summaryText: 'Cached recent thread',
          },
        ],
      })
    );

    act(() => {
      renderer = create(
        React.createElement(
          ScreenSizeProvider,
          { value: ScreenSize.Desktop },
          React.createElement(
            RecentThreadsPageNav,
            null,
            React.createElement('div', null, 'children')
          )
        )
      );
    });

    expect(
      renderer!.root.findAll(
        (node) => node.props['data-recent-thread-id'] === '$thread'
      )
    ).toHaveLength(0);

    act(() => {
      roomAvailable = true;
      getDefaultStore().set(allRoomsAtom, {
        type: 'INITIALIZE',
        rooms: ['!room:example.org'],
      });
    });

    expect(
      renderer!.root.findAll(
        (node) => node.props['data-recent-thread-id'] === '$thread'
      )
    ).toHaveLength(1);
  });
});
