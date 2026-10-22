import type { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { agentRoomState, useAgentRoomStateVersion } from '../matrix/agentRoomState';
import { MINDROOM_YOLO_EVENT, selectYoloWindows, type YoloWindow } from './yoloContract';

/** Every `!yolo` window MindRoom publishes for the room, read again only when that state could have changed. */
export const useRoomYoloWindows = (room: Room): YoloWindow[] => {
  const version = useAgentRoomStateVersion(room, MINDROOM_YOLO_EVENT);
  return useMemo(() => {
    void version;
    return selectYoloWindows(agentRoomState(room, MINDROOM_YOLO_EVENT));
  }, [room, version]);
};
