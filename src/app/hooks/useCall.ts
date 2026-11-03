import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import {
  CallMembership,
  MatrixRTCSession,
  MatrixRTCSessionEvent,
} from 'matrix-js-sdk/lib/matrixrtc';
import { useMatrixClient } from './useMatrixClient';

/** The room's MatrixRTC session. */
export const useCallSession = (room: Room): MatrixRTCSession => {
  const mx = useMatrixClient();
  return mx.matrixRTC.getRoomSession(room);
};

/** The session's members, following joins and leaves. */
export const useCallMembers = (session: MatrixRTCSession | undefined): CallMembership[] => {
  const [members, setMembers] = useState<CallMembership[]>(() => session?.memberships ?? []);

  useEffect(() => {
    if (!session) {
      setMembers([]);
      return undefined;
    }
    setMembers(session.memberships);
    const handleChange = (_old: CallMembership[], next: CallMembership[]) => setMembers(next);
    session.on(MatrixRTCSessionEvent.MembershipsChanged, handleChange);
    return () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, handleChange);
    };
  }, [session]);

  return members;
};
