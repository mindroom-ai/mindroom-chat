import type { Room } from 'matrix-js-sdk';
import { useAgentRoomState } from '../matrix/useAgentRoomState';
import { MINDROOM_YOLO_EVENT, selectYoloWindows, type YoloWindow } from './yoloContract';

/** Every `!yolo` window MindRoom publishes for the room. */
export const useRoomYoloWindows = (room: Room): YoloWindow[] =>
  useAgentRoomState(room, MINDROOM_YOLO_EVENT, selectYoloWindows);
