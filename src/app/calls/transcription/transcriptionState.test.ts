import { describe, expect, it } from 'vitest';
import { applyCallEvent, heldInCall, type LiveTranscript } from './transcriptionState';
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
  holds: [],
  transcribedBy: ['@ann:example.org'],
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

describe('applyCallEvent', () => {
  it('takes what the stream is ready with as the whole live call', () => {
    const ready = { call: CALL, lines: [], names: { '@bob:example.org': null } };
    expect(applyCallEvent(live(), ROOM_ID, { type: 'ready', live: ready })).toEqual({
      roomId: ROOM_ID,
      ...ready,
    });
  });

  it('follows changes to the call, and starts over with a new call', () => {
    const held = { ...CALL, holds: ['@bob:example.org'] };
    expect(applyCallEvent(live(), ROOM_ID, { type: 'call', call: held })).toEqual(
      live({ call: held })
    );

    const next = { ...CALL, id: 'call-2' };
    expect(applyCallEvent(live(), ROOM_ID, { type: 'call', call: next })).toEqual(
      live({ call: next, lines: [] })
    );
    expect(applyCallEvent(undefined, ROOM_ID, { type: 'call', call: next })).toEqual({
      roomId: ROOM_ID,
      call: next,
      lines: [],
      names: {},
    });
    expect(
      applyCallEvent(live({ roomId: OTHER_ROOM_ID }), ROOM_ID, { type: 'call', call: next })
    ).toEqual({ roomId: ROOM_ID, call: next, lines: [], names: {} });
  });

  it("adds the call's lines in the order they were said, each once", () => {
    const b = line('b', '2026-11-07T09:29:20Z');
    const added = applyCallEvent(live(), ROOM_ID, { type: 'line', line: b });
    expect(added?.lines.map(({ id }) => id)).toEqual(['a', 'b', 'c']);

    const again = applyCallEvent(added, ROOM_ID, { type: 'line', line: { ...b, text: 'B' } });
    expect(again?.lines.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(again?.lines[1]).toMatchObject({ text: 'B' });
  });

  it("leaves out another call's lines, and lines before the stream is ready", () => {
    const state = live();
    expect(
      applyCallEvent(state, ROOM_ID, {
        type: 'line',
        line: line('x', '2026-11-07T09:29:20Z', 'call-0'),
      })
    ).toBe(state);
    expect(
      applyCallEvent(undefined, ROOM_ID, { type: 'line', line: line('x', '2026-11-07T09:29:20Z') })
    ).toBeUndefined();
  });

  it('clears the call when it ends, and ignores the end of another', () => {
    expect(applyCallEvent(live(), ROOM_ID, { type: 'ended', callId: 'call-1' })).toEqual(
      live({ call: null, lines: [] })
    );
    const state = live();
    expect(applyCallEvent(state, ROOM_ID, { type: 'ended', callId: 'call-0' })).toBe(state);
  });
});

describe('heldInCall', () => {
  it("is whether anyone holds Pause in the room's live call", () => {
    expect(heldInCall(live(), ROOM_ID)).toBe(false);
    const held = live({ call: { ...CALL, holds: ['@bob:example.org'] } });
    expect(heldInCall(held, ROOM_ID)).toBe(true);
    expect(heldInCall(held, OTHER_ROOM_ID)).toBe(false);
    expect(heldInCall(live({ call: null }), ROOM_ID)).toBe(false);
    expect(heldInCall(undefined, ROOM_ID)).toBe(false);
  });
});
