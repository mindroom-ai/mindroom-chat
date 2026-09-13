import React from 'react';
import { Box, Chip, Text } from 'folds';
import { IconCalendarEvent } from '@tabler/icons-react';
import * as css from './RoomThreadOverview.css';
import * as replyCss from '../../components/message/Reply.css';
import type {
  ThreadFilter,
  ThreadSort,
  RoomThreadOverviewCounts,
} from './roomThreadOverviewModel';

export type { ThreadFilter, ThreadSort, RoomThreadOverviewCounts };

export function RoomThreadOverview({
  counts,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: {
  counts: RoomThreadOverviewCounts;
  filter: ThreadFilter;
  onFilterChange: (filter: ThreadFilter) => void;
  sort: ThreadSort;
  onSortChange: (sort: ThreadSort) => void;
}) {
  const handleSortClick = (s: ThreadSort) => {
    // Clicking an already-active sort chip clears it back to default
    onSortChange(sort === s ? 'default' : s);
  };

  return (
    <Box className={css.Overview} direction="Column" gap="200" data-room-thread-overview="true">
      <Box
        direction="Row"
        gap="200"
        style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Box
          direction="Row"
          gap="200"
          alignItems="Center"
          style={{ minWidth: 0, flexGrow: 1, flexWrap: 'wrap' }}
        >
          <Text size="B300">Threads</Text>
          <Text size="T200" priority="300" truncate>
            Filter the room timeline by thread status.
          </Text>
        </Box>

        <Box className={css.FilterRow}>
          <Chip
            variant={filter === 'unresolved' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'unresolved'}
            aria-pressed={filter === 'unresolved'}
            aria-label={`Show unresolved threads (${counts.unresolved})`}
            onClick={() => onFilterChange('unresolved')}
          >
            <Text size="T200">{`Unresolved (${counts.unresolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'resolved' ? 'Success' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'resolved'}
            aria-pressed={filter === 'resolved'}
            aria-label={`Show resolved threads (${counts.resolved})`}
            onClick={() => onFilterChange('resolved')}
          >
            <Text size="T200">{`Resolved (${counts.resolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'unread' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'unread'}
            aria-pressed={filter === 'unread'}
            aria-label={`Show unread threads (${counts.unread})`}
            onClick={() => onFilterChange('unread')}
          >
            <Text size="T200">{`Unread (${counts.unread})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'all' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'all'}
            aria-pressed={filter === 'all'}
            aria-label={`Show all threads (${counts.all})`}
            onClick={() => onFilterChange('all')}
          >
            <Text size="T200">{`All (${counts.all})`}</Text>
          </Chip>
        </Box>
      </Box>

      <Box className={css.SortRow}>
        <Text size="T200" priority="300">
          Sort:
        </Text>
        <Chip
          variant={sort === 'last-reply' ? 'Primary' : 'SurfaceVariant'}
          radii="Pill"
          outlined={sort !== 'last-reply'}
          aria-pressed={sort === 'last-reply'}
          aria-label="Sort threads by last reply"
          onClick={() => handleSortClick('last-reply')}
        >
          <Text size="T200">Last Reply</Text>
        </Chip>
        <Chip
          variant={sort === 'streaming' ? 'Primary' : 'SurfaceVariant'}
          radii="Pill"
          outlined={sort !== 'streaming'}
          aria-pressed={sort === 'streaming'}
          aria-label="Sort threads by streaming activity"
          onClick={() => handleSortClick('streaming')}
          before={
            <span className={replyCss.ThreadStreamingDot} aria-hidden="true" />
          }
        >
          <Text size="T200">Streaming</Text>
        </Chip>
        <Chip
          variant={sort === 'scheduled' ? 'Primary' : 'SurfaceVariant'}
          radii="Pill"
          outlined={sort !== 'scheduled'}
          aria-pressed={sort === 'scheduled'}
          aria-label="Sort threads by scheduled tasks"
          onClick={() => handleSortClick('scheduled')}
          before={
            <IconCalendarEvent
              size={12}
              stroke={1.8}
              className={replyCss.ThreadScheduledIcon}
              aria-hidden="true"
            />
          }
        >
          <Text size="T200">Scheduled</Text>
        </Chip>
      </Box>
    </Box>
  );
}
