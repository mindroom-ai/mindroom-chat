import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useRoomBackgroundJobs } from '../../background-jobs/useRoomBackgroundJobs';
import { useScheduledTaskEvents } from '../../schedules/useScheduledTaskEvents';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { localDigits } from '../../lib/localDigits';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { CompactRoomView } from '../overview/CompactRoomView';
import { useSnoozeNow } from '../tags/useSnoozeNow';
import { useCompactThreads } from './compactThreads';
import {
  groupThreadBoard,
  THREAD_BOARD_COLUMNS,
  threadBoardWakeTimes,
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
      <CompactRoomView
        room={room}
        threadRootIds={shown}
        threadRecordMap={records}
        onThreadClick={onThreadClick}
        compactRoomScrollStateRef={scrollMemory}
      />
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

/**
 * The threads the room's page lists in Compact, in a column each by state: Working, Later, Open,
 * Done (`threadBoardColumns.ts`). It reads the records the page builds, so it shows threads only
 * while the page shows the room in Compact. It fills its parent and scrolls inside it.
 */
export function ThreadBoard({ room }: { room: Room }) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const threads = useCompactThreads(room.roomId);
  const { jobs } = useRoomBackgroundJobs(room);
  const scheduledTaskEvents = useScheduledTaskEvents(room);
  const records = threads?.records;
  // Renewed when a snooze ends or a one-time schedule's time comes, so its thread leaves Later.
  const now = useSnoozeNow(
    useMemo(
      () => threadBoardWakeTimes(records ?? new Map(), scheduledTaskEvents),
      [records, scheduledTaskEvents]
    )
  );
  const columns = useMemo(
    () =>
      threads &&
      groupThreadBoard(threads.rootIds, threads.records, { jobs, scheduledTaskEvents, now }),
    [threads, jobs, scheduledTaskEvents, now]
  );
  const { roomId } = room;
  const openThread = useCallback(
    (rootId: string) => navigateRoomThread(roomId, rootId),
    [navigateRoomThread, roomId]
  );

  if (!threads || !columns || threads.rootIds.length === 0) {
    let line = t('mindroomUi.threads.compactRoomView.noThreads');
    if (!threads) line = t('threadBoard.compactOnly');
    else if (threads.loading) line = t('sharedUi.threadsView.loadingThreads');
    return (
      <Box className={css.Line} alignItems="Center" justifyContent="Center">
        <Text size="T300" priority="300">
          {line}
        </Text>
      </Box>
    );
  }
  return (
    <div className={css.Board} role="group" aria-label={t('threadBoard.label')}>
      {THREAD_BOARD_COLUMNS.map((column) => (
        <BoardColumn
          key={column}
          room={room}
          column={column}
          rootIds={columns[column]}
          records={threads.records}
          onThreadClick={openThread}
        />
      ))}
    </div>
  );
}
