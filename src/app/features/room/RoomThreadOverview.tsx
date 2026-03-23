import React from 'react';
import { Box, Chip, Text } from 'folds';
import * as css from './RoomThreadOverview.css';

export type ThreadFilter = 'unresolved' | 'resolved' | 'all';
export type RoomThreadOverviewCounts = {
  all: number;
  resolved: number;
  unresolved: number;
};

export function RoomThreadOverview({
  counts,
  filter,
  onFilterChange,
}: {
  counts: RoomThreadOverviewCounts;
  filter: ThreadFilter;
  onFilterChange: (filter: ThreadFilter) => void;
}) {
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
            Counts reflect currently loaded thread roots.
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
    </Box>
  );
}
