import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { MatrixEvent, MatrixEventEvent, Room, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { enqueueThreadApprovalBackfill, useMindroomSyncEngine } from '../engine';
import { useLiveEventArrive } from '../threads/roomLiveEventArrive';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  isUndecryptedApprovalCandidate,
  MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
  parseToolApprovalExpiryTimestamp,
} from './toolApproval';
import { createApprovalActions, ApprovalAction, ApprovalActionState } from './approvalActions';
import {
  collectThreadApprovals,
  isPendingApproval,
  ThreadApprovalRecord,
} from './threadApprovalModel';

export type ThreadApprovals = {
  records: readonly ThreadApprovalRecord[];
  now: number;
  pendingEventIds: ReadonlySet<string>;
  loading: boolean;
  error?: string;
  refresh: () => void;
  ingest: (events: readonly MatrixEvent[]) => void;
  actions: ReadonlyMap<string, ApprovalActionState>;
  submit: (record: ThreadApprovalRecord, action: ApprovalAction) => Promise<void>;
};
const Context = createContext<ThreadApprovals | undefined>(undefined);
export const useThreadApprovals = () => useContext(Context);

export function ThreadApprovalProvider({
  room,
  threadId,
  children,
}: {
  room: Room;
  threadId?: string;
  children: React.ReactNode;
}) {
  return threadId ? (
    <ActiveThreadApprovalProvider
      key={`${room.roomId}:${threadId}`}
      room={room}
      threadId={threadId}
    >
      {children}
    </ActiveThreadApprovalProvider>
  ) : (
    <>{children}</>
  );
}

function ActiveThreadApprovalProvider({
  room,
  threadId,
  children,
}: {
  room: Room;
  threadId: string;
  children: React.ReactNode;
}) {
  const mx = useMatrixClient();
  const ignoredUsers = useIgnoredUsers();
  const { scheduler } = useMindroomSyncEngine();
  const [events, setEvents] = useState<ReadonlyMap<string, MatrixEvent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [request, setRequest] = useState<{ revision: number; origins?: MatrixEvent[] }>({
    revision: 0,
  });
  const [now, setNow] = useState(Date.now);
  const fetching = useRef(false);
  const repairedOrigins = useRef(new Set<string>());
  const pendingRepair = useRef(new Map<string, MatrixEvent>());
  const records = useMemo(
    () =>
      collectThreadApprovals([...events.values()], room.roomId, threadId, now).filter(
        (record) => !ignoredUsers.includes(record.sender)
      ),
    [events, room.roomId, threadId, now, ignoredUsers]
  );
  // Missing-key failures resolve in the SDK. Retained events own completeness,
  // so late keys and targeted repairs cannot leave a stale or premature success.
  const unreadableHistory = useMemo(
    () =>
      [...events.values()].some(
        (event) =>
          !ignoredUsers.includes(event.getSender() ?? '') && isUndecryptedApprovalCandidate(event)
      ),
    [events, ignoredUsers]
  );
  const error =
    loadError ?? (unreadableHistory ? 'Some approval history could not be decrypted.' : undefined);
  const recordsRef = useRef(records);
  useLayoutEffect(() => {
    recordsRef.current = records;
  }, [records]);
  const actionController = useMemo(
    () =>
      createApprovalActions({
        getRecords: () => recordsRef.current,
        getUserId: () => mx.getUserId(),
        threadId,
        send: (content) =>
          mx.sendEvent(room.roomId, MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT as any, content),
      }),
    [mx, room.roomId, threadId]
  );
  const actions = useSyncExternalStore(actionController.subscribe, actionController.getSnapshot);
  const pendingEventIds = useMemo(
    () =>
      new Set(
        records
          .filter((record) => {
            const action = actions.get(record.eventId);
            return (
              isPendingApproval(record, now) ||
              (record.wireStatus === 'pending' &&
                action?.kind === 'decision' &&
                action.status !== 'error')
            );
          })
          .map((record) => record.eventId)
      ),
    [records, actions, now]
  );
  const submit = actionController.submit;
  const refresh = useCallback(() => setRequest(({ revision }) => ({ revision: revision + 1 })), []);
  const repairPending = useCallback(
    () =>
      setRequest(({ revision }) => ({
        revision: revision + 1,
        origins: [...pendingRepair.current.values()],
      })),
    []
  );
  const ingest = useCallback(
    (incoming: readonly MatrixEvent[], fromBackfill = false) => {
      const scoped = incoming.filter((event) => event.getRoomId() === room.roomId);
      if (scoped.length === 0) return;
      setEvents((old) => {
        let changed = false;
        const next = new Map(old);
        scoped.forEach((event) => {
          const id = event.getId();
          if (!id) return;
          const relation = event.getRelation();
          const type = event.getType();
          const relevant =
            (type === MINDROOM_TOOL_APPROVAL_EVENT &&
              (event.getOriginalContent().thread_id === threadId ||
                relation?.rel_type === 'm.replace')) ||
            (isUndecryptedApprovalCandidate(event) &&
              (fromBackfill ||
                (relation?.rel_type === 'm.thread' && relation.event_id === threadId) ||
                (relation?.rel_type === 'm.replace' &&
                  !!relation.event_id &&
                  next.has(relation.event_id)))) ||
            event.isRedaction();
          if (!relevant) {
            changed = next.delete(id) || changed;
            return;
          }
          changed = true;
          const existing = next.get(id);
          // Live objects retain newer SDK replacements and redactions when an older fetch finishes.
          if (
            !existing ||
            event.isRedacted() ||
            (isUndecryptedApprovalCandidate(existing) && !isUndecryptedApprovalCandidate(event))
          )
            next.set(id, event);
          const replacement = event.replacingEvent();
          if (replacement?.getId()) next.set(replacement.getId()!, replacement);
        });
        return changed ? next : old;
      });
    },
    [room.roomId, threadId]
  );
  useLiveEventArrive(
    room,
    useCallback((event) => ingest([event]), [ingest])
  );
  const decrypted = useCallback(
    (event: MatrixEvent) => {
      ingest([event]);
      const id = event.getId();
      if (
        id &&
        event.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
        event.getRoomId() === room.roomId &&
        event.getOriginalContent().thread_id === threadId &&
        event.getRelation()?.rel_type !== 'm.replace' &&
        !repairedOrigins.current.has(id)
      ) {
        pendingRepair.current.set(id, event);
        if (!fetching.current) repairPending();
      }
    },
    [ingest, room.roomId, threadId, repairPending]
  );
  useEffect(() => {
    const scan = () =>
      ingest([...room.getLiveTimeline().getEvents(), ...(room.getThread(threadId)?.events ?? [])]);
    const changed = (event: MatrixEvent) => {
      ingest([event]);
      scan();
    };
    scan();
    room.on(ThreadEvent.New, scan);
    room.on(ThreadEvent.Update, scan);
    room.on(ThreadEvent.NewReply, scan);
    room.on(RoomEvent.TimelineRefresh, refresh);
    mx.on(MatrixEventEvent.Decrypted, decrypted);
    mx.on(MatrixEventEvent.Replaced, changed);
    return () => {
      room.off(ThreadEvent.New, scan);
      room.off(ThreadEvent.Update, scan);
      room.off(ThreadEvent.NewReply, scan);
      room.off(RoomEvent.TimelineRefresh, refresh);
      mx.off(MatrixEventEvent.Decrypted, decrypted);
      mx.off(MatrixEventEvent.Replaced, changed);
    };
  }, [mx, room, threadId, ingest, refresh, decrypted]);
  useEffect(() => {
    const retained = [...events.values()];
    retained.forEach((event) => event.on(MatrixEventEvent.Decrypted, decrypted));
    return () => {
      retained.forEach((event) => event.off(MatrixEventEvent.Decrypted, decrypted));
    };
  }, [events, decrypted]);
  useEffect(() => {
    let active = true;
    fetching.current = true;
    setLoading(true);
    setLoadError(undefined);
    void enqueueThreadApprovalBackfill(mx, scheduler, room.roomId, threadId, request.origins)
      .then((result) => {
        if (!active) return;
        fetching.current = false;
        result.repairedEventIds.forEach((id) => {
          repairedOrigins.current.add(id);
          pendingRepair.current.delete(id);
        });
        ingest(result.events, true);
        setLoadError(result.error);
        setLoading(false);
        if (!result.error && pendingRepair.current.size > 0) repairPending();
      })
      .catch(() => {
        if (active) {
          fetching.current = false;
          setLoadError('Approval history could not be loaded.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      scheduler.abort(room.roomId, threadId, 'thread-approvals');
    };
  }, [mx, scheduler, room.roomId, threadId, request, ingest, repairPending]);
  useEffect(() => {
    const deadlines = records.flatMap(({ approval }) => {
      const expiry =
        approval.status === 'pending'
          ? parseToolApprovalExpiryTimestamp(approval.expiresAt)
          : approval.autoApproval && !approval.autoApproval.revokedAt
          ? parseToolApprovalExpiryTimestamp(approval.autoApproval.expiresAt)
          : undefined;
      if (expiry === undefined || expiry <= now) return [];
      return [approval.status === 'pending' ? expiry : now + ((expiry - now) % 60_000 || 60_000)];
    });
    if (deadlines.length === 0) return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [records, now]);
  useEffect(() => {
    actionController.reconcile();
  }, [actionController, records, now]);
  const value = useMemo(
    () => ({ records, now, pendingEventIds, loading, error, refresh, ingest, actions, submit }),
    [records, now, pendingEventIds, loading, error, refresh, ingest, actions, submit]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
