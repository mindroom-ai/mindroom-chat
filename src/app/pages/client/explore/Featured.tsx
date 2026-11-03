import React from 'react';
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
  PageScroll,
} from '../../../components/page';
import { RoomCard, RoomCardGrid } from '../../../components/room-card';
import { RoomSummaryLoader } from '../../../components/RoomSummaryLoader';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mxcUrlToHttp } from '../../../utils/mediaUrl';
import { renderTopicText } from './exploreRoomCard';

function FeaturedCard({ roomIdOrAlias, space }: { roomIdOrAlias: string; space: boolean }) {







      {(state, retry, viaServers, resolvedRoomId) => {
        const summary = state.status === AsyncStatus.Success ? state.data : undefined;
        const avatarUrl = summary?.avatar_url
          ? mxcUrlToHttp(mx, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
          : undefined;
        return (
          <RoomCard
            roomIdOrAlias={roomIdOrAlias}
            roomId={summary?.room_id ?? resolvedRoomId}






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

  const header = (
    <PageHeader balance>
      <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
        <Icon size="400" src={Icons.Bulb} />
        <Text size="H3" truncate>
          {t('sharedUi.explore.featured')}
        </Text>
      </Box>
    </PageHeader>
  );

  return (
    <Page>
      <PageScroll header={header}>
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
