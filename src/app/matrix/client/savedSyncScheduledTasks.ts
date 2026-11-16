import { isRecord } from '../../lib/isRecord';
import {
  isPendingScheduledTaskStatus,
  MINDROOM_SCHEDULED_TASK_EVENT,
} from '../protocol/scheduledTaskContract';

// The backend keeps every scheduled task as a state event in its room, and a finished or cancelled
// one stays there for good. A busy room collects thousands of them (one room held 3,453, 4 MB),
// and the SDK's sync store saves each room's state twice. Every start read, copied and replayed
// them before the first screen, and every save wrote them again, while the client shows only
// pending tasks. So the saved sync keeps only those: a task that is gone from it reads as not
// pending, which a finished one is.

/** The SDK's sync accumulator: each joined room's current state is its `_currentState`. */
type SavedSync = { joinRooms?: Record<string, object> };

const isPendingTask = (event: unknown): boolean =>
  isRecord(event) && isRecord(event.content) && isPendingScheduledTaskStatus(event.content.status);

/** Drops every scheduled task that is not pending from the rooms' state in `sync`. */
export const dropSettledScheduledTasks = (sync: SavedSync): void => {
  Object.values(sync.joinRooms ?? {}).forEach((room) => {
    const state = isRecord(room) ? room._currentState : undefined;
    const tasks = isRecord(state) ? state[MINDROOM_SCHEDULED_TASK_EVENT] : undefined;
    if (!isRecord(state) || !isRecord(tasks)) return;
    Object.entries(tasks).forEach(([taskId, event]) => {
      if (!isPendingTask(event)) delete tasks[taskId];
    });
    if (Object.keys(tasks).length === 0) delete state[MINDROOM_SCHEDULED_TASK_EVENT];
  });
};
