import { Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getSpaceLobbyPath, getSpacePath } from '../../routes/pathUtils';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { PageHeader } from '../../ui/page/Page';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { SpaceAvatar, SpaceHeaderIconLink, useSpaceAvatarSrc } from '../lobby/LobbyHeader';
import * as css from './SpaceThreads.css';

export type SpaceThreadsHeaderProps = {
  space: Room;
  spaceIdOrAlias: string;
  activeRoomCount?: number;
  totalRoomCount?: number;
};

export function SpaceThreadsHeader({
  space,
  spaceIdOrAlias,
  activeRoomCount,
  totalRoomCount,
}: SpaceThreadsHeaderProps) {
  const { t } = useTranslation();
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const spaceName = revealDirectionControls(useRoomName(space));
  const avatarSrc = useSpaceAvatarSrc(space);
  const overviewPath = getSpaceLobbyPath(spaceIdOrAlias);
  const overviewLabel = t('sharedUi.space.overview');

  return (
    <PageHeader balance={screenSize === ScreenSize.Mobile}>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minInlineSize: 0 }}>
        <PhoneBackButton to={getSpacePath(spaceIdOrAlias)} openedFrom={[overviewPath]} />
        <Box grow="Yes" alignItems="Center" gap="200" style={{ minInlineSize: 0 }}>
          <SpaceAvatar roomId={space.roomId} name={spaceName} src={avatarSrc} />
          <Text size="H4" truncate {...ownDirectionLine}>
            {spaceName}
          </Text>
          {totalRoomCount !== undefined && activeRoomCount !== undefined && (
            <Text as="span" size="T200" className={css.HeaderBadge} data-space-rooms-badge="true">
              {activeRoomCount === totalRoomCount
                ? t('spaceThreads.header.roomsCount', { count: totalRoomCount })
                : t('spaceThreads.header.roomsFiltered', {
                    active: activeRoomCount,
                    total: totalRoomCount,
                  })}
            </Text>
          )}
        </Box>
        {screenSize === ScreenSize.Mobile ? (
          <SpaceHeaderIconLink label={overviewLabel} icon={Icons.Category} to={overviewPath} />
        ) : (
          <button
            type="button"
            className={overviewCss.SortButton}
            onClick={() => void navigate(overviewPath)}
            data-space-overview-link="true"
          >
            <Icon size="100" src={Icons.Category} aria-hidden="true" />
            <Text as="span" size="T200">
              {overviewLabel}
            </Text>
          </button>
        )}
      </Box>
    </PageHeader>
  );
}
