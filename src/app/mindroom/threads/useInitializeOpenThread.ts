import { useEffect } from 'react';
import { ThreadEvent, type Room, type Thread } from 'matrix-js-sdk';

/**
 * Loads the open thread's SDK model when it appears after the thread view started. A new thread
 * has no model until its first reply arrives, and the SDK leaves a model it creates from sync
 * unopened: it holds back the edits of the thread's events until something initializes it. Thread
 * cards and sidebar rows do that for the threads they show (`useInitializeShownThread`), but an
 * open thread with neither on screen (a phone, a room the sidebar does not list) kept an agent's
 * streamed reply at its first edit until a reload.
 */
export const useInitializeOpenThread = (room: Room | undefined, threadId: string | undefined) => {
  useEffect(() => {
    if (!room || !threadId) return undefined;
    const initialize = (thread: Thread | null | undefined) => {
      if (thread?.id === threadId) void thread.initialize();
    };
    initialize(room.getThread(threadId));
    room.on(ThreadEvent.New, initialize);
    return () => {
      room.removeListener(ThreadEvent.New, initialize);
    };
  }, [room, threadId]);
};
