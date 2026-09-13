import React, { useMemo } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { Page, PageHeader } from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useActiveSession } from '../../../hooks/useSessionStore';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { makeCrossRoomThreadFiltersAtom } from '../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import { crossRoomThreadIndexAtom } from '../../../mindroom/cross-room-threads/crossRoomThreadIndex';
import { FilterBar } from './FilterBar';
import { ThreadsView } from './ThreadsView';

export function Threads() {
  useNavToActivePathMapper('threads');
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  const filtersAtom = useMemo(() => makeCrossRoomThreadFiltersAtom(userId), [userId]);
  const [filters, setFilters] = useAtom(filtersAtom);
  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);

  return (
    <Page data-testid="cross-room-threads-view">
      <PageHeader outlined>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Icon src={Icons.Thread} size="300" />
          <Text as="h1" size="H3" truncate>
            Threads
          </Text>
        </Box>
      </PageHeader>
      <FilterBar filters={filters} setFilters={setFilters} />
      <ThreadsView indexSnapshot={indexSnapshot} filters={filters} setFilters={setFilters} />
    </Page>
  );
}
