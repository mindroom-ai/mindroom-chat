// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { LiveTranscriptPanel } from './LiveTranscriptPanel';
import { activeCallAtom, type ActiveCall } from '../callStore';
import { callTranscriptionAtom, liveTranscriptAtom } from './transcriptionState';
import type { LiveCall, TranscriptCall, TranscriptLine } from './api';

const ROOM_ID = '!room:example.org';
const ANN = '@ann:example.org';
const BOB = '@bob:example.org';
const CAROL = '@carol:example.org';

/** The server the room's agents name, and each time the panel reads the live call on its own. */
const state = vi.hoisted(() => ({
  apiUrl: undefined as string | undefined,
  polls: [] as Array<{
    roomId: string;
    everyMs: number;
    signal: AbortSignal;
    onLive: (live: LiveCall) => void;
    onFailure?: () => void;
    finish: (outcome: 'not-transcribed' | undefined) => void;
  }>,
}));

vi.mock('./useTranscriptionServer', () => ({
  useTranscriptionServer: () => ({ apiUrl: state.apiUrl, discovered: true }),
}));
vi.mock('./liveCallPoll', () => ({
  pollLiveCall: (
    _client: unknown,
    roomId: string,
    everyMs: number,
    signal: AbortSignal,
    onLive: (live: LiveCall) => void,
    onFailure?: () => void
  ) =>
    new Promise((finish) => {
      state.polls.push({ roomId, everyMs, signal, onLive, onFailure, finish });
    }),
}));
vi.mock('../../matrix/openidAudience', () => ({ requestAudienceOpenIdToken: vi.fn() }));
const mx = vi.hoisted(() => ({
  getSafeUserId: () => '@ann:example.org',
  getUserId: () => '@ann:example.org',
  mxcUrlToHttp: () => null,
  getRoom: () => room,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

// Carol is in the call, but the room has not loaded her membership: MindRoom names her.
const NAMES: Record<string, string> = { [ANN]: 'Ann', [BOB]: 'Bob' };
const room = {
  roomId: ROOM_ID,
  name: 'Planning',
  getMember: (userId: string) =>
    NAMES[userId]
      ? { userId, name: NAMES[userId], rawDisplayName: NAMES[userId], getMxcAvatarUrl: () => null }
      : null,
  membersLoaded: () => true,
} as unknown as Room;

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: '$row',
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: [ANN, BOB],
  pausedBy: null,
};

const line = (
  id: string,
  userId: string,
  saidAt: string,
  said: { text: string } | { reason: 'paused' | 'not-transcribed' }
): TranscriptLine =>
  ('text' in said
    ? { id, callId: 'call-1', userId, saidAt, seconds: 2, kind: 'speech', text: said.text }
    : {
        id,
        callId: 'call-1',
        userId,
        saidAt,
        seconds: 2,
        kind: 'gap',
        reason: said.reason,
      }) as TranscriptLine;

const LINES: TranscriptLine[] = [
  line('l1', ANN, '2026-11-07T09:30:00Z', { text: 'Shall we start?' }),
  line('l2', ANN, '2026-11-07T09:30:05Z', { text: 'The release is on Friday.' }),
  line('l3', BOB, '2026-11-07T09:30:10Z', { reason: 'paused' }),
  line('l4', BOB, '2026-11-07T09:31:00Z', { text: 'I will write the notes.' }),
  line('l5', BOB, '2026-11-07T09:31:10Z', { reason: 'not-transcribed' }),
];

let container: HTMLDivElement;
let root: Root;

const render = (store = createStore(), onClose = vi.fn()) => {
  act(() => {
    root.render(
      <Provider store={store}>
        <LiveTranscriptPanel room={room} onClose={onClose} />
      </Provider>
    );
  });
  return { store, onClose };
};

/** This device is in the room's call, transcribed, with what MindRoom said of it. */
const inCall = (live: LiveCall = { call: CALL, lines: LINES, names: { [ANN]: 'Annie' } }) => {
  const store = createStore();
  store.set(activeCallAtom, {
    kind: 'room',
    call: { room: { roomId: ROOM_ID } },
  } as unknown as ActiveCall);
  store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'transcribing' });
  store.set(liveTranscriptAtom, { roomId: ROOM_ID, ...live });
  return store;
};

const text = (selector: string) =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  state.apiUrl = undefined;
  state.polls = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('LiveTranscriptPanel', () => {
  it('shows the lines under who said them, the gaps, who is in the call, and that it is transcribed', () => {
    render(inCall());

    // The room's names come first: they tell apart members who share one.
    expect(text('[data-live-transcript-name]')).toEqual(['Ann', 'Bob']);
    expect(text('[data-live-transcript-text]')).toEqual([
      'Shall we start?',
      'The release is on Friday.',
      'I will write the notes.',
    ]);
    expect(text('[data-live-transcript-gap]')).toEqual(['Paused', 'Not transcribed']);
    expect(text('[data-live-transcript-member]')).toEqual(['Ann', 'Bob']);
    expect(container.textContent).toContain('This call is transcribed.');
    expect(container.querySelector('[role="log"]')).not.toBeNull();
  });

  it("has Pause in its header while it shows this device's call", () => {
    render(inCall());
    const header = container.querySelector('header');
    expect(header?.querySelector('[aria-label="Pause transcription"]')).not.toBeNull();
  });

  it("reads the room's live call every 2 seconds itself when this device is not in it, without Pause", () => {
    state.apiUrl = 'https://mindroom.example.org';
    render();
    expect(state.polls).toHaveLength(1);
    expect(state.polls[0]).toMatchObject({ roomId: ROOM_ID, everyMs: 2_000 });
    expect(container.querySelector('header [aria-label="Pause transcription"]')).toBeNull();

    act(() =>
      state.polls[0]?.onLive({
        call: CALL,
        lines: [line('l8', CAROL, '2026-11-07T09:31:50Z', { text: 'Hello all.' })],
        names: { [CAROL]: 'Carol' },
      })
    );
    // A later read brings only the lines after the last one.
    act(() =>
      state.polls[0]?.onLive({
        call: CALL,
        lines: [line('l9', CAROL, '2026-11-07T09:32:00Z', { text: 'Joining late, sorry.' })],
        names: {},
      })
    );
    expect(text('[data-live-transcript-name]')).toEqual(['Carol']);
    expect(text('[data-live-transcript-text]')).toEqual(['Hello all.', 'Joining late, sorry.']);
    expect(text('[data-live-transcript-member]')).toEqual(['Ann', 'Bob']);
    // Pause is for the call this device is in.
    expect(container.querySelector('header [aria-label="Pause transcription"]')).toBeNull();

    // A failed read keeps what was read, and says transcripts are unavailable.
    act(() => state.polls[0]?.onFailure?.());
    expect(container.textContent).toContain('Transcripts are unavailable');
    expect(text('[data-live-transcript-text]')).toHaveLength(2);

    act(() => root.unmount());
    expect(state.polls[0]?.signal.aborted).toBe(true);
    root = createRoot(container);
  });

  it('has its log in place before anyone speaks, so the first line is announced', () => {
    const store = inCall({ call: CALL, lines: [], names: {} });
    render(store);
    const log = container.querySelector('[role="log"]');
    expect(log).not.toBeNull();
    expect(container.textContent).toContain('Nothing has been said yet.');

    act(() =>
      store.set(liveTranscriptAtom, {
        roomId: ROOM_ID,
        call: CALL,
        lines: [line('l1', ANN, '2026-11-07T09:30:00Z', { text: 'Hello.' })],
        names: {},
      })
    );
    expect(container.querySelector('[role="log"]')).toBe(log);
    expect(log?.textContent).toContain('Hello.');
  });

  it('says when no call is on, and when the room is not transcribed', async () => {
    state.apiUrl = 'https://mindroom.example.org';
    render();
    act(() => state.polls[0]?.onLive({ call: null, lines: [], names: {} }));
    expect(container.textContent).toContain('No call is on in this room.');

    await act(async () => state.polls[0]?.finish('not-transcribed'));
    expect(container.textContent).toContain('Calls in this room are not transcribed.');
  });

  it('says only that transcripts are unavailable when nothing could be read yet', () => {
    state.apiUrl = 'https://mindroom.example.org';
    render();
    act(() => state.polls[0]?.onFailure?.());
    expect(container.textContent).toContain('Transcripts are unavailable');
    expect(container.textContent).not.toContain('No call is on in this room.');
  });

  it('says transcripts are unavailable while MindRoom cannot be reached', () => {
    const store = inCall();
    store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'unavailable' });
    render(store);
    expect(container.textContent).toContain('Transcripts are unavailable');
  });

  it('closes with its close button', () => {
    const { onClose } = render(inCall());
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close the live transcript"]')
        ?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
