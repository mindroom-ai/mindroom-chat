import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../callStore';
import {
  closeTranscriptPanel,
  dismissTranscriptPanel,
  openTranscriptPanel,
  transcriptPanelAtom,
  transcriptRoomId,
} from './transcriptPanel';

const ROOM = '!room:example.org';
const OTHER = '!other:example.org';

describe('the live transcript panel', () => {
  it("takes the room's call panel's place, which comes back when it closes", () => {
    const store = createStore();
    store.set(callPanelRoomAtom, ROOM);

    openTranscriptPanel(store, ROOM);
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(ROOM);
    expect(store.get(callPanelRoomAtom)).toBeUndefined();

    closeTranscriptPanel(store, ROOM);
    expect(store.get(transcriptPanelAtom)).toBeUndefined();
    expect(store.get(callPanelRoomAtom)).toBe(ROOM);
  });

  it('still brings the call panel back after Transcript is pressed again while it shows', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, ROOM);
    openTranscriptPanel(store, ROOM);

    openTranscriptPanel(store, ROOM);
    closeTranscriptPanel(store, ROOM);
    expect(store.get(callPanelRoomAtom)).toBe(ROOM);
  });

  it('opens no call panel on closing when it replaced none', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, OTHER);

    openTranscriptPanel(store, ROOM);
    expect(store.get(callPanelRoomAtom)).toBe(OTHER);
    closeTranscriptPanel(store, ROOM);
    expect(store.get(callPanelRoomAtom)).toBe(OTHER);
  });

  it('gives way to another panel without bringing the call panel back', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, ROOM);
    openTranscriptPanel(store, ROOM);

    dismissTranscriptPanel(store, ROOM);
    expect(store.get(transcriptPanelAtom)).toBeUndefined();
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });

  it('leaves a floating call view in place, which no side panel replaces', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, ROOM);

    openTranscriptPanel(store, ROOM, true);
    expect(store.get(transcriptPanelAtom)).toEqual({ roomId: ROOM, replacedCall: false });
    expect(store.get(callPanelRoomAtom)).toBe(ROOM);
    closeTranscriptPanel(store, ROOM);
    expect(store.get(callPanelRoomAtom)).toBe(ROOM);
  });

  it("leaves another room's panel alone", () => {
    const store = createStore();
    openTranscriptPanel(store, OTHER);
    closeTranscriptPanel(store, ROOM);
    dismissTranscriptPanel(store, ROOM);
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(OTHER);
  });
});

describe("the room a call's transcript shows in", () => {
  const CALL_ROOM = '!agent-call:example.org';
  const inCall = (kind: ActiveCall['kind'], origin?: string) => {
    const store = createStore();
    store.set(activeCallAtom, {
      kind,
      origin: origin && { roomId: origin },
      call: { room: { roomId: CALL_ROOM } },
    } as unknown as ActiveCall);
    return store;
  };

  it("is the conversation of this device's agent call, or the call room while its panel is there", () => {
    const store = inCall('agent', ROOM);
    expect(transcriptRoomId(store, CALL_ROOM)).toBe(ROOM);
    store.set(callPanelRoomAtom, ROOM);
    expect(transcriptRoomId(store, CALL_ROOM)).toBe(ROOM);
    store.set(callPanelRoomAtom, CALL_ROOM);
    expect(transcriptRoomId(store, CALL_ROOM)).toBe(CALL_ROOM);
    // A panel on another room's call is not this call's.
    store.set(callPanelRoomAtom, OTHER);
    expect(transcriptRoomId(store, CALL_ROOM)).toBe(ROOM);
  });

  it("is the call's own room for a room call and for a call this device is not in", () => {
    expect(transcriptRoomId(inCall('room'), CALL_ROOM)).toBe(CALL_ROOM);
    expect(transcriptRoomId(inCall('agent', ROOM), OTHER)).toBe(OTHER);
    expect(transcriptRoomId(createStore(), OTHER)).toBe(OTHER);
  });
});
