import { Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { useDirectSelected } from '../../routes/useDirectSelected';
import { MindroomMarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { getDirectPath } from '../../routes/pathUtils';
import { useDirectRoomIds } from '../direct/useDirectRooms';
import { SectionTab } from './SectionTab';

type DirectTabProps = {
  /** Lets the navigation panel take the click, given whether Direct Messages is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Direct Messages button of the icon rail; returns to the last direct message opened. */
export function DirectTab({ onSelect }: DirectTabProps) {
  const { t } = useTranslation();
  const selected = useDirectSelected();
  // The conversations Direct Messages lists, so the badge counts none it hides.
  const roomIds = useDirectRoomIds();
  return (
    <SectionTab
      section="direct"
      path={getDirectPath()}
      selected={selected}
      label={t('nav.directMessages')}
      icon={Icons.User}
      rooms={roomIds}
      menu={(close) => <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />}
      personal
      onSelect={onSelect}
    />
  );
}
