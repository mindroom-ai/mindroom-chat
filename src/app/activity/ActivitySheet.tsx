import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../ui/BottomSheet';
import { ActivityList } from './ActivityList';

/** Activity on a phone: the list slides up from the bottom; a row opens its thread full screen. */
export function ActivitySheet({ requestClose }: { requestClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      title={t('activity.title')}
      closeLabel={t('activity.close')}
      requestClose={requestClose}
    >
      <ActivityList variant="sheet" onNavigate={requestClose} />
    </BottomSheet>
  );
}
