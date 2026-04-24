import React from 'react';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import type { Room } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadCachedThreadSummariesMock,
  saveCachedThreadSummaryMock,
  getLatestThreadSummaryInfoFromEventSourcesMock,
  getCompactThreadRootBodyPreviewTextMock,
} = vi.hoisted(() => ({
  loadCachedThreadSummariesMock: vi.fn(),
  saveCachedThreadSummaryMock: vi.fn(async () => undefined),
  getLatestThreadSummaryInfoFromEventSourcesMock: vi.fn(),
  getCompactThreadRootBodyPreviewTextMock: vi.fn(),
}));

vi.mock('../../features/room/threadSummaryCache', () => ({
  loadCachedThreadSummaries: loadCachedThreadSummariesMock,
  saveCachedThreadSummary: saveCachedThreadSummaryMock,
}));

vi.mock('../../components/message/mindroomThreadSummary', () => ({
  getLatestThreadSummaryInfoFromEventSources: getLatestThreadSummaryInfoFromEventSourcesMock,
  pickLatestThreadSummaryInfo: (...infos: Array<{ summaryText?: string } | undefined>) =>
    [...infos].reverse().find((info) => !!info?.summaryText),
}));

vi.mock('../../features/room/compactThreadRootData', () => ({
  getCompactThreadRootBodyPreviewText: getCompactThreadRootBodyPreviewTextMock,
  isZeroReplyStandaloneThreadRootEvent: () => false,
  pickPreferredThreadRootPreviewText: ({
    preferredPreviewText,
    fallbackPreviewText,
  }: {
    preferredPreviewText?: string;
    fallbackPreviewText?: string;
  }) => preferredPreviewText ?? fallbackPreviewText,
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 'session-1' }),
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomName: () => 'Room Name',
}));

import {
  clearRecentThreadViewModelSharedState,
  useRecentThreadViewModel,
} from './recentThreadViewModel';
import { storeThreadSummaryInState } from '../../features/room/threadSummaryState';

type Listener = () => void;

class MockRoom {
  roomId = '!room:example.org';

  private listeners = new Map<string, Set<Listener>>();

  on = vi.fn((event: string, listener: Listener) => {
    const current = this.listeners.get(event) ?? new Set<Listener>();
    current.add(listener);
    this.listeners.set(event, current);
  });

  removeListener = vi.fn((event: string, listener: Listener) => {
    const current = this.listeners.get(event);
    current?.delete(listener);
  });

  getThread = vi.fn(() => undefined);

  findEventById = vi.fn(() => undefined);

  hasEncryptionStateEvent = vi.fn(() => false);
}

function HookHarness({
  room,
  threadId,
  fallbackSummaryText,
  onRender,
}: {
  room: Room;
  threadId: string;
  fallbackSummaryText?: string;
  onRender: (result: ReturnType<typeof useRecentThreadViewModel>) => void;
}) {
  onRender(useRecentThreadViewModel(room, threadId, 123, fallbackSummaryText));
  return null;
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useRecentThreadViewModel', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    loadCachedThreadSummariesMock.mockReset();
    getLatestThreadSummaryInfoFromEventSourcesMock.mockReset();
    getCompactThreadRootBodyPreviewTextMock.mockReset();
    getLatestThreadSummaryInfoFromEventSourcesMock.mockReturnValue(undefined);
    getCompactThreadRootBodyPreviewTextMock.mockReturnValue(undefined);
    clearRecentThreadViewModelSharedState();
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    clearRecentThreadViewModelSharedState();
  });

  it('shares cached summary reads and room thread listeners across entries in the same room', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([
        ['$thread-1', { summaryText: 'Cached summary 1' }],
        ['$thread-2', { summaryText: 'Cached summary 2' }],
      ])
    );

    const room = new MockRoom();
    let firstSummary = '';
    let secondSummary = '';

    await act(async () => {
      renderer = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HookHarness, {
            room: room as unknown as Room,
            threadId: '$thread-1',
            onRender: ({ summaryText }) => {
              firstSummary = summaryText;
            },
          }),
          React.createElement(HookHarness, {
            room: room as unknown as Room,
            threadId: '$thread-2',
            onRender: ({ summaryText }) => {
              secondSummary = summaryText;
            },
          })
        )
      );
    });

    await flushPromises();

    expect(loadCachedThreadSummariesMock).toHaveBeenCalledTimes(1);
    expect(loadCachedThreadSummariesMock).toHaveBeenCalledWith('session-1', '!room:example.org');
    expect(firstSummary).toBe('Cached summary 1');
    expect(secondSummary).toBe('Cached summary 2');
    expect(room.on).toHaveBeenCalledTimes(4);
    expect(room.on).toHaveBeenNthCalledWith(1, ThreadEvent.New, expect.any(Function));
    expect(room.on).toHaveBeenNthCalledWith(2, ThreadEvent.Update, expect.any(Function));
    expect(room.on).toHaveBeenNthCalledWith(3, ThreadEvent.NewReply, expect.any(Function));
    expect(room.on).toHaveBeenNthCalledWith(4, ThreadEvent.Delete, expect.any(Function));
  });

  it('uses root previews through the shared ThreadRecord path when no summary is available', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(new Map());
    getCompactThreadRootBodyPreviewTextMock.mockReturnValue('Root preview');

    const room = new MockRoom();
    room.findEventById.mockReturnValue({
      getId: () => '$thread-1',
      getTs: () => 100,
      getSender: () => '@alice:example.org',
      getUnsigned: () => ({}),
      getContent: () => ({ body: 'Root preview' }),
      replacingEvent: () => undefined,
      on: vi.fn(),
      removeListener: vi.fn(),
    });

    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          onRender: ({ summaryText }) => {
            summary = summaryText;
          },
        })
      );
    });

    await flushPromises();

    expect(summary).toBe('Root preview');
  });

  it('updates when room view stores a newer shared summary for the same thread', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([['$thread-1', { summaryText: 'Cached summary', generatedTs: 1 }]])
    );

    const room = new MockRoom();
    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          onRender: ({ summaryText }) => {
            summary = summaryText;
          },
        })
      );
    });

    await flushPromises();
    expect(summary).toBe('Cached summary');

    await act(async () => {
      storeThreadSummaryInState('session-1', '!room:example.org', '$thread-1', {
        summaryText: 'Live summary from room view',
        generatedTs: 2,
      });
      await flushPromises();
    });

    expect(summary).toBe('Live summary from room view');
    expect(loadCachedThreadSummariesMock).toHaveBeenCalledTimes(1);
  });
});
