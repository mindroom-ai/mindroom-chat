import type { Room } from 'matrix-js-sdk';
import { useAgentRoomState } from '../matrix/protocol/agentRoomState';
import {
  type BackgroundJob,
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
} from '../matrix/protocol/backgroundJobsContract';

/**
 * The room's listed background jobs and the number of its live ones, read again only when its
 * agents' jobs state could have changed.
 */
export const useRoomBackgroundJobs = (room: Room): { jobs: BackgroundJob[]; total: number } =>
  useAgentRoomState(room, MINDROOM_BACKGROUND_JOBS_EVENT, selectBackgroundJobs);
