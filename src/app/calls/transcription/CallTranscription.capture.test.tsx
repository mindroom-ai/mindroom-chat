// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { CallTranscription } from './CallTranscription';
import { activeCallAtom, type ActiveCall } from '../callStore';
import type { CallState } from '../RoomCall';
import type { TranscriptCall } from './api';
import { liveTranscriptAtom } from './transcriptionState';

// The real component and transcriber, with a fake MindRoom and a fake microphone capture, in a
// root that batches updates as the app's does.

const ROOM_ID = '!room:example.org';

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: null,
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org', '@bob:example.org'],
  pausedBy: null,
};

/** The microphone capture: whether it is paused, as the transcriber last told it. */
const capture = vi.hoisted(() => ({ started: 0, paused: undefined as boolean | undefined }));

vi.mock('./speechCapture', () => ({
  startSpeechCapture: async () => {
    capture.started += 1;
    return {
      setPaused: (paused: boolean) => {
        capture.paused = paused;
      },
      stop: async () => undefined,
    };
  },
}));
vi.mock('./useTranscriptionServer', () => ({
  useTranscriptionServer: () => ({ apiUrl: 'https://mindroom.example.org', discovered: true }),
}));
const mx = vi.hoisted(() => ({}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: async () => ({
    access_token: 'openid',
    token_type: 'Bearer',
    matrix_server_name: 'example.org',
    expires_in: 3600,
  }),
}));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

describe('CallTranscription with its transcriber', () => {
  it('listens again when a read says the call resumed before a join that said paused showed', async () => {
    const join = pending<Response>();
    const read = pending<Response>();
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/client-sessions')) {
          return json({ session_token: 'session', expires_at: Date.now() / 1000 + 3600 });
        }
        const route = url.slice(url.lastIndexOf('/') + 1).replace(/\?.*/, '');
        sent.push(route);
        if (route === 'calls.join') return join.promise;
        if (route === 'calls.live' && sent.indexOf('calls.live') === sent.length - 1) {
          return read.promise;
        }
        return json(route === 'calls.live' ? { call: CALL, lines: [], names: {} } : {});
      })
    );
    const state: CallState = {
      phase: 'connected',
      microphone: true,
      microphoneTrack: { id: 'mic', kind: 'audio' } as MediaStreamTrack,
      camera: false,
      screenShare: false,
      sound: true,
      audioBlocked: false,
      devices: {},
      participants: [],
    };
    const call = {
      room: { roomId: ROOM_ID },
      subscribe: () => () => undefined,
      getState: () => state,
    };
    const store = createStore();
    store.set(activeCallAtom, { kind: 'room', call } as unknown as ActiveCall);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement('div'));
    act(() =>
      root?.render(
        <Provider store={store}>
          <CallTranscription />
        </Provider>
      )
    );
    await act(() => vi.waitFor(() => expect(sent).toContain('calls.join')));

    // The join says the call is paused; a read sent after it says it resumed. Both arrive before
    // the controls show either.
    await act(async () => {
      join.resolve(json({ call: { ...CALL, pausedBy: '@bob:example.org' } }));
      await vi.waitFor(() => expect(sent).toContain('calls.live'));
      await vi.waitFor(() => expect(capture.started).toBe(1));
      read.resolve(json({ call: CALL, lines: [], names: {} }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(store.get(liveTranscriptAtom)?.call?.pausedBy).toBeNull();
    expect(capture.paused).toBe(false);
  });
});
