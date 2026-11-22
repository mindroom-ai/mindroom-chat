import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';

const CANCEL_SENT_CLEAR_MS = 6_000;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, boolean> = new Map();

type CancelBucket = {
  roomId: string;
  pendingCancelIds: ReadonlySet<string>;
  cancelSentIds: ReadonlySet<string>;
  cancelErrors: ReadonlyMap<string, boolean>;
};

const emptyBucket = (roomId: string): CancelBucket => ({
  roomId,
  pendingCancelIds: new Set(),
  cancelSentIds: new Set(),
  cancelErrors: new Map(),
});

export type ScheduleCancelState = {
  pendingCancelIds: ReadonlySet<string>;
  cancelSentIds: ReadonlySet<string>;
  cancelErrors: ReadonlyMap<string, boolean>;
  handleCancelTask: (task: ParsedScheduledTask) => Promise<boolean>;
  clearCancelError: (taskId: string) => void;
};

/**
 * Tracks per-room schedule cancellation requests, short-lived "sent" acknowledgements, and
 * send failures so state survives dialog close/reopen while resetting cleanly on room change.
 */
export function useScheduleCancelState(
  roomId: string,
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>
): ScheduleCancelState {
  const [bucket, setBucket] = useState<CancelBucket>(() => emptyBucket(roomId));
  const pendingRef = useRef<Set<string>>(new Set());
  const cancelSentTimersRef = useRef<Map<string, number>>(new Map());
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const onCancelTaskRef = useRef(onCancelTask);
  onCancelTaskRef.current = onCancelTask;

  useEffect(() => {
    mountedRef.current = true;
    const timers = cancelSentTimersRef.current;
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
      pending.clear();
    };
  }, []);

  const prevRoomIdRef = useRef(roomId);
  useEffect(() => {
    if (prevRoomIdRef.current === roomId) return;
    prevRoomIdRef.current = roomId;
    generationRef.current += 1;
    cancelSentTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    cancelSentTimersRef.current.clear();
    pendingRef.current.clear();
    setBucket(emptyBucket(roomId));
  }, [roomId]);

  const handleCancelTask = useCallback(
    async (task: ParsedScheduledTask): Promise<boolean> => {
      const cancel = onCancelTaskRef.current;
      if (!cancel || pendingRef.current.has(task.taskId)) return false;

      const requestGeneration = generationRef.current;
      const requestRoomId = roomId;
      pendingRef.current.add(task.taskId);
      setBucket((prev) => {
        const base = prev.roomId === requestRoomId ? prev : emptyBucket(requestRoomId);
        const nextPending = new Set(base.pendingCancelIds);
        nextPending.add(task.taskId);
        let nextErrors = base.cancelErrors;
        if (base.cancelErrors.has(task.taskId)) {
          const updated = new Map(base.cancelErrors);
          updated.delete(task.taskId);
          nextErrors = updated;
        }
        return { ...base, pendingCancelIds: nextPending, cancelErrors: nextErrors };
      });

      try {
        await cancel(task);
        if (!mountedRef.current || generationRef.current !== requestGeneration) return true;
        pendingRef.current.delete(task.taskId);
        setBucket((prev) => {
          if (prev.roomId !== requestRoomId) return prev;
          const nextPending = new Set(prev.pendingCancelIds);
          nextPending.delete(task.taskId);
          const nextSent = new Set(prev.cancelSentIds);
          nextSent.add(task.taskId);
          return { ...prev, pendingCancelIds: nextPending, cancelSentIds: nextSent };
        });

        const existingTimer = cancelSentTimersRef.current.get(task.taskId);
        if (existingTimer !== undefined) window.clearTimeout(existingTimer);
        const timerId = window.setTimeout(() => {
          cancelSentTimersRef.current.delete(task.taskId);
          if (!mountedRef.current || generationRef.current !== requestGeneration) return;
          setBucket((prev) => {
            if (prev.roomId !== requestRoomId || !prev.cancelSentIds.has(task.taskId)) return prev;
            const nextSent = new Set(prev.cancelSentIds);
            nextSent.delete(task.taskId);
            return { ...prev, cancelSentIds: nextSent };
          });
        }, CANCEL_SENT_CLEAR_MS);
        cancelSentTimersRef.current.set(task.taskId, timerId);
        return true;
      } catch {
        if (!mountedRef.current || generationRef.current !== requestGeneration) return false;
        pendingRef.current.delete(task.taskId);
        setBucket((prev) => {
          if (prev.roomId !== requestRoomId) return prev;
          const nextPending = new Set(prev.pendingCancelIds);
          nextPending.delete(task.taskId);
          const nextErrors = new Map(prev.cancelErrors);
          nextErrors.set(task.taskId, true);
          return { ...prev, pendingCancelIds: nextPending, cancelErrors: nextErrors };
        });
        return false;
      }
    },
    [roomId]
  );

  const clearCancelError = useCallback(
    (taskId: string) => {
      setBucket((prev) => {
        if (prev.roomId !== roomId || !prev.cancelErrors.has(taskId)) return prev;
        const nextErrors = new Map(prev.cancelErrors);
        nextErrors.delete(taskId);
        return { ...prev, cancelErrors: nextErrors };
      });
    },
    [roomId]
  );

  const sameRoom = bucket.roomId === roomId;
  const pendingCancelIds = sameRoom ? bucket.pendingCancelIds : EMPTY_SET;
  const cancelSentIds = sameRoom ? bucket.cancelSentIds : EMPTY_SET;
  const cancelErrors = sameRoom ? bucket.cancelErrors : EMPTY_MAP;

  return useMemo(
    () => ({
      pendingCancelIds,
      cancelSentIds,
      cancelErrors,
      handleCancelTask,
      clearCancelError,
    }),
    [cancelErrors, cancelSentIds, clearCancelError, handleCancelTask, pendingCancelIds]
  );
}
