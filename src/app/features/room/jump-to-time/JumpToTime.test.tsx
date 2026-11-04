// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, MatrixError, type Room } from 'matrix-js-sdk';
import { findEventAtTime } from './findEventAtTime';
import { JumpToTime } from './JumpToTime';

const state = vi.hoisted(() => ({
  timestampToEvent: vi.fn(),
  navigateRoom: vi.fn(),
  setViewMode: vi.fn(),
  hour24Clock: true,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ timestampToEvent: state.timestampToEvent }),
}));
vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: state.navigateRoom }),
}));
vi.mock('../../../mindroom/threads/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    availableViewModes: ['compact', 'threaded', 'classic'],
    setViewMode: state.setViewMode,
  }),
}));
vi.mock('../../../state/hooks/settings', () => ({ useSetting: () => [state.hour24Clock] }));
// Unit tests do not compile style sheets.
vi.mock('./JumpToTime.css', () => ({ Picker: 'picker', TimePicker: 'time-picker' }));
// jsdom has no layout, so focus-trap finds nothing tabbable; the trap itself is not under test.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const CREATED_AT = new Date(2024, 2, 5, 9, 30, 15).getTime();
const room = {
  roomId: '!room:test',
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
    state.navigateRoom.mockReset();
    state.setViewMode.mockReset();
    state.hour24Clock = true;
  });

  const show = (requestClose = vi.fn()) => {
    act(() => root.render(<JumpToTime room={room} requestClose={requestClose} />));
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
