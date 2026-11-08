import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MatrixEventEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  getThreadStreamingEvents,
  isEventStreaming,
} from '../event-store/threads/useThreadStreamingState';
import { isStreamingReplyCurrent } from '../matrix/client/streamingReplies';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT } from '../matrix/thread';

type Snapshot = { streaming: boolean; replies: MatrixEvent[] };

const NONE: Snapshot = { streaming: false, replies: [] };

// One key per conversation and agent, so the jobs' list changing alone reads nothing again.
const SEPARATOR = '\u0000';

/** The newest messages of each agent in its conversation: a thread's tail, or the main timeline's. */
const repliesOf = (room: Room, owners: string[]): MatrixEvent[] => {
  const agentsByThread = new Map<string, Set<string>>();
  owners.forEach((owner) => {
    const [threadId = '', agentId = ''] = owner.split(SEPARATOR);
    agentsByThread.set(threadId, (agentsByThread.get(threadId) ?? new Set()).add(agentId));
  });
  return [...agentsByThread].flatMap(([threadId, agents]) => {
    const events = threadId
      ? getThreadStreamingEvents(room, threadId)
      : room
          .getLiveTimeline()
          .getEvents()
          .filter((event) => !event.isState() && !event.isRelation());
    return events
      .filter((event) => agents.has(event.getSender() ?? ''))
      .slice(-DEFAULT_THREAD_TAIL_EVENT_COUNT);
  });
};

const read = (room: Room, owners: string[], vouched: Set<string>, live: boolean): Snapshot => {
  const replies = repliesOf(room, owners);
  let streaming = false;
  replies.forEach((event) => {
    const id = event.getId();
    const thread = event.threadRootId ? room.getThread(event.threadRootId) : undefined;
    const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
    if (!id || !isEventStreaming(event, undefined, timelineSet)) return;
    if (live) vouched.add(id);
    // Asks the server about a reply the client cannot vouch for, so its copy gets the newest edit.
    if (isStreamingReplyCurrent(room, event) || vouched.has(id)) streaming = true;
  });
  return { streaming, replies };
};

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.streaming === b.streaming &&
  a.replies.length === b.replies.length &&
  a.replies.every((event, index) => event === b.replies[index]);

/**
 * Whether the reply that runs the jobs still streams: a message of a job's agent in the job's
 * thread, or in the main timeline for a job without one, that says it streams. Other agents'
 * replies in the same conversation do not count.
 * `live` says the jobs run now; a reply that says it streams while they do is taken at its word
 * until it says it finished, also when this client has not seen it stream yet (as after a
 * reload), because its agent is visibly working on it.
 */
export const useJobRepliesStreaming = (
  room: Room | undefined,
  jobs: BackgroundJob[],
  live: boolean
): boolean => {
  const vouched = useRef(new Set<string>());
  const ownersKey = useMemo(
    () =>
      [...new Set(jobs.map((job) => `${job.threadId ?? ''}${SEPARATOR}${job.agentId}`))]
        .sort()
        .join('\n'),
    [jobs]
  );
  const [snapshot, setSnapshot] = useState<Snapshot>(NONE);
  const refresh = useCallback(() => {
    const next = room && ownersKey ? read(room, ownersKey.split('\n'), vouched.current, live) : NONE;
    setSnapshot((previous) => (sameSnapshot(previous, next) ? previous : next));
  }, [room, ownersKey, live]);

  useEffect(() => {
    refresh();
    if (!room || !ownersKey) return undefined;
    // The room passes on its threads' events, so one listener follows every conversation.
    room.on(RoomEvent.Timeline, refresh);
    room.on(RoomEvent.TimelineReset, refresh);
    room.on(ThreadEvent.Update, refresh);
    room.on(ThreadEvent.NewReply, refresh);
    return () => {
      room.removeListener(RoomEvent.Timeline, refresh);
      room.removeListener(RoomEvent.TimelineReset, refresh);
      room.removeListener(ThreadEvent.Update, refresh);
      room.removeListener(ThreadEvent.NewReply, refresh);
    };
  }, [room, ownersKey, refresh]);

  // An edit of a reply (its finishing one too) arrives on the reply itself.
  useEffect(() => {
    snapshot.replies.forEach((event) => event.on(MatrixEventEvent.Replaced, refresh));
    return () => {
      snapshot.replies.forEach((event) => event.removeListener(MatrixEventEvent.Replaced, refresh));
    };
  }, [refresh, snapshot.replies]);

  return snapshot.streaming;
};
