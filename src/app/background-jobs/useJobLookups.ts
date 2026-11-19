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
import { subscribeRoomSignals } from '../threads/cross-room/threadSignalsReader';
import {
  type BackgroundJobLookups,
  type JobActivity,
  runOfJob,
  toolActivity,
} from './backgroundJobsPresentation';

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

/** What a row shows of a run, so frames that change nothing shown render nothing. */
const shownOfRun = ({ run, meta, docs }: SubagentRun) => {
  const { tool_name: tool, args_preview: preview } = docs.tools.at(-1) ?? {};
  const { task, result: _result, ...rest } = meta;
  return [run, rest, task?.split('\n', 1)[0], tool, preview];
};

/** The runs of the listed sub-agent jobs, rendered again only when what their rows show changes. */
const useJobRuns = (roomId: string, jobs: readonly BackgroundJob[]): readonly SubagentRun[] => {
  const store = getSubagentRunStore(useMatrixClient());
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(roomId, onChange),
    [roomId, store]
  );
  const pick = useCallback(() => {
    const runs = store.runs(roomId);
    return [...new Set(jobs.flatMap((job) => runOfJob(runs, job) ?? []))];
  }, [jobs, roomId, store]);
  const shown = useSyncExternalStore(subscribe, () => JSON.stringify(pick().map(shownOfRun)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(pick, [pick, shown]);
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

/** What the jobs bar joins its jobs to (`presentBackgroundJobs`). */
export const useJobLookups = (
  room: Room,
  jobs: readonly BackgroundJob[],
  listed: boolean
): BackgroundJobLookups => {
  const runs = useJobRuns(room.roomId, jobs);
  const toolCallFor = useJobToolCalls(room, jobs, listed);
  return useMemo(() => ({ runs, toolCallFor }), [runs, toolCallFor]);
};
