import { useEffect, useRef, useState } from 'react';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';

export type ScheduleCancelStatus = 'pending' | 'sent' | 'error';
const CANCEL_SENT_CLEAR_MS = 6_000;

export function useScheduleCancelState(
  roomId: string,
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>
) {
  const [statusByTaskId, setStatusByTaskId] = useState<ReadonlyMap<string, ScheduleCancelStatus>>(
    () => new Map()
  );
  const pendingRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, number>());
  const genRef = useRef(0);

  useEffect(() => {
    genRef.current += 1;
    const timers = timersRef.current;
    const pending = pendingRef.current;
    setStatusByTaskId((prev) => (prev.size ? new Map() : prev));
    return () => {
      genRef.current += 1;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      pending.clear();
    };
  }, [roomId]);

  const setStatus = (id: string, status?: ScheduleCancelStatus, onlyIf?: ScheduleCancelStatus) =>
    setStatusByTaskId((prev) => {
      if (onlyIf ? prev.get(id) !== onlyIf : prev.get(id) === status) return prev;
      const next = new Map(prev);
      if (status) next.set(id, status);
      else next.delete(id);
      return next;
    });

  const handleCancelTask = async (task: ParsedScheduledTask): Promise<boolean> => {
    if (!onCancelTask || pendingRef.current.has(task.taskId)) return false;
    const gen = genRef.current;
    pendingRef.current.add(task.taskId);
    setStatus(task.taskId, 'pending');
    const ok = await onCancelTask(task).then(
      () => true,
      () => false
    );
    if (genRef.current !== gen) return ok;
    pendingRef.current.delete(task.taskId);
    setStatus(task.taskId, ok ? 'sent' : 'error');
    if (ok) {
      window.clearTimeout(timersRef.current.get(task.taskId));
      const timer = window.setTimeout(() => {
        timersRef.current.delete(task.taskId);
        if (genRef.current === gen) setStatus(task.taskId, undefined);
      }, CANCEL_SENT_CLEAR_MS);
      timersRef.current.set(task.taskId, timer);
    }
    return ok;
  };

  return {
    statusByTaskId,
    handleCancelTask,
    clearCancelError: (id: string) => setStatus(id, undefined, 'error'),
  };
}
