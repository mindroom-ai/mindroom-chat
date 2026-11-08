// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { TranscriptionControls, TranscriptionStatus } from './TranscriptionControls';
import { callPanelRoomAtom } from '../callStore';
import {
  callTranscriptionAtom,
  liveTranscriptAtom,
  type TranscriptionStatus as Status,
} from './transcriptionState';
import { transcriptPanelAtom } from './transcriptPanel';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@ann:example.org' }),
}));

const ROOM_ID = '!room:example.org';
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) =>
    userId === '@bob:example.org' ? { userId, name: 'Bob', rawDisplayName: 'Bob' } : null,
  membersLoaded: () => true,
} as unknown as Room;

let container: HTMLDivElement;
let root: Root;

const render = (status?: Status) => {
  const store = createStore();
  if (status) store.set(callTranscriptionAtom, { roomId: ROOM_ID, status });
  act(() => {
    root.render(
      <Provider store={store}>
        <TranscriptionStatus room={room} />
        <div role="toolbar">
          <TranscriptionControls room={room} />
        </div>
      </Provider>
    );
  });
  return store;
};

const labels = () =>
  [...container.querySelectorAll('[role="toolbar"] button')].map((button) =>
    button.getAttribute('aria-label')
  );
const status = () => container.querySelector('[role="status"]')?.textContent;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the call controls for transcripts', () => {
  it('offer Pause and Transcript while the call is transcribed', () => {
    render('transcribing');
    expect(labels()).toEqual(['Pause transcription', 'Live transcript']);
    // The status line is there, empty, so screen readers hear what it says next.
    expect(status()).toBe('');
  });

  it.each([undefined, 'joining' as const])(
    'show nothing in a call that is not transcribed (%s)',
    (state) => {
      render(state);
      expect(labels()).toEqual([]);
      expect(container.textContent).toBe('');
    }
  );

  it('say "Transcripts are unavailable" while MindRoom cannot be reached', () => {
    render('unavailable');
    expect(labels()).toEqual([]);
    expect(status()).toBe('Transcripts are unavailable');
  });

  it('say who paused the transcript', () => {
    const store = render('transcribing');
    act(() =>
      store.set(liveTranscriptAtom, {
        roomId: ROOM_ID,
        call: {
          id: 'call-1',
          roomId: ROOM_ID,
          rowEventId: null,
          startedAt: '2026-11-07T09:29:00Z',
          endedAt: null,
          members: ['@ann:example.org', '@bob:example.org'],
          pausedBy: '@bob:example.org',
        },
        lines: [],
        names: {},
      })
    );
    expect(status()).toBe('Paused by Bob');
  });

  it("open the live transcript in the call panel's place, and pressed again keep it open", () => {
    const store = render('transcribing');
    store.set(callPanelRoomAtom, ROOM_ID);
    const transcript = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Live transcript"]');

    act(() => transcript()?.click());
    expect(store.get(transcriptPanelAtom)).toEqual({ roomId: ROOM_ID, replacedCall: true });
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(transcript()?.hasAttribute('aria-pressed')).toBe(false);

    // Pressed again it asks for the panel again, which unfolds it (Room.tsx), and closes nothing.
    act(() => transcript()?.click());
    expect(store.get(transcriptPanelAtom)).toEqual({ roomId: ROOM_ID, replacedCall: true });
  });
});
