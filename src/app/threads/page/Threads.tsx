import { useMemo } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Page, PageHeader } from '../../ui/page/Page';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import { crossRoomThreadIndexAtom } from '../cross-room/crossRoomThreadIndex';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { makeCrossRoomThreadFiltersAtom } from '../cross-room/crossRoomThreadFilters';
import { FilterBar } from './FilterBar';
import { ThreadsView } from './ThreadsView';
import { isListedRoom, useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';

/** Threads from every room the user is in, with filters and search. */
export function Threads() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  useNavToActivePathMapper('threads');
  // Every page of every room's list, so the page lists all threads and counts them all.
  const listsComplete = useJoinedRoomThreadLists(true);

  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  // The index takes a list's last threads a moment after the list ends; until then it counts fewer.
  const countComplete = useMemo(() => {
    if (!listsComplete) return false;
    const indexed = new Map<string, number>();
    indexSnapshot.entries.forEach(({ roomId }) =>
      indexed.set(roomId, (indexed.get(roomId) ?? 0) + 1)
    );
    return joinedRoomIds
      .map((roomId) => mx.getRoom(roomId))
      .filter(isListedRoom)
      .every((room) => room.getThreads().length <= (indexed.get(room.roomId) ?? 0));
  }, [indexSnapshot, joinedRoomIds, listsComplete, mx]);
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
        <ThreadsView
          indexSnapshot={indexSnapshot}
          filters={filters}
          setFilters={setFilters}
          countComplete={countComplete}
        />
      </Box>
    </Page>
  );
}
