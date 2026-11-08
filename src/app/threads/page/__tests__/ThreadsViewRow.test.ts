// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { ThreadsViewRow } from '../ThreadsViewRow';
import type { CrossRoomThreadIndexEntry } from '../../cross-room/crossRoomThreadIndex';
import { trustAgentsOfViewer } from '../../../matrix/protocol/untrustedContent';
import { putSession } from '../../../matrix/session/sessions';

const { navigateRoomThreadMock, roots } = vi.hoisted(() => ({
  navigateRoomThreadMock: vi.fn(),
  /** The room's thread roots by ID. */
  roots: new Map<string, unknown>(),
}));

vi.mock('../../useInitializeShownThread', () => ({
  useInitializeShownThread: () => undefined,
}));
vi.mock('../ThreadsView.css', () => ({
  Row: 'row',
  RowChrome: 'row-chrome',
  Chip: 'chip',
}));

vi.mock('folds', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  Icon: () => React.createElement('span', null),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement('span', props, children),
  Icons: {
    Hash: 'Hash',
    Space: 'Space',
  },
}));

vi.mock('../../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@me:example.org',
    getRoom: (roomId: string) =>
      roomId === '!room:example.org'
        ? {
            roomId,
            name: 'Room',
            isSpaceRoom: () => false,
            getUnfilteredTimelineSet: () => ({ findEventById: (id: string) => roots.get(id) }),
            getThread: () => null,
          }
        : { roomId, name: 'Space', isSpaceRoom: () => true },
  }),
}));

vi.mock('../../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: navigateRoomThreadMock }),
}));

vi.mock('../../overview/compactThreadCardViewModel', () => ({
  buildCompactThreadCardViewModelFromRecord: () => ({
    id: { roomId: '!room:example.org', threadRootId: '$root' },
    titleText: 'Thread',
    displayTitleText: 'Thread',
    previewText: 'Preview',
    messageCount: 1,
    messageCountLabel: '1 msg',
    messageCountText: '1',
    attentionState: 'idle',
    attentionStatusText: 'Idle',
    participants: [],
    tags: [],
    isResolved: false,
    isUnread: false,
    isStreaming: false,
  }),
}));

vi.mock('../../overview/CompactThreadCard', () => ({
  CompactThreadCard: ({
    onClick,
    attachment,
  }: {
    onClick: () => void;
    attachment?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      null,
      React.createElement('button', { type: 'button', onClick }, 'card'),
      attachment
    ),
}));

vi.mock('../../../calls/transcription/CallRow', () => ({
  CallRow: ({ mEvent }: { mEvent: MatrixEvent }) =>
    React.createElement('div', { 'data-call-row-stub': mEvent.getId() }),
}));

const entry = {
  roomId: '!room:example.org',
  roomName: 'Room',
  parentSpaceIds: ['!space:example.org'],
  threadRootId: '$root',
  threadRecord: {},
} as CrossRoomThreadIndexEntry;

describe('ThreadsViewRow', () => {
  it('renders room context and navigates with navigateRoomThread', () => {
    const renderer = create(React.createElement(ThreadsViewRow, { entry }));

    expect(renderer.root.findAllByProps({ children: 'Room' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'Space' }).length).toBeGreaterThan(0);

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith('!room:example.org', '$root');
  });

  it.each([
    ['a live call', { call_id: 'call-1' }, 1],
    [
      'an ended call',
      { call_id: 'call-1', ended_at: '2026-11-07T10:00:00Z', duration_seconds: 720 },
      0,
    ],
  ])(
    "%s: the card shows the call's row only while the call is live, as the room's compact list does",
    async (_name, call, shown) => {
      trustAgentsOfViewer('@me:example.org');
      // Rows count from the active account's agents.
      putSession(
        {
          baseUrl: 'https://matrix.example',
          userId: '@me:example.org',
          deviceId: 'DEVICE',
          accessToken: 'token',
        },
        { setActive: true }
      );
      roots.set(
        '$root',
        new MatrixEvent({
          type: 'm.room.message',
          room_id: '!room:example.org',
          event_id: '$root',
          sender: '@mindroom_router:example.org',
          origin_server_ts: 1,
          content: {
            msgtype: 'm.notice',
            body: 'Call started',
            'io.mindroom.call': call,
          },
        } as Partial<IEvent>)
      );
      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = create(React.createElement(ThreadsViewRow, { entry }));
      });
      // The row loads on first use.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const rows = renderer?.root.findAll((node) => node.props['data-call-row-stub'] === '$root');
      expect(rows).toHaveLength(shown);
    }
  );
});
