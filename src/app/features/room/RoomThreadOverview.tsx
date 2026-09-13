import React, { useMemo } from 'react';
import { Box, Chip, Spinner, Text, color } from 'folds';
import { Room } from 'matrix-js-sdk';
import { useRoomThreadList } from './useRoomThreadList';
import { useRoomThreadResolutionMap } from './useRoomThreadResolution';
import * as css from './RoomThreadOverview.css';

export type ThreadFilter = 'unresolved' | 'resolved' | 'all';

const formatThreadCount = (count: number, fullyLoaded: boolean): string => {
  if (!fullyLoaded && count === 0) {
    return '-';
  }

  return fullyLoaded ? `${count}` : `${count}+`;
};

export function RoomThreadOverview({
  room,
  filter,
  onFilterChange,
}: {
  room: Room;
  filter: ThreadFilter;
  onFilterChange: (filter: ThreadFilter) => void;
}) {
  const { threads, loading, fullyLoaded, error, retry } = useRoomThreadList(room);
  const resolutionMap = useRoomThreadResolutionMap(room);

  const entries = useMemo(
    () =>
      threads.map((thread) => {
        const resolutionState = resolutionMap.get(thread.id);

        return {
          isResolved: resolutionState?.isResolved ?? false,
        };
      }),
    [resolutionMap, threads]
  );

  const counts = useMemo(() => {
    const resolved = entries.filter((entry) => entry.isResolved).length;
    const unresolved = entries.length - resolved;

    return {
      all: entries.length,
      resolved,
      unresolved,
    };
  }, [entries]);

  const countLabels = useMemo(
    () => ({
      all: formatThreadCount(counts.all, fullyLoaded),
      resolved: formatThreadCount(counts.resolved, fullyLoaded),
      unresolved: formatThreadCount(counts.unresolved, fullyLoaded),
    }),
    [counts, fullyLoaded]
  );

  const summaryText = useMemo(() => {
    if (error) {
      return 'Showing loaded thread counts only.';
    }

    if (fullyLoaded) {
      return 'Filter the room timeline by thread status.';
    }

    return counts.all === 0 ? 'Loading thread counts.' : 'Loading older thread pages.';
  }, [counts.all, error, fullyLoaded]);

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
            {summaryText}
          </Text>
        </Box>

        <Box className={css.FilterRow}>
          <Chip
            variant={filter === 'unresolved' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'unresolved'}
            aria-pressed={filter === 'unresolved'}
            aria-label={`Show unresolved threads (${countLabels.unresolved})`}
            onClick={() => onFilterChange('unresolved')}
          >
            <Text size="T200">{`Unresolved (${countLabels.unresolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'resolved' ? 'Success' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'resolved'}
            aria-pressed={filter === 'resolved'}
            aria-label={`Show resolved threads (${countLabels.resolved})`}
            onClick={() => onFilterChange('resolved')}
          >
            <Text size="T200">{`Resolved (${countLabels.resolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'all' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'all'}
            aria-pressed={filter === 'all'}
            aria-label={`Show all threads (${countLabels.all})`}
            onClick={() => onFilterChange('all')}
          >
            <Text size="T200">{`All (${countLabels.all})`}</Text>
          </Chip>
        </Box>
      </Box>

      {error && (
        <Box alignItems="Center" gap="200" style={{ flexWrap: 'wrap' }}>
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {error.message}
          </Text>
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            aria-label="Retry loading room threads"
            onClick={retry}
          >
            <Text size="T200">Retry</Text>
          </Chip>
        </Box>
      )}

      {loading && counts.all === 0 ? (
        <Chip
          variant="SurfaceVariant"
          radii="Pill"
          outlined
          before={<Spinner variant="Secondary" fill="Soft" size="100" />}
        >
          <Text size="T200">Loading threads</Text>
        </Chip>
      ) : null}
    </Box>
  );
}
