import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MatrixEventEvent,
  RoomEvent,
  type EventTimelineSet,
  type IRoomTimelineData,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { ThreadEvent, type Thread } from 'matrix-js-sdk/lib/models/thread';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  getThreadStreamingEvents,
  isEventStreaming,
} from '../event-store/threads/useThreadStreamingState';
import {
  isStreamingReplyCurrent,
  newestRevisionTs,
  STREAM_IDLE_LIMIT_MS,
} from '../matrix/client/streamingReplies';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT } from '../matrix/thread';

/**
 * `stallsAt`: when the first streaming reply stops counting without an edit, by `Date.now()`;
 * absent while none streams.
 */
type Snapshot = { replies: MatrixEvent[]; stallsAt?: number };

const NONE: Snapshot = { replies: [] };

// One key per conversation and agent, so the jobs' list changing alone reads nothing again.
const SEPARATOR = '\u0000';

/** The main timeline's place among the conversations, which are otherwise named by their thread. */
const MAIN = '';

/** The newest messages of the agents in one conversation: a thread's tail, or the main timeline's. */
const repliesOf = (room: Room, threadId: string, agents: Set<string>): MatrixEvent[] => {
  const events = threadId
    ? getThreadStreamingEvents(room, threadId)
    : room
        .getLiveTimeline()
        .getEvents()
        .filter((event) => !event.isState() && !event.isRelation());
  return events
    .filter((event) => agents.has(event.getSender() ?? ''))
    .slice(-DEFAULT_THREAD_TAIL_EVENT_COUNT);
};

const read = (
  room: Room,
  threadId: string,
  agents: Set<string>,
  vouched: Set<string>,
  live: boolean
): Snapshot => {
  const replies = repliesOf(room, threadId, agents);
  let stallsAt: number | undefined;
  replies.forEach((event) => {
    const id = event.getId();
    const thread = event.threadRootId ? room.getThread(event.threadRootId) : undefined;
    const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
    if (!id || !isEventStreaming(event, undefined, timelineSet)) return;
    // The client's stall rule: a reply without an edit for the idle limit no longer streams,
    // whatever it says, so a reply whose agent died mid-stream lets the bar go too.
    const stalls = newestRevisionTs(event) + STREAM_IDLE_LIMIT_MS + 1;
    if (Date.now() >= stalls) return;
    if (live) vouched.add(id);
    // Asks the server about a reply the client cannot vouch for, so its copy gets the newest edit.
    if (isStreamingReplyCurrent(room, event) || vouched.has(id))
      stallsAt = Math.min(stallsAt ?? stalls, stalls);
  });
  return { replies, stallsAt };
};

/** The conversations as one: streaming while any of them is, until the first of them stalls. */
const merge = (conversations: Snapshot[]): Snapshot => {
  const stalls = conversations.flatMap((conversation) => conversation.stallsAt ?? []);
  return {
    replies: conversations.flatMap((conversation) => conversation.replies),
    stallsAt: stalls.length > 0 ? Math.min(...stalls) : undefined,
  };
};

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.stallsAt === b.stallsAt &&
  a.replies.length === b.replies.length &&
  a.replies.every((event, index) => event === b.replies[index]);

/**
 * Whether the reply that runs the jobs still streams: a message of a job's agent in the job's
 * thread, or in the main timeline for a job without one, that says it streams. Other agents'
 * replies in the same conversation do not count.
 * `live` says the jobs run now; a reply that says it streams while they do is taken at its word
 * until it says it finished, also when this client has not seen it stream yet (as after a
 * reload), because its agent is visibly working on it. A reply without an edit for
 * `STREAM_IDLE_LIMIT_MS` stops counting either way.
 */
export const useJobRepliesStreaming = (
  room: Room | undefined,
  jobs: BackgroundJob[],
  live: boolean
): boolean => {
  const vouched = useRef(new Set<string>());
  const ownersKey = useMemo(
    () =>
      [...new Set(jobs.map((job) => `${job.threadId ?? MAIN}${SEPARATOR}${job.agentId}`))]
        .sort()
        .join('\n'),
    [jobs]
  );
  const agentsByThread = useMemo(() => {
    const agents = new Map<string, Set<string>>();
    if (ownersKey)
      ownersKey.split('\n').forEach((owner) => {
        const [threadId = MAIN, agentId = ''] = owner.split(SEPARATOR);
        agents.set(threadId, (agents.get(threadId) ?? new Set()).add(agentId));
      });
    return agents;
  }, [ownersKey]);
  // Each conversation as last read. A busy room sends many events a second and nearly all of
  // them belong to one conversation, so an event reads that one again and no other.
  const conversations = useRef(new Map<string, Snapshot>());
  const [snapshot, setSnapshot] = useState<Snapshot>(NONE);
  /** Reads one conversation again, or without a name all of them. */
  const refresh = useCallback(
    (threadId?: string) => {
      const known = conversations.current;
      if (threadId === undefined) {
        known.clear();
        if (room)
          agentsByThread.forEach((agents, id) =>
            known.set(id, read(room, id, agents, vouched.current, live))
          );
      } else {
        const agents = agentsByThread.get(threadId);
        if (!room || !agents) return;
        known.set(threadId, read(room, threadId, agents, vouched.current, live));
      }
      const next = merge([...known.values()]);
      setSnapshot((previous) => (sameSnapshot(previous, next) ? previous : next));
    },
    [room, agentsByThread, live]
  );

  useEffect(() => {
    refresh();
    if (!room || agentsByThread.size === 0) return undefined;
    // The room passes on its threads' events, so one listener follows every conversation.
    const onTimeline = (
      _event: MatrixEvent,
      _room: Room | undefined,
      _toStartOfTimeline: boolean | undefined,
      _removed: boolean,
      data: IRoomTimelineData
    ) => refresh(data.timeline.getTimelineSet().thread?.id ?? MAIN);
    // A thread's reset is its own. The main timeline resets at a sync gap, which leaves no
    // conversation as it was.
    const onReset = (_room: Room | undefined, timelineSet: EventTimelineSet) =>
      refresh(timelineSet.thread?.id);
    // News of a message that began a thread comes by that thread, and the message itself is in
    // the main timeline.
    const onThread = (thread: Thread) => {
      refresh(thread.id);
      if (conversations.current.get(MAIN)?.replies.some((reply) => reply.getId() === thread.id))
        refresh(MAIN);
    };
    room.on(RoomEvent.Timeline, onTimeline);
    room.on(RoomEvent.TimelineReset, onReset);
    room.on(ThreadEvent.Update, onThread);
    room.on(ThreadEvent.NewReply, onThread);
    return () => {
      room.removeListener(RoomEvent.Timeline, onTimeline);
      room.removeListener(RoomEvent.TimelineReset, onReset);
      room.removeListener(ThreadEvent.Update, onThread);
      room.removeListener(ThreadEvent.NewReply, onThread);
    };
  }, [room, agentsByThread, refresh]);

  // A stalled reply sends nothing, so read again when the first one stalls.
  useEffect(() => {
    if (snapshot.stallsAt === undefined) return undefined;
    const timer = window.setTimeout(refresh, Math.max(0, snapshot.stallsAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [refresh, snapshot.stallsAt]);

  // An edit of a reply (its finishing one too) arrives on the reply itself.
  useEffect(() => {
    const onReplaced = (reply: MatrixEvent) =>
      conversations.current.forEach((conversation, threadId) => {
        if (conversation.replies.includes(reply)) refresh(threadId);
      });
    snapshot.replies.forEach((event) => event.on(MatrixEventEvent.Replaced, onReplaced));
    return () => {
      snapshot.replies.forEach((event) =>
        event.removeListener(MatrixEventEvent.Replaced, onReplaced)
      );
    };
  }, [refresh, snapshot.replies]);

  return snapshot.stallsAt !== undefined;
};
