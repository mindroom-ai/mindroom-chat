// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, type MatrixClient, MatrixError, type Room } from 'matrix-js-sdk';
import { findEventAtTime, findThreadEventAtTime } from './findEventAtTime';
import { JumpToTime } from './JumpToTime';

const state = vi.hoisted(() => ({
  timestampToEvent: vi.fn(),
  fetchRelations: vi.fn(),
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  setViewMode: vi.fn(),
  hour24Clock: true,
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    timestampToEvent: state.timestampToEvent,
    fetchRelations: state.fetchRelations,
  }),
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: state.navigateRoom,
    navigateRoomThread: state.navigateRoomThread,
  }),
}));
vi.mock('../../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    availableViewModes: ['compact', 'threaded', 'classic'],
    setViewMode: state.setViewMode,
  }),
}));
vi.mock('../../preferences/useSetting', () => ({ useSetting: () => [state.hour24Clock] }));
// Unit tests do not compile style sheets.
vi.mock('./JumpToTime.css', () => ({ Picker: 'picker', TimePicker: 'time-picker' }));
// jsdom has no layout, so focus-trap finds nothing tabbable; the trap itself is not under test.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const CREATED_AT = new Date(2024, 2, 5, 9, 30, 15).getTime();
const ROOT_TS = new Date(2024, 2, 6, 10, 0).getTime();
const room = {
  roomId: '!room:test',
  getThread: () => null,
  findEventById: (eventId: string) => (eventId === '$root' ? { getTs: () => ROOT_TS } : undefined),
  currentState: {
    getStateEvents: (type: string) =>
      type === 'm.room.create' ? { getTs: () => CREATED_AT } : null,
  },
} as unknown as Room;

const matrixError = (errcode: string, httpStatus: number) =>
  new MatrixError({ errcode, error: errcode }, httpStatus);

describe('findEventAtTime', () => {
  it('takes the first event at or after the time', async () => {
    const timestampToEvent = vi.fn(async () => ({ event_id: '$after', origin_server_ts: 5 }));
    expect(await findEventAtTime({ timestampToEvent }, '!r', 4)).toEqual({
      kind: 'found',
      eventId: '$after',
    });
    expect(timestampToEvent).toHaveBeenCalledWith('!r', 4, Direction.Forward);
  });

  it('takes the last event before the time when nothing came after it', async () => {
    const timestampToEvent = vi.fn(async (_roomId: string, _ts: number, dir: Direction) => {
      if (dir === Direction.Forward) throw matrixError('M_NOT_FOUND', 404);
      return { event_id: '$before', origin_server_ts: 3 };
    });
    expect(await findEventAtTime({ timestampToEvent }, '!r', 4)).toEqual({
      kind: 'found',
      eventId: '$before',
    });
  });

  it('tells a server without the endpoint from a room without events', async () => {
    const unsupported = vi.fn(async () => Promise.reject(matrixError('M_UNRECOGNIZED', 404)));
    expect(await findEventAtTime({ timestampToEvent: unsupported }, '!r', 4)).toEqual({
      kind: 'unsupported',
    });
    const empty = vi.fn(async () => Promise.reject(matrixError('M_NOT_FOUND', 404)));
    expect(await findEventAtTime({ timestampToEvent: empty }, '!r', 4)).toEqual({
      kind: 'notFound',
    });
  });

  it('passes other failures on', async () => {
    const denied = vi.fn(async () => Promise.reject(matrixError('M_FORBIDDEN', 403)));
    await expect(findEventAtTime({ timestampToEvent: denied }, '!r', 4)).rejects.toThrow(
      'M_FORBIDDEN'
    );
  });
});

const reply = (eventId: string, ts: number, extra: Record<string, unknown> = {}) => ({
  event_id: eventId,
  origin_server_ts: ts,
  type: 'm.room.message',
  ...extra,
});

/** A thread's replies served newest first, `pageSize` at a time. */
const relations = (newestFirst: ReturnType<typeof reply>[], pageSize = 2) =>
  vi.fn(
    async (
      _roomId: string,
      _eventId: string,
      _rel: string,
      _type: null,
      opts: { from?: string }
    ) => {
      const start = Number(opts.from ?? 0);
      const next = start + pageSize;
      return {
        chunk: newestFirst.slice(start, next),
        ...(next < newestFirst.length ? { next_batch: String(next) } : {}),
      };
    }
  );

const thread = (fetchRelations: unknown) =>
  ({ fetchRelations } as unknown as Pick<MatrixClient, 'fetchRelations'>);

describe('findThreadEventAtTime', () => {
  // Root at 100; replies at 200, 300, 400 and 500, with a deleted one and a reaction between.
  const replies = [
    reply('$r500', 500),
    reply('$gone', 450, { unsigned: { redacted_because: {} } }),
    reply('$r400', 400),
    reply('$state', 350, { type: 'm.reaction' }),
    reply('$r300', 300),
    reply('$r200', 200),
  ];

  it("takes the thread's first reply at or after the time, reading pages only as far as needed", async () => {
    const fetchRelations = relations(replies);
    expect(await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 320, 100)).toBe(
      '$r400'
    );
    expect(fetchRelations).toHaveBeenCalledTimes(3);
    expect(fetchRelations.mock.calls[0]).toEqual([
      '!r',
      '$root',
      'm.thread',
      null,
      { dir: Direction.Backward, limit: 100 },
    ]);
    expect(await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 300, 100)).toBe(
      '$r300'
    );
  });

  it('takes the newest reply for a time after it', async () => {
    const fetchRelations = relations(replies);
    expect(await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 900, 100)).toBe(
      '$r500'
    );
    expect(fetchRelations).toHaveBeenCalledOnce();
  });

  it('takes the first message for a time before the thread began, or without replies', async () => {
    expect(await findThreadEventAtTime(thread(relations(replies)), '!r', '$root', 50, 100)).toBe(
      '$root'
    );
    expect(await findThreadEventAtTime(thread(relations(replies)), '!r', '$root', 100, 100)).toBe(
      '$root'
    );
    expect(await findThreadEventAtTime(thread(relations([])), '!r', '$root', 900, 100)).toBe(
      '$root'
    );
  });

  it('answers the first message, and a time after the newest reply it knows, without the server', async () => {
    const fetchRelations = relations(replies);
    const newest = { eventId: '$r500', ts: 500 };
    expect(await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 100, 100)).toBe(
      '$root'
    );
    expect(
      await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 900, 100, newest)
    ).toBe('$r500');
    expect(fetchRelations).not.toHaveBeenCalled();
    // A time before that reply still asks the server.
    expect(
      await findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 320, 100, newest)
    ).toBe('$r400');
    expect(fetchRelations).toHaveBeenCalled();
  });

  it('bounds the whole server search, including all pages', async () => {
    vi.useFakeTimers();
    try {
      let finishPage: (page: { chunk: ReturnType<typeof reply>[]; next_batch?: string }) => void;
      const fetchRelations = vi.fn(
        () =>
          new Promise<{ chunk: ReturnType<typeof reply>[]; next_batch?: string }>((resolve) => {
            finishPage = resolve;
          })
      );
      const lookup = findThreadEventAtTime(thread(fetchRelations), '!r', '$root', 320, 100);
      const failure = expect(lookup).rejects.toThrow('Thread time lookup timed out');
      await vi.advanceTimersByTimeAsync(10_000);
      finishPage!({ chunk: [reply('$r500', 500)], next_batch: 'older' });
      await vi.advanceTimersByTimeAsync(5_000);
      await failure;
      expect(fetchRelations).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the first reply for a time between the first message and it', async () => {
    expect(await findThreadEventAtTime(thread(relations(replies)), '!r', '$root', 150, 100)).toBe(
      '$r200'
    );
    // Without the root's time, a time before every reply lands on the root.
    expect(
      await findThreadEventAtTime(thread(relations(replies)), '!r', '$root', 150, undefined)
    ).toBe('$root');
  });
});

describe('JumpToTime', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    state.timestampToEvent.mockReset();
    state.fetchRelations.mockReset();
    state.navigateRoom.mockReset();
    state.navigateRoomThread.mockReset();
    state.setViewMode.mockReset();
    state.hour24Clock = true;
  });

  const show = (requestClose = vi.fn(), threadId?: string) => {
    act(() =>
      root.render(<JumpToTime room={room} threadId={threadId} requestClose={requestClose} />)
    );
    return requestClose;
  };
  const button = (text: string) =>
    [...document.querySelectorAll('button')].find((node) => node.textContent === text)!;
  const select = (label: string) =>
    document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const pick = (label: string, value: number) =>
    act(() => {
      const field = select(label);
      field.value = String(value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const openTimeline = () => act(async () => button('Open Timeline').click());

  it('opens the Full view at the event the server finds for the picked date and time', async () => {
    state.timestampToEvent.mockResolvedValue({ event_id: '$found', origin_server_ts: 1 });
    const requestClose = show();
    act(() => button('Yesterday').click());
    pick('Hour', 14);
    pick('Minutes', 5);
    await openTimeline();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 5, 0, 0);
    expect(state.timestampToEvent).toHaveBeenCalledWith(
      '!room:test',
      yesterday.getTime(),
      Direction.Forward
    );
    expect(state.setViewMode).toHaveBeenCalledWith('classic');
    expect(state.navigateRoom).toHaveBeenCalledWith('!room:test', '$found');
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('stays in an open thread and moves it to its message at that time', async () => {
    const afternoon = new Date(2024, 2, 6, 14, 0).getTime();
    state.fetchRelations.mockImplementation(async () => ({
      chunk: [reply('$late', afternoon + 60_000), reply('$noon', afternoon - 60_000)],
    }));
    window.history.replaceState({ usr: { exitTarget: 'kept' }, key: 'k', idx: 0 }, '');
    const requestClose = show(vi.fn(), '$root');
    pick('Year', 2024);
    pick('Month', 2);
    pick('Day', 6);
    pick('Hour', 14);
    pick('Minutes', 0);
    await openTimeline();

    expect(state.timestampToEvent).not.toHaveBeenCalled();
    expect(state.setViewMode).not.toHaveBeenCalled();
    expect(state.navigateRoom).not.toHaveBeenCalled();
    expect(state.navigateRoomThread).toHaveBeenCalledWith('!room:test', '$root', '$late', {
      replace: true,
      state: { exitTarget: 'kept' },
    });
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it("opens a thread's first message from the room's beginning", async () => {
    state.fetchRelations.mockResolvedValue({ chunk: [reply('$reply', ROOT_TS + 60_000)] });
    show(vi.fn(), '$root');
    act(() => button('Beginning').click());
    await openTimeline();
    expect(state.navigateRoomThread).toHaveBeenCalledWith(
      '!room:test',
      '$root',
      '$root',
      expect.objectContaining({ replace: true })
    );
  });

  it("goes to a thread's first message and to its newest reply without waiting for the server", async () => {
    // The server never answers, as a busy one may not for a long time.
    state.fetchRelations.mockReturnValue(new Promise(() => undefined));
    const newestTs = new Date().setHours(0, 1, 0, 0);
    const newestReply = {
      getId: () => '$newest',
      getTs: () => newestTs,
      getType: () => 'm.room.message',
      isRedacted: () => false,
    };
    const threadRoom = {
      ...room,
      getThread: () => ({ rootEvent: { getTs: () => ROOT_TS }, replyToEvent: newestReply }),
    } as unknown as Room;
    const requestClose = vi.fn();
    act(() =>
      root.render(<JumpToTime room={threadRoom} threadId="$root" requestClose={requestClose} />)
    );
    act(() => button('Beginning').click());
    await openTimeline();
    expect(state.navigateRoomThread).toHaveBeenLastCalledWith(
      '!room:test',
      '$root',
      '$root',
      expect.objectContaining({ replace: true })
    );

    act(() => button('Today').click());
    pick('Hour', 23);
    pick('Minutes', 59);
    await openTimeline();
    expect(state.navigateRoomThread).toHaveBeenLastCalledWith(
      '!room:test',
      '$root',
      '$newest',
      expect.objectContaining({ replace: true })
    );
    expect(state.fetchRelations).not.toHaveBeenCalled();
    expect(requestClose).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable error when a thread search times out, ignoring its late answer', async () => {
    vi.useFakeTimers();
    try {
      let finish: (page: { chunk: ReturnType<typeof reply>[] }) => void;
      state.fetchRelations.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const requestClose = show(vi.fn(), '$root');
      await openTimeline();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/timed out/i);
      expect(button('Open Timeline').disabled).toBe(false);
      await act(async () => {
        finish!({ chunk: [reply('$late', Date.now())] });
      });
      expect(requestClose).not.toHaveBeenCalled();
      expect(state.navigateRoomThread).not.toHaveBeenCalled();
      state.fetchRelations.mockResolvedValue({ chunk: [reply('$retry', Date.now())] });
      await openTimeline();
      expect(state.navigateRoomThread).toHaveBeenCalledWith(
        '!room:test',
        '$root',
        '$retry',
        expect.anything()
      );
      expect(requestClose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the beginning at the room creation, to the millisecond', async () => {
    state.timestampToEvent.mockResolvedValue({ event_id: '$create', origin_server_ts: 1 });
    show();
    act(() => button('Beginning').click());
    expect(select('Year').value).toBe('2024');
    expect(select('Month').value).toBe('2');
    expect(select('Day').value).toBe('5');
    await openTimeline();
    expect(state.timestampToEvent).toHaveBeenCalledWith(
      '!room:test',
      CREATED_AT,
      Direction.Forward
    );
  });

  it('offers years from the room creation on, and clamps the day to the month', () => {
    show();
    const years = [...select('Year').options].map((option) => option.value);
    expect(years[0]).toBe('2024');
    expect(years.at(-1)).toBe(String(new Date().getFullYear()));
    pick('Year', 2024);
    pick('Month', 0);
    pick('Day', 31);
    pick('Month', 1);
    expect(select('Day').value).toBe('29');
    expect(select('Day').options).toHaveLength(29);
  });

  it('reads the hour with a period on a 12-hour clock', async () => {
    state.hour24Clock = false;
    state.timestampToEvent.mockResolvedValue({ event_id: '$found', origin_server_ts: 1 });
    show();
    pick('Hour', 3);
    pick('Period', 1);
    expect(select('Hour').value).toBe('3');
    await openTimeline();
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    expect(state.timestampToEvent).toHaveBeenCalledWith(
      '!room:test',
      today.getTime(),
      Direction.Forward
    );
  });

  it('stays open with a message when the server cannot look up times', async () => {
    state.timestampToEvent.mockRejectedValue(matrixError('M_UNRECOGNIZED', 404));
    const requestClose = show();
    await openTimeline();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'This server cannot look up messages by time.'
    );
    expect(state.navigateRoom).not.toHaveBeenCalled();
    expect(requestClose).not.toHaveBeenCalled();
  });

  it("shows the server's reason for other failures", async () => {
    state.timestampToEvent.mockRejectedValue(new Error('Connection lost'));
    show();
    await openTimeline();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not jump to that time: Connection lost'
    );
  });
});
