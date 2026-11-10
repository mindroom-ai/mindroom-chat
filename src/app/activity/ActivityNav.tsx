import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent } from '../ui/page/Page';
import { ActivityList } from './ActivityList';

/** The Activity section's navigation column: the Activity list, beside the thread it opens. */
export function ActivityNav() {
  const { t } = useTranslation();
  return (
    <PageNav label={t('activity.title')}>
      <PageNavContent>
        <ActivityList variant="page" />
      </PageNavContent>
    </PageNav>
  );
}
