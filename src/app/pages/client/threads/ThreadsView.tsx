import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Button, Icon, Icons, Text } from 'folds';
import type { CrossRoomThreadIndexSnapshot } from '../../../mindroom/cross-room-threads/crossRoomThreadIndex';
import {
  applyCrossRoomThreadFilters,
  isCrossRoomThreadEntryEligible,
} from '../../../mindroom/cross-room-threads/crossRoomThreadFilterPipeline';
import {
  DEFAULT_CROSS_ROOM_THREAD_FILTERS,
  type CrossRoomThreadFilters,
  type CrossRoomThreadFiltersUpdate,
} from '../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import { VirtualTile } from '../../../components/virtualizer';
import { ThreadsViewRow } from './ThreadsViewRow';
import * as css from './ThreadsView.css';

type ThreadsViewProps = {
  indexSnapshot: CrossRoomThreadIndexSnapshot;
  filters: CrossRoomThreadFilters;
  setFilters: (filters: CrossRoomThreadFiltersUpdate) => void;
};

export function ThreadsView({ indexSnapshot, filters, setFilters }: ThreadsViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const eligibleEntries = useMemo(
    () => Array.from(indexSnapshot.entries.values()).filter(isCrossRoomThreadEntryEligible),
    [indexSnapshot.entries]
  );
  const entries = useMemo(
    () => applyCrossRoomThreadFilters(eligibleEntries, filters),
    [eligibleEntries, filters]
  );
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });

  if (!indexSnapshot.bootstrapped) {
    return (
      <Box className={css.Empty} direction="Column" gap="300">
        <Icon src={Icons.Thread} size="600" />
        <Text size="H4">Loading threads</Text>
      </Box>
    );
  }

  if (eligibleEntries.length === 0) {
    return (
      <Box className={css.Empty} direction="Column" gap="300">
        <Icon src={Icons.Thread} size="600" />
        <Text size="H4">You have not been involved in any threads yet</Text>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box className={css.Empty} direction="Column" gap="300">
        <Icon src={Icons.Filter} size="600" />
        <Text size="H4">No threads match your filters</Text>
        <Button onClick={() => setFilters(DEFAULT_CROSS_ROOM_THREAD_FILTERS)}>
          <Text size="B300">Clear filters</Text>
        </Button>
      </Box>
    );
  }

  return (
    <Box className={css.View}>
      <div className={css.Count} aria-live="polite">
        <Text size="T200" priority="300">
          {entries.length} {entries.length === 1 ? 'thread' : 'threads'}
        </Text>
      </div>
      <div ref={scrollRef} className={css.Scroll}>
        <div
          className={css.List}
          style={{
            height: virtualizer.getTotalSize(),
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = entries[virtualItem.index];
            if (!entry) return null;

            return (
              <VirtualTile
                key={entry.key}
                virtualItem={virtualItem}
                ref={virtualizer.measureElement}
              >
                <ThreadsViewRow entry={entry} />
              </VirtualTile>
            );
          })}
        </div>
      </div>
    </Box>
  );
}
