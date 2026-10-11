import type { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useStateEvents } from '../threads/useStateEvents';
import {
  type BackgroundJob,
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
} from './backgroundJobsContract';

/** The live background jobs of the open thread, or of the whole room in its main timeline. */
export const useBackgroundJobs = (room: Room, threadId: string | null): BackgroundJob[] => {
  const events = useStateEvents(room, MINDROOM_BACKGROUND_JOBS_EVENT);
  return useMemo(
    () =>
      selectBackgroundJobs(
        events,
        room.myUserId,
        (userId) => room.getMember(userId)?.membership === 'join',
        threadId
      ),
    [events, room, threadId]
  );
};
