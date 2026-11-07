// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { CallTranscription } from './CallTranscription';
import { activeCallAtom, type ActiveCall } from '../callStore';
import type { CallState } from '../RoomCall';
import type { CallTranscriberOptions } from './callTranscriber';
import type { TranscriptCall } from './api';
import { callTranscriptionAtom, liveTranscriptAtom, pauseHeldAtom } from './transcriptionState';
import { requestAudienceOpenIdToken } from '../../matrix/openidAudience';
import { defined } from '../../../test/utils/defined';

const ROOM_ID = '!room:example.org';
const PUBLISHED = 'https://published.example.org';
const CONFIGURED = 'https://configured.example.org';

const TOKEN: IOpenIDToken = {
  access_token: 'openid',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: null,
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org'],
  holds: [],
  transcribedBy: ['@ann:example.org'],
};

/** The room, its agents' servers and the device's settings, as the mocked hooks report them. */
const room = vi.hoisted(() => ({
  members: [] as Array<{ userId: string; membership: string }>,
  servers: [] as Array<{ agentUserId: string; apiUrl: string; computer: boolean; ts: number }>,
  bindsTokens: true,
  configured: undefined as string | undefined,
}));

const mx = vi.hoisted(() => ({ getSafeUserId: () => '@ann:example.org' }));

/** Each transcriber made, with what it was told. */
const made = vi.hoisted(
  () =>
    [] as Array<{
      options: CallTranscriberOptions;
      start: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      setMicrophone: ReturnType<typeof vi.fn>;
      setPaused: ReturnType<typeof vi.fn>;
      setHolding: ReturnType<typeof vi.fn>;
    }>
);

vi.mock('./callTranscriber', () => ({
  CallTranscriber: class {
    start = vi.fn();

    end = vi.fn(async () => undefined);

    setMicrophone = vi.fn();

    setPaused = vi.fn();

    setHolding = vi.fn();

    constructor(options: CallTranscriberOptions) {
      made.push({
        options,
        start: this.start,
        end: this.end,
        setMicrophone: this.setMicrophone,
        setPaused: this.setPaused,
        setHolding: this.setHolding,
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
vi.mock('../../computer/useComputerApiUrl', () => ({
  useComputerApiUrl: (discovered?: string) => room.configured ?? discovered,
}));
vi.mock('../../matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: vi.fn(async () => TOKEN),
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
  vi.mocked(requestAudienceOpenIdToken).mockClear();
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
    expect(transcriber.options).toMatchObject({ roomId: ROOM_ID, apiUrl: PUBLISHED });
    expect(transcriber.start).toHaveBeenCalledTimes(1);
    expect(store.get(callTranscriptionAtom)).toEqual({ roomId: ROOM_ID, status: 'joining' });

    // A server the agents published gets a token only while the homeserver binds it.
    await expect(transcriber.options.getOpenIdToken()).resolves.toBe(TOKEN);
    expect(requestAudienceOpenIdToken).toHaveBeenCalledWith(mx, PUBLISHED, {
      requireBinding: true,
    });

    // Reconnecting is still the same call.
    set({ phase: 'reconnecting' });
    set({ phase: 'connected' });
    await loaded();
    expect(made).toHaveLength(1);
    expect(transcriber.end).not.toHaveBeenCalled();
  });

  it('uses the MindRoom server this device or the deployment names', async () => {
    room.configured = CONFIGURED;
    const { set } = mount();
    set({ phase: 'connected' });
    await loaded();

    const transcriber = only();
    expect(transcriber.options.apiUrl).toBe(CONFIGURED);
    await transcriber.options.getOpenIdToken();
    expect(requestAudienceOpenIdToken).toHaveBeenCalledWith(mx, CONFIGURED, {
      requireBinding: false,
    });
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

  it('pauses listening at once while this device or anyone in the call holds Pause', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(false);

    act(() => store.set(pauseHeldAtom, true));
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(true);
    act(() => store.set(pauseHeldAtom, false));
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(false);

    act(() =>
      transcriber.options.onEvent({
        type: 'ready',
        live: { call: { ...CALL, holds: ['@bob:example.org'] }, lines: [], names: {} },
      })
    );
    expect(store.get(liveTranscriptAtom)?.call?.holds).toEqual(['@bob:example.org']);
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(true);
    act(() => transcriber.options.onEvent({ type: 'call', call: CALL }));
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(false);
  });

  it('takes the hold as Pause is pressed, pausing listening before MindRoom answers, and lets go', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    expect(transcriber.options.userId).toBe('@ann:example.org');
    expect(transcriber.setHolding).not.toHaveBeenCalled();

    // Outside React's batching: a page going away has no next render to wait for.
    store.set(pauseHeldAtom, true);
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(true);
    expect(transcriber.setHolding).toHaveBeenLastCalledWith(true);
    store.set(pauseHeldAtom, false);
    expect(transcriber.setHolding).toHaveBeenLastCalledWith(false);
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(false);
  });

  it('shows a refused hold as not held, which resumes listening', async () => {
    const { store, set } = mount();
    set({ phase: 'connected', microphoneTrack: MIC_A });
    await loaded();
    const transcriber = only();
    act(() => store.set(pauseHeldAtom, true));

    act(() => transcriber.options.onHoldRefused?.());
    expect(store.get(pauseHeldAtom)).toBe(false);
    expect(transcriber.setPaused).toHaveBeenLastCalledWith(false);
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
      transcriber.options.onEvent({ type: 'ready', live: { call: CALL, lines: [], names: {} } });
      store.set(pauseHeldAtom, true);
    });

    set({ phase: 'ended' });
    expect(transcriber.end).toHaveBeenCalledTimes(1);
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
    expect(store.get(liveTranscriptAtom)).toBeUndefined();
    expect(store.get(pauseHeldAtom)).toBe(false);

    // A transcriber on its way out changes nothing more.
    act(() => transcriber.options.onStatus('unavailable', undefined));
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
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
