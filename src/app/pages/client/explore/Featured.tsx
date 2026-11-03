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

/** Spaces and rooms the deployment features on the Explore page. */



  const spaces = featuredCommunities?.spaces ?? [];
  const rooms = featuredCommunities?.rooms ?? [];

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader balance>
            <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
              <Icon size="400" src={Icons.Bulb} />
              <Text size="H3" truncate>
                {t('featureUi.explore.featured')}
              </Text>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="200">
              <PageHeroSection>
                <PageHero
                  icon={<Icon size="600" src={Icons.Bulb} />}
                  title={t('featureUi.explore.featuredTitle')}
                  subTitle={t('featureUi.explore.featuredSubtitle')}
                />
              </PageHeroSection>
              {spaces.length > 0 && (
                <Box direction="Column" gap="300">
                  <Text size="H4">{t('featureUi.explore.featuredSpaces')}</Text>
                  <RoomCardGrid>
                    {spaces.map((roomIdOrAlias) => (
                      <FeaturedCard key={roomIdOrAlias} roomIdOrAlias={roomIdOrAlias} space />
                    ))}
                  </RoomCardGrid>
                </Box>
              )}
              {rooms.length > 0 && (
                <Box direction="Column" gap="300">
                  <Text size="H4">{t('featureUi.explore.featuredRooms')}</Text>
                  <RoomCardGrid>
                    {rooms.map((roomIdOrAlias) => (
                      <FeaturedCard
                        key={roomIdOrAlias}
                        roomIdOrAlias={roomIdOrAlias}
                        space={false}
                      />
                    ))}
                  </RoomCardGrid>
                </Box>
              )}
              {spaces.length === 0 && rooms.length === 0 && (
                <Text size="T300" align="Center">
                  {t('featureUi.explore.noFeatured')}
                </Text>
              )}
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
