import { ReactNode, RefObject } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../page';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';

type SettingsPageFrameProps = {
  title: string;
  requestClose: () => void;
  children: ReactNode;
  /** The scrolling viewport, for pages with a virtual list. */
  scrollRef?: RefObject<HTMLDivElement>;
};

/** What the settings dialog hands each of its pages. */
export type SettingsPageProps = Pick<SettingsPageFrameProps, 'requestClose'>;

type FrameHeaderProps = Pick<SettingsPageFrameProps, 'title' | 'requestClose'>;

// settings.png: the close button sits 24 px from the dialog's end edge (the right, or the left in
// a right-to-left language) and the cards end 28 px from it. Inline and in plain units, because
// the shared page header and content set their own padding and the unit tests of the pages load
// this frame with folds and styles mocked.
const HEADER_INSET = { paddingInlineEnd: '1.5rem' };
const CONTENT_INSET = { paddingInlineEnd: '1.75rem' };

/**
 * On phones a page covers the menu, so its header leads with a back arrow to the menu (the
 * dialog's own close stays on the menu); wider screens show the menu beside the page and close
 * the dialog from the page.
 */
function FrameHeader({ title, requestClose }: FrameHeaderProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const heading = (
    <Text size="H3" truncate>
      {title}
    </Text>
  );

  if (phone) {
    return (
      <PageHeader outlined={false} balance>
        <Box grow="Yes" alignItems="Center" gap="200">
          <IconButton
            variant="Surface"
            onClick={requestClose}
            aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
          >
            <Icon src={Icons.ArrowLeft} data-directional />
          </IconButton>
          {heading}
        </Box>
      </PageHeader>
    );
  }

  return (
    <PageHeader outlined={false} style={HEADER_INSET}>
      <Box grow="Yes" alignItems="Center">
        {heading}
      </Box>
      <IconButton
        variant="Surface"
        onClick={requestClose}
        aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
      >
        <Icon src={Icons.Cross} />
      </IconButton>
    </PageHeader>
  );
}

/** Header with the page title and a close button over the scrolling settings content. */
export function SettingsPageFrame({
  title,
  requestClose,
  children,
  scrollRef,
}: SettingsPageFrameProps) {
  return (
    <Page>
      <PageScroll
        scrollRef={scrollRef}
        header={<FrameHeader title={title} requestClose={requestClose} />}
      >
        <PageContent style={CONTENT_INSET} data-settings-page="">
          <Box direction="Column" gap="700">
            {children}
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
