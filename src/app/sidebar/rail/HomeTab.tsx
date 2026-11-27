import { useMemo } from 'react';
import { Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { useHomeIndexSelected, useHomeSelected } from '../../routes/useHomeSelected';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { getHomePath } from '../../routes/pathUtils';
import { useHomeRooms } from '../../matrix/state/useHomeRooms';
import { useRailButtons } from '../../settings/railButtons';
import { useDirectRoomIds } from '../direct/useDirectRooms';
import { SectionTab } from './SectionTab';

type HomeTabProps = {
  /**
   * Lets the navigation panel take the click, given whether Home is shown and whether an open
   * panel may collapse; true when it did.
   */
  onSelect?: (selected: boolean, allowCollapse?: boolean) => boolean;
};

/**
 * The Home button of the icon rail; returns to the last place opened in Home, or back to the Home
 * landing page when already in a Home sub-route.
 */
export function HomeTab({ onSelect }: HomeTabProps) {
  const { t } = useTranslation();
  const selected = useHomeSelected();
  const atRoot = useHomeIndexSelected();
  const { direct: directTabShown } = useRailButtons();
  const homeRoomIds = useHomeRooms();
  const directRoomIds = useDirectRoomIds();
  const roomIds = useMemo(
    () => (directTabShown ? homeRoomIds : [...homeRoomIds, ...directRoomIds]),
    [directTabShown, homeRoomIds, directRoomIds]
  );
  return (
    <SectionTab
      section="home"
      path={getHomePath()}
      selected={selected}
      returnToRoot
      atRoot={atRoot}
      label={t('nav.home')}
      icon={Icons.Home}
      rooms={roomIds}
      menu={(close) => <MarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />}
      onSelect={onSelect}
    />
  );
}
