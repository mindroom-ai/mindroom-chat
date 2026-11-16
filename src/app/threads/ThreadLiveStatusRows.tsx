import { Fragment, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { getContentToolTraceEvents, runningToolCalls } from '../matrix/protocol/toolTrace';
import { jobsInView } from '../matrix/protocol/backgroundJobsContract';
import { getThreadStreamingReply } from '../event-store/threads/useThreadStreamingState';
import { useThreadEventRefresh } from '../event-store/threads/useThreadEventRefresh';
import { summarizeLoadedThreadCost } from '../event-store/threads/threadConversationCost';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { useRoomSubagentCounts } from '../messages/live/subagentRunStore';
import { useRoomBackgroundJobs } from '../background-jobs/useRoomBackgroundJobs';
import type { CrossRoomThreadIndexEntry } from './cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader, subscribeRoomSignals } from './cross-room/threadSignalsReader';
import { useSnoozeNow } from './tags/useSnoozeNow';
import { threadLiveStatusRows } from './threadLiveStatus';

const NO_EVENTS: MatrixEvent[] = [];

/**
 * The tool calls the thread's streaming reply runs: from its live frames while they arrive, else
 * from its latest edit's tool trace. Read again on each frame, edit and thread update.
 */
const useRunningTools = (room: Room, threadId: string, streaming: boolean) => {
  const mx = useMatrixClient();
  const [version, refresh] = useForceUpdate();
  const thread = room.getThread(threadId) ?? undefined;
  const reply = useMemo(() => {
    void version;
    return streaming ? getThreadStreamingReply(room, threadId) : undefined;
  }, [room, streaming, threadId, version]);
  const tracked = useMemo(() => (reply ? [reply] : NO_EVENTS), [reply]);
  useThreadEventRefresh(thread, tracked, refresh);

  const store = getLiveReplyStore(mx);
  const replyId = reply?.getId();
  const subscribe = useCallback(
    (onChange: () => void) =>
      replyId ? store.subscribe(room.roomId, replyId, onChange) : () => undefined,
    [replyId, room.roomId, store]
  );
  const live = useSyncExternalStore(subscribe, () =>
    replyId ? store.get(room.roomId, replyId) : undefined
  );
  const durable = useMemo(() => {
    void version;
    if (!reply) return undefined;
    const edit = getEditedEvent(reply.getId() ?? '', reply, thread?.timelineSet);
    return getContentToolTraceEvents(getLatestMessageContent(reply, edit));
  }, [reply, thread, version]);
  const events = live && live.sender === reply?.getSender() ? live.docs.tools : durable;
  return runningToolCalls(events, !!reply);
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
  const runningTools = useRunningTools(room, threadId, streaming);
  const { active: activeSubagents } = useRoomSubagentCounts(room.roomId, threadId);
  const { jobs: roomJobs } = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  // Both read more than the entry follows: a reaction that answers, an edit or a decryption that
  // changes a reply's cost. So they are read again whenever the room hears anything.
  const [roomChanges, roomChanged] = useForceUpdate();
  useEffect(
    () => subscribeRoomSignals(mx, room.roomId, roomChanged),
    [mx, room.roomId, roomChanged]
  );
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
