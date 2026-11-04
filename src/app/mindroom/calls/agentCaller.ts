import { useCallback, useState } from 'react';
import { atom, useStore } from 'jotai';
import { ClientEvent, KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  activeCallAtom,
  useCallActions,
  type CallOrigin,
  type StartCallResult,
} from '../../features/calls/callStore';
import type { CallDevices } from '../../features/calls/RoomCall';
import { browserSupportsCalls } from '../../features/calls/callSupport';
import { getLivekitServiceUrl } from '../../features/calls/rtcFocus';
import {
  cleanupMindroomAgentCall,
  createAgentVoiceRoom,
  findAgentCallRoom,
  prepareAgentCallRoom,
  toAgentCallOrigin,
} from './agentCall';

/** How long a new call room may take to arrive in sync before the call is given up. */
const ROOM_SYNC_TIMEOUT_MS = 20_000;

/** The joined room once sync delivers it. */
export const waitForJoinedRoom = (
  mx: MatrixClient,
  roomId: string,
  timeoutMs = ROOM_SYNC_TIMEOUT_MS
): Promise<Room> =>
  new Promise((resolve, reject) => {
    const joined = () => {
      const room = mx.getRoom(roomId);
      return room?.getMyMembership() === KnownMembership.Join ? room : undefined;
    };
    const ready = joined();
    if (ready) {
      resolve(ready);
      return;
    }
    const check = () => {
      const room = joined();
      if (!room) return;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      finish();
      resolve(room);
    };
    const timer = window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      finish();
      reject(new Error(`Room ${roomId} did not arrive`));
    }, timeoutMs);
    const finish = () => {
      window.clearTimeout(timer);
      mx.off(ClientEvent.Room, check);
      mx.off(ClientEvent.Sync, check);
    };
    mx.on(ClientEvent.Room, check);
    mx.on(ClientEvent.Sync, check);
  });

export type AgentCallTarget = {
  agentUserId: string;
  displayName?: string;
  /** The conversation the call is about; the agent reads it and posts the call back there. */
  roomId: string;
  threadId?: string;
};

export type AgentCallError = 'browser' | 'homeserver' | 'busy' | 'failed';

/** What each error tells the person, in their language. */
export const AGENT_CALL_ERROR_KEYS = {
  browser: 'mindroomUi.calls.agentCallButton.browserUnsupported',
  homeserver: 'mindroomUi.calls.agentCallButton.homeserverUnsupported',
  busy: 'mindroomUi.calls.agentCallButton.endCurrentCall',
  failed: 'mindroomUi.calls.agentCallButton.failedToStart',
} as const satisfies Record<AgentCallError, string>;

/**
 * The newest agent call that did not start, from a place that cannot show why itself (the
 * header button, the phone room menu, which closes before the call starts). The account-wide
 * call notices show it.
 */
export type AgentCallFailure = { error: AgentCallError; id: number };

export const agentCallFailureAtom = atom<AgentCallFailure | undefined>(undefined);

let failureCount = 0;

type StartCall = ReturnType<typeof useCallActions>['startCall'];

export type AgentCallStart = {
  /** This account's call room with the agent. */
  room: Room;
  agentUserId: string;
  origin: CallOrigin;
  microphone?: boolean;
  devices?: CallDevices;
};

/**
 * Writes which conversation the call is about into the agent call room, then joins its call;
 * ending the call clears that again. Also takes an agent call up again after a reload.
 */
export const startAgentCall = async (
  mx: MatrixClient,
  startCall: StartCall,
  { room, agentUserId, origin, microphone = true, devices }: AgentCallStart
): Promise<StartCallResult> => {
  await prepareAgentCallRoom(
    mx,
    room,
    agentUserId,
    toAgentCallOrigin(origin.roomId, origin.threadId)
  );
  return startCall({
    room,
    kind: 'agent',
    agentUserId,
    origin,
    microphone,
    video: false,
    devices,
    onEnded: () => cleanupMindroomAgentCall(mx, room),
  });
};

type AgentCallerOptions = {
  /**
   * Also report errors account-wide (`agentCallFailureAtom`), for callers that show no error
   * themselves or go away before the call starts.
   */
  announce?: boolean;
};

/**
 * Calls a MindRoom agent: in this account's permanent call room with the agent (made on the
 * first call, encrypted when the conversation is), after writing which conversation the call is
 * about. The call panel opens in that conversation.
 */
export const useAgentCaller = ({ announce = false }: AgentCallerOptions = {}) => {
  const mx = useMatrixClient();
  const store = useStore();
  const { startCall } = useCallActions(mx);
  const [pending, setPending] = useState(false);
  const [error, setOwnError] = useState<AgentCallError>();
  const setError = useCallback(
    (next: AgentCallError | undefined) => {
      setOwnError(next);
      if (next && announce) {
        failureCount += 1;
        store.set(agentCallFailureAtom, { error: next, id: failureCount });
      }
    },
    [announce, store]
  );

  const call = useCallback(
    async ({ agentUserId, displayName, roomId, threadId }: AgentCallTarget): Promise<boolean> => {
      setError(undefined);
      // Another call's room keeps its origin: nothing is written while a call runs.
      if (store.get(activeCallAtom)) {
        setError('busy');
        return false;
      }
      if (!browserSupportsCalls()) {
        setError('browser');
        return false;
      }
      setPending(true);
      try {
        if (!(await getLivekitServiceUrl(mx))) {
          setError('homeserver');
          return false;
        }
        const encrypted = !!mx.getRoom(roomId)?.hasEncryptionStateEvent();
        let callRoom = findAgentCallRoom(mx, agentUserId);
        if (!callRoom) {
          const created = await createAgentVoiceRoom(mx, agentUserId, displayName, encrypted);
          callRoom = await waitForJoinedRoom(mx, created);
        }
        const result = await startAgentCall(mx, startCall, {
          room: callRoom,
          agentUserId,
          origin: { roomId, threadId },
        });
        if (result !== 'started') setError(result);
        return result === 'started';
      } catch {
        setError('failed');
        return false;
      } finally {
        setPending(false);
      }
    },
    [mx, setError, startCall, store]
  );

  return { call, pending, error, clearError: () => setOwnError(undefined) };
};
