// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { AgentCallTranscript } from './AgentCallTranscript';
import { activeCallAtom, type ActiveCall } from '../callStore';
import type { CallState } from '../RoomCall';
import { TranscriptionApiError, type LiveCall, type TranscriptCall } from './api';
import { transcriptPanelAtom } from './transcriptPanel';
import { callTranscriptionAtom, liveTranscriptAtom } from './transcriptionState';

const CALL_ROOM = '!agent-call:example.org';
const ORIGIN = '!conversation:example.org';
const ANN = '@ann:example.org';
const AGENT = '@mindroom_helper:example.org';

const CALL: TranscriptCall = {
  id: 'agent-call-1',
  roomId: CALL_ROOM,
  rowEventId: null,
  startedAt: '2026-11-15T09:00:00Z',
  endedAt: null,
  members: [ANN, AGENT],
  pausedBy: null,
};

/** Each read of the live call, to answer; and every other route, which agent calls never send. */
const server = vi.hoisted(() => ({
  apiUrl: 'https://mindroom.example.org' as string | undefined,
  reads: [] as Array<{
    roomId: string;
    after?: string;
    answer: (live: LiveCall) => void;
    fail: (error: unknown) => void;
  }>,
  other: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  TranscriptionClient: class {
    live(roomId: string, after?: string) {
      return new Promise((answer, fail) => {
        server.reads.push({ roomId, after, answer, fail });
      });
    }

    join = server.other;

    leave = server.other;

    pause = server.other;

    speech = server.other;
  },
}));
vi.mock('../../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => ({ apiUrl: server.apiUrl, pending: false }),
}));
const mx = vi.hoisted(() => ({ getSafeUserId: () => '@ann:example.org' }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

/** A call whose phase a test sets. */
const fakeCall = () => {
  const listeners = new Set<() => void>();
  let state = { phase: 'connecting' } as CallState;
  const call = {
    room: { roomId: CALL_ROOM },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
  };
  const set = (phase: CallState['phase']) =>
    act(() => {
      state = { ...state, phase };
      listeners.forEach((listener) => listener());
    });
  return { call, set };
};

let renderer: ReactTestRenderer | undefined;

const mount = (kind: ActiveCall['kind'] = 'agent') => {
  const store = createStore();
  const { call, set } = fakeCall();
  store.set(activeCallAtom, {
    kind,
    call,
    ...(kind === 'agent' ? { agentUserId: AGENT, origin: { roomId: ORIGIN } } : {}),
  } as unknown as ActiveCall);
  act(() => {
    renderer = create(
      <Provider store={store}>
        <AgentCallTranscript />
      </Provider>
    );
  });
  return { store, set };
};

/** Lets an answered read reach the atoms. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const lastRead = () => {
  const read = server.reads[server.reads.length - 1];
  if (!read) throw new Error('no read');
  return read;
};

beforeEach(() => {
  server.apiUrl = 'https://mindroom.example.org';
  server.reads = [];
  server.other.mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('AgentCallTranscript', () => {
  it('reads the agent call once connected, without joining or sending speech', async () => {
    const { store, set } = mount();
    expect(server.reads).toHaveLength(0);

    set('connected');
    expect(lastRead().roomId).toBe(CALL_ROOM);
    // Before MindRoom answers there is nothing to show yet: no "joining" as a room call has.
    expect(store.get(callTranscriptionAtom)).toBeUndefined();

    lastRead().answer({
      call: CALL,
      lines: [
        {
          id: 'l1',
          callId: CALL.id,
          userId: AGENT,
          saidAt: '2026-11-15T09:00:04Z',
          seconds: 0,
          kind: 'speech',
          text: 'Hello, how can I help?',
        },
      ],
      names: { [ANN]: 'Ann', [AGENT]: 'Helper' },
    });
    await settle();
    expect(store.get(callTranscriptionAtom)).toEqual({ roomId: CALL_ROOM, status: 'transcribing' });
    expect(store.get(liveTranscriptAtom)).toMatchObject({
      roomId: CALL_ROOM,
      call: CALL,
      lines: [{ id: 'l1', text: 'Hello, how can I help?' }],
    });
    expect(server.other).not.toHaveBeenCalled();
  });

  it('shows nothing until MindRoom has the call, and says when it cannot be reached', async () => {
    const { store, set } = mount();
    set('connected');
    lastRead().answer({ call: null, lines: [], names: {} });
    await settle();
    expect(store.get(callTranscriptionAtom)).toBeUndefined();

    act(() => renderer?.unmount());
    const unreachable = mount();
    unreachable.set('connected');
    lastRead().fail(new TranscriptionApiError('Bad gateway', 502));
    await settle();
    expect(unreachable.store.get(callTranscriptionAtom)).toEqual({
      roomId: CALL_ROOM,
      status: 'unavailable',
    });
  });

  it('shows nothing where MindRoom does not transcribe agent calls', async () => {
    const { store, set } = mount();
    set('connected');
    lastRead().fail(new TranscriptionApiError('Not found', 404));
    await settle();
    expect(store.get(callTranscriptionAtom)).toBeUndefined();
  });

  it.each(['ended', 'failed'] as const)(
    'stops reading once the call has %s, and closes its transcript in the conversation',
    async (over) => {
      const { store, set } = mount();
      set('connected');
      lastRead().answer({ call: CALL, lines: [], names: {} });
      await settle();
      store.set(transcriptPanelAtom, { roomId: ORIGIN, replacedCall: true });

      set('reconnecting');
      expect(store.get(transcriptPanelAtom)).toEqual({ roomId: ORIGIN, replacedCall: true });

      // A failed call stays on screen until it is dismissed; its transcript closes at once.
      set(over);
      expect(store.get(callTranscriptionAtom)).toBeUndefined();
      expect(store.get(liveTranscriptAtom)).toBeUndefined();
      expect(store.get(transcriptPanelAtom)).toBeUndefined();
    }
  );

  it('closes its transcript in the conversation when the call goes away while connected', () => {
    const { store, set } = mount();
    set('connected');
    store.set(transcriptPanelAtom, { roomId: ORIGIN, replacedCall: true });

    act(() => store.set(activeCallAtom, undefined));
    expect(store.get(transcriptPanelAtom)).toBeUndefined();
  });

  it('leaves room calls to their transcriber', () => {
    const { set } = mount('room');
    set('connected');
    expect(server.reads).toHaveLength(0);
  });
});
