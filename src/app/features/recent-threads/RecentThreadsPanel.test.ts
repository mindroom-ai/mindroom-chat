import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentThreadsPanel } from './RecentThreadsPanel';
import { buildVisibleRecentThreadEntries } from './recentThreadsPanelUtils';

vi.mock('./recentThreads.css', () => ({
  EmptyState: 'EmptyState',
  PageNavSection: 'PageNavSection',
  Panel: 'Panel',
  PanelBody: 'PanelBody',
  PanelHeader: 'PanelHeader',
  PanelList: 'PanelList',
}));

vi.mock('./RecentThreadEntry', () => ({
  RecentThreadEntry: () => null,
}));

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
