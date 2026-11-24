import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@me:server',
    getHomeserverUrl: () => 'https://matrix.example',
  }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

// eslint-disable-next-line import/first
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';

const makeRoom = (): Room =>
  ({
    roomId: '!room:server',
    getThread: () => null,
    findEventById: () => undefined,
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    getMember: () => undefined,
    getMembers: () => [],
  } as unknown as Room);

const makeRecord = (threadRootId: string, messageCount: number): ThreadRecord =>
  ({
    roomId: '!room:server',
    threadRootId,
    presentation: {
      messageCount,
      participantIds: [],
      rootPreviewText: `root of ${threadRootId}`,
      latestReplyPreviewText: `latest of ${threadRootId}`,
      lastSenderId: '@other:server',
      lastSenderDisplayName: 'Other',
      recentThreadSummaryText: undefined,
    },
    status: {
      isResolved: false,
      isStreaming: false,
      isUnread: false,
      hasPendingSend: false,
      tags: [],
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      lastActivityTs: 1000,
    },
  } as unknown as ThreadRecord);

type HarnessProps = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onViewModels: (viewModels: CompactThreadCardViewModel[]) => void;
};

function Harness({ room, threadRootIds, threadRecordMap, onViewModels }: HarnessProps) {
  onViewModels(useCompactThreadCardViewModels({ room, threadRootIds, threadRecordMap }));
  return null;
}

describe('useCompactThreadCardViewModels identity reuse', () => {
  it('keeps view-model identity when records are rebuilt with identical content', () => {
    const room = makeRoom();
    const threadRootIds = ['$a', '$b'];
    let latest: CompactThreadCardViewModel[] = [];
    const render = (map: ReadonlyMap<string, ThreadRecord>) =>
      React.createElement(Harness, {
        room,
        threadRootIds,
        threadRecordMap: map,
        onViewModels: (viewModels) => {
          latest = viewModels;
        },
      });

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        render(
          new Map([
            ['$a', makeRecord('$a', 3)],
            ['$b', makeRecord('$b', 5)],
          ])
        )
      );
    });
    const firstA = latest[0];
    const firstB = latest[1];

    // Fresh map + fresh record objects with identical content (the shape the
    // thread index produces on every refresh).
    act(() => {
      renderer?.update(
        render(
          new Map([
            ['$a', makeRecord('$a', 3)],
            ['$b', makeRecord('$b', 5)],
          ])
        )
      );
    });

    expect(latest[0]).toBe(firstA);
    expect(latest[1]).toBe(firstB);

    // A content change must produce a new identity for that card only.
    act(() => {
      renderer?.update(
        render(
          new Map([
            ['$a', makeRecord('$a', 4)],
            ['$b', makeRecord('$b', 5)],
          ])
        )
      );
    });

    expect(latest[0]).not.toBe(firstA);
    expect(latest[0]!.messageCount).toBe(4);
    expect(latest[1]).toBe(firstB);

    act(() => {
      renderer?.unmount();
    });
  });
});

describe('a fork whose root the room loads later', () => {
  it('shows its badge once the root is there, though the record is unchanged', () => {
    const forkRoot = {
      getOriginalContent: () => ({
        'io.mindroom.fork': { thread_id: '$p', event_id: '$a' },
      }),
    };
    let known = false;
    const room = {
      ...makeRoom(),
      getThread: () => (known ? { rootEvent: forkRoot } : null),
      getUnfilteredTimelineSet: () => ({ findEventById: () => (known ? forkRoot : undefined) }),
    } as unknown as Room;
    let latest: CompactThreadCardViewModel[] = [];
    const render = () =>
      React.createElement(Harness, {
        room,
        threadRootIds: ['$a'],
        threadRecordMap: new Map([['$a', makeRecord('$a', 3)]]),
        onViewModels: (viewModels) => {
          latest = viewModels;
        },
      });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(render());
    });
    expect(latest[0]?.forkedFrom).toBeUndefined();

    known = true;
    act(() => {
      renderer?.update(render());
    });
    expect(latest[0]?.forkedFrom).toEqual({ threadId: '$p', eventId: '$a' });
  });
});

describe('the roots of the cards', () => {
  it('are each read once as the cards are built, from the main timeline of the room', () => {
    const forkRoot = {
      getOriginalContent: () => ({
        'io.mindroom.fork': { thread_id: '$p', event_id: '$x' },
      }),
    };
    // Thread roots are in the main timeline; the room's own lookup also searches every thread.
    const findInMainTimeline = vi.fn((eventId: string) =>
      eventId === '$a' ? forkRoot : undefined
    );
    const findAnywhere = vi.fn(() => undefined);
    const room = {
      ...makeRoom(),
      findEventById: findAnywhere,
      getUnfilteredTimelineSet: () => ({ findEventById: findInMainTimeline }),
    } as unknown as Room;
    let latest: CompactThreadCardViewModel[] = [];
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(Harness, {
          room,
          threadRootIds: ['$a', '$b'],
          threadRecordMap: new Map([
            ['$a', makeRecord('$a', 3)],
            ['$b', makeRecord('$b', 5)],
          ]),
          onViewModels: (viewModels) => {
            latest = viewModels;
          },
        })
      );
    });

    expect(latest.map((viewModel) => viewModel.forkedFrom)).toEqual([
      { threadId: '$p', eventId: '$x' },
      undefined,
    ]);
    expect(findInMainTimeline.mock.calls.map(([eventId]) => eventId)).toEqual(['$a', '$b']);
    expect(findAnywhere).not.toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
  });
});
