import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageHero, PageHeroSection } from '../ui/page/Page';

/** The Activity section with no thread open: where the thread a row opens will show. */
export function ActivityEmpty() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeroSection>
        <PageHero
          icon={<Icon size="600" src={Icons.Bell} />}
          title={t('activity.pickTitle')}
          subTitle={t('activity.pickDescription')}
        />
      </PageHeroSection>
    </Page>
  );
}
