import { Fragment, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { getContentToolTraceEvents, runningToolCalls } from '../matrix/protocol/toolTrace';
import { jobsInView } from '../matrix/protocol/backgroundJobsContract';
import { getThreadStreamingReplies } from '../event-store/threads/useThreadStreamingState';
import { useThreadEventRefresh } from '../event-store/threads/useThreadEventRefresh';
import { summarizeLoadedThreadCost } from '../event-store/threads/threadConversationCost';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { getLiveVerdict } from '../messages/live/useLiveReplyContent';
import { useRoomSubagentCounts } from '../messages/live/subagentRunStore';
import { useRoomBackgroundJobs } from '../background-jobs/useRoomBackgroundJobs';
import type { CrossRoomThreadIndexEntry } from './cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader, subscribeRoomSignals } from './cross-room/threadSignalsReader';
import { useSnoozeNow } from './tags/useSnoozeNow';
import { threadLiveStatusRows } from './threadLiveStatus';

const NO_EVENTS: MatrixEvent[] = [];

/**
 * The tool calls the thread's streaming replies run, several agents' at once: each reply's live
 * frames while they show over it, else its latest edit's tool trace. Read again on each frame,
 * edit, thread update and change the room hears (`roomChanges`): an edit the SDK holds back for
 * a thread not opened brings neither of the others.
 */
const useRunningTools = (room: Room, threadId: string, streaming: boolean, roomChanges: number) => {
  const mx = useMatrixClient();
  const [version, refresh] = useForceUpdate();
  const [frames, framed] = useForceUpdate();
  const thread = room.getThread(threadId) ?? undefined;
  const replies = useMemo(() => {
    void version;
    void roomChanges;
    return streaming ? getThreadStreamingReplies(room, threadId) : NO_EVENTS;
  }, [room, roomChanges, streaming, threadId, version]);
  useThreadEventRefresh(thread, replies, refresh);

  const store = getLiveReplyStore(mx);
  useEffect(() => {
    const unsubscribes = replies.map((reply) =>
      store.subscribe(room.roomId, reply.getId() ?? '', framed)
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [framed, replies, room.roomId, store]);

  return useMemo(() => {
    void frames;
    const now = Date.now();
    const events = replies.flatMap((reply) => {
      const replyId = reply.getId() ?? '';
      const content = getLatestMessageContent(
        reply,
        getEditedEvent(replyId, reply, thread?.timelineSet)
      );
      // The reply's row shows its frames only while they are newer than what it wrote.
      const live = store.get(room.roomId, replyId);
      const shown = live && getLiveVerdict(reply, content, live, now) === 'show';
      return (shown ? live.docs.tools : getContentToolTraceEvents(content)) ?? [];
    });
    return runningToolCalls(events, replies.length > 0);
  }, [frames, replies, room.roomId, store, thread]);
};

type ThreadLiveStatusRowsProps = {
  room: Room;
  entry: CrossRoomThreadIndexEntry;
};

/**
 * A thread's live status as label and value pairs for a two-column details grid: whether it
 * streams or waits for the person, the tools, sub-agents and background jobs that run in it, and
 * what its loaded replies cost. Mount it only while the details show: it follows the stores.
 */
export function ThreadLiveStatusRows({ room, entry }: ThreadLiveStatusRowsProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const userId = mx.getUserId() ?? '';
  const threadId = entry.threadRootId;
  const streaming = entry.threadRecord.status.isStreaming;
  const { active: activeSubagents } = useRoomSubagentCounts(room.roomId, threadId);
  const { jobs: roomJobs, total: roomTotal } = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  // The status, tools and cost read more than the entry follows: a reaction that answers, an edit
  // or a decryption. So they are read again whenever the room hears what its threads' signals are
  // read again for (`subscribeRoomSignals`): a timeline event with an ID, the person's own
  // receipt, a timeline that starts over, a member who joins or leaves. Live reply frames and
  // sub-agent runs have no ID; their stores tell of them (`useRunningTools`,
  // `useRoomSubagentCounts`).
  const [roomChanges, roomChanged] = useForceUpdate();
  useEffect(
    () => subscribeRoomSignals(mx, room.roomId, roomChanged),
    [mx, room.roomId, roomChanged]
  );
  const runningTools = useRunningTools(room, threadId, streaming, roomChanges);
  // The reader reads the thread again only when something its signals depend on changed.
  const signals = getThreadSignalsReader(mx).read(room, entry, userId, Date.now());
  // Renders again once what the thread waits on lapses, such as an approval that expires.
  useSnoozeNow([signals.waitsUntil]);
  const cost = useMemo(() => {
    void entry;
    void roomChanges;
    const thread = room.getThread(threadId);
    return thread ? summarizeLoadedThreadCost(thread, userId) : undefined;
  }, [entry, room, roomChanges, threadId, userId]);

  const rows = threadLiveStatusRows(
    {
      streaming,
      pendingApproval: !!signals.pendingApproval,
      pendingQuestion: !!signals.pendingQuestion,
      runningTools,
      activeSubagents,
      jobs,
      // The agents count their live jobs per room, as the jobs bar reads them, not per thread.
      jobsUnlisted: roomTotal > roomJobs.length,
      cost,
    },
    t,
    language
  );
  return (
    <>
      {rows.map(({ key, label, value }) => (
        <Fragment key={key}>
          <Text as="span" size="T200" priority="300">
            {label}
          </Text>
          <Text as="span" size="T200">
            {value}
          </Text>
        </Fragment>
      ))}
    </>
  );
}
