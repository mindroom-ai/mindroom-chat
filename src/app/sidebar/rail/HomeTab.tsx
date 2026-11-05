import { Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { useHomeSelected } from '../../routes/useHomeSelected';
import { MindroomMarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { getHomePath } from '../../routes/pathUtils';
import { useHomeRooms } from '../../matrix/state/useHomeRooms';
import { SectionTab } from './SectionTab';

type HomeTabProps = {
  /** Lets the navigation panel take the click, given whether Home is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Home button of the icon rail; returns to the last place opened in Home. */
export function HomeTab({ onSelect }: HomeTabProps) {
  const { t } = useTranslation();
  const selected = useHomeSelected();
  const roomIds = useHomeRooms();
  return (
    <SectionTab
      section="home"
      path={getHomePath()}
      selected={selected}
      label={t('nav.home')}
      icon={Icons.Home}
      rooms={roomIds}
      menu={(close) => <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />}
      onSelect={onSelect}
    />
  );
}
