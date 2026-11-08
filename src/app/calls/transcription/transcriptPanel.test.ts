import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { callPanelRoomAtom } from '../callStore';
import {
  closeTranscriptPanel,
  dismissTranscriptPanel,
  openTranscriptPanel,
  transcriptPanelAtom,
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

  it("leaves another room's panel alone", () => {
    const store = createStore();
    openTranscriptPanel(store, OTHER);
    closeTranscriptPanel(store, ROOM);
    dismissTranscriptPanel(store, ROOM);
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(OTHER);
  });
});
