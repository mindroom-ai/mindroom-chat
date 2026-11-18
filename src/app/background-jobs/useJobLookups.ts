import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  getContentToolTraceEvents,
  toolTraceCallId,
  type ToolTraceEvent,
} from '../matrix/protocol/toolTrace';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { getThreadTailEvents } from '../matrix/thread';
import { getLiveReplyStore, type LiveReplyStore } from '../messages/live/liveReplyStore';
import { getLiveVerdict } from '../messages/live/useLiveReplyContent';
import { getSubagentRunStore, type SubagentRun } from '../messages/live/subagentRunStore';
import { subscribeRoomSignals } from '../threads/cross-room/threadSignalsReader';
import {
  type BackgroundJobLookups,
  type JobActivity,
  runOfJob,
} from './backgroundJobsPresentation';

/** Every loaded message of a conversation: a thread's, root included, or the main timeline's. */
const loadedMessages = (room: Room, threadId: string | null): MatrixEvent[] =>
  threadId
    ? getThreadTailEvents(room.getThread(threadId), Number.POSITIVE_INFINITY)
    : room
        .getLiveTimeline()
        .getEvents()
        .filter((event) => !event.isState() && !event.isRelation());

/**
 * The tool calls a reply shows: those of its live frames while they show over it, else those of
 * its latest edit's trace, as its row in the timeline renders them. A redacted reply shows none.
 */
const shownToolCalls = (
  room: Room,
  reply: MatrixEvent,
  store: LiveReplyStore,
  now: number
): ToolTraceEvent[] => {
  if (reply.isRedacted()) return [];
  const replyId = reply.getId() ?? '';
  const thread = reply.threadRootId ? room.getThread(reply.threadRootId) : undefined;
  const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
  const content = getLatestMessageContent(reply, getEditedEvent(replyId, reply, timelineSet));
  const live = store.get(room.roomId, replyId);
  const shown = live && getLiveVerdict(reply, content, live, now) === 'show';
  return (shown ? live.docs.tools : getContentToolTraceEvents(content)) ?? [];
};

const activityOf = ({ tool_name: tool, args_preview: preview }: ToolTraceEvent) => {
  if (typeof tool !== 'string' || !tool) return undefined;
  return typeof preview === 'string' && preview ? { tool, preview } : { tool };
};

/**
 * Each tool job's call (`jobs` holds tool jobs), by the job's ID: the call its ID names among the shown tool calls of its
 * own agent's loaded replies in its own conversation. Calls of other agents or conversations may
 * share the ID; two different calls there with it give none. Also the replies it read.
 */
type ToolJob = Pick<BackgroundJob, 'jobId' | 'agentId' | 'threadId' | 'toolCallId'>;

export const readJobToolCalls = (
  room: Room,
  jobs: readonly ToolJob[],
  store: LiveReplyStore,
  now: number
): { calls: [string, JobActivity][]; replies: string[] } => {
  const calls: [string, JobActivity][] = [];
  const replies = new Set<string>();
  jobs.forEach((job) => {
    if (!job.toolCallId) return;
    const found = new Map<string, JobActivity>();
    loadedMessages(room, job.threadId)
      .filter((event) => event.getSender() === job.agentId)
      .forEach((reply) => {
        replies.add(reply.getId() ?? '');
        shownToolCalls(room, reply, store, now).forEach((event) => {
          const activity = toolTraceCallId(event) === job.toolCallId && activityOf(event);
          if (activity) found.set(JSON.stringify(activity), activity);
        });
      });
    const [only, ...others] = found.values();
    if (only && others.length === 0) calls.push([job.jobId, only]);
  });
  return { calls, replies: [...replies] };
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
 * Each tool job's call, read again when the room's messages, edits or redactions change or a
 * read reply's frame comes, and only while `listed` (the rows that show the calls).
 */
const useJobToolCalls = (room: Room, jobs: readonly BackgroundJob[], listed: boolean) => {
  const mx = useMatrixClient();
  const [read, setRead] = useState('[]');
  // The tool jobs as they matter here, so a new list of the same jobs reads nothing again.
  const key = JSON.stringify(
    jobs.flatMap(({ jobId, agentId, threadId, kind, toolCallId }) =>
      kind !== 'subagent' && toolCallId ? [[jobId, agentId, threadId, toolCallId]] : []
    )
  );
  const toolJobs = useMemo(
    () =>
      (JSON.parse(key) as [string, string, string | null, string][]).map(
        ([jobId, agentId, threadId, toolCallId]) => ({ jobId, agentId, threadId, toolCallId })
      ),
    [key]
  );
  useEffect(() => {
    if (!listed) return undefined;
    const store = getLiveReplyStore(mx);
    let frames: (() => void)[] = [];
    const refresh = () => {
      const { calls, replies } = readJobToolCalls(room, toolJobs, store, Date.now());
      frames.forEach((unsubscribe) => unsubscribe());
      frames = replies.map((replyId) => store.subscribe(room.roomId, replyId, refresh));
      setRead(JSON.stringify(calls));
    };
    refresh();
    const unsubscribe = subscribeRoomSignals(mx, room.roomId, refresh);
    return () => {
      unsubscribe();
      frames.forEach((stop) => stop());
    };
  }, [listed, mx, room, toolJobs]);
  return useMemo(() => {
    const calls = new Map<string, JobActivity>(listed ? JSON.parse(read) : []);
    return (jobId: string) => calls.get(jobId);
  }, [listed, read]);
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
