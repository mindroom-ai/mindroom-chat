import { useCallback, useState } from 'react';
import { atom, useStore } from 'jotai';
import { RoomStateEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { waitForJoinedRoom } from '../../matrix/waitForJoinedRoom';
import {
  activeCallAtom,
  useCallActions,
  type CallOrigin,
  type StartCallResult,
} from '../callStore';
import type { CallDevices } from '../RoomCall';
import { browserSupportsCalls } from '../callSupport';
import { getLivekitServiceUrl } from '../rtcFocus';
import { createRoomEncryptionState } from '../../matrix/createRoom';
import {
  cleanupMindroomAgentCall,
  createAgentVoiceRoom,
  findAgentCallRoom,
  prepareAgentCallRoom,
  toAgentCallOrigin,
} from './agentCall';

/** How long a new call room (or its new encryption) may take to arrive in sync before the call gives up. */
const ROOM_SYNC_TIMEOUT_MS = 20_000;

/** Resolves once sync shows the room encrypted; rejects after the timeout. */
const whenRoomEncrypted = (mx: MatrixClient, room: Room): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => settle(() => reject(new Error('The call room was not encrypted in time.'))),
      ROOM_SYNC_TIMEOUT_MS
    );
    function settle(done: () => void) {
      clearTimeout(timer);
      mx.off(RoomStateEvent.Events, onState);
      done();
    }
    function onState(event: MatrixEvent) {
      if (event.getRoomId() === room.roomId && room.hasEncryptionStateEvent()) settle(resolve);
    }
    mx.on(RoomStateEvent.Events, onState);
    if (room.hasEncryptionStateEvent()) settle(resolve);
  });

/**
 * A call about an encrypted conversation is encrypted too. The permanent call room is made once,
 * encrypted or not as the first call's conversation was, so a later call from an encrypted
 * conversation turns its encryption on (for good) and waits until sync shows it: this device and
 * the agent each decide on media encryption from the room's state when they join.
 */
const encryptCallRoomFor = async (mx: MatrixClient, room: Room, origin: CallOrigin) => {
  if (!mx.getRoom(origin.roomId)?.hasEncryptionStateEvent() || room.hasEncryptionStateEvent()) {
    return;
  }
  const { type, content } = createRoomEncryptionState();
  await mx.sendStateEvent(room.roomId, type as never, content as never, '');
  await whenRoomEncrypted(mx, room);
};

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
  /** Off unless asked: a call taken up after a reload keeps the camera it had. */
  video?: boolean;
  devices?: CallDevices;
};

/**
 * Writes which conversation the call is about into the agent call room (encrypting the room first
 * when the conversation is encrypted and the room is not), then joins its call;
 * ending the call clears that again, and so does a start that gives up after writing it (the
 * account switched meanwhile). Also takes an agent call up again after a reload.
 */
export const startAgentCall = (
  mx: MatrixClient,
  startCall: StartCall,
  { room, agentUserId, origin, microphone = true, video = false, devices }: AgentCallStart
): Promise<StartCallResult> =>
  startCall({
    room,
    kind: 'agent',
    agentUserId,
    origin,
    microphone,
    video,
    devices,
    // Written only once the call may start: a start that answers busy, such as while another
    // tab of this session is in a call in the same call room, leaves that call's origin alone.
    prepare: async () => {
      await encryptCallRoomFor(mx, room, origin);
      await prepareAgentCallRoom(
        mx,
        room,
        agentUserId,
        toAgentCallOrigin(origin.roomId, origin.threadId)
      );
    },
    onEnded: () => cleanupMindroomAgentCall(mx, room),
  });

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
      // A start still running when its account signed out or switched fails once the client
      // stops; the store is app-wide by then, so the next account would show the notice.
      if (next && announce && mx.clientRunning) {
        failureCount += 1;
        store.set(agentCallFailureAtom, { error: next, id: failureCount });
      }
    },
    [announce, mx, store]
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
          callRoom = await waitForJoinedRoom(mx, created, ROOM_SYNC_TIMEOUT_MS);
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

  return { call, pending, error };
};
