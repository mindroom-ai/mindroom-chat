import { FormEventHandler } from 'react';
import { Box, Button, Icon, Icons, Input, Spinner, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { JoinRule, type IPublicRoomsChunkRoom } from 'matrix-js-sdk';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../ui/page/Page';
import { PageScroll } from '../../ui/page/PageScroll';
import { RoomCard, RoomCardGrid } from '../RoomCard';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { EXPLORE_PATH } from '../../routes/paths';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { decodeRouteParam } from '../../routes/pathUtils';
import { renderTopicText } from './exploreRoomCard';
import * as css from './style.css';

const PAGE_LIMIT = 24;

type PublicRoom = IPublicRoomsChunkRoom & { join_rule?: string; room_type?: string };

/** The public room directory of a server, with search. */
export function PublicRooms() {
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { t } = useTranslation();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const { navigateSpace, navigateRoom } = useRoomNavigate();
  const { server: encodedServer } = useParams();
  const server = encodedServer ? decodeRouteParam(encodedServer) : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const term = searchParams.get('term') ?? undefined;
  // Phones lead with the way back to the Explore list, so the title starts beside it.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-rooms', server, term],
    queryFn: () =>
      client.publicRooms({
        server,
        limit: PAGE_LIMIT,
        filter: term ? { generic_search_term: term } : undefined,
      }),
  });

  const handleSearch: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { searchInput: HTMLInputElement };
    const value = target.searchInput.value.trim();
    setSearchParams(value ? { term: value } : {});
  };

  const rooms = (data?.chunk ?? []) as PublicRoom[];

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader balance>
            <PhoneBackButton to={EXPLORE_PATH} />
            <Box
              grow="Yes"
              justifyContent={phone ? 'Start' : 'Center'}
              alignItems="Center"
              gap="200"
            >
              <Icon size="400" src={Icons.Server} />
              <Text as="h1" size="H3" truncate>
                {server}
              </Text>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="400">
              <Box as="form" onSubmit={handleSearch} gap="200">
                <Box grow="Yes">
                  <Input
                    name="searchInput"
                    defaultValue={term}
                    placeholder={t('sharedUi.server.searchForKeyword')}
                    aria-label={t('sharedUi.server.searchForKeyword')}
                    variant="SurfaceVariant"
                    size="500"
                    radii="400"
                    before={<Icon size="200" src={Icons.Search} />}
                    style={{ flexGrow: 1 }}
                  />
                </Box>
                <Button type="submit" size="500" radii="400" variant="Secondary">
                  <Text size="B400">{t('sharedUi.server.search')}</Text>
                </Button>
              </Box>
              {isLoading && (
                <Box justifyContent="Center">
                  <Spinner size="600" variant="Secondary" />
                </Box>
              )}
              {!!error && (
                <Box className={css.PublicRoomsError}>
                  <Text size="T300">
                    {t('sharedUi.explore.failedToLoadPublicRoomsPleaseTryAgain')}
                  </Text>
                </Box>
              )}
              {!isLoading && !error && rooms.length === 0 && (
                <Box className={css.RoomsInfoCard} justifyContent="Center">
                  <Text size="T300">{t('sharedUi.server.noCommunitiesFound')}</Text>
                </Box>
              )}
              {rooms.length > 0 && (
                <RoomCardGrid>
                  {rooms.map((room) => {
                    const space = room.room_type === 'm.space';
                    const avatarUrl = room.avatar_url
                      ? mxcUrlToHttp(client, room.avatar_url, useAuthentication, 96, 96, 'crop') ??
                        undefined
                      : undefined;
                    return (
                      <RoomCard
                        key={room.room_id}
                        roomIdOrAlias={room.canonical_alias ?? room.room_id}
                        roomId={room.room_id}
                        name={room.name}
                        avatarUrl={avatarUrl}
                        allRooms={joinedRoomIds}
                        topic={room.topic}
                        memberCount={room.num_joined_members}
                        roomType={room.room_type}
                        joinRule={(room.join_rule as JoinRule | undefined) ?? JoinRule.Public}
                        viaServers={server ? [server] : undefined}
                        onView={space ? navigateSpace : navigateRoom}
                        renderTopicViewer={renderTopicText}
                      />
                    );
                  })}
                </RoomCardGrid>
              )}
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
