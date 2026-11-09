import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageHero, PageHeroSection } from '../../ui/page/Page';

/** The Threads section with no thread open: where the thread a row opens will show. */
export function ThreadsEmpty() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeroSection>
        <PageHero
          icon={<Icon size="600" src={Icons.Thread} />}
          title={t('threadsPage.pickTitle')}
          subTitle={t('threadsPage.pickDescription')}
        />
      </PageHeroSection>
    </Page>
  );
}
