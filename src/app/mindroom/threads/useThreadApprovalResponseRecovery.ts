import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  enqueueThreadResponseBackfill,
  type BackfillScheduler,
  type EnginePersistFacade,
} from '../engine';
import type { planThreadApprovalTimeline } from './threadApprovalTimeline';
import { usePageResume } from './usePageResume';

type RecoveryOptions = {
  mx: MatrixClient;
  room: Room;
  threadId?: string;
  scheduler: BackfillScheduler;
  persist: EnginePersistFacade['persistThreadEventCache'];
  events: readonly MatrixEvent[];
  fallbackGroups: ReturnType<typeof planThreadApprovalTimeline>['fallbackGroupsByEventId'];
  onRecovered: (threadId: string, events: MatrixEvent[]) => void;
};

export const useThreadApprovalResponseRecovery = ({
  mx,
  room,
  threadId,
  scheduler,
  persist,
  events,
  fallbackGroups,
  onRecovered,
}: RecoveryOptions) => {
  const [resume, setResume] = useState(0);
  usePageResume(useCallback(() => setResume((value) => value + 1), []));
  // Attempts belong to one client/thread visit and reset when the page resumes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attempted = useMemo(() => new Set<string>(), [mx, room, threadId, resume]);
  // An intentionally hidden/redacted loaded reply is not a missing reply.
  const loadedIds = new Set(events.map((event) => event.getId()));
  const ids = new Set<string>();
  fallbackGroups.forEach((records) =>
    records.forEach(({ approval }) => {
      const id = approval.responseEventId;
      if (id?.startsWith('$') && id !== threadId && !loadedIds.has(id)) ids.add(id);
    })
  );
  const key = JSON.stringify([...ids].sort());

  useEffect(() => {
    if (!threadId) return undefined;
    let active = true;
    const requested: string[] = JSON.parse(key);
    const recover = async () => {
      let remaining = requested.filter((id) => !attempted.has(id));
      while (active && remaining.length > 0) {
        const result = await enqueueThreadResponseBackfill(
          mx,
          scheduler,
          room.roomId,
          threadId,
          remaining,
          persist
        );
        if (!active || result.attemptedIds.length === 0) return;
        result.attemptedIds.forEach((id) => attempted.add(id));
        if (result.events.length > 0) onRecovered(threadId, result.events);
        // A deduplicated job may have started before another receipt arrived.
        // Explicitly request references that its executor never attempted.
        remaining = requested.filter((id) => !attempted.has(id));
      }
    };
    void recover().catch(() => undefined);
    return () => {
      active = false;
      // Scheduler jobs are shared with a new visit or another mounted consumer.
      // Only the engine owns their cancellation; cleanup guards this render sink.
    };
  }, [mx, room, threadId, scheduler, persist, onRecovered, key, attempted]);
};
