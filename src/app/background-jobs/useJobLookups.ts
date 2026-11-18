import { useMemo, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  getContentToolTraceEvents,
  toolTraceCallId,
  type ToolTraceEvent,
} from '../matrix/protocol/toolTrace';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { useInterval } from '../lib/hooks/useInterval';
import { getLiveReplyStore, type LiveReplyStore } from '../messages/live/liveReplyStore';
import { newestTurns, useRoomSubagentRuns } from '../messages/live/subagentRunStore';
import {
  type BackgroundJobLookups,
  FINISHED_JOB_STATUS,
  type JobActivity,
} from './backgroundJobsPresentation';
import { repliesOf } from './useJobRepliesStreaming';

/** A reply's tool calls: those of its live frames, then those of its latest edit's trace. */
const replyToolCalls = (
  room: Room,
  reply: MatrixEvent,
  store: LiveReplyStore
): ToolTraceEvent[] => {
  const replyId = reply.getId() ?? '';
  const thread = reply.threadRootId ? room.getThread(reply.threadRootId) : undefined;
  const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
  const content = getLatestMessageContent(reply, getEditedEvent(replyId, reply, timelineSet));
  return [
    ...(store.get(room.roomId, replyId)?.docs.tools ?? []),
    ...(getContentToolTraceEvents(content) ?? []),
  ];
};

const activityOf = ({ tool_name: tool, args_preview: preview }: ToolTraceEvent) => {
  if (typeof tool !== 'string' || !tool) return undefined;
  return typeof preview === 'string' && preview ? { tool, preview } : { tool };
};

/**
 * The calls of the view's tool jobs, by call ID, as the replies that made them show them: each
 * job's agent's newest messages in the job's conversation. A call the client does not hold (its
 * reply is not loaded, or it scrolled out of the tail) is none. Read again at each `now`, the
 * bar's clock, so a reply's frames and edits show within a second.
 */
const useJobToolCalls = (
  room: Room,
  jobs: readonly BackgroundJob[],
  now: number
): ((toolCallId: string) => JobActivity | undefined) => {
  const mx = useMatrixClient();
  const calls = useMemo(() => {
    void now;
    const wanted = jobs.filter((job) => job.kind !== 'subagent' && job.toolCallId);
    const found = new Map<string, JobActivity>();
    if (wanted.length === 0) return found;
    const store = getLiveReplyStore(mx);
    const ids = new Set(wanted.map((job) => job.toolCallId));
    // Each conversation once, with the agents whose jobs run there; '' is the main timeline.
    const conversations = new Map<string, Set<string>>();
    wanted.forEach(({ threadId, agentId }) =>
      conversations.set(
        threadId ?? '',
        (conversations.get(threadId ?? '') ?? new Set()).add(agentId)
      )
    );
    conversations.forEach((agents, threadId) =>
      repliesOf(room, threadId, agents)
        .flatMap((reply) => replyToolCalls(room, reply, store))
        .forEach((event) => {
          const id = toolTraceCallId(event);
          const activity = id && ids.has(id) && !found.has(id) ? activityOf(event) : undefined;
          if (id && activity) found.set(id, activity);
        })
    );
    return found;
  }, [jobs, mx, now, room]);
  return useMemo(() => (toolCallId: string) => calls.get(toolCallId), [calls]);
};

const CLOCK_MS = 1_000;

/**
 * What the jobs bar joins its jobs to (`presentBackgroundJobs`), and its one clock, which ticks
 * each second while a listed job is live and reads the replies' tool calls again as it does.
 */
export const useJobLookups = (
  room: Room,
  jobs: readonly BackgroundJob[]
): { now: number; lookups: BackgroundJobLookups } => {
  const [now, setNow] = useState(Date.now);
  const live = jobs.some((job) => job.status !== FINISHED_JOB_STATUS);
  useInterval(() => setNow(Date.now()), live ? CLOCK_MS : -1);
  const runs = useRoomSubagentRuns(room.roomId);
  const turns = useMemo(() => newestTurns(runs), [runs]);
  const toolCallFor = useJobToolCalls(room, jobs, now);
  const lookups = useMemo(
    () => ({ runFor: (subagent: string) => turns.get(subagent), toolCallFor }),
    [toolCallFor, turns]
  );
  return { now, lookups };
};
