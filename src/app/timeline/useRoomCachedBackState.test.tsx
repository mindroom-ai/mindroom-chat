// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { Direction, type EventTimeline, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRoomCachedBackStateSnapshot } from '../event-store/cache/eventRepository';
import type { Timeline } from '../event-store/timeline/timelinePagination';
import { useRoomCachedBackState } from './useRoomCachedBackState';

vi.mock('../event-store/cache/eventRepository', () => ({
  getEarliestLoadedRoomEvent: vi.fn(() => undefined),
  loadRoomCachedBackStateSnapshot: vi.fn(),
}));

const loadSnapshot = vi.mocked(loadRoomCachedBackStateSnapshot);

const makeTimeline = (): Timeline => {
  let backToken: string | null = 'sdk-back';
  const linked = {
    getEvents: () => [],
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? backToken : null,
    setPaginationToken: vi.fn((token: string | null, direction: Direction) => {
      if (direction === Direction.Backward) backToken = token;
    }),
  } as unknown as EventTimeline;
  return { linkedTimelines: [linked], range: { start: 0, end: 0 } };
};

const room = { roomId: '!room:example.org' } as unknown as Room;

type HookProps = Parameters<typeof useRoomCachedBackState>[0];
type SetHasMore = HookProps['setRoomHasMoreCachedBack'];

const mountHook = () => {
  const timeline = makeTimeline();
  const setRoomHasMoreCachedBack = vi.fn<SetHasMore>();
  const props: Omit<HookProps, 'eventsLength'> = {
    alive: () => true,
    eventId: undefined,
    room,
    roomDebugTraceId: 'room-open#1#room',
    roomIdRef: { current: room.roomId },
    sessionId: 'session',
    setRoomHasMoreCachedBack,
    setTimeline: vi.fn(),
    threadId: undefined,
    threadIdRef: { current: undefined },
    timeline,
  };
  function Probe({ eventsLength }: { eventsLength: number }) {
    useRoomCachedBackState({ ...props, eventsLength });
    return null;
  }
  const renderer = create(<Probe eventsLength={1} />);
  return {
    timeline,
    setRoomHasMoreCachedBack,
    rerender: (eventsLength: number) => renderer.update(<Probe eventsLength={eventsLength} />),
    unmount: () => renderer.unmount(),
  };
};

describe('useRoomCachedBackState', () => {
  afterEach(() => {
    loadSnapshot.mockReset();
  });

  it('keeps the cached-back state and the back token when the cache read fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      loadSnapshot.mockRejectedValueOnce(new DOMException('closing', 'InvalidStateError'));
      const hook = mountHook();
      const { timeline, setRoomHasMoreCachedBack } = hook;
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });

      expect(loadSnapshot).toHaveBeenCalledTimes(1);
      expect(setRoomHasMoreCachedBack).not.toHaveBeenCalled();
      expect(timeline.linkedTimelines[0]!.getPaginationToken(Direction.Backward)).toBe('sdk-back');
      expect(unhandled).not.toHaveBeenCalled();
      hook.unmount();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('updates the state from the next read that succeeds', async () => {
    loadSnapshot.mockRejectedValueOnce(new Error('transaction aborted')).mockResolvedValueOnce({
      cachedPage: { events: [{ event_id: '$cached', origin_server_ts: 1 }], hasMoreBefore: false },
      cachedBeforeToken: null,
      hasCachedBack: true,
    });
    const hook = mountHook();
    const { timeline, setRoomHasMoreCachedBack } = hook;
    await act(async () => {
      await Promise.resolve();
    });
    expect(setRoomHasMoreCachedBack).not.toHaveBeenCalled();

    await act(async () => {
      hook.rerender(2);
      await Promise.resolve();
    });

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(setRoomHasMoreCachedBack).toHaveBeenCalledWith(true);
    expect(timeline.linkedTimelines[0]!.getPaginationToken(Direction.Backward)).toBeNull();
    hook.unmount();
  });
});
