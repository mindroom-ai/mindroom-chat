import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { MenuGroup } from '../../ui/MenuEntry';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { PageNavHeader } from '../../ui/page/Page';
import { PairedTouchTarget } from '../../ui/styles/TouchTarget.css';
import type { RoomOrder } from '../room-nav/roomOrder';
import { RoomSortMenu } from '../room-nav/RoomSortMenu';
import { HiddenRailPages } from './HiddenRailPages';
import { MacAppMenuEntry } from './MacAppMenuEntry';

export type HomeHeaderProps = {
  roomIds: string[];
  sort?: Pick<RoomOrder, 'mode' | 'showTimes' | 'hasSavedOrder' | 'setMode' | 'setShowTimes'>;
};

/** Home sidebar header with room sort menu, Mark as Read, and hidden rail page entries. */
export function HomeHeader({ roomIds, sort }: HomeHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        <Box grow="Yes">
          <Text as="h2" truncate size="H4">
            {t('nav.home')}
          </Text>
        </Box>
        <Box alignItems="Center" gap="100" shrink="No">
          {sort && (
            <RoomSortMenu
              mode={sort.mode}
              showTimes={sort.showTimes}
              hasSavedOrder={sort.hasSavedOrder}
              onModeChange={sort.setMode}
              onShowTimesChange={sort.setShowTimes}
              buttonClassName={PairedTouchTarget}
            />
          )}
          {/* Its own name, so it is not taken for a room's More Options button. */}
          <NavOptionsMenu
            label={t('featureUi.homeNav.options')}
            width={200}
            buttonClassName={PairedTouchTarget}
          >
            {(close) => (
              <>
                <MenuGroup>
                  <MarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />
                </MenuGroup>
                <HiddenRailPages onClose={close} />
                <MacAppMenuEntry onClose={close} />
              </>
            )}
          </NavOptionsMenu>
        </Box>
      </Box>
    </PageNavHeader>
  );
}
