import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { toolTraceCallId } from '../matrix/protocol/toolTrace';
import { getThreadTailEvents } from '../matrix/thread';
import { getLiveReplyStore, type LiveReplyStore } from '../messages/live/liveReplyStore';
import { getShownToolCalls } from '../messages/live/useLiveReplyContent';
import { getSubagentRunStore, type SubagentRun } from '../messages/live/subagentRunStore';
import { getWorkflowRunStore, type WorkflowRunEntry } from '../messages/live/workflowRunStore';
import { runToolCall, toolActivity } from '../subagents/runActivity';
import { runOfJob } from '../subagents/runJob';
import { subscribeRoomSignals } from '../threads/cross-room/threadSignalsReader';
import type { BackgroundJobLookups, JobActivity } from './backgroundJobsPresentation';

/** Every loaded message of a conversation: a thread's, root included, or the main timeline's. */
const loadedMessages = (room: Room, threadId: string | null): MatrixEvent[] =>
  threadId
    ? getThreadTailEvents(room.getThread(threadId), Number.POSITIVE_INFINITY)
    : room
        .getLiveTimeline()
        .getEvents()
        .filter((event) => !event.isState() && !event.isRelation());

type ToolJob = Pick<BackgroundJob, 'agentId' | 'threadId' | 'toolCallId'>;

const callKey = ({ agentId, threadId, toolCallId }: ToolJob) =>
  [agentId, threadId ?? '', toolCallId].join('\0');

/**
 * The tool calls the tool jobs' agents show in their loaded replies in the jobs' conversations,
 * by `callKey`; a call ID two different calls there share gives none (`null`).
 */
export const indexJobToolCalls = (
  room: Room,
  jobs: readonly ToolJob[],
  store: LiveReplyStore,
  now: number
): Map<string, JobActivity | null> => {
  const index = new Map<string, JobActivity | null>();
  const conversations = new Map(jobs.map((job) => [callKey({ ...job, toolCallId: '' }), job]));
  conversations.forEach(({ agentId, threadId }) =>
    loadedMessages(room, threadId)
      .filter((event) => event.getSender() === agentId)
      .forEach((reply) =>
        getShownToolCalls(room, reply, store, now).forEach((event) => {
          const toolCallId = toolTraceCallId(event);
          const activity = toolCallId && toolActivity(event);
          if (!activity) return;
          const key = callKey({ agentId, threadId, toolCallId });
          const held = index.get(key);
          const same = held === undefined || JSON.stringify(held) === JSON.stringify(activity);
          index.set(key, same ? activity : null);
        })
      )
  );
  return index;
};

/**
 * What a row shows of a run, so frames that change nothing shown render nothing: its meta, title
 * and whole task (the headline's tooltip) included. Usage and the current call are included only
 * when the rows show them (`listed`); the result and other calls are never included.
 */
const shownOfRun = (subagentRun: SubagentRun, listed: boolean) => {
  const { result: _result, usage, ...rest } = subagentRun.meta;
  return listed
    ? [subagentRun.run, { ...rest, usage }, runToolCall(subagentRun) ?? null]
    : [subagentRun.run, rest];
};

const shownOfWorkflowRun = (entry: WorkflowRunEntry, listed: boolean) => {
  const { title, name, status, counts, usage, endedAt } = entry.meta;
  const waits = entry.graph.nodes.filter((n) => n.status === 'waiting').map((n) => n.waitingOn);
  return [entry.run, title, name, status, waits, ...(listed ? [counts, usage, endedAt] : [])];
};

const useRoomSelection = <T>(
  store: { subscribe: (roomId: string, onChange: () => void) => () => void },
  roomId: string,
  pick: () => T,
  snapshot: (picked: T) => unknown,
  listed: boolean
): T => {
  const subscribe = useCallback((fn: () => void) => store.subscribe(roomId, fn), [roomId, store]);
  const shown = useSyncExternalStore(subscribe, () => JSON.stringify(snapshot(pick())));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(pick, [pick, shown, listed]);
};

/**
 * Each tool job's call while `listed` (the rows that show the calls): read from the room as it is
 * when the list opens, and again on each change of its messages, edits, redactions or live replies.
 */
const useJobToolCalls = (room: Room, jobs: readonly BackgroundJob[], listed: boolean) => {
  const mx = useMatrixClient();
  const store = getLiveReplyStore(mx);
  const [changed, refresh] = useForceUpdate();
  // A list of sub-agents only has no call to follow.
  const linked = listed && jobs.some((job) => job.kind !== 'subagent' && job.toolCallId);
  useEffect(() => {
    if (!linked) return undefined;
    const stops = [
      subscribeRoomSignals(mx, room.roomId, refresh),
      store.subscribeRoom(room.roomId, refresh),
    ];
    return () => stops.forEach((stop) => stop());
  }, [linked, mx, refresh, room.roomId, store]);
  return useMemo(() => {
    void changed;
    const toolJobs = listed ? jobs.filter((job) => job.kind !== 'subagent' && job.toolCallId) : [];
    const index = indexJobToolCalls(room, toolJobs, store, Date.now());
    return (job: BackgroundJob) => (job.toolCallId && index.get(callKey(job))) || undefined;
  }, [changed, jobs, listed, room, store]);
};

/**
 * What the jobs bar joins its jobs to (`presentBackgroundJobs`): `listed` when the visible
 * rows show both usage and current calls.
 */
export const useJobLookups = (
  room: Room,
  jobs: readonly BackgroundJob[],
  listed: boolean
): BackgroundJobLookups => {
  const mx = useMatrixClient();
  const [subStore, wfStore] = [getSubagentRunStore(mx), getWorkflowRunStore(mx)];
  const pickRuns = useCallback(() => {
    const all = subStore.runs(room.roomId);
    return [...new Set(jobs.flatMap((job) => runOfJob(all, job) ?? []))];
  }, [jobs, room.roomId, subStore]);
  const pickWf = useCallback(
    () =>
      new Map(
        jobs.flatMap((j) => {
          const e =
            j.kind === 'workflow' && j.workflow ? wfStore.get(room.roomId, j.workflow) : undefined;
          return e && j.workflow ? [[j.workflow, e] as const] : [];
        })
      ),
    [jobs, room.roomId, wfStore]
  );
  const runs = useRoomSelection(
    subStore,
    room.roomId,
    pickRuns,
    (p) => p.map((r) => shownOfRun(r, listed)),
    listed
  );
  const workflowRuns = useRoomSelection(
    wfStore,
    room.roomId,
    pickWf,
    (p) => [...p.values()].map((e) => shownOfWorkflowRun(e, listed)),
    listed
  );
  const toolCallFor = useJobToolCalls(room, jobs, listed);
  return useMemo(() => ({ runs, toolCallFor, workflowRuns }), [runs, toolCallFor, workflowRuns]);
};
