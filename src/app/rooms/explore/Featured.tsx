import { Box, Icon, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { JoinRule } from 'matrix-js-sdk';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageHero,
  PageHeroSection,
} from '../../ui/page/Page';
import { PageScroll } from '../../ui/page/PageScroll';
import { RoomCard, RoomCardGrid } from '../room-card/RoomCard';
import { RoomSummaryLoader } from '../RoomSummaryLoader';
import { useClientConfig } from '../../config/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { EXPLORE_PATH } from '../../routes/paths';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { renderTopicText } from './exploreRoomCard';

function FeaturedCard({ roomIdOrAlias, space }: { roomIdOrAlias: string; space: boolean }) {
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const { navigateSpace, navigateRoom } = useRoomNavigate();

  return (
    <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias}>
      {(state, retry, viaServers, resolvedRoomId) => {
        const summary = state.status === AsyncStatus.Success ? state.data : undefined;
        const avatarUrl = summary?.avatar_url
          ? mxcUrlToHttp(client, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
          : undefined;
        const listing = { name: summary?.name, topic: summary?.topic, avatarUrl };
        const facts = { memberCount: summary?.num_joined_members, roomType: summary?.room_type };
        return (
          <RoomCard
            {...listing}
            {...facts}
            roomIdOrAlias={roomIdOrAlias}
            roomId={summary?.room_id ?? resolvedRoomId}
            allRooms={joinedRoomIds}
            joinRule={
              summary ? (summary.join_rule as JoinRule | undefined) ?? JoinRule.Public : undefined
            }
            accessStatus={state.status}
            onAccessRetry={retry}
            viaServers={viaServers}
            onView={space ? navigateSpace : navigateRoom}
            renderTopicViewer={renderTopicText}
          />
        );
      }}
    </RoomSummaryLoader>
  );
}

/** A titled grid of featured cards; renders nothing for an empty list. */
function FeaturedSection({
  title,
  roomIdsOrAliases,
  space,
}: {
  title: string;
  roomIdsOrAliases: string[];
  space: boolean;
}) {
  if (roomIdsOrAliases.length === 0) return null;
  return (
    <Box direction="Column" gap="300">
      <Text size="H4">{title}</Text>
      <RoomCardGrid>
        {roomIdsOrAliases.map((id) => (
          <FeaturedCard key={id} space={space} roomIdOrAlias={id} />
        ))}
      </RoomCardGrid>
    </Box>
  );
}

/** Spaces and rooms the deployment features on the Explore page. */
export function FeaturedRooms() {
  const { t } = useTranslation();
  const featured = useClientConfig().featuredCommunities;
  const spaces = featured?.spaces ?? [];
  const rooms = featured?.rooms ?? [];
  const nothingFeatured = spaces.length + rooms.length === 0;
  // Phones lead with the way back to the Explore list, so the title starts beside it.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const header = (
    <PageHeader balance>
      <PhoneBackButton to={EXPLORE_PATH} />
      <Box grow="Yes" justifyContent={phone ? 'Start' : 'Center'} alignItems="Center" gap="200">
        <Icon size="400" src={Icons.Bulb} />
        <Text size="H3" truncate>
          {t('sharedUi.explore.featured')}
        </Text>
      </Box>
    </PageHeader>
  );

  return (
    <Page>
      {/* On wider screens the hero names the page, so only phones keep the title bar. */}
      <PageScroll header={phone ? header : undefined}>
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="200">
              <PageHeroSection>
                <PageHero
                  title={t('sharedUi.featured.featuredByClient')}
                  subTitle={t(
                    'sharedUi.featured.findAndExplorePublicRoomsAndSpacesFeaturedByClientProvider'
                  )}
                  icon={<Icon size="600" src={Icons.Bulb} />}
                />
              </PageHeroSection>
              <FeaturedSection
                title={t('sharedUi.featured.featuredSpaces')}
                roomIdsOrAliases={spaces}
                space
              />
              <FeaturedSection
                title={t('sharedUi.featured.featuredRooms')}
                roomIdsOrAliases={rooms}
                space={false}
              />
              {nothingFeatured ? (
                <Text size="T300" align="Center">
                  {t('sharedUi.featured.noRoomsOrSpacesFeaturedByClientProvider')}
                </Text>
              ) : null}
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
