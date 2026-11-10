import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { Page, PageHero, PageHeroSection } from '../ui/page/Page';

/** The Activity section with no thread open: where the thread a row opens will show. */
export function ActivityEmpty() {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  return (
    <Page>
      <PageHeroSection>
        <PageHero
          icon={<Icon size="600" src={Icons.Bell} />}
          title={t('activity.pickTitle')}
          // On a phone the list is in the menu, not beside the page.
          subTitle={t(phone ? 'activity.pickDescriptionPhone' : 'activity.pickDescription')}
        />
      </PageHeroSection>
    </Page>
  );
}
