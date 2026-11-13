import React, { useEffect } from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineDebugTraceIds } from './timelineDebugController';

const debugMock = vi.hoisted(() => ({
  calls: [] as Array<[string | undefined, string, Record<string, unknown> | undefined]>,
}));

vi.mock('../diagnostics/timelineDebug', () => ({
  createTimelineDebugTrace: vi.fn(
    (scope: string, roomId: string, threadId?: string) => `${scope}:${roomId}:${threadId ?? ''}`
  ),
  logTimelineDebug: vi.fn(
    (traceId: string | undefined, phase: string, payload?: Record<string, unknown>) => {
      debugMock.calls.push([traceId, phase, payload]);
    }
  ),
}));

const makeRoom = (roomId = '!room:example.org') => ({ roomId }) as Room;

const TraceHarness = ({
  eventId,
  onTraceIds,
  room,
  threadId,
}: {
  eventId?: string;
  onTraceIds: (ids: ReturnType<typeof useTimelineDebugTraceIds>) => void;
  room: Room;
  threadId?: string;
}) => {
  const traceIds = useTimelineDebugTraceIds({ eventId, room, threadId });
  useEffect(() => {
    onTraceIds(traceIds);
  }, [onTraceIds, traceIds]);
  return null;
};

describe('timelineDebugController', () => {
  beforeEach(() => {
    debugMock.calls = [];
  });

  it('creates stable room and thread trace ids and logs route init phases', async () => {
    const traceIds: Array<ReturnType<typeof useTimelineDebugTraceIds>> = [];

    await act(async () => {
      create(
        React.createElement(TraceHarness, {
          eventId: '$focus',
          onTraceIds: (ids) => traceIds.push(ids),
          room: makeRoom(),
          threadId: '$thread',
        })
      );
    });

    expect(traceIds[0]).toEqual({
      roomDebugTraceId: 'room-open:!room:example.org:',
      threadDebugTraceId: 'thread-open:!room:example.org:$thread',
    });
    expect(debugMock.calls).toEqual([
      [
        'room-open:!room:example.org:',
        'init',
        { eventId: '$focus', roomId: '!room:example.org', threadId: '$thread' },
      ],
      [
        'thread-open:!room:example.org:$thread',
        'init',
        { eventId: '$focus', roomId: '!room:example.org', threadId: '$thread' },
      ],
    ]);
  });
});
