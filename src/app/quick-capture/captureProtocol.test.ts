import { describe, expect, it } from 'vitest';
import { isCaptureMessage, type CaptureAction, type CaptureState } from './captureProtocol';

const state: CaptureState = {
  userId: '@me:example.org',
  roomId: '!a:example.org',
  rooms: [{ id: '!a:example.org', name: 'Room', direct: false }],
  items: [
    {
      threadId: '$t',
      title: 'Title',
      line: 'hi',
      lineSender: 'Bot',
      replyText: 'hi there',
      chip: 'working',
      resolved: false,
      ts: 1,
    },
  ],
};

const actions: CaptureAction[] = [
  { kind: 'send', roomId: '!a', text: 'x', images: [new File(['a'], 'a.png')], open: false },
  { kind: 'reply', roomId: '!a', threadId: '$t', text: 'x' },
  { kind: 'resolve', roomId: '!a', threadId: '$t', resolved: true },
  { kind: 'selectRoom', roomId: '!a' },
  { kind: 'open', roomId: '!a' },
  { kind: 'open', roomId: '!a', threadId: '$t' },
];

describe('isCaptureMessage', () => {
  it('accepts each message type', () => {
    expect(isCaptureMessage({ v: 1, type: 'hello' })).toBe(true);
    expect(
      isCaptureMessage({ v: 1, type: 'request', id: 'i', hostId: 'a', action: actions[1] })
    ).toBe(true);
    expect(isCaptureMessage({ v: 1, type: 'state', hostId: 'a', state })).toBe(true);
    expect(
      isCaptureMessage({ v: 1, type: 'response', id: 'i', hostId: 'a', result: { ok: true } })
    ).toBe(true);
    expect(
      isCaptureMessage({
        v: 1,
        type: 'response',
        id: 'i',
        hostId: 'a',
        result: { ok: true, threadId: '$t' },
      })
    ).toBe(true);
    expect(
      isCaptureMessage({
        v: 1,
        type: 'response',
        id: 'i',
        hostId: 'a',
        result: { ok: false, error: 'timeout' },
      })
    ).toBe(true);
    expect(isCaptureMessage({ v: 1, type: 'gone', hostId: 'a' })).toBe(true);
  });

  it('accepts each action kind', () => {
    for (const action of actions) {
      expect(isCaptureMessage({ v: 1, type: 'request', id: 'i', hostId: 'a', action })).toBe(true);
    }
  });

  it('accepts a state with no room and no items', () => {
    expect(
      isCaptureMessage({
        v: 1,
        type: 'state',
        hostId: 'a',
        state: { ...state, roomId: null, rooms: [], items: [] },
      })
    ).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isCaptureMessage({ v: 2, type: 'hello' })).toBe(false);
    expect(isCaptureMessage({ v: 1, type: 'unknown' })).toBe(false);
    expect(isCaptureMessage({ v: 1, type: 'request', id: 'i', action: actions[1] })).toBe(false);
    expect(
      isCaptureMessage({
        v: 1,
        type: 'request',
        id: 'i',
        hostId: 'a',
        action: { kind: 'send', roomId: '!a', text: 'x', images: ['no'], open: false },
      })
    ).toBe(false);
    expect(
      isCaptureMessage({ v: 1, type: 'state', hostId: 'a', state: { ...state, items: {} } })
    ).toBe(false);
    expect(
      isCaptureMessage({
        v: 1,
        type: 'response',
        id: 'i',
        hostId: 'a',
        result: { ok: false, error: 'bad' },
      })
    ).toBe(false);
    expect(isCaptureMessage(null)).toBe(false);
    expect(isCaptureMessage('hello')).toBe(false);
  });
});
