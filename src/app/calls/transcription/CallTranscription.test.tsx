// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { CallTranscription } from './CallTranscription';
import { activeCallAtom, type ActiveCall } from '../callStore';
import type { CallState } from '../RoomCall';
import type { CallTranscriberOptions } from './callTranscriber';
import type { TranscriptCall } from './api';
import { callTranscriptionAtom, liveTranscriptAtom, pauseRequestAtom } from './transcriptionState';
import { clientSessions } from '../../computer/clientSessions';
import { defined } from '../../../test/utils/defined';

const ROOM_ID = '!room:example.org';
const PUBLISHED = 'https://published.example.org';
const CONFIGURED = 'https://configured.example.org';

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: null,
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org'],
  pausedBy: null,
};

/** The room, its agents' servers and the deployment's server, as the mocked hooks report them. */
const room = vi.hoisted(() => ({
  members: [] as Array<{ userId: string; membership: string }>,
  servers: [] as Array<{ agentUserId: string; apiUrl: string; computer: boolean; ts: number }>,
  bindsTokens: true,
  configured: undefined as string | undefined,
}));

const mx = vi.hoisted(() => ({ getSafeUserId: () => '@ann:example.org', getRoom: () => null }));

/** Each transcriber made, with what it was told. */
const made = vi.hoisted(
  () =>
    [] as Array<{
      options: CallTranscriberOptions;
      start: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      setMicrophone: ReturnType<typeof vi.fn>;
      setRequestPending: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      leaveNow: ReturnType<typeof vi.fn>;
    }>
);

vi.mock('./callTranscriber', () => ({
  CallTranscriber: class {
    start = vi.fn();

    end = vi.fn(async () => undefined);

    setMicrophone = vi.fn();

    setRequestPending = vi.fn();

    pause = vi.fn(async () => undefined);

    leaveNow = vi.fn();

    constructor(options: CallTranscriberOptions) {
      made.push({
        options,
        start: this.start,
        end: this.end,
        setMicrophone: this.setMicrophone,
        setRequestPending: this.setRequestPending,
        pause: this.pause,
        leaveNow: this.leaveNow,
      });
    }
  },
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => room.members }));
vi.mock('../../computer/useAgentServers', () => ({
  useBindsOpenIdTokens: () => room.bindsTokens,
  useRoomAgentServers: () => room.servers,
}));
vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({ mindroom: { computers: { apiUrl: room.configured } } }),
}));

const MIC_A = { id: 'mic-a' } as MediaStreamTrack;
const MIC_B = { id: 'mic-b' } as MediaStreamTrack;

/** A call this device is in, whose state a test changes. */
const fakeCall = () => {
  const listeners = new Set<() => void>();
  let state: CallState = {
    phase: 'connecting',
    microphone: true,
    camera: false,
    screenShare: false,
    sound: true,
    audioBlocked: false,
    devices: {},
    participants: [],
  };
  const call = {
    room: { roomId: ROOM_ID },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
  };
  const set = (change: Partial<CallState>) =>
    act(() => {
      state = { ...state, ...change };
      listeners.forEach((listener) => listener());
    });
  return { call, set };
};

let renderer: ReactTestRenderer | undefined;

const mount = (kind: ActiveCall['kind'] = 'room') => {
  const store = createStore();
  const { call, set } = fakeCall();
  store.set(activeCallAtom, { kind, call } as unknown as ActiveCall);
  act(() => {
    renderer = create(
      <Provider store={store}>
        <CallTranscription />
      </Provider>
    );
  });
  return { store, set };
};

const pending = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

/** Lets the transcriber's module load. */
const loaded = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const only = () => {
  expect(made).toHaveLength(1);
  return defined(made[0], 'the transcriber');
};

beforeEach(() => {
  made.length = 0;
  room.members = [{ userId: '@mindroom_router:example.org', membership: 'join' }];
  room.servers = [
    { agentUserId: '@mindroom_router:example.org', apiUrl: PUBLISHED, computer: false, ts: 1 },
  ];
  room.bindsTokens = true;
  room.configured = undefined;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('CallTranscription', () => {
  it("transcribes a room call once it is connected, on the server the room's agents published", async () => {
    const { store, set } = mount();
    await loaded();
    expect(made).toHaveLength(0);

    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    expect(transcriber.options.roomId).toBe(ROOM_ID);
    expect(transcriber.start).toHaveBeenCalledTimes(1);
    expect(store.get(callTranscriptionAtom)).toEqual({ roomId: ROOM_ID, status: 'joining' });

    // The account's session with that server, which gets a token only while the homeserver binds it.
    expect(transcriber.options.sessions).toBe(
      clientSessions(mx as unknown as MatrixClient, PUBLISHED, true)
    );

    // Reconnecting is still the same call.
    set({ phase: 'reconnecting' });
    set({ phase: 'connected' });
    await loaded();
    expect(made).toHaveLength(1);
    expect(transcriber.end).not.toHaveBeenCalled();
  });

  it("uses the deployment's MindRoom server when the room's agents published none", async () => {
    room.configured = CONFIGURED;
    room.servers = [];
    const { set } = mount();
    set({ phase: 'connected' });
    await loaded();

    const transcriber = only();
    expect(transcriber.options.sessions).toBe(
      clientSessions(mx as unknown as MatrixClient, CONFIGURED, false)
    );
  });

  it('skips calls with an agent, which post their own transcript', async () => {
    const { set } = mount('agent');
    set({ phase: 'connected' });
    await loaded();
    expect(made).toHaveLength(0);
  });

  it('does nothing in a room without a MindRoom agent or a server for it', async () => {
    room.members = [{ userId: '@bob:example.org', membership: 'join' }];
    room.configured = CONFIGURED;
    const withoutAgent = mount();
    withoutAgent.set({ phase: 'connected' });
    await loaded();
    expect(made).toHaveLength(0);

    room.members = [{ userId: '@mindroom_router:example.org', membership: 'join' }];
    room.configured = undefined;
    room.bindsTokens = false;
    const unbound = mount();
    unbound.set({ phase: 'connected' });
    await loaded();
    expect(made).toHaveLength(0);
  });

  it('listens to the microphone the call publishes, none while muted, and follows a switch', async () => {
    const { set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    expect(transcriber.setMicrophone).toHaveBeenLastCalledWith(MIC_A);

    set({ microphone: false });
    expect(transcriber.setMicrophone).toHaveBeenLastCalledWith(undefined);
    set({ microphone: true, microphoneTrack: MIC_B });
    expect(transcriber.setMicrophone).toHaveBeenLastCalledWith(MIC_B);
  });

  it('tells the transcriber only whether a request pressed here is unanswered', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(false);

    // What MindRoom says is the transcriber's own to follow.
    act(() =>
      transcriber.options.onUpdate({
        type: 'live',
        live: { call: { ...CALL, pausedBy: '@bob:example.org' }, lines: [], names: {} },
      })
    );
    expect(store.get(liveTranscriptAtom)?.call?.pausedBy).toBe('@bob:example.org');
    expect(transcriber.setRequestPending).toHaveBeenCalledTimes(1);
  });

  it('sends Pause pressed here, pausing listening before MindRoom answers', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    const answer = pending();
    transcriber.pause.mockImplementationOnce(() => answer.promise);

    act(() => store.set(pauseRequestAtom, true));
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(true);
    expect(transcriber.pause).toHaveBeenLastCalledWith(true);

    // Answered: MindRoom's state counts again.
    await act(async () => {
      transcriber.options.onUpdate({
        type: 'call',
        call: { ...CALL, pausedBy: '@ann:example.org' },
      });
      answer.resolve();
    });
    expect(store.get(pauseRequestAtom)).toBeUndefined();
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(false);
  });

  it('keeps listening paused after Resume pressed here until MindRoom answers it', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    act(() =>
      transcriber.options.onUpdate({
        type: 'call',
        call: { ...CALL, pausedBy: '@bob:example.org' },
      })
    );
    const answer = pending();
    transcriber.pause.mockImplementationOnce(() => answer.promise);

    act(() => store.set(pauseRequestAtom, false));
    expect(transcriber.pause).toHaveBeenLastCalledWith(false);
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(true);

    await act(async () => {
      transcriber.options.onUpdate({ type: 'call', call: CALL });
      answer.resolve();
    });
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(false);
  });

  it('keeps listening paused while any Pause or Resume pressed here is unanswered', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    const pauseAnswer = pending();
    const resumeAnswer = pending();
    transcriber.pause
      .mockImplementationOnce(() => pauseAnswer.promise)
      .mockImplementationOnce(() => resumeAnswer.promise);

    // Pause, then Resume before MindRoom answered either.
    act(() => store.set(pauseRequestAtom, true));
    act(() => store.set(pauseRequestAtom, false));
    expect(transcriber.pause.mock.calls).toEqual([[true], [false]]);
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(true);

    await act(async () => {
      transcriber.options.onUpdate({
        type: 'call',
        call: { ...CALL, pausedBy: '@ann:example.org' },
      });
      pauseAnswer.resolve();
    });
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(true);

    // Both answered: MindRoom's state counts.
    await act(async () => {
      transcriber.options.onUpdate({ type: 'call', call: CALL });
      resumeAnswer.resolve();
    });
    expect(store.get(pauseRequestAtom)).toBeUndefined();
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(false);
  });

  it("keeps a call's Pause pressed here when an earlier call's request is answered", async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const first = only();
    const firstAnswer = pending();
    first.pause.mockImplementationOnce(() => firstAnswer.promise);
    act(() => store.set(pauseRequestAtom, true));

    // Leave while MindRoom has not answered, join another call and pause it.
    act(() => store.set(activeCallAtom, undefined));
    const next = fakeCall();
    act(() =>
      store.set(activeCallAtom, { kind: 'room', call: next.call } as unknown as ActiveCall)
    );
    next.set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const second = defined(made[1], 'the second transcriber');
    second.pause.mockImplementationOnce(() => pending().promise);
    act(() => store.set(pauseRequestAtom, true));
    expect(second.pause).toHaveBeenLastCalledWith(true);

    await act(async () => firstAnswer.resolve());
    expect(store.get(pauseRequestAtom)).toBe(true);
    expect(second.setRequestPending).toHaveBeenLastCalledWith(true);
  });

  it('shows the state MindRoom reports after a refused Pause, which resumes listening', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();

    // Refused: the transcriber hands on no answer.
    await act(async () => store.set(pauseRequestAtom, true));
    expect(store.get(pauseRequestAtom)).toBeUndefined();
    expect(transcriber.setRequestPending).toHaveBeenLastCalledWith(false);
  });

  it('shows how transcription goes, and nothing for a room MindRoom does not transcribe', async () => {
    const { store, set } = mount();
    set({ phase: 'connected' });
    await loaded();
    const transcriber = only();

    act(() => transcriber.options.onStatus('unavailable', undefined));
    expect(store.get(callTranscriptionAtom)).toEqual({ roomId: ROOM_ID, status: 'unavailable' });
    act(() => transcriber.options.onStatus('transcribing', 'call-1'));
    expect(store.get(callTranscriptionAtom)).toEqual({ roomId: ROOM_ID, status: 'transcribing' });
    act(() => transcriber.options.onStatus('off', undefined));
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
  });

  it('ends when the call ends, and clears what it showed', async () => {
    const { store, set } = mount();
    set({ phase: 'connected' });
    await loaded();
    const transcriber = only();
    act(() => {
      transcriber.options.onStatus('transcribing', 'call-1');
      transcriber.options.onUpdate({ type: 'live', live: { call: CALL, lines: [], names: {} } });
      store.set(pauseRequestAtom, true);
    });

    set({ phase: 'ended' });
    expect(transcriber.end).toHaveBeenCalledTimes(1);
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
    expect(store.get(liveTranscriptAtom)).toBeUndefined();
    expect(store.get(pauseRequestAtom)).toBeUndefined();

    // A transcriber on its way out changes nothing more.
    act(() => transcriber.options.onStatus('unavailable', undefined));
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
  });

  it('leaves at once when the page goes away, and no more once the call ended', async () => {
    const { set } = mount();
    set({ phase: 'connected' });
    await loaded();
    const transcriber = only();

    window.dispatchEvent(new Event('pagehide'));
    expect(transcriber.leaveNow).toHaveBeenCalledTimes(1);

    set({ phase: 'ended' });
    window.dispatchEvent(new Event('pagehide'));
    expect(transcriber.leaveNow).toHaveBeenCalledTimes(1);
  });

  it('ends when the call goes away', async () => {
    const { store, set } = mount();
    set({ phase: 'connected' });
    await loaded();
    const transcriber = only();

    act(() => store.set(activeCallAtom, undefined));
    expect(transcriber.end).toHaveBeenCalledTimes(1);
  });

  it('makes no transcriber for a call that ended before its module loaded', async () => {
    const { set } = mount();
    set({ phase: 'connected' });
    set({ phase: 'ended' });
    await loaded();
    expect(made).toHaveLength(0);
  });
});
