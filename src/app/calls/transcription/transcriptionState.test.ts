import { describe, expect, it, vi } from 'vitest';
import { applyLiveUpdate, pausedByIn, type LiveTranscript } from './transcriptionState';
import type { TranscriptCall, TranscriptLine } from './api';

const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: '$row',
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org', '@bob:example.org'],
  pausedBy: null,
};

const line = (
  id: string,
  saidAt: string,
  callId = 'call-1'
): Extract<TranscriptLine, { kind: 'speech' }> => ({
  id,
  callId,
  userId: '@ann:example.org',
  saidAt,
  seconds: 1,
  kind: 'speech',
  text: id,
});

const live = (change: Partial<LiveTranscript> = {}): LiveTranscript => ({
  roomId: ROOM_ID,
  call: CALL,
  lines: [line('a', '2026-11-07T09:29:10Z'), line('c', '2026-11-07T09:29:30Z')],
  names: { '@ann:example.org': 'Ann' },
  ...change,
});

describe('applyLiveUpdate', () => {
  it("adds a read's lines and names to those of the same call, in the order they were said", () => {
    const paused = { ...CALL, pausedBy: '@bob:example.org' };
    const read = {
      call: paused,
      lines: [line('b', '2026-11-07T09:29:20Z'), line('c', '2026-11-07T09:29:30Z')],
      names: { '@bob:example.org': 'Bob' },
    };
    const updated = applyLiveUpdate(live(), ROOM_ID, { type: 'live', live: read });
    expect(updated?.call).toEqual(paused);
    expect(updated?.lines.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(updated?.names).toEqual({ '@ann:example.org': 'Ann', '@bob:example.org': 'Bob' });
  });

  it('adds the lines of a full read of a long call in one pass', () => {
    const lines = Array.from({ length: 2000 }, (_, index) =>
      line(`line-${index}`, new Date(Date.UTC(2026, 10, 7, 9, 0, index)).toISOString())
    );
    const parse = vi.spyOn(Date, 'parse');
    try {
      const read = { call: CALL, lines, names: {} };
      const updated = applyLiveUpdate(undefined, ROOM_ID, { type: 'live', live: read });
      expect(updated?.lines).toEqual(lines);
      expect(parse.mock.calls.length).toBeLessThanOrEqual(2 * lines.length);
    } finally {
      parse.mockRestore();
    }
  });

  it('keeps the lines as they were for a read without new ones', () => {
    const shown = live();
    const read = { call: CALL, lines: [], names: {} };
    expect(applyLiveUpdate(shown, ROOM_ID, { type: 'live', live: read })?.lines).toBe(shown.lines);
  });

  it('takes a read of another call, of none, or in another room as the whole live call', () => {
    const next = { call: { ...CALL, id: 'call-2' }, lines: [], names: {} };
    expect(applyLiveUpdate(live(), ROOM_ID, { type: 'live', live: next })).toEqual({
      roomId: ROOM_ID,
      ...next,
    });
    const none = { call: null, lines: [], names: {} };
    expect(applyLiveUpdate(live(), ROOM_ID, { type: 'live', live: none })).toEqual({
      roomId: ROOM_ID,
      ...none,
    });
    const read = { call: CALL, lines: [], names: {} };
    expect(
      applyLiveUpdate(live({ roomId: OTHER_ROOM_ID }), ROOM_ID, { type: 'live', live: read })
    ).toEqual({ roomId: ROOM_ID, ...read });
  });

  it('follows changes to the call, and starts over with a new call', () => {
    const paused = { ...CALL, pausedBy: '@bob:example.org' };
    expect(applyLiveUpdate(live(), ROOM_ID, { type: 'call', call: paused })).toEqual(
      live({ call: paused })
    );

    const next = { ...CALL, id: 'call-2' };
    expect(applyLiveUpdate(live(), ROOM_ID, { type: 'call', call: next })).toEqual(
      live({ call: next, lines: [] })
    );
    expect(applyLiveUpdate(undefined, ROOM_ID, { type: 'call', call: next })).toEqual({
      roomId: ROOM_ID,
      call: next,
      lines: [],
      names: {},
    });
    expect(
      applyLiveUpdate(live({ roomId: OTHER_ROOM_ID }), ROOM_ID, { type: 'call', call: next })
    ).toEqual({ roomId: ROOM_ID, call: next, lines: [], names: {} });
  });

  it("adds the call's lines in the order they were said, each once", () => {
    const b = line('b', '2026-11-07T09:29:20Z');
    const added = applyLiveUpdate(live(), ROOM_ID, { type: 'line', line: b });
    expect(added?.lines.map(({ id }) => id)).toEqual(['a', 'b', 'c']);

    const again = applyLiveUpdate(added, ROOM_ID, { type: 'line', line: { ...b, text: 'B' } });
    expect(again?.lines.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(again?.lines[1]).toMatchObject({ text: 'B' });
  });

  it("leaves out another call's lines, and lines before the call was read", () => {
    const state = live();
    expect(
      applyLiveUpdate(state, ROOM_ID, {
        type: 'line',
        line: line('x', '2026-11-07T09:29:20Z', 'call-0'),
      })
    ).toBe(state);
    expect(
      applyLiveUpdate(undefined, ROOM_ID, { type: 'line', line: line('x', '2026-11-07T09:29:20Z') })
    ).toBeUndefined();
  });
});

describe('pausedByIn', () => {
  it("is who paused the room's live call", () => {
    expect(pausedByIn(live(), ROOM_ID)).toBeNull();
    const paused = live({ call: { ...CALL, pausedBy: '@bob:example.org' } });
    expect(pausedByIn(paused, ROOM_ID)).toBe('@bob:example.org');
    expect(pausedByIn(paused, OTHER_ROOM_ID)).toBeNull();
    expect(pausedByIn(live({ call: null }), ROOM_ID)).toBeNull();
    expect(pausedByIn(undefined, ROOM_ID)).toBeNull();
  });
});
