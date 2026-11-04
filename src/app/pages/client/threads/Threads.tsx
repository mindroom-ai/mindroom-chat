import React, { useMemo } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Page, PageHeader } from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useActiveSession } from '../../../hooks/useSessionStore';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { crossRoomThreadIndexAtom } from '../../../mindroom/cross-room-threads/crossRoomThreadIndex';
import { makeCrossRoomThreadFiltersAtom } from '../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import { FilterBar } from './FilterBar';
import { ThreadsView } from './ThreadsView';
import { useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';

/** Threads from every room the user is in, with filters and search. */
export function Threads() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  useNavToActivePathMapper('threads');
  useJoinedRoomThreadLists();

  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const filtersAtom = useMemo(() => makeCrossRoomThreadFiltersAtom(userId), [userId]);
  const [filters, setFilters] = useAtom(filtersAtom);

  return (
    <Page>
      <PageHeader balance>
        <Box alignItems="Center" justifyContent="Center" grow="Yes" gap="200">
          <Icon src={Icons.Thread} size="400" />
          <Text as="h1" size="H4" truncate>
            {t('nav.threads')}
          </Text>
        </Box>
      </PageHeader>
      <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
        <FilterBar filters={filters} setFilters={setFilters} />
        <ThreadsView indexSnapshot={indexSnapshot} filters={filters} setFilters={setFilters} />
      </Box>
    </Page>
  );
}
