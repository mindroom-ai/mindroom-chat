import type { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { agentRoomState, useAgentRoomStateVersion } from '../matrix/agentRoomState';
import {
  MINDROOM_AUTO_APPROVE_EVENT,
  selectAutoApproveWindows,
  type AutoApproveWindow,
} from './autoApproveContract';

/** Every `!auto_approve` window MindRoom publishes for the room, read again only when that state could have changed. */
export const useRoomAutoApproveWindows = (room: Room): AutoApproveWindow[] => {
  const version = useAgentRoomStateVersion(room, MINDROOM_AUTO_APPROVE_EVENT);
  return useMemo(() => {
    void version;
    return selectAutoApproveWindows(agentRoomState(room, MINDROOM_AUTO_APPROVE_EVENT));
  }, [room, version]);
};
