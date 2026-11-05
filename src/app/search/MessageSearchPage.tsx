import { useRef } from 'react';
import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageScroll,
} from '../ui/page';
import { PhoneBackButton } from '../ui/page/PhoneBackButton';
import { useSpace } from '../matrix/hooks/useSpace';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { useHomeSearchRooms } from '../matrix/state/useHomeRooms';
import { useSpaceSearchRooms } from '../matrix/state/useSpaceSearchRooms';
import { HOME_PATH } from '../routes/paths';
import { getSpacePath } from '../routes/pathUtils';
import { MindroomMessageSearch, type MindroomMessageSearchProps } from './AgentMessageSearch';

type SearchPageProps = Omit<MindroomMessageSearchProps, 'scrollRef'> & {
  /** The section list a phone's back arrow returns to. */
  backTo: string;
};

/**
 * Message search as a page of its section: a title bar like the Inbox pages, then the search
 * field and its results in the centered column, scrolling under the title.
 */
function SearchPage({ backTo, ...searchProps }: SearchPageProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Page>
      <PageHeader balance>
        <PhoneBackButton to={backTo} />
        <Box grow="Yes" alignItems="Center" style={{ minWidth: 0 }}>
          <Text as="h1" size="H4" truncate>
            {t('nav.messageSearch')}
          </Text>
        </Box>
      </PageHeader>
      <PageScroll scrollRef={scrollRef}>
        <PageContent>
          <PageContentCenter>
            <MindroomMessageSearch {...searchProps} scrollRef={scrollRef} />
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}

/** `/home/search/`: Home's rooms by default, every joined room with Global. */
export function HomeSearchPage() {
  const { t } = useTranslation();
  const rooms = useHomeSearchRooms();
  return (
    <SearchPage backTo={HOME_PATH} defaultRooms={rooms} scopeName={t('nav.home')} allowGlobal />
  );
}

/** `/<space>/search/`: the rooms of the space, at any depth; Home's search reaches the rest. */
export function SpaceSearchPage() {
  const space = useSpace();
  const rooms = useSpaceSearchRooms(space.roomId);
  const spaceName = useRoomName(space);
  return (
    <SearchPage
      backTo={getSpacePath(space.roomId)}
      defaultRooms={rooms}
      scopeName={spaceName}
      allowGlobal={false}
    />
  );
}
