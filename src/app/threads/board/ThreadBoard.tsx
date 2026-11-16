import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { Room } from 'matrix-js-sdk';
import { useRoomBackgroundJobs } from '../../background-jobs/useRoomBackgroundJobs';
import { useScheduledTaskEvents } from '../../schedules/useScheduledTaskEvents';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { localDigits } from '../../lib/localDigits';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { CompactRoomView } from '../overview/CompactRoomView';
import { useSnoozeNow } from '../tags/useSnoozeNow';
import {
  crossRoomThreadIndexAtom,
  crossRoomThreadIndexBootstrappedAtom,
} from '../cross-room/crossRoomThreadIndex';
import { isCrossRoomThreadEntryEligible } from '../cross-room/crossRoomThreadOrder';
import {
  loadRoomThreads,
  roomThreadListIsComplete,
} from '../../event-store/threads/roomThreadList';
import {
  groupThreadBoard,
  THREAD_BOARD_COLUMNS,
  threadBoardWakeTimes,
  withThreadSchedules,
  type ThreadBoardColumn,
} from './threadBoardColumns';
import * as css from './ThreadBoard.css';

/** How many threads Open and Done show at first, and how many more each Show more adds. */
const PAGE = 20;
const PAGED: ReadonlySet<ThreadBoardColumn> = new Set(['open', 'done']);

type ColumnProps = {
  room: Room;
  column: ThreadBoardColumn;
  rootIds: string[];
  records: ReadonlyMap<string, ThreadRecord>;
  onThreadClick: (rootId: string) => void;
};

/** One column: its name and count, and its threads as the Compact view's cards. */
function BoardColumn({ room, column, rootIds, records, onThreadClick }: ColumnProps) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState(PAGE);
  const scrollMemory = useRef<ScrollAnchorMemory>(new Map());
  const shown = useMemo(
    () => (PAGED.has(column) ? rootIds.slice(0, limit) : rootIds),
    [column, limit, rootIds]
  );
  const headingId = useId();
  return (
    <section className={css.Column} aria-labelledby={headingId} data-thread-board-column={column}>
      <Text as="h2" id={headingId} size="L400" className={css.Heading}>
        <span>{t(`threadBoard.${column}`)}</span>{' '}
        <span className={css.Count}>{localDigits(String(rootIds.length), i18n.language)}</span>
      </Text>
      {/* An empty column is its header with 0: Compact's "No threads" would claim to know. */}
      {rootIds.length > 0 && (
        <CompactRoomView
          room={room}
          threadRootIds={shown}
          threadRecordMap={records}
          onThreadClick={onThreadClick}
          compactRoomScrollStateRef={scrollMemory}
        />
      )}
      {shown.length < rootIds.length && (
        <Button
          size="300"
          variant="Secondary"
          fill="None"
          radii="300"
          className={css.More}
          onClick={() => setLimit(limit + PAGE)}
        >
          <Text size="B300">{t('threadsPage.showMore')}</Text>
        </Button>
      )}
    </section>
  );
}

const sameRecords = (a: ReadonlyMap<string, ThreadRecord>, b: ReadonlyMap<string, ThreadRecord>) =>
  a.size === b.size && Array.from(a).every(([rootId, record]) => b.get(rootId) === record);

/**
 * The room's threads as the app-wide thread index holds them, by root ID, those the Threads page
 * lists (a reply, or one of the user's on its way): the same map until one of them changes, so a
 * change in another room renders nothing here.
 */
const useRoomThreadRecords = (roomId: string): ReadonlyMap<string, ThreadRecord> =>
  useAtomValue(
    useMemo(
      () =>
        selectAtom(
          crossRoomThreadIndexAtom,
          ({ entries }): ReadonlyMap<string, ThreadRecord> => {
            const records = new Map<string, ThreadRecord>();
            entries.forEach((entry) => {
              if (entry.roomId === roomId && isCrossRoomThreadEntryEligible(entry)) {
                records.set(entry.threadRootId, entry.threadRecord);
              }
            });
            return records;
          },
          sameRecords
        ),
      [roomId]
    )
  );

/** Whether the room's whole thread list has arrived; its other pages load while the board shows. */
const useRoomThreadListComplete = (room: Room): boolean => {
  const [, loaded] = useForceUpdate();
  useEffect(() => {
    const leave = new AbortController();
    loadRoomThreads(room, loaded, leave.signal).then(loaded, loaded);
    return () => leave.abort();
  }, [loaded, room]);
  return roomThreadListIsComplete(room);
};

/**
 * The room's threads, those with a reply or one of the user's sending, in a column each by state:
 * Working, Later, Open, Done (`threadBoardColumns.ts`), from the app-wide thread index, in any
 * view of the room and beside any page. It fills its parent and scrolls inside it.
 */
export function ThreadBoard({ room }: { room: Room }) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const indexed = useRoomThreadRecords(room.roomId);
  const scanned = useAtomValue(crossRoomThreadIndexBootstrappedAtom);
  const listed = useRoomThreadListComplete(room);
  const { jobs } = useRoomBackgroundJobs(room);
  const scheduledTaskEvents = useScheduledTaskEvents(room);
  // Renewed when a snooze ends or a one-time schedule's time comes, so its thread leaves Later.
  const now = useSnoozeNow(
    useMemo(
      () => threadBoardWakeTimes(indexed, scheduledTaskEvents),
      [indexed, scheduledTaskEvents]
    )
  );
  const records = useMemo(
    () => withThreadSchedules(indexed, scheduledTaskEvents, now),
    [indexed, scheduledTaskEvents, now]
  );
  const columns = useMemo(() => groupThreadBoard(records, { jobs, now }), [records, jobs, now]);
  const { roomId } = room;
  const openThread = useCallback(
    (rootId: string) => navigateRoomThread(roomId, rootId),
    [navigateRoomThread, roomId]
  );

  // Until the index has scanned the rooms and the room's thread list is in, it may lack threads.
  const loading = !scanned || !listed;
  const line = (text: string) => (
    <Text className={css.Line} size="T300" priority="300">
      {text}
    </Text>
  );
  const loadingLine = loading && line(t('sharedUi.threadsView.loadingThreads'));
  if (records.size === 0) {
    return (
      <Box className={css.Empty} alignItems="Center" justifyContent="Center">
        {loadingLine || line(t('mindroomUi.threads.compactRoomView.noThreads'))}
      </Box>
    );
  }
  return (
    <Box className={css.Frame} direction="Column">
      {loadingLine}
      <div className={css.Board} role="group" aria-label={t('threadBoard.label')}>
        {THREAD_BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            room={room}
            column={column}
            rootIds={columns[column]}
            records={records}
            onThreadClick={openThread}
          />
        ))}
      </div>
    </Box>
  );
}
