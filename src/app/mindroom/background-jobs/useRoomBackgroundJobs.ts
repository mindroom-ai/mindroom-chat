import type { Room } from 'matrix-js-sdk';
import { useAgentRoomState } from '../matrix/useAgentRoomState';
import {
  type BackgroundJob,
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
} from './backgroundJobsContract';

/** Every live background job MindRoom agents publish for the room. */
export const useRoomBackgroundJobs = (room: Room): BackgroundJob[] =>
  useAgentRoomState(room, MINDROOM_BACKGROUND_JOBS_EVENT, selectBackgroundJobs);
