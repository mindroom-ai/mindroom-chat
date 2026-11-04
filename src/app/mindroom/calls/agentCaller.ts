import { useCallback, useState } from 'react';
import { useStore } from 'jotai';
import { ClientEvent, KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  activeCallAtom,
  useCallActions,
  type StartCallResult,
} from '../../features/calls/callStore';
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

/**
 * Calls a MindRoom agent: in this account's permanent call room with the agent (made on the
 * first call, encrypted when the conversation is), after writing which conversation the call is
 * about. The call panel opens in that conversation.
 */
export const useAgentCaller = () => {
  const mx = useMatrixClient();
  const store = useStore();
  const { startCall } = useCallActions(mx);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AgentCallError>();

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
        await prepareAgentCallRoom(mx, callRoom, agentUserId, toAgentCallOrigin(roomId, threadId));
        const room = callRoom;
        const result: StartCallResult = await startCall({
          room,
          kind: 'agent',
          agentUserId,
          origin: { roomId, threadId },
          microphone: true,
          video: false,
          onEnded: () => cleanupMindroomAgentCall(mx, room),
        });
        if (result === 'busy') setError('busy');
        return result === 'started';
      } catch {
        setError('failed');
        return false;
      } finally {
        setPending(false);
      }
    },
    [mx, startCall, store]
  );

  return { call, pending, error, clearError: () => setError(undefined) };
};
