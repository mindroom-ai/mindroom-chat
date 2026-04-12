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

vi.mock('../room/threadSummaryCache', () => ({
  loadCachedThreadSummaries: loadCachedThreadSummariesMock,
  saveCachedThreadSummary: saveCachedThreadSummaryMock,
}));

vi.mock('../../components/message/mindroomThreadSummary', () => ({
  getLatestThreadSummaryInfoFromEventSources: getLatestThreadSummaryInfoFromEventSourcesMock,
  pickLatestThreadSummaryInfo: (...infos: Array<{ summaryText?: string } | undefined>) =>
    [...infos].reverse().find((info) => !!info?.summaryText),
}));

vi.mock('../room/compactThreadRootData', () => ({
  getCompactThreadRootBodyPreviewText: getCompactThreadRootBodyPreviewTextMock,
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
  clearRecentThreadSummarySharedState,
  useRecentThreadSummary,
} from './useRecentThreadSummary';
import { storeThreadSummaryInState } from '../room/threadSummaryState';

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
  onRender: (result: ReturnType<typeof useRecentThreadSummary>) => void;
}) {
  onRender(useRecentThreadSummary(room, threadId, fallbackSummaryText));
  return null;
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useRecentThreadSummary', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    loadCachedThreadSummariesMock.mockReset();
    getLatestThreadSummaryInfoFromEventSourcesMock.mockReset();
    getCompactThreadRootBodyPreviewTextMock.mockReset();
    getLatestThreadSummaryInfoFromEventSourcesMock.mockReturnValue(undefined);
    getCompactThreadRootBodyPreviewTextMock.mockReturnValue(undefined);
    clearRecentThreadSummarySharedState();
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    clearRecentThreadSummarySharedState();
  });

  it('shares room summary cache reads and room thread listeners across entries in the same room', async () => {
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
            onRender: ({ summary }) => {
              firstSummary = summary;
            },
          }),
          React.createElement(HookHarness, {
            room: room as unknown as Room,
            threadId: '$thread-2',
            onRender: ({ summary }) => {
              secondSummary = summary;
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

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;

    expect(room.removeListener).toHaveBeenCalledTimes(4);
    expect(room.removeListener).toHaveBeenNthCalledWith(1, ThreadEvent.New, expect.any(Function));
    expect(room.removeListener).toHaveBeenNthCalledWith(
      2,
      ThreadEvent.Update,
      expect.any(Function)
    );
    expect(room.removeListener).toHaveBeenNthCalledWith(
      3,
      ThreadEvent.NewReply,
      expect.any(Function)
    );
    expect(room.removeListener).toHaveBeenNthCalledWith(
      4,
      ThreadEvent.Delete,
      expect.any(Function)
    );
  });

  it('truncates cached summaries to 120 characters including the ellipsis', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([['$thread-1', { summaryText: 'x'.repeat(200) }]])
    );

    const room = new MockRoom();
    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          onRender: (result) => {
            summary = result.summary;
          },
        })
      );
    });

    await flushPromises();

    expect(summary).toHaveLength(120);
    expect(summary.endsWith('...')).toBe(true);
  });

  it('falls back to the thread root preview when no summary is available', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(new Map());
    getCompactThreadRootBodyPreviewTextMock.mockReturnValue(
      '[cinny-e2e] Hidden relation thread root'
    );

    const room = new MockRoom();
    room.findEventById.mockReturnValue({
      getContent: () => ({ body: '[cinny-e2e] Hidden relation thread root' }),
      on: vi.fn(),
      removeListener: vi.fn(),
    });

    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          onRender: (result) => {
            summary = result.summary;
          },
        })
      );
    });

    await flushPromises();

    expect(summary).toBe('[cinny-e2e] Hidden relation thread root');
  });

  it('updates an existing recent-thread entry when room view stores a newer summary', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([
        [
          '$thread-1',
          {
            summaryText: 'Cached summary',
            generatedTs: 1,
            messageCount: 2,
          },
        ],
      ])
    );

    const room = new MockRoom();
    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          onRender: (result) => {
            summary = result.summary;
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
        messageCount: 4,
      });
      await flushPromises();
    });

    expect(summary).toBe('Live summary from room view');
    expect(loadCachedThreadSummariesMock).toHaveBeenCalledTimes(1);
  });

  it('uses the stored recent-thread snapshot when the root event is no longer loaded', async () => {
    loadCachedThreadSummariesMock.mockResolvedValue(new Map());

    const room = new MockRoom();
    let summary = '';

    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          room: room as unknown as Room,
          threadId: '$thread-1',
          fallbackSummaryText: 'Stored summary snapshot',
          onRender: (result) => {
            summary = result.summary;
          },
        })
      );
    });

    await flushPromises();

    expect(summary).toBe('Stored summary snapshot');
  });
});
